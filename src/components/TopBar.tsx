import { Cpu, ChevronDown, DollarSign, Database } from 'lucide-react'
import type { Currency } from '../lib/cost'
import { formatMoney } from '../lib/cost'

interface Props {
  currency: Currency
  setCurrency: (c: Currency) => void
  dataMode: string
  total: number
}

export default function TopBar({ currency, setCurrency, dataMode, total }: Props) {
  return (
    <header className="flex items-center justify-between border-b border-border bg-surface px-6 py-3">
      <div className="flex items-center gap-3">
        <Cpu className="h-5 w-5 text-accent" aria-hidden />
        <div>
          <h1 className="text-base font-semibold leading-tight">BP Cost</h1>
          <p className="text-xs text-muted">FSAE / BAJA Cost Entry</p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="text-right">
          <p className="text-xs text-muted">Total (all cars)</p>
          <p className="tnum text-lg font-semibold leading-tight">
            {formatMoney(total, currency)}
          </p>
        </div>

        <button
          onClick={() => setCurrency(currency === 'USD' ? 'THB' : 'USD')}
          className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm font-medium transition-colors hover:border-accent"
          aria-label={`Switch display currency, currently ${currency}`}
        >
          <DollarSign className="h-4 w-4" aria-hidden />
          <span className="tnum">{currency}</span>
          <ChevronDown className="h-3 w-3 text-muted" aria-hidden />
        </button>

        <span
          className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted"
          title="Data source mode"
        >
          <Database className="h-3.5 w-3.5" aria-hidden />
          {dataMode === 'nocodb' ? 'Sheets (live)' : 'Local'}
        </span>
      </div>
    </header>
  )
}
