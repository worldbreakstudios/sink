import type {
  BindingSpec,
  Database,
  SqlValue,
  Sqlite3Static,
} from '@sqlite.org/sqlite-wasm'

export type SqliteRow = Record<string, SqlValue>

export interface SqliteTableRow {
  rowId: number
  values: SqliteRow
}

export interface SqliteTableColumn {
  cid: number
  name: string
  type: string
  notnull: number
  dflt_value: SqlValue
  pk: number
}

export interface SqliteTableSnapshot {
  name: string
  schema: string
  columns: SqliteTableColumn[]
  rows: SqliteTableRow[]
}

export interface SqliteIndexSnapshot {
  name: string
  tableName: string
  unique: number
  origin: string
  partial: number
  fields: string[]
}

export interface SqliteExplorerSnapshot {
  version: string
  tables: SqliteTableSnapshot[]
}

let sqlitePromise: Promise<Sqlite3Static> | null = null

async function loadSqlite(): Promise<Sqlite3Static> {
  if (sqlitePromise === null) {
    sqlitePromise = import('@sqlite.org/sqlite-wasm').then(({ default: init }) =>
      init(),
    )
  }

  return sqlitePromise
}

export function isOpfsSupported(): boolean {
  const g = globalThis as Record<string, unknown>
  const nav = g.navigator as Record<string, unknown> | undefined
  const storage = nav?.storage as Record<string, unknown> | undefined

  return (
    'FileSystemHandle' in g &&
    'FileSystemDirectoryHandle' in g &&
    typeof storage?.getDirectory === 'function'
  )
}

export class FrontendSqliteDatabase {
  readonly #sqlite: Sqlite3Static
  readonly #db: Database

  private constructor(sqlite: Sqlite3Static, db: Database) {
    this.#sqlite = sqlite
    this.#db = db
  }

  static async createInMemory(filename = ':memory:') {
    const sqlite = await loadSqlite()
    const db = new sqlite.oo1.DB(filename, 'ct')

    return new FrontendSqliteDatabase(sqlite, db)
  }

  /**
   * Creates a database persisted to localStorage via JsStorageDb.
   * Limited to ~5MB due to localStorage constraints.
   * Works on main thread without special headers.
   */
  static async createWithLocalStorage(filename: string) {
    const sqlite = await loadSqlite()
    const JsStorageDb = (sqlite.oo1 as Record<string, unknown>)
      .JsStorageDb as new (filename: string) => Database

    if (!JsStorageDb) {
      throw new Error('JsStorageDb is not available in this sqlite-wasm build.')
    }

    const db = new JsStorageDb(filename)
    return new FrontendSqliteDatabase(sqlite, db)
  }

  /**
   * Creates a database persisted to IndexedDB.
   * Supports much larger storage than localStorage (typically 50%+ of disk).
   * Call `persistToIndexedDB()` to save changes.
   */
  static async createWithIndexedDB(filename: string) {
    const sqlite = await loadSqlite()
    const idbName = `sqlite-${filename}`

    // Try to load existing database from IndexedDB
    const existingData = await idbLoad(idbName)

    let db: Database
    if (existingData) {
      // Load from existing data - sqlite-wasm accepts Uint8Array in constructor
      // but types don't reflect this, so we use a type assertion
      const DBConstructor = sqlite.oo1.DB as new (data: Uint8Array) => Database
      db = new DBConstructor(existingData)
    } else {
      db = new sqlite.oo1.DB(':memory:', 'ct')
    }

    const instance = new FrontendSqliteDatabase(sqlite, db)
    instance.#idbName = idbName

    return instance
  }

  #idbName: string | null = null

  /**
   * Persists the current database state to IndexedDB.
   * Only works for databases created with `createWithIndexedDB`.
   */
  async persistToIndexedDB(): Promise<void> {
    if (!this.#idbName) {
      throw new Error('This database was not created with IndexedDB persistence.')
    }

    // Export database as Uint8Array
    const data = (this.#db as unknown as { export: () => Uint8Array }).export()
    await idbSave(this.#idbName, data)
  }

  /**
   * Creates a database persisted to OPFS (Origin Private File System).
   * Requires cross-origin isolation headers (COOP/COEP).
   * Note: OPFS VFS can only be installed from the main thread but
   * Atomics.wait() is blocked there, so this uses the async OPFS variant.
   */
  static async createWithOpfsVfs(filename: string) {
    const sqlite = await loadSqlite()

    if (!isOpfsSupported()) {
      throw new Error(
        'OPFS is not supported in this environment. Ensure COOP/COEP headers are set.',
      )
    }

    // Install the OPFS VFS if not already installed
    const installOpfs = (sqlite as Record<string, unknown>).installOpfsSAHPoolVfs as
      | ((options?: { name?: string }) => Promise<unknown>)
      | undefined

    if (!installOpfs) {
      throw new Error('OPFS VFS installer is not available in this sqlite-wasm build.')
    }

    try {
      const poolUtil = (await installOpfs({ name: 'opfs-sahpool' })) as {
        getVfs: () => { name: string }
      }
      const vfsName = poolUtil.getVfs().name
      const db = new sqlite.oo1.DB(filename, 'ct', vfsName)
      return new FrontendSqliteDatabase(sqlite, db)
    } catch (error) {
      // OPFS SAH Pool may fail on main thread, try regular OPFS
      const installRegularOpfs = (sqlite as Record<string, unknown>).installOpfsVfs as
        | (() => Promise<unknown>)
        | undefined

      if (!installRegularOpfs) {
        throw new Error(
          'OPFS VFS installation failed. OPFS requires running in a Web Worker for full support.',
        )
      }

      await installRegularOpfs()
      const db = new sqlite.oo1.DB(filename, 'ct', 'opfs')
      return new FrontendSqliteDatabase(sqlite, db)
    }
  }

  get version(): string {
    return this.#sqlite.version.libVersion
  }

  execute(sql: string, bind?: BindingSpec): void {
    this.#db.exec({ sql, bind })
  }

  query<TRow extends object = SqliteRow>(
    sql: string,
    bind?: BindingSpec,
  ): TRow[] {
    return this.#db.exec({
      sql,
      bind,
      rowMode: 'object',
      returnValue: 'resultRows',
    }) as TRow[]
  }

  createExplorerSnapshot(limit = 100): SqliteExplorerSnapshot {
    return {
      version: this.version,
      tables: this.inspectTables(limit),
    }
  }

  inspectTables(limit = 100): SqliteTableSnapshot[] {
    const tables = this.query<{
      name: string
      sql: string
    }>(
      `
        SELECT name, sql
        FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name ASC;
      `,
    )

    return tables.map(({ name, sql }) => ({
      name,
      schema: sql,
      columns: this.query<SqliteTableColumn>(
        `PRAGMA table_info("${escapeIdentifier(name)}");`,
      ),
      rows: this.query<Record<string, SqlValue>>(
        `SELECT rowid AS __rowid__, * FROM "${escapeIdentifier(name)}" ORDER BY rowid ASC LIMIT ${limit};`,
      ).map((row) => {
        const { __rowid__, ...values } = row

        return {
          rowId: Number(__rowid__),
          values,
        }
      }),
    }))
  }

  getTableColumns(tableName: string): SqliteTableColumn[] {
    return this.query<SqliteTableColumn>(
      `PRAGMA table_info("${escapeIdentifier(tableName)}");`,
    )
  }

  getTableIndexes(tableName: string): SqliteIndexSnapshot[] {
    return this.query<{
      name: string
      unique: number
      origin: string
      partial: number
    }>(`PRAGMA index_list("${escapeIdentifier(tableName)}");`).map((index) => ({
      ...index,
      tableName,
      fields: this.query<{
        name: string | null
      }>(`PRAGMA index_info("${escapeIdentifier(index.name)}");`)
        .map((field) => field.name)
        .filter((field): field is string => field !== null),
    }))
  }

  rowExists(tableName: string, id: SqlValue, keyColumn = '_id'): boolean {
    const result = this.query<{ matches: number }>(
      `SELECT COUNT(*) AS matches FROM "${escapeIdentifier(tableName)}" WHERE "${escapeIdentifier(keyColumn)}" = ?;`,
      [id],
    )

    return (result[0]?.matches ?? 0) > 0
  }

  coerceTableValue(
    tableName: string,
    columnName: string,
    rawValue: string,
  ): SqlValue {
    const column = this.getTableColumns(tableName).find(
      (candidate) => candidate.name === columnName,
    )

    if (!column) {
      throw new Error(`Column "${columnName}" not found in table "${tableName}".`)
    }

    return coerceInputValue(column, rawValue)
  }

  createInsertableRow(tableName: string): SqliteRow {
    const columns = this.getTableColumns(tableName)
    const row: SqliteRow = {}

    for (const column of columns) {
      if (column.pk === 1) {
        row[column.name] = this.createPrimaryKeyValue(tableName, column)
        continue
      }

      row[column.name] = createDefaultValueForColumn(column)
    }

    return row
  }

  updateCell(
    tableName: string,
    rowId: number,
    columnName: string,
    rawValue: string,
  ): void {
    const columns = this.getTableColumns(tableName)
    const column = columns.find(
      (candidate) => candidate.name === columnName,
    )

    if (!column) {
      throw new Error(`Column "${columnName}" not found in table "${tableName}".`)
    }

    const value = coerceInputValue(column, rawValue)
    const updatedAtColumn = columns.find((candidate) => candidate.name === '_updatedAt')

    if (updatedAtColumn) {
      this.execute(
        `UPDATE "${escapeIdentifier(tableName)}" SET "${escapeIdentifier(columnName)}" = ?, "_updatedAt" = ? WHERE rowid = ?;`,
        [value, currentTimestamp(), rowId],
      )
      return
    }

    this.execute(
      `UPDATE "${escapeIdentifier(tableName)}" SET "${escapeIdentifier(columnName)}" = ? WHERE rowid = ?;`,
      [value, rowId],
    )
  }

  insertRow(tableName: string): void {
    const row = this.createInsertableRow(tableName)
    const entries = Object.entries(row)

    if (entries.length === 0) {
      this.execute(`INSERT INTO "${escapeIdentifier(tableName)}" DEFAULT VALUES;`)
      return
    }

    const columnNames = entries.map(([columnName]) => `"${escapeIdentifier(columnName)}"`)
    const placeholders = entries.map(() => '?')
    const values = entries.map(([, value]) => value)

    this.execute(
      `INSERT INTO "${escapeIdentifier(tableName)}" (${columnNames.join(', ')}) VALUES (${placeholders.join(', ')});`,
      values,
    )
  }

  private createPrimaryKeyValue(
    tableName: string,
    column: SqliteTableColumn,
  ): SqlValue {
    const normalizedType = column.type.toUpperCase()

    if (normalizedType.includes('INT')) {
      return this.getNextPrimaryKeyValue(tableName, column.name)
    }

    return create128BitId()
  }

  private getNextPrimaryKeyValue(tableName: string, columnName: string): number {
    const result = this.query<{ next_id: number | null }>(
      `SELECT COALESCE(MAX("${escapeIdentifier(columnName)}"), 0) + 1 AS next_id FROM "${escapeIdentifier(tableName)}";`,
    )

    return result[0]?.next_id ?? 1
  }

  close(): void {
    if (this.#db.isOpen()) {
      this.#db.close()
    }
  }
}

function escapeIdentifier(identifier: string): string {
  return identifier.replaceAll('"', '""')
}

function createDefaultValueForColumn(column: SqliteTableColumn): SqlValue {
  const normalizedName = column.name.toLowerCase()
  const normalizedType = column.type.toUpperCase()

  if (normalizedName === '_archivedat') {
    return null
  }

  if (normalizedName === '_createdat' || normalizedName === '_updatedat') {
    return currentTimestamp()
  }

  if (normalizedName.endsWith('_at')) {
    return new Date().toISOString()
  }

  if (normalizedType.includes('INT')) {
    return 0
  }

  if (normalizedType.includes('REAL') || normalizedType.includes('FLOA')) {
    return 0
  }

  if (column.notnull) {
    return ''
  }

  return null
}

function coerceInputValue(column: SqliteTableColumn, rawValue: string): SqlValue {
  const normalizedType = column.type.toUpperCase()

  if (rawValue.length === 0 && !column.notnull) {
    return null
  }

  if (normalizedType.includes('INT')) {
    if (
      column.name === '_createdAt' ||
      column.name === '_updatedAt' ||
      column.name === '_archivedAt'
    ) {
      try {
        return BigInt(rawValue)
      } catch {
        throw new Error(`Expected an integer timestamp for "${column.name}".`)
      }
    }

    const parsed = Number(rawValue)

    if (!Number.isFinite(parsed)) {
      throw new Error(`Expected a numeric value for "${column.name}".`)
    }

    return Math.trunc(parsed)
  }

  if (normalizedType.includes('REAL') || normalizedType.includes('FLOA')) {
    const parsed = Number(rawValue)

    if (!Number.isFinite(parsed)) {
      throw new Error(`Expected a numeric value for "${column.name}".`)
    }

    return parsed
  }

  return rawValue
}

function create128BitId(): string {
  const cryptoApi = globalThis.crypto

  if (cryptoApi?.getRandomValues) {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16))
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  }

  throw new Error('crypto.getRandomValues() is not available in this environment.')
}

function currentTimestamp(): bigint {
  return BigInt(Date.now())
}

const IDB_STORE_NAME = 'sqlite-data'

interface IDBLike {
  open(name: string, version?: number): IDBRequestLike
}

interface IDBRequestLike {
  result: IDBDatabaseLike
  error: Error | null
  onerror: (() => void) | null
  onsuccess: (() => void) | null
  onupgradeneeded: (() => void) | null
}

interface IDBDatabaseLike {
  objectStoreNames: { contains(name: string): boolean }
  createObjectStore(name: string): unknown
  transaction(name: string, mode: string): IDBTransactionLike
  close(): void
}

interface IDBTransactionLike {
  objectStore(name: string): IDBStoreLike
}

interface IDBStoreLike {
  get(key: string): IDBRequestLike & { result: unknown }
  put(value: unknown, key: string): IDBRequestLike
}

function getIndexedDB(): IDBLike {
  const g = globalThis as Record<string, unknown>
  const idb = g.indexedDB as IDBLike | undefined

  if (!idb) {
    throw new Error('IndexedDB is not available in this environment.')
  }

  return idb
}

function openIdb(idbName: string): Promise<IDBDatabaseLike> {
  return new Promise((resolve, reject) => {
    const idb = getIndexedDB()
    const request = idb.open(idbName, 1)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
        db.createObjectStore(IDB_STORE_NAME)
      }
    }
  })
}

async function idbLoad(idbName: string): Promise<Uint8Array | null> {
  const db = await openIdb(idbName)

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(IDB_STORE_NAME, 'readonly')
    const store = transaction.objectStore(IDB_STORE_NAME)
    const request = store.get('database')

    request.onerror = () => {
      db.close()
      reject(request.error)
    }

    request.onsuccess = () => {
      db.close()
      const result = request.result
      resolve(result instanceof Uint8Array ? result : null)
    }
  })
}

async function idbSave(idbName: string, data: Uint8Array): Promise<void> {
  const db = await openIdb(idbName)

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(IDB_STORE_NAME, 'readwrite')
    const store = transaction.objectStore(IDB_STORE_NAME)
    const request = store.put(data, 'database')

    request.onerror = () => {
      db.close()
      reject(request.error)
    }

    request.onsuccess = () => {
      db.close()
      resolve()
    }
  })
}

