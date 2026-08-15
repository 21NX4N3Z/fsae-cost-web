import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computePart, rollUp, grandTotal } from '../cost'
import type { Material, Part, ProcessDef } from '../../types'

const materials: Material[] = [
  { id: 'AL', name: 'Al', unit: 'kg', rate: 10, source: '' },
]
const processes: ProcessDef[] = [
  { id: 'MILL', name: 'Mill', setupTime: 60, runRate: 30, laborRate: 12, machineRate: 24 },
]

test('material only cost', () => {
  const part: Part = base({ materialId: 'AL', mass: 2, processId: 'MILL', processQty: 0, assemblyTime: 0 })
  const c = computePart(part, materials, processes)
  assert.equal(c.materialCost, 20) // 2 * 10
  assert.equal(c.mfgCost, 24) // setup 1h * 24
  assert.equal(c.assemblyCost, 0)
})

test('manufacturing includes run + machine + labor', () => {
  const part: Part = base({ materialId: 'AL', mass: 0, processId: 'MILL', processQty: 2, assemblyTime: 0 })
  // setup 1h*24 + run 1h*(24+12) = 24 + 36 = 60
  const c = computePart(part, materials, processes)
  assert.equal(c.mfgCost, 60)
})

test('assembly cost', () => {
  const part: Part = base({ materialId: 'AL', mass: 0, processId: 'MILL', processQty: 0, assemblyTime: 30 })
  // 0.5h * 12 = 6
  const c = computePart(part, materials, processes)
  assert.equal(c.assemblyCost, 6)
})

test('extended multiplies by qty', () => {
  const part: Part = base({ materialId: 'AL', mass: 1, processId: 'MILL', processQty: 0, assemblyTime: 0, qtyPerCar: 4 })
  const c = computePart(part, materials, processes)
  // material 10 + mfg setup 24 = 34 -> *4 = 136
  assert.equal(c.extendedCost, 136)
})

test('roll-up sums children', () => {
  const parent: Part = base({ id: 'P', materialId: 'AL', mass: 1, processId: 'MILL', processQty: 0, assemblyTime: 0 })
  const child: Part = base({ id: 'C', parentId: 'P', materialId: 'AL', mass: 1, processId: 'MILL', processQty: 0, assemblyTime: 0 })
  const parts = [parent, child]
  const r = rollUp(parent, parts, materials, processes)
  // parent 34 + child 34 = 68
  assert.equal(r.extendedCost, 68)
})

test('grand total counts top-level only', () => {
  const parent: Part = base({ id: 'P', materialId: 'AL', mass: 1, processId: 'MILL', processQty: 0, assemblyTime: 0 })
  const child: Part = base({ id: 'C', parentId: 'P', materialId: 'AL', mass: 1, processId: 'MILL', processQty: 0, assemblyTime: 0 })
  const other: Part = base({ id: 'O', materialId: 'AL', mass: 2, processId: 'MILL', processQty: 0, assemblyTime: 0 })
  const total = grandTotal([parent, child, other], materials, processes)
  // parent rollup = 34 (self) + 34 (child) = 68; other standalone = 20 + 24 = 44; total 112
  assert.equal(total, 112)
})

function base(p: Partial<Part>): Part {
  return {
    id: 'X',
    parentId: null,
    carId: 'BP18',
    deptId: 'BDF',
    name: 'x',
    qtyPerCar: 1,
    materialId: '',
    mass: 0,
    processId: '',
    processQty: 1,
    assemblyTime: 0,
    status: 'draft',
    ...p,
  } as Part
}
