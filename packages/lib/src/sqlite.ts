import type {
  BindingSpec,
  Database,
  SqlValue,
  Sqlite3Static,
} from '@sqlite.org/sqlite-wasm'
import {
  createBrowserSqlitePromiser,
  loadBrowserSqlite,
  type BrowserSqliteRuntimeOptions,
} from './browser-sqlite-runtime.js'

type StructuredColumnKind = 'array' | 'object' | 'record'

export type SqliteRow = Record<string, unknown>
export type SqliteCompositeKey = Record<string, SqlValue>
export type SqliteKey = SqlValue | SqliteCompositeKey

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

function getStructuredColumnKind(columnType: string): StructuredColumnKind | null {
  const normalizedType = columnType.toUpperCase()

  if (normalizedType.includes('JSON_ARRAY')) {
    return 'array'
  }

  if (normalizedType.includes('JSON_OBJECT')) {
    return 'object'
  }

  if (normalizedType.includes('JSON_RECORD')) {
    return 'record'
  }

  return null
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  )
}

function buildKeyWhereClause(
  key: SqliteKey,
  keyColumns: readonly string[],
): { whereClause: string; bind: SqlValue[] } {
  if (keyColumns.length === 0) {
    throw new Error('At least one key column is required.')
  }

  if (keyColumns.length === 1 && !isPlainObject(key)) {
    const keyColumn = keyColumns[0]

    if (!keyColumn) {
      throw new Error('Missing key column.')
    }

    return {
      whereClause: `"${escapeIdentifier(keyColumn)}" = ?`,
      bind: [key],
    }
  }

  if (!isPlainObject(key)) {
    throw new Error(
      `Expected an object key with columns ${keyColumns.join(', ')}.`,
    )
  }

  return {
    whereClause: keyColumns
      .map((columnName) => `"${escapeIdentifier(columnName)}" = ?`)
      .join(' AND '),
    bind: keyColumns.map((columnName) => {
      const value = key[columnName]

      if (value === undefined) {
        throw new Error(`Missing key column "${columnName}".`)
      }

      return value as SqlValue
    }),
  }
}

function assertStructuredValue(
  kind: StructuredColumnKind,
  value: unknown,
  columnName: string,
): void {
  if (kind === 'array') {
    if (Array.isArray(value)) {
      return
    }

    throw new Error(`Expected "${columnName}" to be a JSON array.`)
  }

  if (isPlainObject(value)) {
    return
  }

  throw new Error(`Expected "${columnName}" to be a JSON object.`)
}

function parseStructuredInput(
  kind: StructuredColumnKind,
  rawValue: string,
  columnName: string,
): string {
  let parsed: unknown

  try {
    parsed = JSON.parse(rawValue)
  } catch {
    throw new Error(`Expected valid JSON for "${columnName}".`)
  }

  assertStructuredValue(kind, parsed, columnName)
  return JSON.stringify(parsed)
}

function decodeStructuredValue(
  kind: StructuredColumnKind,
  value: unknown,
): unknown {
  if (typeof value !== 'string') {
    return value
  }

  try {
    const parsed = JSON.parse(value)
    assertStructuredValue(kind, parsed, 'value')
    return parsed
  } catch {
    return value
  }
}

function decodeRowValues(
  row: Record<string, unknown>,
  columns: SqliteTableColumn[],
): Record<string, unknown> {
  const columnsByName = new Map(columns.map((column) => [column.name, column]))

  return Object.fromEntries(
    Object.entries(row).map(([columnName, value]) => {
      const column = columnsByName.get(columnName)
      const kind = column ? getStructuredColumnKind(column.type) : null

      if (kind === null) {
        return [columnName, value]
      }

      return [columnName, decodeStructuredValue(kind, value)]
    }),
  )
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

  static async createInMemory(
    filename = ':memory:',
    options?: { sqliteRuntime?: BrowserSqliteRuntimeOptions },
  ) {
    const sqlite = await loadBrowserSqlite(options?.sqliteRuntime)
    const db = new sqlite.oo1.DB(filename, 'ct')

    return new FrontendSqliteDatabase(sqlite, db)
  }

  /**
   * Creates a database persisted to localStorage via JsStorageDb.
   * Limited to ~5MB due to localStorage constraints.
   * Works on main thread without special headers.
   * Note: Only ONE localStorage database is supported per origin.
   */
  static async createWithLocalStorage(
    storage: 'local' | 'session' = 'local',
    options?: { sqliteRuntime?: BrowserSqliteRuntimeOptions },
  ) {
    const sqlite = await loadBrowserSqlite(options?.sqliteRuntime)
    const JsStorageDb = (sqlite.oo1 as Record<string, unknown>)
      .JsStorageDb as new (storage: 'local' | 'session') => Database

    if (!JsStorageDb) {
      throw new Error('JsStorageDb is not available in this sqlite-wasm build.')
    }

    const db = new JsStorageDb(storage)
    return new FrontendSqliteDatabase(sqlite, db)
  }

  get version(): string {
    return this.#sqlite.version.libVersion
  }

  execute(sql: string, bind?: BindingSpec | SqlValue[]): void {
    this.#db.exec({ sql, bind })
  }

  query<TRow extends object = SqliteRow>(
    sql: string,
    bind?: BindingSpec | SqlValue[],
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

    return tables.map(({ name, sql }) => {
      const columns = this.query<SqliteTableColumn>(
        `PRAGMA table_info("${escapeIdentifier(name)}");`,
      )
      const rows = this.query<Record<string, SqlValue>>(
        `SELECT rowid AS __rowid__, * FROM "${escapeIdentifier(name)}" ORDER BY rowid ASC LIMIT ${limit};`,
      ).map((row) => {
        const { __rowid__, ...values } = row

        return {
          rowId: Number(__rowid__),
          values: decodeRowValues(values, columns),
        }
      })

      return {
        name,
        schema: sql,
        columns,
        rows,
      }
    })
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

  rowExists(
    tableName: string,
    key: SqliteKey,
    keyColumns: readonly string[] = ['_id'],
  ): boolean {
    const predicate = buildKeyWhereClause(key, keyColumns)
    const result = this.query<{ matches: number }>(
      `SELECT COUNT(*) AS matches FROM "${escapeIdentifier(tableName)}" WHERE ${predicate.whereClause};`,
      predicate.bind,
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
      if (column.name === '_id') {
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
    const values = entries.map(([, value]) => value) as SqlValue[]

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
  const structuredKind = getStructuredColumnKind(column.type)

  if (normalizedName === '_archivedat') {
    return null
  }

  if (normalizedName === '_createdat' || normalizedName === '_updatedat') {
    return currentTimestamp()
  }

  if (normalizedName.endsWith('_at')) {
    return new Date().toISOString()
  }

  if (structuredKind !== null && !column.notnull) {
    return null
  }

  if (structuredKind === 'array') {
    return '[]'
  }

  if (structuredKind === 'object' || structuredKind === 'record') {
    return '{}'
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
  const structuredKind = getStructuredColumnKind(column.type)

  if (rawValue.length === 0 && !column.notnull) {
    return null
  }

  if (structuredKind !== null) {
    return parseStructuredInput(structuredKind, rawValue, column.name)
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

// Types for the sqlite3Worker1Promiser API
type PromiserMethod = 'open' | 'close' | 'exec' | 'config-get'
type PromiserResponse<T = unknown> = { result: T }

interface Promiser {
  (method: 'config-get', args: object): Promise<PromiserResponse<{ version: { libVersion: string } }>>
  (method: 'open', args: { filename: string }): Promise<PromiserResponse<{ filename: string }> & { dbId: string }>
  (method: 'close', args: { dbId: string }): Promise<PromiserResponse<void>>
  (method: 'exec', args: {
    dbId: string
    sql: string
    bind?: SqlValue[]
    returnValue?: 'resultRows'
    rowMode?: 'object'
  }): Promise<PromiserResponse<{ resultRows?: SqliteRow[] }>>
  (method: PromiserMethod, args: object): Promise<PromiserResponse>
}

/**
 * SQLite database using OPFS persistence via Web Worker.
 * This runs SQLite in a worker thread to support OPFS VFS.
 * All methods are async since they communicate with the worker.
 */
export class OpfsDatabase {
  readonly #promiser: Promiser
  readonly #dbId: string
  #version: string

  private constructor(promiser: Promiser, dbId: string, version: string) {
    this.#promiser = promiser
    this.#dbId = dbId
    this.#version = version
  }

  /**
   * Creates a database persisted to OPFS via a Web Worker.
   * Requires cross-origin isolation headers (COOP/COEP).
   */
  static async create(
    filename: string,
    options?: { sqliteRuntime?: BrowserSqliteRuntimeOptions },
  ): Promise<OpfsDatabase> {
    if (!isOpfsSupported()) {
      throw new Error(
        'OPFS is not supported in this environment. Ensure COOP/COEP headers are set.',
      )
    }

    const promiser = await createBrowserSqlitePromiser<Promiser>(
      options?.sqliteRuntime,
    )

    const configResponse = await promiser('config-get', {})
    const version = configResponse.result.version.libVersion

    const openResponse = await promiser('open', {
      filename: `file:${filename}?vfs=opfs`,
    })

    return new OpfsDatabase(promiser, openResponse.dbId, version)
  }

  get version(): string {
    return this.#version
  }

  async execute(sql: string, bind?: SqlValue[]): Promise<void> {
    await this.#promiser('exec', {
      dbId: this.#dbId,
      sql,
      bind,
    })
  }

  async query<TRow extends object = SqliteRow>(
    sql: string,
    bind?: SqlValue[],
  ): Promise<TRow[]> {
    const response = await this.#promiser('exec', {
      dbId: this.#dbId,
      sql,
      bind,
      returnValue: 'resultRows',
      rowMode: 'object',
    })

    return (response.result.resultRows ?? []) as TRow[]
  }

  async createExplorerSnapshot(limit = 100): Promise<SqliteExplorerSnapshot> {
    return {
      version: this.version,
      tables: await this.inspectTables(limit),
    }
  }

  async inspectTables(limit = 100): Promise<SqliteTableSnapshot[]> {
    const tables = await this.query<{ name: string; sql: string }>(
      `SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC;`,
    )

    const results: SqliteTableSnapshot[] = []

    for (const { name, sql } of tables) {
      const columns = await this.query<SqliteTableColumn>(
        `PRAGMA table_info("${escapeIdentifier(name)}");`,
      )

      const rawRows = await this.query<Record<string, SqlValue>>(
        `SELECT rowid AS __rowid__, * FROM "${escapeIdentifier(name)}" ORDER BY rowid ASC LIMIT ${limit};`,
      )

      results.push({
        name,
        schema: sql,
        columns,
        rows: rawRows.map((row) => {
          const { __rowid__, ...values } = row
          return {
            rowId: Number(__rowid__),
            values: decodeRowValues(values, columns),
          }
        }),
      })
    }

    return results
  }

  async getTableColumns(tableName: string): Promise<SqliteTableColumn[]> {
    return this.query<SqliteTableColumn>(
      `PRAGMA table_info("${escapeIdentifier(tableName)}");`,
    )
  }

  async getTableIndexes(tableName: string): Promise<SqliteIndexSnapshot[]> {
    const indexes = await this.query<{
      name: string
      unique: number
      origin: string
      partial: number
    }>(`PRAGMA index_list("${escapeIdentifier(tableName)}");`)

    const results: SqliteIndexSnapshot[] = []

    for (const index of indexes) {
      const fields = await this.query<{ name: string | null }>(
        `PRAGMA index_info("${escapeIdentifier(index.name)}");`,
      )

      results.push({
        ...index,
        tableName,
        fields: fields.map((f) => f.name).filter((n): n is string => n !== null),
      })
    }

    return results
  }

  async coerceTableValue(
    tableName: string,
    columnName: string,
    rawValue: string,
  ): Promise<SqlValue> {
    const columns = await this.getTableColumns(tableName)
    const column = columns.find((c) => c.name === columnName)

    if (!column) {
      throw new Error(`Column "${columnName}" not found in table "${tableName}".`)
    }

    return coerceInputValue(column, rawValue)
  }

  async createInsertableRow(tableName: string): Promise<SqliteRow> {
    const columns = await this.getTableColumns(tableName)
    const row: SqliteRow = {}

    for (const column of columns) {
      if (column.name === '_id') {
        row[column.name] = await this.createPrimaryKeyValue(tableName, column)
        continue
      }
      row[column.name] = createDefaultValueForColumn(column)
    }

    return row
  }

  private async createPrimaryKeyValue(
    tableName: string,
    column: SqliteTableColumn,
  ): Promise<SqlValue> {
    const normalizedType = column.type.toUpperCase()

    if (normalizedType.includes('INT')) {
      return this.getNextPrimaryKeyValue(tableName, column.name)
    }

    return create128BitId()
  }

  private async getNextPrimaryKeyValue(
    tableName: string,
    columnName: string,
  ): Promise<number> {
    const result = await this.query<{ next_id: number | null }>(
      `SELECT COALESCE(MAX("${escapeIdentifier(columnName)}"), 0) + 1 AS next_id FROM "${escapeIdentifier(tableName)}";`,
    )

    return result[0]?.next_id ?? 1
  }

  async close(): Promise<void> {
    await this.#promiser('close', { dbId: this.#dbId })
  }

  async rowExists(
    tableName: string,
    key: SqliteKey,
    keyColumns: readonly string[] = ['_id'],
  ): Promise<boolean> {
    const predicate = buildKeyWhereClause(key, keyColumns)
    const result = await this.query<{ matches: number }>(
      `SELECT COUNT(*) AS matches FROM "${escapeIdentifier(tableName)}" WHERE ${predicate.whereClause};`,
      predicate.bind,
    )

    return (result[0]?.matches ?? 0) > 0
  }
}

/**
 * Unified async interface for SQLite databases.
 * Both OpfsDatabase and SyncDatabaseAdapter implement this interface.
 */
export interface AsyncSqliteDatabase {
  readonly version: string
  execute(sql: string, bind?: BindingSpec | SqlValue[]): Promise<void>
  query<TRow extends object = SqliteRow>(sql: string, bind?: BindingSpec | SqlValue[]): Promise<TRow[]>
  getTableColumns(tableName: string): Promise<SqliteTableColumn[]>
  getTableIndexes(tableName: string): Promise<SqliteIndexSnapshot[]>
  rowExists(tableName: string, key: SqliteKey, keyColumns?: readonly string[]): Promise<boolean>
  coerceTableValue(tableName: string, columnName: string, rawValue: string): Promise<SqlValue>
  createInsertableRow(tableName: string): Promise<SqliteRow>
  inspectTables(limit?: number): Promise<SqliteTableSnapshot[]>
  close(): Promise<void>
}

/**
 * Adapter that wraps FrontendSqliteDatabase to implement AsyncSqliteDatabase.
 * Wraps sync calls in resolved promises for interface compatibility.
 */
export class SyncDatabaseAdapter implements AsyncSqliteDatabase {
  readonly #db: FrontendSqliteDatabase

  constructor(db: FrontendSqliteDatabase) {
    this.#db = db
  }

  get version(): string {
    return this.#db.version
  }

  async execute(sql: string, bind?: BindingSpec | SqlValue[]): Promise<void> {
    this.#db.execute(sql, bind)
  }

  async query<TRow extends object = SqliteRow>(
    sql: string,
    bind?: BindingSpec | SqlValue[],
  ): Promise<TRow[]> {
    return this.#db.query<TRow>(sql, bind)
  }

  async getTableColumns(tableName: string): Promise<SqliteTableColumn[]> {
    return this.#db.getTableColumns(tableName)
  }

  async getTableIndexes(tableName: string): Promise<SqliteIndexSnapshot[]> {
    return this.#db.getTableIndexes(tableName)
  }

  async rowExists(
    tableName: string,
    key: SqliteKey,
    keyColumns: readonly string[] = ['_id'],
  ): Promise<boolean> {
    return this.#db.rowExists(tableName, key, keyColumns)
  }

  async coerceTableValue(tableName: string, columnName: string, rawValue: string): Promise<SqlValue> {
    return this.#db.coerceTableValue(tableName, columnName, rawValue)
  }

  async createInsertableRow(tableName: string): Promise<SqliteRow> {
    return this.#db.createInsertableRow(tableName)
  }

  async inspectTables(limit = 100): Promise<SqliteTableSnapshot[]> {
    return this.#db.inspectTables(limit)
  }

  async close(): Promise<void> {
    this.#db.close()
  }
}

export type PersistenceType = 'opfs' | 'localStorage' | 'memory'

export interface DatabaseCreationResult {
  database: AsyncSqliteDatabase
  persistenceType: PersistenceType
}

export interface CreateDatabaseOptions {
  preferredPersistence?: PersistenceType
  opfsFilename?: string
  localStorageType?: 'local' | 'session'
  sqliteRuntime?: BrowserSqliteRuntimeOptions
}

/**
 * Creates an AsyncSqliteDatabase with automatic fallback.
 * Tries OPFS first (if supported), then localStorage, then memory.
 */
export async function createDatabase(options?: CreateDatabaseOptions): Promise<DatabaseCreationResult> {
  const {
    preferredPersistence = 'opfs',
    opfsFilename = 'app.db',
    localStorageType = 'local',
    sqliteRuntime,
  } = options ?? {}

  // Try OPFS first if preferred and supported
  if (preferredPersistence === 'opfs' && isOpfsSupported()) {
    try {
      const opfsDb = await OpfsDatabase.create(opfsFilename, {
        sqliteRuntime,
      })
      return { database: opfsDb, persistenceType: 'opfs' }
    } catch (error) {
      console.warn('OPFS database creation failed, falling back to localStorage:', error)
    }
  }

  // Try localStorage
  if (preferredPersistence !== 'memory') {
    try {
      const localDb = await FrontendSqliteDatabase.createWithLocalStorage(
        localStorageType,
        { sqliteRuntime },
      )
      return {
        database: new SyncDatabaseAdapter(localDb),
        persistenceType: 'localStorage',
      }
    } catch (error) {
      console.warn('localStorage database creation failed, falling back to memory:', error)
    }
  }

  // Final fallback to in-memory
  const memoryDb = await FrontendSqliteDatabase.createInMemory(':memory:', {
    sqliteRuntime,
  })
  return {
    database: new SyncDatabaseAdapter(memoryDb),
    persistenceType: 'memory',
  }
}
