import { useMemo, useState } from 'react'
import { Plus, Trash2, Copy, Pencil, Check, X } from 'lucide-react'
import type { Currency } from '../lib/cost'
import { formatMoney, rollUp } from '../lib/cost'
import type { Part } from '../types'
import { pushPart } from '../lib/nocodb'
import PartEditor from './PartEditor'

interface Props {
  store: ReturnType<typeof import('../data/useStore').useStore>
  currency: Currency
}

export default function PartsView({ store, currency }: Props) {
  const { snapshot } = store
  const [editing, setEditing] = useState<Part | 'new' | null>(null)
  const [filterCar, setFilterCar] = useState<string>('')
  const [filterDept, setFilterDept] = useState<string>('')

  const rows = useMemo(() => {
    let list = snapshot.parts.filter((p) => !p.parentId)
    if (filterCar) list = list.filter((p) => p.carId === filterCar)
    if (filterDept) list = list.filter((p) => p.deptId === filterDept)
    return list
  }, [snapshot.parts, filterCar, filterDept])

  const deptName = (id: string) => snapshot.departments.find((d) => d.id === id)?.name ?? id
  const carName = (id: string) => snapshot.cars.find((c) => c.id === id)?.name ?? id

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Parts / BOM</h2>
        <button
          onClick={() => setEditing('new')}
          className="flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-2"
        >
          <Plus className="h-4 w-4" aria-hidden /> New Part
        </button>
      </div>

      <div className="mb-4 flex flex-wrap gap-3">
        <select
          value={filterCar}
          onChange={(e) => setFilterCar(e.target.value)}
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
          aria-label="Filter by car"
        >
          <option value="">All cars</option>
          {snapshot.cars.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select
          value={filterDept}
          onChange={(e) => setFilterDept(e.target.value)}
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
          aria-label="Filter by department"
        >
          <option value="">All departments</option>
          {snapshot.departments.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        <CopyBom store={store} />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Part</th>
              <th className="px-4 py-2 font-medium">Car</th>
              <th className="px-4 py-2 font-medium">Dept</th>
              <th className="px-4 py-2 text-right font-medium">Qty/Car</th>
              <th className="px-4 py-2 text-right font-medium">Material</th>
              <th className="px-4 py-2 text-right font-medium">Mfg</th>
              <th className="px-4 py-2 text-right font-medium">Assembly</th>
              <th className="px-4 py-2 text-right font-medium">Extended (USD)</th>
              <th className="px-4 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const c = rollUp(p, snapshot.parts, snapshot.materials, snapshot.processes)
              return (
                <tr key={p.id} className="border-t border-border">
                  <td className="px-4 py-2">
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-muted">{p.id}</div>
                  </td>
                  <td className="px-4 py-2 text-muted">{carName(p.carId)}</td>
                  <td className="px-4 py-2 text-muted">{deptName(p.deptId)}</td>
                  <td className="tnum px-4 py-2 text-right">{p.qtyPerCar}</td>
                  <td className="tnum px-4 py-2 text-right">{formatMoney(c.materialCost, currency)}</td>
                  <td className="tnum px-4 py-2 text-right">{formatMoney(c.mfgCost, currency)}</td>
                  <td className="tnum px-4 py-2 text-right">{formatMoney(c.assemblyCost, currency)}</td>
                  <td className="tnum px-4 py-2 text-right font-semibold">{formatMoney(c.extendedCost, currency)}</td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => setEditing(p)} className="mr-2 text-accent hover:underline" aria-label={`Edit ${p.name}`}>
                      <Pencil className="inline h-4 w-4" aria-hidden />
                    </button>
                    <button onClick={() => store.deletePart(p.id)} className="text-danger hover:underline" aria-label={`Delete ${p.name}`}>
                      <Trash2 className="inline h-4 w-4" aria-hidden />
                    </button>
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-6 text-center text-muted">No parts. Add one or copy a car's BOM.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <PartEditor
          part={editing === 'new' ? null : editing}
          snapshot={snapshot}
          currency={currency}
          onClose={() => setEditing(null)}
          onSave={(asm, children) => {
            store.upsertAssembly(asm, children)
            // Fire-and-forget push to sheet (no-op in local mode).
            pushPart(asm).catch(() => {})
            children.forEach((c) => pushPart(c).catch(() => {}))
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

function CopyBom({ store }: { store: ReturnType<typeof import('../data/useStore').useStore> }) {
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const { snapshot } = store
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm text-muted hover:text-fg"
      >
        <Copy className="h-4 w-4" aria-hidden /> Copy car BOM
      </button>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm">
      <span className="text-muted">From</span>
      <select value={from} onChange={(e) => setFrom(e.target.value)} className="rounded border border-border bg-surface-2 px-2 py-1" aria-label="From car">
        <option value="">select</option>
        {snapshot.cars.map((c) => <option key={c.id} value={c.id}>{c.id}</option>)}
      </select>
      <span className="text-muted">to</span>
      <select value={to} onChange={(e) => setTo(e.target.value)} className="rounded border border-border bg-surface-2 px-2 py-1" aria-label="To car">
        <option value="">select</option>
        {snapshot.cars.map((c) => <option key={c.id} value={c.id}>{c.id}</option>)}
      </select>
      <button
        onClick={() => { if (from && to && from !== to) { store.copyCarBom(from, to); setOpen(false) } }}
        className="rounded bg-accent px-2 py-1 text-white"
      >
        <Check className="inline h-3 w-3" aria-hidden /> Copy
      </button>
      <button onClick={() => setOpen(false)} className="text-muted"><X className="inline h-3 w-3" aria-hidden /></button>
    </div>
  )
}
