"""
สร้างรายงานสรุปต้นทุน BP18 — 'data/cost-summary.json' + พิมพ์ตาราง

ใช้ข้อมูลจาก
  data/bom.json   = รายการ part ของ BP18
  data/costs.json = ต้นทุนที่ยืนมั่นจากไฟล์ต้นทุน BP16b
"""
import json
import re
import sys

ROOT = r"D:/hermes-workspace/fsae-cost-web"
BOM = ROOT + "/data/bom.json"
COSTS = ROOT + "/data/costs.json"
OUT = ROOT + "/data/cost-summary.json"

SECS = ["material", "process", "fastener", "tooling"]


def key_of(pn):
    m = re.search(r"(\d{4,5})", pn or "")
    return "FR " + m.group(1).zfill(5) if m else None


def r4(v):
    try:
        return round(float(v), 4)
    except (TypeError, ValueError):
        return 0.0


def main():
    bom = json.load(open(BOM, encoding="utf-8"))
    costs = json.load(open(COSTS, encoding="utf-8"))["byPn"]

    out = {}
    grand = 0.0
    rows = []

    for asm, plist in bom.items():
        tot = 0.0
        n_have = n_miss = 0
        secs = {s: 0.0 for s in SECS}
        for p in plist:
            k = key_of(p[0])
            c = costs.get(k)
            if not c:
                n_miss += 1
                continue
            n_have += 1
            tot += r4(c["partCost"])
            for s in SECS:
                secs[s] += r4(c[s])
        out[asm] = {
            "parts": len(plist),
            "costed": n_have,
            "missing": n_miss,
            "partCost": r4(tot),
            "sections": {s: r4(v) for s, v in secs.items()},
        }
        grand += tot
        rows.append((asm, len(plist), n_have, n_miss, tot, dict(secs)))

    out["__TOTAL__"] = {"partCost": r4(grand),
                        "parts": sum(r[1] for r in rows),
                        "costed": sum(r[2] for r in rows),
                        "missing": sum(r[3] for r in rows)}

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)

    print("เขียน %s\n" % OUT)
    print("%-34s %5s %6s %6s %12s" % ("ASSEMBLY", "PARTS", "COSTED", "MISS", "PART COST"))
    print("-" * 70)
    for asm, n, h, m, tot, secs in rows:
        print("%-34s %5d %6d %6d %12s" % (asm[:34], n, h, m, "{:,.2f}".format(tot)))
    print("-" * 70)
    t = out["__TOTAL__"]
    print("%-34s %5d %6d %6d %12s" % ("รวมทั้งหมด", t["parts"], t["costed"],
                                     t["missing"], "{:,.2f}".format(t["partCost"])))

    print("\nแยกตามหมวด (เฉพาะส่วนที่มีต้นทุน):")
    g = {s: sum(r[5][s] for r in rows) for s in SECS}
    for s in SECS:
        pct = (g[s] / t["partCost"] * 100) if t["partCost"] else 0
        print("   %-10s %12s  (%4.1f%%)" % (s, "{:,.2f}".format(g[s]), pct))
    return 0


if __name__ == "__main__":
    sys.exit(main())
