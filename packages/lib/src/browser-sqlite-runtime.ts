import type { Sqlite3Static } from '@sqlite.org/sqlite-wasm'

const SQLITE_WASM_FILENAME = 'sqlite3.wasm'
const SQLITE_WORKER_FILENAME = 'sqlite3-worker1.mjs'
const SQLITE_OPFS_PROXY_FILENAME = 'sqlite3-opfs-async-proxy.js'
const LOCAL_SOURCE_RUNTIME_SEGMENT = '/packages/lib/src/'
const SQLITE_WORKER_READY_TIMEOUT_MS = 10_000
const DEFAULT_SQLITE_ASSET_BASE_URL = resolveDefaultSqliteAssetBaseUrl()

interface BrowserSqliteMessageEvent<TValue = unknown> {
  data: TValue
}

interface BrowserSqliteWorkerLike {
  onerror: ((...args: unknown[]) => void) | null
  onmessage: ((event: BrowserSqliteMessageEvent) => void) | null
  postMessage(message: unknown): void
  terminate(): void
}

interface BrowserSqliteWorkerConstructorLike {
  new (
    url: string | URL,
    options?: { type?: 'module'; name?: string },
  ): BrowserSqliteWorkerLike
}

interface BrowserSqliteModule {
  default: (options?: {
    locateFile?: (path: string, prefix: string) => string
  }) => Promise<Sqlite3Static>
  sqlite3Worker1Promiser: (config: {
    onerror?: (...args: unknown[]) => void
    onready?: () => void
    worker?: BrowserSqliteWorkerLike | (() => BrowserSqliteWorkerLike)
  }) => unknown
}

interface BrowserSqliteRuntimeAssets {
  assetBaseUrl: string
  opfsProxyUrl: string
  wasmUrl: string
  workerUrl: string
}

export interface BrowserSqliteRuntimeOptions {
  assetBaseUrl?: string
  workerFactory?: (assets: {
    workerUrl: string
    wasmUrl: string
    opfsProxyUrl: string
  }) => BrowserSqliteWorkerLike
}

type SerializedBrowserSqliteRuntimeOptions = Pick<
  BrowserSqliteRuntimeOptions,
  'assetBaseUrl'
>

let sqlitePromise: Promise<Sqlite3Static> | null = null

export async function loadBrowserSqlite(
  options?: SerializedBrowserSqliteRuntimeOptions,
): Promise<Sqlite3Static> {
  if (sqlitePromise === null) {
    const assets = resolveBrowserSqliteRuntimeAssets(options)
    sqlitePromise = loadBrowserSqliteModule()
      .then(({ default: init }) =>
        init({
          locateFile: (path) => resolveSqliteAssetPath(path, assets),
        }),
      )
      .catch((error) => {
        sqlitePromise = null
        throw error
      })
  }

  return sqlitePromise
}

export async function createBrowserSqlitePromiser<TPromiser>(
  options?: BrowserSqliteRuntimeOptions,
): Promise<TPromiser> {
  const sqliteModule = await loadBrowserSqliteModule()
  const assets = resolveBrowserSqliteRuntimeAssets(
    serializeBrowserSqliteRuntimeOptions(options),
  )
  const usesDefaultWorker = !options?.workerFactory
  const worker =
    options?.workerFactory?.(toPublicBrowserSqliteRuntimeAssets(assets)) ??
    createDefaultSqliteWorker(assets)

  return new Promise<TPromiser>((resolve, reject) => {
    let promiser: unknown
    let settled = false

    const rejectInitialization = (error: unknown) => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timeoutId)

      if (usesDefaultWorker) {
        terminateBrowserSqliteWorker(worker)
      }

      reject(toBrowserSqliteWorkerError(error))
    }

    const timeoutId = setTimeout(() => {
      rejectInitialization(
        new Error('Timed out waiting for the SQLite browser worker to initialize.'),
      )
    }, SQLITE_WORKER_READY_TIMEOUT_MS)

    try {
      promiser = sqliteModule.sqlite3Worker1Promiser({
        onerror: (...args) => {
          rejectInitialization(args)
        },
        onready: () => {
          if (settled) {
            return
          }

          settled = true
          clearTimeout(timeoutId)
          resolve(promiser as TPromiser)
        },
        worker,
      })
    } catch (error) {
      rejectInitialization(error)
    }
  })
}

export function serializeBrowserSqliteRuntimeOptions(
  options?: BrowserSqliteRuntimeOptions,
): SerializedBrowserSqliteRuntimeOptions | undefined {
  const assetBaseUrl = options?.assetBaseUrl?.trim()

  if (!assetBaseUrl) {
    return undefined
  }

  return {
    assetBaseUrl: normalizeAssetBaseUrl(assetBaseUrl),
  }
}

function toPublicBrowserSqliteRuntimeAssets(
  assets: BrowserSqliteRuntimeAssets,
): {
  workerUrl: string
  wasmUrl: string
  opfsProxyUrl: string
} {
  return {
    workerUrl: assets.workerUrl,
    wasmUrl: assets.wasmUrl,
    opfsProxyUrl: assets.opfsProxyUrl,
  }
}

function createDefaultSqliteWorker(
  assets: BrowserSqliteRuntimeAssets,
): BrowserSqliteWorkerLike {
  const WorkerConstructor = getWorkerConstructor()

  return new WorkerConstructor(createSqliteWorkerUrl(assets), {
    type: 'module',
  })
}

function createSqliteWorkerUrl(assets: BrowserSqliteRuntimeAssets): string {
  const workerUrl = new URL(assets.workerUrl)
  workerUrl.searchParams.set('sqlite3.dir', stripTrailingSlash(assets.assetBaseUrl))
  return workerUrl.toString()
}

function getWorkerConstructor(): BrowserSqliteWorkerConstructorLike {
  const globals = globalThis as Record<string, unknown>
  const WorkerConstructor = globals.Worker as
    | BrowserSqliteWorkerConstructorLike
    | undefined

  if (!WorkerConstructor) {
    throw new Error('Web Worker is not available in this environment.')
  }

  return WorkerConstructor
}

async function loadBrowserSqliteModule(): Promise<BrowserSqliteModule> {
  return import('@sqlite.org/sqlite-wasm') as unknown as Promise<BrowserSqliteModule>
}

function resolveBrowserSqliteRuntimeAssets(
  options?: SerializedBrowserSqliteRuntimeOptions,
): BrowserSqliteRuntimeAssets {
  const assetBaseUrl = options?.assetBaseUrl
    ? normalizeAssetBaseUrl(options.assetBaseUrl)
    : DEFAULT_SQLITE_ASSET_BASE_URL

  return {
    assetBaseUrl,
    workerUrl: new URL(SQLITE_WORKER_FILENAME, assetBaseUrl).toString(),
    wasmUrl: new URL(SQLITE_WASM_FILENAME, assetBaseUrl).toString(),
    opfsProxyUrl: new URL(SQLITE_OPFS_PROXY_FILENAME, assetBaseUrl).toString(),
  }
}

function resolveDefaultSqliteAssetBaseUrl(): string {
  const moduleUrl = new URL(import.meta.url)
  moduleUrl.search = ''
  moduleUrl.hash = ''

  const localSourceRuntimeIndex = moduleUrl.pathname.lastIndexOf(
    LOCAL_SOURCE_RUNTIME_SEGMENT,
  )

  if (localSourceRuntimeIndex >= 0) {
    moduleUrl.pathname = `${moduleUrl.pathname.slice(
      0,
      localSourceRuntimeIndex,
    )}/packages/lib/dist/`
    return moduleUrl.toString()
  }

  moduleUrl.pathname = toDirectoryPathname(moduleUrl.pathname)
  return moduleUrl.toString()
}

function resolveSqliteAssetPath(
  path: string,
  assets: BrowserSqliteRuntimeAssets,
): string {
  if (path === SQLITE_WASM_FILENAME) {
    return assets.wasmUrl
  }

  if (path === SQLITE_OPFS_PROXY_FILENAME) {
    return assets.opfsProxyUrl
  }

  return new URL(path, assets.assetBaseUrl).toString()
}

function normalizeAssetBaseUrl(assetBaseUrl: string): string {
  const locationHref = (globalThis as { location?: { href?: string } }).location?.href
  return new URL(ensureTrailingSlash(assetBaseUrl), locationHref ?? import.meta.url)
    .toString()
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`
}

function stripTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

function toDirectoryPathname(pathname: string): string {
  const lastSlashIndex = pathname.lastIndexOf('/')
  return lastSlashIndex >= 0 ? pathname.slice(0, lastSlashIndex + 1) : '/'
}

function terminateBrowserSqliteWorker(worker: BrowserSqliteWorkerLike): void {
  try {
    worker.terminate()
  } catch {
    // Ignore worker shutdown failures during initialization cleanup.
  }
}

function toBrowserSqliteWorkerError(error: unknown): Error {
  if (error instanceof Error) {
    return error
  }

  if (Array.isArray(error)) {
    const nestedError = error.find((value): value is Error => value instanceof Error)

    if (nestedError) {
      return nestedError
    }

    return new Error(
      error.length > 0
        ? error.map((value) => stringifyBrowserSqliteWorkerErrorPart(value)).join(' ')
        : 'SQLite browser worker initialization failed.',
    )
  }

  return new Error(stringifyBrowserSqliteWorkerErrorPart(error))
}

function stringifyBrowserSqliteWorkerErrorPart(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  if (value instanceof Error) {
    return value.message
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
