import {
  createDatabase,
  isOpfsSupported,
  type AsyncSqliteDatabase,
  type PersistenceType,
  type SqliteIndexSnapshot,
  type SqliteKey,
  type SqliteRow,
  type SqliteTableColumn,
  type SqliteTableSnapshot,
} from '@sink/lib'
import type { SqlValue } from '@sqlite.org/sqlite-wasm'
import type {
  CoordinatorClientMessage,
  CoordinatorServerMessage,
  DedicatedWorkerRequest,
  DedicatedWorkerResponse,
  SerializedWorkerError,
  SharedSqliteMethod,
  SharedSqliteMethodArgs,
  SharedSqliteMethodResult,
} from '@/lib/shared-opfs-protocol'
import { serializeWorkerError } from '@/lib/shared-opfs-protocol'

const ACTIVE_OWNER_LOCK_NAME = 'sink.shared-opfs.active-owner'
const HEARTBEAT_INTERVAL_MS = 5_000
const SHARED_OPFS_TAB_ID_STORAGE_KEY = 'sink.shared-opfs.tab-id'

interface DatabaseCreationResult {
  database: AsyncSqliteDatabase
  persistenceType: PersistenceType
}

interface Deferred<TValue> {
  promise: Promise<TValue>
  resolve: (value: TValue) => void
  reject: (error: unknown) => void
}

export async function createSharedOpfsDatabase(options: {
  filename: string
}): Promise<DatabaseCreationResult> {
  if (!supportsSharedOpfs()) {
    return createDatabase({
      preferredPersistence: 'opfs',
      opfsFilename: options.filename,
    })
  }

  const database = await SharedWorkerSqliteDatabase.create(options.filename)
  return {
    database,
    persistenceType: 'opfs',
  }
}

export function getSharedOpfsBrowserTabId(): string | null {
  const tabId = readSharedOpfsTabId()
  return tabId ? shortId(tabId) : null
}

export async function clearSharedBrowserDatabase(options: {
  filename: string
}): Promise<void> {
  if (isOpfsSupported()) {
    const directory = await navigator.storage.getDirectory()

    try {
      await directory.removeEntry(options.filename)
    } catch (error) {
      if (isMissingOpfsEntryError(error)) {
        return
      }

      throw new Error(
        `Unable to clear the local OPFS database. Close other sandbox tabs and try again. ${getErrorMessage(error)}`,
      )
    }

    return
  }

  const { database, persistenceType } = await createDatabase({
    preferredPersistence: 'localStorage',
    localStorageType: 'local',
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
  return (
    typeof Worker !== 'undefined' &&
    typeof SharedWorker !== 'undefined' &&
    typeof MessageChannel !== 'undefined' &&
    isOpfsSupported()
  )
}

class SharedWorkerSqliteDatabase implements AsyncSqliteDatabase {
  readonly version = 'shared-opfs'
  readonly #tabId = getOrCreateSharedOpfsTabId()
  readonly #filename: string
  readonly #worker: Worker
  readonly #coordinator: SharedWorker
  readonly #port: MessagePort
  readonly #pendingWorkerRequests = new Map<string, Deferred<unknown>>()
  readonly #pendingCoordinatorRequests = new Map<string, Deferred<unknown>>()

  #closed = false
  #active = false
  #heartbeatTimer: ReturnType<typeof setInterval> | null = null
  #releaseActiveOwnerLock: (() => void) | null = null
  #roleTransition: Promise<void> = Promise.resolve()

  private constructor(filename: string) {
    this.#filename = filename
    this.#worker = new Worker(
      new URL('../workers/sqlite-opfs-dedicated.worker.ts', import.meta.url),
      { type: 'module' },
    )
    this.#coordinator = new SharedWorker(
      new URL('../workers/sqlite-opfs-coordinator.shared-worker.ts', import.meta.url),
      {
        type: 'module',
        name: 'sink-shared-opfs-coordinator',
      },
    )
    this.#port = this.#coordinator.port
  }

  static async create(filename: string): Promise<SharedWorkerSqliteDatabase> {
    const database = new SharedWorkerSqliteDatabase(filename)
    await database.initialize()
    return database
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

    window.removeEventListener('pagehide', this.handlePageHide)
    window.removeEventListener('beforeunload', this.handlePageHide)

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

    window.addEventListener('pagehide', this.handlePageHide)
    window.addEventListener('beforeunload', this.handlePageHide)
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
    event: MessageEvent<CoordinatorServerMessage>,
  ) => {
    const message = event.data

    switch (message.type) {
      case 'role': {
        if (message.tabId !== this.#tabId) {
          return
        }

        this.#roleTransition = this.#roleTransition
          .then(async () => {
            if (message.isActive) {
              await this.activateWorker()
            } else {
              await this.deactivateWorker()
            }
          })
          .catch(console.error)
        return
      }
      case 'execute-request': {
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
      }
    }
  }

  private readonly handleWorkerMessage = (
    event: MessageEvent<DedicatedWorkerResponse>,
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
    if (this.#active || this.#closed) {
      return
    }

    try {
      this.#releaseActiveOwnerLock = await acquireActiveOwnerLock()
      await this.requestWorkerOpen()
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
      throw error
    }
  }

  private async deactivateWorker(): Promise<void> {
    if (!this.#active && this.#releaseActiveOwnerLock === null) {
      return
    }

    try {
      await this.requestWorkerClose()
    } catch {
      // Ignore shutdown errors while handing off the active worker.
    }

    this.#releaseActiveOwnerLock?.()
    this.#releaseActiveOwnerLock = null
    this.#active = false
  }

  private async executeCoordinatorRequest(
    message: Extract<CoordinatorServerMessage, { type: 'execute-request' }>,
  ): Promise<void> {
    try {
      const result = await this.requestWorkerCall(message.method, message.args)
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

  private requestWorkerOpen(): Promise<void> {
    return this.requestWorker('open', {
      type: 'open',
      requestId: crypto.randomUUID(),
      filename: this.#filename,
    }).then(() => undefined)
  }

  private requestWorkerClose(): Promise<void> {
    return this.requestWorker('close', {
      type: 'close',
      requestId: crypto.randomUUID(),
    }).then(() => undefined)
  }

  private requestWorkerCall<TMethod extends SharedSqliteMethod>(
    method: TMethod,
    args: SharedSqliteMethodArgs[TMethod],
  ): Promise<SharedSqliteMethodResult[TMethod]> {
    return this.requestWorker(method, {
      type: 'call',
      requestId: crypto.randomUUID(),
      method,
      args: args as SharedSqliteMethodArgs[SharedSqliteMethod],
    })
  }

  private requestWorker<TResult>(
    _label: string,
    message: DedicatedWorkerRequest,
  ): Promise<TResult> {
    if (this.#closed) {
      return Promise.reject(new Error('Shared OPFS database is closed.'))
    }

    const deferred = createDeferred<TResult>()
    this.#pendingWorkerRequests.set(message.requestId, deferred as Deferred<unknown>)
    this.#worker.postMessage(message)
    return deferred.promise
  }

  private request<TMethod extends SharedSqliteMethod>(
    method: TMethod,
    args: SharedSqliteMethodArgs[TMethod],
  ): Promise<SharedSqliteMethodResult[TMethod]> {
    if (this.#closed) {
      return Promise.reject(new Error('Shared OPFS database is closed.'))
    }

    const requestId = crypto.randomUUID()
    const deferred = createDeferred<SharedSqliteMethodResult[TMethod]>()
    this.#pendingCoordinatorRequests.set(requestId, deferred as Deferred<unknown>)
    this.#port.postMessage({
      type: 'db-request',
      tabId: this.#tabId,
      requestId,
      method,
      args: args as SharedSqliteMethodArgs[SharedSqliteMethod],
    } satisfies CoordinatorClientMessage)
    return deferred.promise
  }
}

async function acquireActiveOwnerLock(): Promise<() => void> {
  const lockManager = navigator.locks

  if (!lockManager) {
    return () => {}
  }

  let release: (() => void) | null = null
  let acquiredResolver: (() => void) | null = null
  const acquired = new Promise<void>((resolve) => {
    acquiredResolver = resolve
  })
  const hold = new Promise<void>((resolve) => {
    release = resolve
  })

  void lockManager.request(ACTIVE_OWNER_LOCK_NAME, async () => {
    acquiredResolver?.()
    await hold
  })

  await acquired
  return () => {
    release?.()
  }
}

function deserializeWorkerError(error: SerializedWorkerError): Error {
  const nextError = new Error(error.message)
  nextError.name = error.name
  nextError.stack = error.stack
  return nextError
}

function createDeferred<TValue>(): Deferred<TValue> {
  let resolve!: (value: TValue) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<TValue>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })

  return {
    promise,
    resolve,
    reject,
  }
}

async function dropAllUserTables(database: AsyncSqliteDatabase): Promise<void> {
  const tables = await database.query<{ name: string }>(
    `SELECT name
     FROM sqlite_master
     WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
     ORDER BY name ASC;`,
  )

  if (tables.length === 0) {
    return
  }

  await database.execute('PRAGMA foreign_keys = OFF;')

  try {
    for (const { name } of tables) {
      await database.execute(
        `DROP TABLE IF EXISTS "${escapeSqlIdentifier(name)}";`,
      )
    }
  } finally {
    await database.execute('PRAGMA foreign_keys = ON;')
  }
}

function escapeSqlIdentifier(identifier: string): string {
  return identifier.replaceAll('"', '""')
}

function isMissingOpfsEntryError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'NotFoundError' || error.name === 'TypeMismatchError')
  )
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function shortId(value: string): string {
  return value.slice(0, 8)
}

function getOrCreateSharedOpfsTabId(): string {
  const existing = readSharedOpfsTabId()

  if (existing) {
    return existing
  }

  const nextTabId = crypto.randomUUID()

  try {
    window.sessionStorage.setItem(SHARED_OPFS_TAB_ID_STORAGE_KEY, nextTabId)
  } catch {
    // Ignore storage failures and continue with an in-memory-only tab id.
  }

  return nextTabId
}

function readSharedOpfsTabId(): string | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const existing = window.sessionStorage.getItem(SHARED_OPFS_TAB_ID_STORAGE_KEY)
    return existing && existing.length > 0 ? existing : null
  } catch {
    return null
  }
}
