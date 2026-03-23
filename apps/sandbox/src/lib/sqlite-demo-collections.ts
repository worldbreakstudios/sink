import type {
  GeneratedBrowserWorkspace,
} from '@sink/lib'
import {
  clearSharedOpfsDatabase,
  createGeneratedBrowserWorkspace,
  createSharedOpfsDatabase,
  formatGeneratedWorkspaceKey,
  getGeneratedWorkspaceRowKey,
  serializeGeneratedWorkspaceKey,
} from '@sink/lib'
import {
  SYNC_METADATA,
  createGeneratedSyncClient,
  generatedMutations,
  generatedQueries,
} from '@/data/generated/operations.gen'
import {
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
import { ensureSandboxSeedData } from './sandbox-seed-data'

export type SqliteDemoRow = AnyRow
export type SqliteDemoId = AnyKey
export type SqliteDemoTableName = TableName
export type SqliteInsertDraft = Record<string, string>
export type SqliteDemoKeyByTable = KeyByTable
export type SqliteDemoCollectionsWorkspace = GeneratedBrowserWorkspace<
  SchemaCollections,
  SqliteDemoRow,
  SqliteDemoId,
  SqliteDemoTableName
>

export const SQLITE_DEMO_LOCAL_DB_FILENAME = 'sqlite-demo-actors.db'

export function getSqliteDemoRowKey<TTableName extends SqliteDemoTableName>(
  tableName: TTableName,
  row: SqliteDemoRow,
): SqliteDemoKeyByTable[TTableName] {
  return getGeneratedWorkspaceRowKey(
    SYNC_METADATA,
    tableName,
    row,
  ) as SqliteDemoKeyByTable[TTableName]
}

export function serializeSqliteDemoKey(
  tableName: SqliteDemoTableName,
  key: SqliteDemoId,
): string {
  return serializeGeneratedWorkspaceKey(SYNC_METADATA, tableName, key)
}

export function formatSqliteDemoKey(
  tableName: SqliteDemoTableName,
  key: SqliteDemoId,
): string {
  return formatGeneratedWorkspaceKey(SYNC_METADATA, tableName, key)
}

function resolveSqliteDemoWebSocketUrl(serverBaseUrl: string): string {
  const explicit = import.meta.env.VITE_SINK_TX_WS_URL?.trim()

  if (explicit) {
    return explicit
  }

  const url = new URL(serverBaseUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = '/ws/transactions'
  url.search = ''
  url.hash = ''
  return url.toString()
}

export function resolveSqliteDemoServerUrl(): string {
  return import.meta.env.VITE_SINK_SERVER_URL?.trim() || 'http://127.0.0.1:3001'
}

export async function createSqliteDemoCollectionsWorkspace(): Promise<SqliteDemoCollectionsWorkspace> {
  const serverBaseUrl = resolveSqliteDemoServerUrl()

  return createGeneratedBrowserWorkspace({
    metadata: SYNC_METADATA,
    createDatabase: () =>
      createSharedOpfsDatabase({
        filename: SQLITE_DEMO_LOCAL_DB_FILENAME,
      }),
    createAllTables,
    seedLocal: ensureSandboxSeedData,
    createCollections,
    createBatchTransaction,
    createSyncClient: ({
      database,
      collections,
      createBatchTransaction: createSyncBatchTransaction,
      serverBaseUrl: syncServerBaseUrl,
      websocketUrl,
    }) =>
      createGeneratedSyncClient({
        database,
        collections,
        createBatchTransaction: createSyncBatchTransaction,
        serverBaseUrl: syncServerBaseUrl,
        websocketUrl,
      }),
    queries: generatedQueries,
    mutations: generatedMutations,
    serverBaseUrl,
    websocketUrl: resolveSqliteDemoWebSocketUrl(serverBaseUrl),
  })
}

export async function hardClearSqliteDemoLocalDatabase(): Promise<void> {
  await clearSharedOpfsDatabase({
    filename: SQLITE_DEMO_LOCAL_DB_FILENAME,
  })
}
