import type { AsyncSqliteDatabase } from '@sink/lib'
import type {
  InvalidationTarget,
  LockTarget,
  ServerTransactionRecord,
} from './types'
import { parsePrototypeJson, serializePrototypeJson } from './json'

export const SERVER_TRANSACTIONS_TABLE = 'prototype_server_transactions'
export const SERVER_LOCKS_TABLE = 'prototype_server_locks'

const ensuredTables = new WeakMap<AsyncSqliteDatabase, Promise<void>>()

export async function ensurePrototypeServerTables(
  database: AsyncSqliteDatabase,
): Promise<void> {
  const existing = ensuredTables.get(database)

  if (existing) {
    await existing
    return
  }

  const promise = (async () => {
    await database.execute(
      `CREATE TABLE IF NOT EXISTS "${SERVER_TRANSACTIONS_TABLE}" (
        "transactionId" TEXT PRIMARY KEY,
        "clientId" TEXT NOT NULL,
        "mutationName" TEXT NOT NULL,
        "argsJson" TEXT NOT NULL,
        "localResultJson" TEXT,
        "serverResultJson" TEXT,
        "invalidationsJson" TEXT NOT NULL,
        "lockTargetsJson" TEXT NOT NULL,
        "status" TEXT NOT NULL,
        "expiresAt" INTEGER NOT NULL,
        "createdAt" INTEGER NOT NULL,
        "updatedAt" INTEGER NOT NULL
      );`,
    )
    await database.execute(
      `CREATE TABLE IF NOT EXISTS "${SERVER_LOCKS_TABLE}" (
        "lockKey" TEXT PRIMARY KEY,
        "transactionId" TEXT NOT NULL,
        "clientId" TEXT NOT NULL,
        "expiresAt" INTEGER NOT NULL,
        "createdAt" INTEGER NOT NULL
      );`,
    )
    await database.execute(
      `CREATE INDEX IF NOT EXISTS "idx_${SERVER_LOCKS_TABLE}_expiresAt"
       ON "${SERVER_LOCKS_TABLE}" ("expiresAt");`,
    )
  })()

  ensuredTables.set(database, promise)
  await promise
}

export async function insertOpenedServerTransaction(
  database: AsyncSqliteDatabase,
  record: Omit<ServerTransactionRecord, 'localResult' | 'serverResult' | 'status' | 'updatedAt'> & {
    status?: ServerTransactionRecord['status']
    updatedAt?: number
  },
): Promise<void> {
  await ensurePrototypeServerTables(database)
  await database.execute(
    `INSERT INTO "${SERVER_TRANSACTIONS_TABLE}" (
      "transactionId",
      "clientId",
      "mutationName",
      "argsJson",
      "localResultJson",
      "serverResultJson",
      "invalidationsJson",
      "lockTargetsJson",
      "status",
      "expiresAt",
      "createdAt",
      "updatedAt"
    ) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?)
    ON CONFLICT("transactionId") DO UPDATE SET
      "clientId" = excluded."clientId",
      "mutationName" = excluded."mutationName",
      "argsJson" = excluded."argsJson",
      "invalidationsJson" = excluded."invalidationsJson",
      "lockTargetsJson" = excluded."lockTargetsJson",
      "status" = excluded."status",
      "expiresAt" = excluded."expiresAt",
      "updatedAt" = excluded."updatedAt";`,
    [
      record.transactionId,
      record.clientId,
      record.mutationName,
      serializePrototypeJson(record.args),
      serializePrototypeJson(record.invalidations),
      serializePrototypeJson(record.lockTargets),
      record.status ?? 'opened',
      record.expiresAt,
      record.createdAt,
      record.updatedAt ?? record.createdAt,
    ],
  )
}

export async function readServerTransaction(
  database: AsyncSqliteDatabase,
  transactionId: string,
): Promise<ServerTransactionRecord | null> {
  await ensurePrototypeServerTables(database)
  const rows = await database.query<{
    transactionId: string
    clientId: string
    mutationName: string
    argsJson: string
    localResultJson: string | null
    serverResultJson: string | null
    invalidationsJson: string
    lockTargetsJson: string
    status: ServerTransactionRecord['status']
    expiresAt: number
    createdAt: number
    updatedAt: number
  }>(
    `SELECT *
     FROM "${SERVER_TRANSACTIONS_TABLE}"
     WHERE "transactionId" = ?
     LIMIT 1;`,
    [transactionId],
  )

  const row = rows[0]

  if (!row) {
    return null
  }

  return {
    transactionId: row.transactionId,
    clientId: row.clientId,
    mutationName: row.mutationName,
    args: parsePrototypeJson(row.argsJson),
    localResult: row.localResultJson ? parsePrototypeJson(row.localResultJson) : null,
    serverResult: row.serverResultJson ? parsePrototypeJson(row.serverResultJson) : null,
    invalidations: parsePrototypeJson(row.invalidationsJson),
    lockTargets: parsePrototypeJson(row.lockTargetsJson),
    status: row.status,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function updateServerTransaction(
  database: AsyncSqliteDatabase,
  transactionId: string,
  patch: {
    localResult?: unknown
    serverResult?: unknown
    invalidations?: InvalidationTarget[]
    status?: ServerTransactionRecord['status']
    expiresAt?: number
    updatedAt?: number
  },
): Promise<void> {
  await ensurePrototypeServerTables(database)
  const assignments: string[] = []
  const bind: unknown[] = []

  if ('localResult' in patch) {
    assignments.push('"localResultJson" = ?')
    bind.push(patch.localResult === undefined ? null : serializePrototypeJson(patch.localResult))
  }

  if ('serverResult' in patch) {
    assignments.push('"serverResultJson" = ?')
    bind.push(patch.serverResult === undefined ? null : serializePrototypeJson(patch.serverResult))
  }

  if (patch.invalidations) {
    assignments.push('"invalidationsJson" = ?')
    bind.push(serializePrototypeJson(patch.invalidations))
  }

  if (patch.status) {
    assignments.push('"status" = ?')
    bind.push(patch.status)
  }

  if (typeof patch.expiresAt === 'number') {
    assignments.push('"expiresAt" = ?')
    bind.push(patch.expiresAt)
  }

  assignments.push('"updatedAt" = ?')
  bind.push(patch.updatedAt ?? Date.now())
  bind.push(transactionId)

  await database.execute(
    `UPDATE "${SERVER_TRANSACTIONS_TABLE}"
     SET ${assignments.join(', ')}
     WHERE "transactionId" = ?;`,
    bind as any[],
  )
}

export async function markExpiredServerTransactions(
  database: AsyncSqliteDatabase,
  now: number,
): Promise<void> {
  await ensurePrototypeServerTables(database)
  await database.execute(
    `UPDATE "${SERVER_TRANSACTIONS_TABLE}"
     SET "status" = 'aborted',
         "updatedAt" = ?
     WHERE "status" = 'opened' AND "expiresAt" <= ?;`,
    [now, now],
  )
}

export function serializeServerLockKey(target: LockTarget): string {
  const orderedValues = Object.entries(target.values)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => [key, value])
  return serializePrototypeJson([
    target.tableName,
    target.kind,
    target.keyName,
    orderedValues,
  ])
}
