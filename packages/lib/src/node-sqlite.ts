import { createRequire } from 'node:module'
import type { BindingSpec, SqlValue } from '@sqlite.org/sqlite-wasm'
import type {
  AsyncSqliteDatabase,
  SqliteIndexSnapshot,
  SqliteKey,
  SqliteRow,
  SqliteTableColumn,
  SqliteTableSnapshot,
} from './sqlite'

type StructuredColumnKind = 'array' | 'object' | 'record'
const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (filename: string) => DatabaseSyncLike
}

export class ServerSqliteDatabase implements AsyncSqliteDatabase {
  readonly #db: DatabaseSyncLike
  readonly #version: string

  constructor(filename: string) {
    this.#db = new DatabaseSync(filename)
    const versionRow = this.querySync<{ version: string }>(
      'SELECT sqlite_version() AS version;',
    )[0]
    this.#version = versionRow?.version ?? 'unknown'
  }

  get version(): string {
    return this.#version
  }

  async execute(sql: string, bind?: BindingSpec | SqlValue[]): Promise<void> {
    if (bind === undefined) {
      this.#db.exec(sql)
      return
    }

    const statement = this.#db.prepare(sql)

    if (Array.isArray(bind)) {
      statement.run(...(bind as any[]))
      return
    }

    statement.run(bind as any)
  }

  async query<TRow extends object = SqliteRow>(
    sql: string,
    bind?: BindingSpec | SqlValue[],
  ): Promise<TRow[]> {
    return this.querySync<TRow>(sql, bind)
  }

  async getTableColumns(tableName: string): Promise<SqliteTableColumn[]> {
    return this.querySync<SqliteTableColumn>(
      `PRAGMA table_info("${escapeIdentifier(tableName)}");`,
    )
  }

  async getTableIndexes(tableName: string): Promise<SqliteIndexSnapshot[]> {
    const indexes = this.querySync<{
      name: string
      unique: number
      origin: string
      partial: number
    }>(`PRAGMA index_list("${escapeIdentifier(tableName)}");`)

    return indexes.map((index) => ({
      ...index,
      tableName,
      fields: this.querySync<{ name: string | null }>(
        `PRAGMA index_info("${escapeIdentifier(index.name)}");`,
      )
        .map((field) => field.name)
        .filter((field): field is string => field !== null),
    }))
  }

  async rowExists(
    tableName: string,
    key: SqliteKey,
    keyColumns: readonly string[] = ['_id'],
  ): Promise<boolean> {
    const predicate = buildKeyWhereClause(key, keyColumns)
    const result = this.querySync<{ matches: number }>(
      `SELECT COUNT(*) AS matches FROM "${escapeIdentifier(tableName)}" WHERE ${predicate.whereClause};`,
      predicate.bind,
    )

    return (result[0]?.matches ?? 0) > 0
  }

  async coerceTableValue(
    tableName: string,
    columnName: string,
    rawValue: string,
  ): Promise<SqlValue> {
    const columns = await this.getTableColumns(tableName)
    const column = columns.find((candidate) => candidate.name === columnName)

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

  async inspectTables(limit = 100): Promise<SqliteTableSnapshot[]> {
    const tables = this.querySync<{ name: string; sql: string }>(
      `SELECT name, sql
       FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name ASC;`,
    )

    return tables.map(({ name, sql }) => {
      const columns = this.querySync<SqliteTableColumn>(
        `PRAGMA table_info("${escapeIdentifier(name)}");`,
      )
      const rows = this.querySync<Record<string, SqlValue>>(
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

  async close(): Promise<void> {
    this.#db.close()
  }

  private querySync<TRow extends object = SqliteRow>(
    sql: string,
    bind?: BindingSpec | SqlValue[],
  ): TRow[] {
    const statement = this.#db.prepare(sql)

    if (bind === undefined) {
      return statement.all() as TRow[]
    }

    if (Array.isArray(bind)) {
      return statement.all(...(bind as any[])) as TRow[]
    }

    return statement.all(bind as any) as TRow[]
  }

  private async createPrimaryKeyValue(
    tableName: string,
    column: SqliteTableColumn,
  ): Promise<SqlValue> {
    const normalizedType = column.type.toUpperCase()

    if (normalizedType.includes('INT')) {
      const result = this.querySync<{ next_id: number | null }>(
        `SELECT COALESCE(MAX("${escapeIdentifier(column.name)}"), 0) + 1 AS next_id FROM "${escapeIdentifier(tableName)}";`,
      )
      return result[0]?.next_id ?? 1
    }

    return create128BitId()
  }
}

interface DatabaseSyncLike {
  exec(sql: string): void
  prepare(sql: string): StatementLike
  close(): void
}

interface StatementLike {
  run(...args: any[]): unknown
  all(...args: any[]): Array<Record<string, unknown>>
}

function buildKeyWhereClause(
  key: SqliteKey,
  keyColumns: readonly string[],
): { whereClause: string; bind: SqlValue[] } {
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

function escapeIdentifier(identifier: string): string {
  return identifier.replaceAll('"', '""')
}

function create128BitId(): string {
  const cryptoApi = globalThis.crypto

  if (!cryptoApi?.getRandomValues) {
    throw new Error('crypto.getRandomValues() is not available in this environment.')
  }

  const bytes = cryptoApi.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function currentTimestamp(): bigint {
  return BigInt(Date.now())
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
