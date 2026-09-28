"""
เติมสูตรต้นทุนให้แท็บที่สร้างใหม่ใน 'BP18 FR Cost.xlsx'

แท็บที่คัดลอกจากไฟล์ต้นทุนเดิมมีสูตรอยู่แล้ว (ข้าม)
แท็บที่สร้างจากแม่พิมพ์ build_empty_sheet() มีตำแหน่งคงที่ จึงอ้างตรง ๆ ได้

สูตรต้นทางจากไฟล์ต้นทุนเดิม:  V1 = =Y78+S89+S99+U94+AA83
  Y78  ผลรวม Details        | S89  Process  (ป้ายอยู่ Q)
  S99  Tooling  (ป้ายอยู่ Q) | U94  Fastener (ป้ายอยู่ S)
  AA83 Material (ป้ายอยู่ Y)

ตำแหน่งในแท็บใหม่ (แม่พิมพ์ชนิด Part)
  W10 = 'Subtotal'  Y10 = ค่า Details
  Y14 = 'Sub Total' AA14 = ค่า Material
  Q19 = 'Sub Total' S19 = ค่า Process
  S24 = 'Sub Total' U24 = ค่า Fastener
  Q29 = 'Sub Total' S29 = ค่า Tooling

ยังรองรับแม่พิมพ์ชนิด Assembly (แท็บที่มีแถว Details ถึง r10 เหมือนกัน
แต่หัวหมวดขยับลงมาอีก 2 แถว) — ตรวจจากหัวหมวดจริงในแท็บนั้น
"""
import sys

import openpyxl
from openpyxl.utils import get_column_letter as gl

P = r"D:/hermes-workspace/fsae-cost-web/data/BP18 FR Cost.xlsx"

# ป้าย Sub Total -> คอลัมน์ที่เก็บค่า (ยืนยันจากไฟล์ต้นทุนเดิม)
VALUE_COL = {"Material": "AA", "Process": "S", "Fastener": "U", "Tooling": "S"}
DET_VAL = "Y"
DET_ROW = 10


def sec_header_row(ws, label):
    for r in range(1, min(ws.max_row, 140) + 1):
        a = ws.cell(r, 1).value
        c = ws.cell(r, 3).value
        if isinstance(a, str) and a.strip() == "Item Order" and \
           isinstance(c, str) and c.strip().lower() == label.strip().lower():
            return r
    return None


def sub_total_row(ws, after):
    """หาแถวที่มีป้าย 'Sub Total' ใต้หัวหมวด — ต้องเป็นคอลัมน์ป้ายจริงของหมวดนั้น"""
    for r in range(after + 1, min(after + 14, ws.max_row + 1)):
        for c in range(8, 26):
            v = ws.cell(r, c)
            if isinstance(v.value, str) and v.value.strip().lower() == "sub total":
                return r, c
    return None, None


def fill(ws):
    if isinstance(ws["V1"].value, str) and ws["V1"].value.startswith("="):
        return False, "มีสูตรอยู่แล้ว"

    refs = []
    # --- Details ---
    # ป้าย 'Subtotal' ของ Details อยู่คอลัมน์ W เสมอ (ค่าอยู่ที่ Y)
    # ห้ามหาด้วยการสแกนทั้งแถว เพราะคำว่า 'Subtotal' ยังปรากฏที่หัวตาราง Y7 ด้วย
    det_r = None
    for r in range(2, min(ws.max_row, 60) + 1):
        v = ws.cell(r, 23)
        if isinstance(v.value, str) and v.value.strip().lower() == "subtotal":
            det_r = r
            break
    if det_r is None:
        det_r = DET_ROW
    if not isinstance(ws.cell(det_r, 25).value, str):   # Y ยังไม่มีสูตร
        ws.cell(det_r, 25).value = "=SUMPRODUCT(N(%d:%d),R%d:R%d)" % (
            det_r - 2, det_r - 1, det_r - 2, det_r - 1)
    refs.append("%s%d" % (DET_VAL, det_r))

    # --- หมวดที่เหลือ: อ้างตำแหน่งตามหัวหมวดจริงในแท็บนั้น ---
    for label in ("Material", "Process", "Fastener", "Tooling"):
        hr = sec_header_row(ws, label)
        if hr is None:
            continue
        sr, sc = sub_total_row(ws, hr)
        if sr is None:
            continue
        vcol = VALUE_COL[label]
        first = hr + 1
        last = sr - 1
        if last < first:
            # ไม่มีรายการ — ผลรวมเป็นศูนย์
            ws.cell(sr, sc + 1).value = 0
        else:
            ws.cell(sr, sc + 1).value = "=SUM(%s%d:%s%d)" % (vcol, first, vcol, last)
        refs.append("%s%d" % (vcol, sr))

    if len(refs) < 5:
        return False, "อ่านหมวดได้แค่ %d/5" % len(refs)

    ws["V1"] = "=" + "+".join(refs)
    ws["V4"] = "=V1*V2"
    return True, " + ".join(refs)


def main():
    wb = openpyxl.load_workbook(P)
    done, skip, fail = 0, 0, []
    for t in wb.sheetnames:
        ok, why = fill(wb[t])
        if ok:
            done += 1
        elif why == "มีสูตรอยู่แล้ว":
            skip += 1
        else:
            fail.append((t, why))
    wb.save(P)
    print("ใส่สูตร: %d   ข้าม (มีอยู่แล้ว): %d   ไม่สำเร็จ: %d"
          % (done, skip, len(fail)))
    for f in fail[:8]:
        print("   ", f)

    wb = openpyxl.load_workbook(P)
    bad = [t for t in wb.sheetnames
           if not (isinstance(wb[t]["V1"].value, str) and wb[t]["V1"].value.startswith("="))]
    print("\nแท็บที่ยังไม่มีสูตร V1:", len(bad))
    print("แท็บเดิม  FR 00200-AA :", wb["FR 00200-AA"]["V1"].value)
    for t in ("FR 00502-AA", "FR 00803-AA"):
        if t in wb.sheetnames:
            print("แท็บใหม่  %-12s: %s" % (t, wb[t]["V1"].value))
    wb.close()
    return 1 if (bad or fail) else 0


if __name__ == "__main__":
    sys.exit(main())
