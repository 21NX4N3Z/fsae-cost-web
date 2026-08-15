import { LayoutDashboard, ListTree, Library as LibraryIcon } from 'lucide-react'

interface Props {
  view: 'dashboard' | 'parts' | 'library'
  setView: (v: 'dashboard' | 'parts' | 'library') => void
}

const items = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'parts', label: 'Parts / BOM', icon: ListTree },
  { id: 'library', label: 'Library', icon: LibraryIcon },
] as const

export default function Sidebar({ view, setView }: Props) {
  return (
    <nav
      aria-label="Primary"
      className="flex w-56 shrink-0 flex-col gap-1 border-r border-border bg-surface p-3"
    >
      <p className="px-2 pb-2 pt-1 text-xs font-semibold uppercase tracking-wider text-muted">
        Menu
      </p>
      {items.map((it) => {
        const Icon = it.icon
        const active = view === it.id
        return (
          <button
            key={it.id}
            onClick={() => setView(it.id)}
            aria-current={active ? 'page' : undefined}
            className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              active ? 'bg-accent-2/20 text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg'
            }`}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {it.label}
          </button>
        )
      })}
      <div className="mt-auto rounded-md border border-border bg-surface-2 p-3 text-xs text-muted">
        Data stored in USD. Toggle display to THB. Connect Google Sheet via NocoDB
        (see README).
      </div>
    </nav>
  )
}
