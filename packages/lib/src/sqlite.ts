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
      if (isGeneratedPrimaryKey(column)) {
        row[column.name] = this.getNextPrimaryKeyValue(tableName, column.name)
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
    const column = this.getTableColumns(tableName).find(
      (candidate) => candidate.name === columnName,
    )

    if (!column) {
      throw new Error(`Column "${columnName}" not found in table "${tableName}".`)
    }

    const value = coerceInputValue(column, rawValue)

    this.execute(
      `UPDATE "${escapeIdentifier(tableName)}" SET "${escapeIdentifier(columnName)}" = ? WHERE rowid = ?;`,
      [value, rowId],
    )
  }

  insertRow(tableName: string): void {
    const columns = this.getTableColumns(tableName)
    const insertableColumns = columns.filter((column) => !isGeneratedPrimaryKey(column))

    if (insertableColumns.length === 0) {
      this.execute(`INSERT INTO "${escapeIdentifier(tableName)}" DEFAULT VALUES;`)
      return
    }

    const columnNames = insertableColumns.map(
      (column) => `"${escapeIdentifier(column.name)}"`,
    )
    const placeholders = insertableColumns.map(() => '?')
    const values = insertableColumns.map(createDefaultValueForColumn)

    this.execute(
      `INSERT INTO "${escapeIdentifier(tableName)}" (${columnNames.join(', ')}) VALUES (${placeholders.join(', ')});`,
      values,
    )
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

function isGeneratedPrimaryKey(column: SqliteTableColumn): boolean {
  return column.pk === 1 && column.type.toUpperCase() === 'INTEGER'
}

function createDefaultValueForColumn(column: SqliteTableColumn): SqlValue {
  const normalizedName = column.name.toLowerCase()
  const normalizedType = column.type.toUpperCase()

  if (normalizedName.endsWith('_at')) {
    return new Date().toISOString()
  }

  if (normalizedName.endsWith('_id')) {
    return 1
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

