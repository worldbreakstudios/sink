import type { TransactionConfig } from '@tanstack/db'
import { FrontendSqliteDatabase } from '@sink/lib'
import type { SqliteReferenceColumn } from '@sink/lib'
import {
  REFERENCE_COLUMNS,
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
  getReferenceColumn: (
    tableName: SqliteDemoTableName,
    columnName: string,
  ) => SqliteReferenceColumn | null
  readRows: (tableName: SqliteDemoTableName) => SqliteDemoRow[]
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
  utils: {
    readAll: () => AnyRow[]
  }
}

function getCollection(
  collections: SchemaCollections,
  tableName: SqliteDemoTableName,
): MutableSqliteDemoCollection {
  return collections[tableName] as unknown as MutableSqliteDemoCollection
}

async function createSqliteDemoDatabase(): Promise<FrontendSqliteDatabase> {
  const db = await FrontendSqliteDatabase.createInMemory()
  createAllTables(db)
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
    getReferenceColumn(tableName, columnName) {
      return REFERENCE_COLUMNS[tableName][columnName] ?? null
    },
    readRows(tableName) {
      return getCollection(collections, tableName).utils.readAll()
    },
    inspectTables: database.inspectTables.bind(database),
    createBatchTransaction: makeBatchTx,
    createInsertDraft(tableName) {
      const row = database.createInsertableRow(tableName)

      for (const [columnName, config] of Object.entries(REFERENCE_COLUMNS[tableName])) {
        if (!config) {
          continue
        }

        const referencedRows = getCollection(
          collections,
          config.referencedTable as SqliteDemoTableName,
        ).utils.readAll()
        row[columnName] = referencedRows[0]?._id ?? ''
      }

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
