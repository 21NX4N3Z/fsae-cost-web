import type { DataSnapshot, Part } from '../types'

// --- Data source mode ---
// local  = browser localStorage (works with zero backend)
// nocodb = NocoDB on top of your Google Sheet (set env below)
const MODE = (import.meta.env.VITE_DATA_MODE ?? 'local') as 'local' | 'nocodb'

const NOCODB_URL = import.meta.env.VITE_NOCODB_URL ?? ''
const NOCODB_TOKEN = import.meta.env.VITE_NOCODB_TOKEN ?? ''
// Resolve table IDs by name lazily; cache first seen.
const TABLE_NAMES: Record<string, string> = {
  parts: 'parts',
  cars: 'cars',
  departments: 'departments',
  materials: 'materials',
  processes: 'processes',
}

function headers() {
  return { 'xc-token': NOCODB_TOKEN, 'Content-Type': 'application/json' }
}

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${NOCODB_URL}/api/v2${path}`, {
    ...init,
    headers: { ...headers(), ...(init?.headers ?? {}) },
  })
  if (!res.ok) throw new Error(`NocoDB ${res.status}: ${await res.text()}`)
  return res.json()
}

// NocoDB stores IDs as `Id` by default. Our upload payload is keyed by Part field names.
async function ensureTables() {
  // Minimal: assume tables already created in NocoDB UI with matching column names.
  // Look up table ids once and cache into TABLE_NAMES.
  if (Object.keys(TABLE_NAMES).every((k) => k === TABLE_NAMES[k])) {
    const bases = await api('/tables')
    for (const t of bases.list ?? []) {
      const key = Object.keys(TABLE_NAMES).find((k) => TABLE_NAMES[k] === t.title)
      if (key) TABLE_NAMES[key] = t.id
    }
  }
}

// Push a part row to the sheet (via NocoDB). Row values are USD only.
function partToRow(p: Part) {
  return {
    'Part ID': p.id,
    'Parent ID': p.parentId ?? '',
    Car: p.carId,
    Department: p.deptId,
    'Part Name': p.name,
    'Qty / Car': p.qtyPerCar,
    Material: p.materialId,
    'Mass / Unit': p.mass,
    Process: p.processId,
    'Process Qty': p.processQty,
    'Assembly (min)': p.assemblyTime,
    Status: p.status,
  }
}

export const dataMode = MODE

export async function pushPart(part: Part): Promise<void> {
  if (MODE !== 'nocodb') return
  await ensureTables()
  // Upsert by Part ID: query then create or update.
  const list = await api(
    `/tables/${TABLE_NAMES.parts}/records?where=${encodeURIComponent(
      JSON.stringify({ 'Part ID': { eq: part.id } }),
    )}`,
  )
  const row = partToRow(part)
  if (list.list?.length) {
    const id = list.list[0].Id
    await api(`/tables/${TABLE_NAMES.parts}/records/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(row),
    })
  } else {
    await api(`/tables/${TABLE_NAMES.parts}/records`, {
      method: 'POST',
      body: JSON.stringify(row),
    })
  }
}

export async function loadSnapshot(): Promise<DataSnapshot | null> {
  if (MODE !== 'nocodb') return null
  await ensureTables()
  const get = async (key: string) =>
    (await api(`/tables/${TABLE_NAMES[key]}/records?limit=1000`)).list ?? []
  // Local-only app does not rely on remote snapshot; extend here if needed.
  void get
  return null
}
