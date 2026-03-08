import type { TransactionConfig } from '@tanstack/db'
import { FrontendSqliteDatabase } from '@sink/lib'
import {
  createAllTables,
  createBatchTransaction,
  createCollections,
} from '@/data/generated/schema.gen'
import type {
  AnyRow,
  Id,
  SchemaCollections,
  TableName,
} from '@/data/generated/schema.gen'

export type SqliteDemoRow = AnyRow
export type SqliteDemoId = Id<TableName>
export type SqliteDemoTableName = TableName
export type SqliteInsertDraft = Record<string, string>

export interface SqliteDemoCollectionsWorkspace {
  database: FrontendSqliteDatabase
  collections: SchemaCollections
  inspectTables: FrontendSqliteDatabase['inspectTables']
  createBatchTransaction: (
    config?: Omit<TransactionConfig<AnyRow>, 'mutationFn'>,
  ) => ReturnType<typeof createBatchTransaction>
  createInsertDraft: (tableName: SqliteDemoTableName) => SqliteInsertDraft
  queueInsert: (
    tableName: SqliteDemoTableName,
    draft: SqliteInsertDraft,
    transaction: ReturnType<typeof createBatchTransaction>,
  ) => void
  updateCell: (
    tableName: SqliteDemoTableName,
    key: SqliteDemoId,
    columnName: string,
    value: string,
  ) => Promise<void>
  insertRow: (tableName: SqliteDemoTableName) => Promise<void>
  close: () => void
}

interface MutableSqliteDemoCollection {
  insert: (row: AnyRow) => void
  update: (key: SqliteDemoId, callback: (draft: Record<string, unknown>) => void) => void
}

function getCollection(
  collections: SchemaCollections,
  tableName: SqliteDemoTableName,
): MutableSqliteDemoCollection {
  return collections[tableName] as unknown as MutableSqliteDemoCollection
}

async function createSqliteDemoDatabase(): Promise<FrontendSqliteDatabase> {
  const db = await FrontendSqliteDatabase.createInMemory()
  const inboxId = '11111111-1111-4111-8111-111111111111'
  const workspaceId = '22222222-2222-4222-8222-222222222222'
  const noteOneId = '33333333-3333-4333-8333-333333333333'
  const noteTwoId = '44444444-4444-4444-8444-444444444444'
  const noteThreeId = '55555555-5555-4555-8555-555555555555'

  createAllTables(db)

  db.execute(
    `
      INSERT INTO notebooks (_id, name, description, created_at)
      VALUES
        (?, ?, ?, ?),
        (?, ?, ?, ?);
    `,
    [
      inboxId,
      'Inbox',
      'Quick capture workspace',
      '2026-03-06T18:00:00.000Z',
      workspaceId,
      'Offline-first note store',
      'Demo notebook seeded by the sandbox',
      '2026-03-06T18:05:00.000Z',
    ],
  )

  db.execute(
    `
      INSERT INTO notes (_id, notebook_id, title, body, status, created_at)
      VALUES
        (?, ?, ?, ?, ?, ?),
        (?, ?, ?, ?, ?, ?),
        (?, ?, ?, ?, ?, ?);
    `,
    [
      noteOneId,
      inboxId,
      'Capture SQLite wrapper ideas',
      'Start with schema inspection and query helpers.',
      'open',
      '2026-03-06T18:10:00.000Z',
      noteTwoId,
      inboxId,
      'Support migrations',
      'Track schema changes in one place.',
      'draft',
      '2026-03-06T18:12:00.000Z',
      noteThreeId,
      workspaceId,
      'Prototype table browser',
      'Render schemas and row data in the sandbox.',
      'open',
      '2026-03-06T18:15:00.000Z',
    ],
  )

  return db
}

export async function createSqliteDemoCollectionsWorkspace(): Promise<SqliteDemoCollectionsWorkspace> {
  const database = await createSqliteDemoDatabase()

  const collections = createCollections(database)

  const makeBatchTx = (
    config?: Omit<TransactionConfig<AnyRow>, 'mutationFn'>,
  ) => createBatchTransaction(collections, config)

  return {
    database,
    collections,
    inspectTables: database.inspectTables.bind(database),
    createBatchTransaction: makeBatchTx,
    createInsertDraft(tableName) {
      const row = database.createInsertableRow(tableName)

      return Object.fromEntries(
        Object.entries(row).map(([key, value]) => [key, value === null ? '' : String(value)]),
      )
    },
    queueInsert(tableName, draft, transaction) {
      const row = Object.fromEntries(
        Object.entries(draft).map(([columnName, value]) => [
          columnName,
          database.coerceTableValue(tableName, columnName, value),
        ]),
      ) as unknown as AnyRow

      transaction.mutate(() => {
        getCollection(collections, tableName).insert(row)
      })
    },
    async updateCell(tableName, key, columnName, value) {
      const typedValue = database.coerceTableValue(tableName, columnName, value)
      const transaction = makeBatchTx()

      transaction.mutate(() => {
        getCollection(collections, tableName).update(key, (draft) => {
          draft[columnName] = typedValue
        })
      })

      await transaction.isPersisted.promise
    },
    async insertRow(tableName) {
      const transaction = makeBatchTx()
      const newRow = database.createInsertableRow(tableName) as unknown as AnyRow

      transaction.mutate(() => {
        getCollection(collections, tableName).insert(newRow)
      })

      await transaction.isPersisted.promise
    },
    close() {
      database.close()
    },
  }
}
