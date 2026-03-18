import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http'
import { createSqliteLockStore } from './lock-store'
import { parsePrototypeJson, serializePrototypeJson } from './json'
import { prototypeMutations, prototypeQueries } from './registry'
import { createSqlitePrototypeRepository } from './repository'
import {
  ensurePrototypeServerTables,
  insertOpenedServerTransaction,
  readServerTransaction,
  updateServerTransaction,
} from './server-state'
import type {
  InvalidationTarget,
  MutationDefinition,
  PrototypeClientMessage,
  PrototypeServerBackend,
  PrototypeServerMessage,
} from './types'
import type { AsyncSqliteDatabase } from '@sink/lib'

const DEFAULT_WEBSOCKET_PATH = '/ws/transactions'
const DEFAULT_QUERY_PATH = '/api/query'
const LOCK_LEASE_MS = 15_000

export interface CreatePrototypeServerOptions {
  database: AsyncSqliteDatabase
  port: number
  hostname?: string
  websocketPath?: string
  queryPath?: string
  onError?: (error: unknown) => void
}

export interface PrototypeServer {
  readonly httpServer: HttpServer
  close(): Promise<void>
}

export async function createPrototypeServer(
  options: CreatePrototypeServerOptions,
): Promise<PrototypeServer> {
  await ensurePrototypeServerTables(options.database)
  const backend = createPrototypeServerBackend(options.database)
  const sockets = new Set<ServerSocketLike>()
  const websocketModule = await loadWebSocketModule()
  const WebSocketServer = websocketModule.WebSocketServer
  const WebSocket = websocketModule.WebSocket
  const websocketPath = options.websocketPath ?? DEFAULT_WEBSOCKET_PATH
  const queryPath = options.queryPath ?? DEFAULT_QUERY_PATH

  const httpServer = createServer((request, response) => {
    void handleHttpRequest(request, response).catch((error) => {
      options.onError?.(error)
      writeJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
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

  webSocketServer.on('connection', (connection: ServerSocketLike) => {
    sockets.add(connection)

    connection.on('message', (payload) => {
      void handleSocketMessage(connection, String(payload)).catch((error) => {
        options.onError?.(error)
        sendSocketMessage(connection, {
          type: 'error',
          transactionId: null,
          message: error instanceof Error ? error.message : String(error),
        })
      })
    })

    connection.on('close', () => {
      sockets.delete(connection)
    })
  })

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
      const body = await readRequestBody(request)
      const payload = parsePrototypeJson<{ queryName: string; args: unknown }>(body)
      const query = prototypeQueries[payload.queryName]

      if (!query) {
        writeJson(response, 404, { error: `Unknown query "${payload.queryName}".` })
        return
      }

      const result = await query.runServer(
        {
          repo: backend.repo,
          force: false,
        },
        payload.args as never,
      )
      writeJson(response, 200, { result })
      return
    }

    writeJson(response, 404, { error: 'Not found.' })
  }

  async function handleSocketMessage(
    connection: ServerSocketLike,
    rawMessage: string,
  ): Promise<void> {
    const message = parsePrototypeJson<PrototypeClientMessage>(rawMessage)
    await backend.lockStore.cleanupExpired(Date.now())

    switch (message.type) {
      case 'txn_open': {
        const definition = prototypeMutations[
          message.mutationName
        ] as MutationDefinition<any, any, any> | undefined

        if (!definition) {
          sendSocketMessage(connection, {
            type: 'error',
            transactionId: message.transactionId,
            message: `Unknown mutation "${message.mutationName}".`,
          })
          return
        }

        const expiresAt = Date.now() + LOCK_LEASE_MS
        const acquireResult = await backend.lockStore.acquire(
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

        const definition = prototypeMutations[
          message.mutationName
        ] as MutationDefinition<any, any, any> | undefined

        if (!definition) {
          throw new Error(`Unknown mutation "${message.mutationName}".`)
        }

        await updateServerTransaction(options.database, message.transactionId, {
          localResult: message.localResult,
          updatedAt: Date.now(),
        })

        try {
          const serverResult = await backend.runInTransaction(
            async (context) => {
              const nextResult = await definition.runServer(
                context,
                message.args as never,
              )

              if (
                !message.force &&
                !definition.resultsEqual(message.localResult as never, nextResult)
              ) {
                throw new PrototypeConflictError(nextResult)
              }

              return nextResult
            },
            { force: message.force },
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
          await backend.lockStore.release(message.transactionId)

          const committedMessage: PrototypeServerMessage = {
            type: 'txn_committed',
            transactionId: message.transactionId,
            serverResult,
            invalidations,
          }
          sendSocketMessage(connection, committedMessage)
          broadcastInvalidations(connection, invalidations)
          return
        } catch (error) {
          if (error instanceof PrototypeConflictError) {
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
            await backend.lockStore.release(message.transactionId)
            sendSocketMessage(connection, {
              type: 'txn_conflict',
              transactionId: message.transactionId,
              serverResult: error.serverResult,
              invalidations,
              message: 'Transaction result diverged from the local result.',
            })
            return
          }

          throw error
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
        await backend.lockStore.release(message.transactionId)
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
    sender: ServerSocketLike,
    invalidations: InvalidationTarget[],
  ): void {
    for (const socket of sockets) {
      if (socket === sender || socket.readyState !== WebSocket.OPEN) {
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

export function createPrototypeServerBackend(
  database: AsyncSqliteDatabase,
): PrototypeServerBackend {
  const repo = createSqlitePrototypeRepository(database)
  const lockStore = createSqliteLockStore(database)

  return {
    repo,
    lockStore,
    async runInTransaction(callback, options = {}) {
      await database.execute('BEGIN IMMEDIATE')

      try {
        const result = await callback({
          repo,
          force: options.force ?? false,
        })
        await database.execute('COMMIT')
        return result
      } catch (error) {
        try {
          await database.execute('ROLLBACK')
        } catch {
          // Ignore rollback failures and surface the original error.
        }

        throw error
      }
    },
  }
}

class PrototypeConflictError<TValue = unknown> extends Error {
  readonly serverResult: TValue

  constructor(serverResult: TValue) {
    super('Transaction result diverged from the local result.')
    this.serverResult = serverResult
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
  message: PrototypeServerMessage,
): void {
  socket.send(serializePrototypeJson(message))
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  setCorsHeaders(response)
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json')
  response.end(serializePrototypeJson(payload))
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
    socket: any,
    head: Buffer,
    callback: (socket: ServerSocketLike) => void,
  ): void
  emit(
    event: 'connection',
    socket: ServerSocketLike,
    request: IncomingMessage,
  ): void
  on(
    event: 'connection',
    listener: (socket: ServerSocketLike, request: IncomingMessage) => void,
  ): void
  close(callback: () => void): void
}
