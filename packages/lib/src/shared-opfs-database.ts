import type { SqlValue } from '@sqlite.org/sqlite-wasm'
import {
  serializeBrowserSqliteRuntimeOptions,
  type BrowserSqliteRuntimeOptions,
} from './browser-sqlite-runtime.js'
import {
  createDatabase,
  isOpfsSupported,
  type AsyncSqliteDatabase,
  type DatabaseCreationResult,
  type PersistenceType,
  type SqliteIndexSnapshot,
  type SqliteKey,
  type SqliteRow,
  type SqliteTableColumn,
  type SqliteTableSnapshot,
} from './sqlite.js'
import type {
  CoordinatorClientMessage,
  CoordinatorServerMessage,
  DedicatedWorkerRequest,
  DedicatedWorkerResponse,
  SerializedWorkerError,
  SharedSqliteMethod,
  SharedSqliteMethodArgs,
  SharedSqliteMethodResult,
} from './shared-opfs-protocol.js'
import { serializeWorkerError } from './shared-opfs-protocol.js'

const ACTIVE_OWNER_LOCK_NAME = 'sink.shared-opfs.active-owner'
const HEARTBEAT_INTERVAL_MS = 5_000
const SHARED_OPFS_REQUEST_TIMEOUT_MS = 10_000
const SHARED_OPFS_TAB_ID_STORAGE_KEY = 'sink.shared-opfs.tab-id'

interface WorkerMessageEvent<TValue> {
  data: TValue
}

interface EventTargetLike {
  addEventListener(
    type: 'message' | 'pagehide' | 'beforeunload',
    listener: (event: WorkerMessageEvent<any>) => void,
  ): void
  removeEventListener(
    type: 'message' | 'pagehide' | 'beforeunload',
    listener: (event: WorkerMessageEvent<any>) => void,
  ): void
}

interface MessagePortLike extends EventTargetLike {
  postMessage(message: unknown): void
  start(): void
  close(): void
}

interface WorkerLike extends EventTargetLike {
  postMessage(message: unknown): void
  terminate(): void
}

interface SharedWorkerLike {
  port: MessagePortLike
}

interface WorkerConstructorLike {
  new (url: URL, options?: { type?: 'module'; name?: string }): WorkerLike
}

interface SharedWorkerConstructorLike {
  new (
    url: URL,
    options?: { type?: 'module'; name?: string },
  ): SharedWorkerLike
}

interface MessageChannelConstructorLike {
  new (): { port1: MessagePortLike; port2: MessagePortLike }
}

interface BrowserWindowLike {
  addEventListener(
    type: 'pagehide' | 'beforeunload',
    listener: () => void,
  ): void
  removeEventListener(
    type: 'pagehide' | 'beforeunload',
    listener: () => void,
  ): void
}

interface StorageManagerLike {
  getDirectory?(): Promise<{
    removeEntry(name: string): Promise<void>
  }>
}

interface LockManagerLike {
  request(
    name: string,
    callback: () => Promise<void> | void,
  ): Promise<void>
}

interface NavigatorLike {
  storage?: StorageManagerLike
  locks?: LockManagerLike
}

interface SessionStorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

interface Deferred<TValue> {
  promise: Promise<TValue>
  resolve: (value: TValue) => void
  reject: (error: unknown) => void
}

export interface SharedOpfsDatabaseOptions {
  filename: string
  fallbackPersistence?: Exclude<PersistenceType, 'opfs'>
  sqliteRuntime?: BrowserSqliteRuntimeOptions
}

export interface SharedOpfsSupportStatus {
  supported: boolean
  opfsSupported: boolean
  sharedWorkerSupported: boolean
  workerSupported: boolean
  messageChannelSupported: boolean
}

export async function createSharedOpfsDatabase(
  options: SharedOpfsDatabaseOptions,
): Promise<DatabaseCreationResult> {
  if (!supportsSharedOpfs()) {
    return createDatabase({
      preferredPersistence: options.fallbackPersistence ?? 'localStorage',
      opfsFilename: options.filename,
      sqliteRuntime: options.sqliteRuntime,
    })
  }

  if (options.sqliteRuntime?.workerFactory) {
    throw new Error(
      'sqliteRuntime.workerFactory is not supported in shared OPFS mode. Use sqliteRuntime.assetBaseUrl for shared deployments.',
    )
  }

  try {
    const database = await SharedWorkerSqliteDatabase.create(
      options.filename,
      options.sqliteRuntime,
    )
    return {
      database,
      persistenceType: 'opfs',
    }
  } catch (error) {
    console.warn(
      'Shared OPFS database creation failed, falling back to configured persistence:',
      error,
    )

    return createDatabase({
      preferredPersistence: options.fallbackPersistence ?? 'localStorage',
      opfsFilename: options.filename,
      sqliteRuntime: options.sqliteRuntime,
    })
  }
}

export function getSharedOpfsSupportStatus(): SharedOpfsSupportStatus {
  const globals = getSharedOpfsGlobals()

  return {
    supported: supportsSharedOpfs(),
    opfsSupported: isOpfsSupported(),
    sharedWorkerSupported: Boolean(globals.SharedWorker),
    workerSupported: Boolean(globals.Worker),
    messageChannelSupported: Boolean(globals.MessageChannel),
  }
}

export function getSharedOpfsBrowserTabId(): string | null {
  const tabId = readSharedOpfsTabId()
  return tabId ? shortId(tabId) : null
}

export async function clearSharedOpfsDatabase(options: {
  filename: string
}): Promise<void> {
  if (isOpfsSupported()) {
    const directory = await getOpfsDirectory()

    try {
      await directory.removeEntry(options.filename)
    } catch (error) {
      if (isMissingOpfsEntryError(error)) {
        return
      }

      throw new Error(
        `Unable to clear the local OPFS database. Close other tabs for this app and try again. ${getErrorMessage(error)}`,
      )
    }

    return
  }

  const { database, persistenceType } = await createDatabase({
    preferredPersistence: 'localStorage',
  })

  try {
    if (persistenceType !== 'memory') {
      await dropAllUserTables(database)
    }
  } finally {
    await database.close()
  }
}

function supportsSharedOpfs(): boolean {
  const globals = getSharedOpfsGlobals()

  return (
    Boolean(globals.Worker) &&
    Boolean(globals.SharedWorker) &&
    Boolean(globals.MessageChannel) &&
    isOpfsSupported()
  )
}

class SharedWorkerSqliteDatabase implements AsyncSqliteDatabase {
  readonly version = 'shared-opfs'
  readonly #tabId = getOrCreateSharedOpfsTabId()
  readonly #filename: string
  readonly #sqliteRuntime: ReturnType<typeof serializeBrowserSqliteRuntimeOptions>
  readonly #worker: WorkerLike
  readonly #coordinator: SharedWorkerLike
  readonly #port: MessagePortLike
  readonly #pendingWorkerRequests = new Map<string, Deferred<unknown>>()
  readonly #pendingCoordinatorRequests = new Map<string, Deferred<unknown>>()

  #closed = false
  #active = false
  #heartbeatTimer: ReturnType<typeof setInterval> | null = null
  #releaseActiveOwnerLock: (() => void) | null = null
  #roleTransition: Promise<void> = Promise.resolve()

  private constructor(
    filename: string,
    sqliteRuntime?: BrowserSqliteRuntimeOptions,
  ) {
    this.#filename = filename
    this.#sqliteRuntime = serializeBrowserSqliteRuntimeOptions(sqliteRuntime)
    const globals = getSharedOpfsGlobals()

    if (!globals.Worker || !globals.SharedWorker) {
      throw new Error('Shared OPFS is not supported in this environment.')
    }

    this.#worker = new globals.Worker(
      new URL('./shared-opfs-dedicated.worker.js', import.meta.url),
      { type: 'module' },
    )
    this.#coordinator = new globals.SharedWorker(
      new URL('./shared-opfs-coordinator.shared-worker.js', import.meta.url),
      {
        type: 'module',
        name: 'sink-shared-opfs-coordinator',
      },
    )
    this.#port = this.#coordinator.port
  }

  static async create(
    filename: string,
    sqliteRuntime?: BrowserSqliteRuntimeOptions,
  ): Promise<SharedWorkerSqliteDatabase> {
    const database = new SharedWorkerSqliteDatabase(filename, sqliteRuntime)

    try {
      await database.initialize()
      await database.request('execute', ['SELECT 1'])
      return database
    } catch (error) {
      await database.close().catch(() => {})
      throw error
    }
  }

  async execute(sql: string, bind?: SqlValue[]): Promise<void> {
    await this.request('execute', [sql, bind])
  }

  async query<TRow extends object = SqliteRow>(
    sql: string,
    bind?: SqlValue[],
  ): Promise<TRow[]> {
    return this.request('query', [sql, bind]) as Promise<TRow[]>
  }

  async getTableColumns(tableName: string): Promise<SqliteTableColumn[]> {
    return this.request('getTableColumns', [tableName])
  }

  async getTableIndexes(tableName: string): Promise<SqliteIndexSnapshot[]> {
    return this.request('getTableIndexes', [tableName])
  }

  async rowExists(
    tableName: string,
    key: SqliteKey,
    keyColumns?: readonly string[],
  ): Promise<boolean> {
    return this.request('rowExists', [tableName, key, keyColumns])
  }

  async coerceTableValue(
    tableName: string,
    columnName: string,
    rawValue: string,
  ): Promise<SqlValue> {
    return this.request('coerceTableValue', [tableName, columnName, rawValue])
  }

  async createInsertableRow(tableName: string): Promise<SqliteRow> {
    return this.request('createInsertableRow', [tableName])
  }

  async inspectTables(limit = 100): Promise<SqliteTableSnapshot[]> {
    return this.request('inspectTables', [limit])
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return
    }

    this.#closed = true

    if (this.#heartbeatTimer !== null) {
      clearInterval(this.#heartbeatTimer)
      this.#heartbeatTimer = null
    }

    const browserWindow = getBrowserWindowLike()
    browserWindow?.removeEventListener('pagehide', this.handlePageHide)
    browserWindow?.removeEventListener('beforeunload', this.handlePageHide)

    try {
      this.#port.postMessage({
        type: 'unregister',
        tabId: this.#tabId,
      } satisfies CoordinatorClientMessage)
    } catch {
      // Ignore coordinator shutdown errors during close.
    }

    await this.deactivateWorker()
    this.#port.close()
    this.#worker.terminate()

    for (const deferred of this.#pendingCoordinatorRequests.values()) {
      void deferred.promise.catch(() => {})
      deferred.reject(new Error('Shared OPFS database closed.'))
    }

    for (const deferred of this.#pendingWorkerRequests.values()) {
      void deferred.promise.catch(() => {})
      deferred.reject(new Error('Shared OPFS database worker closed.'))
    }

    this.#pendingCoordinatorRequests.clear()
    this.#pendingWorkerRequests.clear()
  }

  private async initialize(): Promise<void> {
    this.#port.start()
    this.#port.addEventListener('message', this.handleCoordinatorMessage)
    this.#worker.addEventListener('message', this.handleWorkerMessage)

    this.#port.postMessage({
      type: 'register',
      tabId: this.#tabId,
    } satisfies CoordinatorClientMessage)

    this.#heartbeatTimer = setInterval(() => {
      this.#port.postMessage({
        type: 'heartbeat',
        tabId: this.#tabId,
        sentAt: Date.now(),
      } satisfies CoordinatorClientMessage)
    }, HEARTBEAT_INTERVAL_MS)

    const browserWindow = getBrowserWindowLike()
    browserWindow?.addEventListener('pagehide', this.handlePageHide)
    browserWindow?.addEventListener('beforeunload', this.handlePageHide)
  }

  private readonly handlePageHide = () => {
    if (this.#closed) {
      return
    }

    try {
      this.#port.postMessage({
        type: 'unregister',
        tabId: this.#tabId,
      } satisfies CoordinatorClientMessage)
    } catch {
      // Ignore unload messaging errors.
    }
  }

  private readonly handleCoordinatorMessage = (
    event: WorkerMessageEvent<CoordinatorServerMessage>,
  ) => {
    const message = event.data

    switch (message.type) {
      case 'role': {
        if (message.tabId !== this.#tabId) {
          return
        }

        this.#roleTransition = this.#roleTransition.then(async () => {
          if (message.isActive) {
            await this.activateWorker()
          } else {
            await this.deactivateWorker()
          }
        })
        return
      }
      case 'execute-request': {
        if (!this.#active) {
          return
        }

        void this.executeCoordinatorRequest(message)
        return
      }
      case 'db-result': {
        const deferred = this.#pendingCoordinatorRequests.get(message.requestId)

        if (!deferred) {
          return
        }

        this.#pendingCoordinatorRequests.delete(message.requestId)

        if (message.ok) {
          deferred.resolve(message.result)
        } else {
          deferred.reject(deserializeWorkerError(message.error))
        }
        return
      }
    }
  }

  private readonly handleWorkerMessage = (
    event: WorkerMessageEvent<DedicatedWorkerResponse>,
  ) => {
    const message = event.data
    const deferred = this.#pendingWorkerRequests.get(message.requestId)

    if (!deferred) {
      return
    }

    this.#pendingWorkerRequests.delete(message.requestId)

    if (message.ok) {
      deferred.resolve(message.result)
    } else {
      deferred.reject(deserializeWorkerError(message.error))
    }
  }

  private async activateWorker(): Promise<void> {
    if (this.#closed || this.#active) {
      return
    }

    try {
      this.#releaseActiveOwnerLock = await acquireActiveOwnerLock()
      await this.requestWorker('open', {
        type: 'open',
        requestId: createRequestId(),
        filename: this.#filename,
        sqliteRuntime: this.#sqliteRuntime,
      })
      this.#active = true
      this.#port.postMessage({
        type: 'active-ready',
        tabId: this.#tabId,
      } satisfies CoordinatorClientMessage)
    } catch (error) {
      this.#releaseActiveOwnerLock?.()
      this.#releaseActiveOwnerLock = null
      this.#active = false
      this.#port.postMessage({
        type: 'active-failed',
        tabId: this.#tabId,
        error: serializeWorkerError(error),
      } satisfies CoordinatorClientMessage)
    }
  }

  private async deactivateWorker(): Promise<void> {
    if (!this.#active) {
      this.#releaseActiveOwnerLock?.()
      this.#releaseActiveOwnerLock = null
      return
    }

    this.#active = false

    try {
      await this.requestWorker('close', {
        type: 'close',
        requestId: createRequestId(),
      })
    } finally {
      this.#releaseActiveOwnerLock?.()
      this.#releaseActiveOwnerLock = null
    }
  }

  private async executeCoordinatorRequest(
    message: Extract<CoordinatorServerMessage, { type: 'execute-request' }>,
  ): Promise<void> {
    try {
      const result = await this.requestWorker('call', {
        type: 'call',
        requestId: createRequestId(),
        method: message.method,
        args: message.args,
      })

      this.#port.postMessage({
        type: 'db-response',
        executorTabId: this.#tabId,
        requesterTabId: message.requesterTabId,
        requestId: message.requestId,
        ok: true,
        result,
      } satisfies CoordinatorClientMessage)
    } catch (error) {
      this.#port.postMessage({
        type: 'db-response',
        executorTabId: this.#tabId,
        requesterTabId: message.requesterTabId,
        requestId: message.requestId,
        ok: false,
        error: serializeWorkerError(error),
      } satisfies CoordinatorClientMessage)
    }
  }

  private async request<TMethod extends SharedSqliteMethod>(
    method: TMethod,
    args: SharedSqliteMethodArgs[TMethod],
  ): Promise<SharedSqliteMethodResult[TMethod]> {
    if (this.#closed) {
      throw new Error('Shared OPFS database closed.')
    }

    const requestId = createRequestId()
    const deferred = createDeferred<SharedSqliteMethodResult[TMethod]>({
      timeoutMs: SHARED_OPFS_REQUEST_TIMEOUT_MS,
      timeoutMessage: `Timed out waiting for the shared OPFS coordinator while calling "${method}".`,
    })
    this.#pendingCoordinatorRequests.set(requestId, deferred as Deferred<unknown>)

    this.#port.postMessage({
      type: 'db-request',
      tabId: this.#tabId,
      requestId,
      method,
      args,
    } satisfies CoordinatorClientMessage)

    return deferred.promise.finally(() => {
      this.#pendingCoordinatorRequests.delete(requestId)
    })
  }

  private async requestWorker<
    TMessage extends DedicatedWorkerRequest,
    TResult = unknown,
  >(
    _type: TMessage['type'],
    message: TMessage,
  ): Promise<TResult> {
    const deferred = createDeferred<TResult>({
      timeoutMs: SHARED_OPFS_REQUEST_TIMEOUT_MS,
      timeoutMessage: `Timed out waiting for the shared OPFS worker to handle "${message.type}".`,
    })
    this.#pendingWorkerRequests.set(
      message.requestId,
      deferred as Deferred<unknown>,
    )
    this.#worker.postMessage(message)
    return deferred.promise.finally(() => {
      this.#pendingWorkerRequests.delete(message.requestId)
    })
  }
}

function createDeferred<TValue>(options?: {
  timeoutMs?: number
  timeoutMessage?: string
}): Deferred<TValue> {
  let resolvePromise!: (value: TValue) => void
  let rejectPromise!: (error: unknown) => void
  let settled = false
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  const promise = new Promise<TValue>((nextResolve, nextReject) => {
    resolvePromise = nextResolve
    rejectPromise = nextReject
  })

  const settle = <TArg,>(callback: (value: TArg) => void) => (value: TArg) => {
    if (settled) {
      return
    }

    settled = true

    if (timeoutId !== null) {
      clearTimeout(timeoutId)
      timeoutId = null
    }

    callback(value)
  }

  const resolve = settle<TValue>(resolvePromise)
  const reject = settle<unknown>(rejectPromise)

  if (options?.timeoutMs) {
    timeoutId = setTimeout(() => {
      reject(new Error(options.timeoutMessage ?? 'Operation timed out.'))
    }, options.timeoutMs)
  }

  return {
    promise,
    resolve,
    reject,
  }
}

function createRequestId(): string {
  return crypto.randomUUID()
}

function getSharedOpfsGlobals(): {
  Worker: WorkerConstructorLike | undefined
  SharedWorker: SharedWorkerConstructorLike | undefined
  MessageChannel: MessageChannelConstructorLike | undefined
} {
  const globals = globalThis as Record<string, unknown>

  return {
    Worker: globals.Worker as WorkerConstructorLike | undefined,
    SharedWorker: globals.SharedWorker as SharedWorkerConstructorLike | undefined,
    MessageChannel: globals.MessageChannel as MessageChannelConstructorLike | undefined,
  }
}

function getNavigatorLike(): NavigatorLike | null {
  const globals = globalThis as Record<string, unknown>
  return (globals.navigator as NavigatorLike | undefined) ?? null
}

function getBrowserWindowLike(): BrowserWindowLike | null {
  const globals = globalThis as Record<string, unknown>
  const candidate = (globals.window as BrowserWindowLike | undefined) ?? null

  if (candidate) {
    return candidate
  }

  if (
    typeof globals.addEventListener === 'function' &&
    typeof globals.removeEventListener === 'function'
  ) {
    return globals as unknown as BrowserWindowLike
  }

  return null
}

function getSessionStorageLike(): SessionStorageLike | null {
  const globals = globalThis as Record<string, unknown>
  return (globals.sessionStorage as SessionStorageLike | undefined) ?? null
}

async function getOpfsDirectory(): Promise<{
  removeEntry(name: string): Promise<void>
}> {
  const navigatorLike = getNavigatorLike()
  const directory = await navigatorLike?.storage?.getDirectory?.()

  if (!directory) {
    throw new Error('OPFS directory access is not available in this environment.')
  }

  return directory
}

async function acquireActiveOwnerLock(): Promise<() => void> {
  const navigatorLike = getNavigatorLike()

  if (!navigatorLike?.locks?.request) {
    return () => {}
  }

  const release = createDeferred<void>()

  const lockPromise = navigatorLike.locks.request(
    ACTIVE_OWNER_LOCK_NAME,
    async () => {
      await release.promise
    },
  )

  return () => {
    release.resolve()
    void lockPromise.catch(() => {})
  }
}

function getOrCreateSharedOpfsTabId(): string {
  const existing = readSharedOpfsTabId()

  if (existing) {
    return existing
  }

  const nextId = crypto.randomUUID()
  getSessionStorageLike()?.setItem(SHARED_OPFS_TAB_ID_STORAGE_KEY, nextId)
  return nextId
}

function readSharedOpfsTabId(): string | null {
  return getSessionStorageLike()?.getItem(SHARED_OPFS_TAB_ID_STORAGE_KEY) ?? null
}

function shortId(value: string): string {
  return value.slice(0, 8)
}

function deserializeWorkerError(error: SerializedWorkerError): Error {
  const nextError = new Error(error.message)
  nextError.name = error.name

  if (error.stack) {
    nextError.stack = error.stack
  }

  return nextError
}

async function dropAllUserTables(database: AsyncSqliteDatabase): Promise<void> {
  const tables = await database.query<{ name: string }>(
    `SELECT "name"
     FROM "sqlite_master"
     WHERE "type" = 'table' AND "name" NOT LIKE 'sqlite_%'
     ORDER BY "name" ASC;`,
  )

  for (const table of tables) {
    await database.execute(`DROP TABLE IF EXISTS "${table.name.replaceAll('"', '""')}";`)
  }
}

function isMissingOpfsEntryError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'NotFoundError'
  )
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
