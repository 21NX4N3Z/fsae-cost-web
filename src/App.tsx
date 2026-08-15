import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useStore } from './data/useStore'
import { dataMode } from './lib/nocodb'
import { snapshotTotal } from './lib/cost'
import type { Currency } from './lib/cost'
import TopBar from './components/TopBar'
import Sidebar from './components/Sidebar'
import Dashboard from './components/Dashboard'
import PartsView from './components/PartsView'
import Library from './components/Library'

type View = 'dashboard' | 'parts' | 'library'

export default function App() {
  const store = useStore()
  const qc = useQueryClient()
  const { data: currency } = useQuery<Currency>({
    queryKey: ['currency'],
    queryFn: () => 'USD' as Currency,
    staleTime: Infinity,
  })
  const cur = currency ?? 'USD'

  const setCurrency = (c: Currency) => qc.setQueryData(['currency'], c)

  const view = (sessionStorage.getItem('view') as View) || 'dashboard'
  const setView = (v: View) => {
    sessionStorage.setItem('view', v)
    qc.setQueryData(['view'], v)
  }
  useQuery({ queryKey: ['view'], queryFn: () => view, staleTime: Infinity })

  const total = snapshotTotal(store.snapshot)

  return (
    <div className="flex h-dvh bg-base text-fg">
      <Sidebar view={view} setView={setView} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar currency={cur} setCurrency={setCurrency} dataMode={dataMode} total={total} />
        <main className="flex-1 overflow-y-auto p-6">
          {view === 'dashboard' && <Dashboard store={store} currency={cur} />}
          {view === 'parts' && <PartsView store={store} currency={cur} />}
          {view === 'library' && <Library store={store} currency={cur} />}
        </main>
      </div>
    </div>
  )
}
