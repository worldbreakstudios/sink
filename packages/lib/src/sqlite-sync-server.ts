import { createServer, type Server as HttpServer } from 'node:http'
import type { AsyncSqliteDatabase, SqliteKey } from './sqlite'
import {
  parseSqliteSyncPayload,
  serializeSqliteSyncPayload,
  type SqliteMutationAck,
  type SqliteSyncClientMessage,
  type SqliteSyncSchema,
  type SqliteSyncServerMessage,
} from './sqlite-sync-core'
import type { SqliteMutationEvent, SqliteMutationRowDiff } from './sqlite-collection'

const SQLITE_SERVER_CHANGES_TABLE = '_sink_changes'
const SQLITE_SERVER_TOMBSTONES_TABLE = '_sink_tombstones'
const SQLITE_SERVER_CLIENTS_TABLE = '_sink_clients'

export interface CreateNodeSqliteSyncServerOptions {
  database: AsyncSqliteDatabase
  schema: SqliteSyncSchema
  port: number
  hostname?: string
  path?: string
  onError?: (error: unknown) => void
}

export interface NodeSqliteSyncServer {
  readonly httpServer: HttpServer
  readonly webSocketServer: ServerWebSocketServer
  close(): Promise<void>
}

export async function ensureSqliteSyncServerTables(
  database: AsyncSqliteDatabase,
): Promise<void> {
  await database.execute(
    `CREATE TABLE IF NOT EXISTS "${SQLITE_SERVER_CHANGES_TABLE}" (
      "sequence" INTEGER PRIMARY KEY AUTOINCREMENT,
      "eventId" TEXT NOT NULL UNIQUE,
      "tableName" TEXT NOT NULL,
      "sourceClientId" TEXT NOT NULL,
      "payloadJson" TEXT NOT NULL,
      "createdAt" INTEGER NOT NULL
    );`,
  )
  await database.execute(
    `CREATE INDEX IF NOT EXISTS "idx_${SQLITE_SERVER_CHANGES_TABLE}_sequence"
     ON "${SQLITE_SERVER_CHANGES_TABLE}" ("sequence");`,
  )
  await database.execute(
    `CREATE TABLE IF NOT EXISTS "${SQLITE_SERVER_TOMBSTONES_TABLE}" (
      "tableName" TEXT NOT NULL,
      "keyText" TEXT NOT NULL,
      "rowVersion" TEXT,
      "deletedAt" INTEGER NOT NULL,
      PRIMARY KEY ("tableName", "keyText")
    );`,
  )
  await database.execute(
    `CREATE TABLE IF NOT EXISTS "${SQLITE_SERVER_CLIENTS_TABLE}" (
      "clientId" TEXT PRIMARY KEY,
      "schemaHash" TEXT NOT NULL,
      "lastSeenAt" INTEGER NOT NULL
    );`,
  )
}

export async function createNodeSqliteSyncServer(
  options: CreateNodeSqliteSyncServerOptions,
): Promise<NodeSqliteSyncServer> {
  await ensureSqliteSyncServerTables(options.database)
  const loadWebSocketModule = new Function('return import("ws")') as () => Promise<unknown>
  const websocketModule = (await loadWebSocketModule()) as unknown as {
    WebSocket: ServerWebSocketStatic
    WebSocketServer: new (options: { noServer?: boolean }) => ServerWebSocketServer
  }
  const WebSocket = websocketModule.WebSocket
  const WebSocketServer = websocketModule.WebSocketServer

  const path = options.path ?? '/ws/sync'
  const sockets = new Set<ServerWebSocket>()
  const httpServer = createServer((_req, res) => {
    res.statusCode = 404
    res.end('Not found')
  })
  const webSocketServer = new WebSocketServer({ noServer: true })

  httpServer.on('upgrade', (request, socket, head) => {
    if (request.url !== path) {
      socket.destroy()
      return
    }

    webSocketServer.handleUpgrade(request, socket, head, (webSocket: ServerWebSocket) => {
      webSocketServer.emit('connection', webSocket, request)
    })
  })

  webSocketServer.on('connection', (webSocket: ServerWebSocket) => {
    sockets.add(webSocket)

    webSocket.on('message', (payload: unknown) => {
      void handleMessage(webSocket, String(payload)).catch((error) => {
        options.onError?.(error)
        sendMessage(webSocket, {
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
        })
      })
    })

    webSocket.on('close', () => {
      sockets.delete(webSocket)
    })
  })

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(options.port, options.hostname, () => {
      httpServer.off('error', reject)
      resolve()
    })
  })

  async function handleMessage(
    webSocket: ServerWebSocket,
    rawMessage: string,
  ): Promise<void> {
    const message = parseSqliteSyncPayload<SqliteSyncClientMessage>(rawMessage)

    switch (message.type) {
      case 'hello': {
        await touchClient(options.database, message.clientId, message.schemaHash)
        const lastServerSequence = await getCurrentServerSequence(options.database)
        const events = await listServerChangesSince(
          options.database,
          message.schemaHash === options.schema.schemaHash
            ? message.lastServerSequence
            : 0,
        )
        sendMessage(webSocket, {
          type: 'hello_ack',
          clientId: message.clientId,
          schemaHash: options.schema.schemaHash,
          lastServerSequence,
          events,
        })
        return
      }
      case 'mutation_events': {
        await touchClient(options.database, message.clientId, options.schema.schemaHash)
        const result = await applyClientMutationEvents(
          options.database,
          options.schema,
          message.clientId,
          message.events,
        )

        sendMessage(webSocket, {
          type: 'mutation_ack',
          acks: result.acks,
          correctiveEvents: result.correctiveEvents,
          lastServerSequence: result.lastServerSequence,
        })

        if (result.acceptedEvents.length > 0) {
          for (const peer of sockets) {
            if (peer === webSocket || peer.readyState !== WebSocket.OPEN) {
              continue
            }

            sendMessage(peer, {
              type: 'mutation_events',
              events: result.acceptedEvents,
              lastServerSequence: result.lastServerSequence,
            })
          }
        }
        return
      }
    }
  }

  return {
    httpServer,
    webSocketServer,
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

async function applyClientMutationEvents(
  database: AsyncSqliteDatabase,
  schema: SqliteSyncSchema,
  clientId: string,
  events: SqliteMutationEvent[],
): Promise<{
  acks: SqliteMutationAck[]
  correctiveEvents: SqliteMutationEvent[]
  acceptedEvents: SqliteMutationEvent[]
  lastServerSequence: number
}> {
  const acks: SqliteMutationAck[] = []
  const correctiveEvents: SqliteMutationEvent[] = []
  const acceptedEvents: SqliteMutationEvent[] = []

  await database.execute('BEGIN')

  try {
    for (const event of events) {
      const tableMeta = schema.tables[event.tableName]

      if (!tableMeta) {
        acks.push({
          eventId: event.eventId,
          status: 'rejected',
          serverSequence: null,
          reason: `Unknown table "${event.tableName}".`,
        })
        continue
      }

      const existingSequence = await getExistingServerSequence(database, event.eventId)

      if (existingSequence !== null) {
        acks.push({
          eventId: event.eventId,
          status: 'acked',
          serverSequence: existingSequence,
        })
        continue
      }

      const staleCorrection = await buildStaleCorrectionIfNeeded(
        database,
        event,
        tableMeta.keyColumns,
        tableMeta.hasUpdatedAt,
      )

      if (staleCorrection) {
        acks.push({
          eventId: event.eventId,
          status: 'rejected',
          serverSequence: null,
          reason: 'Incoming event is stale compared with the authoritative row version.',
        })
        correctiveEvents.push(staleCorrection)
        continue
      }

      await applyAcceptedEventToServer(database, event)
      const serverSequence = await insertServerChange(database, clientId, event)
      const acceptedEvent: SqliteMutationEvent = {
        ...event,
        origin: 'remote',
        serverSequence,
      }
      await updateServerChangePayload(database, serverSequence, acceptedEvent)
      acceptedEvents.push(acceptedEvent)
      acks.push({
        eventId: event.eventId,
        status: 'acked',
        serverSequence,
      })
    }

    await database.execute('COMMIT')
  } catch (error) {
    try {
      await database.execute('ROLLBACK')
    } catch {
      // Ignore rollback failures and surface the original error.
    }

    throw error
  }

  return {
    acks,
    correctiveEvents,
    acceptedEvents,
    lastServerSequence: await getCurrentServerSequence(database),
  }
}

async function buildStaleCorrectionIfNeeded(
  database: AsyncSqliteDatabase,
  event: SqliteMutationEvent,
  keyColumns: readonly string[],
  hasUpdatedAt: boolean,
): Promise<SqliteMutationEvent | null> {
  if (!hasUpdatedAt) {
    return null
  }

  for (const rowDiff of event.rowDiffs) {
    const key = rowDiff.key ?? getRowDiffKey(rowDiff, keyColumns)

    if (key === null) {
      continue
    }

    const currentRow = await queryRowByKey(
      database,
      event.tableName,
      key,
      keyColumns,
    )
    const tombstone = await queryTombstone(
      database,
      event.tableName,
      serializeSqliteKey(key, keyColumns),
    )
    const currentVersion = currentRow
      ? normalizeVersion((currentRow as Record<string, unknown>)._updatedAt)
      : tombstone
        ? normalizeVersion(tombstone.rowVersion)
        : null
    const incomingVersion = getIncomingRowVersion(event, rowDiff)

    if (
      currentVersion !== null &&
      incomingVersion !== null &&
      incomingVersion <= currentVersion
    ) {
      return buildCorrectiveEvent(
        event.tableName,
        keyColumns,
        key,
        currentRow,
        tombstone !== null,
      )
    }
  }

  return null
}

async function applyAcceptedEventToServer(
  database: AsyncSqliteDatabase,
  event: SqliteMutationEvent,
): Promise<void> {
  const columns = await database.getTableColumns(event.tableName)
  const structuredColumns = getStructuredColumns(columns)

  for (const rowDiff of event.rowDiffs) {
    const key = rowDiff.key ?? getRowDiffKey(rowDiff, event.keyColumns)

    switch (rowDiff.changeType) {
      case 'inserted':
      case 'updated':
        if (rowDiff.afterRow) {
          await upsertRow(database, event.tableName, rowDiff.afterRow, structuredColumns)

          if (key !== null) {
            await clearTombstone(
              database,
              event.tableName,
              serializeSqliteKey(key, event.keyColumns),
            )
          }
        }
        break
      case 'deleted':
        if (key !== null) {
          await deleteRow(database, event.tableName, key, event.keyColumns)
          await upsertTombstone(
            database,
            event.tableName,
            serializeSqliteKey(key, event.keyColumns),
            getIncomingRowVersion(event, rowDiff),
            event.publishedAt,
          )
        }
        break
      case 'unchanged':
        break
    }
  }
}

async function insertServerChange(
  database: AsyncSqliteDatabase,
  clientId: string,
  event: SqliteMutationEvent,
): Promise<number> {
  await database.execute(
    `INSERT INTO "${SQLITE_SERVER_CHANGES_TABLE}" (
      "eventId",
      "tableName",
      "sourceClientId",
      "payloadJson",
      "createdAt"
    ) VALUES (?, ?, ?, ?, ?);`,
    [
      event.eventId,
      event.tableName,
      clientId,
      serializeSqliteSyncPayload(event),
      Date.now(),
    ],
  )
  const rows = await database.query<{ sequence: number }>(
    'SELECT last_insert_rowid() AS sequence;',
  )
  return rows[0]?.sequence ?? 0
}

async function updateServerChangePayload(
  database: AsyncSqliteDatabase,
  sequence: number,
  event: SqliteMutationEvent,
): Promise<void> {
  await database.execute(
    `UPDATE "${SQLITE_SERVER_CHANGES_TABLE}"
     SET "payloadJson" = ?
     WHERE "sequence" = ?;`,
    [serializeSqliteSyncPayload(event), sequence],
  )
}

async function listServerChangesSince(
  database: AsyncSqliteDatabase,
  lastServerSequence: number,
): Promise<SqliteMutationEvent[]> {
  const rows = await database.query<{ payloadJson: string }>(
    `SELECT "payloadJson"
     FROM "${SQLITE_SERVER_CHANGES_TABLE}"
     WHERE "sequence" > ?
     ORDER BY "sequence" ASC;`,
    [lastServerSequence],
  )

  return rows.map((row) =>
    parseSqliteSyncPayload<SqliteMutationEvent>(row.payloadJson),
  )
}

async function getExistingServerSequence(
  database: AsyncSqliteDatabase,
  eventId: string,
): Promise<number | null> {
  const rows = await database.query<{ sequence: number }>(
    `SELECT "sequence"
     FROM "${SQLITE_SERVER_CHANGES_TABLE}"
     WHERE "eventId" = ?
     LIMIT 1;`,
    [eventId],
  )

  return rows[0]?.sequence ?? null
}

async function touchClient(
  database: AsyncSqliteDatabase,
  clientId: string,
  schemaHash: string,
): Promise<void> {
  await database.execute(
    `INSERT INTO "${SQLITE_SERVER_CLIENTS_TABLE}" ("clientId", "schemaHash", "lastSeenAt")
     VALUES (?, ?, ?)
     ON CONFLICT("clientId") DO UPDATE SET
       "schemaHash" = excluded."schemaHash",
       "lastSeenAt" = excluded."lastSeenAt";`,
    [clientId, schemaHash, Date.now()],
  )
}

async function queryRowByKey(
  database: AsyncSqliteDatabase,
  tableName: string,
  key: SqliteKey,
  keyColumns: readonly string[],
): Promise<Record<string, unknown> | null> {
  const predicate = buildKeyPredicate(key, keyColumns)
  const rows = await database.query<Record<string, unknown>>(
    `SELECT * FROM "${escapeIdentifier(tableName)}"
     WHERE ${predicate.whereClause}
     LIMIT 1;`,
    predicate.bind as any[],
  )

  return rows[0] ?? null
}

async function queryTombstone(
  database: AsyncSqliteDatabase,
  tableName: string,
  keyText: string,
): Promise<{ rowVersion: string | null } | null> {
  const rows = await database.query<{ rowVersion: string | null }>(
    `SELECT "rowVersion"
     FROM "${SQLITE_SERVER_TOMBSTONES_TABLE}"
     WHERE "tableName" = ? AND "keyText" = ?
     LIMIT 1;`,
    [tableName, keyText],
  )

  return rows[0] ?? null
}

async function upsertTombstone(
  database: AsyncSqliteDatabase,
  tableName: string,
  keyText: string,
  rowVersion: bigint | null,
  deletedAt: number,
): Promise<void> {
  await database.execute(
    `INSERT INTO "${SQLITE_SERVER_TOMBSTONES_TABLE}" ("tableName", "keyText", "rowVersion", "deletedAt")
     VALUES (?, ?, ?, ?)
     ON CONFLICT("tableName", "keyText") DO UPDATE SET
       "rowVersion" = excluded."rowVersion",
       "deletedAt" = excluded."deletedAt";`,
    [tableName, keyText, rowVersion === null ? null : rowVersion.toString(), deletedAt],
  )
}

async function clearTombstone(
  database: AsyncSqliteDatabase,
  tableName: string,
  keyText: string,
): Promise<void> {
  await database.execute(
    `DELETE FROM "${SQLITE_SERVER_TOMBSTONES_TABLE}"
     WHERE "tableName" = ? AND "keyText" = ?;`,
    [tableName, keyText],
  )
}

function buildCorrectiveEvent(
  tableName: string,
  keyColumns: readonly string[],
  key: SqliteKey,
  row: Record<string, unknown> | null,
  isDeleted: boolean,
): SqliteMutationEvent {
  if (row) {
    return {
      eventId: crypto.randomUUID(),
      origin: 'remote',
      tableName,
      sourceInstanceId: 'server',
      mutationType: 'update',
      keyColumns: [...keyColumns],
      rowDiffs: [
        {
          key,
          changeType: 'updated',
          changes: {},
          beforeRow: null,
          afterRow: row,
        },
      ],
      publishedAt: Date.now(),
      serverSequence: null,
    }
  }

  if (!isDeleted) {
    return {
      eventId: crypto.randomUUID(),
      origin: 'remote',
      tableName,
      sourceInstanceId: 'server',
      mutationType: 'delete',
      keyColumns: [...keyColumns],
      rowDiffs: [
        {
          key,
          changeType: 'deleted',
          changes: {},
          beforeRow: null,
          afterRow: null,
        },
      ],
      publishedAt: Date.now(),
      serverSequence: null,
    }
  }

  return {
    eventId: crypto.randomUUID(),
    origin: 'remote',
    tableName,
    sourceInstanceId: 'server',
    mutationType: 'delete',
    keyColumns: [...keyColumns],
    rowDiffs: [
      {
        key,
        changeType: 'deleted',
        changes: {},
        beforeRow: null,
        afterRow: null,
      },
    ],
    publishedAt: Date.now(),
    serverSequence: null,
  }
}

function getIncomingRowVersion(
  event: SqliteMutationEvent,
  rowDiff: SqliteMutationRowDiff,
): bigint | null {
  const nextVersion =
    rowDiff.afterRow?._updatedAt ??
    rowDiff.beforeRow?._updatedAt ??
    event.publishedAt

  return normalizeVersion(nextVersion)
}

function normalizeVersion(value: unknown): bigint | null {
  if (typeof value === 'bigint') {
    return value
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return BigInt(Math.trunc(value))
  }

  if (typeof value === 'string' && value.length > 0) {
    try {
      return BigInt(value)
    } catch {
      return null
    }
  }

  return null
}

async function getCurrentServerSequence(
  database: AsyncSqliteDatabase,
): Promise<number> {
  const rows = await database.query<{ sequence: number | null }>(
    `SELECT COALESCE(MAX("sequence"), 0) AS sequence
     FROM "${SQLITE_SERVER_CHANGES_TABLE}";`,
  )

  return rows[0]?.sequence ?? 0
}

function sendMessage(
  socket: ServerWebSocket,
  message: SqliteSyncServerMessage,
): void {
  if (socket.readyState !== WebSocket.OPEN) {
    return
  }

  socket.send(serializeSqliteSyncPayload(message))
}

type StructuredColumnKind = 'array' | 'object' | 'record'
type StructuredColumns = Partial<Record<string, StructuredColumnKind>>

function getStructuredColumnKind(
  columnType: string,
): StructuredColumnKind | null {
  const normalizedType = columnType.toUpperCase()

  if (normalizedType.includes('JSON_ARRAY')) {
    return 'array'
  }

  if (normalizedType.includes('JSON_OBJECT')) {
    return 'object'
  }

  if (normalizedType.includes('JSON_RECORD')) {
    return 'record'
  }

  return null
}

function getStructuredColumns(
  columns: Array<{ name: string; type: string }>,
): StructuredColumns {
  return Object.fromEntries(
    columns
      .map((column) => [column.name, getStructuredColumnKind(column.type)])
      .filter((entry): entry is [string, StructuredColumnKind] => entry[1] !== null),
  )
}

function serializeRowValues(
  row: Record<string, unknown>,
  structuredColumns: StructuredColumns,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([columnName, value]) => {
      const kind = structuredColumns[columnName]

      if (!kind || value === null || value === undefined) {
        return [columnName, value]
      }

      if (typeof value === 'string') {
        try {
          const parsed = JSON.parse(value)

          if (kind === 'array' ? Array.isArray(parsed) : isPlainObject(parsed)) {
            return [columnName, value]
          }
        } catch {
          // Fall through to encode the raw value.
        }
      }

      return [columnName, JSON.stringify(value)]
    }),
  )
}

async function upsertRow(
  database: AsyncSqliteDatabase,
  tableName: string,
  row: Record<string, unknown>,
  structuredColumns: StructuredColumns,
): Promise<void> {
  const serializedRow = serializeRowValues(row, structuredColumns)
  const entries = Object.entries(serializedRow)

  if (entries.length === 0) {
    return
  }

  const columns = entries.map(([columnName]) => `"${escapeIdentifier(columnName)}"`)
  const placeholders = entries.map(() => '?')
  const values = entries.map(([, value]) => value)

  await database.execute(
    `INSERT OR REPLACE INTO "${escapeIdentifier(tableName)}" (${columns.join(', ')})
     VALUES (${placeholders.join(', ')});`,
    values as any[],
  )
}

async function deleteRow(
  database: AsyncSqliteDatabase,
  tableName: string,
  key: SqliteKey,
  keyColumns: readonly string[],
): Promise<void> {
  const predicate = buildKeyPredicate(key, keyColumns)

  await database.execute(
    `DELETE FROM "${escapeIdentifier(tableName)}"
     WHERE ${predicate.whereClause};`,
    predicate.bind as any[],
  )
}

function getRowDiffKey(
  rowDiff: SqliteMutationRowDiff,
  keyColumns: readonly string[],
): SqliteKey | null {
  if (rowDiff.key !== null) {
    return rowDiff.key as SqliteKey
  }

  const row = rowDiff.afterRow ?? rowDiff.beforeRow

  if (!row) {
    return null
  }

  if (keyColumns.length === 1) {
    const keyColumn = keyColumns[0]

    if (!keyColumn) {
      return null
    }

    return row[keyColumn] as SqliteKey
  }

  return Object.fromEntries(
    keyColumns.map((columnName) => [columnName, row[columnName]]),
  ) as SqliteKey
}

function buildKeyPredicate(
  key: SqliteKey,
  keyColumns: readonly string[],
): { whereClause: string; bind: unknown[] } {
  if (keyColumns.length === 1 && !isPlainObject(key)) {
    const keyColumn = keyColumns[0]

    if (!keyColumn) {
      throw new Error('Missing key column.')
    }

    return {
      whereClause: `"${escapeIdentifier(keyColumn)}" = ?`,
      bind: [key],
    }
  }

  if (!isPlainObject(key)) {
    throw new Error(
      `Expected an object key with columns ${keyColumns.join(', ')}.`,
    )
  }

  return {
    whereClause: keyColumns
      .map((columnName) => `"${escapeIdentifier(columnName)}" = ?`)
      .join(' AND '),
    bind: keyColumns.map((columnName) => {
      const value = key[columnName]

      if (value === undefined) {
        throw new Error(`Missing key column "${columnName}".`)
      }

      return value
    }),
  }
}

function serializeSqliteKey(
  key: SqliteKey,
  keyColumns: readonly string[],
): string {
  if (keyColumns.length === 1 && (typeof key === 'string' || typeof key === 'number' || typeof key === 'bigint')) {
    return String(key)
  }

  if (!isPlainObject(key)) {
    throw new Error(
      `Expected composite key for columns ${keyColumns.join(', ')}.`,
    )
  }

  return JSON.stringify(
    keyColumns.map((columnName) => [columnName, key[columnName] ?? null]),
  )
}

function escapeIdentifier(identifier: string): string {
  return identifier.replaceAll('"', '""')
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

interface ServerWebSocket {
  readonly readyState: number
  send(data: string): void
  close(): void
  on(event: 'message', listener: (data: unknown) => void): void
  on(event: 'close', listener: () => void): void
}

interface ServerWebSocketStatic {
  readonly OPEN: number
}

interface ServerWebSocketServer {
  on(
    event: 'connection',
    listener: (socket: ServerWebSocket, request: unknown) => void,
  ): void
  handleUpgrade(
    request: unknown,
    socket: unknown,
    head: Buffer,
    callback: (socket: ServerWebSocket) => void,
  ): void
  emit(event: 'connection', socket: ServerWebSocket, request: unknown): boolean
  close(callback?: () => void): void
}
