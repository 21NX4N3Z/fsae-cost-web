#!/usr/bin/env python3
"""
Build normalized catalog from FSAE Online CSV export.
Outputs:
- data/catalogs.json (normalized for app)
- data/catalogs_raw.json (raw store, versioned)
"""

import csv
import json
import uuid
import hashlib
from datetime import datetime, timezone
import os
import re

BASE_PATH = "D:/hermes-workspace/fsae-cost-web/data/fsae-online-export"
OUTPUT_PATH = "D:/hermes-workspace/fsae-cost-web/data"

CATALOGS = ["Materials", "Processes", "Fasteners", "Process_Multipliers", "Tooling"]

def read_csv(filename):
    path = os.path.join(BASE_PATH, filename)
    with open(path, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        return list(reader)

def extract_params(formula):
    """Return list of parameter names found in formula like [Size1], [C2], etc."""
    if not formula:
        return []
    # Find all bracketed tokens
    matches = re.findall(r'\[([^\]]+)\]', formula)
    # Normalize: keep as is
    return list(set(matches))  # unique

def build_catalog():
    catalog_version = "2252"  # from CSV
    imported_at = datetime.now(timezone.utc).isoformat()
    
    raw_store = {
        "catalog_version": catalog_version,
        "imported_at": imported_at,
        "sources": {}
    }
    
    normalized = {
        "catalog_version": catalog_version,
        "imported_at": imported_at,
        "materials": [],
        "processes": [],
        "multipliers": [],
        "fasteners": [],
        "tooling": []
    }
    
    for cat in CATALOGS:
        rows = read_csv(f"{cat}.csv")
        raw_store["sources"][cat] = {
            "row_count": len(rows),
            "rows": rows  # store raw rows for traceability
        }
        
        for row in rows:
            # Generate stable ID: hash of title + source_id
            source_id = row.get("FastenerID", "")
            title = row.get("Title", "").strip()
            # Use uuid5 with namespace DNS and name = title + source_id
            namespace = uuid.NAMESPACE_DNS
            name = f"{title}|{source_id}|{cat}"
            item_id = str(uuid.uuid5(namespace, name))
            
            # Determine if formula has parameters
            formula = row.get("CostFormula", "").strip()
            has_params = bool(formula and '[' in formula)
            param_names = extract_params(formula) if has_params else []
            
            # Build params list for UI: only Size1 and Size2 are considered inputs
            params = []
            if has_params:
                # We will only create params for Size1 and Size2 if they appear in formula
                # C1 and C2 are constants from CSV columns, not inputs.
                known = {
                    "Size1": {"label": row.get("Size1Label", ""), "unit": row.get("MeasurementUnit1Code", "")},
                    "Size2": {"label": row.get("Size2Label", ""), "unit": row.get("MeasurementUnit2Code", "")}
                }
                for p in param_names:
                    if p in ("C1", "C2"):
                        # Skip coefficients; they are constants, not inputs
                        continue
                    if p in known:
                        info = known[p]
                        label = info["label"]
                        unit = info["unit"]
                        # If label empty, use unit as label (if unit not empty), else use param name
                        if not label:
                            label = unit if unit else p
                        params.append({
                            "name": p,
                            "label": label,
                            "unit": unit,
                            "type": "number",
                            "required": True
                        })
                    else:
                        # Unknown parameter (e.g., Area, Length, Density) - we lack source data
                        # Still create a param with generic label and no unit
                        params.append({
                            "name": p,
                            "label": p,
                            "unit": "",
                            "type": "number",
                            "required": True
                        })
            else:
                params = []
            
            item = {
                "id": item_id,
                "source_id": source_id,
                "title": title,
                "supplier": row.get("Supplier", ""),
                "category": row.get("Category", ""),
                "size1_label": row.get("Size1Label", ""),
                "size2_label": row.get("Size2Label", ""),
                "unit1": row.get("MeasurementUnit1Code", ""),
                "unit2": row.get("MeasurementUnit2Code", ""),
                "cost_formula": formula,
                "c1": row.get("C1", ""),
                "c2": row.get("C2", ""),
                "description": row.get("Description", ""),
                "has_parameters": has_params,
                "params": params
            }
            
            # Append to appropriate list
            if cat == "Materials":
                normalized["materials"].append(item)
            elif cat == "Processes":
                normalized["processes"].append(item)
            elif cat == "Fasteners":
                normalized["fasteners"].append(item)
            elif cat == "Process_Multipliers":
                normalized["multipliers"].append(item)
            elif cat == "Tooling":
                normalized["tooling"].append(item)
    
    # Write raw store
    raw_path = os.path.join(OUTPUT_PATH, "catalogs_raw.json")
    with open(raw_path, 'w', encoding='utf-8') as f:
        json.dump(raw_store, f, ensure_ascii=False, indent=2)
    
    # Write normalized catalog
    norm_path = os.path.join(OUTPUT_PATH, "catalogs.json")
    with open(norm_path, 'w', encoding='utf-8') as f:
        json.dump(normalized, f, ensure_ascii=False, indent=2)
    
    print(f"Generated {raw_path} and {norm_path}")
    print(f"Counts: Materials {len(normalized['materials'])}, Processes {len(normalized['processes'])}, "
          f"Fasteners {len(normalized['fasteners'])}, Multipliers {len(normalized['multipliers'])}, "
          f"Tooling {len(normalized['tooling'])}")

if __name__ == "__main__":
    build_catalog()
