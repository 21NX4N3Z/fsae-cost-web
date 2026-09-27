"""
สร้าง bom.json จาก 'BP18 Part BOM-2.xlsx' แผ่น FRAME — BP18 / EV-04

โครงสร้างจริงของแผ่น (ยืนยันจากการสแกนทุกบรรทัด):
  - คอลัมน์ C แถว 1-11  = รายการ assembly หลัก 11 รายการ ไม่มี part list
  - แถว 1-3             = หัวบล็อก แต่ละบล็อกคือ 1 assembly มี P/N อยู่ท้ายแถว 1
  - แถว 1-3 ในบล็อก    = ป้ายคอลัมน์ Material / Process / Drawing / Cost
  - แถว 4 ลงไป         = part แต่ละบรรทัด ความกว้างจบที่คอลัมน์ของบล็อกถัดไป
  - คอลัมน์ BU แถว 4+   = jig ย่อย FR A0801-AA .. FR A0820-AA

ชื่อ assembly บางตัวอยู่ใน merged cell ที่คอลัมน์ก่อนหน้าว่าง จึงต้องมองย้อนหลัง
P/N บางชิ้นพิมพ์ตกขีด (FR 00514AA) ต้อง normalize
ชื่อ 'SUSPENSION MOUNTING ASBody SEMBLY' เป็นข้อมูลเสียในไฟล์ต้นทาง ต้องซ่อม
"""
import json
import re
import sys

import openpyxl

SRC = r"D:/hermes-workspace/fsae-cost-web/data/BP18 Part BOM-2.xlsx"
OUT = r"D:/hermes-workspace/fsae-cost-web/data/bom.json"

# P/N ระดับ assembly (FR A0100-AA) และระดับ part (FR 00201-AA)
ASM = re.compile(r"^FR\s*A(\d{4})\s*-?\s*AA$", re.I)
# ยอมรับทั้ง FR 00514AA และ FR 00514-AA
PRT = re.compile(r"^FR\s*(\d{4,5})\s*-?\s*AA$", re.I)
MAX_ROW = 400

# ซ่อมชื่อที่เสียในไฟล์ต้นทาง
NAME_FIX = {
    "SUSPENSION MOUNTING ASBody SEMBLY": "SUSPENSION MOUNTING ASSEMBLY",
    "Electrical MOUNTING ASSEMBLY": "ELECTRICAL MOUNTING ASSEMBLY",
    "DRIVERS PROTECTION MOUNTING": "DRIVERS PROTECTION MOUNTING ASSEMBLY",
    "FR Drivers PROTECTION MOUNTING": "DRIVERS PROTECTION MOUNTING ASSEMBLY",
}


def norm(v):
    if v is None:
        return ""
    return re.sub(r"\s+", " ", str(v)).replace("\u00a0", " ").strip()


def fix_name(n):
    n = norm(n)
    return NAME_FIX.get(n, n)


def can_pn(v):
    """คืน P/N ที่ normalize แล้ว หรือ '' ถ้าไม่ใช่ part"""
    m = PRT.match(norm(v))
    return "FR %s-AA" % m.group(1) if m else ""


def label_left(ws, r, col):
    """ชื่ออยู่ทางซ้ายของคอลัมน์ P/N แต่ช่องระหว่างอาจว่าง (merged cell)"""
    for nc in range(col - 1, max(col - 6, 0), -1):
        nv = norm(ws.cell(r, nc).value)
        if nv and not ASM.match(nv) and not PRT.match(nv):
            return nv
    return ""


def main():
    wb = openpyxl.load_workbook(SRC, data_only=True)
    ws = wb["FRAME"]
    max_col = ws.max_column

    # ---- 1) หัวบล็อกในแถว 1 ----
    blocks = []
    for c in range(1, max_col + 1):
        if ASM.match(norm(ws.cell(1, c).value)):
            nm = label_left(ws, 1, c)
            if nm:
                blocks.append({"pn_col": c, "name": fix_name(nm),
                               "pn": norm(ws.cell(1, c).value)})
    blocks.sort(key=lambda b: b["pn_col"])
    for i, b in enumerate(blocks):
        b["end_col"] = (blocks[i + 1]["pn_col"] - 1) if i + 1 < len(blocks) else max_col
    print("บล็อกในแถว 1: %d" % len(blocks))

    # ---- 2) assembly หลักจากคอลัมน์ C (รายการตั้งต้น) ----
    master = []
    for r in range(1, 40):
        v = norm(ws.cell(r, 3).value)
        if ASM.match(v):
            master.append({"name": fix_name(label_left(ws, r, 3)), "pn": v})
    print("assembly หลัก (คอลัมน์ C): %d" % len(master))

    # ---- 3) ป้ายคอลัมน์ของแต่ละบล็อก (อ่านแถว 1-3) ----
    WANT = {"material": re.compile(r"^material$", re.I),
            "process": re.compile(r"^process$", re.I),
            "drawing": re.compile(r"^drawing$", re.I),
            "cost": re.compile(r"^cost$", re.I)}
    for b in blocks:
        cols = {}
        for r in (1, 2, 3):
            for c in range(b["pn_col"] + 1, b["end_col"] + 1):
                v = norm(ws.cell(r, c).value)
                for k, rx in WANT.items():
                    if k not in cols and rx.match(v):
                        cols[k] = c
            # ป้ายสถานะอยู่แถว 2 (Drawing / Cost) บางบล็อก
        b["cols"] = cols
    print("ป้ายคอลัมน์:", {b["name"][:18]: b["cols"] for b in blocks})

    # ---- 4) ดึง part ----
    bom = {}
    for b in blocks:
        cols = b["cols"]
        rows = []
        for r in range(2, MAX_ROW + 1):
            v = norm(ws.cell(r, b["pn_col"]).value)
            if not v:
                continue
            if ASM.match(v):
                # jig ย่อย เก็บเป็น part ของบล็อกแม่
                rows.append([norm(v), fix_name(label_left(ws, r, b["pn_col"])),
                             "", "", ""])
                continue
            pn = can_pn(v)
            if not pn:
                continue
            # แถวแรกของบล็อกมีชื่อคอลัมน์ทับอยู่บน part ตัวแรก — ชื่อคอลัมน์ไม่ใช่ค่า
            def cell(key):
                if key not in cols:
                    return ""
                v = norm(ws.cell(r, cols[key]).value)
                if v.lower() in ("material", "process", "drawing", "cost",
                                 "assigned to", "checked by", "status"):
                    return ""
                return v

            material = cell("material")
            process = cell("process")
            drawing = cell("drawing")
            cost = cell("cost")
            rows.append([pn, fix_name(label_left(ws, r, b["pn_col"])),
                         material, drawing, cost])
        key = b["name"]
        if key in bom:
            seen = {x[0] for x in bom[key]}
            bom[key].extend([x for x in rows if x[0] not in seen])
        else:
            bom[key] = rows

    wb.close()

    # ---- 5) assembly ที่ไม่มีบล็อก part ยังต้องแสดงผล (เป็นรายการว่าง) ----
    have = {k.upper() for k in bom}
    for m in master:
        if m["name"].upper() not in have:
            bom[m["name"]] = []

    total = sum(len(v) for v in bom.values())
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(bom, f, ensure_ascii=False, indent=1)

    print("\nเขียน %s" % OUT)
    print("assembly: %d   part รวม: %d\n" % (len(bom), total))
    for k, v in bom.items():
        mats = {}
        for x in v:
            if x[2]:
                mats[x[2]] = mats.get(x[2], 0) + 1
        done = sum(1 for x in v if x[3] == "DONE")
        top = ", ".join("%s x%d" % (m, n) for m, n in
                        sorted(mats.items(), key=lambda kv: -kv[1])[:2]) or "-"
        print("  %-36s %3d  | %-34s | DWG %d/%d"
              % (k[:36], len(v), top[:34], done, len(v)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
