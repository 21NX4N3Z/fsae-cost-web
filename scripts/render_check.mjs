// เปิดเว็บจริงใน Chromium แล้วตรวจการ render + จับภาพหน้าจอ
// ใช้ตรวจงาน UI จริง เพราะเครื่องมือ browser ของ Hermes ใช้ไม่ได้
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const URL = process.argv[2] || "http://localhost:4173/";
const OUT = "C:/Users/azzin/AppData/Local/hermes/cache/scratch/shots";
mkdirSync(OUT, { recursive: true });

const errors = [];
// บนเครื่องนี้มี chromium-1228 ติดตั้งไว้แล้ว แต่แพ็กเกจ playwright
// คาดหวัง 1243 — ชี้ path เองเพื่อไม่ต้องดาวน์โหลดใหม่
import { existsSync } from "node:fs";
const CACHE = "C:/Users/azzin/AppData/Local/ms-playwright";
const SHELL = CACHE + "/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe";
const FULL  = CACHE + "/chromium-1228/chrome-win64/chrome.exe";

const launchOpts = existsSync(SHELL) ? { executablePath: SHELL }
                 : existsSync(FULL)  ? { executablePath: FULL }
                 : {};
console.log("BROWSER:", launchOpts.executablePath || "playwright default");

const browser = await chromium.launch(launchOpts);
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push("console.error: " + m.text());
});

await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForFunction(() => {
  const t = document.getElementById("topMeta");
  return t && !/Loading/.test(t.textContent);
}, { timeout: 30000 });

const shot = async (name) => {
  const p = OUT + "/" + name + ".png";
  await page.screenshot({ path: p, fullPage: true });
  return p;
};

// --- ตรวจสภาพรวม ---
const info = await page.evaluate(() => ({
  meta: document.getElementById("topMeta").textContent.trim(),
  sections: [...document.querySelectorAll("#costContainer .sec-head strong")].map((n) => n.textContent),
  assemblyOptions: document.getElementById("selAssembly").options.length,
  partOptions: document.getElementById("selPart").options.length,
  addButtons: document.querySelectorAll("#costContainer .linkbtn").length,
  grand: document.getElementById("sumGrand").textContent,
}));
console.log("META      :", info.meta);
console.log("SECTIONS  :", info.sections.join(", "));
console.log("ASSEMBLIES:", info.assemblyOptions, "| PARTS:", info.partOptions);
console.log("ADDBTN    :", info.addButtons);
console.log("GRAND     :", info.grand);
console.log("SHOT      :", await shot("01-entry-empty"));

// --- เพิ่มตัวอย่างแล้วดูตัวเลขขยับจริงหรือไม่ ---
await page.click("#btnDemo");
await page.waitForTimeout(400);
const after = await page.evaluate(() => ({
  grand: document.getElementById("sumGrand").textContent,
  part: document.getElementById("sumPart").textContent,
  mat: document.getElementById("sumMaterial").textContent,
  proc: document.getElementById("sumProcess").textContent,
  fast: document.getElementById("sumFastener").textContent,
  tool: document.getElementById("sumTooling").textContent,
  rows: document.querySelectorAll("#costContainer .cost-row").length,
}));
console.log("\nAFTER DEMO:");
console.log("  rows   :", after.rows);
console.log("  mat/proc/fast/tool:", after.mat, after.proc, after.fast, after.tool);
console.log("  part   :", after.part, " grand:", after.grand);
console.log("  numbers moved:", after.grand !== "$0.00");
console.log("SHOT      :", await shot("02-entry-filled"));

// --- เปิด modal แคตตาล็อก ---
await page.click("#costContainer .linkbtn");
await page.waitForTimeout(500);
const modal = await page.evaluate(() => ({
  open: document.getElementById("catalogModal").classList.contains("is-open"),
  title: document.getElementById("modalTitle").textContent,
  rows: document.querySelectorAll("#catalogList .cat-row").length,
  chips: [...document.querySelectorAll("#catalogChips .chip")].map((n) => n.textContent),
}));
console.log("\nMODAL      :", modal.open, "|", modal.title, "|", modal.rows, "rows");
console.log("  chips   :", modal.chips.join(", "));
console.log("SHOT      :", await shot("03-catalog-modal"));

await page.keyboard.press("Escape");
await page.waitForTimeout(300);

// --- เปลี่ยนหน้า ---
for (const [page_, name] of [["bom", "04-bom"], ["catalogs", "05-catalogs"], ["missing", "06-missing"], ["dashboard", "07-dashboard"], ["settings", "08-settings"]]) {
  await page.click('.nav-btn[data-page="' + page_ + '"]');
  await page.waitForTimeout(350);
  const visible = await page.evaluate((p) => !document.getElementById("page-" + p).hidden, page_);
  console.log("PAGE", page_.padEnd(10), "visible:", visible, "| shot:", await shot(name));
}

console.log("\nRUNTIME ERRORS:", errors.length ? errors : "none");
await browser.close();
process.exit(errors.length ? 1 : 0);
