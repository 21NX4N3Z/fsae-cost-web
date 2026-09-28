"""
สร้าง fixture ของชีต BP18 จริง สำหรับทดสอบ Sync แบบ end-to-end

อ่าน 'data/BP18 FR Cost.xlsx' แล้วเขียนเป็น JSON ในรูปแบบที่
Google Sheets values API คืนค่า (values: string[][]) เพื่อให้ mock
ตอบได้เหมือนของจริงทุกประการ
"""
import json
import os
import sys

import openpyxl

SRC = r"D:/hermes-workspace/fsae-cost-web/data/BP18 FR Cost.xlsx"
OUT = r"D:/hermes-workspace/fsae-cost-web/data/sheet-fixture.json"
MAX_COL = 31      # AE
MAX_ROW = 140     # เท่ากับช่วงที่แอปอ่าน


def main():
    wb = openpyxl.load_workbook(SRC, data_only=False)
    tabs = []
    for t in wb.sheetnames:
        ws = wb[t]
        rows = []
        for r in range(1, min(ws.max_row, MAX_ROW) + 1):
            row = []
            empty = True
            for c in range(1, MAX_COL + 1):
                v = ws.cell(r, c).value
                if v is None:
                    row.append("")
                else:
                    empty = False
                    if isinstance(v, float) and v == int(v):
                        v = int(v)
                    row.append(str(v))
            # ต้องเก็บแถวว่างไว้ด้วย
            # Google Sheets คืนค่าเป็นตารางโดยรักษาตำแหน่งแถวจริง
            # ถ้าตัดทิ้ง เลขแถวจะเลื่อน ทำให้แอปอ่านหัวตารางผิดแถว
            rows.append(row)
        tabs.append({
            "title": t,
            "sheetId": 100000 + len(tabs),
            "gridProperties": {"rowCount": 1000, "columnCount": MAX_COL},
            "values": rows,
        })
    wb.close()

    data = {
        "spreadsheetId": "1Dda2vfW1N5WGlVTuu-it389UEW82nG2ki7uk5P822o8",
        "properties": {"title": "BP18 FR Cost"},
        "sheets": tabs,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    print("เขียน %s" % OUT)
    print("  แท็บ: %d  ขนาด: %.1f MB" % (len(tabs), os.path.getsize(OUT) / 1024 / 1024))
    return 0


if __name__ == "__main__":
    sys.exit(main())
