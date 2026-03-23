import type { AsyncSqliteDatabase } from './sqlite.js'
import { parseSyncPayload, serializeSyncPayload } from './sync-runtime-json.js'
import type {
  ActiveTransactionRecord,
  OfflineConflictPayload,
  OfflineQueueEntry,
  SyncClientSnapshot,
} from './sync-runtime-types.js'
import { serializeRowKey } from './sync-runtime-helpers.js'

const ACTIVE_TRANSACTIONS_TABLE = '_sink_active_ws_transactions'
const OFFLINE_QUEUE_TABLE = '_sink_offline_mutation_queue'
const LEGACY_PROTOTYPE_TABLES = [
  'prototype_offline_mutation_queue',
  'prototype_client_state',
  'prototype_active_ws_transactions',
] as const

const ensuredTables = new WeakMap<AsyncSqliteDatabase, Promise<void>>()

export async function ensureSyncLocalStateTables(
  database: AsyncSqliteDatabase,
): Promise<void> {
  const existing = ensuredTables.get(database)

  if (existing) {
    await existing
    return
  }

  const promise = (async () => {
    for (const legacyTableName of LEGACY_PROTOTYPE_TABLES) {
      await database.execute(`DROP TABLE IF EXISTS "${legacyTableName}";`)
    }

    await database.execute(
      `CREATE TABLE IF NOT EXISTS "${ACTIVE_TRANSACTIONS_TABLE}" (
        "clientId" TEXT,
        "transactionId" TEXT PRIMARY KEY,
        "mutationName" TEXT NOT NULL,
        "argsJson" TEXT NOT NULL,
        "localResultJson" TEXT NOT NULL,
        "lockTargetsJson" TEXT NOT NULL,
        "invalidationsJson" TEXT NOT NULL,
        "createdAt" INTEGER NOT NULL,
        "updatedAt" INTEGER NOT NULL
      );`,
    )

    await database.execute(
      `CREATE TABLE IF NOT EXISTS "${OFFLINE_QUEUE_TABLE}" (
        "queueId" INTEGER PRIMARY KEY AUTOINCREMENT,
        "mutationName" TEXT NOT NULL,
        "argsJson" TEXT NOT NULL,
        "localResultJson" TEXT NOT NULL,
        "lockTargetsJson" TEXT NOT NULL,
        "invalidationsJson" TEXT NOT NULL,
        "status" TEXT NOT NULL,
        "conflictJson" TEXT,
        "createdAt" INTEGER NOT NULL,
        "updatedAt" INTEGER NOT NULL
      );`,
    )
  })()

  ensuredTables.set(database, promise)

  try {
    await promise
  } catch (error) {
    ensuredTables.delete(database)
    throw error
  }
}

export async function upsertActiveTransaction(
  database: AsyncSqliteDatabase,
  record: ActiveTransactionRecord,
): Promise<void> {
  await ensureSyncLocalStateTables(database)
  await database.execute(
    `INSERT INTO "${ACTIVE_TRANSACTIONS_TABLE}" (
      "clientId",
      "transactionId",
      "mutationName",
      "argsJson",
      "localResultJson",
      "lockTargetsJson",
      "invalidationsJson",
      "createdAt",
      "updatedAt"
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT("transactionId") DO UPDATE SET
      "clientId" = excluded."clientId",
      "mutationName" = excluded."mutationName",
      "argsJson" = excluded."argsJson",
      "localResultJson" = excluded."localResultJson",
      "lockTargetsJson" = excluded."lockTargetsJson",
      "invalidationsJson" = excluded."invalidationsJson",
      "updatedAt" = excluded."updatedAt";`,
    [
      record.clientId,
      record.transactionId,
      record.mutationName,
      serializeSyncPayload(record.args),
      serializeSyncPayload(record.localResult),
      serializeSyncPayload(record.lockTargets),
      serializeSyncPayload(record.invalidations),
      record.createdAt,
      record.updatedAt,
    ],
  )
}

export async function listActiveTransactions(
  database: AsyncSqliteDatabase,
  clientId?: string,
): Promise<ActiveTransactionRecord[]> {
  await ensureSyncLocalStateTables(database)
  const rows = await database.query<{
    clientId: string | null
    transactionId: string
    mutationName: string
    argsJson: string
    localResultJson: string
    lockTargetsJson: string
    invalidationsJson: string
    createdAt: number
    updatedAt: number
  }>(
    `SELECT *
     FROM "${ACTIVE_TRANSACTIONS_TABLE}"
     ${clientId ? 'WHERE "clientId" = ?' : ''}
     ORDER BY "createdAt" ASC;`,
    clientId ? [clientId] : [],
  )

  return rows.map((row) => ({
    clientId: row.clientId ?? '',
    transactionId: row.transactionId,
    mutationName: row.mutationName,
    args: parseSyncPayload(row.argsJson),
    localResult: parseSyncPayload(row.localResultJson),
    lockTargets: parseSyncPayload(row.lockTargetsJson),
    invalidations: parseSyncPayload(row.invalidationsJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }))
}

export async function removeActiveTransaction(
  database: AsyncSqliteDatabase,
  transactionId: string,
): Promise<void> {
  await ensureSyncLocalStateTables(database)
  await database.execute(
    `DELETE FROM "${ACTIVE_TRANSACTIONS_TABLE}" WHERE "transactionId" = ?;`,
    [transactionId],
  )
}

export async function enqueueOfflineMutation(
  database: AsyncSqliteDatabase,
  entry: Omit<OfflineQueueEntry, 'queueId'>,
): Promise<number> {
  await ensureSyncLocalStateTables(database)
  await database.execute(
    `INSERT INTO "${OFFLINE_QUEUE_TABLE}" (
      "mutationName",
      "argsJson",
      "localResultJson",
      "lockTargetsJson",
      "invalidationsJson",
      "status",
      "conflictJson",
      "createdAt",
      "updatedAt"
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      entry.mutationName,
      serializeSyncPayload(entry.args),
      serializeSyncPayload(entry.localResult),
      serializeSyncPayload(entry.lockTargets),
      serializeSyncPayload(entry.invalidations),
      entry.status,
      entry.conflict ? serializeSyncPayload(entry.conflict) : null,
      entry.createdAt,
      entry.updatedAt,
    ],
  )

  const rows = await database.query<{ queueId: number }>(
    'SELECT last_insert_rowid() AS queueId;',
  )
  return rows[0]?.queueId ?? 0
}

export async function listOfflineQueueEntries(
  database: AsyncSqliteDatabase,
): Promise<OfflineQueueEntry[]> {
  await ensureSyncLocalStateTables(database)
  const rows = await database.query<{
    queueId: number
    mutationName: string
    argsJson: string
    localResultJson: string
    lockTargetsJson: string
    invalidationsJson: string
    status: 'pending' | 'conflict'
    conflictJson: string | null
    createdAt: number
    updatedAt: number
  }>(
    `SELECT *
     FROM "${OFFLINE_QUEUE_TABLE}"
     ORDER BY "queueId" ASC;`,
  )

  return rows.map((row) => ({
    queueId: row.queueId,
    mutationName: row.mutationName,
    args: parseSyncPayload(row.argsJson),
    localResult: parseSyncPayload(row.localResultJson),
    lockTargets: parseSyncPayload(row.lockTargetsJson),
    invalidations: parseSyncPayload(row.invalidationsJson),
    status: row.status,
    conflict: row.conflictJson
      ? parseSyncPayload<OfflineConflictPayload>(row.conflictJson)
      : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }))
}

export async function findOfflineQueueEntry(
  database: AsyncSqliteDatabase,
  queueId: number,
): Promise<OfflineQueueEntry | null> {
  const entries = await listOfflineQueueEntries(database)
  return entries.find((entry) => entry.queueId === queueId) ?? null
}

export async function clearOfflineQueueConflict(
  database: AsyncSqliteDatabase,
  queueId: number,
): Promise<void> {
  await ensureSyncLocalStateTables(database)
  await database.execute(
    `UPDATE "${OFFLINE_QUEUE_TABLE}"
     SET "status" = 'pending',
         "conflictJson" = NULL,
         "updatedAt" = ?
     WHERE "queueId" = ?;`,
    [Date.now(), queueId],
  )
}

export async function markOfflineQueueConflict(
  database: AsyncSqliteDatabase,
  queueId: number,
  conflict: OfflineConflictPayload,
): Promise<void> {
  await ensureSyncLocalStateTables(database)
  await database.execute(
    `UPDATE "${OFFLINE_QUEUE_TABLE}"
     SET "status" = 'conflict',
         "conflictJson" = ?,
         "updatedAt" = ?
     WHERE "queueId" = ?;`,
    [serializeSyncPayload(conflict), Date.now(), queueId],
  )
}

export async function removeOfflineQueueEntry(
  database: AsyncSqliteDatabase,
  queueId: number,
): Promise<void> {
  await ensureSyncLocalStateTables(database)
  await database.execute(
    `DELETE FROM "${OFFLINE_QUEUE_TABLE}" WHERE "queueId" = ?;`,
    [queueId],
  )
}

export async function getProtectedRowKeySet(
  database: AsyncSqliteDatabase,
  tableName: string,
  keyColumns: readonly string[],
  clientId?: string,
): Promise<Set<string>> {
  await ensureSyncLocalStateTables(database)
  const protectedKeys = new Set<string>()
  const activeTransactions = await listActiveTransactions(database, clientId)
  const offlineQueue = await listOfflineQueueEntries(database)

  for (const record of [...activeTransactions, ...offlineQueue]) {
    for (const target of record.invalidations) {
      if (target.tableName !== tableName) {
        continue
      }

      for (const key of target.keys) {
        protectedKeys.add(serializeRowKey(keyColumns, key))
      }
    }
  }

  return protectedKeys
}

export async function readSyncClientSnapshot(
  database: AsyncSqliteDatabase,
  base: Omit<SyncClientSnapshot, 'activeTransactions' | 'offlineQueue' | 'conflicts'>,
  clientId?: string,
): Promise<SyncClientSnapshot> {
  const activeTransactions = await listActiveTransactions(database, clientId)
  const offlineQueue = await listOfflineQueueEntries(database)

  return {
    ...base,
    activeTransactions: activeTransactions.length,
    offlineQueue: offlineQueue.length,
    conflicts: offlineQueue.filter((entry) => entry.status === 'conflict'),
  }
}
