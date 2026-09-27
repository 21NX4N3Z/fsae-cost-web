#!/usr/bin/env node
/**
 * Parse A 3000.xlsx template to understand structure and extract catalog data
 * Run: npx tsx scripts/parse-template.ts
 */

import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMPLATE_PATH = path.join('C:', 'Users', 'azzin', 'AppData', 'Local', 'hermes', 'attachments', 'A 3000.xlsx');
const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'template');

function readWorkbook(filePath: string) {
  const data = fs.readFileSync(filePath);
  return XLSX.read(data, { type: 'buffer' });
}

async function main() {
  console.log('Parsing A 3000.xlsx template...');
  
  const wb = readWorkbook(TEMPLATE_PATH);
  
  console.log(`Total sheets: ${wb.SheetNames.length}`);
  console.log('Sheet names (first 15):', wb.SheetNames.slice(0, 15));
  
  // Analyze the template structure from first few sheets
  const sampleSheets = ['AA 30001', 'AA 30002', 'AA 30003'];
  
  for (const sheetName of sampleSheets) {
    if (!wb.SheetNames.includes(sheetName)) continue;
    
    const ws = wb.Sheets[sheetName];
    console.log(`\n=== Sheet: ${sheetName} ===`);
    console.log('Range:', ws['!ref']);
    
    // Helper to get cell value
    const getCell = (addr: string) => ws[addr]?.v;
    
    // Header block
    console.log('Header:');
    console.log('  University (C1):', getCell('C1'));
    console.log('  Car # (N1):', getCell('N1'));
    console.log('  System (C2):', getCell('C2'));
    console.log('  Assembly (C3):', getCell('C3'));
    console.log('  Part (C4):', getCell('C4'));
    console.log('  P/N Base (C5):', getCell('C5'));
    console.log('  Suffix (C6):', getCell('C6'));
    console.log('  Part Cost (V1):', getCell('V1'));
    console.log('  Qty (T2):', getCell('T2'));
    console.log('  Extended Cost (V4):', getCell('V4'));
    
    // Details table
    console.log('Details (row 8+):');
    for (let row = 8; row <= 20; row++) {
      const order = getCell(`L${row}`);
      const part = getCell(`N${row}`);
      const cost = getCell(`R${row}`);
      const qty = getCell(`W${row}`);
      const subtotal = getCell(`Y${row}`);
      
      if (order !== undefined || part !== undefined) {
        console.log(`  Row ${row}: Order=${order}, Part=${part}, Cost=${cost}, Qty=${qty}, Subtotal=${subtotal}`);
      }
    }
  }
  
  // Also check "List CostMiss Cost" sheet
  if (wb.SheetNames.includes('List CostMiss Cost')) {
    const ws = wb.Sheets['List CostMiss Cost'];
    console.log('\n=== List CostMiss Cost ===');
    console.log('Range:', ws['!ref']);
    
    const getCell = (addr: string) => ws[addr]?.v;
    for (let row = 1; row <= 30; row++) {
      const a = getCell(`A${row}`);
      const f = getCell(`F${row}`);
      if (a !== undefined || f !== undefined) {
        console.log(`  Row ${row}: A=${a}, F=${f}`);
      }
    }
  }
  
  // Check a few more template sheets for catalog-like data
  // Look for sheets that might contain material/process catalogs
  const catalogSheets = wb.SheetNames.filter(name => 
    name.toLowerCase().includes('material') || 
    name.toLowerCase().includes('process') ||
    name.toLowerCase().includes('catalog') ||
    name.toLowerCase().includes('cost table')
  );
  
  if (catalogSheets.length > 0) {
    console.log('\nPotential catalog sheets:', catalogSheets);
  }
}

main().catch(console.error);