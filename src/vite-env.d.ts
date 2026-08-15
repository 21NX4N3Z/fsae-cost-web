/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DATA_MODE?: string
  readonly VITE_NOCODB_URL?: string
  readonly VITE_NOCODB_TOKEN?: string
  readonly VITE_NOCODB_TABLE_PARTS?: string
  readonly VITE_NOCODB_TABLE_CARS?: string
  readonly VITE_NOCODB_TABLE_DEPTS?: string
  readonly VITE_NOCODB_TABLE_MATERIALS?: string
  readonly VITE_NOCODB_TABLE_PROCESSES?: string
  readonly VITE_USD_TO_THB?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
