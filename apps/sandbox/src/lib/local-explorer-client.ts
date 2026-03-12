import {
  __internalSinkDevtools,
  unregisterSinkDevtoolsDatabase,
  type SinkDevtoolsChangeEvent,
  type SinkDevtoolsRpcRequest,
  type SinkDevtoolsRpcRequestInput,
} from '@sink/lib'
import type { ExplorerClient } from '@sink/devtools-ui'
import { createSqliteDemoCollectionsWorkspace } from './sqlite-demo-collections'

interface LocalExplorerClientHandle {
  client: ExplorerClient
  close: () => Promise<void>
}

let rpcCounter = 0

function nextRequestId(): string {
  rpcCounter += 1
  return `local-sink-devtools-${rpcCounter}`
}

async function invoke<TResult>(
  request: SinkDevtoolsRpcRequestInput,
): Promise<TResult> {
  const response = await __internalSinkDevtools.handleSinkDevtoolsRpcRequest({
    ...request,
    id: nextRequestId(),
  } as SinkDevtoolsRpcRequest)

  if (!response.ok) {
    throw new Error(response.error)
  }

  return response.result as TResult
}

export async function createLocalExplorerClient(): Promise<LocalExplorerClientHandle> {
  const workspace = await createSqliteDemoCollectionsWorkspace()

  const client: ExplorerClient = {
    listDatabases() {
      return invoke({ method: 'listDatabases' })
    },
    getExplorerSnapshot(databaseId, limit) {
      return invoke({ method: 'getExplorerSnapshot', databaseId, limit })
    },
    getTableIndexes(databaseId, tableName) {
      return invoke({ method: 'getTableIndexes', databaseId, tableName })
    },
    readRows(databaseId, tableName) {
      return invoke({ method: 'readRows', databaseId, tableName })
    },
    getReferenceRows(databaseId, tableName) {
      return invoke({ method: 'getReferenceRows', databaseId, tableName })
    },
    createInsertDraft(databaseId, tableName) {
      return invoke({ method: 'createInsertDraft', databaseId, tableName })
    },
    updateCell(databaseId, tableName, key, columnName, value) {
      return invoke({
        method: 'updateCell',
        databaseId,
        tableName,
        key,
        columnName,
        value,
      }).then(() => undefined)
    },
    insertDraft(databaseId, tableName, draft) {
      return invoke({
        method: 'insertDraft',
        databaseId,
        tableName,
        draft,
      }).then(() => undefined)
    },
    runIndexedQuery(databaseId, tableName, query) {
      return invoke({
        method: 'runIndexedQuery',
        databaseId,
        tableName,
        query,
      })
    },
    subscribeChanges(databaseId, onChange) {
      const unsubscribe = __internalSinkDevtools.subscribeToSinkDevtoolsChanges(
        (event: SinkDevtoolsChangeEvent) => {
          if (event.databaseId === databaseId) {
            onChange(event)
          }
        },
      )

      return unsubscribe
    },
  }

  return {
    client,
    async close() {
      unregisterSinkDevtoolsDatabase(workspace.database)
      await workspace.close()
    },
  }
}
