import ExcelJS from 'exceljs'
import type { DataSnapshot } from '../types'
import { rollUp, computePart } from './cost'

// Browser-safe FSAE Cost Report builder.
// Reads the BP16b template from /template/ (copied to public/) as an ArrayBuffer,
// clones its styles, fills the data block, and returns an xlsx ArrayBuffer for download.

const TEMPLATE_URL = '/template/Body & Frame Cost BP16b.xlsx'

function pnFromId(id: string): { base: string; suffix: string } {
  const parts = id.split('-')
  if (parts.length >= 2) return { base: parts[0], suffix: parts.slice(1).join('-') }
  return { base: id, suffix: 'AA' }
}
function round2(n: number): number {
  return Math.round(n * 100) / 100
}
function sheetName(id: string): string {
  return id.replace(/[:\\/?*[\]]/g, '-').slice(0, 31)
}

export async function buildCostXlsxBrowser(
  data: DataSnapshot,
  opts: { carId: string; uni?: string; systemCode?: string; assemblyLabel?: string },
): Promise<ArrayBuffer> {
  const car = data.cars.find((c) => c.id === opts.carId)
  if (!car) throw new Error(`Car ${opts.carId} not found`)

  const tplBuf = await (await fetch(TEMPLATE_URL)).arrayBuffer()
  const base = new ExcelJS.Workbook()
  await base.xlsx.load(tplBuf)

  const wb = new ExcelJS.Workbook()
  const assemblies = data.parts.filter((p) => !p.parentId && p.carId === opts.carId)
  const uni = opts.uni ?? 'King Mongkut’s University of Technology Thonburi'
  const sys = opts.systemCode ?? (car.class === 'BAJA' ? 'BAJA' : 'FR')

  for (const asm of assemblies) {
    const tmpl = base.getWorksheet('FR 00200-AA')!
    const ws = wb.addWorksheet(sheetName(asm.id))
    cloneSheet(tmpl, ws)

    const children = data.parts.filter((p) => p.parentId === asm.id)
    const r = rollUp(asm, data.parts, data.materials, data.processes)
    const { base: pnBase, suffix } = pnFromId(asm.id)

    setCell(ws, 'C1', uni)
    setCell(ws, 'N1', car.id)
    setCell(ws, 'C2', sys)
    setCell(ws, 'C3', opts.assemblyLabel ?? 'FRAME AND BODY ASSEMBLY')
    setCell(ws, 'C4', asm.name)
    setCell(ws, 'C5', pnBase)
    setCell(ws, 'C6', suffix)
    setCell(ws, 'T1', round2(r.totalCost))
    setCell(ws, 'T2', asm.qtyPerCar)
    setCell(ws, 'T4', round2(r.extendedCost))

    let row = 8
    if (children.length === 0) {
      setCell(ws, `L${row}`, 1)
      setCell(ws, `N${row}`, asm.name)
      setCell(ws, `R${row}`, round2(r.totalCost))
      setCell(ws, `V${row}`, asm.qtyPerCar)
      setCell(ws, `X${row}`, round2(r.extendedCost))
    } else {
      children.forEach((ch, i) => {
        const cost = computePart(ch, data.materials, data.processes).totalCost
        setCell(ws, `L${row}`, i + 1)
        setCell(ws, `N${row}`, ch.name)
        setCell(ws, `R${row}`, round2(cost))
        setCell(ws, `V${row}`, ch.qtyPerCar)
        setCell(ws, `X${row}`, round2(cost * ch.qtyPerCar))
        row++
      })
    }
  }

  return wb.xlsx.writeBuffer()
}

function setCell(ws: ExcelJS.Worksheet, addr: string, val: string | number) {
  ws.getCell(addr).value = val
}

function cloneSheet(src: ExcelJS.Worksheet, dst: ExcelJS.Worksheet) {
  src.columns.forEach((col, i) => {
    if (col.width) dst.getColumn(i + 1).width = col.width
  })
  const dims = src.dimensions
  const maxRow = dims.bottom ?? 100
  const maxCol = dims.right ?? 26
  for (let r = 1; r <= maxRow; r++) {
    for (let c = 1; c <= maxCol; c++) {
      const s = src.getCell(r, c)
      const d = dst.getCell(r, c)
      if (s.style && (s.value !== null || (s.style.fill as any)?.type)) {
        d.style = { ...s.style }
      }
    }
  }
  const merges = src.model.merges as string[] | undefined
  if (merges) merges.forEach((m) => dst.mergeCells(m))
}
