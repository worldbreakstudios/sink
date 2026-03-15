import type { TransactionConfig } from '@tanstack/db'
import type { AsyncSqliteDatabase, PersistenceType, SqliteReferenceColumn } from '@sink/lib'
import { createDatabase } from '@sink/lib'
import {
  KEY_COLUMNS,
  REFERENCE_COLUMNS,
  createAllTables,
  createBatchTransaction,
  createCollections,
} from '@/data/generated/schema.gen'
import type {
  AnyKey,
  AnyRow,
  KeyByTable,
  SchemaCollections,
  TableName,
} from '@/data/generated/schema.gen'

export type SqliteDemoRow = AnyRow
export type SqliteDemoId = AnyKey
export type SqliteDemoTableName = TableName
export type SqliteInsertDraft = Record<string, string>
export type SqliteDemoKeyByTable = KeyByTable

export interface SqliteDemoCollectionsWorkspace {
  database: AsyncSqliteDatabase
  persistenceType: PersistenceType
  collections: SchemaCollections
  getReferenceColumn: (
    tableName: SqliteDemoTableName,
    columnName: string,
  ) => SqliteReferenceColumn | null
  readRows: (tableName: SqliteDemoTableName) => Promise<SqliteDemoRow[]>
  inspectTables: (limit?: number) => Promise<ReturnType<AsyncSqliteDatabase['inspectTables']> extends Promise<infer T> ? T : never>
  createBatchTransaction: (
    config?: Omit<TransactionConfig<AnyRow>, 'mutationFn'>,
  ) => ReturnType<typeof createBatchTransaction>
  createInsertDraft: (tableName: SqliteDemoTableName) => Promise<SqliteInsertDraft>
  queueInsert: (
    tableName: SqliteDemoTableName,
    draft: SqliteInsertDraft,
    transaction: ReturnType<typeof createBatchTransaction>,
  ) => Promise<void>
  updateCell: (
    tableName: SqliteDemoTableName,
    key: SqliteDemoId,
    columnName: string,
    value: string,
  ) => Promise<void>
  insertRow: (tableName: SqliteDemoTableName) => Promise<void>
  close: () => Promise<void>
}

interface MutableSqliteDemoCollection {
  insert: (row: AnyRow) => void
  update: (
    key: SqliteDemoId,
    callback: (draft: Record<string, unknown>) => void,
  ) => void
  utils: {
    readAll: () => Promise<AnyRow[]>
  }
}

function getCollection(
  collections: SchemaCollections,
  tableName: SqliteDemoTableName,
): MutableSqliteDemoCollection {
  return collections[tableName] as unknown as MutableSqliteDemoCollection
}

export function getSqliteDemoRowKey<TTableName extends SqliteDemoTableName>(
  tableName: TTableName,
  row: SqliteDemoRow,
): SqliteDemoKeyByTable[TTableName] {
  const keyColumns = KEY_COLUMNS[tableName]
  const rowRecord = row as unknown as Record<string, unknown>

  if (keyColumns.length === 1) {
    const keyColumn = keyColumns[0]
    return rowRecord[keyColumn] as SqliteDemoKeyByTable[TTableName]
  }

  return Object.fromEntries(
    keyColumns.map((columnName) => [columnName, rowRecord[columnName]]),
  ) as unknown as SqliteDemoKeyByTable[TTableName]
}

export function serializeSqliteDemoKey(
  tableName: SqliteDemoTableName,
  key: SqliteDemoId,
): string {
  const keyColumns = KEY_COLUMNS[tableName]

  if (keyColumns.length === 1 && (typeof key === 'string' || typeof key === 'number' || typeof key === 'bigint')) {
    return String(key)
  }

  const keyRecord = key as unknown as Record<string, unknown>

  return JSON.stringify(
    keyColumns.map((columnName) => [columnName, keyRecord[columnName] ?? null]),
  )
}

export function formatSqliteDemoKey(
  tableName: SqliteDemoTableName,
  key: SqliteDemoId,
): string {
  const keyColumns = KEY_COLUMNS[tableName]

  if (keyColumns.length === 1 && (typeof key === 'string' || typeof key === 'number' || typeof key === 'bigint')) {
    return String(key)
  }

  const keyRecord = key as unknown as Record<string, unknown>

  return keyColumns
    .map((columnName) => `${columnName}=${String(keyRecord[columnName] ?? '')}`)
    .join(' ')
}

const aliceActorId = '0d3cf6b9c81d41c8b8ad84c3550d0e62'
const bobActorId = 'c24370ab27aa4a7d9a2f6d679c5f9d08'
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
const demoRowId = '9df6271b493d4b1ebed6e9442e680f11'

const inboxObjectCreatedAt = 1709748000000n
const taskObjectCreatedAt = 1709748600000n
const titleFieldCreatedAt = 1709748120000n
const bodyFieldCreatedAt = 1709748180000n
const statusFieldCreatedAt = 1709748720000n
const demoCreatedAt = 1709748840000n
const demoUpdatedAt = 1709748900000n

async function seedCoreData(db: AsyncSqliteDatabase): Promise<void> {
  await db.execute(
    `INSERT INTO actors (_id) VALUES (?), (?);`,
    [aliceActorId, bobActorId],
  )

  await db.execute(
    `INSERT INTO fieldTypes (_id, name) VALUES (?, ?), (?, ?), (?, ?);`,
    [textFieldTypeId, 'text', richTextFieldTypeId, 'rich_text', statusFieldTypeId, 'status'],
  )

  await db.execute(
    `INSERT INTO objectTypes (_id, name) VALUES (?, ?), (?, ?);`,
    [noteObjectTypeId, 'note', taskObjectTypeId, 'task'],
  )

  await db.execute(
    `INSERT INTO objects (_actor, _id, _createdAt, type_id) VALUES (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?);`,
    [
      aliceActorId, inboxObjectId, inboxObjectCreatedAt, noteObjectTypeId,
      aliceActorId, taskObjectId, taskObjectCreatedAt, taskObjectTypeId,
      bobActorId, inboxObjectId, inboxObjectCreatedAt, noteObjectTypeId,
    ],
  )

  await db.execute(
    `INSERT INTO fields (_actor, _id, _createdAt, object_id, field_type_id, name, body) VALUES (?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?);`,
    [
      aliceActorId, titleFieldId, titleFieldCreatedAt, inboxObjectId, textFieldTypeId, 'title', 'Welcome note title',
      aliceActorId, bodyFieldId, bodyFieldCreatedAt, inboxObjectId, richTextFieldTypeId, 'body', 'Initial sandbox note body',
      aliceActorId, statusFieldId, statusFieldCreatedAt, taskObjectId, statusFieldTypeId, 'status', 'open',
    ],
  )
}

async function seedCodegenDemoTable(db: AsyncSqliteDatabase): Promise<void> {
  await db.execute(
    `INSERT INTO demos (
      _actor,
      _id,
      _createdAt,
      _updatedAt,
      _archivedAt,
      label,
      count,
      ratio,
      is_active,
      field_type_id,
      object_id,
      optional_object_id,
      tags,
      checkpoints,
      settings,
      translations,
      default_status,
      default_score,
      default_flags,
      optional_notes,
      optional_feature_toggles
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      aliceActorId,
      demoRowId,
      demoCreatedAt,
      demoUpdatedAt,
      null,
      'All codegen types',
      7,
      0.875,
      1,
      richTextFieldTypeId,
      inboxObjectId,
      taskObjectId,
      JSON.stringify(['demo', 'nested', 'codegen']),
      JSON.stringify([
        { label: 'Define schema', done: true, order: 1 },
        { label: 'Generate types', done: true, order: 2 },
        { label: 'Render in sandbox', done: false, order: 3 },
      ]),
      JSON.stringify({
        layout: {
          mode: 'stacked',
          density: 'comfortable',
        },
        retries: 3,
        showHints: true,
        featuredFieldTypeId: textFieldTypeId,
        thresholds: [0.25, 0.5, 0.75],
      }),
      JSON.stringify({
        en: {
          title: 'Codegen demo',
          enabled: true,
        },
        fr: {
          title: 'Demo de generation',
          enabled: false,
        },
      }),
      'seeded',
      0.98,
      JSON.stringify({
        archived: false,
        pinned: true,
      }),
      JSON.stringify(['nullable array example', 'edit me as JSON']),
      JSON.stringify({
        beta: true,
        compact: false,
      }),
    ],
  )
}

export async function createSqliteDemoCollectionsWorkspace(): Promise<SqliteDemoCollectionsWorkspace> {
  // Create database with OPFS as default, localStorage as fallback
  const { database, persistenceType } = await createDatabase({
    preferredPersistence: 'opfs',
    opfsFilename: 'sqlite-demo-actors.db',
  })

  // Create tables
  await createAllTables(database)

  // Seed the core relational demo once.
  const existingRows = await database.query<{ count: number }>(
    'SELECT COUNT(*) as count FROM fieldTypes',
  )
  if ((existingRows[0]?.count ?? 0) === 0) {
    await seedCoreData(database)
  }

  // Seed the codegen showcase table independently so older local DBs pick it up too.
  const existingDemoRows = await database.query<{ count: number }>(
    'SELECT COUNT(*) as count FROM demos',
  )
  if ((existingDemoRows[0]?.count ?? 0) === 0) {
    await seedCodegenDemoTable(database)
  }

  const collections = await createCollections(database)

  const makeBatchTx = (
    config?: Omit<TransactionConfig<AnyRow>, 'mutationFn'>,
  ) => createBatchTransaction(collections, config)

  return {
    database,
    persistenceType,
    collections,
    getReferenceColumn(tableName, columnName) {
      return REFERENCE_COLUMNS[tableName][columnName] ?? null
    },
    async readRows(tableName) {
      return getCollection(collections, tableName).utils.readAll()
    },
    async inspectTables(limit) {
      return database.inspectTables(limit)
    },
    createBatchTransaction: makeBatchTx,
    async createInsertDraft(tableName) {
      const row = await database.createInsertableRow(tableName)
      const rowRecord = row as unknown as Record<string, unknown>

      if ('_actor' in rowRecord && (!rowRecord._actor || rowRecord._actor === '')) {
        const actorRows = await getCollection(collections, 'actors').utils.readAll()
        rowRecord._actor = actorRows[0]?._id ?? ''
      }

      for (const [columnName, config] of Object.entries(
        REFERENCE_COLUMNS[tableName],
      )) {
        if (!config) {
          continue
        }

        const referencedRows = await getCollection(
          collections,
          config.referencedTable as SqliteDemoTableName,
        ).utils.readAll()
        const actorScopedRows = config.actorScoped && typeof rowRecord._actor === 'string'
          ? referencedRows.filter((candidate) => {
              const candidateRecord = candidate as unknown as Record<string, unknown>
              return candidateRecord._actor === rowRecord._actor
            })
          : referencedRows
        rowRecord[columnName] = actorScopedRows[0]?._id ?? ''
      }

      return Object.fromEntries(
        Object.entries(row).map(([key, value]) => [
          key,
          value === null ? '' : String(value),
        ]),
      )
    },
    async queueInsert(tableName, draft, transaction) {
      const entries = await Promise.all(
        Object.entries(draft).map(async ([columnName, value]) => [
          columnName,
          await database.coerceTableValue(tableName, columnName, value),
        ]),
      )
      const row = Object.fromEntries(entries) as unknown as AnyRow

      transaction.mutate(() => {
        getCollection(collections, tableName).insert(row)
      })
    },
    async updateCell(tableName, key, columnName, value) {
      const typedValue = await database.coerceTableValue(tableName, columnName, value)
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
      const newRow = await database.createInsertableRow(
        tableName,
      ) as unknown as AnyRow
      const newRowRecord = newRow as unknown as Record<string, unknown>

      if ('_actor' in newRowRecord && (!newRowRecord._actor || newRowRecord._actor === '')) {
        const actorRows = await getCollection(collections, 'actors').utils.readAll()
        newRowRecord._actor = actorRows[0]?._id ?? ''
      }

      transaction.mutate(() => {
        getCollection(collections, tableName).insert(newRow)
      })

      await transaction.isPersisted.promise
    },
    async close() {
      await database.close()
    },
  }
}
