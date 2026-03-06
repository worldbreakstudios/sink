import type {
  BindingSpec,
  Database,
  SqlValue,
  Sqlite3Static,
} from '@sqlite.org/sqlite-wasm'

export type SqliteRow = Record<string, SqlValue>

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
  rows: SqliteRow[]
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
      rows: this.query(
        `SELECT * FROM "${escapeIdentifier(name)}" ORDER BY rowid ASC LIMIT ${limit};`,
      ),
    }))
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

function normalizeLabel(label: string): string {
  const trimmed = label.trim().replace(/\s+/g, ' ')

  return trimmed.length === 0 ? 'Untitled record' : trimmed
}

export async function runSqliteDemo(
  label = 'Offline-first note store',
): Promise<SqliteExplorerSnapshot> {
  const db = await FrontendSqliteDatabase.createInMemory()

  try {
    const normalizedLabel = normalizeLabel(label)

    db.execute(`
      CREATE TABLE notebooks (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE notes (
        id INTEGER PRIMARY KEY,
        notebook_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `)

    db.execute(
      `
        INSERT INTO notebooks (name, description, created_at)
        VALUES
          (?, ?, ?),
          (?, ?, ?);
      `,
      [
        'Inbox',
        'Quick capture workspace',
        '2026-03-06T18:00:00.000Z',
        normalizedLabel,
        'Demo notebook seeded by the sandbox',
        '2026-03-06T18:05:00.000Z',
      ],
    )

    db.execute(
      `
        INSERT INTO notes (notebook_id, title, body, status, created_at)
        VALUES
          (1, 'Capture SQLite wrapper ideas', 'Start with schema inspection and query helpers.', 'open', '2026-03-06T18:10:00.000Z'),
          (1, 'Support migrations', 'Track schema changes in one place.', 'draft', '2026-03-06T18:12:00.000Z'),
          (2, 'Prototype table browser', 'Render schemas and row data in the sandbox.', 'open', '2026-03-06T18:15:00.000Z');
      `,
    )

    return {
      version: db.version,
      tables: db.inspectTables(),
    }
  } finally {
    db.close()
  }
}
