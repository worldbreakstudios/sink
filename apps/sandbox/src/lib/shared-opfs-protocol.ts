import type {
  SqliteKey,
  SqliteIndexSnapshot,
  SqliteRow,
  SqliteTableColumn,
  SqliteTableSnapshot,
} from '@sink/lib'
import type { SqlValue } from '@sqlite.org/sqlite-wasm'

export type SharedSqliteMethod =
  | 'execute'
  | 'query'
  | 'getTableColumns'
  | 'getTableIndexes'
  | 'rowExists'
  | 'coerceTableValue'
  | 'createInsertableRow'
  | 'inspectTables'
  | 'close'

export interface SharedSqliteMethodArgs {
  execute: [sql: string, bind?: SqlValue[]]
  query: [sql: string, bind?: SqlValue[]]
  getTableColumns: [tableName: string]
  getTableIndexes: [tableName: string]
  rowExists: [tableName: string, key: SqliteKey, keyColumns?: readonly string[]]
  coerceTableValue: [tableName: string, columnName: string, rawValue: string]
  createInsertableRow: [tableName: string]
  inspectTables: [limit?: number]
  close: []
}

export interface SharedSqliteMethodResult {
  execute: null
  query: Array<Record<string, unknown>>
  getTableColumns: SqliteTableColumn[]
  getTableIndexes: SqliteIndexSnapshot[]
  rowExists: boolean
  coerceTableValue: SqlValue
  createInsertableRow: SqliteRow
  inspectTables: SqliteTableSnapshot[]
  close: null
}

export interface SerializedWorkerError {
  name: string
  message: string
  stack?: string
}

export type DedicatedWorkerRequest =
  | {
    type: 'open'
    requestId: string
    filename: string
  }
  | {
    type: 'close'
    requestId: string
  }
  | {
    type: 'call'
    requestId: string
    method: SharedSqliteMethod
    args: SharedSqliteMethodArgs[SharedSqliteMethod]
  }

export type DedicatedWorkerResponse =
  | {
    type: 'response'
    requestId: string
    ok: true
    result: unknown
  }
  | {
    type: 'response'
    requestId: string
    ok: false
    error: SerializedWorkerError
  }

export type CoordinatorClientMessage =
  | {
    type: 'register'
    tabId: string
  }
  | {
    type: 'unregister'
    tabId: string
  }
  | {
    type: 'heartbeat'
    tabId: string
    sentAt: number
  }
  | {
    type: 'active-ready'
    tabId: string
  }
  | {
    type: 'active-failed'
    tabId: string
    error: SerializedWorkerError
  }
  | {
    type: 'db-request'
    tabId: string
    requestId: string
    method: SharedSqliteMethod
    args: SharedSqliteMethodArgs[SharedSqliteMethod]
  }
  | {
    type: 'db-response'
    executorTabId: string
    requesterTabId: string
    requestId: string
    ok: true
    result: unknown
  }
  | {
    type: 'db-response'
    executorTabId: string
    requesterTabId: string
    requestId: string
    ok: false
    error: SerializedWorkerError
  }

export type CoordinatorServerMessage =
  | {
    type: 'role'
    tabId: string
    isActive: boolean
  }
  | {
    type: 'execute-request'
    requesterTabId: string
    requestId: string
    method: SharedSqliteMethod
    args: SharedSqliteMethodArgs[SharedSqliteMethod]
  }
  | {
    type: 'db-result'
    requestId: string
    ok: true
    result: unknown
  }
  | {
    type: 'db-result'
    requestId: string
    ok: false
    error: SerializedWorkerError
  }

export function serializeWorkerError(error: unknown): SerializedWorkerError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    }
  }

  return {
    name: 'Error',
    message: String(error),
  }
}
