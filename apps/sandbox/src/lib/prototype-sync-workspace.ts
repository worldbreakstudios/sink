import { createPrototypeSyncClient, type PrototypeSyncClient } from '@/data/prototype/client'
import type { SqliteDemoCollectionsWorkspace } from './sqlite-demo-collections'
import { createSqliteDemoCollectionsWorkspace } from './sqlite-demo-collections'

export interface PrototypeSyncWorkspace {
  base: SqliteDemoCollectionsWorkspace
  syncClient: PrototypeSyncClient
  close(): Promise<void>
}

export async function createPrototypeSyncWorkspace(): Promise<PrototypeSyncWorkspace> {
  const base = await createSqliteDemoCollectionsWorkspace()
  const serverBaseUrl = resolvePrototypeServerUrl()
  const websocketUrl = resolvePrototypeWebSocketUrl(serverBaseUrl)
  const syncClient = createPrototypeSyncClient({
    database: base.database,
    collections: base.collections,
    serverBaseUrl,
    websocketUrl,
  })

  return {
    base,
    syncClient,
    async close() {
      syncClient.stop()
      await base.close()
    },
  }
}

export function resolvePrototypeServerUrl(): string {
  return import.meta.env.VITE_SINK_SERVER_URL?.trim() || 'http://127.0.0.1:3001'
}

function resolvePrototypeWebSocketUrl(serverBaseUrl: string): string {
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
