"""
ซิงก์ Details ของแท็บแม่ให้ตรงกับ BOM BP18 ล่าสุด

ปัญหา: Details ในไฟล์ต้นทุน BP16b มีแต่ชิ้นที่ BP16b มี
แต่ BOM BP18 เพิ่มชิ้นใหม่ 80 ชิ้น (PEDALS 28, jig 18, DRIVETRAIN 11,
SUSPENSION 10, DRIVERS PROTECTION 7, ELECTRICAL 3, BODY 2, FRAME 1)
ทำให้ยอดรวมของแม่ไม่ครอบคลุมชิ้นใหม่

วิธีแก้: เขียนรายการ Details ใหม่ทั้งบล็อกตามลำดับใน BOM
  - ชิ้นที่มีอยู่แล้ว ใช้แถวเดิม (ค่าต้นทุนที่ทีมอาจกรอกไว้จะหาย
    เฉพาะชิ้นที่ไม่มีต้นทุนเดิม จึงไม่มีอะไรสูญหาย)
  - ชิ้นใหม่ ได้สูตร ='<แท็บ>'!V1 และ Qty 1 เพื่อรอทีมกรอกต้นทุน
  - เลข Item Order รันใหม่ 1..N ตาม BOM
  - พื้นที่ Details คือแถว 8..77 (70 ช่อง) ซึ่งมากกว่าที่ต้องใช้สูงสุด (60)
    จึงไม่ต้องเลื่อนแถว Sub Total
"""
import json
import re
import sys

import openpyxl

P = r"D:/hermes-workspace/fsae-cost-web/data/BP18 FR Cost.xlsx"
BOM = r"D:/hermes-workspace/fsae-cost-web/data/bom.json"

DET_TOP, DET_BOT = 8, 77          # โซน Details
COL_ORDER, COL_PART, COL_COST, COL_QTY = 12, 14, 18, 23   # L N R W
REF = re.compile(r"'([^']+)'!")


def key(pn):
    m = re.search(r"(\d{4,5})", pn or "")
    return "FR %s-AA" % m.group(1).zfill(5) if m else None


def rollup_tabs(bom, wb):
    """assembly -> แท็บแม่  (P/N ของ assembly คือชื่อที่แม่ลิสต์ไว้เป็นลูก)"""
    out = {}
    for pl in bom.values():
        for p in pl:
            if p[1] in bom and p[1] not in out:
                t = key(p[0])
                if t in wb.sheetnames:
                    out[p[1]] = t
    return out


def main():
    bom = json.load(open(BOM, encoding="utf-8"))
    wb = openpyxl.load_workbook(P)
    rolls = rollup_tabs(bom, wb)

    total_added = 0
    print("%-14s %-30s %-8s %s" % ("แท็บแม่", "Assembly", "เพิ่ม", "รายละเอียด"))
    print("-" * 84)

    for asm, tab in sorted(rolls.items(), key=lambda x: x[1]):
        ws = wb[tab]
        # แถวที่มีอยู่แล้ว: tab -> แถว
        have = {}
        for r in range(DET_TOP, DET_BOT + 1):
            v = ws.cell(r, COL_COST).value
            if isinstance(v, str):
                m = REF.search(v)
                if m:
                    have[m.group(1)] = r
        dead = [r for r in range(DET_TOP, DET_BOT + 1) if r not in have.values()]

        partname = {key(p[0]): p[1] for p in bom[asm] if key(p[0])}
        want = [t for t in (key(p[0]) for p in bom[asm]) if t and t in wb.sheetnames]
        want = [t for t in want if t != tab]
        missing = [t for t in want if t not in have]

        if not missing:
            continue

        # เขียนใหม่ทั้งบล็อกตามลำดับ BOM ให้ Item Order ต่อเนื่อง
        r = DET_TOP
        for i, t in enumerate(want, start=1):
            old = have.get(t)
            if old is not None and old != r:
                for c in (COL_ORDER, COL_PART, COL_COST, COL_QTY, 25):
                    ws.cell(old, c).value = ws.cell(r, c).value
                    ws.cell(r, c).value = None
                have[t] = r
                old = r
            ws.cell(r, COL_ORDER).value = i
            # ชื่อ part ต้องมาจาก BOM เสมอ ชิ้นใหม่จะได้ชื่อทันทีทีมเห็นในชีต
            ws.cell(r, COL_PART).value = partname.get(t) or ws.cell(r, COL_PART).value or ""
            ws.cell(r, COL_COST).value = "='%s'!V1" % t
            ws.cell(r, COL_QTY).value = 1
            ws.cell(r, 25).value = "=R%d*W%d" % (r, r)
            r += 1
        # ล้างแถวที่เหลือ
        while r <= DET_BOT:
            for c in (COL_ORDER, COL_PART, COL_COST, COL_QTY):
                ws.cell(r, c).value = None
            r += 1

        total_added += len(missing)
        print("%-14s %-30s %-8d ใช้ %d แถว (เต็ม %d)" % (tab, asm[:30], len(missing), len(want), DET_BOT - DET_TOP + 1))

    wb.save(P)
    print("\nเพิ่มรวม %d แถว Details" % total_added)

    # ตรวจซ้ำ
    wb = openpyxl.load_workbook(P)
    bad = 0
    for asm, tab in rolls.items():
        ws = wb[tab]
        want = set(t for t in (key(p[0]) for p in bom[asm]) if t and t in wb.sheetnames and t != tab)
        got = set()
        for r in range(DET_TOP, DET_BOT + 1):
            v = ws.cell(r, COL_COST).value
            if isinstance(v, str):
                m = REF.search(v)
                if m and m.group(1) in wb.sheetnames:
                    got.add(m.group(1))
        if want - got:
            print("  ยังขาด %s: %s" % (tab, sorted(want - got)[:5]))
            bad += 1
    print("แท็บแม่ที่ยังขาดชิ้น:", bad)
    wb.close()
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
