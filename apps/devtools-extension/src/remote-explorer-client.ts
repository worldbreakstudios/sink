import type {
  SerializedSqliteValue,
  SinkDevtoolsChangeEvent,
  SinkDevtoolsDatabaseSummary,
  SinkDevtoolsExplorerSnapshot,
  SinkDevtoolsQueryInput,
  SinkDevtoolsRowRecord,
  SinkDevtoolsRpcRequest,
  SinkDevtoolsRpcResponse,
  SqliteIndexSnapshot,
  SinkDevtoolsRpcRequestInput,
} from '@sink/lib'
import type { ExplorerClient } from '@sink/devtools-ui'

interface RuntimeUnavailableError extends Error {
  code: 'runtime_unavailable'
}

function createRuntimeUnavailableError(message: string): RuntimeUnavailableError {
  const error = new Error(message) as RuntimeUnavailableError
  error.code = 'runtime_unavailable'
  return error
}

export class RemoteExplorerClient implements ExplorerClient {
  readonly #tabId: number
  readonly #port: chrome.runtime.Port
  readonly #pending = new Map<
    string,
    {
      resolve: (value: unknown) => void
      reject: (error: Error) => void
      timeoutId: number
    }
  >()
  readonly #listeners = new Set<(event: SinkDevtoolsChangeEvent) => void>()

  private constructor(tabId: number, port: chrome.runtime.Port) {
    this.#tabId = tabId
    this.#port = port

    port.onMessage.addListener((message: {
      type?: 'panel-ready' | 'rpc-response' | 'change'
      ready?: boolean
      response?: SinkDevtoolsRpcResponse
      event?: SinkDevtoolsChangeEvent
    }) => {
      if (message.type === 'rpc-response' && message.response) {
        const pending = this.#pending.get(message.response.id)
        if (!pending) {
          return
        }

        this.#pending.delete(message.response.id)
        clearTimeout(pending.timeoutId)

        if (!message.response.ok) {
          pending.reject(new Error(message.response.error))
          return
        }

        pending.resolve(message.response.result)
        return
      }

      if (message.type === 'change' && message.event) {
        for (const listener of this.#listeners) {
          listener(message.event)
        }
      }
    })
  }

  static async connect(tabId: number): Promise<RemoteExplorerClient> {
    const port = chrome.runtime.connect({ name: 'sink-devtools-panel' })
    const ready = await new Promise<boolean>((resolve) => {
      const handleMessage = (message: {
        type?: 'panel-ready'
        tabId?: number
        ready?: boolean
      }) => {
        if (message.type !== 'panel-ready' || message.tabId !== tabId) {
          return
        }

        port.onMessage.removeListener(handleMessage)
        resolve(Boolean(message.ready))
      }

      port.onMessage.addListener(handleMessage)
      port.postMessage({
        type: 'panel-init',
        tabId,
      })
    })

    if (!ready) {
      port.disconnect()
      throw createRuntimeUnavailableError(
        'Content script injection failed for the inspected tab.',
      )
    }

    const client = new RemoteExplorerClient(tabId, port)
    port.postMessage({ type: 'panel-enable', tabId })
    return client
  }

  async listDatabases(): Promise<SinkDevtoolsDatabaseSummary[]> {
    return this.#callRpc({
      method: 'listDatabases',
    })
  }

  async getExplorerSnapshot(
    databaseId: string,
    limit?: number,
  ): Promise<SinkDevtoolsExplorerSnapshot> {
    return this.#callRpc({
      method: 'getExplorerSnapshot',
      databaseId,
      limit,
    })
  }

  async getTableIndexes(
    databaseId: string,
    tableName: string,
  ): Promise<SqliteIndexSnapshot[]> {
    return this.#callRpc({
      method: 'getTableIndexes',
      databaseId,
      tableName,
    })
  }

  async readRows(
    databaseId: string,
    tableName: string,
  ): Promise<SinkDevtoolsRowRecord[]> {
    return this.#callRpc({
      method: 'readRows',
      databaseId,
      tableName,
    })
  }

  async getReferenceRows(
    databaseId: string,
    tableName: string,
  ): Promise<Record<string, SinkDevtoolsRowRecord[]>> {
    return this.#callRpc({
      method: 'getReferenceRows',
      databaseId,
      tableName,
    })
  }

  async createInsertDraft(
    databaseId: string,
    tableName: string,
  ): Promise<Record<string, string>> {
    return this.#callRpc({
      method: 'createInsertDraft',
      databaseId,
      tableName,
    })
  }

  async updateCell(
    databaseId: string,
    tableName: string,
    key: SerializedSqliteValue,
    columnName: string,
    value: string,
  ): Promise<void> {
    await this.#callRpc({
      method: 'updateCell',
      databaseId,
      tableName,
      key,
      columnName,
      value,
    })
  }

  async insertDraft(
    databaseId: string,
    tableName: string,
    draft: Record<string, string>,
  ): Promise<void> {
    await this.#callRpc({
      method: 'insertDraft',
      databaseId,
      tableName,
      draft,
    })
  }

  async runIndexedQuery(
    databaseId: string,
    tableName: string,
    query: SinkDevtoolsQueryInput,
  ): Promise<SinkDevtoolsRowRecord[]> {
    return this.#callRpc({
      method: 'runIndexedQuery',
      databaseId,
      tableName,
      query,
    })
  }

  subscribeChanges(
    databaseId: string,
    onChange: (event: SinkDevtoolsChangeEvent) => void,
  ): () => void {
    this.#listeners.add(onChange)
    void this.#callRpc({
      method: 'subscribeChanges',
      databaseId,
    })

    return () => {
      this.#listeners.delete(onChange)
      void this.#callRpc({
        method: 'unsubscribeChanges',
        databaseId,
      })
    }
  }

  dispose(): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeoutId)
      pending.reject(createRuntimeUnavailableError('Sink devtools panel disconnected.'))
    }

    this.#pending.clear()
    this.#listeners.clear()
    this.#port.disconnect()
  }

  async #callRpc<TResult>(
    request: SinkDevtoolsRpcRequestInput,
  ): Promise<TResult> {
    const rpcRequest: SinkDevtoolsRpcRequest = {
      ...request,
      id: `${this.#tabId}-${crypto.randomUUID()}`,
    } as SinkDevtoolsRpcRequest

    return new Promise<TResult>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        this.#pending.delete(rpcRequest.id)
        reject(
          createRuntimeUnavailableError(
            'Sink runtime not found on the inspected page.',
          ),
        )
      }, 1200)

      this.#pending.set(rpcRequest.id, {
        resolve: (value) => resolve(value as TResult),
        reject,
        timeoutId,
      })

      this.#port.postMessage({
        type: 'panel-rpc',
        tabId: this.#tabId,
        request: rpcRequest,
      })
    })
  }
}
