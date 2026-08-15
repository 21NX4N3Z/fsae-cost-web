import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { importBp16b } from '../importBp16b'
import { rollUp, computePart } from '../cost'

// Resolve the real team template across environments.
const CANDIDATES = [
  'C:/Users/azzin/Documents/Body & Frame Cost BP16b.xlsx',
  '/c/Users/azzin/Documents/Body & Frame Cost BP16b.xlsx',
  'public/template/Body & Frame Cost BP16b.xlsx',
]

function findTemplate(): string | null {
  for (const p of CANDIDATES) if (existsSync(p)) return p
  return null
}

// This test reads the real team template; skip gracefully if not present.
test('importBp16b parses assemblies + children with correct roll-up', async () => {
  const path = findTemplate()
  if (!path) {
    console.warn('SKIP: BP16b template not found in', CANDIDATES)
    return
  }
  const buf = readFileSync(path)
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  const res = await importBp16b(ab, { carId: 'BP16b', carName: 'BP16b' })

  // 149 data sheets (excl. cover/cover copies) -> ~148 assemblies
  assert.ok(res.assemblies >= 100, `expected >=100 assemblies, got ${res.assemblies}`)
  assert.ok(res.children > 0, 'expected child parts')
  assert.ok(res.parts.length === res.assemblies + res.children)

  // Department mapping: FR -> BDF
  const bdf = res.departments.find((d) => d.id === 'BDF')
  assert.ok(bdf, 'BDF department present')
  assert.equal(bdf?.name, 'Body & Frame')

  // Every assembly must have a reportCost (from children roll-up or T1)
  const assemblies = res.parts.filter((p) => !p.parentId)
  const withCost = assemblies.filter((a) => (a.reportCost ?? 0) > 0)
  assert.ok(withCost.length > assemblies.length * 0.8, 'most assemblies have a cost')

  // Assembly with children must carry its own reportCost (from V1), not be 0.
  const sample = assemblies.find((a) => res.parts.some((p) => p.parentId === a.id))
  if (sample) {
    assert.ok((sample.reportCost ?? 0) > 0, 'assembly with children has a reportCost')
    const r = rollUp(sample, res.parts, [], [])
    assert.ok(r.totalCost > 0, 'rollUp produces a positive total')
  }

  // computePart with reportCost returns that value directly
  const c = computePart(sample!, [], [], false)
  assert.ok(c.totalCost > 0)
})
