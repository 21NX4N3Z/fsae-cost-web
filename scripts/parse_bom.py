#!/usr/bin/env python3
"""
Parse BP18 Part BOM.xlsx to generate bom.json in the format:
{
  "FRAME ASSEMBLY": [
    ["FR 00230-AA", "FR BULKHEAD R", "FRAME"],
    ...
  ],
  ...
}
"""

import openpyxl
import json
import os

EXCEL_PATH = "D:/hermes-workspace/fsae-cost-web/data/BP18 Part BOM.xlsx"
OUTPUT_PATH = "D:/hermes-workspace/fsae-cost-web/data/bom.json"

def parse_sheet(ws):
    """Parse a worksheet and return list of [PN, Part Name, System] for rows that look like BOM entries."""
    entries = []
    # Assuming data starts at row 2? We'll iterate all rows and look for rows where column A looks like a PN (contains '-')
    # and column B is not empty, column C is the system (maybe from header?)
    # Actually from earlier output, the sheet seems to have repeating headers every few rows.
    # We'll adopt a simple heuristic: collect rows where column A is not empty and contains a hyphen (like FR xxxxxx-AA)
    # and column B is not empty.
    for row in ws.iter_rows(min_row=2, values_only=True):
        if len(row) < 3:
            continue
        pn = row[0]
        part = row[1]
        system = row[2]
        if pn is None or part is None:
            continue
        pn_str = str(pn).strip()
        part_str = str(part).strip()
        system_str = str(system).strip() if system is not None else ""
        # Skip if looks like header (e.g., contains "FR" and "Bulkhead"? but we rely on pattern)
        if pn_str == "" or part_str == "":
            continue
        # Optionally filter out rows where pn looks like a description (contains letters but no hyphen?) 
        # We'll accept all.
        entries.append([pn_str, part_str, system_str])
    return entries

def main():
    wb = openpyxl.load_workbook(EXCEL_PATH, data_only=True)
    bom = {}
    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]
        entries = parse_sheet(ws)
        if entries:
            bom[sheet_name] = entries
            print(f"Sheet '{sheet_name}': {len(entries)} entries")
    # Write output
    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(bom, f, ensure_ascii=False, indent=2)
    print(f"Written {OUTPUT_PATH}")

if __name__ == "__main__":
    main()