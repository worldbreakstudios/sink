import type { AsyncSqliteDatabase } from '@sink/lib'
import { ensurePrototypeServerTables, SERVER_LOCKS_TABLE, markExpiredServerTransactions, serializeServerLockKey } from './server-state'
import type { LockStore, LockStoreAcquireResult, LockTarget } from './types'

export function createSqliteLockStore(
  database: AsyncSqliteDatabase,
): LockStore {
  return {
    async acquire(transactionId, clientId, targets, expiresAt) {
      await ensurePrototypeServerTables(database)
      const busyTargets = await withImmediateTransaction(database, async () => {
        await deleteExpiredLocks(database, Date.now())

        const busy: LockTarget[] = []

        for (const target of targets) {
          const lockKey = serializeServerLockKey(target)
          const rows = await database.query<{ transactionId: string }>(
            `SELECT "transactionId"
             FROM "${SERVER_LOCKS_TABLE}"
             WHERE "lockKey" = ?
             LIMIT 1;`,
            [lockKey],
          )

          if (rows[0] && rows[0].transactionId !== transactionId) {
            busy.push(target)
          }
        }

        if (busy.length > 0) {
          return busy
        }

        for (const target of targets) {
          await database.execute(
            `INSERT INTO "${SERVER_LOCKS_TABLE}" (
              "lockKey",
              "transactionId",
              "clientId",
              "expiresAt",
              "createdAt"
            ) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT("lockKey") DO UPDATE SET
              "transactionId" = excluded."transactionId",
              "clientId" = excluded."clientId",
              "expiresAt" = excluded."expiresAt";`,
            [
              serializeServerLockKey(target),
              transactionId,
              clientId,
              expiresAt,
              Date.now(),
            ],
          )
        }

        return []
      })

      return {
        acquired: busyTargets.length === 0,
        busyTargets,
      } satisfies LockStoreAcquireResult
    },

    async release(transactionId) {
      await ensurePrototypeServerTables(database)
      await database.execute(
        `DELETE FROM "${SERVER_LOCKS_TABLE}" WHERE "transactionId" = ?;`,
        [transactionId],
      )
    },

    async cleanupExpired(now) {
      await ensurePrototypeServerTables(database)
      await withImmediateTransaction(database, async () => {
        await deleteExpiredLocks(database, now)
        await markExpiredServerTransactions(database, now)
      })
    },
  }
}

async function deleteExpiredLocks(
  database: AsyncSqliteDatabase,
  now: number,
): Promise<void> {
  await database.execute(
    `DELETE FROM "${SERVER_LOCKS_TABLE}" WHERE "expiresAt" <= ?;`,
    [now],
  )
}

async function withImmediateTransaction<TValue>(
  database: AsyncSqliteDatabase,
  callback: () => Promise<TValue>,
): Promise<TValue> {
  await database.execute('BEGIN IMMEDIATE')

  try {
    const result = await callback()
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
}
