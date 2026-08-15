import ExcelJS from 'exceljs'
import type { Car, Department, Part } from '../types'

// Parse the BP16b FSAE Cost Report xlsx into web Parts (assemblies + children),
// with auto-generated serial part IDs and department mapping by System code.
//
// Template layout (sheet FR 00200-AA):
//   A1 University | C1 uni | N1 Car #
//   A2 System     | C2 system (FR)
//   A3 Assembly   | C3 assembly label (e.g. Frame Assembly)
//   A4 Part       | C4 part name
//   A5 P/N Base   | C5 pn base (A0200 / 00201)
//   A6 Suffix     | C6 suffix (AA)
//   L7 Item Order | N7 Part | R7 Part Cost | V7 Qty | X7 Subtotal
//   rows 8+ : child parts (L=order, N=name, R=cost, V=qty, X=subtotal)

export interface ImportResult {
  car: Car
  departments: Department[]
  parts: Part[]
  assemblies: number
  children: number
  skipped: string[]
}

// Safely coerce an ExcelJS cell value to a number. Cells may be numbers,
// numeric strings, or formula results ({ formula, result }).
function num(v: unknown): number {
  if (v == null) return 0
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/[^0-9.-]/g, ''))
    return isNaN(n) ? 0 : n
  }
  if (typeof v === 'object' && 'result' in (v as any)) {
    return num((v as any).result)
  }
  if (typeof v === 'object' && 'text' in (v as any) && typeof (v as any).text === 'string') {
    return num((v as any).text)
  }
  return 0
}

const SYSTEM_TO_DEPT: Record<string, { id: string; name: string }> = {
  FR: { id: 'BDF', name: 'Body & Frame' },
  PT: { id: 'PWT', name: 'Powertrain' },
  SU: { id: 'SUS', name: 'Suspension' },
  EL: { id: 'ELE', name: 'Electrical' },
  BR: { id: 'BRK', name: 'Brakes' },
  ST: { id: 'STE', name: 'Steering' },
}

function serial(n: number): string {
  return String(n).padStart(3, '0')
}

export async function importBp16b(
  buffer: ArrayBuffer,
  opts: { carId: string; carName: string },
): Promise<ImportResult> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)

  const car: Car = {
    id: opts.carId,
    name: opts.carName,
    class: opts.carId.toUpperCase().includes('BAJA') ? 'BAJA' : 'FSAE',
    year: 2026,
    status: 'active',
  }
  const departments: Department[] = []
  const parts: Part[] = []
  const skipped: string[] = []
  const seenDept = new Set<string>()

  let asmSerial = 0
  for (const ws of wb.worksheets) {
    const name = ws.name
    if (name.startsWith('สำเนา') || name === 'A 3000') continue // skip copies / cover

    const system = String(ws.getCell('C2').value ?? 'FR').trim()
    const partName = ws.getCell('C4').value ? String(ws.getCell('C4').value) : name

    const dept = SYSTEM_TO_DEPT[system] ?? { id: system, name: `${system} Department` }
    if (!seenDept.has(dept.id)) {
      seenDept.add(dept.id)
      departments.push({ id: dept.id, name: dept.name, leadEmail: '' })
    }

    // Assembly (parent part). The real Part Cost / Extended Cost values live in
    // V1 / V4 (the right side of the T1:T2 / T4 merged cells); T1/T4 hold labels.
    asmSerial += 1
    const asmId = `${opts.carId}-${system}-${serial(asmSerial)}`
    const asmPartCost = num(ws.getCell('V1').value)
    const asmExtended = num(ws.getCell('V4').value)
    const asmQty = num(ws.getCell('T2').value) || 1
    const assembly: Part = {
      id: asmId,
      parentId: null,
      carId: opts.carId,
      deptId: dept.id,
      name: String(partName),
      qtyPerCar: asmQty,
      materialId: 'UNKNOWN',
      mass: 0,
      processId: 'UNKNOWN',
      processQty: 1,
      assemblyTime: 0,
      status: 'draft',
      reportCost: asmPartCost,
    }
    parts.push(assembly)

    // Children (details block, rows 8+)
    let row = 8
    let childN = 0
    const maxRow = ws.rowCount ?? 200
    while (row <= maxRow) {
      const order = ws.getCell(`L${row}`).value
      const cname = ws.getCell(`N${row}`).value
      const ccost = ws.getCell(`R${row}`).value
      const cqty = ws.getCell(`V${row}`).value
      if (order == null && cname == null && ccost == null) break
      childN += 1
      const childId = `${asmId}-C${serial(childN)}`
      // We don't have material/process for children in the report; store their
      // finalized cost so the web roll-up matches the report. We mark them with a
      // synthetic material so totalCost reproduces the report value.
      const cost = num(ccost)
      const qty = num(cqty) || 1
      parts.push({
        id: childId,
        parentId: asmId,
        carId: opts.carId,
        deptId: dept.id,
        name: cname ? String(cname) : `Item ${childN}`,
        qtyPerCar: qty,
        materialId: 'UNKNOWN',
        mass: 0,
        processId: 'UNKNOWN',
        processQty: 1,
        assemblyTime: 0,
        status: 'draft',
        reportCost: cost,
      })
      row += 1
    }
    if (childN === 0) {
      // No children: the assembly itself carries the report cost (V1 or V4).
      assembly.reportCost = asmPartCost > 0 ? asmPartCost : asmExtended
    } else {
      // Assembly cost = its own Part Cost (V1) if present, else roll up children.
      const childSum = parts
        .filter((p) => p.parentId === asmId)
        .reduce((s, p) => s + (p.reportCost ?? 0), 0)
      assembly.reportCost =
        asmPartCost > 0 ? asmPartCost : Math.round(childSum * 100) / 100
    }
  }

  return {
    car,
    departments,
    parts,
    assemblies: asmSerial,
    children: parts.length - asmSerial,
    skipped,
  }
}
