#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
สร้างแคตตาล็อกมาตรฐานสำหรับ FSAE Cost Manager (v2)
จากไฟล์ CSV export ของ FSAE Online (CatalogVersion 2252)

หลักการสำคัญ (แก้ bug ของ v1):
- คอลัมน์แบน (CostFormula / C1 / C2) ใช้ได้กับ Materials, Processes, Fasteners
  แต่ **Process Multipliers และ Tooling มีโครงสร้างต่างออกไป** ค่าจริงอยู่ใน
  RawControlsJSON เท่านั้น (txtMultiplierValue / txtCost) ถ้าอ่านคอลัมน์แบนจะได้ข้อมูลมั่ว
- Processes ต้องดึง txtToolingRequired + txtProcessMultiplierType เพิ่ม
  เพื่อให้หน้าเว็บเสนอ "Process Multiplier ที่ process นี้ต้องใช้" อัตโนมัติ
- ชื่อ key ใน JSON ผลลัพธ์ต้องตรงกับที่ app.js อ่าน (ตัวพิมพ์เล็กทั้งหมด)

ผลลัพธ์: data/catalogs.json (สิ่งที่แอปโหลด) และ data/catalogs_raw.json (คลังดิบสำหรับตรวจย้อนหลัง)
"""

import csv
import json
import os
import re
import uuid
from datetime import datetime, timezone

BASE = "D:/hermes-workspace/fsae-cost-web"
SRC = os.path.join(BASE, "data", "fsae-online-export")
OUT = os.path.join(BASE, "data")

# ชื่อไฟล์ CSV -> key ใน JSON (ตัวพิมพ์เล็ก ตรงกับ app.js)
FILES = {
    "materials": "Materials.csv",
    "processes": "Processes.csv",
    "fasteners": "Fasteners.csv",
    "multipliers": "Process_Multipliers.csv",
    "tooling": "Tooling.csv",
}

# ป้ายกำกับพารามิเตอร์ที่ไม่ได้อยู่ในคอลัมน์ CSV แต่ปรากฏในสูตร
EXTRA_PARAM_LABELS = {
    "Area": "Area",
    "Length": "Length",
    "Density": "Density",
    "Size1": "Size 1",
    "Size2": "Size 2",
}


def read_csv(filename):
    with open(os.path.join(SRC, filename), "r", encoding="utf-8-sig", errors="replace") as f:
        return list(csv.DictReader(f))


def controls(row):
    """แปลง RawControlsJSON เป็น dict ของชื่อ control -> value (ชื่อสั้นท้ายสุด)"""
    try:
        raw = json.loads(row.get("RawControlsJSON") or "[]")
    except (ValueError, TypeError):
        return {}
    out = {}
    for c in raw:
        name = c.get("name", "")
        if "$" in name:
            name = name.split("$")[-1]
        out[name] = c.get("value", "") or ""
    return out


def num(value):
    """'1.2500000000' -> 1.25 ; '10,000.00' -> 10000.0 ; เลขที่ไม่ใช่ตัวเลข -> None"""
    if value is None:
        return None
    s = str(value).strip().replace(",", "")
    if not s or s.lower() == "on":
        return None
    try:
        f = float(s)
    except ValueError:
        return None
    return f


def formula_params(formula):
    """ดึงชื่อพารามิเตอร์ในสูตร เช่น [Size1] [Area] -> ['Size1','Area'] (ไม่รวม C1/C2)"""
    if not formula:
        return []
    found = re.findall(r"\[([^\]]+)\]", formula)
    return [p for p in dict.fromkeys(found) if p not in ("C1", "C2")]


def build_params(row, formula):
    """สร้างรายการพารามิเตอร์สำหรับให้ผู้ใช้กรอกในแถว Cost Breakdown"""
    params = []
    for name in formula_params(formula):
        if name == "Size1":
            label = row.get("Size1Label") or row.get("MeasurementUnit1Code") or "Size 1"
            unit = row.get("MeasurementUnit1Code", "")
        elif name == "Size2":
            label = row.get("Size2Label") or row.get("MeasurementUnit2Code") or "Size 2"
            unit = row.get("MeasurementUnit2Code", "")
        else:
            label = EXTRA_PARAM_LABELS.get(name, name)
            unit = ""
        params.append({
            "name": name,
            "label": label,
            "unit": unit,
            "type": "number",
            "required": True,
        })
    return params


def view_id(url, key):
    """ดึง GUID จาก ViewURL เช่น ...&ProcessID=xxx&Action=View"""
    m = re.search(key + r"=([0-9a-fA-F-]+)", url or "")
    return m.group(1) if m else ""


def stable_id(title, source, kind):
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, f"{kind}|{title}|{source}"))


def build():
    imported_at = datetime.now(timezone.utc).isoformat()
    version = "2252"

    data = {k: [] for k in FILES}
    raw_store = {"catalog_version": version, "imported_at": imported_at, "sources": {}}

    # ---------- Materials / Processes / Fasteners : อ่านคอลัมน์แบน ----------
    for kind in ("materials", "processes", "fasteners"):
        rows = read_csv(FILES[kind])
        raw_store["sources"][kind] = {"row_count": len(rows), "rows": rows}
        for row in rows:
            formula = (row.get("CostFormula") or "").strip()
            source = (row.get("FastenerID") or "").strip() or view_id(row.get("ViewURL", ""), kind.title() + "ID")
            item = {
                "id": stable_id(row.get("Title", ""), source, kind),
                "source_id": source,
                "title": (row.get("Title") or "").strip(),
                "supplier": (row.get("Supplier") or "").strip(),
                "category": (row.get("Category") or "").strip(),
                "description": (row.get("Description") or "").strip(),
                "formula": formula,
                "c1": num(row.get("C1")),
                "c2": num(row.get("C2")),
                "params": build_params(row, formula),
            }
            if kind == "processes":
                ctl = controls(row)
                item["unit"] = ctl.get("ddlMeasurementUnit1Code", "") or row.get("MeasurementUnit1Code", "")
                item["tooling_required"] = ctl.get("txtToolingRequired", "").lower() == "yes"
                item["near_net_shape"] = ctl.get("txtNearNetShape", "").lower() == "yes"
                item["multiplier_type"] = ctl.get("txtProcessMultiplierType", "").strip()
                item["source_id"] = source or view_id(row.get("ViewURL", ""), "ProcessID")
            data[kind].append(item)

    # ---------- Process Multipliers : ค่าอยู่ใน RawControlsJSON เท่านั้น ----------
    rows = read_csv(FILES["multipliers"])
    raw_store["sources"]["multipliers"] = {"row_count": len(rows), "rows": rows}
    for row in rows:
        ctl = controls(row)
        title = (ctl.get("txtMultiplierTitle") or row.get("Title") or "").strip()
        value = num(ctl.get("txtMultiplierValue"))
        if not title or value is None:
            continue
        source = view_id(row.get("ViewURL", ""), "ProcessMultiplierID")
        data["multipliers"].append({
            "id": stable_id(title, source, "multipliers"),
            "source_id": source,
            "title": title,
            # ประเภท multiplier เช่น Machining / Assembly / Drill, Tap / Fastener Installation
            "type": (ctl.get("txtMultiplierType") or "").strip(),
            "value": value,
            "description": (ctl.get("txtDescription") or "").strip(),
        })

    # ---------- Tooling : ราคาอยู่ใน txtCost, หน่วยใน ddlMeasurementUnitCode ----------
    rows = read_csv(FILES["tooling"])
    raw_store["sources"]["tooling"] = {"row_count": len(rows), "rows": rows}

    # แปลง ProcessID -> ชื่อ process เพื่อให้ผู้ใช้เห็นว่า tooling นี้ใช้กับ process ไหน
    proc_name = {}
    for p in data["processes"]:
        if p["source_id"]:
            proc_name[p["source_id"]] = p["title"]

    for row in rows:
        ctl = controls(row)
        title = (ctl.get("txtTitle") or row.get("Title") or "").strip()
        cost = num(ctl.get("txtCost"))
        if not title or cost is None:
            continue
        source = view_id(row.get("ViewURL", ""), "ToolID")
        process_id = ctl.get("ddlProcesses", "")
        data["tooling"].append({
            "id": stable_id(title, source, "tooling"),
            "source_id": source,
            "title": title,
            "cost": cost,
            "unit": ctl.get("ddlMeasurementUnitCode", ""),
            "process_id": process_id,
            "process_title": proc_name.get(process_id, ""),
            "description": (ctl.get("txtDescription") or "").strip(),
            # PVF = Production Volume Factor : ต้นทุนเครื่องมือหารด้วยจำนวนชิ้นที่ผลิต
            "default_pvf": 3000,
        })

    payload = {
        "catalog_version": version,
        "imported_at": imported_at,
        "source": "FSAE Online CSV export (data/fsae-online-export)",
        "multiplier_types": sorted({m["type"] for m in data["multipliers"] if m["type"]}),
        "materials": data["materials"],
        "processes": data["processes"],
        "fasteners": data["fasteners"],
        "multipliers": data["multipliers"],
        "tooling": data["tooling"],
    }

    with open(os.path.join(OUT, "catalogs.json"), "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
    with open(os.path.join(OUT, "catalogs_raw.json"), "w", encoding="utf-8") as f:
        json.dump(raw_store, f, ensure_ascii=False, indent=1)

    print(f"catalog_version = {version}")
    for kind in FILES:
        print(f"  {kind:12} = {len(data[kind]):5} rows")
    param_count = sum(1 for k in ("materials", "processes", "fasteners") for i in data[k] if i["params"])
    print(f"  items with params (need input) = {param_count}")
    print(f"  multiplier types = {payload['multiplier_types']}")
    linked = sum(1 for t in data["tooling"] if t["process_title"])
    print(f"  tooling linked to a process = {linked}/{len(data['tooling'])}")


if __name__ == "__main__":
    build()
