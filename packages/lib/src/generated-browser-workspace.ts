import type { TransactionConfig } from '@tanstack/db'
import type {
  AsyncSqliteDatabase,
  DatabaseCreationResult,
  PersistenceType,
  SqliteTableSnapshot,
} from './sqlite.js'
import type { SqliteReferenceColumn } from './sqlite-collection.js'
import type {
  OpenSyncMutationTransaction,
  SyncClient,
} from './sync-runtime-client.js'
import {
  getRowKey,
  getSyncCollection,
  serializeRowKey,
} from './sync-runtime-helpers.js'
import type {
  CreateSyncBatchTransaction,
  MutableSyncCollection,
  SyncMutationDefinition,
  SyncQueryDefinition,
  SyncSchemaMetadata,
  SyncTableMetadata,
} from './sync-runtime-types.js'

export type GeneratedInsertDraft = Record<string, string>

export interface GeneratedBrowserWorkspace<
  TCollections extends object,
  TRow extends object = Record<string, unknown>,
  TKey = unknown,
  TTableName extends string = string,
> {
  database: AsyncSqliteDatabase
  persistenceType: PersistenceType
  collections: TCollections
  syncClient: SyncClient<TCollections>
  syncEnabled: boolean
  getReferenceColumn: (
    tableName: TTableName,
    columnName: string,
  ) => SqliteReferenceColumn | null
  readRows: (tableName: TTableName) => Promise<TRow[]>
  inspectTables: (limit?: number) => Promise<SqliteTableSnapshot[]>
  createBatchTransaction: (
    config?: Omit<TransactionConfig<TRow>, 'mutationFn'>,
  ) => ReturnType<CreateSyncBatchTransaction<TCollections>>
  createInsertDraft: (tableName: TTableName) => Promise<GeneratedInsertDraft>
  validateInsertDraft: (
    tableName: TTableName,
    draft: GeneratedInsertDraft,
  ) => Promise<string | null>
  queueInsert: (tableName: TTableName, draft: GeneratedInsertDraft) => Promise<void>
  deleteRows: (tableName: TTableName, keys: TKey[]) => Promise<void>
  updateCell: (
    tableName: TTableName,
    key: TKey,
    columnName: string,
    value: string,
  ) => Promise<void>
  beginCellEditTransaction: (
    tableName: TTableName,
    key: TKey,
    columnName: string,
  ) => Promise<void>
  cancelCellEditTransaction: (
    tableName: TTableName,
    key: TKey,
    columnName: string,
  ) => Promise<void>
  insertRow: (tableName: TTableName) => Promise<void>
  close: () => Promise<void>
}

export interface CreateGeneratedBrowserWorkspaceOptions<
  TCollections extends object,
  TRow extends object = Record<string, unknown>,
> {
  metadata: SyncSchemaMetadata
  createDatabase: () => Promise<DatabaseCreationResult>
  createAllTables: (database: AsyncSqliteDatabase) => Promise<void>
  seedLocal?: (database: AsyncSqliteDatabase) => Promise<void>
  createCollections: (database: AsyncSqliteDatabase) => Promise<TCollections>
  createBatchTransaction: (
    collections: TCollections,
    config?: Omit<TransactionConfig<TRow>, 'mutationFn'>,
  ) => ReturnType<CreateSyncBatchTransaction<TCollections>>
  createSyncClient: (options: {
    database: AsyncSqliteDatabase
    collections: TCollections
    createBatchTransaction: CreateSyncBatchTransaction<TCollections>
    serverBaseUrl: string
    websocketUrl: string
  }) => SyncClient<TCollections>
  queries: Record<string, SyncQueryDefinition<any, any, TCollections>>
  mutations: Record<string, SyncMutationDefinition<any, any, any, TCollections>>
  serverBaseUrl: string
  websocketUrl: string
}

export function getGeneratedWorkspaceRowKey<
  TTableName extends string,
  TRow extends object,
>(
  metadata: SyncSchemaMetadata,
  tableName: TTableName,
  row: TRow,
): unknown {
  const tableMetadata = getTableMetadata(metadata, tableName)
  return getRowKey(tableMetadata, row)
}

export function serializeGeneratedWorkspaceKey(
  metadata: SyncSchemaMetadata,
  tableName: string,
  key: unknown,
): string {
  const tableMetadata = getTableMetadata(metadata, tableName)
  return serializeRowKey(tableMetadata.keyColumns, key)
}

export function formatGeneratedWorkspaceKey(
  metadata: SyncSchemaMetadata,
  tableName: string,
  key: unknown,
): string {
  const tableMetadata = getTableMetadata(metadata, tableName)
  const keyColumns = tableMetadata.keyColumns

  if (
    keyColumns.length === 1 &&
    (typeof key === 'string' ||
      typeof key === 'number' ||
      typeof key === 'bigint')
  ) {
    return String(key)
  }

  const keyRecord = key as Record<string, unknown>

  return keyColumns
    .map((columnName) => `${columnName}=${String(keyRecord[columnName] ?? '')}`)
    .join(' ')
}

export async function createGeneratedBrowserWorkspace<
  TCollections extends object,
  TRow extends object = Record<string, unknown>,
  TKey = unknown,
  TTableName extends string = string,
>(
  options: CreateGeneratedBrowserWorkspaceOptions<
    TCollections,
    TRow
  >,
): Promise<GeneratedBrowserWorkspace<TCollections, TRow, TKey, TTableName>> {
  const { database, persistenceType } = await options.createDatabase()

  await options.createAllTables(database)
  await options.seedLocal?.(database)

  const collections = await options.createCollections(database)
  const makeBatchTx = (
    config?: Omit<TransactionConfig<TRow>, 'mutationFn'>,
  ) => options.createBatchTransaction(collections, config)
  const makeSyncBatchTx: CreateSyncBatchTransaction<TCollections> = (
    currentCollections,
    config,
  ) => options.createBatchTransaction(
    currentCollections,
    config as Omit<TransactionConfig<TRow>, 'mutationFn'> | undefined,
  )
  const syncClient = options.createSyncClient({
    database,
    collections,
    createBatchTransaction: makeSyncBatchTx,
    serverBaseUrl: options.serverBaseUrl,
    websocketUrl: options.websocketUrl,
  })
  const cellEditTransactions = new Map<
    string,
    OpenSyncMutationTransaction<Record<string, unknown>, unknown, unknown>
  >()
  const syncQueryDisposers = Object.keys(options.metadata.tables)
    .map((tableName) => options.queries[`${tableName}.list`])
    .filter(Boolean)
    .map((definition) => syncClient.watchQuery(definition as never, {} as never))

  return {
    database,
    persistenceType,
    collections,
    syncClient,
    syncEnabled: true,
    getReferenceColumn(tableName, columnName) {
      return (
        getTableMetadata(options.metadata, tableName).referenceColumns[
          columnName
        ] ?? null
      )
    },
    async readRows(tableName) {
      return readRowsForTable<TCollections, TRow>(collections, tableName)
    },
    async inspectTables(limit) {
      return database.inspectTables(limit)
    },
    createBatchTransaction: makeBatchTx,
    async createInsertDraft(tableName) {
      return createInsertDraft(options.metadata, database, collections, tableName)
    },
    async validateInsertDraft(tableName, draft) {
      return validateInsertDraft(
        options.metadata,
        database,
        collections,
        tableName,
        draft,
      )
    },
    async queueInsert(tableName, draft) {
      const validationError = await validateInsertDraft(
        options.metadata,
        database,
        collections,
        tableName,
        draft,
      )

      if (validationError) {
        throw new Error(validationError)
      }

      const row = (await coerceInsertDraft(
        database,
        tableName,
        draft,
      )) as unknown as TRow

      await executeGeneratedMutation(
        options.mutations,
        syncClient,
        tableName,
        'insert',
        { row },
      )
    },
    async deleteRows(tableName, keys) {
      if (keys.length === 0) {
        return
      }

      for (const key of keys) {
        await executeGeneratedMutation(
          options.mutations,
          syncClient,
          tableName,
          'delete',
          { key },
        )
      }
    },
    async updateCell(tableName, key, columnName, value) {
      const editSessionKey = getCellEditTransactionKey(
        options.metadata,
        tableName,
        key,
        columnName,
      )
      const typedValue = await database.coerceTableValue(tableName, columnName, value)
      const activeEditTransaction = cellEditTransactions.get(editSessionKey)

      if (activeEditTransaction) {
        try {
          await activeEditTransaction.commit({
            key,
            changes: {
              [columnName]: typedValue,
            },
          })
        } finally {
          cellEditTransactions.delete(editSessionKey)
        }
        return
      }

      await executeGeneratedMutation(
        options.mutations,
        syncClient,
        tableName,
        'update',
        {
          key,
          changes: {
            [columnName]: typedValue,
          },
        },
      )
    },
    async beginCellEditTransaction(tableName, key, columnName) {
      const editSessionKey = getCellEditTransactionKey(
        options.metadata,
        tableName,
        key,
        columnName,
      )

      if (cellEditTransactions.has(editSessionKey)) {
        return
      }

      const updateDefinition = getGeneratedMutationDefinition(
        options.mutations,
        tableName,
        'update',
      )
      const transaction = await syncClient.beginMutationTransaction(
        updateDefinition as never,
        {
          key,
          changes: {},
        } as never,
      )
      cellEditTransactions.set(
        editSessionKey,
        transaction as OpenSyncMutationTransaction<Record<string, unknown>, unknown, unknown>,
      )
    },
    async cancelCellEditTransaction(tableName, key, columnName) {
      const editSessionKey = getCellEditTransactionKey(
        options.metadata,
        tableName,
        key,
        columnName,
      )
      const activeEditTransaction = cellEditTransactions.get(editSessionKey)

      if (!activeEditTransaction) {
        return
      }

      cellEditTransactions.delete(editSessionKey)
      await activeEditTransaction.abort()
    },
    async insertRow(tableName) {
      const tableMetadata = getTableMetadata(options.metadata, tableName)

      if (!tableMetadata.autogeneratedId) {
        throw new Error(`Table "${tableName}" requires a custom _id.`)
      }

      const newRow = (await database.createInsertableRow(
        tableName,
      )) as Record<string, unknown>
      await applyInsertDefaults(options.metadata, collections, tableName, newRow)
      await executeGeneratedMutation(
        options.mutations,
        syncClient,
        tableName,
        'insert',
        { row: newRow },
      )
    },
    async close() {
      const pendingCellEditTransactions = [...cellEditTransactions.values()]
      cellEditTransactions.clear()

      await Promise.allSettled(
        pendingCellEditTransactions.map((transaction) => transaction.abort()),
      )

      for (const dispose of syncQueryDisposers) {
        dispose()
      }

      syncClient.stop()

      for (const collection of Object.values(collections as Record<string, MutableSyncCollection>)) {
        const maybeDispose = (
          collection.utils as { dispose?: (() => void) | undefined }
        ).dispose

        maybeDispose?.()
      }

      await database.close()
    },
  }
}

function getTableMetadata(
  metadata: SyncSchemaMetadata,
  tableName: string,
): SyncTableMetadata {
  const tableMetadata = metadata.tables[tableName]

  if (!tableMetadata) {
    throw new Error(`Unknown sync table "${tableName}".`)
  }

  return tableMetadata
}

function getGeneratedMutationDefinition(
  mutations: Record<string, SyncMutationDefinition<any, any, any, any>>,
  tableName: string,
  operation: 'insert' | 'update' | 'delete',
): SyncMutationDefinition<any, any, any, any> {
  const definition = mutations[`${tableName}.${operation}`]

  if (!definition) {
    throw new Error(
      `No generated ${operation} mutation exists for table "${tableName}".`,
    )
  }

  return definition
}

async function executeGeneratedMutation(
  mutations: Record<string, SyncMutationDefinition<any, any, any, any>>,
  syncClient: SyncClient<any>,
  tableName: string,
  operation: 'insert' | 'update' | 'delete',
  args: Record<string, unknown>,
): Promise<void> {
  await syncClient.executeMutation(
    getGeneratedMutationDefinition(mutations, tableName, operation) as never,
    args as never,
  )
}

function readRowsForTable<TCollections extends object, TRow extends object>(
  collections: TCollections,
  tableName: string,
): Promise<TRow[]> {
  return getSyncCollection(collections, tableName).utils.readAll() as Promise<TRow[]>
}

function getCellEditTransactionKey(
  metadata: SyncSchemaMetadata,
  tableName: string,
  key: unknown,
  columnName: string,
): string {
  return `${tableName}:${serializeGeneratedWorkspaceKey(metadata, tableName, key)}:${columnName}`
}

type RowRecord = Record<string, unknown>

function sameFields(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((field, index) => field === right[index])
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (typeof left === 'bigint' || typeof right === 'bigint') {
    return String(left) === String(right)
  }

  if (Object.is(left, right)) {
    return true
  }

  return JSON.stringify(left) === JSON.stringify(right)
}

function getReferenceKeyValue(
  referencedMetadata: SyncTableMetadata,
  row: RowRecord,
): unknown {
  const referenceKeyColumn = referencedMetadata.keyColumns[0]

  if (!referenceKeyColumn) {
    return ''
  }

  return row[referenceKeyColumn] ?? ''
}

async function getActorDefaultValue(
  metadata: SyncSchemaMetadata,
  collections: object,
): Promise<unknown> {
  if (!metadata.tables.actors) {
    return ''
  }

  const actorRows = await readRowsForTable<object, RowRecord>(collections, 'actors')
  const actorMetadata = metadata.tables.actors
  return actorRows[0]
    ? getReferenceKeyValue(actorMetadata, actorRows[0] as RowRecord)
    : ''
}

function findConflictingUniqueIndex(
  metadata: SyncSchemaMetadata,
  tableName: string,
  row: RowRecord,
  existingRows: RowRecord[],
): string | null {
  const tableMetadata = getTableMetadata(metadata, tableName)

  for (const [indexName, definition] of Object.entries(tableMetadata.indexes)) {
    if (!definition.unique || sameFields(definition.fields, tableMetadata.keyColumns)) {
      continue
    }

    const matchesExisting = existingRows.some((existingRow) =>
      definition.fields.every((fieldName) =>
        valuesEqual(existingRow[fieldName], row[fieldName]),
      ),
    )

    if (matchesExisting) {
      return indexName
    }
  }

  return null
}

function findNonConflictingReferenceAssignment(
  row: RowRecord,
  fields: readonly string[],
  referenceOptions: Partial<Record<string, unknown[]>>,
  existingRows: RowRecord[],
): Record<string, unknown> | null {
  const adjustableFields = fields.filter(
    (fieldName) => (referenceOptions[fieldName]?.length ?? 0) > 0,
  )

  if (adjustableFields.length === 0) {
    return null
  }

  let resolved: Record<string, unknown> | null = null

  const visit = (fieldIndex: number, nextValues: Record<string, unknown>) => {
    if (resolved) {
      return
    }

    if (fieldIndex >= adjustableFields.length) {
      const candidateRow = {
        ...row,
        ...nextValues,
      }
      const conflicts = existingRows.some((existingRow) =>
        fields.every((fieldName) =>
          valuesEqual(existingRow[fieldName], candidateRow[fieldName]),
        ),
      )

      if (!conflicts) {
        resolved = nextValues
      }
      return
    }

    const fieldName = adjustableFields[fieldIndex]

    if (!fieldName) {
      return
    }

    for (const option of referenceOptions[fieldName] ?? []) {
      visit(fieldIndex + 1, {
        ...nextValues,
        [fieldName]: option,
      })

      if (resolved) {
        return
      }
    }
  }

  visit(0, {})
  return resolved
}

async function applyNonConflictingInsertDefaults(
  metadata: SyncSchemaMetadata,
  collections: object,
  tableName: string,
  row: RowRecord,
): Promise<void> {
  const tableMetadata = getTableMetadata(metadata, tableName)
  const existingRows = await readRowsForTable<object, RowRecord>(collections, tableName)
  const referenceOptions: Partial<Record<string, unknown[]>> = {}

  for (const [columnName, config] of Object.entries(tableMetadata.referenceColumns)) {
    if (!config) {
      continue
    }

    const referencedMetadata = getTableMetadata(metadata, config.referencedTable)
    const referencedRows = await readRowsForTable<object, RowRecord>(
      collections,
      config.referencedTable,
    )
    const actorScopedRows = config.actorScoped && typeof row._actor === 'string'
      ? referencedRows.filter((candidate) => candidate._actor === row._actor)
      : referencedRows

    referenceOptions[columnName] = actorScopedRows.map((candidate) =>
      getReferenceKeyValue(referencedMetadata, candidate),
    )
  }

  for (const definition of Object.values(tableMetadata.indexes)) {
    if (!definition.unique || sameFields(definition.fields, tableMetadata.keyColumns)) {
      continue
    }

    const conflicts = existingRows.some((existingRow) =>
      definition.fields.every((fieldName) =>
        valuesEqual(existingRow[fieldName], row[fieldName]),
      ),
    )

    if (!conflicts) {
      continue
    }

    const replacement = findNonConflictingReferenceAssignment(
      row,
      definition.fields,
      referenceOptions,
      existingRows,
    )

    if (replacement) {
      Object.assign(row, replacement)
    }
  }
}

async function applyInsertDefaults(
  metadata: SyncSchemaMetadata,
  collections: object,
  tableName: string,
  row: RowRecord,
): Promise<void> {
  if ('_actor' in row && (!row._actor || row._actor === '')) {
    row._actor = await getActorDefaultValue(metadata, collections)
  }

  const tableMetadata = getTableMetadata(metadata, tableName)

  for (const [columnName, config] of Object.entries(tableMetadata.referenceColumns)) {
    if (!config || row[columnName]) {
      continue
    }

    const referencedMetadata = getTableMetadata(metadata, config.referencedTable)
    const referencedRows = await readRowsForTable<object, RowRecord>(
      collections,
      config.referencedTable,
    )
    const actorScopedRows = config.actorScoped && typeof row._actor === 'string'
      ? referencedRows.filter((candidate) => candidate._actor === row._actor)
      : referencedRows

    row[columnName] = actorScopedRows[0]
      ? getReferenceKeyValue(referencedMetadata, actorScopedRows[0])
      : ''
  }

  await applyNonConflictingInsertDefaults(metadata, collections, tableName, row)
}

async function createInsertDraft(
  metadata: SyncSchemaMetadata,
  database: AsyncSqliteDatabase,
  collections: object,
  tableName: string,
): Promise<GeneratedInsertDraft> {
  const row = (await database.createInsertableRow(tableName)) as RowRecord
  const tableMetadata = getTableMetadata(metadata, tableName)

  if (!tableMetadata.autogeneratedId && typeof row._id !== 'undefined') {
    row._id = ''
  }

  await applyInsertDefaults(metadata, collections, tableName, row)

  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      value === null ? '' : String(value),
    ]),
  )
}

async function coerceInsertDraft(
  database: AsyncSqliteDatabase,
  tableName: string,
  draft: GeneratedInsertDraft,
): Promise<RowRecord> {
  const entries = await Promise.all(
    Object.entries(draft).map(async ([columnName, value]) => [
      columnName,
      await database.coerceTableValue(tableName, columnName, value),
    ]),
  )

  return Object.fromEntries(entries)
}

async function validateInsertDraft(
  metadata: SyncSchemaMetadata,
  database: AsyncSqliteDatabase,
  collections: object,
  tableName: string,
  draft: GeneratedInsertDraft,
): Promise<string | null> {
  const tableMetadata = getTableMetadata(metadata, tableName)

  if (!tableMetadata.autogeneratedId && (draft._id ?? '').trim() === '') {
    return `Table "${tableName}" requires a custom _id.`
  }

  let row: RowRecord

  try {
    row = await coerceInsertDraft(database, tableName, draft)
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }

  const existingRows = await readRowsForTable<object, RowRecord>(collections, tableName)
  const conflictingIndex = findConflictingUniqueIndex(
    metadata,
    tableName,
    row,
    existingRows,
  )

  if (conflictingIndex) {
    return `A row in "${tableName}" already exists for unique index "${conflictingIndex}". Choose a different combination or edit the existing row instead.`
  }

  return null
}
