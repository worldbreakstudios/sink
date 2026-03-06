import { createTransaction, type TransactionConfig } from '@tanstack/db'
import {
  createSqliteCollection,
  type SqliteCollection,
} from './sqlite-collection'
import { createSqliteDemoDatabase, FrontendSqliteDatabase } from './sqlite'

export interface NotebookRecord {
  id: number
  name: string
  description: string | null
  created_at: string
}

export interface NoteRecord {
  id: number
  notebook_id: number
  title: string
  body: string
  status: string
  created_at: string
}

export type SqliteDemoTableName = 'notebooks' | 'notes'

export interface SqliteDemoCollectionsWorkspace {
  database: FrontendSqliteDatabase
  notebooksCollection: SqliteCollection<NotebookRecord, number>
  notesCollection: SqliteCollection<NoteRecord, number>
  inspectTables: FrontendSqliteDatabase['inspectTables']
  createBatchTransaction(
    config?: Omit<TransactionConfig<NotebookRecord | NoteRecord>, 'mutationFn'>,
  ): ReturnType<typeof createTransaction<NotebookRecord | NoteRecord>>
  updateCell(
    tableName: SqliteDemoTableName,
    key: number,
    columnName: string,
    value: string,
  ): Promise<void>
  insertRow(tableName: SqliteDemoTableName): Promise<void>
  close(): void
}

export async function createSqliteDemoCollectionsWorkspace(): Promise<SqliteDemoCollectionsWorkspace> {
  const database = await createSqliteDemoDatabase()

  const notebooksCollection = createSqliteCollection<NotebookRecord, number>({
    id: 'sqlite-notebooks',
    tableName: 'notebooks',
    keyColumn: 'id',
    getKey: (row) => row.id,
    database,
    orderBy: 'id ASC',
  })

  const notesCollection = createSqliteCollection<NoteRecord, number>({
    id: 'sqlite-notes',
    tableName: 'notes',
    keyColumn: 'id',
    getKey: (row) => row.id,
    database,
    orderBy: 'id ASC',
  })

  const createBatchTransaction = (
    config?: Omit<TransactionConfig<NotebookRecord | NoteRecord>, 'mutationFn'>,
  ) =>
    createTransaction<NotebookRecord | NoteRecord>({
      ...config,
      mutationFn: async ({ transaction }) => {
        await notebooksCollection.utils.persistMutations(transaction)
        await notesCollection.utils.persistMutations(transaction)
      },
    })

  return {
    database,
    notebooksCollection,
    notesCollection,
    inspectTables: database.inspectTables.bind(database),
    createBatchTransaction,
    async updateCell(tableName, key, columnName, value) {
      const typedValue = database.coerceTableValue(tableName, columnName, value)
      const transaction = createBatchTransaction()

      if (tableName === 'notebooks') {
        transaction.mutate(() => {
          notebooksCollection.update(key, (draft) => {
            ;(draft as Record<string, unknown>)[columnName] = typedValue
          })
        })
      } else {
        transaction.mutate(() => {
          notesCollection.update(key, (draft) => {
            ;(draft as Record<string, unknown>)[columnName] = typedValue
          })
        })
      }

      await transaction.isPersisted.promise
    },
    async insertRow(tableName) {
      const transaction = createBatchTransaction()

      if (tableName === 'notebooks') {
        const newRow = database.createInsertableRow(tableName) as unknown as NotebookRecord

        transaction.mutate(() => {
          notebooksCollection.insert(newRow)
        })
      } else {
        const newRow = database.createInsertableRow(tableName) as unknown as NoteRecord

        transaction.mutate(() => {
          notesCollection.insert(newRow)
        })
      }

      await transaction.isPersisted.promise
    },
    close() {
      database.close()
    },
  }
}
