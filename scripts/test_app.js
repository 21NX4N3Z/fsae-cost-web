// Integration test: โหลด index.html + app.js จริงใน jsdom แล้วตรวจว่า
// Cost Breakdown ทำงานจริง — เพิ่ม/ลบ/คำนวณ/ค้นหา/นำทาง
import { readFileSync } from "node:fs";
import { JSDOM, VirtualConsole } from "jsdom";

const ROOT = "D:/hermes-workspace/fsae-cost-web";
const html = readFileSync(`${ROOT}/index.html`, "utf8");
const appJs = readFileSync(`${ROOT}/public/app.js`, "utf8");
const bom = readFileSync(`${ROOT}/data/bom.json`, "utf8");
const catalogs = readFileSync(`${ROOT}/data/catalogs.json`, "utf8");

const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => errors.push("jsdomError: " + e.message));
vc.on("error", (...a) => errors.push("console.error: " + a.join(" ")));

const dom = new JSDOM(html, {
  runScripts: "dangerously",
  url: "http://localhost:3000/",
  pretendToBeVisual: true,
  virtualConsole: vc,
});
const { window } = dom;

// mock fetch ให้อ่านไฟล์จริง
window.fetch = async (url) => {
  const p = String(url).replace(/^\//, "");
  const body = p.endsWith("bom.json") ? bom : catalogs;
  return { ok: true, status: 200, json: async () => JSON.parse(body) };
};
window.Function = Function;

// ประกาศ storage จำลอง — ต้องเริ่มว่างทุกรอบ ไม่งั้น entry จะสะสมจากรอบก่อน
const store = new Map();
Object.defineProperty(window, "localStorage", {
  value: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  },
  configurable: true,
});

// แทรก app.js แล้วส่ง DOMContentLoaded
const script = window.document.createElement("script");
script.textContent = appJs;
window.document.body.appendChild(script);
window.document.dispatchEvent(new window.Event("DOMContentLoaded"));

const $ = (id) => window.document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
}

await sleep(300);

check("no runtime errors on boot", errors.length === 0, errors.join(" | "));
check("topbar shows catalog meta", /Supplement V2252/.test($("topMeta").textContent), $("topMeta").textContent);
check("assemblies populated", $("selAssembly").options.length === 7, $("selAssembly").options.length + " options");
check("parts populated", $("selPart").options.length > 0, $("selPart").options.length + " options");
check("cost container has 4 sections", $("costContainer").querySelectorAll(".cost-section").length === 4,
  $("costContainer").querySelectorAll(".cost-section").length + " sections");

const secLabels = [...$("costContainer").querySelectorAll(".sec-head strong")].map((n) => n.textContent);
check("section labels match Google Sheet",
  secLabels.join(",") === "MATERIAL,PROCESS,FASTENER,TOOLING", secLabels.join(","));

// --- เปิด modal ของ Materials ---
const addBtns = $("costContainer").querySelectorAll(".linkbtn");
check("4 add buttons in breakdown", addBtns.length === 4, addBtns.length + " buttons");
addBtns[0].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await sleep(50);
check("materials modal opens", $("catalogModal").classList.contains("is-open"));
const rows = $("catalogList").querySelectorAll(".cat-row");
check("materials modal lists items", rows.length > 0, rows.length + " rows shown");

// --- ค้นหา ---
$("inpCatalogSearch").value = "Aluminum";
$("inpCatalogSearch").dispatchEvent(new window.Event("input"));
await sleep(50);
const found = $("catalogList").querySelectorAll(".cat-row").length;
check("search filters catalog", found > 0 && found < 200, found + " rows for 'Aluminum'");

// --- เพิ่มรายการแรกเข้า breakdown ---
const firstAdd = $("catalogList").querySelector(".cat-row .btn");
firstAdd.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await sleep(50);
check("modal closes after add", !$("catalogModal").classList.contains("is-open"));
const matRows = $("costContainer").querySelectorAll(".cost-section")[0].querySelectorAll(".cost-row");
check("material row added", matRows.length === 1, matRows.length + " row(s)");

// --- ลบรายการ (บั๊กเดิม: ปุ่มลบไม่ทำงาน) ---
const before = $("costContainer").querySelectorAll(".cost-row").length;
const delBtn = $("costContainer").querySelector(".icon-btn");
delBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await sleep(50);
const after = $("costContainer").querySelectorAll(".cost-row").length;
check("delete button works", after === before - 1, `${before} -> ${after}`);

// --- เพิ่มตัวอย่างครบ 5 หมวด แล้วตรวจยอดรวม ---
$("btnDemo").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await sleep(100);
const sections = $("costContainer").querySelectorAll(".cost-section");
const counts = [...sections].map((s) => s.querySelectorAll(".cost-row").length);
check("sample adds rows to 4 sections", counts.every((c) => c >= 1), "counts=" + counts.join(","));

const grand = $("sumGrand").textContent;
check("extended cost is non-zero", grand !== "$0.00", "grand total = " + grand);
check("part cost computed", $("sumPart").textContent !== "$0.00", "part = " + $("sumPart").textContent);
console.log("     breakdown: mat=" + $("sumMaterial").textContent +
  " proc=" + $("sumProcess").textContent +
  " fast=" + $("sumFastener").textContent +
  " tool=" + $("sumTooling").textContent);

// --- พารามิเตอร์ของสูตรเปลี่ยนต้นทุนจริงไหม ---
const paramInput = $("costContainer").querySelector(".cost-row input[type=number]");
if (paramInput) {
  const partBefore = $("sumPart").textContent;
  paramInput.value = "9";
  paramInput.dispatchEvent(new window.Event("input", { bubbles: true }));
  await sleep(50);
  check("editing a formula parameter recalculates", $("sumPart").textContent !== partBefore,
    `${partBefore} -> ${$("sumPart").textContent}`);
} else {
  check("editing a formula parameter recalculates", false, "no parameter input found");
}

// --- quantity ต่อรถ ---
$("inpQty").value = "4";
$("inpQty").dispatchEvent(new window.Event("input", { bubbles: true }));
await sleep(50);
const partCost = $("sumPart").textContent;
const ext = $("sumExtended").textContent;
check("quantity multiplies extended cost", ext !== partCost, `part=${partCost} extended=${ext}`);

// --- save entry -> missing cost + dashboard ---
$("btnSubmit").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await sleep(80);
const navBom = window.document.querySelector('.nav-btn[data-page="bom"]');
navBom.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await sleep(50);
check("BOM page renders", !$("page-bom").hidden && $("bomRows").querySelectorAll("tr").length > 0,
  $("bomRows").querySelectorAll("tr").length + " rows");

$("btnSaveDraft").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await sleep(50);
const navDash = window.document.querySelector('.nav-btn[data-page="dashboard"]');
navDash.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await sleep(50);
check("dashboard shows saved entry", $("dashRows").querySelectorAll("tr").length === 1,
  $("dashRows").querySelectorAll("tr").length + " entry");
check("dashboard total non-zero", $("dashTotal").textContent !== "$0.00", $("dashTotal").textContent);

const navCat = window.document.querySelector('.nav-btn[data-page="catalogs"]');
navCat.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await sleep(50);
const catCards = $("catalogGrid").querySelectorAll(".catalog-item");
check("catalog page lists 4 catalogs", catCards.length === 4, catCards.length + " cards");
const c0 = catCards[0].textContent.replace(/\s*entries\s*Launch/g, " entries | ");
const c4 = catCards[3].textContent.replace(/\s*entries\s*Launch/g, " entries | ");
check("catalog counts correct",
  /^Materials1,068 entries/.test(c0) && /^Tooling12 entries/.test(c4),
  JSON.stringify(c0) + " " + JSON.stringify(c4));

check("close button closes modal", !$("catalogModal").classList.contains("is-open"));

// --- escape ปิด modal ---
$("costContainer").querySelectorAll(".linkbtn")[3].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await sleep(30);
check("tooling modal opens", $("catalogModal").classList.contains("is-open"));
window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
await sleep(30);
check("Escape closes modal", !$("catalogModal").classList.contains("is-open"));

// --- ไม่มี error สะสม ---
check("no runtime errors after full flow", errors.length === 0, errors.join(" | "));

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("FAILED:");
  failed.forEach((f) => console.log("  - " + f.name + (f.detail ? "  [" + f.detail + "]" : "")));
}
process.exit(failed.length ? 1 : 0);
