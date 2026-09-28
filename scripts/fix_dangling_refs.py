"""
แก้สูตรที่อ้างแท็บซึ่งไม่มีอยู่จริง (#REF!)

สาเหตุ: ไฟล์ต้นทุน BP16b มี FRAME ASSEMBLY ที่มี Details ถึง 70 ท่อ
แต่ BOM BP18 เหลือแค่ 59 ท่อ (FR 00201-AA .. FR 00260-AA)
แท็บของท่อที่ถูกถอด (AA 3001-59, FR 00261-AA .. FR 00270-AA)
จึงถูกตัดออกตามนโยบาย 'ใช้เฉพาะที่อยู่ใน BP18' แต่สูตรในแม่ยังอ้างอยู่

วิธีแก้: เคลียร์เฉพาะช่องข้อมูลของแถวนั้น โดยคงสูตร Y=R*W ไว้
ผลคือแถวนั้นกลายเป็น 0 อัตโนมัติ และ Y78 = SUM(Y8:Y77) ยังคิดถูก
ไม่ลบแถว จึงไม่กระทบตำแหน่งของ Sub Total และหมวดถัดไป
"""
import re
import sys

import openpyxl

P = r"D:/hermes-workspace/fsae-cost-web/data/BP18 FR Cost.xlsx"
REF = re.compile(r"'([^']+)'!")

# ช่องข้อมูลของหนึ่งแถวใน Details:  L=Item Order  N=Part  R=Part Cost  W=Quantity
DETAIL_CELLS = (12, 14, 18, 23)     # L N R W


def main():
    wb = openpyxl.load_workbook(P)
    keep = set(wb.sheetnames)
    fixed, dead_rows = 0, []

    for t in wb.sheetnames:
        ws = wb[t]
        for row in ws.iter_rows():
            for c in row:
                if not (isinstance(c.value, str) and "!" in c.value):
                    continue
                if not any(ref not in keep for ref in REF.findall(c.value)):
                    continue
                r = c.row
                removed = []
                for col in DETAIL_CELLS:
                    v = ws.cell(r, col).value
                    if v is not None:
                        removed.append(str(v)[:28])
                        ws.cell(r, col).value = None
                fixed += 1
                dead_rows.append((t, c.coordinate, r, " / ".join(removed)[:70]))

    wb.save(P)
    print("แก้สูตรอ้างแท็บหาย: %d ช่อง" % fixed)
    for d in dead_rows:
        print("   %s!%s (แถว %d) เคลียร์: %s" % d)

    # ตรวจซ้ำ
    wb = openpyxl.load_workbook(P)
    keep = set(wb.sheetnames)
    left = 0
    for t in wb.sheetnames:
        for row in wb[t].iter_rows():
            for c in row:
                if isinstance(c.value, str) and "!" in c.value:
                    if any(r not in keep for r in REF.findall(c.value)):
                        left += 1
    print("\nอ้างแท็บที่หายค้าง:", left)
    ws = wb["FR 00200-AA"]
    print("Y78 =", ws["Y78"].value, "| V1 =", ws["V1"].value)
    wb.close()
    return 0 if left == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
