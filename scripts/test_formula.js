// ทดสอบ evaluateFormula ของแอปด้วย Node จริง (ใช้ Math.E จริง)
// เรียกจาก scripts/test_formula.js
import { readFileSync } from "node:fs";

const catalog = JSON.parse(
  readFileSync("D:/hermes-workspace/fsae-cost-web/data/catalogs.json", "utf8")
);

// ดึง evaluateFormula + num จาก app.js ตรง ๆ เพื่อให้ทดสอบโค้ดจริง
const appSrc = readFileSync("D:/hermes-workspace/fsae-cost-web/app.js", "utf8");
const numSrc = appSrc.slice(
  appSrc.indexOf("function num("),
  appSrc.indexOf("function el(")
);
const fnSrc = appSrc.slice(
  appSrc.indexOf("function evaluateFormula"),
  appSrc.indexOf("/** ต้นทุนต่อหน่วยของ 1 แถว */")
);
const evaluateFormula = new Function(numSrc + fnSrc + "\nreturn evaluateFormula;")();

let total = 0;
let failed = [];
let zeroNoParam = [];

for (const kind of ["materials", "processes", "fasteners"]) {
  for (const item of catalog[kind]) {
    if (!item.formula) continue;
    total++;
    const values = {};
    for (const p of item.params) values[p.name] = 2;
    const r = evaluateFormula(item.formula, values, item.c1, item.c2);
    if (!Number.isFinite(r)) failed.push([kind, item.title, item.formula.slice(0, 60)]);
    // รายการที่ไม่มีพารามิเตอร์แต่ให้ 0 = ต้องเช็คว่าเป็นของแท้จริงหรือไม่
    if (item.params.length === 0 && r === 0) zeroNoParam.push([kind, item.title, item.formula]);
  }
}

console.log("formulas evaluated      :", total);
console.log("FAILED (not finite)     :", failed.length);
failed.slice(0, 8).forEach((f) => console.log("   FAIL", f.join(" | ")));
console.log("fixed-price items = 0   :", zeroNoParam.length);
zeroNoParam.slice(0, 6).forEach((z) => console.log("   zero:", z.join(" | ")));

// ตัวอย่างค่าจริงที่ควรได้
const bolt = catalog.fasteners.find((f) => f.title === "Bolt, Aluminum");
console.log("\nBolt, Aluminum  d=6mm L=25mm ->", "$" + evaluateFormula(bolt.formula, { Size1: 6, Size2: 25 }, bolt.c1, bolt.c2).toFixed(4));
const bearing = catalog.materials.find((f) => f.title === "Bearing, Spherical, Suspension");
console.log("Bearing Spherical Sus    ->", "$" + evaluateFormula(bearing.formula, { Size1: 20 }, bearing.c1, bearing.c2).toFixed(4));
const film = catalog.materials.find((f) => f.title === "Adhesive  Film");
console.log("Adhesive Film (formula=0)->", "$" + evaluateFormula(film.formula, {}, film.c1, film.c2).toFixed(2));

process.exit(failed.length === 0 ? 0 : 1);
