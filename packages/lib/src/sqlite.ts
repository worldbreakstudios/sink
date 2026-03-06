import type {
  BindingSpec,
  Database,
  SqlValue,
  Sqlite3Static,
} from '@sqlite.org/sqlite-wasm'

export type SqliteRow = Record<string, SqlValue>

export interface SqliteDemoResult {
  version: string
  rowCount: number
  rows: SqliteRow[]
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

  query<TRow extends SqliteRow = SqliteRow>(
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

  close(): void {
    if (this.#db.isOpen()) {
      this.#db.close()
    }
  }
}

export async function runSqliteDemo(label: string): Promise<SqliteDemoResult> {
  const db = await FrontendSqliteDatabase.createInMemory()

  try {
    db.execute(`
      CREATE TABLE records (
        id INTEGER PRIMARY KEY,
        label TEXT NOT NULL,
        slug TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `)

    const normalizedLabel = label.trim().replace(/\s+/g, ' ')
    const slug = normalizedLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-')

    db.execute(
      `
        INSERT INTO records (label, slug, created_at)
        VALUES (?, ?, ?);
      `,
      [normalizedLabel, slug.replace(/^-|-$/g, ''), new Date().toISOString()],
    )

    const rows = db.query(
      `
        SELECT id, label, slug, created_at
        FROM records
        ORDER BY id ASC;
      `,
    )

    return {
      version: db.version,
      rowCount: rows.length,
      rows,
    }
  } finally {
    db.close()
  }
}
