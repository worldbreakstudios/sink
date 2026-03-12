import type { SqlValue } from '@sqlite.org/sqlite-wasm'
import type { SqliteReferenceColumn } from './sqlite-collection.js'
import type {
  AsyncSqliteDatabase,
  PersistenceType,
  SqliteIndexSnapshot,
  SqliteTableColumn,
  SqliteTableSnapshot,
} from './sqlite.js'

export interface SerializedBigIntValue {
  type: 'bigint'
  value: string
}

export interface SerializedBlobValue {
  type: 'blob'
  base64: string
  byteLength: number
}

export type SerializedSqliteValue =
  | null
  | number
  | string
  | SerializedBigIntValue
  | SerializedBlobValue

export interface SinkDevtoolsIndexDefinition {
  fields: readonly string[]
  unique: boolean
}

export interface SinkDevtoolsSchemaMetadata {
  tableNames: readonly string[]
  indexes: Record<string, Record<string, SinkDevtoolsIndexDefinition>>
  referenceColumns: Record<string, Partial<Record<string, SqliteReferenceColumn>>>
}

interface SinkDevtoolsCollectionHandle {
  insert: (row: Record<string, unknown>) => void
  update: (
    key: unknown,
    updater: (draft: Record<string, unknown>) => void,
  ) => void
  query: () => {
    withIndex: (indexName: string, build?: (builder: any) => any) => any
    order: (direction: 'asc' | 'desc') => any
    collect: () => Promise<Record<string, unknown>[]>
    first: () => Promise<Record<string, unknown> | null>
    unique: () => Promise<Record<string, unknown> | null>
    take: (limit: number) => Promise<Record<string, unknown>[]>
  }
  utils: {
    readAll: () => Promise<Record<string, unknown>[]>
    createSqliteTransaction?: (config?: {
      autoCommit?: boolean
    }) => {
      mutate: (callback: () => void) => void
      isPersisted: {
        promise: Promise<void>
      }
      commit?: () => Promise<void>
      rollback?: () => void
    }
  }
}

export interface SinkDevtoolsDatabaseRegistration {
  database: AsyncSqliteDatabase
  collections?: object
  tableNames: readonly string[]
  INDEXES: Record<string, Record<string, SinkDevtoolsIndexDefinition>>
  REFERENCE_COLUMNS: Record<string, Partial<Record<string, SqliteReferenceColumn>>>
}

export interface SinkDevtoolsDatabaseSummary {
  id: string
  displayLabel: string
  persistenceType: PersistenceType | 'unknown'
  schema: SinkDevtoolsSchemaMetadata
  supportsCollectionMutations: boolean
  supportsExecuteNotifications: boolean
}

export interface SinkDevtoolsTableRow {
  rowId: number
  values: Record<string, SerializedSqliteValue>
}

export interface SinkDevtoolsTableSnapshot {
  name: string
  schema: string
  columns: SqliteTableColumn[]
  rows: SinkDevtoolsTableRow[]
}

export interface SinkDevtoolsExplorerSnapshot {
  version: string
  tables: SinkDevtoolsTableSnapshot[]
}

export type SinkDevtoolsRowRecord = Record<string, SerializedSqliteValue>

export type SinkDevtoolsQueryOperator = 'eq' | 'gt' | 'gte' | 'lt' | 'lte'
export type SinkDevtoolsQueryMethod = 'collect' | 'first' | 'unique' | 'take'

export interface SinkDevtoolsQueryConstraint {
  field: string
  operator: SinkDevtoolsQueryOperator
  value: string
}

export interface SinkDevtoolsQueryInput {
  indexName: string
  constraints: SinkDevtoolsQueryConstraint[]
  orderDirection: 'asc' | 'desc'
  queryMethod: SinkDevtoolsQueryMethod
  takeCount: string
}

export interface SinkDevtoolsChangeEvent {
  databaseId: string
  tableNames: string[]
  source: 'collection' | 'execute'
  manualRefreshRequired: boolean
  timestamp: number
}

export type SinkDevtoolsRpcRequest =
  | {
      id: string
      method: 'listDatabases'
    }
  | {
      id: string
      method: 'getExplorerSnapshot'
      databaseId: string
      limit?: number
    }
  | {
      id: string
      method: 'getTableIndexes'
      databaseId: string
      tableName: string
    }
  | {
      id: string
      method: 'readRows'
      databaseId: string
      tableName: string
    }
  | {
      id: string
      method: 'getReferenceRows'
      databaseId: string
      tableName: string
    }
  | {
      id: string
      method: 'createInsertDraft'
      databaseId: string
      tableName: string
    }
  | {
      id: string
      method: 'updateCell'
      databaseId: string
      tableName: string
      key: SerializedSqliteValue
      columnName: string
      value: string
    }
  | {
      id: string
      method: 'insertDraft'
      databaseId: string
      tableName: string
      draft: Record<string, string>
    }
  | {
      id: string
      method: 'runIndexedQuery'
      databaseId: string
      tableName: string
      query: SinkDevtoolsQueryInput
    }
  | {
      id: string
      method: 'subscribeChanges'
      databaseId: string
    }
  | {
      id: string
      method: 'unsubscribeChanges'
      databaseId: string
    }

export type SinkDevtoolsRpcRequestInput = SinkDevtoolsRpcRequest extends infer TRequest
  ? TRequest extends { id: string }
    ? Omit<TRequest, 'id'>
    : never
  : never

type SinkDevtoolsRpcResult =
  | SinkDevtoolsDatabaseSummary[]
  | SinkDevtoolsExplorerSnapshot
  | SqliteIndexSnapshot[]
  | SinkDevtoolsRowRecord[]
  | Record<string, SinkDevtoolsRowRecord[]>
  | Record<string, string>
  | null

export type SinkDevtoolsRpcResponse =
  | {
      id: string
      ok: true
      result: SinkDevtoolsRpcResult
    }
  | {
      id: string
      ok: false
      error: string
    }

interface SinkDevtoolsRegistrationRecord {
  id: string
  database: AsyncSqliteDatabase
  collections?: Record<string, SinkDevtoolsCollectionHandle>
  summary: SinkDevtoolsDatabaseSummary
}

const CONTENT_BRIDGE_SOURCE = '__sink_devtools_content__'
const PAGE_BRIDGE_SOURCE = '__sink_devtools_page__'

let registrationCount = 0
let bridgeInstalled = false
let bridgeEnabled = false
const registrations = new Map<string, SinkDevtoolsRegistrationRecord>()
const registrationsByDatabase = new WeakMap<
  AsyncSqliteDatabase,
  SinkDevtoolsRegistrationRecord
>()
const changeListeners = new Set<(event: SinkDevtoolsChangeEvent) => void>()
const bridgeSubscriptions = new Set<string>()

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64')
  }

  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return Uint8Array.from(Buffer.from(value, 'base64'))
  }

  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

function isBlobLike(value: unknown): value is Uint8Array | Int8Array | ArrayBuffer {
  return (
    value instanceof Uint8Array ||
    value instanceof Int8Array ||
    value instanceof ArrayBuffer
  )
}

function normalizeBlobBytes(value: Uint8Array | Int8Array | ArrayBuffer): Uint8Array {
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value)
  }

  return value instanceof Int8Array
    ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    : value
}

function parseQueryValue(value: string): unknown {
  if (value === '') {
    return ''
  }

  if (value === 'null') {
    return null
  }

  if (value === 'true') {
    return true
  }

  if (value === 'false') {
    return false
  }

  if (/^-?\d+n$/.test(value)) {
    return BigInt(value.slice(0, -1))
  }

  if (/^-?\d+$/.test(value)) {
    const parsed = Number.parseInt(value, 10)

    if (Math.abs(parsed) > Number.MAX_SAFE_INTEGER / 1000) {
      return BigInt(value)
    }

    return parsed
  }

  if (/^-?\d+\.\d+$/.test(value)) {
    return Number.parseFloat(value)
  }

  return value
}

function serializeRowRecord(row: Record<string, unknown>): SinkDevtoolsRowRecord {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      serializeSqliteValue(value as SqlValue),
    ]),
  )
}

function serializeTableSnapshot(table: SqliteTableSnapshot): SinkDevtoolsTableSnapshot {
  return {
    ...table,
    rows: table.rows.map((row) => ({
      rowId: row.rowId,
      values: serializeRowRecord(row.values),
    })),
  }
}

function createDatabaseSummary(
  database: AsyncSqliteDatabase,
  schema: SinkDevtoolsSchemaMetadata,
  defaultDisplayLabel: string,
  hasCollections: boolean,
): SinkDevtoolsDatabaseSummary {
  return {
    id: '',
    displayLabel: database.devtoolsDisplayLabel ?? defaultDisplayLabel,
    persistenceType: database.persistenceType ?? 'unknown',
    schema,
    supportsCollectionMutations: hasCollections,
    supportsExecuteNotifications: database.devtoolsCanEmitExecuteNotifications ?? false,
  }
}

function getRegistrationById(databaseId: string): SinkDevtoolsRegistrationRecord {
  const registration = registrations.get(databaseId)

  if (!registration) {
    throw new Error(`Sink database "${databaseId}" is not registered.`)
  }

  return registration
}

async function readRowsForTable(
  registration: SinkDevtoolsRegistrationRecord,
  tableName: string,
): Promise<SinkDevtoolsRowRecord[]> {
  const collection = registration.collections?.[tableName]

  if (collection) {
    const rows = await collection.utils.readAll()
    return rows.map((row) => serializeRowRecord(row))
  }

  const rows = await registration.database.query<Record<string, unknown>>(
    `SELECT * FROM "${tableName}" ORDER BY "_id" ASC;`,
  )

  return rows.map((row) => serializeRowRecord(row))
}

async function readReferenceRowsForTable(
  registration: SinkDevtoolsRegistrationRecord,
  tableName: string,
): Promise<Record<string, SinkDevtoolsRowRecord[]>> {
  const referenceColumns =
    registration.summary.schema.referenceColumns[tableName] ?? {}
  const entries = await Promise.all(
    Object.entries(referenceColumns).map(async ([columnName, config]) => {
      if (!config) {
        return [columnName, []] as const
      }

      const rows = await readRowsForTable(registration, config.referencedTable)
      return [columnName, rows] as const
    }),
  )

  return Object.fromEntries(entries)
}

async function createInsertDraftForTable(
  registration: SinkDevtoolsRegistrationRecord,
  tableName: string,
): Promise<Record<string, string>> {
  const row = await registration.database.createInsertableRow(tableName)
  const references =
    registration.summary.schema.referenceColumns[tableName] ?? {}

  for (const [columnName, config] of Object.entries(references)) {
    if (!config) {
      continue
    }

    const rows = await readRowsForTable(registration, config.referencedTable)
    row[columnName] = deserializeSqliteValue(rows[0]?._id ?? '') as SqlValue
  }

  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      value === null ? '' : formatDraftValue(value),
    ]),
  )
}

function formatDraftValue(value: unknown): string {
  if (typeof value === 'bigint') {
    return value.toString()
  }

  if (isBlobLike(value)) {
    return ''
  }

  return String(value)
}

function getTransactionalCollection(
  registration: SinkDevtoolsRegistrationRecord,
  tableName: string,
): SinkDevtoolsCollectionHandle {
  const collection = registration.collections?.[tableName]

  if (!collection) {
    throw new Error(
      'Generated Sink collections are required for this action. Upgrade @sink/lib and rerun sink generate.',
    )
  }

  if (!collection.utils.createSqliteTransaction) {
    throw new Error(`Table "${tableName}" does not expose a SQLite transaction helper.`)
  }

  return collection
}

async function updateCellForTable(
  registration: SinkDevtoolsRegistrationRecord,
  tableName: string,
  key: SerializedSqliteValue,
  columnName: string,
  value: string,
): Promise<void> {
  const collection = getTransactionalCollection(registration, tableName)
  const typedValue = await registration.database.coerceTableValue(
    tableName,
    columnName,
    value,
  )
  const transaction = collection.utils.createSqliteTransaction?.()

  if (!transaction) {
    throw new Error(`Table "${tableName}" cannot create SQLite transactions.`)
  }

  transaction.mutate(() => {
    collection.update(deserializeSqliteValue(key), (draft) => {
      draft[columnName] = typedValue as unknown
    })
  })

  await transaction.isPersisted.promise
}

async function insertDraftForTable(
  registration: SinkDevtoolsRegistrationRecord,
  tableName: string,
  draft: Record<string, string>,
): Promise<void> {
  const collection = getTransactionalCollection(registration, tableName)
  const rowEntries = await Promise.all(
    Object.entries(draft).map(async ([columnName, rawValue]) => [
      columnName,
      await registration.database.coerceTableValue(tableName, columnName, rawValue),
    ]),
  )
  const row = Object.fromEntries(rowEntries) as Record<string, unknown>
  const transaction = collection.utils.createSqliteTransaction?.()

  if (!transaction) {
    throw new Error(`Table "${tableName}" cannot create SQLite transactions.`)
  }

  transaction.mutate(() => {
    collection.insert(row)
  })

  await transaction.isPersisted.promise
}

async function runIndexedQueryForTable(
  registration: SinkDevtoolsRegistrationRecord,
  tableName: string,
  queryInput: SinkDevtoolsQueryInput,
): Promise<SinkDevtoolsRowRecord[]> {
  const collection = getTransactionalCollection(registration, tableName)

  let query = collection.query()

  if (queryInput.indexName) {
    query = query.withIndex(queryInput.indexName, (builder: any) => {
      let nextBuilder = builder

      for (const constraint of queryInput.constraints) {
        nextBuilder = nextBuilder[constraint.operator](
          constraint.field,
          parseQueryValue(constraint.value),
        )
      }

      return nextBuilder
    })
  }

  query = query.order(queryInput.orderDirection)

  let rows: Record<string, unknown>[]

  switch (queryInput.queryMethod) {
    case 'first': {
      const row = await query.first()
      rows = row ? [row] : []
      break
    }
    case 'unique': {
      const row = await query.unique()
      rows = row ? [row] : []
      break
    }
    case 'take':
      rows = await query.take(Number.parseInt(queryInput.takeCount, 10) || 10)
      break
    case 'collect':
    default:
      rows = await query.collect()
      break
  }

  return rows.map((row) => serializeRowRecord(row))
}

function postBridgeMessage(message: {
  type: 'enabled' | 'rpc-response' | 'change'
  response?: SinkDevtoolsRpcResponse
  event?: SinkDevtoolsChangeEvent
}): void {
  if (typeof window === 'undefined') {
    return
  }

  window.postMessage(
    {
      source: PAGE_BRIDGE_SOURCE,
      ...message,
    },
    '*',
  )
}

export function serializeSqliteValue(value: SqlValue): SerializedSqliteValue {
  if (value === null || typeof value === 'number' || typeof value === 'string') {
    return value
  }

  if (typeof value === 'bigint') {
    return {
      type: 'bigint',
      value: value.toString(),
    }
  }

  if (isBlobLike(value)) {
    const bytes = normalizeBlobBytes(value)

    return {
      type: 'blob',
      base64: toBase64(bytes),
      byteLength: bytes.byteLength,
    }
  }

  throw new Error(`Unsupported SQLite value for serialization: ${String(value)}`)
}

export function deserializeSqliteValue(value: SerializedSqliteValue): SqlValue {
  if (value === null || typeof value === 'number' || typeof value === 'string') {
    return value
  }

  if (value.type === 'bigint') {
    return BigInt(value.value)
  }

  return fromBase64(value.base64)
}

export function registerSinkDevtoolsDatabase(
  registration: SinkDevtoolsDatabaseRegistration,
): SinkDevtoolsDatabaseSummary {
  ensureSinkDevtoolsBridge()

  const schema: SinkDevtoolsSchemaMetadata = {
    tableNames: [...registration.tableNames],
    indexes: registration.INDEXES,
    referenceColumns: registration.REFERENCE_COLUMNS,
  }
  const existing = registrationsByDatabase.get(registration.database)

  if (existing) {
    existing.collections = registration.collections as
      | Record<string, SinkDevtoolsCollectionHandle>
      | undefined
    existing.summary.schema = schema
    existing.summary.supportsCollectionMutations = Boolean(registration.collections)
    return existing.summary
  }

  registrationCount += 1

  const summary = createDatabaseSummary(
    registration.database,
    schema,
    `Database ${registrationCount}`,
    Boolean(registration.collections),
  )
  const nextId = `sink-db-${registrationCount}`
  const record: SinkDevtoolsRegistrationRecord = {
    id: nextId,
    database: registration.database,
    collections: registration.collections as
      | Record<string, SinkDevtoolsCollectionHandle>
      | undefined,
    summary: {
      ...summary,
      id: nextId,
    },
  }

  registrations.set(nextId, record)
  registrationsByDatabase.set(registration.database, record)

  return record.summary
}

export function unregisterSinkDevtoolsDatabase(
  database: AsyncSqliteDatabase,
): void {
  const registration = registrationsByDatabase.get(database)

  if (!registration) {
    return
  }

  registrations.delete(registration.id)
  bridgeSubscriptions.delete(registration.id)
}

export function listRegisteredSinkDevtoolsDatabases(): SinkDevtoolsDatabaseSummary[] {
  return [...registrations.values()].map((registration) => registration.summary)
}

export function subscribeToSinkDevtoolsChanges(
  listener: (event: SinkDevtoolsChangeEvent) => void,
): () => void {
  changeListeners.add(listener)

  return () => {
    changeListeners.delete(listener)
  }
}

export function emitSinkDevtoolsChange(
  database: AsyncSqliteDatabase,
  event: Omit<SinkDevtoolsChangeEvent, 'databaseId' | 'timestamp'>,
): void {
  const registration = registrationsByDatabase.get(database)

  if (!registration) {
    return
  }

  const payload: SinkDevtoolsChangeEvent = {
    databaseId: registration.id,
    timestamp: Date.now(),
    ...event,
  }

  for (const listener of changeListeners) {
    listener(payload)
  }
}

export async function handleSinkDevtoolsRpcRequest(
  request: SinkDevtoolsRpcRequest,
): Promise<SinkDevtoolsRpcResponse> {
  try {
    switch (request.method) {
      case 'listDatabases':
        return {
          id: request.id,
          ok: true,
          result: listRegisteredSinkDevtoolsDatabases(),
        }

      case 'getExplorerSnapshot': {
        const registration = getRegistrationById(request.databaseId)
        const snapshot = await registration.database.inspectTables(request.limit ?? 100)

        return {
          id: request.id,
          ok: true,
          result: {
            version: registration.database.version,
            tables: snapshot.map((table) => serializeTableSnapshot(table)),
          },
        }
      }

      case 'getTableIndexes': {
        const registration = getRegistrationById(request.databaseId)
        return {
          id: request.id,
          ok: true,
          result: await registration.database.getTableIndexes(request.tableName),
        }
      }

      case 'readRows': {
        const registration = getRegistrationById(request.databaseId)
        return {
          id: request.id,
          ok: true,
          result: await readRowsForTable(registration, request.tableName),
        }
      }

      case 'getReferenceRows': {
        const registration = getRegistrationById(request.databaseId)
        return {
          id: request.id,
          ok: true,
          result: await readReferenceRowsForTable(registration, request.tableName),
        }
      }

      case 'createInsertDraft': {
        const registration = getRegistrationById(request.databaseId)
        return {
          id: request.id,
          ok: true,
          result: await createInsertDraftForTable(registration, request.tableName),
        }
      }

      case 'updateCell': {
        const registration = getRegistrationById(request.databaseId)
        await updateCellForTable(
          registration,
          request.tableName,
          request.key,
          request.columnName,
          request.value,
        )
        return {
          id: request.id,
          ok: true,
          result: null,
        }
      }

      case 'insertDraft': {
        const registration = getRegistrationById(request.databaseId)
        await insertDraftForTable(registration, request.tableName, request.draft)
        return {
          id: request.id,
          ok: true,
          result: null,
        }
      }

      case 'runIndexedQuery': {
        const registration = getRegistrationById(request.databaseId)
        return {
          id: request.id,
          ok: true,
          result: await runIndexedQueryForTable(
            registration,
            request.tableName,
            request.query,
          ),
        }
      }

      case 'subscribeChanges':
        bridgeSubscriptions.add(request.databaseId)
        return {
          id: request.id,
          ok: true,
          result: null,
        }

      case 'unsubscribeChanges':
        bridgeSubscriptions.delete(request.databaseId)
        return {
          id: request.id,
          ok: true,
          result: null,
        }
    }
  } catch (error) {
    return {
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown Sink devtools error.',
    }
  }
}

export function ensureSinkDevtoolsBridge(): void {
  if (bridgeInstalled || typeof window === 'undefined') {
    return
  }

  bridgeInstalled = true

  subscribeToSinkDevtoolsChanges((event) => {
    if (!bridgeEnabled) {
      return
    }

    if (
      bridgeSubscriptions.size > 0 &&
      !bridgeSubscriptions.has(event.databaseId)
    ) {
      return
    }

    postBridgeMessage({
      type: 'change',
      event,
    })
  })

  window.addEventListener('message', (event) => {
    if (event.source !== window) {
      return
    }

    const data = event.data as {
      source?: string
      type?: 'enable' | 'rpc-request'
      request?: SinkDevtoolsRpcRequest
    }

    if (data.source !== CONTENT_BRIDGE_SOURCE) {
      return
    }

    if (data.type === 'enable') {
      bridgeEnabled = true
      postBridgeMessage({ type: 'enabled' })
      return
    }

    if (data.type !== 'rpc-request' || !data.request) {
      return
    }

    void handleSinkDevtoolsRpcRequest(data.request).then((response) => {
      postBridgeMessage({
        type: 'rpc-response',
        response,
      })
    })
  })
}

export const __internalSinkDevtools = {
  CONTENT_BRIDGE_SOURCE,
  PAGE_BRIDGE_SOURCE,
  emitSinkDevtoolsChange,
  ensureSinkDevtoolsBridge,
  fromBase64,
  handleSinkDevtoolsRpcRequest,
  listRegisteredSinkDevtoolsDatabases,
  unregisterSinkDevtoolsDatabase,
  serializeSqliteValue,
  deserializeSqliteValue,
  subscribeToSinkDevtoolsChanges,
  resetForTests() {
    bridgeEnabled = false
    bridgeInstalled = false
    bridgeSubscriptions.clear()
    changeListeners.clear()
    registrations.clear()
    registrationCount = 0
  },
}
