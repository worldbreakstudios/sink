import type {
  SerializedSqliteValue,
  SinkDevtoolsChangeEvent,
  SinkDevtoolsDatabaseSummary,
  SinkDevtoolsExplorerSnapshot,
  SinkDevtoolsQueryInput,
  SinkDevtoolsRowRecord,
  SqliteIndexSnapshot,
} from '@sink/lib'

export interface ExplorerClient {
  listDatabases(): Promise<SinkDevtoolsDatabaseSummary[]>
  getExplorerSnapshot(
    databaseId: string,
    limit?: number,
  ): Promise<SinkDevtoolsExplorerSnapshot>
  getTableIndexes(
    databaseId: string,
    tableName: string,
  ): Promise<SqliteIndexSnapshot[]>
  readRows(databaseId: string, tableName: string): Promise<SinkDevtoolsRowRecord[]>
  getReferenceRows(
    databaseId: string,
    tableName: string,
  ): Promise<Record<string, SinkDevtoolsRowRecord[]>>
  createInsertDraft(
    databaseId: string,
    tableName: string,
  ): Promise<Record<string, string>>
  updateCell(
    databaseId: string,
    tableName: string,
    key: SerializedSqliteValue,
    columnName: string,
    value: string,
  ): Promise<void>
  insertDraft(
    databaseId: string,
    tableName: string,
    draft: Record<string, string>,
  ): Promise<void>
  runIndexedQuery(
    databaseId: string,
    tableName: string,
    query: SinkDevtoolsQueryInput,
  ): Promise<SinkDevtoolsRowRecord[]>
  subscribeChanges(
    databaseId: string,
    onChange: (event: SinkDevtoolsChangeEvent) => void,
  ): Promise<() => void> | (() => void)
}

export interface SinkExplorerEmptyState {
  title: string
  description: string
  actionLabel?: string
  onAction?: () => void | Promise<void>
}
