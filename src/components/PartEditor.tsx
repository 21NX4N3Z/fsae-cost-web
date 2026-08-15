import { useState } from 'react'
import { X, Plus } from 'lucide-react'
import type { Currency } from '../lib/cost'
import { formatMoney, computePart } from '../lib/cost'
import type { DataSnapshot, Part } from '../types'

interface Props {
  part: Part | null
  snapshot: DataSnapshot
  currency: Currency
  onClose: () => void
  // Saves the assembly AND its child parts together.
  onSave: (assembly: Part, children: Part[]) => void
}

const emptyChild = (parentId: string): Part => ({
  id: '',
  parentId,
  carId: '',
  deptId: '',
  name: '',
  qtyPerCar: 1,
  materialId: '',
  mass: 0,
  processId: '',
  processQty: 1,
  assemblyTime: 0,
  status: 'draft',
})

export default function PartEditor({ part, snapshot, currency, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<Part>(part ?? emptyAssembly())
  const [children, setChildren] = useState<Part[]>(
    part ? snapshot.parts.filter((p) => p.parentId === part.id) : [],
  )
  const [editingChild, setEditingChild] = useState<Part | null>(null)
  const set = <K extends keyof Part>(k: K, v: Part[K]) => setDraft({ ...draft, [k]: v })

  const preview = computePart(draft, snapshot.materials, snapshot.processes)

  const saveChild = (c: Part) => {
    setChildren((prev) => {
      const i = prev.findIndex((p) => p.id === c.id)
      if (i >= 0) {
        const next = [...prev]
        next[i] = c
        return next
      }
      return [...prev, c]
    })
    setEditingChild(null)
  }

  const removeChild = (id: string) => setChildren((prev) => prev.filter((p) => p.id !== id))

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4">
      <div className="mt-8 w-full max-w-3xl rounded-xl border border-border bg-surface p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">{part ? 'Edit Assembly' : 'New Assembly'}</h3>
          <button onClick={onClose} aria-label="Close" className="text-muted hover:text-fg">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {/* Assembly fields */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Part ID">
            <input value={draft.id} onChange={(e) => set('id', e.target.value)} placeholder="BP18-CHASSIS" className="inp" />
          </Field>
          <Field label="Assembly Name">
            <input value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="Space Frame" className="inp" />
          </Field>
          <Field label="Car">
            <select value={draft.carId} onChange={(e) => set('carId', e.target.value)} className="inp">
              <option value="">select</option>
              {snapshot.cars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Department">
            <select value={draft.deptId} onChange={(e) => set('deptId', e.target.value)} className="inp">
              <option value="">select</option>
              {snapshot.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="Qty / Car">
            <input type="number" value={draft.qtyPerCar} min={1} onChange={(e) => set('qtyPerCar', Number(e.target.value))} className="inp tnum" />
          </Field>
          <Field label="Status">
            <select value={draft.status} onChange={(e) => set('status', e.target.value as Part['status'])} className="inp">
              <option value="draft">draft</option>
              <option value="approved">approved</option>
            </select>
          </Field>
        </div>

        {/* Children (details block) */}
        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-semibold uppercase tracking-wider text-muted">Child Parts (Details)</h4>
            {draft.id && (
              <button
                onClick={() => setEditingChild(emptyChild(draft.id))}
                className="flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-1 text-xs hover:border-accent"
              >
                <Plus className="h-3 w-3" aria-hidden /> Add child
              </button>
            )}
          </div>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-left text-muted">
                <tr>
                  <th className="px-3 py-1 font-medium">Name</th>
                  <th className="px-3 py-1 text-right font-medium">Material</th>
                  <th className="px-3 py-1 text-right font-medium">Mass</th>
                  <th className="px-3 py-1 text-right font-medium">Process</th>
                  <th className="px-3 py-1 text-right font-medium">Cost</th>
                  <th className="px-3 py-1" />
                </tr>
              </thead>
              <tbody>
                {children.map((c) => {
                  const cc = computePart(c, snapshot.materials, snapshot.processes)
                  return (
                    <tr key={c.id} className="border-t border-border">
                      <td className="px-3 py-1">{c.name || <span className="text-muted">unnamed</span>}</td>
                      <td className="px-3 py-1 text-right text-muted">{c.materialId}</td>
                      <td className="tnum px-3 py-1 text-right text-muted">{c.mass}</td>
                      <td className="px-3 py-1 text-right text-muted">{c.processId}</td>
                      <td className="tnum px-3 py-1 text-right">{formatMoney(cc.totalCost, currency)}</td>
                      <td className="px-3 py-1 text-right">
                        <button onClick={() => setEditingChild(c)} className="mr-2 text-accent hover:underline">edit</button>
                        <button onClick={() => removeChild(c.id)} className="text-danger hover:underline">del</button>
                      </td>
                    </tr>
                  )
                })}
                {children.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-3 text-center text-muted">No child parts yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Assembly cost preview */}
        <div className="mt-5 rounded-lg border border-border bg-surface-2 p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
            Assembly cost (USD basis, incl. children)
          </p>
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <Metric label="Material" value={preview.materialCost} cur={currency} />
            <Metric label="Mfg" value={preview.mfgCost} cur={currency} />
            <Metric label="Assembly" value={preview.assemblyCost} cur={currency} />
            <Metric label="Extended" value={preview.extendedCost} cur={currency} strong />
          </div>
          <p className="mt-1 text-xs text-muted">
            + {children.length} child part{children.length === 1 ? '' : 's'} summed in export
          </p>
        </div>

        <div className="mt-5 flex justify-end gap-3">
          <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm text-muted hover:text-fg">Cancel</button>
          <button
            disabled={!draft.id || !draft.name || !draft.carId || !draft.deptId}
            onClick={() => onSave(draft, children)}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </div>

      {editingChild && (
        <ChildEditor
          child={editingChild}
          snapshot={snapshot}
          currency={currency}
          onClose={() => setEditingChild(null)}
          onSave={saveChild}
        />
      )}

      <style>{`
        .inp { width:100%; border-radius:0.375rem; border:1px solid theme('colors.border'); background:theme('colors.surface-2'); padding:0.5rem 0.75rem; font-size:0.875rem; color:theme('colors.fg'); }
        .inp:focus-visible { outline:2px solid theme('colors.accent'); outline-offset:1px; }
      `}</style>
    </div>
  )
}

function ChildEditor({ child, snapshot, currency, onClose, onSave }: {
  child: Part
  snapshot: DataSnapshot
  currency: Currency
  onClose: () => void
  onSave: (c: Part) => void
}) {
  const [d, setD] = useState<Part>(child)
  const set = <K extends keyof Part>(k: K, v: Part[K]) => setD({ ...d, [k]: v })
  const preview = computePart(d, snapshot.materials, snapshot.processes)
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-5">
        <h4 className="mb-3 text-base font-semibold">{child.id ? 'Edit Child' : 'New Child Part'}</h4>
        <div className="grid grid-cols-1 gap-3">
          <Field label="Child ID">
            <input value={d.id} onChange={(e) => set('id', e.target.value)} placeholder="BP18-TUBE1" className="inp" />
          </Field>
          <Field label="Name">
            <input value={d.name} onChange={(e) => set('name', e.target.value)} placeholder="Frame Tube 1" className="inp" />
          </Field>
          <Field label="Material">
            <select value={d.materialId} onChange={(e) => set('materialId', e.target.value)} className="inp">
              <option value="">select</option>
              {snapshot.materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </Field>
          <Field label="Mass">
            <input type="number" value={d.mass} step="0.01" onChange={(e) => set('mass', Number(e.target.value))} className="inp tnum" />
          </Field>
          <Field label="Process">
            <select value={d.processId} onChange={(e) => set('processId', e.target.value)} className="inp">
              <option value="">select</option>
              {snapshot.processes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Process Qty">
            <input type="number" value={d.processQty} min={1} onChange={(e) => set('processQty', Number(e.target.value))} className="inp tnum" />
          </Field>
          <Field label="Assembly (min)">
            <input type="number" value={d.assemblyTime} onChange={(e) => set('assemblyTime', Number(e.target.value))} className="inp tnum" />
          </Field>
          <div className="rounded-md bg-surface-2 p-2 text-right text-sm">
            Cost: <span className="tnum font-semibold">{formatMoney(preview.totalCost, currency)}</span>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:text-fg">Cancel</button>
          <button
            disabled={!d.id || !d.name}
            onClick={() => onSave({ ...d, parentId: child.parentId, carId: d.carId || '', deptId: d.deptId || '' })}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

function emptyAssembly(): Part {
  return {
    id: '',
    parentId: null,
    carId: '',
    deptId: '',
    name: '',
    qtyPerCar: 1,
    materialId: '',
    mass: 0,
    processId: '',
    processQty: 1,
    assemblyTime: 0,
    status: 'draft',
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  )
}

function Metric({ label, value, cur, strong }: { label: string; value: number; cur: Currency; strong?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className={`tnum ${strong ? 'text-base font-semibold' : ''}`}>{formatMoney(value, cur)}</p>
    </div>
  )
}
