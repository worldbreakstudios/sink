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
  const textFieldTypeId = '6f8a2d9c4b7e1a3055d4f913a27be1c0'
  const richTextFieldTypeId = '2aa74d9e51c84f63b08d72ce4a19f6b2'
  const statusFieldTypeId = '1bd91f0a6c7e4d3fb185aa9246ce8f71'
  const noteObjectTypeId = '24a7c31ef20d4b68a15f77c2de983ab4'
  const taskObjectTypeId = '38e5d72ab904f36be21d44a89f0c6d3f'
  const inboxObjectId = '4ea96bf14cd82750a8d2e6719f43bc05'
  const taskObjectId = '57c9e20f34b8716ad2495ce30f8ab164'
  const titleFieldId = '68f1be24ad70953c41e28fd6bc3a0175'
  const bodyFieldId = '73a2d5f91c8e4067bb14de2559fa6c82'
  const statusFieldId = '8ce34a71d29540f6ab167e4c3d8bf025'
  const inboxObjectCreatedAt = 1709748000000n
  const taskObjectCreatedAt = 1709748600000n
  const titleFieldCreatedAt = 1709748120000n
  const bodyFieldCreatedAt = 1709748180000n
  const statusFieldCreatedAt = 1709748720000n
  createAllTables(db)

  db.execute(
    `
      INSERT INTO fieldTypes (_id, name)
      VALUES
        (?, ?),
        (?, ?),
        (?, ?);
    `,
    [
      textFieldTypeId,
      'text',
      richTextFieldTypeId,
      'rich_text',
      statusFieldTypeId,
      'status',
    ],
  )

  db.execute(
    `
      INSERT INTO objectTypes (_id, name)
      VALUES
        (?, ?),
        (?, ?);
    `,
    [noteObjectTypeId, 'note', taskObjectTypeId, 'task'],
  )

  db.execute(
    `
      INSERT INTO objects (_id, _createdAt, type_id)
      VALUES
        (?, ?, ?),
        (?, ?, ?);
    `,
    [
      inboxObjectId,
      inboxObjectCreatedAt,
      noteObjectTypeId,
      taskObjectId,
      taskObjectCreatedAt,
      taskObjectTypeId,
    ],
  )

  db.execute(
    `
      INSERT INTO fields (_id, _createdAt, object_id, field_type_id, name, body)
      VALUES
        (?, ?, ?, ?, ?, ?),
        (?, ?, ?, ?, ?, ?),
        (?, ?, ?, ?, ?, ?);
    `,
    [
      titleFieldId,
      titleFieldCreatedAt,
      inboxObjectId,
      textFieldTypeId,
      'title',
      'Welcome note title',
      bodyFieldId,
      bodyFieldCreatedAt,
      inboxObjectId,
      richTextFieldTypeId,
      'body',
      'Initial sandbox note body',
      statusFieldId,
      statusFieldCreatedAt,
      taskObjectId,
      statusFieldTypeId,
      'status',
      'open',
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
