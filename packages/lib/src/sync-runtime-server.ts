import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from 'node:http'
import type {
  QueryHttpRequest,
  SyncOperationRegistry,
  SyncServerAdapter,
  SyncServerMessage,
} from './sync-runtime-types.js'
import {
  ensureSyncServerStateTables,
  insertOpenedServerTransaction,
  markExpiredServerTransactions,
  readServerTransaction,
  updateServerTransaction,
} from './sync-runtime-server-state.js'
import { parseSyncPayload, serializeSyncPayload } from './sync-runtime-json.js'
import type { AsyncSqliteDatabase } from './sqlite.js'

const DEFAULT_WEBSOCKET_PATH = '/ws/transactions'
const DEFAULT_QUERY_PATH = '/api/query'
const LOCK_LEASE_MS = 15_000

export interface CreateSyncServerRuntimeOptions<TAuthContext = unknown> {
  database: AsyncSqliteDatabase
  adapter: SyncServerAdapter<TAuthContext>
  registry: SyncOperationRegistry<TAuthContext>
  metadata: import('./sync-runtime-types.js').SyncSchemaMetadata
  port: number
  hostname?: string
  websocketPath?: string
  queryPath?: string
  getAuthContext?: (request: IncomingMessage) => Promise<TAuthContext> | TAuthContext
  handleHttpRequest?: (
    request: IncomingMessage,
    response: ServerResponse,
  ) => Promise<boolean> | boolean
  onError?: (error: unknown) => void
}

export interface SyncServerRuntime {
  readonly httpServer: HttpServer
  close(): Promise<void>
}

export async function createSyncServerRuntime<TAuthContext = unknown>(
  options: CreateSyncServerRuntimeOptions<TAuthContext>,
): Promise<SyncServerRuntime> {
  await ensureSyncServerStateTables(options.database)
  const sockets = new Set<ServerSocketLike>()
  const webSocketModule = await loadWebSocketModule()
  const WebSocketServer = webSocketModule.WebSocketServer
  const WebSocket = webSocketModule.WebSocket
  const websocketPath = options.websocketPath ?? DEFAULT_WEBSOCKET_PATH
  const queryPath = options.queryPath ?? DEFAULT_QUERY_PATH

  const httpServer = createServer((request, response) => {
    void handleHttpRequest(request, response).catch((error) => {
      options.onError?.(error)
      writeJson(response, 500, {
        error: error instanceof Error ? error.message : String(error),
      })
    })
  })
  const webSocketServer = new WebSocketServer({ noServer: true })

  httpServer.on('upgrade', (request, socket, head) => {
    if (request.url !== websocketPath) {
      socket.destroy()
      return
    }

    webSocketServer.handleUpgrade(request, socket, head, (connection: ServerSocketLike) => {
      webSocketServer.emit('connection', connection, request)
    })
  })

  webSocketServer.on(
    'connection',
    (connection: ServerSocketLike, request: IncomingMessage) => {
      sockets.add(connection)
      const authPromise = Promise.resolve(options.getAuthContext?.(request) as TAuthContext)

      connection.on('message', (payload) => {
        const rawPayload = String(payload)
        void authPromise
          .then((auth) => handleSocketMessage(connection, rawPayload, auth))
          .catch((error) => {
            options.onError?.(error)
            sendSocketMessage(connection, {
              type: 'error',
              transactionId: getTransactionIdFromRawMessage(rawPayload),
              message: error instanceof Error ? error.message : String(error),
            })
          })
      })

      connection.on('close', () => {
        sockets.delete(connection)
      })
    },
  )

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(options.port, options.hostname, () => {
      httpServer.off('error', reject)
      resolve()
    })
  })

  async function handleHttpRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    setCorsHeaders(response)

    if (request.method === 'OPTIONS') {
      response.statusCode = 204
      response.end()
      return
    }

    if (request.method === 'GET' && request.url === '/health') {
      writeJson(response, 200, { ok: true })
      return
    }

    if (request.method === 'POST' && request.url === queryPath) {
      const auth = options.getAuthContext
        ? await options.getAuthContext(request)
        : (undefined as TAuthContext)
      const body = await readRequestBody(request)
      const payload = parseSyncPayload<QueryHttpRequest>(body)
      const query = options.registry.queries[payload.queryName]

      if (!query) {
        writeJson(response, 404, { error: `Unknown query "${payload.queryName}".` })
        return
      }

      const result = await query.runServer(
        {
          adapter: options.adapter,
          auth,
          force: false,
          policies: options.registry.policies,
          metadata: options.metadata,
        },
        payload.args as never,
      )
      writeJson(response, 200, { result })
      return
    }

    if (options.handleHttpRequest && (await options.handleHttpRequest(request, response))) {
      return
    }

    writeJson(response, 404, { error: 'Not found.' })
  }

  async function handleSocketMessage(
    connection: ServerSocketLike,
    rawMessage: string,
    auth: TAuthContext,
  ): Promise<void> {
    const message = parseSyncPayload<
      import('./sync-runtime-types.js').SyncClientMessage
    >(rawMessage)

    await options.adapter.cleanupExpired(Date.now())
    await markExpiredServerTransactions(options.database, Date.now())

    switch (message.type) {
      case 'txn_open': {
        const definition = options.registry.mutations[
          message.mutationName
        ]

        if (!definition) {
          sendSocketMessage(connection, {
            type: 'error',
            transactionId: message.transactionId,
            message: `Unknown mutation "${message.mutationName}".`,
          })
          return
        }

        const expiresAt = Date.now() + LOCK_LEASE_MS
        const acquireResult = await options.adapter.acquire(
          message.transactionId,
          message.clientId,
          message.lockTargets,
          expiresAt,
        )

        if (!acquireResult.acquired) {
          sendSocketMessage(connection, {
            type: 'txn_open_denied',
            transactionId: message.transactionId,
            busyTargets: acquireResult.busyTargets,
          })
          return
        }

        await insertOpenedServerTransaction(options.database, {
          transactionId: message.transactionId,
          clientId: message.clientId,
          mutationName: message.mutationName,
          args: message.args,
          invalidations: [],
          lockTargets: message.lockTargets,
          expiresAt,
          createdAt: Date.now(),
        })

        sendSocketMessage(connection, {
          type: 'txn_opened',
          transactionId: message.transactionId,
          expiresAt,
        })
        return
      }
      case 'txn_commit': {
        const record = await readServerTransaction(
          options.database,
          message.transactionId,
        )

        if (!record) {
          sendSocketMessage(connection, {
            type: 'txn_status_result',
            transactionId: message.transactionId,
            status: 'missing',
            serverResult: null,
            invalidations: [],
            message: 'Transaction not found.',
          })
          return
        }

        if (record.status === 'committed') {
          sendSocketMessage(connection, {
            type: 'txn_committed',
            transactionId: record.transactionId,
            serverResult: record.serverResult,
            invalidations: record.invalidations,
          })
          return
        }

        if (record.status === 'conflict') {
          sendSocketMessage(connection, {
            type: 'txn_conflict',
            transactionId: record.transactionId,
            serverResult: record.serverResult,
            invalidations: record.invalidations,
            message: 'Transaction result diverged from the local result.',
          })
          return
        }

        if (record.status !== 'opened') {
          sendSocketMessage(connection, {
            type: 'txn_status_result',
            transactionId: record.transactionId,
            status: record.status,
            serverResult: record.serverResult,
            invalidations: record.invalidations,
            message: 'Transaction is no longer open.',
          })
          return
        }

        const definition = options.registry.mutations[
          message.mutationName
        ]

        if (!definition) {
          throw new Error(`Unknown mutation "${message.mutationName}".`)
        }

        await updateServerTransaction(options.database, message.transactionId, {
          localResult: message.localResult,
          updatedAt: Date.now(),
        })

        try {
          const serverResult = await options.adapter.runInTransaction(
            async (context) => {
              const nextResult = await definition.runServer(
                {
                  ...context,
                  auth,
                  policies: options.registry.policies,
                  metadata: options.metadata,
                },
                message.args as never,
              )

              if (
                !message.force &&
                !definition.resultsEqual(message.localResult as never, nextResult)
              ) {
                throw new SyncConflictError(nextResult)
              }

              return nextResult
            },
            { force: message.force, auth },
          )
          const invalidations = definition.invalidate(
            message.args as never,
            serverResult,
          )

          await updateServerTransaction(options.database, message.transactionId, {
            serverResult,
            invalidations,
            status: 'committed',
            updatedAt: Date.now(),
          })
          await options.adapter.release(message.transactionId)

          sendSocketMessage(connection, {
            type: 'txn_committed',
            transactionId: message.transactionId,
            serverResult,
            invalidations,
          })
          broadcastInvalidations(connection, invalidations)
          return
        } catch (error) {
          if (error instanceof SyncConflictError) {
            const invalidations = definition.invalidate(
              message.args as never,
              error.serverResult,
            )

            await updateServerTransaction(options.database, message.transactionId, {
              serverResult: error.serverResult,
              invalidations,
              status: 'conflict',
              updatedAt: Date.now(),
            })
            await options.adapter.release(message.transactionId)
            sendSocketMessage(connection, {
              type: 'txn_conflict',
              transactionId: message.transactionId,
              serverResult: error.serverResult,
              invalidations,
              message: 'Transaction result diverged from the local result.',
            })
            return
          }

          await updateServerTransaction(options.database, message.transactionId, {
            status: 'aborted',
            updatedAt: Date.now(),
          })
          await options.adapter.release(message.transactionId)
          sendSocketMessage(connection, {
            type: 'error',
            transactionId: message.transactionId,
            message: error instanceof Error ? error.message : String(error),
          })
          return
        }
      }
      case 'txn_status': {
        const record = await readServerTransaction(
          options.database,
          message.transactionId,
        )

        if (!record) {
          sendSocketMessage(connection, {
            type: 'txn_status_result',
            transactionId: message.transactionId,
            status: 'missing',
            serverResult: null,
            invalidations: [],
            message: 'Transaction not found.',
          })
          return
        }

        sendSocketMessage(connection, {
          type: 'txn_status_result',
          transactionId: message.transactionId,
          status: record.status,
          serverResult: record.serverResult,
          invalidations: record.invalidations,
          message: null,
        })
        return
      }
      case 'txn_abort': {
        await updateServerTransaction(options.database, message.transactionId, {
          status: 'aborted',
          updatedAt: Date.now(),
        })
        await options.adapter.release(message.transactionId)
        sendSocketMessage(connection, {
          type: 'txn_status_result',
          transactionId: message.transactionId,
          status: 'aborted',
          serverResult: null,
          invalidations: [],
          message: 'Transaction aborted.',
        })
        return
      }
    }
  }

  function broadcastInvalidations(
    sender: ServerSocketLike | null,
    invalidations: import('./sync-runtime-types.js').SyncInvalidationTarget[],
  ): void {
    for (const socket of sockets) {
      if ((sender !== null && socket === sender) || socket.readyState !== WebSocket.OPEN) {
        continue
      }

      sendSocketMessage(socket, {
        type: 'rows_invalidated',
        invalidations,
      })
    }
  }

  return {
    httpServer,
    async close() {
      await new Promise<void>((resolve) => {
        for (const socket of sockets) {
          socket.close()
        }

        webSocketServer.close(() => {
          httpServer.close(() => resolve())
        })
      })
    },
  }
}

class SyncConflictError<TValue = unknown> extends Error {
  readonly serverResult: TValue

  constructor(serverResult: TValue) {
    super('Transaction result diverged from the local result.')
    this.serverResult = serverResult
  }
}

function getTransactionIdFromRawMessage(rawMessage: string): string | null {
  try {
    const payload = parseSyncPayload<{ transactionId?: unknown }>(rawMessage)
    return typeof payload.transactionId === 'string' ? payload.transactionId : null
  } catch {
    return null
  }
}

async function loadWebSocketModule(): Promise<{
  WebSocket: { OPEN: number }
  WebSocketServer: new (options: { noServer: boolean }) => ServerWebSocketServerLike
}> {
  const load = new Function('return import("ws")') as () => Promise<unknown>
  return load() as Promise<{
    WebSocket: { OPEN: number }
    WebSocketServer: new (options: { noServer: boolean }) => ServerWebSocketServerLike
  }>
}

function sendSocketMessage(
  socket: ServerSocketLike,
  message: SyncServerMessage,
): void {
  socket.send(serializeSyncPayload(message))
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  setCorsHeaders(response)
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json')
  response.end(serializeSyncPayload(payload))
}

function setCorsHeaders(response: ServerResponse): void {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk) => {
      chunks.push(Buffer.from(chunk))
    })
    request.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf-8'))
    })
    request.on('error', reject)
  })
}

interface ServerSocketLike {
  readonly readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  on(event: 'message', listener: (payload: unknown) => void): void
  on(event: 'close', listener: () => void): void
}

interface ServerWebSocketServerLike {
  handleUpgrade(
    request: IncomingMessage,
    socket: unknown,
    head: Buffer,
    callback: (socket: ServerSocketLike) => void,
  ): void
  on(
    event: 'connection',
    listener: (socket: ServerSocketLike, request: IncomingMessage) => void,
  ): void
  emit(event: 'connection', socket: ServerSocketLike, request: IncomingMessage): void
  close(callback: () => void): void
}
