import type { AsyncSqliteDatabase } from './sqlite.js'
import {
  clearOfflineQueueConflict,
  enqueueOfflineMutation,
  ensureSyncLocalStateTables,
  findOfflineQueueEntry,
  getProtectedRowKeySet,
  listActiveTransactions,
  listOfflineQueueEntries,
  markOfflineQueueConflict,
  readSyncClientSnapshot,
  removeActiveTransaction,
  removeOfflineQueueEntry,
  upsertActiveTransaction,
} from './sync-runtime-local-state.js'
import { parseSyncPayload, serializeSyncPayload } from './sync-runtime-json.js'
import type {
  CreateSyncBatchTransaction,
  SyncClientMessage,
  SyncClientSnapshot,
  SyncMutationDefinition,
  SyncMutationLocalContext,
  SyncOperationRegistry,
  SyncQueryDefinition,
  SyncQueryLocalContext,
  SyncQuerySubscription,
  SyncSchemaMetadata,
  SyncServerMessage,
  SyncSocketLike,
} from './sync-runtime-types.js'

interface PendingTransactionContext {
  definition: SyncMutationDefinition<any, any, any, any>
  args: unknown
  localResult: unknown
  invalidations: ReturnType<SyncMutationDefinition['invalidate']>
  transaction: { commit(): Promise<unknown>; rollback?(): void } | null
  queueId: number | null
}

interface Deferred<TValue> {
  promise: Promise<TValue>
  resolve: (value: TValue) => void
  reject: (error: unknown) => void
}

interface BrowserNetworkRuntime {
  navigator?: {
    onLine?: boolean
  }
  addEventListener?: (type: 'online' | 'offline', listener: () => void) => void
  removeEventListener?: (type: 'online' | 'offline', listener: () => void) => void
}

export interface CreateSyncClientOptions<
  TCollections extends object,
> {
  database: AsyncSqliteDatabase
  collections: TCollections
  createBatchTransaction: CreateSyncBatchTransaction<TCollections>
  metadata: SyncSchemaMetadata
  registry: SyncOperationRegistry
  serverBaseUrl: string
  websocketUrl: string
  queryPath?: string
  reconnectDelayMs?: number
  autoStart?: boolean
  webSocketFactory?: (url: string) => SyncSocketLike
}

export interface SyncClient<
  TCollections extends object = object,
> {
  start(): void
  stop(): void
  watchQuery<TArgs, TResult>(
    definition: SyncQueryDefinition<TArgs, TResult, TCollections>,
    args: TArgs,
  ): () => void
  refreshQuery<TArgs, TResult>(
    definition: SyncQueryDefinition<TArgs, TResult, TCollections>,
    args: TArgs,
  ): Promise<TResult>
  executeMutation<TArgs, TLocalResult, TServerResult>(
    definition: SyncMutationDefinition<
      TArgs,
      TLocalResult,
      TServerResult,
      TCollections
    >,
    args: TArgs,
  ): Promise<TLocalResult | TServerResult>
  overwriteOfflineConflict(queueId: number): Promise<void>
  acceptOfflineConflict(queueId: number): Promise<void>
  subscribe(listener: () => void): () => void
  getSnapshot(): SyncClientSnapshot
}

export function createSyncClient<TCollections extends object>(
  options: CreateSyncClientOptions<TCollections>,
): SyncClient<TCollections> {
  const browserRuntime = globalThis as typeof globalThis & BrowserNetworkRuntime
  const createSocket = options.webSocketFactory ?? defaultWebSocketFactory
  const reconnectDelayMs = options.reconnectDelayMs ?? 1000
  const transactionOpenTimeoutMs = Math.max(reconnectDelayMs * 2, 3000)
  const queryPath = options.queryPath ?? '/api/query'
  const listeners = new Set<() => void>()
  const querySubscriptions = new Map<
    string,
    SyncQuerySubscription<any, TCollections>
  >()
  const pendingOpenRequests = new Map<string, Deferred<SyncServerMessage>>()
  const pendingStatusRequests = new Map<string, Deferred<SyncServerMessage>>()
  const pendingFinalizations = new Map<string, Deferred<SyncServerMessage>>()
  const pendingTransactions = new Map<string, PendingTransactionContext>()

  const clientId = crypto.randomUUID()
  let started = false
  let stopped = false
  let socket: SyncSocketLike | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let browserOffline = browserRuntime.navigator?.onLine === false
  let browserListenersAttached = false
  let replayInProgress = false
  let snapshot: SyncClientSnapshot = {
    connection: 'stopped',
    activeTransactions: 0,
    offlineQueue: 0,
    conflicts: [],
    lastError: null,
    lastInvalidationAt: null,
  }

  const handleOpen = () => {
    void onSocketOpen().catch((error) => {
      markTransportUnavailable(
        error instanceof Error ? error.message : 'Failed to initialize sync connection.',
      )
    })
  }

  const handleClose = () => {
    socket = null
    snapshot = {
      ...snapshot,
      connection: stopped ? 'stopped' : 'disconnected',
      lastError:
        browserOffline
          ? 'Browser is offline.'
          : snapshot.lastError,
    }
    notify()

    if (!stopped && !browserOffline) {
      scheduleReconnect()
    }
  }

  const handleError = (event: unknown) => {
    snapshot = {
      ...snapshot,
      lastError: event instanceof Error ? event.message : 'WebSocket error.',
    }
    notify()
  }

  const handleMessage = (event: { data?: string }) => {
    if (typeof event.data !== 'string') {
      return
    }

    void processMessage(event.data)
  }

  const handleBrowserOnline = () => {
    browserOffline = false
    snapshot = {
      ...snapshot,
      lastError: snapshot.lastError === 'Browser is offline.' ? null : snapshot.lastError,
    }
    notify()

    if (!stopped && socket === null) {
      connect()
    }
  }

  const handleBrowserOffline = () => {
    browserOffline = true
    markTransportUnavailable('Browser is offline.')
  }

  function notify(): void {
    for (const listener of listeners) {
      listener()
    }
  }

  function attachBrowserNetworkListeners(): void {
    if (browserListenersAttached || !browserRuntime.addEventListener) {
      return
    }

    browserRuntime.addEventListener('online', handleBrowserOnline)
    browserRuntime.addEventListener('offline', handleBrowserOffline)
    browserListenersAttached = true
  }

  function detachBrowserNetworkListeners(): void {
    if (!browserListenersAttached || !browserRuntime.removeEventListener) {
      return
    }

    browserRuntime.removeEventListener('online', handleBrowserOnline)
    browserRuntime.removeEventListener('offline', handleBrowserOffline)
    browserListenersAttached = false
  }

  async function refreshSnapshot(): Promise<void> {
    snapshot = await readSyncClientSnapshot(
      options.database,
      {
        connection: snapshot.connection,
        lastError: snapshot.lastError,
        lastInvalidationAt: snapshot.lastInvalidationAt,
      },
      clientId,
    )
    notify()
  }

  function scheduleReconnect(): void {
    if (reconnectTimer !== null || stopped || browserOffline) {
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

    if (browserOffline) {
      snapshot = {
        ...snapshot,
        connection: 'disconnected',
        lastError: 'Browser is offline.',
      }
      notify()
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

    await refreshSnapshot()
    await recoverActiveTransactions()
    await refreshAllQueries()
    await replayOfflineQueue()
  }

  function rejectDeferredMap(
    deferredMap: Map<string, Deferred<SyncServerMessage>>,
    message: string,
  ): void {
    for (const deferred of deferredMap.values()) {
      void deferred.promise.catch(() => {})
      deferred.reject(new Error(message))
    }
    deferredMap.clear()
  }

  function closeSocket(): void {
    if (!socket) {
      return
    }

    socket.removeEventListener('open', handleOpen)
    socket.removeEventListener('close', handleClose)
    socket.removeEventListener('error', handleError)
    socket.removeEventListener('message', handleMessage)
    socket.close()
    socket = null
  }

  function markTransportUnavailable(message: string): void {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }

    closeSocket()
    rejectDeferredMap(pendingOpenRequests, message)
    rejectDeferredMap(pendingStatusRequests, message)
    rejectDeferredMap(
      pendingFinalizations,
      `${message} Pending transactions will recover when sync reconnects.`,
    )

    snapshot = {
      ...snapshot,
      connection: stopped ? 'stopped' : 'disconnected',
      lastError: message,
    }
    notify()

    if (!stopped && !browserOffline) {
      scheduleReconnect()
    }
  }

  async function processMessage(rawMessage: string): Promise<void> {
    const message = parseSyncPayload<SyncServerMessage>(rawMessage)

    switch (message.type) {
      case 'txn_opened':
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
          return
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
    invalidations: ReturnType<SyncMutationDefinition['invalidate']>,
  ): Promise<void> {
    for (const subscription of querySubscriptions.values()) {
      if (subscription.definition.matchesInvalidation(subscription.args, invalidations)) {
        await refreshQuery(subscription.definition as any, subscription.args)
      }
    }
  }

  async function recoverActiveTransactions(): Promise<void> {
    const activeTransactions = await listActiveTransactions(
      options.database,
      clientId,
    )

    for (const record of activeTransactions) {
      const definition = options.registry.mutations[record.mutationName]

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

      try {
        await requestTransactionStatus(record.transactionId)
      } catch {
        break
      }
    }

    await refreshSnapshot()
  }

  async function handleStatusResult(
    message: Extract<SyncServerMessage, { type: 'txn_status_result' }>,
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
        context?.transaction?.rollback?.()
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
    message: Extract<SyncServerMessage, { type: 'txn_committed' }>,
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
    message: Extract<SyncServerMessage, { type: 'txn_conflict' }>,
  ): Promise<void> {
    const context = pendingTransactions.get(message.transactionId)

    context?.transaction?.rollback?.()

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

        const definition = options.registry.mutations[entry.mutationName]

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
    lockTargets: ReturnType<SyncMutationDefinition['lockTargets']>,
  ): Promise<SyncServerMessage> {
    assertConnected()
    const deferred = createDeferred<SyncServerMessage>()
    pendingOpenRequests.set(transactionId, deferred)
    try {
      sendMessage({
        type: 'txn_open',
        clientId,
        transactionId,
        mutationName,
        args,
        lockTargets,
      })
    } catch (error) {
      pendingOpenRequests.delete(transactionId)
      deferred.reject(error)
      throw error
    }

    return withTimeout(
      deferred.promise,
      transactionOpenTimeoutMs,
      () => {
        if (pendingOpenRequests.get(transactionId) === deferred) {
          pendingOpenRequests.delete(transactionId)
        }

        markTransportUnavailable('Timed out waiting for the sync server to open a transaction.')
      },
      'Timed out waiting for the sync server to open a transaction.',
    )
  }

  async function requestTransactionStatus(
    transactionId: string,
  ): Promise<SyncServerMessage> {
    assertConnected()
    const deferred = createDeferred<SyncServerMessage>()
    pendingStatusRequests.set(transactionId, deferred)
    sendMessage({
      type: 'txn_status',
      clientId,
      transactionId,
    })
    return deferred.promise
  }

  function getFinalizationWaiter(transactionId: string): Deferred<SyncServerMessage> {
    const existing = pendingFinalizations.get(transactionId)

    if (existing) {
      return existing
    }

    const created = createDeferred<SyncServerMessage>()
    pendingFinalizations.set(transactionId, created)
    return created
  }

  async function refreshQuery<TArgs, TResult>(
    definition: SyncQueryDefinition<TArgs, TResult, TCollections>,
    args: TArgs,
  ): Promise<TResult> {
    const localContext: SyncQueryLocalContext<TCollections> = {
      database: options.database,
      collections: options.collections,
      createBatchTransaction: options.createBatchTransaction,
      getProtectedRowKeys: (tableName: string) =>
        getProtectedRowKeySet(
          options.database,
          tableName,
          options.metadata.tables[tableName]?.keyColumns ?? ['_id'],
          clientId,
        ),
    }
    const localResult = await definition.readLocal(localContext, args)

    if (!isSocketConnected()) {
      return localResult
    }

    const response = await fetch(`${options.serverBaseUrl}${queryPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: serializeSyncPayload({
        queryName: definition.name,
        args,
      }),
    })

    if (!response.ok) {
      throw new Error(`Query ${definition.name} failed with ${response.status}.`)
    }

    const payload = parseSyncPayload<{ result: TResult }>(await response.text())
    await definition.mergeServer(localContext, args, payload.result)
    await refreshSnapshot()
    return payload.result
  }

  async function executeMutation<TArgs, TLocalResult, TServerResult>(
    definition: SyncMutationDefinition<
      TArgs,
      TLocalResult,
      TServerResult,
      TCollections
    >,
    args: TArgs,
  ): Promise<TLocalResult | TServerResult> {
    await ensureSyncLocalStateTables(options.database)

    if (!isSocketConnected()) {
      return executeOfflineMutation(definition, args)
    }

    const transactionId = crypto.randomUUID()
    const lockTargets = definition.lockTargets(args)
    let opened: SyncServerMessage

    try {
      opened = await requestTransactionOpen(
        transactionId,
        definition.name,
        args,
        lockTargets,
      )
    } catch (error) {
      if (!isSocketConnected()) {
        return executeOfflineMutation(definition, args)
      }

      throw error
    }

    if (opened.type === 'txn_open_denied') {
      throw new Error(
        'The requested rows are locked by another client. Try again shortly.',
      )
    }

    const transaction = options.createBatchTransaction(options.collections, {
      autoCommit: false,
    })
    const localContext: SyncMutationLocalContext<TCollections> = {
      database: options.database,
      collections: options.collections,
      createBatchTransaction: options.createBatchTransaction,
      getProtectedRowKeys: (tableName: string) =>
        getProtectedRowKeySet(
          options.database,
          tableName,
          options.metadata.tables[tableName]?.keyColumns ?? ['_id'],
          clientId,
        ),
      transaction,
    }
    const localResult = await definition.applyLocal(localContext, args)
    const invalidations = definition.invalidate(args, localResult)

    await upsertActiveTransaction(options.database, {
      clientId,
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
    definition: SyncMutationDefinition<
      TArgs,
      TLocalResult,
      TServerResult,
      TCollections
    >,
    args: TArgs,
  ): Promise<TLocalResult> {
    const transaction = options.createBatchTransaction(options.collections, {
      autoCommit: false,
    })
    const localContext: SyncMutationLocalContext<TCollections> = {
      database: options.database,
      collections: options.collections,
      createBatchTransaction: options.createBatchTransaction,
      getProtectedRowKeys: (tableName: string) =>
        getProtectedRowKeySet(
          options.database,
          tableName,
          options.metadata.tables[tableName]?.keyColumns ?? ['_id'],
          clientId,
        ),
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

    const definition = options.registry.mutations[entry.mutationName]

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

  function sendMessage(message: SyncClientMessage): void {
    assertConnected()
    socket?.send(serializeSyncPayload(message))
  }

  function assertConnected(): void {
    if (!isSocketConnected()) {
      throw new Error('WebSocket connection is not active.')
    }
  }

  function isSocketConnected(): boolean {
    return !browserOffline && socket !== null && socket.readyState === 1
  }

  function watchQuery<TArgs, TResult>(
    definition: SyncQueryDefinition<TArgs, TResult, TCollections>,
    args: TArgs,
  ): () => void {
    const key = `${definition.name}:${serializeSyncPayload(args)}`
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

  function getSnapshot(): SyncClientSnapshot {
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

    detachBrowserNetworkListeners()
    closeSocket()
    rejectDeferredMap(pendingOpenRequests, 'Sync client stopped.')
    rejectDeferredMap(pendingStatusRequests, 'Sync client stopped.')
    rejectDeferredMap(pendingFinalizations, 'Sync client stopped.')
    pendingTransactions.clear()
  }

  function start(): void {
    if (started) {
      return
    }

    started = true
    stopped = false
    browserOffline = browserRuntime.navigator?.onLine === false
    attachBrowserNetworkListeners()
    void ensureSyncLocalStateTables(options.database).then(() => {
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

function withTimeout<TValue>(
  promise: Promise<TValue>,
  timeoutMs: number,
  onTimeout: () => void,
  message: string,
): Promise<TValue> {
  return new Promise<TValue>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      onTimeout()
      reject(new Error(message))
    }, timeoutMs)

    promise
      .then((value) => {
        clearTimeout(timeoutId)
        resolve(value)
      })
      .catch((error) => {
        clearTimeout(timeoutId)
        reject(error)
      })
  })
}

function defaultWebSocketFactory(url: string): SyncSocketLike {
  const Constructor = (globalThis as {
    WebSocket?: new (targetUrl: string) => SyncSocketLike
  }).WebSocket

  if (!Constructor) {
    throw new Error('WebSocket is not available in this environment.')
  }

  return new Constructor(url)
}
