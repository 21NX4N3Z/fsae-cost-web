// ตรวจรายละเอียดในหน้าจอจริงด้วย Playwright — ใช้แทนการดูด้วยตาเมื่อ vision rate-limited
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";

const URL = process.argv[2] || "http://localhost:4173/";
const OUT = "C:/Users/azzin/AppData/Local/hermes/cache/scratch/shots";
mkdirSync(OUT, { recursive: true });

const CACHE = "C:/Users/azzin/AppData/Local/ms-playwright";
const SHELL = CACHE + "/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe";
const browser = await chromium.launch(existsSync(SHELL) ? { executablePath: SHELL } : {});

const errors = [];

// ---------- ตรวจ responsive ที่ 3 ขนาดจอ ----------
for (const [w, h, tag] of [[1440, 1000, "desktop"], [900, 1100, "tablet"], [390, 900, "mobile"]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on("pageerror", (e) => errors.push(tag + " pageerror: " + e.message));
  await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForFunction(() => { const t = document.getElementById("topMeta"); return t && !/Loading/.test(t.textContent); }, { timeout: 30000 });
  await page.click("#btnDemo");
  await page.waitForTimeout(350);

  const overflow = await page.evaluate(() => {
    const bad = [];
    document.querySelectorAll("#costContainer *, .summary *, .topbar *").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > window.innerWidth + 1) {
        bad.push((el.id || el.className || el.tagName) + " right=" + Math.round(r.right));
      }
    });
    return {
      horizontalScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
      docWidth: document.documentElement.scrollWidth,
      winWidth: window.innerWidth,
      overflowers: bad.slice(0, 5),
      // ข้อความที่ล้นกรอบ
      clipped: [...document.querySelectorAll("#costContainer .name, .summary .val")]
        .filter((n) => n.scrollWidth > n.clientWidth + 2).map((n) => n.textContent.slice(0, 30)),
      touchTargets: [...document.querySelectorAll("button, input, select")]
        .filter((n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 32; }).length,
    };
  });
  console.log("\n=== " + tag + " " + w + "x" + h + " ===");
  console.log("  horizontal scroll :", overflow.horizontalScroll, "(doc", overflow.docWidth, "vs win", overflow.winWidth + ")");
  console.log("  clipped text      :", overflow.clipped.length ? overflow.clipped : "none");
  console.log("  elements < 32px h :", overflow.touchTargets);
  console.log("  overflowing right :", overflow.overflowers.length ? overflow.overflowers : "none");
  await page.screenshot({ path: OUT + "/rwd-" + tag + ".png", fullPage: true });
  await page.close();
}

// ---------- ตรวจหน้า Missing Cost ----------
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on("pageerror", (e) => errors.push("missing pageerror: " + e.message));
await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForFunction(() => { const t = document.getElementById("topMeta"); return t && !/Loading/.test(t.textContent); }, { timeout: 30000 });
await page.click('.nav-btn[data-page="missing"]');
await page.waitForTimeout(300);
const m = await page.evaluate(() => ({
  visible: !document.getElementById("page-missing").hidden,
  summary: document.getElementById("missingSummary").textContent,
  scanBtn: !!document.getElementById("btnScanSheet"),
  searchBox: !!document.getElementById("inpMissingSearch"),
  rowCount: document.querySelectorAll("#missingRows tr").length,
  firstRow: document.querySelector("#missingRows tr") ? document.querySelector("#missingRows tr").textContent.replace(/\s+/g, " ").trim().slice(0, 90) : "-",
  statusTags: [...document.querySelectorAll("#missingRows .tag")].map((n) => n.textContent).slice(0, 4),
}));
console.log("\n=== MISSING COST PAGE ===");
console.log("  visible   :", m.visible);
console.log("  summary   :", m.summary);
console.log("  scan btn  :", m.scanBtn, "| search:", m.searchBox);
console.log("  rows      :", m.rowCount);
console.log("  first row :", m.firstRow);
console.log("  status    :", m.statusTags.join(", "));
await page.screenshot({ path: OUT + "/missing-detail.png", fullPage: true });

// ---------- ตรวจ target tab field ----------
await page.click('.nav-btn[data-page="entry"]');
await page.waitForTimeout(250);
const t = await page.evaluate(() => {
  const el = document.getElementById("inpTargetTab");
  return { exists: !!el, label: el ? document.querySelector('label[for="inpTargetTab"]').textContent : "-", placeholder: el ? el.placeholder : "-" };
});
console.log("\n=== TARGET TAB FIELD ===");
console.log(" ", t.exists, "|", t.label);

console.log("\nRUNTIME ERRORS:", errors.length ? errors : "none");
await browser.close();
