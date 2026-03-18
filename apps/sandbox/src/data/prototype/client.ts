import { createBatchTransaction, type SchemaCollections } from '@/data/generated/schema.gen'
import {
  clearOfflineQueueConflict,
  enqueueOfflineMutation,
  ensurePrototypeLocalStateTables,
  findOfflineQueueEntry,
  getPrototypeClientId,
  getProtectedRowKeySet,
  listActiveTransactions,
  listOfflineQueueEntries,
  markOfflineQueueConflict,
  readPrototypeSyncSnapshot,
  removeActiveTransaction,
  removeOfflineQueueEntry,
  upsertActiveTransaction,
} from './local-state'
import { parsePrototypeJson, serializePrototypeJson } from './json'
import { prototypeMutations } from './registry'
import type {
  InvalidationTarget,
  LockTarget,
  MutationDefinition,
  PrototypeClientMessage,
  PrototypeQuerySubscription,
  PrototypeSocketLike,
  PrototypeSyncSnapshot,
  PrototypeTableName,
  PrototypeServerMessage,
  QueryDefinition,
} from './types'
import type { AsyncSqliteDatabase } from '@sink/lib'

interface PendingTransactionContext {
  definition: MutationDefinition<any, any, any>
  args: unknown
  localResult: unknown
  invalidations: InvalidationTarget[]
  transaction: ReturnType<typeof createBatchTransaction> | null
  queueId: number | null
}

interface Deferred<TValue> {
  promise: Promise<TValue>
  resolve: (value: TValue) => void
  reject: (error: unknown) => void
}

export interface CreatePrototypeSyncClientOptions {
  database: AsyncSqliteDatabase
  collections: SchemaCollections
  serverBaseUrl: string
  websocketUrl: string
  reconnectDelayMs?: number
  autoStart?: boolean
  webSocketFactory?: (url: string) => PrototypeSocketLike
}

export interface PrototypeSyncClient {
  start(): void
  stop(): void
  watchQuery<TArgs, TResult>(
    definition: QueryDefinition<TArgs, TResult>,
    args: TArgs,
  ): () => void
  refreshQuery<TArgs, TResult>(
    definition: QueryDefinition<TArgs, TResult>,
    args: TArgs,
  ): Promise<TResult>
  executeMutation<TArgs, TLocalResult, TServerResult>(
    definition: MutationDefinition<TArgs, TLocalResult, TServerResult>,
    args: TArgs,
  ): Promise<TLocalResult | TServerResult>
  overwriteOfflineConflict(queueId: number): Promise<void>
  acceptOfflineConflict(queueId: number): Promise<void>
  subscribe(listener: () => void): () => void
  getSnapshot(): PrototypeSyncSnapshot
}

export function createPrototypeSyncClient(
  options: CreatePrototypeSyncClientOptions,
): PrototypeSyncClient {
  const createSocket = options.webSocketFactory ?? defaultWebSocketFactory
  const reconnectDelayMs = options.reconnectDelayMs ?? 1000
  const listeners = new Set<() => void>()
  const querySubscriptions = new Map<string, PrototypeQuerySubscription<any>>()
  const pendingOpenRequests = new Map<string, Deferred<PrototypeServerMessage>>()
  const pendingStatusRequests = new Map<string, Deferred<PrototypeServerMessage>>()
  const pendingFinalizations = new Map<string, Deferred<PrototypeServerMessage>>()
  const pendingTransactions = new Map<string, PendingTransactionContext>()

  let clientId = ''
  let started = false
  let stopped = false
  let socket: PrototypeSocketLike | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let replayInProgress = false
  let snapshot: PrototypeSyncSnapshot = {
    connection: 'stopped',
    activeTransactions: 0,
    offlineQueue: 0,
    conflicts: [],
    lastError: null,
    lastInvalidationAt: null,
  }

  const handleOpen = () => {
    void onSocketOpen()
  }

  const handleClose = () => {
    socket = null
    snapshot = {
      ...snapshot,
      connection: stopped ? 'stopped' : 'disconnected',
    }
    notify()

    if (!stopped) {
      scheduleReconnect()
    }
  }

  const handleError = (event: unknown) => {
    const message = event instanceof Error ? event.message : 'WebSocket error.'
    snapshot = {
      ...snapshot,
      lastError: message,
    }
    notify()
  }

  const handleMessage = (event: { data?: string }) => {
    if (typeof event.data !== 'string') {
      return
    }

    void processMessage(event.data)
  }

  function notify(): void {
    for (const listener of listeners) {
      listener()
    }
  }

  async function refreshSnapshot(): Promise<void> {
    snapshot = await readPrototypeSyncSnapshot(options.database, {
      connection: snapshot.connection,
      lastError: snapshot.lastError,
      lastInvalidationAt: snapshot.lastInvalidationAt,
    })
    notify()
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

    snapshot = {
      ...snapshot,
      connection: 'connecting',
    }
    notify()

    try {
      socket = createSocket(options.websocketUrl)
      socket.addEventListener('open', handleOpen)
      socket.addEventListener('close', handleClose)
      socket.addEventListener('error', handleError)
      socket.addEventListener('message', handleMessage)
    } catch (error) {
      snapshot = {
        ...snapshot,
        connection: 'disconnected',
        lastError: error instanceof Error ? error.message : String(error),
      }
      notify()
      scheduleReconnect()
    }
  }

  async function onSocketOpen(): Promise<void> {
    snapshot = {
      ...snapshot,
      connection: 'connected',
      lastError: null,
    }
    notify()

    clientId = await getPrototypeClientId(options.database)
    await refreshSnapshot()
    await recoverActiveTransactions()
    await refreshAllQueries()
    await replayOfflineQueue()
  }

  async function processMessage(rawMessage: string): Promise<void> {
    const message = parsePrototypeJson<PrototypeServerMessage>(rawMessage)

    switch (message.type) {
      case 'txn_opened':
        pendingOpenRequests.get(message.transactionId)?.resolve(message)
        pendingOpenRequests.delete(message.transactionId)
        return
      case 'txn_open_denied':
        pendingOpenRequests.get(message.transactionId)?.resolve(message)
        pendingOpenRequests.delete(message.transactionId)
        return
      case 'txn_status_result':
        pendingStatusRequests.get(message.transactionId)?.resolve(message)
        pendingStatusRequests.delete(message.transactionId)
        await handleStatusResult(message)
        return
      case 'txn_committed':
        await finalizeCommitted(message)
        return
      case 'txn_conflict':
        await finalizeConflict(message)
        return
      case 'rows_invalidated':
        snapshot = {
          ...snapshot,
          lastInvalidationAt: Date.now(),
        }
        notify()
        await refreshQueriesForInvalidations(message.invalidations)
        return
      case 'error':
        if (message.transactionId && pendingOpenRequests.has(message.transactionId)) {
          pendingOpenRequests.get(message.transactionId)?.reject(
            new Error(message.message),
          )
          pendingOpenRequests.delete(message.transactionId)
          return
        }

        if (message.transactionId && pendingStatusRequests.has(message.transactionId)) {
          pendingStatusRequests.get(message.transactionId)?.reject(
            new Error(message.message),
          )
          pendingStatusRequests.delete(message.transactionId)
          return
        }

        if (message.transactionId && pendingFinalizations.has(message.transactionId)) {
          pendingFinalizations.get(message.transactionId)?.reject(
            new Error(message.message),
          )
          pendingFinalizations.delete(message.transactionId)
        }

        snapshot = {
          ...snapshot,
          lastError: message.message,
        }
        notify()
        return
    }
  }

  async function refreshAllQueries(): Promise<void> {
    for (const subscription of querySubscriptions.values()) {
      await refreshQuery(subscription.definition as any, subscription.args)
    }
  }

  async function refreshQueriesForInvalidations(
    invalidations: InvalidationTarget[],
  ): Promise<void> {
    for (const subscription of querySubscriptions.values()) {
      if (subscription.definition.matchesInvalidation(subscription.args, invalidations)) {
        await refreshQuery(subscription.definition as any, subscription.args)
      }
    }
  }

  async function recoverActiveTransactions(): Promise<void> {
    const activeTransactions = await listActiveTransactions(options.database)

    for (const record of activeTransactions) {
      const definition = prototypeMutations[record.mutationName]

      if (!definition) {
        await removeActiveTransaction(options.database, record.transactionId)
        continue
      }

      if (!pendingTransactions.has(record.transactionId)) {
        pendingTransactions.set(record.transactionId, {
          definition,
          args: record.args,
          localResult: record.localResult,
          invalidations: record.invalidations,
          transaction: null,
          queueId: null,
        })
      }

      await requestTransactionStatus(record.transactionId)
    }

    await refreshSnapshot()
  }

  async function handleStatusResult(
    message: Extract<PrototypeServerMessage, { type: 'txn_status_result' }>,
  ): Promise<void> {
    const context = pendingTransactions.get(message.transactionId)

    switch (message.status) {
      case 'opened':
        if (context) {
          sendMessage({
            type: 'txn_commit',
            clientId,
            transactionId: message.transactionId,
            mutationName: context.definition.name,
            args: context.args,
            localResult: context.localResult,
            force: false,
          })
        }
        return
      case 'committed':
        await finalizeCommitted({
          type: 'txn_committed',
          transactionId: message.transactionId,
          serverResult: message.serverResult,
          invalidations: message.invalidations,
        })
        return
      case 'conflict':
        await finalizeConflict({
          type: 'txn_conflict',
          transactionId: message.transactionId,
          serverResult: message.serverResult,
          invalidations: message.invalidations,
          message: message.message ?? 'Recovered transaction conflicted.',
        })
        return
      case 'aborted':
      case 'missing':
        if (context?.transaction) {
          context.transaction.rollback()
        }
        pendingTransactions.delete(message.transactionId)
        pendingFinalizations.get(message.transactionId)?.reject(
          new Error(message.message ?? 'Transaction no longer exists on the server.'),
        )
        pendingFinalizations.delete(message.transactionId)
        await removeActiveTransaction(options.database, message.transactionId)
        await refreshSnapshot()
        return
    }
  }

  async function finalizeCommitted(
    message: Extract<PrototypeServerMessage, { type: 'txn_committed' }>,
  ): Promise<void> {
    const context = pendingTransactions.get(message.transactionId)

    if (context?.transaction) {
      await context.transaction.commit()
    }

    if (context && context.queueId !== null) {
      await removeOfflineQueueEntry(options.database, context.queueId)
    } else {
      await removeActiveTransaction(options.database, message.transactionId)
    }

    pendingTransactions.delete(message.transactionId)
    pendingFinalizations.get(message.transactionId)?.resolve(message)
    pendingFinalizations.delete(message.transactionId)
    await refreshQueriesForInvalidations(message.invalidations)
    await refreshSnapshot()
  }

  async function finalizeConflict(
    message: Extract<PrototypeServerMessage, { type: 'txn_conflict' }>,
  ): Promise<void> {
    const context = pendingTransactions.get(message.transactionId)

    if (context?.transaction) {
      context.transaction.rollback()
    }

    if (context && context.queueId !== null) {
      await markOfflineQueueConflict(options.database, context.queueId, {
        localResult: context.localResult,
        serverResult: message.serverResult,
        message: message.message,
      })
    } else {
      await removeActiveTransaction(options.database, message.transactionId)
    }

    pendingTransactions.delete(message.transactionId)
    pendingFinalizations.get(message.transactionId)?.reject(
      new Error(message.message),
    )
    pendingFinalizations.delete(message.transactionId)
    await refreshQueriesForInvalidations(
      message.invalidations.length > 0
        ? message.invalidations
        : context?.invalidations ?? [],
    )
    await refreshSnapshot()
  }

  async function replayOfflineQueue(): Promise<void> {
    if (replayInProgress || !isSocketConnected()) {
      return
    }

    replayInProgress = true

    try {
      const entries = await listOfflineQueueEntries(options.database)

      for (const entry of entries) {
        if (entry.status !== 'pending') {
          break
        }

        const definition = prototypeMutations[entry.mutationName]

        if (!definition) {
          await removeOfflineQueueEntry(options.database, entry.queueId)
          continue
        }

        const transactionId = crypto.randomUUID()
        const opened = await requestTransactionOpen(
          transactionId,
          definition.name,
          entry.args,
          entry.lockTargets,
        )

        if (opened.type === 'txn_open_denied') {
          break
        }

        pendingTransactions.set(transactionId, {
          definition,
          args: entry.args,
          localResult: entry.localResult,
          invalidations: entry.invalidations,
          transaction: null,
          queueId: entry.queueId,
        })

        const waiter = getFinalizationWaiter(transactionId)
        sendMessage({
          type: 'txn_commit',
          clientId,
          transactionId,
          mutationName: definition.name,
          args: entry.args,
          localResult: entry.localResult,
          force: false,
        })

        try {
          await waiter.promise
        } catch {
          break
        }
      }
    } finally {
      replayInProgress = false
      await refreshSnapshot()
    }
  }

  async function requestTransactionOpen(
    transactionId: string,
    mutationName: string,
    args: unknown,
    lockTargets: LockTarget[],
  ): Promise<PrototypeServerMessage> {
    assertConnected()
    const deferred = createDeferred<PrototypeServerMessage>()
    pendingOpenRequests.set(transactionId, deferred)
    sendMessage({
      type: 'txn_open',
      clientId,
      transactionId,
      mutationName,
      args,
      lockTargets: lockTargets as any,
    })
    return deferred.promise
  }

  async function requestTransactionStatus(
    transactionId: string,
  ): Promise<PrototypeServerMessage> {
    assertConnected()
    const deferred = createDeferred<PrototypeServerMessage>()
    pendingStatusRequests.set(transactionId, deferred)
    sendMessage({
      type: 'txn_status',
      clientId,
      transactionId,
    })
    return deferred.promise
  }

  function getFinalizationWaiter(
    transactionId: string,
  ): Deferred<PrototypeServerMessage> {
    const existing = pendingFinalizations.get(transactionId)

    if (existing) {
      return existing
    }

    const created = createDeferred<PrototypeServerMessage>()
    pendingFinalizations.set(transactionId, created)
    return created
  }

  async function refreshQuery<TArgs, TResult>(
    definition: QueryDefinition<TArgs, TResult>,
    args: TArgs,
  ): Promise<TResult> {
    const localContext = {
      database: options.database,
      collections: options.collections,
      createBatchTransaction,
      getProtectedRowKeys: (tableName: PrototypeTableName) =>
        getProtectedRowKeySet(options.database, tableName),
    }
    const localResult = await definition.readLocal(localContext, args)

    if (!isSocketConnected()) {
      return localResult
    }

    const response = await fetch(`${options.serverBaseUrl}/api/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: serializePrototypeJson({
        queryName: definition.name,
        args,
      }),
    })

    if (!response.ok) {
      throw new Error(`Query ${definition.name} failed with ${response.status}.`)
    }

    const payload = parsePrototypeJson<{ result: TResult }>(await response.text())
    await definition.mergeServer(localContext, args, payload.result)
    await refreshSnapshot()
    return payload.result
  }

  async function executeMutation<TArgs, TLocalResult, TServerResult>(
    definition: MutationDefinition<TArgs, TLocalResult, TServerResult>,
    args: TArgs,
  ): Promise<TLocalResult | TServerResult> {
    await ensurePrototypeLocalStateTables(options.database)
    clientId = await getPrototypeClientId(options.database)

    if (!isSocketConnected()) {
      return executeOfflineMutation(definition, args)
    }

    const transactionId = crypto.randomUUID()
    const lockTargets = definition.lockTargets(args)
    const opened = await requestTransactionOpen(
      transactionId,
      definition.name,
      args,
      lockTargets,
    )

    if (opened.type === 'txn_open_denied') {
      throw new Error('The requested rows are locked by another client. Try again shortly.')
    }

    const transaction = createBatchTransaction(options.collections, {
      autoCommit: false,
    })
    const localContext = {
      database: options.database,
      collections: options.collections,
      createBatchTransaction,
      getProtectedRowKeys: (tableName: PrototypeTableName) =>
        getProtectedRowKeySet(options.database, tableName),
      transaction,
    }
    const localResult = await definition.applyLocal(localContext, args)
    const invalidations = definition.invalidate(args, localResult)

    await upsertActiveTransaction(options.database, {
      transactionId,
      mutationName: definition.name,
      args,
      localResult,
      lockTargets,
      invalidations,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    pendingTransactions.set(transactionId, {
      definition,
      args,
      localResult,
      invalidations,
      transaction,
      queueId: null,
    })

    const waiter = getFinalizationWaiter(transactionId)
    sendMessage({
      type: 'txn_commit',
      clientId,
      transactionId,
      mutationName: definition.name,
      args,
      localResult,
      force: false,
    })

    await refreshSnapshot()
    const finalMessage = await waiter.promise

    if (finalMessage.type === 'txn_committed') {
      return localResult
    }

    throw new Error('Unexpected transaction finalization payload.')
  }

  async function executeOfflineMutation<TArgs, TLocalResult, TServerResult>(
    definition: MutationDefinition<TArgs, TLocalResult, TServerResult>,
    args: TArgs,
  ): Promise<TLocalResult> {
    const transaction = createBatchTransaction(options.collections, {
      autoCommit: false,
    })
    const localContext = {
      database: options.database,
      collections: options.collections,
      createBatchTransaction,
      getProtectedRowKeys: (tableName: PrototypeTableName) =>
        getProtectedRowKeySet(options.database, tableName),
      transaction,
    }
    const localResult = await definition.applyLocal(localContext, args)
    const invalidations = definition.invalidate(args, localResult)

    await transaction.commit()
    await enqueueOfflineMutation(options.database, {
      mutationName: definition.name,
      args,
      localResult,
      lockTargets: definition.lockTargets(args),
      invalidations,
      status: 'pending',
      conflict: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    await refreshSnapshot()
    return localResult
  }

  async function overwriteOfflineConflict(queueId: number): Promise<void> {
    const entry = await findOfflineQueueEntry(options.database, queueId)

    if (!entry) {
      throw new Error('Offline queue entry not found.')
    }

    const definition = prototypeMutations[entry.mutationName]

    if (!definition) {
      throw new Error(`Unknown mutation "${entry.mutationName}".`)
    }

    await clearOfflineQueueConflict(options.database, queueId)
    const transactionId = crypto.randomUUID()
    const opened = await requestTransactionOpen(
      transactionId,
      definition.name,
      entry.args,
      entry.lockTargets,
    )

    if (opened.type === 'txn_open_denied') {
      throw new Error('Rows are still locked by another client.')
    }

    pendingTransactions.set(transactionId, {
      definition,
      args: entry.args,
      localResult: entry.localResult,
      invalidations: entry.invalidations,
      transaction: null,
      queueId,
    })

    const waiter = getFinalizationWaiter(transactionId)
    sendMessage({
      type: 'txn_commit',
      clientId,
      transactionId,
      mutationName: definition.name,
      args: entry.args,
      localResult: entry.localResult,
      force: true,
    })

    await waiter.promise
    await replayOfflineQueue()
  }

  async function acceptOfflineConflict(queueId: number): Promise<void> {
    const entry = await findOfflineQueueEntry(options.database, queueId)

    if (!entry) {
      throw new Error('Offline queue entry not found.')
    }

    await removeOfflineQueueEntry(options.database, queueId)
    await refreshQueriesForInvalidations(entry.invalidations)
    await refreshSnapshot()
    await replayOfflineQueue()
  }

  function sendMessage(message: PrototypeClientMessage): void {
    assertConnected()
    socket?.send(serializePrototypeJson(message))
  }

  function assertConnected(): void {
    if (!isSocketConnected()) {
      throw new Error('WebSocket connection is not active.')
    }
  }

  function isSocketConnected(): boolean {
    return socket !== null && socket.readyState === 1
  }

  function watchQuery<TArgs, TResult>(
    definition: QueryDefinition<TArgs, TResult>,
    args: TArgs,
  ): () => void {
    const key = `${definition.name}:${serializePrototypeJson(args)}`
    querySubscriptions.set(key, {
      key,
      definition,
      args,
    })
    void refreshQuery(definition, args)

    return () => {
      querySubscriptions.delete(key)
    }
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  function getSnapshot(): PrototypeSyncSnapshot {
    return snapshot
  }

  function stop(): void {
    stopped = true
    started = false
    snapshot = {
      ...snapshot,
      connection: 'stopped',
    }
    notify()

    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }

    if (socket) {
      socket.removeEventListener('open', handleOpen)
      socket.removeEventListener('close', handleClose)
      socket.removeEventListener('error', handleError)
      socket.removeEventListener('message', handleMessage)
      socket.close()
      socket = null
    }

    for (const deferred of pendingOpenRequests.values()) {
      deferred.reject(new Error('Prototype sync client stopped.'))
    }
    for (const deferred of pendingStatusRequests.values()) {
      deferred.reject(new Error('Prototype sync client stopped.'))
    }
    for (const deferred of pendingFinalizations.values()) {
      deferred.reject(new Error('Prototype sync client stopped.'))
    }

    pendingOpenRequests.clear()
    pendingStatusRequests.clear()
    pendingFinalizations.clear()
    pendingTransactions.clear()
  }

  function start(): void {
    if (started) {
      return
    }

    started = true
    stopped = false
    void ensurePrototypeLocalStateTables(options.database).then(() => {
      connect()
    })
  }

  if (options.autoStart !== false) {
    start()
  }

  return {
    start,
    stop,
    watchQuery,
    refreshQuery,
    executeMutation,
    overwriteOfflineConflict,
    acceptOfflineConflict,
    subscribe,
    getSnapshot,
  }
}

function createDeferred<TValue>(): Deferred<TValue> {
  let resolve!: (value: TValue) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<TValue>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

function defaultWebSocketFactory(url: string): PrototypeSocketLike {
  const Constructor = (globalThis as {
    WebSocket?: new (targetUrl: string) => PrototypeSocketLike
  }).WebSocket

  if (!Constructor) {
    throw new Error('WebSocket is not available in this environment.')
  }

  return new Constructor(url)
}
