import { useState } from 'react'
import { Download } from 'lucide-react'
import { buildCostXlsxBrowser } from '../lib/costXlsxBrowser'
import type { DataSnapshot } from '../types'

interface Props {
  snapshot: DataSnapshot
}

function downloadBlob(buf: ArrayBuffer, filename: string) {
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function ExportBar({ snapshot }: Props) {
  const [carId, setCarId] = useState(snapshot.cars[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const onExport = async () => {
    if (!carId) return
    setBusy(true)
    setErr(null)
    try {
      const buf = await buildCostXlsxBrowser(snapshot, { carId })
      downloadBlob(buf, `${carId}_Cost.xlsx`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={carId}
        onChange={(e) => setCarId(e.target.value)}
        className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
        aria-label="Car to export"
      >
        {snapshot.cars.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      <button
        onClick={onExport}
        disabled={busy || !carId}
        className="flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-2 disabled:opacity-50"
      >
        <Download className="h-4 w-4" aria-hidden />
        {busy ? 'Exporting…' : 'Export FSAE xlsx'}
      </button>
      {err && <span className="text-xs text-danger">{err}</span>}
    </div>
  )
}
