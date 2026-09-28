"""
แก้ตำแหน่งยอดรวมหมวด + สูตรรวม Details ในแท็บที่สร้างใหม่ (81 แท็บ)

บั๊กที่พบ (เจอตอนอ่านค่าจริงจาก Google Sheets ได้ #ERROR!)
  1) ป้าย 'Sub Total' กับช่องที่เก็บค่าห่างกัน 2 คอลัมน์ ไม่ใช่ 1
       Y14='Sub Total'  ค่าต้องอยู่ AA14   (แต่ถูกเขียนที่ Z14)
       Q19='Sub Total'  ค่าต้องอยู่ S19    (แต่ถูกเขียนที่ R19)
       S24='Sub Total'  ค่าต้องอยู่ U24    (แต่ถูกเขียนที่ T24)
       Q29='Sub Total'  ค่าต้องอยู่ S29    (แต่ถูกเขียนที่ R29)
     ยืนยันจากไฟล์ต้นทุนเดิม: Y83->AA83, Q89->S89, S94->U94, Q99->S99

  2) Details subtotal เขียนเป็น =SUMPRODUCT(N(8:N9),R8:R9)
     ฟังก์ชัน N() ไม่ทำงานแบบ array ใน Google Sheets -> #ERROR! Formula parse error
     เปลี่ยนเป็น =SUM(Y8:Y{ก่อนหน้า}) ซึ่งตรงกับไฟล์ต้นทุนเดิม (=SUM(Y8:Z77))

ยืนยันกับไฟล์ต้นทุนเดิมก่อนแก้: ต้องพบว่าค่าอยู่ห่างจากป้าย 2 คอลัมน์ทุกหมวด
"""
import sys

import openpyxl
from openpyxl.utils import get_column_letter as gl

P = r"D:/hermes-workspace/fsae-cost-web/data/BP18 FR Cost.xlsx"
SRC = r"D:/hermes-workspace/fsae-cost-web/data/ref. Body & Frame Cost BP16b.xlsx"

DET_TOP, COL_EXT = 8, 25
VALUE_COL = {"Material": "AA", "Process": "S", "Fastener": "U", "Tooling": "S"}
SECTIONS = ("Material", "Process", "Fastener", "Tooling")


def sec_header_row(ws, label):
    for r in range(DET_TOP, min(ws.max_row, 200) + 1):
        a, c = ws.cell(r, 1).value, ws.cell(r, 3).value
        if isinstance(a, str) and a.strip() == "Item Order" and \
           isinstance(c, str) and c.strip().lower() == label.strip().lower():
            return r
    return None


def sub_total_label(ws, after):
    """คืน (แถว, คอลัมน์ป้าย) — เฉพาะแถวที่อยู่ใต้หัวหมวด ไม่ใช่หัวตาราง"""
    for r in range(after + 1, min(after + 16, ws.max_row + 1)):
        for c in range(8, 26):
            v = ws.cell(r, c)
            if isinstance(v.value, str) and v.value.strip().lower() == "sub total":
                return r, c
    return None, None


def det_subtotal_row(ws):
    for r in range(DET_TOP, min(ws.max_row, 200) + 1):
        v = ws.cell(r, 23)
        if isinstance(v.value, str) and v.value.strip().lower() == "subtotal":
            return r
    return None


def verify_against_source():
    """ยืนยันว่าระยะป้าย->ค่า = 2 คอลัมน์ จากไฟล์ต้นทุนเดิมก่อนแก้จริง"""
    src = openpyxl.load_workbook(SRC)
    seen = {}
    for t in src.sheetnames[:40]:
        ws = src[t]
        for label in SECTIONS:
            hr = sec_header_row(ws, label)
            if hr is None:
                continue
            sr, sc = sub_total_label(ws, hr)
            if sr is None:
                continue
            for vc in range(sc + 1, min(sc + 5, ws.max_column + 1)):
                if ws.cell(sr, vc).value is not None:
                    seen.setdefault(label, set()).add(vc - sc)
                    break
    src.close()
    return seen


def main():
    print("ระยะห่างป้าย -> ค่า ที่ยืนยันจากไฟล์ต้นทุนเดิม:")
    off = verify_against_source()
    for k, v in off.items():
        print("   %-9s %s" % (k, sorted(v)))
    good = all(2 in v for v in off.values())
    if not good:
        print("ตรวจไม่ผ่าน: ระยะไม่ใช่ 2 ทุกหมวด — ยกเลิก")
        return 1
    print("   -> ยืนยันแล้วว่าเป็น 2 คอลัมน์\n")

    wb = openpyxl.load_workbook(P)
    fixed = 0
    for t in wb.sheetnames:
        ws = wb[t]
        det = det_subtotal_row(ws)
        if det is None:
            continue
        # 1) Details subtotal
        old = ws.cell(det, COL_EXT).value
        if isinstance(old, str) and "SUMPRODUCT" in old.upper():
            ws.cell(det, COL_EXT).value = "=SUM(Y%d:Y%d)" % (DET_TOP, det - 1)
        refs = ["Y%d" % det]
        # 2) ยอดรวมหมวด — ย้ายจากป้าย+1 ไปป้าย+2
        for label in SECTIONS:
            hr = sec_header_row(ws, label)
            if hr is None:
                continue
            sr, sc = sub_total_label(ws, hr)
            if sr is None:
                continue
            wrong = ws.cell(sr, sc + 1)
            right = ws.cell(sr, sc + 2)
            if isinstance(wrong.value, str) and wrong.value.startswith("=SUM") \
               and right.value is None:
                right.value = wrong.value
                wrong.value = None
                fixed += 1
            vcol = VALUE_COL[label]
            first, last = hr + 1, sr - 1
            if right.value is None:
                right.value = 0 if last < first else \
                    "=SUM(%s%d:%s%d)" % (vcol, first, vcol, last)
            # แก้ชื่อคอลัมน์ในสูตรให้ตรงคอลัมน์ที่วางจริง
            if isinstance(right.value, str):
                right.value = right.value.replace(
                    "SUM(%s%d:" % (vcol, first), "SUM(%s%d:" % (gl(sc + 2), first))
            refs.append("%s%d" % (gl(sc + 2), sr))
        ws["V1"] = "=" + "+".join(refs)
        ws["V4"] = "=V1*V2"

    wb.save(P)
    print("ย้ายยอดรวมหมวด: %d ช่อง" % fixed)

    wb = openpyxl.load_workbook(P)
    print("\nตรวจซ้ำ — ต้องไม่มี SUMPRODUCT และไม่มีสูตรค้างในคอลัมน์ป้าย+1")
    bad = 0
    for t in wb.sheetnames:
        ws = wb[t]
        for row in ws.iter_rows():
            for c in row:
                if isinstance(c.value, str) and "SUMPRODUCT(N(" in c.value.upper():
                    print("   ยังมี SUMPRODUCT:", t, c.coordinate)
                    bad += 1
    print("   พบ:", bad)
    for t in ("FR 00502-AA", "FR 00803-AA", "FR 00200-AA"):
        if t in wb.sheetnames:
            ws = wb[t]
            print("\n   %s  V1 = %s" % (t, ws["V1"].value))
            det = det_subtotal_row(ws)
            print("      Y%d = %s" % (det, ws.cell(det, COL_EXT).value))
            for label in SECTIONS:
                hr = sec_header_row(ws, label)
                if hr is None:
                    continue
                sr, sc = sub_total_label(ws, hr)
                print("      %-9s %s%d = %s" % (label, gl(sc + 2), sr,
                                                ws.cell(sr, sc + 2).value))
    wb.close()
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
