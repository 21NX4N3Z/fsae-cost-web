// Domain types for the FSAE/BAJA cost entry app.
// All monetary amounts are stored in USD in the sheet. Display may convert to THB.

export type CarClass = 'FSAE' | 'BAJA'

export interface Car {
  id: string // e.g. BP18, BAJA
  name: string
  class: CarClass
  year: number
  status: 'active' | 'archived'
}

export interface Department {
  id: string
  name: string
  leadEmail: string
}

export interface Material {
  id: string // e.g. AL6061
  name: string
  unit: 'kg' | 'm' | 'm2' | 'pcs'
  rate: number // price per unit, in USD
  source: string
}

export interface ProcessDef {
  id: string // e.g. CNC_MILL
  name: string
  setupTime: number // minutes per setup
  runRate: number // minutes per produced unit
  laborRate: number // USD per hour
  machineRate: number // USD per hour
}

export interface Part {
  id: string
  parentId: string | null // hierarchy (BOM roll-up)
  carId: string
  deptId: string
  name: string
  qtyPerCar: number
  materialId: string
  mass: number // in the material unit (kg / m / m2 / pcs)
  processId: string
  processQty: number // number of process runs to produce one part
  assemblyTime: number // minutes to assemble one part
  status: 'draft' | 'approved'
  // When set, this is the finalized cost carried from an imported FSAE report
  // (material/process unknown); the cost engine uses it directly.
  reportCost?: number
}

// A computed part with cost breakdown (not stored, derived).
export interface PartCost {
  materialCost: number
  mfgCost: number
  assemblyCost: number
  totalCost: number
  extendedCost: number // total * qtyPerCar
}

export interface DataSnapshot {
  cars: Car[]
  departments: Department[]
  materials: Material[]
  processes: ProcessDef[]
  parts: Part[]
}

// Column mapping to the Google Sheet. Kept explicit so we can match your existing template.
export const SHEET_COLUMNS: Record<keyof Part, string> = {
  id: 'Part ID',
  parentId: 'Parent ID',
  carId: 'Car',
  deptId: 'Department',
  name: 'Part Name',
  qtyPerCar: 'Qty / Car',
  materialId: 'Material',
  mass: 'Mass / Unit',
  processId: 'Process',
  processQty: 'Process Qty',
  assemblyTime: 'Assembly (min)',
  status: 'Status',
  reportCost: 'Report Cost (USD)',
}
