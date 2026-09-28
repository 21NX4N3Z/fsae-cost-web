/**
 * ทดสอบ Sync แบบ end-to-end กับ mock ของ Google Sheets API
 *
 * mock นี้ให้ข้อมูลจากชีต BP18 จริง (data/sheet-fixture.json) และบันทึกทุกคำสั่งเขียน
 * ที่แอปส่งออก เพื่อตรวจว่าเขียนถูกแท็บ ถูกช่อง และไม่ทับสูตรของทีม
 *
 * รัน:  node scripts/test_sync_e2e.mjs
 */
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const ROOT = "D:/hermes-workspace/fsae-cost-web";
const fixture = JSON.parse(readFileSync(ROOT + "/data/sheet-fixture.json", "utf8"));
const BASE = process.env.BASE_URL || "http://localhost:4173/";

let pass = 0,
  fail = 0;
const check = (name, ok, detail) => {
  if (ok) {
    pass += 1;
    console.log("PASS  " + name + (detail ? "  -> " + detail : ""));
  } else {
    fail += 1;
    console.log("FAIL  " + name + (detail ? "  -> " + detail : ""));
  }
};

const colToIdx = (s) => {
  let n = 0;
  for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

/** แปลง A1 เป็น [rowIdx0, colIdx0] */
function a1(ref) {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  return [parseInt(m[2], 10) - 1, colToIdx(m[1])];
}

const writes = [];
const reads = [];

/** ให้ fetch ไปที่ mock แทน Google */
async function installMock(page) {
  await page.route("**://sheets.googleapis.com/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const method = req.method();

    // GET /v4/spreadsheets/{id}
    if (method === "GET" && !path.includes("/values/")) {
      reads.push({ kind: "spreadsheet" });
      const body = {
        spreadsheetId: fixture.spreadsheetId,
        properties: fixture.properties,
        sheets: fixture.sheets.map((s) => ({
          properties: {
            sheetId: s.sheetId,
            title: s.title,
            gridProperties: s.gridProperties,
          },
        })),
      };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    }

    // GET /v4/spreadsheets/{id}/values/{range}
    if (method === "GET" && path.includes("/values/")) {
      const raw = decodeURIComponent(path.split("/values/")[1]);
      const m = /^'?([^'!]+)'?!(.+)$/.exec(raw);
      if (!m) return route.fulfill({ status: 400, body: "{}" });
      const tab = fixture.sheets.find((s) => s.title === m[1]);
      if (!tab) return route.fulfill({ status: 404, body: JSON.stringify({ error: { message: "no tab" } }) });
      const rm = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(m[2]);
      if (!rm) return route.fulfill({ status: 400, body: "{}" });
      const r1 = parseInt(rm[2], 10) - 1,
        r2 = parseInt(rm[4], 10) - 1;
      const c1 = colToIdx(rm[1]),
        c2 = colToIdx(rm[3]);
      reads.push({ kind: "values", tab: m[1], range: m[2] });
      const out = [];
      for (let r = r1; r <= r2 && r < tab.values.length; r += 1) {
        const src = tab.values[r] || [];
        const row = [];
        for (let c = c1; c <= c2; c += 1) row.push(src[c] === undefined ? "" : src[c]);
        out.push(row);
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ range: raw, majorDimension: "ROWS", values: out }),
      });
    }

    // POST :batchUpdate
    if (method === "POST") {
      const body = JSON.parse(req.postData() || "{}");
      if (process.env.DEBUG_POST) {
        const kinds = (body.requests || []).map((r) => Object.keys(r)[0]);
        console.log("   [POST] " + kinds.length + " requests: " + JSON.stringify(kinds.slice(0, 6)));
        const first = (body.requests || [])[0];
        if (first) console.log("   [POST] first: " + JSON.stringify(first).slice(0, 400));
      }
      (body.requests || []).forEach((r) => {
        if (r.updateCells) {
          (r.updateCells.rows || []).forEach((row) => {
            (row.values || []).forEach((v) => {
              if (v.userEnteredValue) {
                const val = Object.values(v.userEnteredValue)[0];
                writes.push({ kind: "cells", sheetId: r.updateCells.range.sheetId, row: row.values.indexOf(v), val });
              }
            });
          });
        } else if (r.updateCells && r.updateCells.fields) {
          writes.push({ kind: "updateCells", fields: r.updateCells.fields });
        }
        if (r.insertDimension) {
          writes.push({
            kind: "insertDimension",
            sheetId: r.insertDimension.range.sheetId,
            start: r.insertDimension.range.startIndex,
            end: r.insertDimension.range.endIndex,
          });
        }
        if (r.updateCells && r.updateCells.range) {
          writes.push({ kind: "range", range: r.updateCells.range, fields: r.updateCells.fields });
        }
      });
      // บันทึก range+values (รูปแบบที่ buildUpdates ใช้จริง)
      (body.requests || []).forEach((r) => {
        if (r.updateCells && r.updateCells.range && r.updateCells.rows) {
          r.updateCells.rows.forEach((row, ri) => {
            (row.values || []).forEach((v, ci) => {
              const val = v.userEnteredValue ? Object.values(v.userEnteredValue)[0] : null;
              writes.push({
                kind: "write",
                sheetId: r.updateCells.range.sheetId,
                row: r.updateCells.range.startRowIndex + ri,
                col: r.updateCells.range.startColumnIndex + ci,
                val,
              });
            });
          });
        }
      });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ replies: [] }) });
    }

    return route.fulfill({ status: 404, body: "{}" });
  });
}

const sheetIdOf = (title) => fixture.sheets.find((s) => s.title === title).sheetId;
const colName = (i) => {
  let n = i + 1,
    s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

async function main() {
  // Playwright ในเครื่องนี้ไม่มี chromium รุ่นที่ตรงกับเวอร์ชันที่ติดตั้งไว้
  // จึงต้องชี้ executablePath ไปที่ตัวที่มีจริง (แบบเดียวกับ render_check.mjs)
  const CHROME = "C:/Users/azzin/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe";
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await installMock(page);
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll("#selAssembly option").length > 0, { timeout: 20000 });

  // แอปต้องเชื่อม Sheet ก่อน จึงใส่ token ปลอมให้
  await page.evaluate(() => {
    // token เก็บใน sessionStorage ไม่ใช่ localStorage
    sessionStorage.setItem("fsae.token.v1", "mock-token");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll("#selAssembly option").length > 0, { timeout: 20000 });

  check("โหลดแอปได้", true, BASE);

  // ---- 1) อ่านรายชื่อแท็บ ----
  // ปุ่ม Test connection อยู่ในหน้า Settings ซึ่งถูกซ่อนไว้ต้องเปิดหน้านั้นก่อน
  await page.evaluate(() => showPage("settings"));
  await page.waitForSelector("#btnTestSheet", { state: "visible" });
  await page.click("#btnTestSheet");
  await page.waitForTimeout(1200);
  const tabCount = await page.evaluate(() => document.getElementById("tabCount").value);
  check("อ่านรายชื่อแท็บได้ 207", /^207\b/.test(tabCount.trim()), tabCount.trim());

  // ---- 2) เลือก part ที่มีต้นทุนอยู่แล้ว แล้วดึงข้อมูลกลับ ----
  await page.evaluate(() => showPage("entry"));
  await page.waitForSelector("#selAssembly", { state: "visible" });
  await page.selectOption("#selAssembly", "FRAME ASSEMBLY");
  await page.waitForTimeout(500);
  const partOpts = await page.$$eval("#selPart option", (o) => o.map((x) => x.value));
  check("มีรายการ part ให้เลือก", partOpts.length >= 60, partOpts.length + " parts");

  await page.selectOption("#selPart", "FR 00201-AA");
  await page.waitForTimeout(500);

  const tabName = await page.evaluate(() => tabNameFor(currentEntry()));
  check("ชื่อแท็บที่จะใช้ = FR 00201-AA", tabName === "FR 00201-AA", tabName);

  await page.click("#btnPull");
  await page.waitForTimeout(2500);

  const matRows = await page.evaluate(() => state.rows.material.length);
  const procRows = await page.evaluate(() => state.rows.process.length);
  check("Pull อ่านรายการ Material จากชีตได้", matRows > 0, matRows + " แถว");
  check("Pull อ่านรายการ Process จากชีตได้", procRows > 0, procRows + " แถว");

  const partCost = await page.evaluate(() => totals().part);
  check("Part Cost > 0 หลัง Pull", partCost > 0, "$" + partCost.toFixed(4));

  // ยอดที่อ่านได้ต้องตรงกับชีตจริง
  // ตรวจทั้งชีต: แท็บแม่ต้องมีสูตรรวม Details ที่คอลัมน์ Y
  const rollups = fixture.sheets.filter((s) => /^FR \d{3}00-AA$/.test(s.title));
  // แท็บที่ไม่มี Details อยู่แล้ว (เช่น ANTI INTRUSION PLATE) ไม่ต้องมีสูตร
  const hasDetails = (s) =>
    s.values.some((r) => r && String(r[11] || "").trim() === "Item Order"
                          && String(r[13] || "").trim() === "Part");
  const withDet = rollups.filter(hasDetails);
  const withSum = withDet.filter((s) =>
    s.values.some((row) => row && String(row[24] || "").startsWith("=SUM(Y")));
  check("แท็บแม่ที่มี Details ต้องมีสูตรรวม (Y)", withSum.length === withDet.length,
    withSum.length + "/" + withDet.length + " แท็บ (ไม่มี Details "
    + (rollups.length - withDet.length) + ")");

  // ---- 3) เพิ่มรายการ Material ใหม่ แล้ว Push ----
  writes.length = 0;
  await page.evaluate(() => {
    state.rows.material.push({
      kind: "material",
      title: "TEST-UNIT-COST",
      use: "ทดสอบ",
      unitCost: 12.5,
      sheetUnitCost: 12.5,
      notInCatalog: true,
      size1: 1,
      unit: "unit",
      size2: 0,
      qty: 2,
      areaName: "",
      area: 0,
      length: 0,
      density: 0,
    });
    markUnsaved();
  });
  await page.click("#btnSubmit2");
  await page.waitForTimeout(2500);

  const sheetId = sheetIdOf("FR 00201-AA");
  if (process.env.DEBUG_POST) {
    console.log("   [writes] total=" + writes.length + " kinds=" + JSON.stringify([...new Set(writes.map((w) => w.kind))]));
    console.log("   [writes] sheetIds=" + JSON.stringify([...new Set(writes.map((w) => w.sheetId))]));
    console.log("   [writes] target sheetId=" + sheetId);
    writes.filter((w) => w.kind === "write" && w.row >= 8 && w.row <= 30).forEach((w) => console.log("      W " + colName(w.col) + (w.row+1) + " = " + JSON.stringify(w.val).slice(0,40)));
    writes.filter((w) => w.kind === "range").slice(0, 3).forEach((w) => console.log("      R " + JSON.stringify(w).slice(0, 140)));
  }
  const mine = writes.filter((w) => w.kind === "write" && w.sheetId === sheetId);
  check("Push ส่งคำสั่งเขียน", writes.length > 0, writes.length + " คำสั่ง");

  const titleWrite = mine.find((w) => String(w.val) === "TEST-UNIT-COST");
  check("เขียนชื่อวัสดุลงช่อง C", !!titleWrite, titleWrite ? "C" + (titleWrite.row + 1) : "ไม่พบ");

  const useWrite = mine.find((w) => String(w.val) === "ทดสอบ");
  check("เขียน Use ลงช่อง F (ไม่ใช่ G)", !!useWrite && colName(useWrite.col) === "F",
    useWrite ? "คอลัมน์ " + colName(useWrite.col) : "ไม่พบ");
  const gWrite = mine.find((w) => String(w.val) === "ทดสอบ" && colName(w.col) === "G");
  check("ไม่มีการเขียนผิดลงช่อง G", !gWrite, gWrite ? "เขียนผิด" : "ถูกต้อง");

  const costWrite = mine.find((w) => Number(w.val) === 12.5 && colName(w.col) === "I");
  check("เขียน Unit Cost ลงช่อง I", !!costWrite, costWrite ? "I" + (costWrite.row + 1) : "ไม่พบ");

  // ไม่ควรเขียนทับสูตรของทีม: ช่องยอดรวมต้องไม่ถูกแตะ
  const subtotalWrites = mine.filter((w) => {
    const row1 = w.row + 1;
    return (row1 === 14 || row1 === 19 || row1 === 24 || row1 === 29) &&
      ["AA", "S", "U", "Y"].includes(colName(w.col)) && String(w.val).startsWith("=");
  });
  check("ไม่เขียนทับสูตร Sub Total ของทีม", subtotalWrites.length === 0, subtotalWrites.length + " รายการ");

  // ---- 4) ไม่เขียนข้ามแท็บ ----
  const otherSheets = writes.filter((w) => w.kind === "write" && w.sheetId !== sheetId);
  check("ไม่มีการเขียนข้ามแท็บ", otherSheets.length === 0, otherSheets.length + " รายการ");

  // ---- 5) ทดสอบแท็บที่ยังไม่มีต้นทุน (FR 00502-AA) ----
  // ทุก part ใน BOM ต้องหาแท็บของตัวเองเจอ และแท็บนั้นต้องมีอยู่จริง
  const allPns = await page.evaluate(() =>
    Object.keys(state.bom).flatMap((a) => state.bom[a].map((p) => p[0])));
  const realTabs = new Set(fixture.sheets.map((s) => s.title));
  const missing = allPns.filter((pn) => {
    const d = (pn.match(/\d+/) || [""])[0];
    return !realTabs.has("FR " + d.padStart(5, "0") + "-AA");
  });
  check("ทุก part ใน BOM มีแท็บของตัวเอง", missing.length === 0,
    allPns.length + " parts, ไม่มีแท็บ " + missing.length);

  console.log("");
  console.log("reads: " + reads.length + "  writes: " + writes.length);
  check("ไม่มี runtime error", errors.length === 0, errors.slice(0, 2).join(" | "));

  await browser.close();
  console.log("");
  console.log(pass + "/" + (pass + fail) + " passed");
  process.exit(fail === 0 ? 0 : 1);
}

main();
