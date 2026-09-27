import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const app = readFileSync("D:/hermes-workspace/fsae-cost-web/public/app.js", "utf8");

// similarity / normKey อยู่ช่วง Part matching
const a1 = app.indexOf("function normKey(");
const a2 = app.indexOf("/** อ่านหัวข้อแถวของ tab");
// tabCandidates อยู่ช่วง Sync
const b1 = app.indexOf("function tabCandidates(");
const b2 = app.indexOf("async function resolveTab(");
const src = app.slice(a1, a2) + "\n" + app.slice(b1, b2);
const { similarity, normKey, tabCandidates } = new Function(src + "; return {similarity, normKey, tabCandidates};")();

let pass = 0, fail = 0;
const check = (name, ok, got) => {
  console.log((ok ? "PASS  " : "FAIL  ") + name + "  -> " + got);
  ok ? pass++ : fail++;
};

console.log("=== similarity ===");
check("ชื่อเดียวกันเป๊ะ", similarity("FR BULKHEAD R", "FR BULKHEAD R") === 1, similarity("FR BULKHEAD R", "FR BULKHEAD R"));
check("ตัวพิมพ์ต่างกัน", similarity("frame tube 1", "Frame Tube 1") === 1, similarity("frame tube 1", "Frame Tube 1"));
check("คำขึ้นต้นตรงกัน", similarity("Frame tube 1", "Frame tube 1 - 25mm") >= 0.9, similarity("Frame tube 1", "Frame tube 1 - 25mm"));
const s1 = similarity("FR R UPR FR A-ARM BRACKET", "A-ARM FRONT BRACKET 1");
check("ชิ้นเดียวกันคนละการเขียน > 0.3", s1 > 0.3, s1.toFixed(3));
const s2 = similarity("FR BULKHEAD R", "A-ARM FRONT BRACKET 1");
check("คนละชิ้น < 0.3", s2 < 0.3, s2.toFixed(3));
check("ค่าว่าง = 0", similarity("", "Frame tube 1") === 0, similarity("", "Frame tube 1"));

console.log("\n=== tabCandidates (BOM FR 00230-AA) ===");
const cands = tabCandidates({ pn: "FR 00230-AA", baseNo: "FR 00230-AA", suffix: "AA", targetTab: "AA 30001-1" });
console.log("   candidates:", cands);
check("มี targetTab ที่ผู้ใช้กำหนดเป็นอันดับแรก", cands[0] === "AA 30001-1", cands[0]);
check("มีรูปแบบจากเลขใน P/N", cands.some((c) => /AA 00230/.test(c)), cands.filter((c)=>/00230/.test(c)).join(","));
check("ไม่มีชื่อว่าง", !cands.some((c) => c.trim() === "" || c.trim() === "AA"), "ok");
check("ไม่มีค่าซ้ำ", new Set(cands).size === cands.length, cands.length + " unique");

console.log("\n=== tabCandidates (baseNo แบบชีต 30001-1) ===");
const c2 = tabCandidates({ pn: "30001-1", baseNo: "30001-1", suffix: "AA", targetTab: "" });
console.log("   candidates:", c2);
check("ได้ชื่อมาตรฐาน", c2[0] === "AA 30001-1", c2[0]);

console.log("\n" + pass + "/" + (pass + fail) + " passed");
process.exit(fail ? 1 : 0);
