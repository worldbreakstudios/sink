import type { AsyncSqliteDatabase } from '@sink/lib'
import type {
  ActiveTransactionRecord,
  OfflineConflictPayload,
  OfflineQueueEntry,
  PrototypeTableName,
  PrototypeSyncSnapshot,
} from './types.ts'
import { parsePrototypeJson, serializePrototypeJson } from './json.ts'
import { serializePrototypeKey } from './helpers.ts'

const CLIENT_STATE_TABLE = 'prototype_client_state'
const ACTIVE_TRANSACTIONS_TABLE = 'prototype_active_ws_transactions'
const OFFLINE_QUEUE_TABLE = 'prototype_offline_mutation_queue'

const ensuredTables = new WeakMap<AsyncSqliteDatabase, Promise<void>>()

export async function ensurePrototypeLocalStateTables(
  database: AsyncSqliteDatabase,
): Promise<void> {
  const existing = ensuredTables.get(database)

  if (existing) {
    await existing
    return
  }

  const promise = (async () => {
    await database.execute(
      `CREATE TABLE IF NOT EXISTS "${CLIENT_STATE_TABLE}" (
        "id" INTEGER PRIMARY KEY CHECK ("id" = 1),
        "clientId" TEXT NOT NULL
      );`,
    )
    await database.execute(
      `CREATE TABLE IF NOT EXISTS "${ACTIVE_TRANSACTIONS_TABLE}" (
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
  await promise
}

export async function getPrototypeClientId(
  database: AsyncSqliteDatabase,
): Promise<string> {
  await ensurePrototypeLocalStateTables(database)
  const rows = await database.query<{ clientId: string }>(
    `SELECT "clientId" FROM "${CLIENT_STATE_TABLE}" WHERE "id" = 1 LIMIT 1;`,
  )

  if (rows[0]?.clientId) {
    return rows[0].clientId
  }

  const clientId = crypto.randomUUID()
  await database.execute(
    `INSERT INTO "${CLIENT_STATE_TABLE}" ("id", "clientId") VALUES (1, ?)
     ON CONFLICT("id") DO UPDATE SET "clientId" = excluded."clientId";`,
    [clientId],
  )
  return clientId
}

export async function upsertActiveTransaction(
  database: AsyncSqliteDatabase,
  record: ActiveTransactionRecord,
): Promise<void> {
  await ensurePrototypeLocalStateTables(database)
  await database.execute(
    `INSERT INTO "${ACTIVE_TRANSACTIONS_TABLE}" (
      "transactionId",
      "mutationName",
      "argsJson",
      "localResultJson",
      "lockTargetsJson",
      "invalidationsJson",
      "createdAt",
      "updatedAt"
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT("transactionId") DO UPDATE SET
      "mutationName" = excluded."mutationName",
      "argsJson" = excluded."argsJson",
      "localResultJson" = excluded."localResultJson",
      "lockTargetsJson" = excluded."lockTargetsJson",
      "invalidationsJson" = excluded."invalidationsJson",
      "updatedAt" = excluded."updatedAt";`,
    [
      record.transactionId,
      record.mutationName,
      serializePrototypeJson(record.args),
      serializePrototypeJson(record.localResult),
      serializePrototypeJson(record.lockTargets),
      serializePrototypeJson(record.invalidations),
      record.createdAt,
      record.updatedAt,
    ],
  )
}

export async function listActiveTransactions(
  database: AsyncSqliteDatabase,
): Promise<ActiveTransactionRecord[]> {
  await ensurePrototypeLocalStateTables(database)
  const rows = await database.query<{
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
     ORDER BY "createdAt" ASC;`,
  )

  return rows.map((row) => ({
    transactionId: row.transactionId,
    mutationName: row.mutationName,
    args: parsePrototypeJson(row.argsJson),
    localResult: parsePrototypeJson(row.localResultJson),
    lockTargets: parsePrototypeJson(row.lockTargetsJson),
    invalidations: parsePrototypeJson(row.invalidationsJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }))
}

export async function removeActiveTransaction(
  database: AsyncSqliteDatabase,
  transactionId: string,
): Promise<void> {
  await ensurePrototypeLocalStateTables(database)
  await database.execute(
    `DELETE FROM "${ACTIVE_TRANSACTIONS_TABLE}" WHERE "transactionId" = ?;`,
    [transactionId],
  )
}

export async function enqueueOfflineMutation(
  database: AsyncSqliteDatabase,
  entry: Omit<OfflineQueueEntry, 'queueId'>,
): Promise<number> {
  await ensurePrototypeLocalStateTables(database)
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
      serializePrototypeJson(entry.args),
      serializePrototypeJson(entry.localResult),
      serializePrototypeJson(entry.lockTargets),
      serializePrototypeJson(entry.invalidations),
      entry.status,
      entry.conflict ? serializePrototypeJson(entry.conflict) : null,
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
  await ensurePrototypeLocalStateTables(database)
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
    args: parsePrototypeJson(row.argsJson),
    localResult: parsePrototypeJson(row.localResultJson),
    lockTargets: parsePrototypeJson(row.lockTargetsJson),
    invalidations: parsePrototypeJson(row.invalidationsJson),
    status: row.status,
    conflict: row.conflictJson
      ? parsePrototypeJson<OfflineConflictPayload>(row.conflictJson)
      : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }))
}

export async function markOfflineQueueConflict(
  database: AsyncSqliteDatabase,
  queueId: number,
  conflict: OfflineConflictPayload,
): Promise<void> {
  await ensurePrototypeLocalStateTables(database)
  await database.execute(
    `UPDATE "${OFFLINE_QUEUE_TABLE}"
     SET "status" = 'conflict',
         "conflictJson" = ?,
         "updatedAt" = ?
     WHERE "queueId" = ?;`,
    [serializePrototypeJson(conflict), Date.now(), queueId],
  )
}

export async function removeOfflineQueueEntry(
  database: AsyncSqliteDatabase,
  queueId: number,
): Promise<void> {
  await ensurePrototypeLocalStateTables(database)
  await database.execute(
    `DELETE FROM "${OFFLINE_QUEUE_TABLE}" WHERE "queueId" = ?;`,
    [queueId],
  )
}

export async function getProtectedRowKeySet(
  database: AsyncSqliteDatabase,
  tableName: PrototypeTableName,
): Promise<Set<string>> {
  await ensurePrototypeLocalStateTables(database)
  const protectedKeys = new Set<string>()
  const activeTransactions = await listActiveTransactions(database)
  const offlineQueue = await listOfflineQueueEntries(database)

  for (const record of [...activeTransactions, ...offlineQueue]) {
    for (const target of record.invalidations) {
      if (target.tableName !== tableName) {
        continue
      }

      for (const key of target.keys) {
        protectedKeys.add(serializePrototypeKey(tableName, key))
      }
    }
  }

  return protectedKeys
}

export async function readPrototypeSyncSnapshot(
  database: AsyncSqliteDatabase,
  base: Omit<PrototypeSyncSnapshot, 'activeTransactions' | 'offlineQueue' | 'conflicts'>,
): Promise<PrototypeSyncSnapshot> {
  const activeTransactions = await listActiveTransactions(database)
  const offlineQueue = await listOfflineQueueEntries(database)

  return {
    ...base,
    activeTransactions: activeTransactions.length,
    offlineQueue: offlineQueue.length,
    conflicts: offlineQueue.filter((entry) => entry.status === 'conflict'),
  }
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
  await ensurePrototypeLocalStateTables(database)
  await database.execute(
    `UPDATE "${OFFLINE_QUEUE_TABLE}"
     SET "status" = 'pending',
         "conflictJson" = NULL,
         "updatedAt" = ?
     WHERE "queueId" = ?;`,
    [Date.now(), queueId],
  )
}
