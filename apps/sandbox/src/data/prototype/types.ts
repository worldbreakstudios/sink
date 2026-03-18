import type { AsyncSqliteDatabase } from '@sink/lib'
import {
  createBatchTransaction,
} from '../generated/schema.gen.ts'
import type {
  AnyKey,
  AnyRow,
  FieldKey,
  FieldRow,
  Id,
  ObjectKey,
  ObjectRow,
  ObjectTypeRow,
  SchemaCollections,
  TableName,
} from '../generated/schema.gen.ts'

export type PrototypeTableName = 'objects' | 'fields' | 'objectTypes'
export type PrototypeRow = ObjectRow | FieldRow | ObjectTypeRow
export type PrototypeKey = ObjectKey | FieldKey | Id<'objectTypes'>
export type PrototypeBatchTransaction = ReturnType<typeof createBatchTransaction>

export interface LockTarget {
  tableName: PrototypeTableName
  kind: 'primary' | 'unique'
  keyName: string
  values: Record<string, string>
}

export interface InvalidationTarget {
  tableName: PrototypeTableName
  keys: PrototypeKey[]
}

export interface QueryLocalContext {
  database: AsyncSqliteDatabase
  collections: SchemaCollections
  createBatchTransaction: typeof createBatchTransaction
  getProtectedRowKeys: (tableName: PrototypeTableName) => Promise<Set<string>>
}

export interface QueryExecutionContext {
  serverBaseUrl: string
}

export interface MutationLocalContext extends QueryLocalContext {
  transaction: PrototypeBatchTransaction
}

export interface MutationServerContext {
  repo: RepositoryContext
  force: boolean
}

export interface PrototypeActorsRepository {
  exists(actorId: Id<'actors'>): Promise<boolean>
}

export interface PrototypeObjectTypesRepository {
  listAll(): Promise<ObjectTypeRow[]>
  getById(objectTypeId: Id<'objectTypes'>): Promise<ObjectTypeRow | null>
  rename(objectTypeId: Id<'objectTypes'>, name: string): Promise<ObjectTypeRow>
}

export interface PrototypeObjectsRepository {
  listByActor(actorId: Id<'actors'>): Promise<ObjectRow[]>
  getById(key: ObjectKey): Promise<ObjectRow | null>
  create(row: ObjectRow): Promise<ObjectRow>
  changeType(
    key: ObjectKey,
    nextTypeId: Id<'objectTypes'>,
  ): Promise<ObjectRow>
}

export interface PrototypeFieldsRepository {
  listByObject(args: {
    actorId: Id<'actors'>
    objectId: Id<'objects'>
  }): Promise<FieldRow[]>
  getByObjectFieldType(args: {
    actorId: Id<'actors'>
    objectId: Id<'objects'>
    fieldTypeId: Id<'fieldTypes'>
  }): Promise<FieldRow | null>
  upsertByObjectFieldType(row: FieldRow): Promise<{
    field: FieldRow
    mode: 'inserted' | 'updated'
  }>
}

export interface RepositoryContext {
  actors: PrototypeActorsRepository
  objectTypes: PrototypeObjectTypesRepository
  objects: PrototypeObjectsRepository
  fields: PrototypeFieldsRepository
}

export interface LockStoreAcquireResult {
  acquired: boolean
  busyTargets: LockTarget[]
}

export interface LockStore {
  acquire(
    transactionId: string,
    clientId: string,
    targets: LockTarget[],
    expiresAt: number,
  ): Promise<LockStoreAcquireResult>
  release(transactionId: string): Promise<void>
  cleanupExpired(now: number): Promise<void>
}

export interface QueryDefinition<TArgs, TResult> {
  readonly kind: 'query'
  readonly name: string
  readonly tables: readonly PrototypeTableName[]
  readLocal(context: QueryLocalContext, args: TArgs): Promise<TResult>
  runServer(context: MutationServerContext, args: TArgs): Promise<TResult>
  mergeServer(context: QueryLocalContext, args: TArgs, result: TResult): Promise<void>
  matchesInvalidation(args: TArgs, targets: InvalidationTarget[]): boolean
}

export interface MutationDefinition<TArgs, TLocalResult, TServerResult> {
  readonly kind: 'mutation'
  readonly name: string
  lockTargets(args: TArgs): LockTarget[]
  applyLocal(context: MutationLocalContext, args: TArgs): Promise<TLocalResult>
  runServer(
    context: MutationServerContext,
    args: TArgs,
  ): Promise<TServerResult>
  resultsEqual(localResult: TLocalResult, serverResult: TServerResult): boolean
  invalidate(
    args: TArgs,
    result: TLocalResult | TServerResult,
  ): InvalidationTarget[]
}

export interface OfflineQueueEntry<TArgs = unknown, TResult = unknown> {
  queueId: number
  mutationName: string
  args: TArgs
  localResult: TResult
  lockTargets: LockTarget[]
  invalidations: InvalidationTarget[]
  status: 'pending' | 'conflict'
  createdAt: number
  updatedAt: number
  conflict: OfflineConflictPayload<TResult> | null
}

export interface ActiveTransactionRecord<TResult = unknown, TArgs = unknown> {
  transactionId: string
  mutationName: string
  args: TArgs
  localResult: TResult
  lockTargets: LockTarget[]
  invalidations: InvalidationTarget[]
  createdAt: number
  updatedAt: number
}

export interface OfflineConflictPayload<TResult = unknown> {
  localResult: TResult
  serverResult: TResult
  message: string
}

export type PrototypeClientMessage =
  | {
    type: 'txn_open'
    clientId: string
    transactionId: string
    mutationName: string
    args: unknown
    lockTargets: LockTarget[]
  }
  | {
    type: 'txn_commit'
    clientId: string
    transactionId: string
    mutationName: string
    args: unknown
    localResult: unknown
    force: boolean
  }
  | {
    type: 'txn_abort'
    clientId: string
    transactionId: string
  }
  | {
    type: 'txn_status'
    clientId: string
    transactionId: string
  }

export type PrototypeServerMessage =
  | {
    type: 'txn_opened'
    transactionId: string
    expiresAt: number
  }
  | {
    type: 'txn_open_denied'
    transactionId: string
    busyTargets: LockTarget[]
  }
  | {
    type: 'txn_committed'
    transactionId: string
    serverResult: unknown
    invalidations: InvalidationTarget[]
  }
  | {
    type: 'txn_conflict'
    transactionId: string
    serverResult: unknown
    invalidations: InvalidationTarget[]
    message: string
  }
  | {
    type: 'txn_status_result'
    transactionId: string
    status: 'opened' | 'committed' | 'conflict' | 'aborted' | 'missing'
    serverResult: unknown | null
    invalidations: InvalidationTarget[]
    message: string | null
  }
  | {
    type: 'rows_invalidated'
    invalidations: InvalidationTarget[]
  }
  | {
    type: 'error'
    transactionId: string | null
    message: string
  }

export interface QueryHttpRequest {
  queryName: string
  args: unknown
}

export interface QueryHttpResponse {
  result: unknown
}

export interface ServerTransactionRecord {
  transactionId: string
  clientId: string
  mutationName: string
  args: unknown
  localResult: unknown | null
  serverResult: unknown | null
  invalidations: InvalidationTarget[]
  lockTargets: LockTarget[]
  status: 'opened' | 'committed' | 'conflict' | 'aborted'
  expiresAt: number
  createdAt: number
  updatedAt: number
}

export interface PrototypeSyncSnapshot {
  connection: 'stopped' | 'connecting' | 'connected' | 'disconnected'
  activeTransactions: number
  offlineQueue: number
  conflicts: OfflineQueueEntry[]
  lastError: string | null
  lastInvalidationAt: number | null
}

export type MutablePrototypeCollection = {
  insert(row: AnyRow): void
  update(key: AnyKey, updater: (draft: Record<string, unknown>) => void): void
  delete(key: AnyKey): void
  utils: {
    readAll(): Promise<AnyRow[]>
  }
}

export interface PrototypeQuerySubscription<TArgs> {
  key: string
  definition: QueryDefinition<TArgs, unknown>
  args: TArgs
}

export interface PrototypeSocketLike {
  readonly readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  addEventListener(
    type: 'open' | 'close' | 'error' | 'message',
    listener: (event: any) => void,
  ): void
  removeEventListener(
    type: 'open' | 'close' | 'error' | 'message',
    listener: (event: any) => void,
  ): void
}

export interface PrototypeSocketServerLike {
  readonly OPEN: number
}

export interface PrototypeWebSocketConnectionLike {
  readonly readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  on(event: 'message', listener: (data: unknown) => void): void
  on(event: 'close', listener: () => void): void
}

export interface PrototypeServerConnectionPool {
  readonly OPEN: number
  on(
    event: 'connection',
    listener: (socket: PrototypeWebSocketConnectionLike) => void,
  ): void
}

export interface PrototypeServerBackend {
  repo: RepositoryContext
  lockStore: LockStore
  runInTransaction<TValue>(
    callback: (context: MutationServerContext) => Promise<TValue>,
    options?: { force?: boolean },
  ): Promise<TValue>
}

export type QueryRegistry = Record<string, QueryDefinition<any, any>>
export type MutationRegistry = Record<string, MutationDefinition<any, any, any>>

export type QueryRowTableName = Extract<TableName, PrototypeTableName>
