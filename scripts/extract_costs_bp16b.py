"""
เทียบ bom.json (BP18) กับไฟล์ต้นทุน BP16b

ผลลัพธ์:
  - สร้าง data/costs.json  = ต้นทุนที่ยืนมั่นของแต่ละ part (ดึงจาก tab ในไฟล์ต้นทุน)
  - พิมพ์สถานะครอบคลุม: มีต้นทุนแล้ว / ยังไม่มี / ไม่อยู่ใน BP18

กฎชื่อ tab: tab = "FR " + C5(P/N Base) + "-" + C6(Suffix)
ข้อยกเว้นที่พบ: assembly tab ใช้ 002xx แต่ P/N Base เป็น A02xx
"""
import json
import re
import sys

import openpyxl

BOM = r"D:/hermes-workspace/fsae-cost-web/data/bom.json"
COSTS = r"D:/hermes-workspace/fsae-cost-web/data/costs.json"
SRC = r"D:/hermes-workspace/fsae-cost-web/data/ref. Body & Frame Cost BP16b.xlsx"

SEC = ["Material", "Process", "Fastener", "Tooling"]


def norm(v):
    if v is None:
        return ""
    return re.sub(r"\s+", " ", str(v)).replace("\u00a0", " ").strip()


def header_row(ws, label):
    """หาแถวหัวหมวด: คอลัมน์ A = Item Order และคอลัมน์ C = ชื่อหมวด"""
    target = label.lower()
    for r in range(1, ws.max_row + 1):
        a = norm(ws.cell(r, 1).value).lower()
        c = norm(ws.cell(r, 3).value).lower()
        if a == "item order" and c == target:
            return r
    return None


def section_total(ws, label):
    """หาป้าย Sub Total ที่อยู่ใต้หัวหมวด แล้วอ่านค่าทางขวา
       ป้ายอยู่คนละคอลัมน์กันแต่ละหมวด: Material=Y Process=Q Fastener=S Tooling=Q"""
    hr = header_row(ws, label)
    if not hr:
        return None, None
    for r in range(hr + 1, min(hr + 60, ws.max_row + 1)):
        for c in range(8, 26):
            if norm(ws.cell(r, c).value).lower() == "sub total":
                for vc in range(c + 1, min(c + 6, ws.max_column + 1)):
                    v = ws.cell(r, vc).value
                    if isinstance(v, (int, float)):
                        return v, (hr, r)
                return 0, (hr, r)
    return None, (hr, None)


def details_total(ws):
    """ป้าย 'Subtotal' ของ Details อยู่คอลัมน์ W และค่าอยู่คอลัมน์ Y
       แต่ตำแหน่งไม่คงที่ในทุกแท็บ จึงต้องสแกนทั้งแถวแล้วอ่านตัวเลขถัดไปทางขวา"""
    for r in range(2, min(ws.max_row + 1, 200)):
        for c in range(8, ws.max_column):
            if norm(ws.cell(r, c).value).lower() == "subtotal":
                for vc in range(c + 1, min(c + 5, ws.max_column + 1)):
                    v = ws.cell(r, vc).value
                    if isinstance(v, (int, float)):
                        return v
    return 0.0


def main():
    bom = json.load(open(BOM, encoding="utf-8"))
    wb = openpyxl.load_workbook(SRC, data_only=True)

    costs = {}
    bad_tabs = []
    for name in wb.sheetnames:
        t = name.strip()
        if not re.match(r"^FR\s", t):
            if name != t:
                bad_tabs.append((name, t))
            continue
        ws = wb[name]
        pn_base = norm(ws["C5"].value)
        suffix = norm(ws["C6"].value) or "AA"
        part = norm(ws["C4"].value)
        asm = norm(ws["C3"].value)
        if not pn_base:
            continue
        # P/N เต็ม: A0200 -> FR 00200-AA (assembly ใช้ตัวเลขตามชื่อ tab)
        m = re.match(r"^A?(\d{4,5})$", pn_base)
        full_pn = "FR %s-AA" % m.group(1) if m else None

        parts = {}
        for s in SEC:
            val, _ = section_total(ws, s)
            parts[s.lower()] = val
        det = details_total(ws)
        partcost = ws["V1"].value

        costs[t] = {
            "tab": t,
            "pnBase": pn_base,
            "pn": full_pn,
            "part": part,
            "assembly": asm,
            "details": det,
            "material": parts["material"],
            "process": parts["process"],
            "fastener": parts["fastener"],
            "tooling": parts["tooling"],
            "partCost": partcost if isinstance(partcost, (int, float)) else 0,
        }
    wb.close()

    def key_of(pn):
        """'FR A0200-AA' และ 'FR 00200-AA' คือชิ้นเดียวกัน -> '00200'"""
        m = re.search(r"(\d{4,5})", pn or "")
        if not m:
            return None
        return "FR " + m.group(1).zfill(5)

    by_pn, by_tab = {}, {}
    for t, d in costs.items():
        by_tab[t] = d
        for cand in (d["pn"], t):
            k = key_of(cand)
            if k and k not in by_pn:
                by_pn[k] = d

    total = have = miss = 0
    rows = []
    for asm, plist in bom.items():
        for p in plist:
            pn = p[0]
            total += 1
            hit = by_pn.get(key_of(pn) or "") or by_tab.get(pn)
            if hit:
                have += 1
                rows.append((asm, pn, p[1], hit["partCost"], hit["tab"]))
            else:
                miss += 1
                rows.append((asm, pn, p[1], None, None))

    with open(COSTS, "w", encoding="utf-8") as f:
        json.dump({"byTab": costs, "byPn": by_pn}, f, ensure_ascii=False, indent=1)

    print("เขียน %s" % COSTS)
    print("tab ในไฟล์ต้นทุนที่อ่านได้: %d" % len(costs))
    print("part ใน BOM ที่มีต้นทุนแล้ว: %d / %d  (ยังไม่มี %d)" % (have, total, miss))
    print()
    if bad_tabs:
        print("ชื่อ tab ที่มีช่องว่างนำหน้า/หลัง:")
        for raw, t in bad_tabs[:6]:
            print("   %r -> %r" % (raw, t))
        print()
    print("--- part ที่ยังไม่มีต้นทุน ---")
    for asm, pn, name, pc, tab in rows:
        if pc is None:
            print("   %-30s %-15s %s" % (asm[:30], pn, (name or "")[:40]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
