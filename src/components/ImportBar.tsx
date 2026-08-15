import { useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { importBp16b } from '../lib/importBp16b'

interface Props {
  onImport: (res: Awaited<ReturnType<typeof importBp16b>>) => void
}

export default function ImportBar({ onImport }: Props) {
  const [busy, setBusy] = useState(false)
  const [carId, setCarId] = useState('BP16b')
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const onFile = async (file: File) => {
    setBusy(true)
    setErr(null)
    setMsg(null)
    try {
      const buf = await file.arrayBuffer()
      const res = await importBp16b(buf, { carId, carName: `${carId} (imported)` })
      onImport(res)
      setMsg(`Imported ${res.assemblies} assemblies, ${res.children} child parts → car ${carId}`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onFile(f)
          e.target.value = ''
        }}
      />
      <input
        value={carId}
        onChange={(e) => setCarId(e.target.value)}
        placeholder="Car ID"
        className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
        aria-label="Import target car id"
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm font-medium hover:border-accent disabled:opacity-50"
      >
        <Upload className="h-4 w-4" aria-hidden />
        {busy ? 'Importing…' : 'Import BP16b xlsx'}
      </button>
      {msg && <span className="text-xs text-ok">{msg}</span>}
      {err && <span className="text-xs text-danger">{err}</span>}
    </div>
  )
}
