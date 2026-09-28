#!/usr/bin/env node
/**
 * Parse BP18 Part BOM.xlsx and generate BOM JSON for the web app
 * Run: npx tsx scripts/parse-bom.ts
 */

import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BOM_PATH = path.join('C:', 'Users', 'azzin', 'AppData', 'Local', 'hermes', 'attachments', 'BP18 Part BOM.xlsx');
const OUTPUT_PATH = path.join(__dirname, '..', 'public', 'bom.json');

// XLSX.readFile doesn't exist in ES modules, use readFileSync
function readWorkbook(filePath: string) {
  const data = fs.readFileSync(filePath);
  return XLSX.read(data, { type: 'buffer' });
}

interface AssemblyData {
  id: string;
  name: string;
  assemblyNumber: string;
  parts: PartData[];
}

interface PartData {
  id: string;
  baseNumber: string;
  suffix: string;
  name: string;
  material: string;
  process: string;
  drawingStatus?: string;
  costStatus?: string;
  assignedTo?: string;
  checkedBy?: string;
}

function colToIndex(col: string): number {
  let result = 0;
  for (let i = 0; i < col.length; i++) {
    result = result * 26 + (col.charCodeAt(i) - 64);
  }
  return result - 1;
}

function indexToCol(idx: number): string {
  let result = '';
  while (idx >= 0) {
    result = String.fromCharCode(65 + (idx % 26)) + result;
    idx = Math.floor(idx / 26) - 1;
  }
  return result;
}

function parseFrameSheet(ws: XLSX.WorkSheet): AssemblyData[] {
  const assemblies: AssemblyData[] = [];
  
  // Get the range
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:BA50');
  const maxRow = range.e.r;
  
  // Assembly groups with their column mappings (0-indexed)
  const assemblyGroups = [
    { name: 'FRAME ASSEMBLY', assemblyNumber: 'A0100', suffix: 'AA', partCol: 6, materialCol: 8, processCol: 9 },      // G, I, J
    { name: 'SUSPENSION MOUNTING ASSEMBLY', assemblyNumber: 'A0200', suffix: 'AA', partCol: 6, materialCol: 8, processCol: 9 }, // G, I, J
    { name: 'ELECTRICAL MOUNTING ASSEMBLY', assemblyNumber: 'A0300', suffix: 'AA', partCol: 20, materialCol: 22, processCol: 24 }, // U, W, Y
    { name: 'PEDALS ASSEMBLY', assemblyNumber: 'A0400', suffix: 'AA', partCol: 20, materialCol: 22, processCol: 24 }, // U, W, Y
    { name: 'ANTI INTRUSION PLATE', assemblyNumber: 'A0500', suffix: 'AA', partCol: 25, materialCol: 29, processCol: 30 }, // Z, AD, AE
    { name: 'BODY ASSEMBLY', assemblyNumber: 'A0600', suffix: 'AA', partCol: 41, materialCol: 43, processCol: 44 }, // AP, AR, AS
    { name: 'FRAME JIG ASSEMBLY', assemblyNumber: 'A0700', suffix: 'AA', partCol: 48, materialCol: 50, processCol: 51 }, // AW, AY, AZ
    { name: 'DRIVETRAIN MOUNTING ASSEMBLY', assemblyNumber: 'A0800', suffix: 'AA', partCol: 58, materialCol: 60, processCol: 62 }, // BG, BI, BK
    { name: 'DRIVERS PROTECTION MOUNTING', assemblyNumber: 'A0900', suffix: 'AA', partCol: 58, materialCol: 60, processCol: 62 }, // BG, BI, BK
  ];
  
  for (const group of assemblyGroups) {
    const parts: PartData[] = [];
    const assemblyId = `FR-${group.assemblyNumber}-${group.suffix}`;
    
    for (let row = 1; row <= maxRow; row++) {  // 0-indexed, row 1 = Excel row 2
      const partCell = XLSX.utils.encode_cell({ c: group.partCol, r: row });
      const materialCell = XLSX.utils.encode_cell({ c: group.materialCol, r: row });
      const processCell = XLSX.utils.encode_cell({ c: group.processCol, r: row });
      
      const partName = ws[partCell]?.v;
      const material = ws[materialCell]?.v;
      const process = ws[processCell]?.v;
      
      if (partName && typeof partName === 'string' && partName.trim()) {
        const match = partName.match(/FR\s+(\d+)-(\w+)/);
        if (match) {
          const baseNumber = match[1];
          const suffix = match[2];
          const partId = `FR-${baseNumber}-${suffix}`;
          
          parts.push({
            id: partId,
            baseNumber,
            suffix,
            name: partName.trim(),
            material: material?.toString().trim() || '',
            process: process?.toString().trim() || '',
          });
        }
      }
    }
    
    if (parts.length > 0) {
      assemblies.push({
        id: assemblyId,
        name: group.name,
        assemblyNumber: group.assemblyNumber,
        parts,
      });
    }
  }
  
  return assemblies;
}

function parseMiscSheet(ws: XLSX.WorkSheet): AssemblyData[] {
  const assemblies: AssemblyData[] = [];
  
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:AA30');
  const maxRow = range.e.r;
  
  const miscAssemblies = [
    { name: "DRIVER'S HARNESS ASSEMBLY", assemblyNumber: 'A0200', suffix: 'AA', partCol: 8 },  // I
    { name: 'FIREWALL ASSEMBLY', assemblyNumber: 'A0300', suffix: 'AA', partCol: 8 },
    { name: 'HEADREST ASSEMBLY', assemblyNumber: 'A0400', suffix: 'AA', partCol: 8 },
    { name: 'SEAT ASSEMBLY', assemblyNumber: 'A0500', suffix: 'AA', partCol: 8 },
    { name: 'IMPACT ATTENUATOR ASSEMBLY', assemblyNumber: 'A0600', suffix: 'AA', partCol: 8 },
    { name: 'SHIELDS ASSEMBLY', assemblyNumber: 'A0700', suffix: 'AA', partCol: 8 },
    { name: 'BRAKE LIGHT HOUSING ASSEMBLY', assemblyNumber: 'A0800', suffix: 'AA', partCol: 8 },
  ];
  
  for (const group of miscAssemblies) {
    const parts: PartData[] = [];
    const assemblyId = `MS-${group.assemblyNumber}-${group.suffix}`;
    
    for (let row = 1; row <= maxRow; row++) {
      const partCell = XLSX.utils.encode_cell({ c: group.partCol, r: row });
      const partName = ws[partCell]?.v;
      
      if (partName && typeof partName === 'string' && partName.trim()) {
        const match = partName.match(/MS\s+(\d+)-(\w+)/);
        if (match) {
          const baseNumber = match[1];
          const suffix = match[2];
          const partId = `MS-${baseNumber}-${suffix}`;
          
          parts.push({
            id: partId,
            baseNumber,
            suffix,
            name: partName.trim(),
            material: '',
            process: '',
          });
        }
      }
    }
    
    if (parts.length > 0) {
      assemblies.push({
        id: assemblyId,
        name: group.name,
        assemblyNumber: group.assemblyNumber,
        parts,
      });
    }
  }
  
  return assemblies;
}

async function main() {
  console.log('Parsing BP18 Part BOM.xlsx...');
  
  const wb = readWorkbook(BOM_PATH);
  
  const frameAssemblies = parseFrameSheet(wb.Sheets['FRAME']);
  const miscAssemblies = parseMiscSheet(wb.Sheets['MISCELLANEOUS']);
  
  const allAssemblies = [...frameAssemblies, ...miscAssemblies];
  
  // Convert to BOMNode format for UI
  const bomNodes = allAssemblies.map(assy => ({
    id: assy.id,
    name: assy.name,
    type: 'assembly' as const,
    system: assy.id.startsWith('FR') ? 'FR' : 'MS',
    assemblyNumber: assy.assemblyNumber,
    suffix: 'AA',
    children: assy.parts.map(part => ({
      id: part.id,
      name: part.name,
      type: 'part' as const,
      system: assy.id.startsWith('FR') ? 'FR' : 'MS',
      assemblyNumber: assy.assemblyNumber,
      baseNumber: part.baseNumber,
      suffix: part.suffix,
      material: part.material,
      process: part.process,
    })),
  }));
  
  const output = {
    generatedAt: new Date().toISOString(),
    source: 'BP18 Part BOM.xlsx',
    assemblies: bomNodes,
    flatParts: allAssemblies.flatMap(a => a.parts.map(p => ({ ...p, assemblyId: a.id, assemblyName: a.name }))),
  };
  
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`BOM parsed: ${allAssemblies.length} assemblies, ${output.flatParts.length} parts`);
  console.log(`Written to ${OUTPUT_PATH}`);
}

main().catch(console.error);