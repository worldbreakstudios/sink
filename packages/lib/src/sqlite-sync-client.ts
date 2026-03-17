import {
  applySqliteMutationEventToDatabase,
  getSqliteMutationLogEntryByEventId,
  getSqliteSyncState,
  listPendingSqliteMutationLogEntries,
  markSqliteMutationEventsAcked,
  parseSqliteSyncPayload,
  serializeSqliteSyncPayload,
  updateSqliteSyncState,
  type SqliteMutationAck,
  type SqliteSyncClientMessage,
  type SqliteSyncSchema,
  type SqliteSyncServerMessage,
} from './sqlite-sync-core'
import type { AsyncSqliteDatabase } from './sqlite'
import {
  sqliteMutationEventBus,
  subscribeToSqliteMutationEvents,
  type SqliteMutationEvent,
} from './sqlite-collection'

export interface SqliteSyncSocketLike {
  readonly readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  addEventListener(
    type: 'open' | 'message' | 'error' | 'close',
    listener: (event: any) => void,
  ): void
  removeEventListener(
    type: 'open' | 'message' | 'error' | 'close',
    listener: (event: any) => void,
  ): void
}

export interface CreateSqliteWebSocketSyncClientOptions {
  database: AsyncSqliteDatabase
  schema: SqliteSyncSchema
  websocketUrl: string
  webSocketFactory?: (url: string) => SqliteSyncSocketLike
  reconnectDelayMs?: number
  autoStart?: boolean
  onError?: (error: unknown) => void
}

export interface SqliteWebSocketSyncClient {
  start(): void
  stop(): void
  flush(): Promise<void>
}

export function createSqliteWebSocketSyncClient(
  options: CreateSqliteWebSocketSyncClientOptions,
): SqliteWebSocketSyncClient {
  const createSocket = options.webSocketFactory ?? defaultWebSocketFactory
  const reconnectDelayMs = options.reconnectDelayMs ?? 1000

  let socket: SqliteSyncSocketLike | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let started = false
  let stopped = false
  let helloComplete = false
  let flushPromise: Promise<void> | null = null
  let flushRequestedWhileRunning = false
  const inFlightEventIds = new Set<string>()
  let disposeWakeListeners: Array<() => void> = []

  const handleOpen = () => {
    void sendHello()
  }

  const handleMessage = (event: { data?: string }) => {
    if (typeof event.data !== 'string') {
      return
    }

    void processServerMessage(event.data)
  }

  const handleError = (event: unknown) => {
    options.onError?.(event)
  }

  const handleClose = () => {
    helloComplete = false
    inFlightEventIds.clear()
    detachSocketListeners()
    socket = null

    if (!stopped) {
      scheduleReconnect()
    }
  }

  function attachSocketListeners(): void {
    if (!socket) {
      return
    }

    socket.addEventListener('open', handleOpen)
    socket.addEventListener('message', handleMessage)
    socket.addEventListener('error', handleError)
    socket.addEventListener('close', handleClose)
  }

  function detachSocketListeners(): void {
    if (!socket) {
      return
    }

    socket.removeEventListener('open', handleOpen)
    socket.removeEventListener('message', handleMessage)
    socket.removeEventListener('error', handleError)
    socket.removeEventListener('close', handleClose)
  }

  function scheduleReconnect(): void {
    if (reconnectTimer !== null || stopped) {
      return
    }

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, reconnectDelayMs)
  }

  function connect(): void {
    if (stopped || socket !== null) {
      return
    }

    try {
      socket = createSocket(options.websocketUrl)
      attachSocketListeners()
    } catch (error) {
      options.onError?.(error)
      scheduleReconnect()
    }
  }

  async function sendHello(): Promise<void> {
    if (!socket || socket.readyState !== 1) {
      return
    }

    const state = await getSqliteSyncState(
      options.database,
      options.schema.schemaHash,
    )
    const message: SqliteSyncClientMessage = {
      type: 'hello',
      clientId: state.clientId,
      lastServerSequence: state.lastServerSequence,
      schemaHash: options.schema.schemaHash,
    }
    socket.send(serializeSqliteSyncPayload(message))
  }

  async function processServerMessage(rawMessage: string): Promise<void> {
    const message = parseSqliteSyncPayload<SqliteSyncServerMessage>(rawMessage)

    switch (message.type) {
      case 'hello_ack':
        helloComplete = true
        await applyIncomingEvents(message.events)
        await updateSqliteSyncState(options.database, {
          schemaHash: message.schemaHash,
          lastServerSequence: message.lastServerSequence,
        })
        await flush()
        return
      case 'mutation_events':
        await applyIncomingEvents(message.events)
        await updateSqliteSyncState(options.database, {
          schemaHash: options.schema.schemaHash,
          lastServerSequence: message.lastServerSequence,
        })
        return
      case 'mutation_ack':
        await settleAcks(message.acks)
        await applyIncomingEvents(message.correctiveEvents)
        await updateSqliteSyncState(options.database, {
          schemaHash: options.schema.schemaHash,
          lastServerSequence: message.lastServerSequence,
        })
        await flush()
        return
      case 'error':
        options.onError?.(new Error(message.message))
        return
    }
  }

  async function settleAcks(acks: SqliteMutationAck[]): Promise<void> {
    for (const ack of acks) {
      inFlightEventIds.delete(ack.eventId)
    }

    await markSqliteMutationEventsAcked(options.database, acks)
  }

  async function applyIncomingEvents(events: SqliteMutationEvent[]): Promise<void> {
    for (const event of events) {
      const existingEntry = await getSqliteMutationLogEntryByEventId(
        options.database,
        event.eventId,
      )

      if (existingEntry?.origin === 'local') {
        await markSqliteMutationEventsAcked(options.database, [
          {
            eventId: event.eventId,
            status: 'acked',
            serverSequence: event.serverSequence ?? existingEntry.serverSequence,
          },
        ])
        continue
      }

      const remoteEvent =
        event.origin === 'remote'
          ? event
          : {
              ...event,
              origin: 'remote' as const,
            }

      const applied = await applySqliteMutationEventToDatabase(
        options.database,
        remoteEvent,
      )

      if (!applied) {
        continue
      }

      sqliteMutationEventBus.publish(remoteEvent.tableName, remoteEvent)
    }
  }

  async function flush(): Promise<void> {
    if (flushPromise) {
      flushRequestedWhileRunning = true
      return flushPromise
    }

    flushPromise = (async () => {
      do {
        flushRequestedWhileRunning = false
        await flushPendingOnce()
      } while (flushRequestedWhileRunning)
    })()

    try {
      await flushPromise
    } finally {
      flushPromise = null
    }
  }

  async function flushPendingOnce(): Promise<void> {
    if (!socket || socket.readyState !== 1 || !helloComplete) {
      return
    }

    const state = await getSqliteSyncState(
      options.database,
      options.schema.schemaHash,
    )
    const pendingEntries = await listPendingSqliteMutationLogEntries(
      options.database,
    )
    const nextEvents = pendingEntries
      .filter((entry) => !inFlightEventIds.has(entry.eventId))
      .map((entry) => entry.event)

    if (nextEvents.length === 0) {
      return
    }

    for (const event of nextEvents) {
      inFlightEventIds.add(event.eventId)
    }

    const message: SqliteSyncClientMessage = {
      type: 'mutation_events',
      clientId: state.clientId,
      events: nextEvents,
    }

    socket.send(serializeSqliteSyncPayload(message))
  }

  function start(): void {
    if (started) {
      return
    }

    started = true
    stopped = false
    disposeWakeListeners = Object.keys(options.schema.tables).map((tableName) =>
      subscribeToSqliteMutationEvents(tableName, () => {
        void flush()
      }),
    )
    connect()
  }

  function stop(): void {
    stopped = true
    started = false
    helloComplete = false
    inFlightEventIds.clear()

    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }

    for (const dispose of disposeWakeListeners) {
      dispose()
    }
    disposeWakeListeners = []

    if (socket) {
      detachSocketListeners()
      socket.close()
      socket = null
    }
  }

  if (options.autoStart !== false) {
    start()
  }

  return {
    start,
    stop,
    flush,
  }
}

function defaultWebSocketFactory(url: string): SqliteSyncSocketLike {
  const Constructor = (globalThis as {
    WebSocket?: new (targetUrl: string) => SqliteSyncSocketLike
  }).WebSocket

  if (!Constructor) {
    throw new Error('WebSocket is not available in this environment.')
  }

  return new Constructor(url)
}
