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

