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
  update: (
    key: SqliteDemoId,
    callback: (draft: Record<string, unknown>) => void,
  ) => void
}

function getCollection(
  collections: SchemaCollections,
  tableName: SqliteDemoTableName,
): MutableSqliteDemoCollection {
  return collections[tableName] as unknown as MutableSqliteDemoCollection
}

async function createSqliteDemoDatabase(): Promise<FrontendSqliteDatabase> {
  const db = await FrontendSqliteDatabase.createInMemory()
  const inboxId = '7f4c2a9d1e8b6c3055d4f913a27be1c0'
  const workspaceId = '2bd91f0a6c7e4d3fb185aa9246ce8f71'
  const noteOneId = '94a7c31ef20d4b68a15f77c2de983ab4'
  const noteTwoId = 'c18e5d72ab904f36be21d44a89f0c6d3'
  const noteThreeId = '3ea96bf14cd82750a8d2e6719f43bc05'
  const inboxCreatedAt = 1709748000000n
  const workspaceCreatedAt = 1709748300000n
  const noteOneCreatedAt = 1709748600001n
  const noteTwoCreatedAt = 1709748720003n
  const noteThreeCreatedAt = 1709748900002n

  createAllTables(db)

  db.execute(
    `
      INSERT INTO notebooks (_id, _createdAt, _updatedAt, name, description)
      VALUES
        (?, ?, ?, ?, ?),
        (?, ?, ?, ?, ?);
    `,
    [
      inboxId,
      inboxCreatedAt,
      inboxCreatedAt,
      'Inbox',
      'Quick capture workspace',
      workspaceId,
      workspaceCreatedAt,
      workspaceCreatedAt,
      'Offline-first note store',
      'Demo notebook seeded by the sandbox',
    ],
  )

  db.execute(
    `
      INSERT INTO notes (_id, notebook_id, title, body, status, _createdAt)
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
      noteOneCreatedAt,
      noteTwoId,
      inboxId,
      'Support migrations',
      'Track schema changes in one place.',
      'draft',
      noteTwoCreatedAt,
      noteThreeId,
      workspaceId,
      'Prototype table browser',
      'Render schemas and row data in the sandbox.',
      'open',
      noteThreeCreatedAt,
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
        Object.entries(row).map(([key, value]) => [
          key,
          value === null ? '' : String(value),
        ]),
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
      const newRow = database.createInsertableRow(
        tableName,
      ) as unknown as AnyRow

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
