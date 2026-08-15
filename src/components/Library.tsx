import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { Currency } from '../lib/cost'
import type { Car, Department, Material, ProcessDef } from '../types'

interface Props {
  store: ReturnType<typeof import('../data/useStore').useStore>
  currency: Currency
}

type Tab = 'depts' | 'cars' | 'materials' | 'processes'

export default function Library({ store, currency }: Props) {
  const { snapshot } = store
  const [tab, setTab] = useState<Tab>('depts')

  return (
    <div>
      <h2 className="mb-2 text-xl font-semibold">Library</h2>
      <p className="mb-4 max-w-2xl text-sm text-muted">
        Reusable reference data. Materials &amp; processes drive the auto cost calc. Add new
        departments or cars any time — the app adapts automatically. Every value you add here
        is reused across parts.
      </p>

      <div className="mb-4 flex flex-wrap gap-2" role="tablist">
        {(
          [
            ['depts', 'Departments'],
            ['cars', 'Cars'],
            ['materials', 'Materials'],
            ['processes', 'Processes'],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              tab === t ? 'bg-accent-2/20 text-fg' : 'text-muted hover:bg-surface-2'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-surface p-4">
        {tab === 'depts' && (
          <Crud
            add={(v) => store.addDept(v as unknown as Department)}
            remove={store.deleteDept}
            blank={{ id: '', name: '', leadEmail: '' }}
            fields={[
              { key: 'id', label: 'ID', placeholder: 'NEW' },
              { key: 'name', label: 'Name', placeholder: 'New Department' },
              { key: 'leadEmail', label: 'Lead email', placeholder: 'a@b.com' },
            ]}
            renderRows={(onDel) =>
              snapshot.departments.map((d) => (
                <Row key={d.id} onDel={() => onDel(d.id)}>
                  <Cell>{d.id}</Cell>
                  <Cell>{d.name}</Cell>
                  <Cell>{d.leadEmail || '—'}</Cell>
                </Row>
              ))
            }
            head={['ID', 'Name', 'Lead email']}
          />
        )}

        {tab === 'cars' && (
          <Crud
            add={(v) => {
              const r = v as Record<string, unknown>
              const car: Car = {
                id: String(r.id),
                name: String(r.name),
                class: r.class === 'BAJA' ? 'BAJA' : 'FSAE',
                year: Number(r.year) || 2026,
                status: 'active',
              }
              store.addCar(car)
            }}
            remove={store.deleteCar}
            blank={{ id: '', name: '', class: 'FSAE', year: 2026 }}
            fields={[
              { key: 'id', label: 'ID', placeholder: 'BP19' },
              { key: 'name', label: 'Name', placeholder: 'BP19 (FSAE)' },
              {
                key: 'class',
                label: 'Class',
                select: [
                  ['FSAE', 'FSAE'],
                  ['BAJA', 'BAJA'],
                ],
              },
              { key: 'year', label: 'Year', placeholder: '2026', numeric: true },
            ]}
            renderRows={(onDel) =>
              snapshot.cars.map((c) => (
                <Row key={c.id} onDel={() => onDel(c.id)}>
                  <Cell>{c.id}</Cell>
                  <Cell>{c.name}</Cell>
                  <Cell>
                    <span className={`badge ${c.class === 'BAJA' ? 'badge-warn' : 'badge-ok'}`}>{c.class}</span>
                  </Cell>
                </Row>
              ))
            }
            head={['ID', 'Name', 'Class']}
          />
        )}

        {tab === 'materials' && (
          <Crud
            add={(v) => {
              const r = v as Record<string, unknown>
              const m: Material = {
                id: String(r.id),
                name: String(r.name),
                unit: (r.unit as Material['unit']) || 'kg',
                rate: Number(r.rate) || 0,
                source: String(r.source || ''),
              }
              store.addMaterial(m)
            }}
            remove={store.deleteMaterial}
            blank={{ id: '', name: '', unit: 'kg', rate: 0, source: '' }}
            fields={[
              { key: 'id', label: 'ID', placeholder: 'TI6AL4V' },
              { key: 'name', label: 'Name', placeholder: 'Titanium' },
              {
                key: 'unit',
                label: 'Unit',
                select: [
                  ['kg', 'kg'],
                  ['m', 'm'],
                  ['m2', 'm²'],
                  ['pcs', 'pcs'],
                ],
              },
              { key: 'rate', label: 'Rate $/unit', numeric: true },
              { key: 'source', label: 'Source', placeholder: 'supplier' },
            ]}
            renderRows={(onDel) =>
              snapshot.materials.map((m) => (
                <Row key={m.id} onDel={() => onDel(m.id)}>
                  <Cell>{m.id}</Cell>
                  <Cell>{m.name}</Cell>
                  <Cell>{m.unit}</Cell>
                  <Cell mono>${m.rate}</Cell>
                  <Cell>{m.source}</Cell>
                </Row>
              ))
            }
            head={['ID', 'Name', 'Unit', 'Rate', 'Source']}
          />
        )}

        {tab === 'processes' && (
          <Crud
            add={(v) => {
              const r = v as Record<string, unknown>
              const p: ProcessDef = {
                id: String(r.id),
                name: String(r.name),
                setupTime: Number(r.setupTime) || 0,
                runRate: Number(r.runRate) || 0,
                laborRate: Number(r.laborRate) || 0,
                machineRate: Number(r.machineRate) || 0,
              }
              store.addProcess(p)
            }}
            remove={store.deleteProcess}
            blank={{ id: '', name: '', setupTime: 0, runRate: 0, laborRate: 0, machineRate: 0 }}
            fields={[
              { key: 'id', label: 'ID', placeholder: 'LASER' },
              { key: 'name', label: 'Name', placeholder: 'Laser cut' },
              { key: 'setupTime', label: 'Setup min', numeric: true },
              { key: 'runRate', label: 'Run min/unit', numeric: true },
              { key: 'laborRate', label: '$/hr labor', numeric: true },
              { key: 'machineRate', label: '$/hr machine', numeric: true },
            ]}
            renderRows={(onDel) =>
              snapshot.processes.map((p) => (
                <Row key={p.id} onDel={() => onDel(p.id)}>
                  <Cell>{p.id}</Cell>
                  <Cell>{p.name}</Cell>
                  <Cell mono>{p.setupTime}'</Cell>
                  <Cell mono>{p.runRate}'</Cell>
                  <Cell mono>${p.laborRate}</Cell>
                  <Cell mono>${p.machineRate}</Cell>
                </Row>
              ))
            }
            head={['ID', 'Name', 'Setup', 'Run', 'Labor', 'Machine']}
          />
        )}
      </div>

      <p className="mt-4 text-xs text-muted">
        Costs shown in {currency}. Underlying sheet values are always USD.
      </p>
    </div>
  )
}

// --- generic CRUD renderer ---
interface FieldDef {
  key: string
  label: string
  placeholder?: string
  numeric?: boolean
  select?: [string, string][]
}

function Crud({
  add,
  remove,
  blank,
  fields,
  renderRows,
  head,
}: {
  add: (v: Record<string, unknown>) => void
  remove: (id: string) => void
  blank: Record<string, unknown>
  fields: FieldDef[]
  renderRows: (onDel: (id: string) => void) => React.ReactNode
  head: string[]
}) {
  const [draft, setDraft] = useState<Record<string, unknown>>(blank)
  const set = (k: string, v: unknown) => setDraft({ ...draft, [k]: v })
  const canAdd = fields.every((f) => String(draft[f.key] ?? '').trim() !== '')

  return (
    <div>
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {fields.map((f) => (
          <label key={f.key} className="block">
            <span className="mb-1 block text-xs text-muted">{f.label}</span>
            {f.select ? (
              <select value={String(draft[f.key] ?? '')} onChange={(e) => set(f.key, e.target.value)} className="libinp">
                {f.select.map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            ) : (
              <input
                value={String(draft[f.key] ?? '')}
                type={f.numeric ? 'number' : 'text'}
                placeholder={f.placeholder}
                onChange={(e) => set(f.key, f.numeric ? Number(e.target.value) : e.target.value)}
                className="libinp"
              />
            )}
          </label>
        ))}
        <div className="flex items-end">
          <button
            disabled={!canAdd}
            onClick={() => {
              add(draft)
              setDraft(blank)
            }}
            className="flex items-center gap-1 rounded-md bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            <Plus className="h-4 w-4" aria-hidden /> Add
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-muted">
            <tr>
              {head.map((h) => (
                <th key={h} className="px-3 py-2 font-medium">{h}</th>
              ))}
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>{renderRows((id) => remove(id))}</tbody>
        </table>
      </div>

      <style>{`
        .libinp { width:100%; border-radius:0.375rem; border:1px solid theme('colors.border'); background:theme('colors.surface-2'); padding:0.45rem 0.6rem; font-size:0.8125rem; color:theme('colors.fg'); }
        .libinp:focus-visible { outline:2px solid theme('colors.accent'); outline-offset:1px; }
        .badge { display:inline-block; padding:0.1rem 0.5rem; border-radius:9999px; font-size:0.7rem; font-weight:600; }
        .badge-ok { background:rgba(63,185,80,0.15); color:#3fb950; }
        .badge-warn { background:rgba(210,153,34,0.15); color:#d29922; }
      `}</style>
    </div>
  )
}

function Row({ children, onDel }: { children: React.ReactNode; onDel: () => void }) {
  return (
    <tr className="border-t border-border">
      {children}
      <td className="px-3 py-2 text-right">
        <button onClick={onDel} aria-label="Delete" className="text-danger hover:underline">
          <Trash2 className="inline h-4 w-4" aria-hidden />
        </button>
      </td>
    </tr>
  )
}

function Cell({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return <td className={`px-3 py-2 ${mono ? 'tnum' : 'text-muted'}`}>{children}</td>
}
