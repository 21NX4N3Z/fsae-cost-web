/* ============================================================
   FSAE Cost Manager — application logic
   ทุก event ผูกผ่าน addEventListener เท่านั้น ไม่มี inline handler
   ข้อมูลมาจาก data/bom.json + data/catalogs.json + data/sheet-template.json
   ============================================================ */
"use strict";

// ------------------------------------------------------------
// โครงสร้างหมวด — ตรงกับ Google Sheet A3000 จริง 4 หมวด
// Process Multipliers ไม่ใช่หมวดแยก แต่เป็น 2 คอลัมน์ในแถวของ PROCESS
// ------------------------------------------------------------
const SECTIONS = [
  {
    key: "material",
    label: "MATERIAL",
    catalog: "materials",
    catalogLabel: "Materials",
    desc: "Standardized material inputs",
    addLabel: "Add from Materials Cost Catalog",
    subtotalCol: "AA",
    empty: "ยังไม่มีรายการ — เพิ่มจาก Materials Cost Catalog",
  },
  {
    key: "process",
    label: "PROCESS",
    catalog: "processes",
    catalogLabel: "Processes",
    desc: "Process base costs",
    addLabel: "Add from Processes Cost Catalog",
    subtotalCol: "S",
    empty: "ยังไม่มีรายการ — เพิ่มจาก Processes Cost Catalog",
  },
  {
    key: "fastener",
    label: "FASTENER",
    catalog: "fasteners",
    catalogLabel: "Fasteners",
    desc: "Fastener installation / hardware catalog",
    addLabel: "Add from Fasteners Cost Catalog",
    subtotalCol: "U",
    empty: "ยังไม่มีรายการ — เพิ่มจาก Fasteners Cost Catalog",
  },
  {
    key: "tooling",
    label: "TOOLING",
    catalog: "tooling",
    catalogLabel: "Tooling",
    desc: "Tooling table and PVF workflow",
    addLabel: "Add from Tooling Cost Catalog",
    subtotalCol: "S",
    empty: "ยังไม่มีรายการ — เพิ่มจาก Tooling Cost Catalog",
  },
];

const STORAGE_KEYS = {
  entries: "fsae.entries.v2",
  settings: "fsae.settings.v2",
  token: "fsae.token.v1",
  partMap: "fsae.partmap.v1",
};

const GOOGLE_CLIENT_ID = "1017305531254-5s4hh89qq1vpmdbbhtgp8g5cdef704t7.apps.googleusercontent.com";
const GOOGLE_SHEET_ID = "1_CjzOiP_Th0dKBX58fc6c6ksnQNjGZqPaXltOgw_Z2c";

const state = {
  bom: {},
  catalog: {},
  template: null,
  assembly: "",
  partNo: "",
  rows: { material: [], process: [], fastener: [], tooling: [] },
  savedEntries: [],
  settings: {
    // client_id เป็นค่าสาธารณะ (Public) จึงฝังใน frontend ได้
    // ห้ามฝัง client_secret เด็ดขาด — ระบบนี้ไม่ใช้แบบนั้น
    clientId: GOOGLE_CLIENT_ID,
    spreadsheetId: GOOGLE_SHEET_ID,
    templateTab: "AA 30001-1",
  },
  modal: { catalog: "materials", target: "material" },
  token: null,
  conflict: null,
  missing: null,        // { pn: {status,...} } จากการสแกนชีต
  scanBusy: false,
  matchBusy: false,
  matchProposals: null,  // ผลจับคู่ที่เสนอให้ผู้ใช้ยืนยัน
  sheetHeaders: [],      // หัวข้อของทุก tab ที่อ่านมา
  partMap: {},           // pn -> tab name (ผู้ใช้ยืนยันแล้ว)
};

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------
// Utilities
// ------------------------------------------------------------
function money(v) {
  const n = Number(v) || 0;
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function num(v, fallback = 0) {
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : fallback;
}

function round4(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v * 10000) / 10000;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

let toastTimer = null;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("is-open");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("is-open"), 3200);
}

function partsOf(assembly) {
  return state.bom[assembly] || [];
}

// ------------------------------------------------------------
// Formula engine
// ------------------------------------------------------------
function evaluateFormula(formula, values, c1, c2) {
  if (!formula) return 0;
  const table = Object.assign({ C1: num(c1), C2: num(c2) }, values || {});
  let code = String(formula).trim();

  code = code.replace(/\[([A-Za-z0-9_]+)\]/g, (match, name) => {
    const v = table[name];
    return Number.isFinite(v) ? String(v) : "0";
  });

  code = code.replace(/\^/g, "**");
  if (!/^[\d\s+\-*/().,A-Za-z]*$/.test(code)) return 0;
  if (!/^[\d\s+\-*/().]/.test(code)) return 0;

  try {
    const result = Function("Math", '"use strict"; return (' + code + ");")(Math);
    return Number.isFinite(result) ? result : 0;
  } catch (err) {
    return 0;
  }
}

/** ต้นทุนต่อหน่วยของ 1 แถว (สูตรจากแคตตาล็อก)
 * กันค่าติดลบ: ในแคตตาล็อกมี 16 รายการที่ C2 เป็นค่าลบ (เช่น Fitting/CO2 Tank)
 * ถ้าขนาดเล็กกว่าค่าตัดออกสูตรจะได้ลบ ซึ่งเป็นต้นทุนที่ไม่มีความหมาย */
function unitCostOf(row) {
  if (row.kind === "tooling") return Math.max(num(row.toolCost, 0), 0);
  // ไม่พบในแคตตาล็อก (คนในทีมพิมพ์เอง) — ใช้ค่าที่ชีตคำนวณไว้แทน
  if (row.notInCatalog) return Math.max(num(row.sheetUnitCost, 0), 0);
  return Math.max(evaluateFormula(row.formula, row.values, row.c1, row.c2), 0);
}

function multOf(row) {
  if (row.kind !== "process") return 1;
  const v = num(row.multVal, 0);
  return v > 0 ? v : 1;
}

/** Size(1) ที่ใช้เป็นตัวคูณแถว
 * ถ้าสูตรของแคตตาล็อกดึง Size1 อยู่แล้ว ให้ใช้ค่าจากพารามิเตอร์นั้น
 * ไม่งั้นตัวคูณจะเป็น 0 และต้นทุนหายทั้งแถว */
function size1Of(row) {
  if (row.size1Fixed) return num(row.values && row.values.Size1, 0);
  return num(row.size1, 0);
}

/** ต้นทุนรวม 1 แถว — ตรงกับสูตรที่ยืนยันจาก Sheet จริง */
function rowTotal(row) {
  const u = unitCostOf(row);
  if (row.kind === "material") return u * size1Of(row) * num(row.qty, 0);
  if (row.kind === "process") return u * num(row.qty, 0) * multOf(row);
  if (row.kind === "fastener") return u * num(row.qty, 0);
  if (row.kind === "tooling") return (u * num(row.qty, 0)) / Math.max(num(row.pvf, 1), 1);
  return 0;
}

function sumOf(key) {
  return state.rows[key].reduce((acc, row) => acc + rowTotal(row), 0);
}

// ------------------------------------------------------------
// Totals
// ------------------------------------------------------------
function totals() {
  const material = sumOf("material");
  const process = sumOf("process");
  const fastener = sumOf("fastener");
  const tooling = sumOf("tooling");
  const part = material + process + fastener + tooling;
  const qty = Math.max(num($("inpQty").value, 1), 0);
  return { material, process, fastener, tooling, part, qty, extended: part * qty };
}

function recalc() {
  const t = totals();
  $("sumMaterial").textContent = money(t.material);
  $("sumProcess").textContent = money(t.process);
  $("sumFastener").textContent = money(t.fastener);
  $("sumTooling").textContent = money(t.tooling);
  $("sumPart").textContent = money(t.part);
  $("sumQty").textContent = String(t.qty);
  $("sumExtended").textContent = money(t.extended);
  $("sumGrand").textContent = money(t.extended);

  const withMult = state.rows.process.filter((r) => r.multName);
  $("multNote").innerHTML = withMult.length > 0
    ? "ตัวคูณคิด <b>รายแถว</b> ใน PROCESS — " +
      withMult.map((r) => r.multName + " &times;" + multOf(r)).join(", ")
    : "<b>Process Multipliers</b> เป็นคอลัมน์ในแต่ละแถวของ PROCESS (คอลัมน์ O/Q ในชีต) ไม่ใช่หมวดแยก";
}

// ------------------------------------------------------------
// Part selection
// ------------------------------------------------------------
function fillAssemblies() {
  const sel = $("selAssembly");
  sel.textContent = "";
  Object.keys(state.bom).forEach((name) => {
    const opt = el("option", null, name);
    opt.value = name;
    sel.appendChild(opt);
  });
  const names = Object.keys(state.bom);
  state.assembly = state.assembly && state.bom[state.assembly] ? state.assembly : (names[0] || "");
  sel.value = state.assembly;
  fillParts();
}

function fillParts() {
  const sel = $("selPart");
  sel.textContent = "";
  partsOf(state.assembly).forEach((row) => {
    const opt = el("option", null, row[0] + " — " + row[1]);
    opt.value = row[0];
    sel.appendChild(opt);
  });
  syncPart();
}

function syncPart() {
  const rows = partsOf(state.assembly);
  const found = rows.find((r) => r[0] === $("selPart").value) || rows[0];
  if (!found) return;
  state.partNo = found[0];
  $("selPart").value = found[0];
  $("inpPartName").value = found[1];
  // BOM ใช้ 'FR 00230-AA' แต่ชีตใช้ base รูป '30001-1'
  // จึงเก็บ P/N ดิบไว้ แล้วให้ผู้ใช้กำหนด tab เองได้ในช่อง Target tab
  $("inpBaseNo").value = found[0];
  const tag = $("partCategory");
  tag.textContent = found[2];
  tag.className = "tag " + (found[2] === "BODY" ? "tag-body" : "tag-frame");
  const existing = state.savedEntries.find((e) => e.pn === found[0]);
  if (existing) loadEntry(existing);
}

// ------------------------------------------------------------
// Cost breakdown rendering
// ------------------------------------------------------------
function sectionByKey(key) {
  const s = SECTIONS.find((x) => x.key === key);
  if (!s) throw new Error("ไม่พบหมวด " + key);
  return s;
}

function subLabel(row) {
  if (row.kind === "material") {
    return [row.use, row.category, row.supplier].filter(Boolean).join(" · ") || "Material";
  }
  if (row.kind === "process") {
    const bits = [row.use, row.unit].filter(Boolean);
    if (row.toolingRequired) bits.push("tooling required");
    if (row.multName) bits.push("mult: " + row.multName + " ×" + multOf(row));
    return bits.join(" · ");
  }
  if (row.kind === "fastener") {
    return [row.use, row.category, row.supplier].filter(Boolean).join(" · ") || "Fastener";
  }
  return [row.use, row.unit, "PVF " + num(row.pvf, 0)].filter(Boolean).join(" · ") || "Tooling";
}

function renderCost() {
  const box = $("costContainer");
  box.textContent = "";

  SECTIONS.forEach((section) => {
    const rows = state.rows[section.key];
    const wrap = el("div", "cost-section");

    const head = el("div", "sec-head");
    head.appendChild(el("strong", null, section.label));
    head.appendChild(el("span", null, section.desc));
    const count = el("span", "sec-count", String(rows.length));
    if (rows.length > 0) count.style.marginLeft = "auto";
    head.appendChild(count);
    wrap.appendChild(head);

    if (rows.length === 0) wrap.appendChild(el("div", "empty", section.empty));
    rows.forEach((row, index) => wrap.appendChild(buildRow(section, row, index)));

    const plus = el("div", "plus-row");
    const btn = el("button", "linkbtn");
    btn.type = "button";
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M12 5v14M5 12h14");
    icon.appendChild(path);
    btn.appendChild(icon);
    btn.appendChild(el("span", null, section.addLabel));
    btn.addEventListener("click", () => openCatalog(section.catalog, section.key));
    plus.appendChild(btn);
    wrap.appendChild(plus);

    box.appendChild(wrap);
  });

  recalc();
}

function ctlField(labelText, inputId, value, onInput, opts) {
  const ctl = el("div", "ctl");
  const label = el("label", null, labelText);
  label.htmlFor = inputId;
  const input = document.createElement("input");
  input.type = "number";
  input.step = (opts && opts.step) || "any";
  input.id = inputId;
  input.value = value === undefined || value === null ? "" : value;
  if (opts && opts.min !== undefined) input.min = opts.min;
  input.placeholder = "0";
  input.addEventListener("input", () => {
    onInput(input.value);
    recalc();
    updateRowTotals();
  });
  ctl.appendChild(label);
  ctl.appendChild(input);
  return ctl;
}

function readOnlyField(labelText, valueText, warn) {
  const ctl = el("div", "ctl ctl-readonly" + (warn ? " ctl-warn" : ""));
  ctl.appendChild(el("label", null, labelText));
  ctl.appendChild(el("div", "val", valueText));
  return ctl;
}

function buildRow(section, row, index) {
  const wrap = el("div", "cost-row");
  const tag = section.key + "-" + index;

  const top = el("div", "cr-top");
  const nameBox = el("div", "cr-name");
  nameBox.appendChild(el("div", "name", row.title || "(ไม่มีชื่อ)"));
  const sub = subLabel(row);
  if (sub) nameBox.appendChild(el("div", "subtext", sub));
  const hint = row.kind === "tooling"
    ? "I × Quantity ÷ PVF"
    : ((row.params && row.params.length > 0) ? row.formula : "fixed catalog price");
  nameBox.appendChild(el("div", "cr-formula", hint));
  if (row.notInCatalog) {
    const badge = el("span", "tag tag-wait", "ไม่รู้จักในแคตตาล็อก — ใช้ค่าจากชีต");
    nameBox.appendChild(badge);
  }
  top.appendChild(nameBox);

  const totalBox = el("div");
  const total = el("div", "cr-total", money(rowTotal(row)));
  total.id = "rowTotal-" + tag;
  totalBox.appendChild(total);
  if (row.kind === "tooling") totalBox.appendChild(el("div", "cr-unit", "tool cost " + money(row.toolCost)));
  else if (row.kind === "process" && row.multName) totalBox.appendChild(el("div", "cr-unit", "×" + multOf(row)));
  else totalBox.appendChild(el("div", "cr-unit", "per unit " + money(unitCostOf(row))));
  top.appendChild(totalBox);

  const del = el("button", "icon-btn");
  del.type = "button";
  del.title = "ลบรายการนี้";
  del.setAttribute("aria-label", "ลบ " + (row.title || "รายการ"));
  del.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>';
  del.addEventListener("click", () => removeRow(section.key, index));
  top.appendChild(del);
  wrap.appendChild(top);

  const ctrl = el("div", "cr-ctrl");

  (row.params || []).forEach((p) => {
    ctrl.appendChild(ctlField(
      p.label + (p.unit ? " (" + p.unit + ")" : ""),
      "p-" + tag + "-" + p.name,
      row.values[p.name],
      (v) => { row.values[p.name] = num(v, 0); }
    ));
  });

  if (section.key === "material") {
    if (!row.size1Fixed) {
      ctrl.appendChild(ctlField("Size ( 1 )", "s1-" + tag, row.size1, (v) => { row.size1 = num(v, 0); }, { min: 0 }));
    }
    ctrl.appendChild(ctlField("Quantity", "q-" + tag, row.qty, (v) => { row.qty = num(v, 0); }, { min: 0 }));
  } else if (section.key === "process") {
    ctrl.appendChild(ctlField("Quantity", "q-" + tag, row.qty, (v) => { row.qty = num(v, 0); }, { min: 0 }));
    ctrl.appendChild(ctlField("Mult. Val.", "mv-" + tag, row.multVal, (v) => { row.multVal = num(v, 0); }, { min: 0 }));
  } else if (section.key === "fastener") {
    ctrl.appendChild(ctlField("Size ( 1 )", "s1-" + tag, row.size1, (v) => { row.size1 = num(v, 0); }, { min: 0 }));
    ctrl.appendChild(ctlField("Size ( 2 )", "s2-" + tag, row.size2, (v) => { row.size2 = num(v, 0); }, { min: 0 }));
    ctrl.appendChild(ctlField("Quantity", "q-" + tag, row.qty, (v) => { row.qty = num(v, 0); }, { min: 0 }));
  } else {
    ctrl.appendChild(ctlField("Quantity", "q-" + tag, row.qty, (v) => { row.qty = num(v, 0); }, { min: 0 }));
    ctrl.appendChild(ctlField("PVF", "pvf-" + tag, row.pvf, (v) => { row.pvf = Math.max(num(v, 1), 1); }, { min: 1, step: 1 }));
  }

  const missing = (row.params || []).filter((p) => !row.values[p.name]);
  if (missing.length > 0) {
    ctrl.appendChild(readOnlyField("Needs input", missing.map((p) => p.label).join(", "), true));
  }

  if (ctrl.childElementCount > 0) wrap.appendChild(ctrl);
  return wrap;
}

function updateRowTotals() {
  SECTIONS.forEach((section) => {
    state.rows[section.key].forEach((row, index) => {
      const node = $("rowTotal-" + section.key + "-" + index);
      if (node) node.textContent = money(rowTotal(row));
    });
  });
}

function removeRow(key, index) {
  const row = state.rows[key][index];
  state.rows[key].splice(index, 1);
  renderCost();
  markUnsaved();
  toast("ลบแล้ว: " + (row ? row.title : "รายการ"));
}

// ------------------------------------------------------------
// Catalog modal
// ------------------------------------------------------------
function openCatalog(catalogKey, targetKey) {
  state.modal.catalog = catalogKey;
  state.modal.target = targetKey;
  const def = SECTIONS.find((s) => s.catalog === catalogKey);
  $("modalTitle").textContent = def.catalogLabel + " Cost Catalog";
  $("modalSub").textContent = "Select an item to add to the current Part";
  $("inpCatalogSearch").value = "";
  renderChips();
  renderCatalogList();
  $("catalogModal").classList.add("is-open");
  $("btnCloseModal").focus();
}

function closeCatalog() {
  $("catalogModal").classList.remove("is-open");
}

function renderChips() {
  const box = $("catalogChips");
  box.textContent = "";
  SECTIONS.forEach((s) => {
    const chip = el("button", "chip", s.catalogLabel);
    chip.type = "button";
    chip.setAttribute("aria-pressed", String(s.catalog === state.modal.catalog));
    chip.addEventListener("click", () => {
      state.modal.catalog = s.catalog;
      state.modal.target = s.key;
      renderChips();
      renderCatalogList();
    });
    box.appendChild(chip);
  });
}

function catalogPriceLabel(item, kind) {
  if (kind === "tooling") return money(item.cost);
  if (!item.formula) return "—";
  if (item.params && item.params.length > 0) return "variable";
  return money(evaluateFormula(item.formula, {}, item.c1, item.c2));
}

function renderCatalogList() {
  const list = $("catalogList");
  list.textContent = "";
  const kind = state.modal.catalog;
  const q = $("inpCatalogSearch").value.trim().toLowerCase();

  const items = (state.catalog[kind] || []).filter((item) => {
    if (!q) return true;
    return [item.title, item.category, item.supplier, item.type, item.process_title]
      .filter(Boolean).join(" ").toLowerCase().includes(q);
  });

  if (items.length === 0) {
    list.appendChild(el("div", "empty", "ไม่พบรายการที่ค้นหา"));
    return;
  }

  const LIMIT = 200;
  items.slice(0, LIMIT).forEach((item) => {
    const row = el("div", "cat-row");

    const main = el("div");
    main.appendChild(el("div", "t", item.title || "(ไม่มีชื่อ)"));
    const bits = [item.category, item.supplier, item.process_title, item.type].filter(Boolean);
    if (bits.length > 0) main.appendChild(el("div", "s", bits.join(" · ")));
    if (item.params && item.params.length > 0) {
      const vars = el("div", "vars");
      item.params.forEach((p) => vars.appendChild(el("span", "var-chip", p.label || p.name)));
      main.appendChild(vars);
    }
    row.appendChild(main);

    const k1 = el("div", "k");
    k1.appendChild(el("b", null, catalogPriceLabel(item, kind)));
    k1.appendChild(document.createTextNode(kind === "tooling" ? "tool cost" : "catalog cost"));
    row.appendChild(k1);

    const k2 = el("div", "k right");
    k2.textContent = item.unit || "—";
    row.appendChild(k2);

    const add = el("button", "btn btn-sm btn-primary", "Add");
    add.type = "button";
    add.addEventListener("click", () => addCatalogItem(item));
    row.appendChild(add);

    list.appendChild(row);
  });

  if (items.length > LIMIT) {
    list.appendChild(el("div", "empty",
      "แสดง " + LIMIT + " จาก " + items.length + " รายการ — ค้นหาเพิ่มเพื่อกรองให้แคบลง"));
  }
}

function addCatalogItem(item) {
  const kind = state.modal.catalog;
  const target = state.modal.target;

  if (kind === "tooling") {
    state.rows.tooling.push({
      kind: "tooling",
      title: item.title,
      toolCost: num(item.cost, 0),
      qty: 1,
      pvf: num(item.default_pvf, 3000) || 3000,
      fracInc: 1,
      unit: item.unit,
      use: item.process_title || "",
    });
  } else {
    const values = {};
    (item.params || []).forEach((p) => { values[p.name] = 0; });
    const row = {
      kind: target,
      title: item.title,
      category: item.category,
      supplier: item.supplier,
      unit: item.unit,
      formula: item.formula,
      c1: item.c1,
      c2: item.c2,
      params: item.params || [],
      values: values,
      qty: 1,
      size1: 0,
      size2: 0,
      multName: "",
      multVal: 0,
      use: "",
    };
    if (target === "material") {
      row.size1Fixed = (item.params || []).some((p) => p.name === "Size1");
      row.areaName = item.area_name || "";
      row.area = num(item.area, 0);
      row.length = num(item.length, 0);
      row.density = num(item.density, 0);
    }
    if (target === "process") {
      row.toolingRequired = !!item.tooling_required;
      row.multType = item.multiplier_type || "";
    }
    state.rows[target].push(row);
  }

  renderCost();
  closeCatalog();
  markUnsaved();
  toast("เพิ่ม " + item.title + " แล้ว");
}

// ------------------------------------------------------------
// BOM page
// ------------------------------------------------------------
function renderAssemblyList() {
  const box = $("assemblyList");
  box.textContent = "";
  Object.keys(state.bom).forEach((name) => {
    const btn = el("button", "list-btn", name + "  (" + partsOf(name).length + ")");
    btn.type = "button";
    btn.setAttribute("aria-pressed", String(name === state.assembly));
    btn.addEventListener("click", () => {
      state.assembly = name;
      $("selAssembly").value = name;
      fillParts();
      renderAssemblyList();
      renderBom();
    });
    box.appendChild(btn);
  });
}

function renderBom() {
  $("bomAssemblyTitle").textContent = state.assembly;
  const q = $("inpBomSearch").value.trim().toLowerCase();
  const all = partsOf(state.assembly);
  const rows = all.filter((r) => !q || (r[0] + " " + r[1]).toLowerCase().includes(q));
  $("bomCount").textContent = rows.length + " / " + all.length + " parts";

  const body = $("bomRows");
  body.textContent = "";
  if (rows.length === 0) {
    const tr = el("tr");
    const td = el("td", "empty", "ไม่พบ part ที่ค้นหา");
    td.colSpan = 4;
    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }

  rows.forEach((r) => {
    const done = state.savedEntries.some((e) => e.pn === r[0]);
    const tr = el("tr");
    tr.appendChild(el("td", "mono", r[0]));
    tr.appendChild(el("td", null, r[1]));
    const cat = el("td");
    cat.appendChild(el("span", "tag " + (r[2] === "BODY" ? "tag-body" : "tag-frame"), r[2]));
    tr.appendChild(cat);
    const act = el("td");
    if (done) act.appendChild(el("span", "pill", "มีต้นทุนแล้ว"));
    const btn = el("button", "btn btn-sm", "Use in Cost Entry");
    btn.type = "button";
    btn.addEventListener("click", () => {
      showPage("entry");
      $("selPart").value = r[0];
      syncPart();
    });
    act.appendChild(btn);
    tr.appendChild(act);
    body.appendChild(tr);
  });
}

// ------------------------------------------------------------
// Catalog page
// ------------------------------------------------------------
function renderCatalogPage() {
  const grid = $("catalogGrid");
  grid.textContent = "";
  SECTIONS.forEach((s) => {
    const count = (state.catalog[s.catalog] || []).length;
    const card = el("div", "catalog-item");
    const info = el("div");
    info.appendChild(el("div", "ctitle", s.catalogLabel));
    info.appendChild(el("div", "csub", count.toLocaleString("en-US") + " entries"));
    card.appendChild(info);
    const btn = el("button", "btn btn-sm", "Launch");
    btn.type = "button";
    btn.addEventListener("click", () => openCatalog(s.catalog, s.key));
    card.appendChild(btn);
    grid.appendChild(card);
  });
}

// ------------------------------------------------------------
// Part <-> Sheet tab matching
// BOM ใช้เลข part คนละแบบกับชีต (FR 00230-AA vs AA 30001-1)
// จึงต้องให้ผู้ใช้ยืนยันการจับคู่ก่อน Sync
// ------------------------------------------------------------

function normKey(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** คะแนนความคล้าย 0-1 ระหว่างชื่อ part ของ BOM กับชื่อในชีต */
function similarity(a, b) {
  const x = normKey(a), y = normKey(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (y.includes(x) || x.includes(y)) return 0.9;

  // token overlap
  const ta = new Set(x.split(" "));
  const tb = new Set(y.split(" "));
  let hit = 0;
  ta.forEach((t) => { if (tb.has(t)) hit += 1; });
  return ta.size ? hit / ta.size : 0;
}

/** อ่านหัวข้อแถวของ tab (assembly / part / p-n) */
async function readTabHeader(sheetId) {
  const res = await sheetsGet("/values/" + encodeURIComponent("'" + sheetId.title + "'") + "!A1:H8");
  const rows = res.values || [];
  const pick = (r, c) => {
    const row = rows[r] || [];
    return (row[c] || "").trim();
  };
  return {
    tab: sheetId.title,
    system: pick(1, 2),
    assembly: pick(2, 2),
    part: pick(3, 2),
    pnBase: pick(4, 2),
    suffix: pick(5, 2),
  };
}

/** สแกนชีตแล้วเสนอการจับคู่ให้ผู้ใช้ยืนยัน */
async function scanForMatching() {
  if (!requireToken()) return;
  if (state.matchBusy) return;
  state.matchBusy = true;
  const btn = $("btnMatchSheet");
  if (btn) btn.disabled = true;
  $("missingSummary").textContent = "กำลังอ่านหัวข้อ tab ทั้งหมด...";

  try {
    const tabs = await listTabs();
    // ข้าม tab ที่ไม่ใช่ของ part (ไม่ขึ้นต้นด้วย AA + เลข)
    const partTabs = tabs.filter((t) => /^AA\s*\d/.test(t.title.trim()));
    const headers = [];
    for (let i = 0; i < partTabs.length; i += 1) {
      try {
        headers.push(await readTabHeader(partTabs[i]));
      } catch (err) { /* tab อ่านไม่ได้ข้ามไป */ }
      if (i % 10 === 9) {
        $("missingSummary").textContent = "อ่านแล้ว " + (i + 1) + "/" + partTabs.length;
      }
    }

    // เสนอคู่ที่ดีที่สุดต่อ part ใน BOM
    const proposals = [];
    Object.keys(state.bom).forEach((assembly) => {
      partsOf(assembly).forEach((r) => {
        let best = null, bestScore = 0;
        headers.forEach((h) => {
          // ให้น้ำหนักชื่อ assembly ด้วย เพราะตรงกันแม่นกว่า
          const asmScore = similarity(assembly, h.assembly);
          const partScore = similarity(r[1], h.part);
          const score = partScore * 0.65 + asmScore * 0.35;
          if (score > bestScore) { bestScore = score; best = h; }
        });
        proposals.push({
          pn: r[0],
          bomName: r[1],
          assembly: assembly,
          sheetTab: bestScore >= 0.45 ? best.tab : "",
          sheetName: bestScore >= 0.45 ? best.part : "",
          assemblySheet: best ? best.assembly : "",
          score: Math.round(bestScore * 100),
        });
      });
    });

    state.sheetHeaders = headers;
    state.matchProposals = proposals;
    renderMatchTable();
    $("matchPanel").hidden = false;
    const good = proposals.filter((p) => p.sheetTab).length;
    $("missingSummary").textContent = "อ่าน " + headers.length + " tabs — เดาการจับคู่ได้ " +
      good + "/" + proposals.length + " parts (ต้องตรวจและบันทึกด้านล่าง)";
  } catch (err) {
    $("missingSummary").textContent = "อ่านไม่สำเร็จ: " + err.message;
  } finally {
    state.matchBusy = false;
    if (btn) btn.disabled = false;
  }
}

function renderMatchTable() {
  const body = $("matchRows");
  if (!body) return;
  body.textContent = "";
  (state.matchProposals || []).forEach((p, i) => {
    const tr = el("tr");

    const c1 = el("td", "mono", p.pn);
    tr.appendChild(c1);
    tr.appendChild(el("td", null, p.bomName));
    tr.appendChild(el("td", null, p.assembly));

    const c4 = el("td");
    const sel = document.createElement("select");
    sel.id = "matchSel-" + i;
    const none = el("option", null, "— ไม่ผูก —");
    none.value = "";
    sel.appendChild(none);
    (state.sheetHeaders || []).forEach((h) => {
      const o = el("option", null, h.tab + "  —  " + h.part);
      o.value = h.tab;
      if (h.tab === p.sheetTab) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener("change", () => {
      state.matchProposals[i].sheetTab = sel.value;
      state.matchProposals[i].chosen = sel.value !== "";
    });
    c4.appendChild(sel);
    tr.appendChild(c4);

    const c5 = el("td");
    const badge = el("span", "tag " + (p.score >= 70 ? "tag-frame" : "tag-wait"),
      p.score + "%");
    c5.appendChild(badge);
    if (p.sheetName) c5.appendChild(document.createTextNode(" " + p.sheetName.slice(0, 28)));
    tr.appendChild(c5);

    body.appendChild(tr);
  });
}

/** บันทึกการจับคู่ที่ผู้ใช้ยืนยันแล้ว */
function saveMatches() {
  const map = {};
  (state.matchProposals || []).forEach((p) => {
    if (p.sheetTab) map[p.pn] = p.sheetTab;
  });
  try {
    localStorage.setItem(STORAGE_KEYS.partMap, JSON.stringify(map));
  } catch (err) {
    toast("บันทึกไม่สำเร็จ: " + err.message);
    return;
  }
  state.partMap = map;
  toast("บันทึกการจับคู่ " + Object.keys(map).length + " parts แล้ว — Sync จะใช้ตารางนี้");
  $("matchPanel").hidden = true;
}

// ------------------------------------------------------------
// Missing Cost — สถานะจริงจากชีต
// ------------------------------------------------------------

/** ชื่อ tab ที่ Sheet ใช้ สำหรับ part หนึ่งชิ้น */
function sheetTabNameForPart(pn) {
  return ("AA " + pn).trim();
}

/** เช็คว่า tab ของ part มีต้นทุนจริงหรือยัง (อ่านค่า I ของแถวแรกที่มีชื่อ) */
async function tabHasCost(tabName) {
  const { rows, layout } = await readTab(tabName);
  const L = layout.material || layout.process;
  if (!L) return { exists: true, costed: false, rows: 0 };
  let count = 0;
  SECTIONS.forEach((s) => {
    const lay = layout[s.key];
    if (!lay) return;
    for (let r = lay.dataStart; r <= lay.dataEnd; r += 1) {
      if (cell(rows, r, "C").trim()) count += 1;
    }
  });
  return { exists: true, costed: count > 0, rows: count };
}

async function scanSheetForMissing() {
  if (!requireToken()) return;
  if (state.scanBusy) return;
  state.scanBusy = true;
  const btn = $("btnScanSheet");
  if (btn) btn.disabled = true;
  $("missingSummary").textContent = "กำลังสแกน...";

  try {
    const tabs = await listTabs();
    const names = new Set(tabs.map((t) => t.title.trim()));
    const out = {};

    // รวม P/N ทั้งหมดจาก BOM
    const wanted = [];
    Object.keys(state.bom).forEach((assembly) => {
      partsOf(assembly).forEach((r) => wanted.push({ assembly, pn: r[0], name: r[1] }));
    });

    for (let i = 0; i < wanted.length; i += 1) {
      const w = wanted[i];
      const tab = sheetTabNameForPart(w.pn);
      if (!names.has(tab)) { out[w.pn] = { tab, status: "no-tab" }; continue; }
      try {
        const res = await tabHasCost(tab);
        out[w.pn] = { tab, status: res.costed ? "costed" : "empty", rows: res.rows };
      } catch (err) {
        out[w.pn] = { tab, status: "error", message: err.message };
      }
      if (i % 5 === 4) $("missingSummary").textContent = "กำลังสแกน " + (i + 1) + "/" + wanted.length;
    }

    state.missing = out;
    renderMissing();
    const missingCount = Object.values(out).filter((x) => x.status !== "costed").length;
    $("missingSummary").textContent = "สแกนแล้ว " + wanted.length + " parts — ขาดต้นทุน " + missingCount;
  } catch (err) {
    $("missingSummary").textContent = "สแกนไม่สำเร็จ: " + err.message;
    toast("สแกนไม่สำเร็จ: " + err.message);
  } finally {
    state.scanBusy = false;
    if (btn) btn.disabled = false;
  }
}

function renderMissing() {
  const body = $("missingRows");
  if (!body) return;
  body.textContent = "";
  const q = ($("inpMissingSearch") ? $("inpMissingSearch").value : "").trim().toLowerCase();

  const rows = [];
  Object.keys(state.bom).forEach((assembly) => {
    partsOf(assembly).forEach((r) => {
      const info = state.missing ? state.missing[r[0]] : null;
      const local = state.savedEntries.some((e) => e.pn === r[0]);
      let status = local ? "local" : (info ? info.status : "unknown");
      if (status === "costed") status = "costed";
      if (status === "local" || status === "costed") return;   // มีต้นทุนแล้ว ไม่นับ
      if (q && !(r[0] + " " + r[1]).toLowerCase().includes(q)) return;
      rows.push({ assembly, pn: r[0], name: r[1], status });
    });
  });

  $("missingCount").textContent = state.missing
    ? rows.length + " รายการยังไม่มีต้นทุน" : "กด Scan เพื่อตรวจจากชีต";

  if (rows.length === 0) {
    const tr = el("tr");
    const td = el("td", "empty", state.missing ? "ทุก part มีต้นทุนแล้ว" : "ยังไม่ได้สแกน — กด Scan Google Sheets");
    td.colSpan = 5;
    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }

  const label = { "no-tab": "ยังไม่มี tab", empty: "tab ว่าง", error: "อ่านไม่ได้", unknown: "ยังไม่รู้" };
  rows.forEach((r) => {
    const tr = el("tr");
    tr.appendChild(el("td", null, r.assembly));
    tr.appendChild(el("td", "mono", r.pn));
    tr.appendChild(el("td", null, r.name));
    const st = el("td");
    st.appendChild(el("span", "tag tag-wait", label[r.status] || r.status));
    tr.appendChild(st);
    const act = el("td");
    const btn = el("button", "btn btn-sm", "Use in Cost Entry");
    btn.type = "button";
    btn.addEventListener("click", () => {
      state.assembly = r.assembly;
      $("selAssembly").value = r.assembly;
      fillParts();
      showPage("entry");
      $("selPart").value = r.pn;
      syncPart();
    });
    act.appendChild(btn);
    tr.appendChild(act);
    body.appendChild(tr);
  });
}

// ------------------------------------------------------------
// Dashboard
// ------------------------------------------------------------
function renderDashboard() {
  const body = $("dashRows");
  body.textContent = "";
  let total = 0;
  state.savedEntries.forEach((e) => {
    total += num(e.extended);
    const tr = el("tr");
    tr.appendChild(el("td", null, e.assembly));
    tr.appendChild(el("td", "mono", e.pn));
    tr.appendChild(el("td", null, e.partName));
    tr.appendChild(el("td", "num", money(e.partCost)));
    tr.appendChild(el("td", "num", money(e.extended)));
    body.appendChild(tr);
  });
  if (state.savedEntries.length === 0) {
    const tr = el("tr");
    const td = el("td", "empty", "ยังไม่มีรายการที่บันทึกไว้ในเครื่องนี้");
    td.colSpan = 5;
    tr.appendChild(td);
    body.appendChild(tr);
  }
  let bomParts = 0;
  Object.keys(state.bom).forEach((a) => { bomParts += partsOf(a).length; });
  $("dashCount").textContent = state.savedEntries.length + " entries";
  $("dashTotal").textContent = money(total);
  $("dashParts").textContent = String(state.savedEntries.length);
  $("dashBomParts").textContent = String(bomParts);
  $("dashCoverage").textContent = bomParts
    ? Math.round((state.savedEntries.length / bomParts) * 100) + "%" : "0%";
}

// ------------------------------------------------------------
// Entry actions
// ------------------------------------------------------------
function markUnsaved() {
  $("saveStateText").textContent = "Unsaved changes";
  $("saveState").className = "pill pill-idle";
}

function markSaved() {
  $("saveStateText").textContent = "Saved locally";
  $("saveState").className = "pill";
}

function currentEntry() {
  const t = totals();
  return {
    assembly: state.assembly,
    pn: state.partNo,
    partName: $("inpPartName").value,
    baseNo: $("inpBaseNo").value,
    suffix: $("inpSuffix").value || "AA",
    targetTab: $("inpTargetTab") ? $("inpTargetTab").value.trim() : "",
    system: $("selSystem") ? $("selSystem").value : "Body&Frame",
    makeBuy: $("selMakeBuy").value,
    details: $("inpDetails").value,
    enteredBy: $("inpEnteredBy").value,
    revision: $("inpRevision").value,
    qty: t.qty,
    partCost: t.part,
    extended: t.extended,
    rows: JSON.parse(JSON.stringify(state.rows)),
    savedAt: new Date().toISOString(),
  };
}

function saveEntry() {
  const entry = currentEntry();
  if (entry.partCost <= 0) { toast("ยังไม่มีรายการต้นทุนให้บันทึก"); return false; }
  const i = state.savedEntries.findIndex((e) => e.pn === entry.pn);
  if (i >= 0) state.savedEntries[i] = entry; else state.savedEntries.push(entry);
  try {
    localStorage.setItem(STORAGE_KEYS.entries, JSON.stringify(state.savedEntries));
  } catch (err) {
    toast("บันทึกไม่สำเร็จ: " + err.message);
    return false;
  }
  markSaved();
  toast("บันทึก " + entry.pn + " ในเครื่องแล้ว");
  return true;
}

function loadEntry(entry) {
  SECTIONS.forEach((s) => { state.rows[s.key] = (entry.rows[s.key] || []).slice(); });
  $("inpQty").value = entry.qty || 1;
  $("inpSuffix").value = entry.suffix || "AA";
  if (entry.details) $("inpDetails").value = entry.details;
  if (entry.revision) $("inpRevision").value = entry.revision;
  renderCost();
}

function resetEntry() {
  SECTIONS.forEach((s) => { state.rows[s.key] = []; });
  $("inpQty").value = 1;
  $("inpSuffix").value = "AA";
  $("inpDetails").value = "Current design";
  $("inpRevision").value = "R01";
  renderCost();
  markUnsaved();
  toast("ล้างรายการแล้ว");
}

function addSample() {
  const cats = state.catalog;
  const m = (cats.materials || []).find((i) => (i.params || []).some((p) => p.name === "Size1"));
  const simple = (cats.processes || []).find((i) => (i.params || []).length === 0);
  const withMult = (cats.processes || []).find((i) => i.multiplier_type);
  const f = (cats.fasteners || [])[0];
  const t = (cats.tooling || [])[0];
  const mult = (cats.multipliers || []).find((x) => x.type);

  if (m) {
    const values = {};
    m.params.forEach((pp) => { values[pp.name] = 1; });
    state.rows.material.push({
      kind: "material", title: m.title, category: m.category, supplier: m.supplier,
      unit: m.unit, formula: m.formula, c1: m.c1, c2: m.c2, params: m.params,
      values, qty: 1, size1: 0, size2: 0, size1Fixed: true,
      areaName: "", area: 0, length: 0, density: 0, use: "Frame tube",
    });
  }
  [simple, withMult].filter(Boolean).forEach((proc) => {
    const values = {};
    (proc.params || []).forEach((pp) => { values[pp.name] = 1; });
    const row = {
      kind: "process", title: proc.title, category: proc.category, unit: proc.unit,
      formula: proc.formula, c1: proc.c1, c2: proc.c2, params: proc.params || [],
      values, qty: 1, size1: 0, size2: 0,
      multName: "", multVal: 1, multType: proc.multiplier_type || "", use: "",
    };
    if (proc === withMult && mult) {
      row.multName = mult.type;
      row.multVal = num(mult.value, 1);
    }
    state.rows.process.push(row);
  });
  if (f) {
    const values = {};
    f.params.forEach((pp) => { values[pp.name] = 0; });
    state.rows.fastener.push({
      kind: "fastener", title: f.title, category: f.category, supplier: f.supplier,
      unit: f.unit, formula: f.formula, c1: f.c1, c2: f.c2, params: f.params,
      values, qty: 4, size1: 0, size2: 0, use: "",
    });
  }
  if (t) {
    state.rows.tooling.push({
      kind: "tooling", title: t.title, toolCost: num(t.cost, 0), qty: 0.07,
      pvf: num(t.default_pvf, 3000) || 3000, fracInc: 1,
      unit: t.unit, use: t.process_title || "",
    });
  }
  renderCost();
  markUnsaved();
  toast("เพิ่มตัวอย่างครบทั้ง 4 หมวดแล้ว");
}

// ------------------------------------------------------------
// Navigation
// ------------------------------------------------------------
function showPage(name) {
  document.querySelectorAll(".page").forEach((p) => { p.hidden = true; });
  const target = $("page-" + name);
  if (target) target.hidden = false;
  document.querySelectorAll(".nav-btn").forEach((b) => {
    if (b.dataset.page === name) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  if (name === "bom") { renderAssemblyList(); renderBom(); }
  if (name === "missing") renderMissing();
  if (name === "catalogs") renderCatalogPage();
  if (name === "dashboard") renderDashboard();
  if (name === "settings") { applySettingsToForm(); warnIfClientMismatch(); }
}

// ------------------------------------------------------------
// Google OAuth (Google Identity Services — token model)
// client_id เป็นค่าสาธารณะ ไม่ใช่ secret จึงอยู่ใน frontend ได้
// ------------------------------------------------------------
let tokenClient = null;

function loadGis() {
  return new Promise((resolve, reject) => {
    if (window.google) return resolve(window.google);
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.onload = () => (window.google ? resolve(window.google) : reject(new Error("GIS โหลดไม่สำเร็จ")));
    s.onerror = () => reject(new Error("โหลด Google Identity Services ไม่สำเร็จ"));
    document.head.appendChild(s);
  });
}

async function initTokenClient() {
  if (tokenClient) return tokenClient;
  const g = await loadGis();
  tokenClient = g.accounts.oauth2.initTokenClient({
    client_id: state.settings.clientId,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    include_granted_scopes: true,
    callback: (resp) => {
      if (resp.error) {
        showAuthError(resp.error, resp.error_description || "");
        return;
      }
      state.token = resp.access_token;
      try { sessionStorage.setItem(STORAGE_KEYS.token, resp.access_token); } catch (e) { /* ignore */ }
      clearAuthError();
      // เชื่อมผ่านแล้ว = client id ที่ใช้อยู่ใช้งานได้จริง ไม่ต้องเตือนอีก
      if (state.settings.clientId !== GOOGLE_CLIENT_ID) {
        state.workingClientId = state.settings.clientId;
        try { localStorage.setItem("fsae.workingClientId", state.settings.clientId); } catch (e) { /* ignore */ }
      }
      $("clientIdWarn").hidden = true;
      updateAuthUi(true);
      toast("เชื่อม Google Sheets แล้ว");
    },
    error_callback: (err) => {
      // GIS ส่ง error ที่เกิดระหว่างเปิด popup มาทางนี้
      // ถ้าไม่มี callback นี้ error จะหายเงียบไป
      showAuthError(err.type || "unknown", err.message || String(err));
    },
  });
  return tokenClient;
}

/** แสดงสาเหตุที่ล็อกอินไม่สำเร็จให้ชัด เพราะ error ของ Google มักกำกวม */
const AUTH_HINTS = {
  origin_mismatch: "Origin ไม่ตรง — ต้องเพิ่ม URL ของเว็บนี้ใน Authorized JavaScript origins",
  access_denied: "ถูกปฏิเสธสิทธิ์ หรือบัญชีนี้ไม่ได้อยู่ในรายชื่อ Test user ของ OAuth client",
  "popup_closed_by_user": "ปิดหน้าต่างล็อกอินก่อนเสร็จ",
  consent_redirect: "ต้องยืนยันสิทธิ์ที่หน้าจอ Google — กดยอมรับแล้วกลับมากดอีกครั้ง",
  network_error: "ต่อ Google ไม่ได้ — ตรวจอินเทอร์เน็ต",
  invalid_client: "Client ID ไม่ถูกต้อง หรือยังไม่ได้เพิ่ม Authorized JavaScript origins",
  redirect_uri_mismatch: "ต้องลงทะเบียน redirect URI ในช่อง Authorized redirect URIs (ไม่ใช่ JavaScript origins) และต้องมี / ท้าย",
  403: "สิทธิ์ไม่พอ — ถ้าบัญชีอยู่ในโหมด Testing ต้องเพิ่มอีเมลเป็น Test user ก่อน",
};

/** วิธีแก้เฉพาะ error — แสดงเฉพาะขั้นตอนที่เกี่ยวกับปัญหานั้น */
const AUTH_TIPS = {
  popup_closed: [
    "กด Sign in with Google แล้วอย่าเพิ่งปิดหน้าต่าง popup ที่เด้งขึ้น — ต้องเลือกบัญชีให้จบ",
    "ถ้าหน้าต่างเด้งแล้วหายเองทันที แปลว่าเบราว์เซอร์บล็อก popup — ให้กดไอคอนล็อกที่แถบที่อยู่",
    "แล้วเลือก Always allow popups แล้วลองใหม่",
    "ลองในหน้าต่างปกติ (ไม่ใช่โหมดไม่ระบุตัวตน)",
  ],
  origin_mismatch: [
    "ต้องเพิ่ม URL ของเว็บนี้ใน Authorized JavaScript origins ของ OAuth client",
    "ต้องเป็น client ตัวเดียวกับที่แสดงใน Settings",
    "เขียนตรง ๆ ไม่มีเครื่องหมาย / ท้าย",
  ],
  access_denied: [
    "ถูกปฏิเสธสิทธิ์ หรือบัญชีนี้ยังไม่ได้อยู่ในรายชื่อ Test user",
    "ถ้า OAuth consent screen อยู่สถานะ Testing ให้เพิ่มอีเมลตัวเองเป็น Test user",
  ],
  consent_redirect: [
    "ต้องกดยอมรับสิทธิ์ที่หน้าจอ Google ก่อน",
    "พอกดอนุญาตแล้วกลับมาที่เว็บ ต้องกด Sign in อีกครั้ง",
  ],
  redirect_uri_mismatch: [
    "ต้องเพิ่มในช่อง Authorized redirect URIs (คนละช่องกับ JavaScript origins)",
    "ค่าต้องตรงเป๊ะตามนี้ มีเครื่องหมาย / ท้าย: " + location.origin + "/",
    "โค้ดชุดนี้ใช้ redirect_uri = " + location.origin + "/",
  ],
  network_error: ["ตรวจอินเทอร์เน็ต แล้วลองใหม่"],
  invalid_client: ["Client ID ไม่ถูกต้อง หรือยังไม่ได้เพิ่ม Authorized JavaScript origins"],
};

function showAuthError(code, detail) {
  const hint = AUTH_HINTS[code] || AUTH_HINTS[String(detail).slice(0, 3)] || "";
  const msg = "ล็อกอินไม่สำเร็จ [" + code + "]" + (hint ? " — " + hint : "");
  toast(msg);
  const badge = $("authBadge");
  if (badge) {
    badge.textContent = "ล็อกอินไม่สำเร็จ: " + code;
    badge.classList.add("is-error");
  }
  const panel = $("authError");
  if (panel) {
    panel.hidden = false;
    $("authErrorMsg").textContent = msg + (detail ? " (" + detail + ")" : "");
    // สลับขั้นตอนให้ตรงกับ error ที่เกิดจริง
    const tips = AUTH_TIPS[code] || null;
    const ul = panel.querySelector("ul");
    if (ul) {
      ul.textContent = "";
      if (tips) {
        ul.hidden = false;
        tips.forEach((t) => { const li = document.createElement("li"); li.textContent = t; ul.appendChild(li); });
      } else {
        ul.hidden = true;
      }
    }
  }
  // popup โดนบล็อกเป็นปัญหาที่พบบ่อยที่สุดบนเบราว์เซอร์มือถือและ Safari
  // เสนอทางเลือกแบบ redirect ทั้งหน้า ซึ่งไม่ต้องใช้ popup เลย
  if (code === "popup_closed" || code === "popup") {
    const alt = $("authAlt");
    if (alt) alt.hidden = false;
  }
  console.warn("[auth]", code, detail);
}

function clearAuthError() {
  const panel = $("authError");
  if (panel) panel.hidden = true;
  const badge = $("authBadge");
  if (badge) badge.classList.remove("is-error");
}

/**
 * ทางเลือกแบบ redirect ทั้งหน้า — ใช้เมื่อ popup ถูกเบราว์เซอร์บล็อก
 * ใช้ Authorization Code + PKCE จึงไม่ต้องมี client secret
 * ข้อดี: ทำงานได้ทุกเบราว์เซอร์ แม้ปิด popup ไว้
 */
async function signInWithRedirect() {
  const clientId = (state.settings.clientId || "").trim();
  if (!clientId) { toast("กรอก OAuth Client ID ใน Settings ก่อน"); return; }

  const redirectUri = location.origin + "/";
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const stateNonce = base64url(crypto.getRandomValues(new Uint8Array(8)));

  sessionStorage.setItem("fsae.pkce.verifier", verifier);
  sessionStorage.setItem("fsae.oauth.state", stateNonce);

  const qs = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/spreadsheets",
    code_challenge: challenge,
    code_challenge_method: "S256",
    include_granted_scopes: "true",
    access_type: "offline",
    prompt: "consent",
    state: stateNonce,
  });
  location.assign("https://accounts.google.com/o/oauth2/v2/auth?" + qs.toString());
}

function base64url(bytes) {
  let bin = "";
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i += 1) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** เรียกหลังกลับจากหน้า Google — แลก code เป็น token */
async function completeRedirectSignIn() {
  const params = new URLSearchParams(location.search);
  const code = params.get("code");
  if (!code) return false;

  // กัน CSRF
  const savedState = sessionStorage.getItem("fsae.oauth.state");
  if (!savedState || params.get("state") !== savedState) {
    toast("state ไม่ตรง — ยกเลิกคำขอ");
    return false;
  }
  const verifier = sessionStorage.getItem("fsae.pkce.verifier");
  const err = params.get("error");
  if (err) { showAuthError(err, params.get("error_description") || ""); return false; }
  if (!verifier) { toast("ไม่พบ PKCE verifier"); return false; }

  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: state.settings.clientId,
        code: code,
        code_verifier: verifier,
        grant_type: "authorization_code",
        redirect_uri: location.origin + "/",
      }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      showAuthError(data.error || String(res.status), data.error_description || "");
      return false;
    }
    state.token = data.access_token;
    try { sessionStorage.setItem(STORAGE_KEYS.token, data.access_token); } catch (e) { /* ignore */ }
    $("clientIdWarn").hidden = true;
    updateAuthUi(true);
    // ล้าง query string ไม่ให้ refresh แล้วแลก token ซ้ำ
    history.replaceState({}, "", location.origin + "/");
    toast("เชื่อม Google Sheets แล้ว");
    return true;
  } catch (e) {
    showAuthError("network", e.message || String(e));
    return false;
  }
}

function requireToken() {
  if (!state.token) { toast("กด Sign in with Google ก่อน"); return false; }
  return true;
}

function updateAuthUi(signedIn) {
  const btn = $("btnAuth");
  if (btn) btn.textContent = signedIn ? "Sign out" : "Sign in with Google";
  const badge = $("authBadge");
  if (badge) badge.textContent = signedIn ? "เชื่อม Sheet แล้ว" : "ยังไม่ได้เชื่อม";
  const who = $("authClient");
  if (who) {
    const cid = (state.settings.clientId || "");
    who.textContent = cid ? cid.slice(0, 12) + "\u2026" + cid.slice(-6) : "";
    who.title = cid;
  }
}

async function sheetsGet(path, params) {
  const base = "https://sheets.googleapis.com/v4/spreadsheets/" + state.settings.spreadsheetId;
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  const res = await fetch(base + path + qs, { headers: { Authorization: "Bearer " + state.token } });
  if (res.status === 401 || res.status === 403) {
    // token หมดอายุหรือไม่มีสิทธิ์ — ล้างทิ้งให้ผู้ใช้ล็อกอินใหม่
    state.token = null;
    tokenClient = null;
    try { sessionStorage.removeItem(STORAGE_KEYS.token); } catch (e) { /* ignore */ }
    updateAuthUi(false);
    showAuthError(String(res.status), "โทเคนหมดอายุหรือไม่มีสิทธิ์เขียนชีตนี้");
    throw new Error("โทเคนหมดอายุ — กด Sign in with Google อีกครั้ง");
  }
  if (!res.ok) throw new Error("Sheets API " + res.status + ": " + (await res.text()).slice(0, 180));
  return res.json();
}

async function listTabs() {
  const info = await sheetsGet("", { includeGridData: "false" });
  return (info.sheets || []).map((s) => s.properties);
}

// ------------------------------------------------------------
// Layout detection — ตำแหน่งแถวต่างกันในแต่ละ tab ต้องสแกนทุกครั้ง
// ------------------------------------------------------------
function colIndex(letter) {
  let n = 0;
  for (const ch of letter) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

async function readTab(tabName) {
  const safe = tabName.replace(/'/g, "''");
  const data = await sheetsGet("/values/" + encodeURIComponent("'" + safe + "'!A1:AE40"));
  const rows = data.values || [];

  const layout = {};
  SECTIONS.forEach((section) => {
    let headerRow = -1;
    for (let r = 0; r < rows.length; r += 1) {
      const a = (rows[r][0] || "").trim();
      const c = (rows[r][2] || "").trim().toUpperCase();
      if (a === "Item Order" && c === section.label) { headerRow = r; break; }
    }
    if (headerRow < 0) { layout[section.key] = null; return; }

    const subIdx = colIndex(section.subtotalCol);
    let subtotalRow = -1;
    for (let r = headerRow + 1; r < rows.length; r += 1) {
      const label = (rows[r][subIdx] || "").trim().toLowerCase();
      if (label === "sub total" || label === "subtotal") { subtotalRow = r; break; }
    }
    const dataStart = headerRow + 1;
    const dataEnd = subtotalRow > 0 ? subtotalRow - 1 : dataStart + 1;
    layout[section.key] = {
      headerRow: headerRow + 1,
      dataStart: dataStart + 1,
      dataEnd: dataEnd + 1,
      capacity: Math.max(dataEnd - dataStart + 1, 0),
      subtotalRow: subtotalRow + 1,
    };
  });

  return { rows, layout };
}

function cell(rows, rowNum, colLetter) {
  const r = rows[rowNum - 1] || [];
  const v = r[colIndex(colLetter)];
  return v === undefined ? "" : v;
}

// ------------------------------------------------------------
// แปลงข้อมูลเว็บ -> ช่องของ Sheet (เขียนแบบ batchUpdate เพื่อไม่ทับสูตรของทีม)
// ------------------------------------------------------------
function buildUpdates(entry, layout) {
  const updates = [];
  const put = (row, colLetter, value) => {
    updates.push({
      range: "'" + tabNameFor(entry).replace(/'/g, "''") + "'!" + colLetter + row,
      values: [[value === null || value === undefined ? "" : value]],
    });
  };

  put(1, "C", "King Mongkut's University of Technology Thonburi");
  put(2, "C", entry.system || "Body&Frame");
  put(3, "C", entry.assembly);
  put(4, "C", entry.partName);
  put(5, "C", entry.baseNo || entry.pn);
  put(6, "C", entry.suffix || "AA");
  put(7, "C", entry.details || "");
  put(2, "V", entry.qty || 1);

  const CLEAR = ["C", "G", "I", "K", "M", "O", "Q", "S", "U", "V", "W", "Y"];

  SECTIONS.forEach((section) => {
    const L = layout[section.key];
    if (!L) return;
    const rows = entry.rows[section.key] || [];

    for (let r = L.dataStart; r <= L.dataEnd; r += 1) {
      const row = rows[r - L.dataStart];

      if (!row) { CLEAR.forEach((c) => put(r, c, "")); continue; }

      const u = unitCostOf(row);
      put(r, "A", r - L.dataStart + 1);
      put(r, "C", row.title || "");
      put(r, "G", row.use || "");

      if (section.key === "material") {
        put(r, "I", round4(u));
        put(r, "K", round4(size1Of(row)));
        put(r, "M", row.unit || "");
        put(r, "O", round4(num(row.size2, 0)));
        put(r, "Q", row.unit || "");
        put(r, "S", row.areaName || "");
        put(r, "U", round4(num(row.area, 0)));
        put(r, "V", round4(num(row.length, 0)));
        put(r, "W", round4(num(row.density, 0)));
        put(r, "Y", num(row.qty, 0));
      } else if (section.key === "process") {
        put(r, "I", round4(u));
        put(r, "K", row.unit || "");
        put(r, "M", num(row.qty, 0));
        put(r, "O", row.multName || "");
        put(r, "Q", multOf(row));
      } else if (section.key === "fastener") {
        put(r, "I", round4(u));
        put(r, "K", round4(num(row.size1, 0)));
        put(r, "M", row.unit || "");
        put(r, "O", round4(num(row.size2, 0)));
        put(r, "Q", row.unit || "");
        put(r, "S", num(row.qty, 0));
      } else {
        put(r, "I", round4(num(row.toolCost, 0)));
        put(r, "K", row.unit || "");
        put(r, "M", num(row.qty, 0));
        put(r, "O", num(row.pvf, 0));
        put(r, "Q", round4(num(row.fracInc, 1) || 1));
        // ทีมพิมพ์ค่านี้ด้วยมือ — ตกลงกันแล้วว่าเว็บเขียนทับ
        put(r, "S", round4(rowTotal(row)));
      }
    }
  });

  return updates;
}

/** ชื่อ tab ที่ "ตั้งใจจะใช้" — เอารูปแบบ AA <base>-<suffix> */
function tabNameFor(entry) {
  const base = (entry.baseNo || entry.pn).trim();
  const suffix = (entry.suffix || "AA").trim();
  return ("AA " + base + (suffix ? "-" + suffix : "")).trim();
}

/**
 * หา tab ที่ตรงกับ part จริง โดยไม่เดาจากรูปแบบ
 * BOM กับชีตใช้ระบบเลขคนละแบบ (BOM = 'FR 00230-AA', ชีต = 'AA 30001-1')
 * จึงต้องลองหลายแบบและเทียบกับรายชื่อ tab ที่มีจริง
 */
function tabCandidates(entry) {
  const pn = (entry.pn || "").trim();
  const base = (entry.baseNo || "").trim();
  const suffix = (entry.suffix || "AA").trim();
  const nums = pn.match(/\d+/g) || [];
  const baseNums = base.match(/\d+/g) || [];

  const list = [];
  // 1) ผู้ใช้กำหนดเอง
  if (entry.targetTab) list.push(entry.targetTab);
  // 2) รูปแบบมาตรฐานของชีต
  //    P/N Base ในชีตคือ '30001-1' ซึ่งมี '-1' ติดมาแล้ว
  //    ส่วน Suffix ('AA') คือ revision ไม่ได้อยู่ในชื่อ tab
  if (base) {
    const looksLikeBase = /^\d{4,5}-\d+$/.test(base);
    list.push("AA " + (looksLikeBase ? base : base + (suffix ? "-" + suffix : "")));
  }
  // 3) เอาเลขใน P/N มาประกอบเอง
  if (baseNums.length >= 2) list.push("AA " + baseNums[0] + "-" + baseNums[1]);
  else if (baseNums.length === 1) list.push("AA " + baseNums[0]);
  if (nums.length >= 2) list.push("AA " + nums[0] + "-" + nums[1]);
  else if (nums.length === 1) list.push("AA " + nums[0] + "-" + suffix);
  // 4) ใช้ P/N ตรง ๆ
  list.push(pn);

  return [...new Set(list.filter((x) => x && x.trim() && x.trim() !== "AA"))];
}

async function resolveTab(entry, tabs) {
  const names = tabs.map((t) => t.title);
  const trimmed = names.map((n) => n.trim());

  // 0) ตารางจับคู่ที่ผู้ใช้ยืนยันไว้ — เชื่อถือที่สุด
  const mapped = state.partMap && state.partMap[entry.pn];
  if (mapped) {
    const i = trimmed.indexOf(String(mapped).trim());
    if (i >= 0) return { tab: names[i], from: "partMap" };
  }
  // 0b) ช่อง Target tab ที่พิมพ์เอง
  if (entry.targetTab) {
    const i = trimmed.indexOf(entry.targetTab.trim());
    if (i >= 0) return { tab: names[i], from: "targetTab" };
  }

  for (const cand of tabCandidates(entry)) {
    const i = trimmed.indexOf(cand.trim());
    if (i >= 0) return { tab: names[i], exact: cand.trim() === cand || true };
  }
  return null;
}

async function sheetsBatchUpdate(body) {
  const res = await fetch(
    "https://sheets.googleapis.com/v4/spreadsheets/" + state.settings.spreadsheetId + ":batchUpdate",
    {
      method: "POST",
      headers: { Authorization: "Bearer " + state.token, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) throw new Error("batchUpdate HTTP " + res.status + ": " + (await res.text()).slice(0, 180));
  return res.json();
}

async function ensureTab(entry) {
  const tabs = await listTabs();
  const hit = await resolveTab(entry, tabs);
  if (hit) return hit.tab;

  // ไม่เจอ — สร้างใหม่จากเทมเพลต โดยใช้ชื่อที่ผู้ใช้กำหนด หรือรูปแบบมาตรฐาน
  const wanted = (entry.targetTab || tabNameFor(entry)).trim();
  if (tabs.some((t) => t.title.trim() === wanted)) return wanted;

  const tpl = state.settings.templateTab.trim();
  const tplSheet = tabs.find((t) => t.title.trim() === tpl);
  if (!tplSheet) return null;

  await sheetsBatchUpdate({
    requests: [{
      duplicateSheet: {
        sourceSheetId: tplSheet.sheetId,
        newSheetName: wanted,
        insertSheetIndex: tabs.length,
      },
    }],
  });
  return wanted;
}

/**
 * เพิ่มแถวให้หมวดที่ยังไม่พอ โดยแทรกก่อนแถว Sub Total
 * Google Sheets จะขยับสูตรของทีมให้เองเมื่อ insertRows
 * @returns {Object} layout ใหม่หลังแทรก
 */
async function expandSection(tabName, section, need, layout) {
  const L = layout[section.key];
  if (!L || need <= L.capacity) return L;

  const add = need - L.capacity;
  // แทรกก่อนแถว Sub Total เพื่อไม่ให้สูตรรวมและ V1 ขยับผิดที่
  const startIndex = L.subtotalRow - 1;
  await sheetsBatchUpdate({
    requests: [{
      insertDimension: {
        range: { sheetId: await sheetIdOf(tabName), dimension: "ROWS", startIndex, endIndex: startIndex + add },
        inheritFromBefore: false,
      },
    }],
  });

  // อ่านใหม่เพื่อดึง layout ที่ขยับแล้ว
  const fresh = await readTab(tabName);
  return fresh.layout[section.key];
}

const sheetIdCache = {};

async function sheetIdOf(tabName) {
  if (sheetIdCache[tabName]) return sheetIdCache[tabName];
  const tabs = await listTabs();
  const hit = tabs.find((t) => t.title.trim() === tabName.trim());
  if (!hit) throw new Error("ไม่พบ tab '" + tabName + "'");
  sheetIdCache[tabName] = hit.sheetId;
  return hit.sheetId;
}

async function syncPush() {
  if (!requireToken()) return;
  if (!state.settings.clientId) { toast("กรอก OAuth Client ID ใน Settings ก่อน"); return; }
  const entry = currentEntry();
  if (entry.partCost <= 0) { toast("ยังไม่มีรายการต้นทุนให้ Sync"); return; }

  $("btnPush").disabled = true;
  try {
    const tab = await ensureTab(entry);
    if (!tab) {
      toast("สร้าง tab ใหม่ไม่สำเร็จ — ตรวจว่ามี tab เทมเพลต '" + state.settings.templateTab + "'");
      return;
    }
    let { layout } = await readTab(tab);
    const missing = SECTIONS.filter((s) => !layout[s.key]);
    if (missing.length > 0) {
      toast("tab '" + tab + "' ไม่มีหัวข้อหมวด: " + missing.map((s) => s.label).join(", "));
      return;
    }

    // เพิ่มแถวอัตโนมัติถ้าไม่พอ — ตามที่ผู้ใช้สั่ง
    let expanded = 0;
    for (const section of SECTIONS) {
      const need = (entry.rows[section.key] || []).length;
      if (need > layout[section.key].capacity) {
        layout[section.key] = await expandSection(tab, section, need, layout);
        expanded += 1;
      }
    }
    if (expanded > 0) {
      const fresh = await readTab(tab);
      layout = fresh.layout;
      toast("เพิ่มแถวให้อัตโนมัติ " + expanded + " หมวด");
    }

    const requests = buildUpdates(entry, layout).map((u) => ({
      updateCells: { range: u.range, fields: "userEnteredValue", values: u.values },
    }));
    await sheetsBatchUpdate({ requests });
    toast("เขียนกลับ tab '" + tab + "' แล้ว (" + requests.length + " ช่อง)");
  } catch (err) {
    toast("Sync ไม่สำเร็จ: " + err.message);
  } finally {
    $("btnPush").disabled = false;
  }
}

async function syncPull() {
  if (!requireToken()) return;
  if (!state.settings.clientId) { toast("กรอก OAuth Client ID ใน Settings ก่อน"); return; }
  $("btnPull").disabled = true;
  try {
    const tab = tabNameFor(currentEntry());
    const { rows, layout } = await readTab(tab);
    const local = totals().part;

    let remote = 0;
    let remoteRows = 0;
    SECTIONS.forEach((s) => {
      const L = layout[s.key];
      if (!L) return;
      for (let r = L.dataStart; r <= L.dataEnd; r += 1) {
        if ((cell(rows, r, s.subtotalCol) || "").trim()) continue;
        if (!cell(rows, r, "C").trim()) continue;
        remoteRows += 1;
        remote += num(cell(rows, r, "I"), 0);
      }
    });

    const localRows = SECTIONS.reduce((a, s) => a + state.rows[s.key].length, 0);
    if (localRows > 0 && (remoteRows > 0 || Math.abs(remote - local) > 0.005)) {
      if (remoteRows === 0) {
        toast("Sheet ยังไม่มีข้อมูลใน tab '" + tab + "' — ใช้ข้อมูลในเว็บ");
      } else {
        showConflict(tab, local, remote);
        return;
      }
    }
    const res = loadFromSheet(rows, layout, currentEntry());
    toast("โหลดจาก '" + tab + "' แล้ว — ผูกแคตตาล็อกได้ " + res.matched + " รายการ" +
      (res.unmatched.length ? " · ไม่รู้จัก " + res.unmatched.length + " รายการ" : ""));
  } catch (err) {
    toast("Pull ไม่สำเร็จ: " + err.message);
  } finally {
    $("btnPull").disabled = false;
  }
}

/** หาแคตตาล็อกที่ตรงกับชื่อที่อ่านมาจากชีต
 * คนในทีมอาจพิมพ์ชื่อย่อไว้เอง (เช่น 'Laser Cut' vs 'Laser Cutting')
 * จึงต้องเทียบแบบไม่สนตัวพิมพ์และไม่สนเครื่องหมาย */
function findCatalogItem(catalogKey, title) {
  const list = state.catalog[catalogKey] || [];
  if (!title) return null;
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const target = norm(title);
  return list.find((i) => norm(i.title) === target)
      || list.find((i) => norm(i.title).startsWith(target))
      || list.find((i) => target.startsWith(norm(i.title)))
      || null;
}

function loadFromSheet(rows, layout, entry) {
  let matched = 0;
  let unmatched = [];

  SECTIONS.forEach((section) => {
    const L = layout[section.key];
    const out = [];
    if (L) {
      for (let r = L.dataStart; r <= L.dataEnd; r += 1) {
        const title = cell(rows, r, "C").trim();
        if (!title) continue;

        // ผูกกลับเข้ากับแคตตาล็อก เพื่อให้แก้ขนาดแล้วคำนวณต่อได้
        const hit = findCatalogItem(section.catalog, title);
        if (hit) matched += 1; else unmatched.push(title);

        const row = {
          kind: section.key,
          title: title,
          use: cell(rows, r, "G").trim(),
          unit: cell(rows, r, "M").trim(),
          formula: hit ? hit.formula : "",
          c1: hit ? hit.c1 : 0,
          c2: hit ? hit.c2 : 0,
          params: hit ? (hit.params || []) : [],
          values: {},
          // เผื่อไม่เจอในแคตตาล็อก — ใช้ค่าที่ชีตคำนวณไว้แทน
          sheetUnitCost: num(cell(rows, r, "I"), 0),
          notInCatalog: !hit,
        };
        (hit ? (hit.params || []) : []).forEach((p) => { row.values[p.name] = 0; });

        if (section.key === "material") {
          row.size1 = num(cell(rows, r, "K"), 0);
          row.size1Fixed = row.params.some((p) => p.name === "Size1");
          if (row.size1Fixed) row.values.Size1 = row.size1;
          row.size2 = num(cell(rows, r, "O"), 0);
          row.areaName = cell(rows, r, "S").trim();
          row.area = num(cell(rows, r, "U"), 0);
          row.length = num(cell(rows, r, "V"), 0);
          row.density = num(cell(rows, r, "W"), 0);
          row.qty = num(cell(rows, r, "Y"), 0);
        } else if (section.key === "process") {
          row.qty = num(cell(rows, r, "M"), 0);
          row.multName = cell(rows, r, "O").trim();
          row.multVal = num(cell(rows, r, "Q"), 1);
        } else if (section.key === "fastener") {
          row.size1 = num(cell(rows, r, "K"), 0);
          row.size2 = num(cell(rows, r, "O"), 0);
          row.qty = num(cell(rows, r, "S"), 0);
        } else {
          row.toolCost = num(cell(rows, r, "I"), 0);
          row.qty = num(cell(rows, r, "M"), 0);
          row.pvf = num(cell(rows, r, "O"), 3000);
          row.fracInc = num(cell(rows, r, "Q"), 1);
        }
        out.push(row);
      }
    }
    state.rows[section.key] = out;
  });

  $("inpPartName").value = cell(rows, 4, "C") || entry.partName;
  $("inpBaseNo").value = cell(rows, 5, "C") || entry.baseNo;
  $("inpSuffix").value = cell(rows, 6, "C") || entry.suffix;
  $("inpDetails").value = cell(rows, 7, "C") || "";
  $("inpQty").value = num(cell(rows, 2, "V"), 1) || 1;
  renderCost();

  return { matched, unmatched };
}

function showConflict(tab, local, remote) {
  state.conflict = { tab };
  $("conflictText").textContent =
    "ข้อมูลไม่ตรงกัน — ในเว็บ " + money(local) + " / ใน Sheet '" + tab + "' " + money(remote) +
    " · ถ้าเลือก 'ใช้ข้อมูลเว็บ' เว็บจะเป็นตัวหลักและทับตอน Sync";
  $("conflictBar").hidden = false;
}

// ------------------------------------------------------------
// Settings
// ------------------------------------------------------------
function loadStorage() {
  try {
    const e = JSON.parse(localStorage.getItem(STORAGE_KEYS.entries) || "[]");
    if (Array.isArray(e)) state.savedEntries = e;
  } catch (err) { /* เริ่มใหม่ */ }
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEYS.settings) || "{}");
    if (s && typeof s === "object") {
      // ไม่ทับค่า default ด้วยค่าว่างที่เคยบันทึกไว้ตอนยังไม่ได้ตั้งค่า
      Object.keys(s).forEach((k) => {
        if (s[k] !== "" && s[k] !== null && s[k] !== undefined) state.settings[k] = s[k];
      });
    }
  } catch (err) { /* ไม่มี settings */ }
  try {
    const m = JSON.parse(localStorage.getItem(STORAGE_KEYS.partMap) || "{}");
    if (m && typeof m === "object") state.partMap = m;
  } catch (err) { /* ไม่มีแมป */ }
  try {
    state.token = sessionStorage.getItem(STORAGE_KEYS.token);
  } catch (err) { /* ไม่มี session */ }
}

function applySettingsToForm() {
  $("inpClientId").value = state.settings.clientId || "";
  $("inpSheetId").value = state.settings.spreadsheetId || "";
  $("inpTemplateTab").value = state.settings.templateTab || "AA 30001-1";
  updateAuthUi(!!state.token);
}

/** เตือนเมื่อ Client ID ในฟอร์มไม่ตรงกับตัวที่ฝังมากับแอป
 * สาเหตุที่พบบ่อยที่สุดของ origin_mismatch คือเพิ่ม origin
 * ไปที่ OAuth client ตัวอื่นในโปรเจกต์เดียวกัน */
function warnIfClientMismatch() {
  const warn = $("clientIdWarn");
  if (!warn) return;
  const v = ($("inpClientId") ? $("inpClientId").value : "").trim();
  if (!v || v === GOOGLE_CLIENT_ID) {
    warn.hidden = true;
    return;
  }
  warn.hidden = false;
  warn.textContent = "ค่านี้ไม่ตรงกับ Client ID ที่ฝังมากับเว็บ (" + GOOGLE_CLIENT_ID +
    ") — ถ้าเพิ่ม Authorized JavaScript origins ไปที่ client อื่นจะขึ้น origin_mismatch";
}

function readSettingsFromForm() {
  state.settings.clientId = $("inpClientId").value.trim();
  state.settings.spreadsheetId = $("inpSheetId").value.trim();
  state.settings.templateTab = $("inpTemplateTab").value.trim();
  try {
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(state.settings));
    return true;
  } catch (err) {
    return false;
  }
}

// ------------------------------------------------------------
// Event binding
// ------------------------------------------------------------
function bindEvents() {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => showPage(btn.dataset.page));
  });

  $("selAssembly").addEventListener("change", () => {
    state.assembly = $("selAssembly").value;
    fillParts();
    renderAssemblyList();
    renderBom();
  });
  $("selPart").addEventListener("change", syncPart);
  $("inpQty").addEventListener("input", recalc);
  $("inpSuffix").addEventListener("input", markUnsaved);

  $("btnReset").addEventListener("click", resetEntry);
  $("btnDemo").addEventListener("click", addSample);
  $("btnSaveDraft").addEventListener("click", saveEntry);
  $("btnSubmit").addEventListener("click", () => { if (saveEntry()) syncPush(); });
  $("btnSubmit2").addEventListener("click", () => { if (saveEntry()) syncPush(); });
  $("btnPush").addEventListener("click", syncPush);
  $("btnPull").addEventListener("click", syncPull);

  $("btnKeepWeb").addEventListener("click", () => {
    $("conflictBar").hidden = true;
    toast("ใช้ข้อมูลเว็บ — กด Sync เพื่อเขียนทับ");
  });
  $("btnTakeSheet").addEventListener("click", async () => {
    $("conflictBar").hidden = true;
    if (!state.conflict) return;
    try {
      const tab = state.conflict.tab;
      const { rows, layout } = await readTab(tab);
      const res = loadFromSheet(rows, layout, currentEntry());
      toast("ใช้ข้อมูลจาก Sheet แล้ว — ผูกแคตตาล็อกได้ " + res.matched +
        (res.unmatched.length ? " · ไม่รู้จัก: " + res.unmatched.join(", ") : ""));
    } catch (err) {
      toast("โหลดไม่สำเร็จ: " + err.message);
    }
  });

  $("inpBomSearch").addEventListener("input", renderBom);
  $("btnScanSheet").addEventListener("click", scanSheetForMissing);
  $("btnMatchSheet").addEventListener("click", scanForMatching);
  $("btnSaveMatches").addEventListener("click", saveMatches);
  $("inpMissingSearch").addEventListener("input", renderMissing);
  $("btnBomClear").addEventListener("click", () => { $("inpBomSearch").value = ""; renderBom(); });

  $("inpCatalogSearch").addEventListener("input", renderCatalogList);
  $("btnCloseModal").addEventListener("click", closeCatalog);
  $("catalogModal").addEventListener("click", (e) => {
    if (e.target === $("catalogModal")) closeCatalog();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && $("catalogModal").classList.contains("is-open")) closeCatalog();
  });

  $("btnAuth").addEventListener("click", async () => {
    if (state.token) {
      state.token = null;
      tokenClient = null;
      try { sessionStorage.removeItem(STORAGE_KEYS.token); } catch (e) { /* ignore */ }
      updateAuthUi(false);
      toast("ออกจากระบบแล้ว");
      return;
    }
    readSettingsFromForm();
    warnIfClientMismatch();
    if (!state.settings.clientId) {
      toast("กรอก OAuth Client ID ใน Settings ก่อน");
      showPage("settings");
      return;
    }
    clearAuthError();
    try { (await initTokenClient()).requestAccessToken(); }
    catch (err) { showAuthError(err.type || "popup", err.message || String(err)); }
  });

  $("btnAuthAlt").addEventListener("click", signInWithRedirect);
  $("btnSaveSettings").addEventListener("click", () => {
    warnIfClientMismatch();
    if (readSettingsFromForm()) toast("บันทึกการตั้งค่าแล้ว"); else toast("บันทึกไม่สำเร็จ");
  });
  $("btnTestSheet").addEventListener("click", async () => {
    if (!readSettingsFromForm()) return;
    if (!state.token) { toast("กด Sign in with Google ก่อน"); return; }
    try {
      const tabs = await listTabs();
      $("tabCount").textContent = tabs.length + " tabs";
      toast("อ่าน Sheet ได้ — " + tabs.length + " tabs");
    } catch (err) {
      toast("อ่านไม่สำเร็จ: " + err.message);
    }
  });
}

// ------------------------------------------------------------
// Boot
// ------------------------------------------------------------
async function loadJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(url + " -> HTTP " + res.status);
  return res.json();
}

function fillCatalogMeta() {
  const c = state.catalog;
  const counts = SECTIONS.map((s) => s.catalogLabel + " " + (c[s.catalog] || []).length).join(" · ");
  $("topMeta").textContent = "FSAE Supplement V" + (c.catalog_version || "?") + " — " + counts;
  const date = c.imported_at ? new Date(c.imported_at).toISOString().slice(0, 10) : "—";
  $("metaSource").textContent = c.source || "—";
  $("metaVersion").textContent = c.catalog_version || "—";
  $("metaImported").textContent = date;
  $("setSource").textContent = c.source || "—";
  $("setVersion").textContent = c.catalog_version || "—";
  $("setImported").textContent = date;
}

let booted = false;

async function init() {
  if (booted) return;
  booted = true;

  bindEvents();
  loadStorage();
  applySettingsToForm();
  await completeRedirectSignIn();

  try {
    const [bom, catalog, template] = await Promise.all([
      loadJson("data/bom.json"),
      loadJson("data/catalogs.json"),
      loadJson("data/sheet-template.json").catch(() => null),
    ]);
    state.bom = bom || {};
    state.catalog = catalog || {};
    state.template = template;
  } catch (err) {
    $("topMeta").textContent = "โหลดข้อมูลไม่สำเร็จ: " + err.message;
    toast("โหลดข้อมูลไม่สำเร็จ — ตรวจว่า dev server ทำงานอยู่");
    return;
  }

  fillCatalogMeta();
  fillAssemblies();
  renderCost();
  renderAssemblyList();
  renderBom();
  renderCatalogPage();
  markSaved();
}

document.addEventListener("DOMContentLoaded", init);

/** หน่วยทดสอบ: similarity + tabCandidates (เรียกจาก scripts/test_match.js) */
const __test = { similarity, normKey, tabCandidates, colIndex, evaluateFormula, round4 };
if (typeof module !== "undefined") module.exports = __test;
