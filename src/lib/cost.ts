import type { DataSnapshot, Material, Part, PartCost, ProcessDef } from '../types'

// Currency: everything in the sheet is USD. Display may convert to THB.
export type Currency = 'USD' | 'THB'

// Read exchange rate from Vite env in browser, or Node env in tests.
function readThbRate(): number {
  const raw =
    typeof import.meta !== 'undefined' && import.meta.env
      ? (import.meta.env.VITE_USD_TO_THB as string | undefined)
      : (process.env.VITE_USD_TO_THB as string | undefined)
  const n = raw ? Number(raw) : NaN
  return Number.isFinite(n) && n > 0 ? n : 36.5
}
const USD_TO_THB = readThbRate()

export function convertFromUSD(usd: number, to: Currency): number {
  return to === 'THB' ? usd * USD_TO_THB : usd
}

export function formatMoney(usd: number, to: Currency): string {
  const value = convertFromUSD(usd, to)
  const symbol = to === 'THB' ? '฿' : '$'
  return symbol + value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function formatNumber(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

// Single-part cost breakdown. All inputs in USD.
// If part.reportCost is set (imported FSAE report with unknown material/process),
// use that finalized value directly instead of recomputing.
export function computePart(
  part: Part,
  materials: Material[],
  processes: ProcessDef[],
  includeQty = true,
): PartCost {
  if (part.reportCost != null && part.reportCost > 0) {
    const totalCost = part.reportCost
    const extendedCost = includeQty ? totalCost * part.qtyPerCar : totalCost
    return { materialCost: 0, mfgCost: 0, assemblyCost: 0, totalCost, extendedCost }
  }
  const mat = materials.find((m) => m.id === part.materialId)
  const proc = processes.find((p) => p.id === part.processId)

  const materialCost = mat ? part.mass * mat.rate : 0
  const machineRate = proc?.machineRate ?? 0
  const laborRate = proc?.laborRate ?? 0
  const mfgCost = proc
    ? (proc.setupTime / 60) * machineRate +
      ((proc.runRate * part.processQty) / 60) * (machineRate + laborRate)
    : 0
  const assemblyCost = proc ? (part.assemblyTime / 60) * laborRate : 0

  const totalCost = materialCost + mfgCost + assemblyCost
  const extendedCost = includeQty ? totalCost * part.qtyPerCar : totalCost

  return { materialCost, mfgCost, assemblyCost, totalCost, extendedCost }
}

// Hierarchical roll-up: a part's cost includes the sum of its children's extended costs.
// Children are parts whose parentId === part.id.
export function rollUp(part: Part, allParts: Part[], materials: Material[], processes: ProcessDef[]): PartCost {
  const self = computePart(part, materials, processes)
  const children = allParts.filter((p) => p.parentId === part.id)
  const childTotal = children.reduce(
    (sum, c) => sum + rollUp(c, allParts, materials, processes).extendedCost,
    0,
  )
  return {
    ...self,
    extendedCost: self.extendedCost + childTotal,
  }
}

// Grand total across a set of parts (top-level parts only to avoid double counting).
export function grandTotal(
  parts: Part[],
  materials: Material[],
  processes: ProcessDef[],
): number {
  const top = parts.filter((p) => !p.parentId)
  return top.reduce((s, p) => s + rollUp(p, parts, materials, processes).extendedCost, 0)
}

export function splitBy(
  parts: Part[],
  key: 'deptId' | 'carId',
  materials: Material[],
  processes: ProcessDef[],
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const p of parts.filter((x) => !x.parentId)) {
    const r = rollUp(p, parts, materials, processes)
    out[p[key]] = (out[p[key]] ?? 0) + r.extendedCost
  }
  return out
}

export function snapshotTotal(data: DataSnapshot): number {
  return grandTotal(data.parts, data.materials, data.processes)
}
