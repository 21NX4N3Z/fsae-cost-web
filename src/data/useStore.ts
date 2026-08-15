import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { seedData } from './seed'
import type { Car, DataSnapshot, Department, Material, Part, ProcessDef } from '../types'

const KEY = 'fsae-cost-snapshot-v1'

function load(): DataSnapshot {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as DataSnapshot
  } catch {
    // fall through to seed
  }
  const seeded = seedData()
  localStorage.setItem(KEY, JSON.stringify(seeded))
  return seeded
}

function save(data: DataSnapshot) {
  localStorage.setItem(KEY, JSON.stringify(data))
}

export function useStore() {
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: ['snapshot'],
    queryFn: load,
    staleTime: Infinity,
  })
  const snapshot = data ?? seedData()

  const setSnapshot = (next: DataSnapshot) => {
    save(next)
    qc.setQueryData(['snapshot'], next)
  }

  const upsertPart = useMutation({
    mutationFn: (part: Part) => {
      const next = { ...snapshot }
      const i = next.parts.findIndex((p) => p.id === part.id)
      if (i >= 0) next.parts[i] = part
      else next.parts.push(part)
      setSnapshot(next)
      return Promise.resolve(part)
    },
  })

  // Save an assembly together with its child parts (replaces existing children).
  const upsertAssembly = (assembly: Part, children: Part[]) => {
    const next = { ...snapshot }
    // remove old version of this assembly + its old children
    next.parts = next.parts.filter((p) => p.id !== assembly.id && p.parentId !== assembly.id)
    next.parts.push(assembly, ...children.map((c) => ({ ...c, parentId: assembly.id, carId: assembly.carId, deptId: assembly.deptId })))
    setSnapshot(next)
  }

  const deletePart = (id: string) => {
    setSnapshot({
      ...snapshot,
      parts: snapshot.parts.filter((p) => p.id !== id && p.parentId !== id),
    })
  }

  const addCar = (car: Car) => setSnapshot({ ...snapshot, cars: [...snapshot.cars, car] })
  const addDept = (d: Department) =>
    setSnapshot({ ...snapshot, departments: [...snapshot.departments, d] })
  const addMaterial = (m: Material) =>
    setSnapshot({ ...snapshot, materials: [...snapshot.materials, m] })
  const addProcess = (p: ProcessDef) =>
    setSnapshot({ ...snapshot, processes: [...snapshot.processes, p] })

  const deleteCar = (id: string) =>
    setSnapshot({
      ...snapshot,
      cars: snapshot.cars.filter((c) => c.id !== id),
      parts: snapshot.parts.filter((p) => p.carId !== id),
    })
  const deleteDept = (id: string) =>
    setSnapshot({
      ...snapshot,
      departments: snapshot.departments.filter((d) => d.id !== id),
      parts: snapshot.parts.filter((p) => p.deptId !== id),
    })
  const deleteMaterial = (id: string) =>
    setSnapshot({ ...snapshot, materials: snapshot.materials.filter((m) => m.id !== id) })
  const deleteProcess = (id: string) =>
    setSnapshot({ ...snapshot, processes: snapshot.processes.filter((p) => p.id !== id) })

  // Merge an imported BP16b report (car + departments + parts) into the snapshot.
  // Replaces any existing car with the same id and its parts.
  const mergeImport = (res: { car: Car; departments: Department[]; parts: Part[] }) => {
    const next = { ...snapshot }
    next.cars = [...next.cars.filter((c) => c.id !== res.car.id), res.car]
    next.departments = [
      ...next.departments.filter((d) => !res.departments.some((nd) => nd.id === d.id)),
      ...res.departments,
    ]
    next.parts = [...next.parts.filter((p) => p.carId !== res.car.id), ...res.parts]
    setSnapshot(next)
  }

  // Copy a car's BOM to a new car (FSAE -> BAJA reuse).
  const copyCarBom = (fromCarId: string, toCarId: string) => {
    const src = snapshot.parts.filter((p) => p.carId === fromCarId)
    if (!src.length) return
    const idMap = new Map<string, string>()
    const clones: Part[] = src.map((p) => {
      const newId = `${toCarId}-${p.id.split('-').slice(1).join('-')}-${Math.random().toString(36).slice(2, 6)}`
      idMap.set(p.id, newId)
      return { ...p, id: newId, carId: toCarId, parentId: null, status: 'draft' }
    })
    clones.forEach((c) => {
      if (c.parentId && idMap.has(c.parentId)) c.parentId = idMap.get(c.parentId)!
    })
    setSnapshot({ ...snapshot, parts: [...snapshot.parts, ...clones] })
  }

  const resetAll = () => setSnapshot(seedData())

  return {
    snapshot,
    upsertPart: upsertPart.mutate,
    upsertAssembly,
    deletePart,
    addCar,
    addDept,
    addMaterial,
    addProcess,
    deleteCar,
    deleteDept,
    deleteMaterial,
    deleteProcess,
    copyCarBom,
    mergeImport,
    resetAll,
  }
}
