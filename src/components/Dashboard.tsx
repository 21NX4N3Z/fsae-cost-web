import { useMemo } from 'react'
import { Car as CarIcon, Layers, Wallet, Wrench } from 'lucide-react'
import type { Currency } from '../lib/cost'
import { formatMoney, splitBy } from '../lib/cost'
import ExportBar from './ExportBar'
import ImportBar from './ImportBar'

interface Props {
  store: ReturnType<typeof import('../data/useStore').useStore>
  currency: Currency
}

function Stat({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof CarIcon
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center gap-2 text-muted">
        <Icon className="h-4 w-4" aria-hidden />
        <span className="text-xs font-medium uppercase tracking-wider">{label}</span>
      </div>
      <p className="tnum mt-2 text-2xl font-semibold leading-tight">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
    </div>
  )
}

function Bar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? (value / total) * 100 : 0
  return (
    <div className="mb-3">
      <div className="mb-1 flex justify-between text-sm">
        <span className="text-fg">{label}</span>
        <span className="tnum text-muted">{formatMoney(value, 'USD')}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}

export default function Dashboard({ store, currency }: Props) {
  const { snapshot } = store
  const byDept = useMemo(
    () => splitBy(snapshot.parts, 'deptId', snapshot.materials, snapshot.processes),
    [snapshot],
  )
  const byCar = useMemo(
    () => splitBy(snapshot.parts, 'carId', snapshot.materials, snapshot.processes),
    [snapshot],
  )
  const total = useMemo(
    () =>
      Object.values(byDept).reduce((s, v) => s + v, 0),
    [byDept],
  )

  const deptName = (id: string) => snapshot.departments.find((d) => d.id === id)?.name ?? id
  const carName = (id: string) => snapshot.cars.find((c) => c.id === id)?.name ?? id
  const colors = ['#2f81f7', '#3fb950', '#d29922', '#f85149', '#a371f7', '#56d4dd']

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Dashboard</h2>
        <div className="flex flex-wrap items-center gap-3">
          <ImportBar onImport={store.mergeImport} />
          <ExportBar snapshot={snapshot} />
        </div>
      </div>
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={Wallet} label="Total Cost" value={formatMoney(total, currency)} sub="All cars, USD basis" />
        <Stat icon={CarIcon} label="Cars" value={String(snapshot.cars.length)} sub={snapshot.cars.map((c) => c.id).join(', ')} />
        <Stat icon={Layers} label="Parts" value={String(snapshot.parts.length)} sub="Top-level + children" />
        <Stat icon={Wrench} label="Departments" value={String(snapshot.departments.length)} sub="Editable" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-border bg-surface p-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">
            Cost by Department
          </h3>
          {Object.keys(byDept).length === 0 && <p className="text-sm text-muted">No parts yet.</p>}
          {Object.entries(byDept).map(([id, v], i) => (
            <Bar key={id} label={deptName(id)} value={v} total={total} color={colors[i % colors.length]} />
          ))}
        </section>

        <section className="rounded-lg border border-border bg-surface p-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted">
            Cost by Car
          </h3>
          {Object.keys(byCar).length === 0 && <p className="text-sm text-muted">No parts yet.</p>}
          {Object.entries(byCar).map(([id, v], i) => (
            <Bar key={id} label={carName(id)} value={v} total={total} color={colors[(i + 2) % colors.length]} />
          ))}
        </section>
      </div>
    </div>
  )
}
