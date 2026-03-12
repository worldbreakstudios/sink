import type {
  SqliteTableSnapshot,
  SqliteTableColumn,
  SqliteIndexSnapshot,
  SqliteRow,
  SqlValue,
  PersistenceType,
} from '@sink/lib'

// Database info for discovery
export interface DatabaseInfo {
  name: string
  version: string
  persistenceType: PersistenceType
}

// Messages from Panel to Page
export type PanelToPageMessage =
  | { type: 'DISCOVER_DATABASES' }
  | { type: 'INSPECT_TABLES'; databaseName: string; limit?: number }
  | { type: 'GET_TABLE_COLUMNS'; databaseName: string; tableName: string }
  | { type: 'GET_TABLE_INDEXES'; databaseName: string; tableName: string }
  | { type: 'EXECUTE_QUERY'; databaseName: string; sql: string; bind?: SqlValue[] }
  | { type: 'UPDATE_CELL'; databaseName: string; tableName: string; rowId: number; columnName: string; value: string }
  | { type: 'INSERT_ROW'; databaseName: string; tableName: string }
  | { type: 'DELETE_ROWS'; databaseName: string; tableName: string; rowIds: number[] }
  | { type: 'COERCE_VALUE'; databaseName: string; tableName: string; columnName: string; rawValue: string }
  | { type: 'CREATE_INSERTABLE_ROW'; databaseName: string; tableName: string }

// Messages from Page to Panel
export type PageToPanelMessage =
  | { type: 'DATABASES_LIST'; databases: DatabaseInfo[] }
  | { type: 'TABLES_SNAPSHOT'; tables: SqliteTableSnapshot[] }
  | { type: 'TABLE_COLUMNS'; columns: SqliteTableColumn[] }
  | { type: 'TABLE_INDEXES'; indexes: SqliteIndexSnapshot[] }
  | { type: 'QUERY_RESULT'; rows: SqliteRow[] }
  | { type: 'MUTATION_SUCCESS' }
  | { type: 'COERCED_VALUE'; value: SqlValue }
  | { type: 'INSERTABLE_ROW'; row: SqliteRow }
  | { type: 'ERROR'; message: string; originalType: string }

// Wrapper messages with source identification
export interface PanelMessage {
  source: 'SINK_DEVTOOLS_PANEL'
  requestId: string
  payload: PanelToPageMessage
}

export interface PageMessage {
  source: 'SINK_DEVTOOLS_PAGE'
  requestId: string
  payload: PageToPanelMessage
}

// Content script relay messages
export interface ContentScriptMessage {
  type: 'SINK_DEVTOOLS_RELAY'
  direction: 'to_page' | 'to_panel'
  requestId: string
  payload: PanelToPageMessage | PageToPanelMessage
}
