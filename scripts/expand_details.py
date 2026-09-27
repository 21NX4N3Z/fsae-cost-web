"""
ขยายพื้นที่ Details ของแท็บแม่ให้รองรับชิ้นใหม่ตาม BOM BP18

พื้นฐาน: พื้นที่ Details ในไฟล์ต้นทุนเดิมเท่ากับจำนวนชิ้นของ BP16b พอดี
  FR 00200 subtotal r78 (70 ช่อง) | FR 00300 r36 (28) | FR 00500 r10 (2)
  FR 00700 r15 (7) | FR 00800 r10 (2) | FR 01000 r15 (7)
แต่ BP18 เพิ่มชิ้นใหม่ ทำให้พื้นที่ไม่พอ

openpyxl ไม่ปรับสูตรเมื่อ insert_rows จึงต้องเขียนสูตรกลับเองทั้งแท็บ:
  1. แทรกแถวตรงตำแหน่ง Subtotal ของ Details
  2. เติมรายการชิ้นใหม่ (L=ลำดับ N=ชื่อ R=อ้างแท็บ W=1 Y=R*W)
  3. เขียนสูตรใหม่ทั้งหมดของแท็บ:
     - Subtotal ของ Details  =SUM(Y8:Y{n-1})
     - Sub Total ของแต่ละหมวด =SUM(<คอลัมน์ค่า><แถวแรก>:<คอลัมน์ค่า><แถวก่อนหน้า>)
     - V1  =Y{รายละเอียด}+AA{วัสดุ}+S{กระบวนการ}+U{อะไหล่}+S{เครื่องมือ}
     - V4  =V1*V2
"""
import json
import re
import sys

import openpyxl

P = r"D:/hermes-workspace/fsae-cost-web/data/BP18 FR Cost.xlsx"
BOM = r"D:/hermes-workspace/fsae-cost-web/data/bom.json"

DET_TOP = 8
COL_ORDER, COL_PART, COL_COST, COL_QTY, COL_EXT = 12, 14, 18, 23, 25   # L N R W Y
REF = re.compile(r"'([^']+)'!")
# ป้าย Sub Total ของแต่ละหมวด -> คอลัมน์ที่เก็บค่า (ยืนยันจากไฟล์ต้นทุนเดิม)
VALUE_COL = {"Material": "AA", "Process": "S", "Fastener": "U", "Tooling": "S"}
SECTIONS = ("Material", "Process", "Fastener", "Tooling")


def key(pn):
    m = re.search(r"(\d{4,5})", pn or "")
    return "FR %s-AA" % m.group(1).zfill(5) if m else None


def det_subtotal_row(ws):
    """แถวที่คอลัมน์ W มีคำว่า 'Subtotal' — คือบรรทัดรวมของ Details"""
    for r in range(DET_TOP, min(ws.max_row, 200) + 1):
        v = ws.cell(r, 23)
        if isinstance(v.value, str) and v.value.strip().lower() == "subtotal":
            return r
    return None


def sec_header_row(ws, label):
    for r in range(DET_TOP, min(ws.max_row, 200) + 1):
        a, c = ws.cell(r, 1).value, ws.cell(r, 3).value
        if isinstance(a, str) and a.strip() == "Item Order" and \
           isinstance(c, str) and c.strip().lower() == label.strip().lower():
            return r
    return None


def sub_total_cell(ws, after):
    for r in range(after + 1, min(after + 16, ws.max_row + 1)):
        for c in range(8, 26):
            v = ws.cell(r, c)
            if isinstance(v.value, str) and v.value.strip().lower() == "sub total":
                return r, c
    return None, None


def label(partname, tab):
    """ชิ้นที่ BOM ไม่มีชื่อ ให้ใช้ P/N แทน ไม่เว้นว่างทั้งแถว
       (ข้อมูลต้นทางไม่มีชื่อจริง ไม่ควรแต่งชื่อเอง)"""
    n = (partname.get(tab) or "").strip()
    return n if n else tab


def rewrite(ws):
    """เขียนสูตรของแท็บทั้งใบใหม่ทั้งหมด"""
    det = det_subtotal_row(ws)
    if det is None:
        return None
    # Details subtotal
    if det > DET_TOP:
        ws.cell(det, COL_EXT).value = "=SUM(Y%d:Y%d)" % (DET_TOP, det - 1)
    refs = ["Y%d" % det]

    for label in SECTIONS:
        hr = sec_header_row(ws, label)
        if hr is None:
            continue
        sr, sc = sub_total_cell(ws, hr)
        if sr is None:
            continue
        vcol = VALUE_COL[label]
        first, last = hr + 1, sr - 1
        if last < first:
            ws.cell(sr, sc + 1).value = 0
        else:
            ws.cell(sr, sc + 1).value = "=SUM(%s%d:%s%d)" % (vcol, first, vcol, last)
        refs.append("%s%d" % (vcol, sr))

    ws["V1"] = "=" + "+".join(refs)
    ws["V4"] = "=V1*V2"
    return det


def main():
    bom = json.load(open(BOM, encoding="utf-8"))
    wb = openpyxl.load_workbook(P)

    # แม่ -> แท็บ
    roll = {}
    for pl in bom.values():
        for p in pl:
            if p[1] in bom and p[1] not in roll:
                t = key(p[0])
                if t in wb.sheetnames:
                    roll[p[1]] = t

    print("%-14s %-30s %-7s %-7s %s" % ("แท็บแม่", "Assembly", "เดิม", "ต้อง", "ผล"))
    print("-" * 80)
    changed = 0
    for asm, tab in sorted(roll.items(), key=lambda x: x[1]):
        ws = wb[tab]
        want = [t for t in (key(p[0]) for p in bom[asm]) if t and t in wb.sheetnames and t != tab]
        if not want:
            continue
        det = det_subtotal_row(ws)
        if det is None:
            print("%-14s %-30s ไม่พบแถว Subtotal ของ Details — ข้าม" % (tab, asm[:30]))
            continue
        cap = det - DET_TOP
        # ชิ้นที่มีอยู่แล้วใน Details
        have = set()
        for r in range(DET_TOP, det):
            v = ws.cell(r, COL_COST).value
            if isinstance(v, str):
                m = REF.search(v)
                if m:
                    have.add(m.group(1))
        lacking = [t for t in want if t not in have]

        if cap >= len(want):
            # ที่ว่างพอ ไม่ต้องแทรกแถว แค่เติมชิ้นที่ยังไม่มีลงช่องว่าง
            if not lacking:
                continue
            free = [r for r in range(DET_TOP, det)
                    if not isinstance(ws.cell(r, COL_COST).value, str)]
            if len(free) < len(lacking):
                print("%-14s %-30s ที่ว่างไม่พอ (%d/%d) - ข้าม"
                      % (tab, asm[:30], len(free), len(lacking)))
                continue
            partname = {key(p[0]): p[1] for p in bom[asm] if key(p[0])}
            order = {}
            for i, t in enumerate(want):
                order[t] = i
            # เก็บชื่อแท็บไว้ด้วย อย่าใช้แค่เลขลำดับ
            # (เคยพลาด: for t, r in rows ได้ t เป็นเลขลำดับ ทำให้เขียน ='58'!V1)
            rows = sorted(
                [(order.get(t, 99), r, t) for t, r in zip(lacking, free)])
            for _ord, r, t in rows:
                ws.cell(r, COL_ORDER).value = _ord + 1
                ws.cell(r, COL_PART).value = label(partname, t)
                ws.cell(r, COL_COST).value = "='%s'!V1" % t
                ws.cell(r, COL_QTY).value = 1
                ws.cell(r, COL_EXT).value = "=R%d*W%d" % (r, r)
            rewrite(ws)
            changed += 1
            print("%-14s %-30s %-7d %-7d เติมช่องว่าง %d แถว"
                  % (tab, asm[:30], cap, len(want), len(lacking)))
            continue

        add = len(want) - cap
        partname = {key(p[0]): p[1] for p in bom[asm] if key(p[0])}

        # เก็บรายการเดิมก่อนแทรกแถว
        old = []
        for r in range(DET_TOP, det):
            old.append((ws.cell(r, COL_PART).value, ws.cell(r, COL_COST).value,
                        ws.cell(r, COL_QTY).value))
        have = set()
        for _, c, _ in old:
            if isinstance(c, str):
                m = REF.search(c)
                if m:
                    have.add(m.group(1))
        seq = [t for t in want if t in have] + [t for t in want if t not in have]

        ws.insert_rows(det, add)

        for i, t in enumerate(seq):
            r = DET_TOP + i
            ws.cell(r, COL_ORDER).value = i + 1
            ws.cell(r, COL_PART).value = label(partname, t)
            ws.cell(r, COL_COST).value = "='%s'!V1" % t
            ws.cell(r, COL_QTY).value = 1
            ws.cell(r, COL_EXT).value = "=R%d*W%d" % (r, r)
        for r in range(DET_TOP + len(seq), det + add):
            for c in (COL_ORDER, COL_PART, COL_COST, COL_QTY, COL_EXT):
                ws.cell(r, c).value = None

        nd = rewrite(ws)
        changed += 1
        print("%-14s %-30s %-7d %-7d +%d แถว" % (tab, asm[:30], cap, len(want), add))

    wb.save(P)
    print("\nแท็บที่ขยาย: %d" % changed)

    # ตรวจซ้ำ
    wb = openpyxl.load_workbook(P)
    keep = set(wb.sheetnames)
    bad = 0
    for asm, tab in roll.items():
        ws = wb[tab]
        want = set(t for t in (key(p[0]) for p in bom[asm]) if t and t in keep and t != tab)
        got = set()
        det = det_subtotal_row(ws)
        for r in range(DET_TOP, det or 100):
            v = ws.cell(r, COL_COST).value
            if isinstance(v, str):
                m = REF.search(v)
                if m and m.group(1) in keep:
                    got.add(m.group(1))
        if want - got:
            print("  ยังขาด %s: %s" % (tab, sorted(want - got)[:4]))
            bad += 1
    print("แท็บแม่ที่ยังขาดชิ้น:", bad)
    for t in ("FR 00200-AA", "FR 00500-AA", "FR 00800-AA"):
        if t in wb.sheetnames:
            print("  %s V1 = %s" % (t, wb[t]["V1"].value))
    wb.close()
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
