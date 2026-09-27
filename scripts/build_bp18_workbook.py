"""
สร้าง 'data/BP18 FR Cost.xlsx' — สมุดต้นทุนสะอาดสำหรับ BP18 (EV-04)

หลักการ
  - เริ่มจากไฟล์ต้นทุน BP16b เพื่อให้ได้สูตร/รูปแบบเดิมทั้งหมด
  - เก็บเฉพาะแท็บของ part ที่อยู่ใน BOM BP18
  - part ที่ยังไม่มีต้นทุน -> สร้างแท็บใหม่จากแม่พิมพ์ (Cost Template / Part)
  - ตัดแท็บที่ไม่เกี่ยว (A 3000, 0000, AA 3001-59, 'สำเนาของ ...')
  - เปลี่ยน Car # จาก EV-02 เป็น EV-04

โครงสร้างแม่พิมพ์ชนิด Part (ยืนยันจาก Cost Template.xlsx)
  แถว 1-6  หัวเรื่อง  |  แถว 11 Material | แถว 16 Process
  แถว 21 Fastener   |  แถว 26 Tooling
  ป้าย Sub Total: Material=Y  Process=Q  Fastener=S  Tooling=Q
"""
import json
import re
import sys

import openpyxl
from openpyxl.styles import Font
from openpyxl.utils import get_column_letter as gl

ROOT = r"D:/hermes-workspace/fsae-cost-web"
BOM = ROOT + "/data/bom.json"
COSTS = ROOT + "/data/costs.json"
SRC16 = ROOT + "/data/ref. Body & Frame Cost BP16b.xlsx"
TPL = ROOT + "/data/Cost Template.xlsx"
OUT = ROOT + "/data/BP18 FR Cost.xlsx"

CAR = "EV-04"
UNI = "King Mongkut's University of Techonology Thonburi"

# แม่พิมพ์ชนิด Part: (หัวแถว, ป้าย Sub Total อยู่คอลัมน์, ค่าอยู่คอลัมน์)
TPL_PART = [("Material", 11, "Y", "AA"), ("Process", 16, "Q", "S"),
            ("Fastener", 21, "S", "U"), ("Tooling", 26, "Q", "S")]


def key_of(pn):
    m = re.search(r"(\d{4,5})", pn or "")
    return "FR " + m.group(1).zfill(5) if m else None


def tab_name(pn):
    """'FR 00201-AA' -> 'FR 00201-AA'  |  'FR A0200-AA' -> 'FR 00200-AA'
       ต้องเก็บ suffix -AA ไว้เสมอ ไม่งั้นชื่อแท็บจะไม่ตรงกับไฟล์ต้นทุนเดิม"""
    k = key_of(pn)
    return (k + "-AA") if k else pn


def clean_title(t):
    return t.strip()


def build_empty_sheet(wb, pn, part_name, assembly):
    """สร้างแท็บตามแม่พิมพ์ สำหรับ part ที่ยังไม่มีต้นทุน"""
    ws = wb.create_sheet("TMPPLACEHOLDER")
    ws.title = tab_name(pn)

    ws["A1"] = "University";  ws["C1"] = UNI
    ws["A2"] = "System";      ws["C2"] = "FR"
    ws["A3"] = "Assembly";    ws["C3"] = assembly
    ws["A4"] = "Part";        ws["C4"] = part_name
    m = re.search(r"(\d{4,5})", pn)
    ws["A5"] = "P/N Base";    ws["C5"] = m.group(1) if m else ""
    ws["A6"] = "Suffix";      ws["C6"] = "AA"
    ws["L1"] = "Car #";       ws["N1"] = CAR

    ws["L3"] = "Filelink1"; ws["L4"] = "Filelink 2"; ws["L5"] = "Filelink 3"
    ws["A7"] = "Details"
    ws["L7"] = "Item Order"; ws["N7"] = "Part"
    ws["R7"] = "Part Cost";  ws["W7"] = "Quantity"; ws["Y7"] = "Subtotal"
    # รายการย่อย 1 แถว + subtotal
    ws["L8"] = 1
    ws["W10"] = "Subtotal"
    ws["Y10"] = "=SUMPRODUCT(N({first}8:N9),R8:R9)".replace("{first}", "")

    heads = {
        "Material": ["Item Order", "Material", "Use", "Unit Cost", "Size ( 1 )",
                     "Unit ( 1 )", "Size ( 2 )", "Unit ( 2 )", "Area Name",
                     "Area", "Length", "Density", "Quantity", "Sub Total"],
        "Process": ["Item Order", "Process", "Use", "Unit Cost", "Unit",
                    "Quantity", "Multiplier", "Mult. Val.", "Sub Total"],
        "Fastener": ["Item Order", "Fastener", "Use", "Unit Cost", "Size ( 1 )",
                     "Unit ( 1 )", "Size ( 2 )", "Unit ( 2 )", "Quantity", "Sub Total"],
        "Tooling": ["Item Order", "Tooling", "Use", "Unit Cost", "Unit",
                    "Quantity", "PVF", "Frac Incld.", "Sub Total"],
    }
    cols = ["A", "C", "F", "I", "K", "M", "O", "Q", "S", "U", "V", "W", "Y", "AA"]

    for label, hr, sublab, subval in TPL_PART:
        for cl, txt in zip(cols, heads[label]):
            ws["%s%d" % (cl, hr)] = txt
        ws["%s%d" % (sublab, hr + 3)] = "Sub Total"
    return ws


def main():
    bom = json.load(open(BOM, encoding="utf-8"))
    costs = json.load(open(COSTS, encoding="utf-8"))["byPn"]

    wb = openpyxl.load_workbook(SRC16)

    # ---- รวบรวม part ที่ต้องการ ----
    want = {}          # tab_name -> (pn, part, assembly, source_tab or None)
    for asm, plist in bom.items():
        for p in plist:
            pn, name = p[0], p[1]
            tn = tab_name(pn)
            if tn in want:
                continue
            src = costs.get(key_of(pn))
            want[tn] = (pn, name, asm, src["tab"] if src else None)

    print("part ที่ต้องการรวม: %d" % len(want))
    have_src = sum(1 for v in want.values() if v[3])
    print("  มีแท็บต้นทุนเดิม: %d   ต้องสร้างใหม่: %d" % (have_src, len(want) - have_src))

    # ---- ลบทุกแท็บเดิมทิ้ง แล้วสร้างใหม่ตามลำดับที่ต้องการ ----
    src_names = {}
    for tn, (pn, name, asm, src) in want.items():
        if src and src in wb.sheetnames:
            src_names[tn] = src
    # อ่านค่าหัวเรื่องของแท็บต้นทางไว้ก่อนลบ
    header_cache = {}
    for tn, src in src_names.items():
        ws = wb[src]
        header_cache[tn] = {
            "system": ws["C2"].value, "assembly": ws["C3"].value,
            "part": ws["C4"].value, "pnBase": ws["C5"].value,
            "suffix": ws["C6"].value,
        }

    for name in list(wb.sheetnames):
        del wb[name]

    order = []
    # 1) สร้างใหม่ทีละแท็บ โดยคัดลอกแท็บต้นทางมาไว้ชั่วคราว
    keep = {}
    for tn, (pn, name, asm, src) in want.items():
        if src and src in src_names.values():
            # มีแท็บต้นทาง -> ห้ามเขียนแม่พิมพ์ทับ เพราะแม่พิมพ์วางหัวตารางที่แถว
            # 11/16/21/26 ซึ่งเป็นแถวข้อมูล Details ของแท็บต้นทาง เอื้อกันสลับค่า
            ws = wb.create_sheet(tn)
        else:
            ws = build_empty_sheet(wb, pn, name, asm)
        keep[tn] = ws
        order.append(tn)

    # 2) คัดลอกเนื้อหาจากแท็บต้นทางทับลงแท็บใหม่ (ค่า + สูตร)
    #    เขียนทับเฉพาะเซลล์ที่ต้นทางมีข้อมูล
    src_wb = openpyxl.load_workbook(SRC16, data_only=False)
    copied = 0
    for tn, (pn, name, asm, src) in want.items():
        if not src or src not in src_wb.sheetnames:
            continue
        s = src_wb[src]
        d = keep[tn]
        for r in range(1, s.max_row + 1):
            for c in range(1, s.max_column + 1):
                cell = s.cell(r, c)
                if cell.value is None:
                    continue
                d.cell(r, c).value = cell.value
                if cell.has_style:
                    d.cell(r, c)._style = cell._style
        # ปรับหัวเรื่องให้เป็น BP18
        h = header_cache[tn]
        d["C3"] = asm
        d["C4"] = name or h["part"]
        d["C5"] = re.sub(r"^A?(\d{4,5})$", r"\1", str(h["pnBase"] or ""))
        d["C6"] = h["suffix"] or "AA"
        d["N1"] = CAR
        copied += 1
    src_wb.close()

    wb.save(OUT)
    print("\nคัดลอกเนื้อหาจากแท็บต้นทาง: %d แท็บ" % copied)
    print("เขียน %s" % OUT)
    print("แท็บทั้งหมด: %d" % len(wb.sheetnames))
    print("แท็บ 5 ตัวแรก:", wb.sheetnames[:5])
    return 0


if __name__ == "__main__":
    sys.exit(main())
