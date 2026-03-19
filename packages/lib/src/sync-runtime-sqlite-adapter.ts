import type { SqlValue } from '@sqlite.org/sqlite-wasm'
import type { AsyncSqliteDatabase } from './sqlite.js'
import type {
  ColumnValidatorDescriptor,
} from './schema.js'
import {
  ensureSyncServerStateTables,
  markExpiredServerTransactions,
  serializeServerLockKey,
  SYNC_SERVER_LOCKS_TABLE,
} from './sync-runtime-server-state.js'
import type {
  SyncLockAcquireResult,
  SyncLockTarget,
  SyncSchemaMetadata,
  SyncServerAdapter,
  SyncServerOperationContext,
  SyncTableMetadata,
} from './sync-runtime-types.js'

export interface CreateSqliteSyncServerAdapterOptions {
  database: AsyncSqliteDatabase
  metadata: SyncSchemaMetadata
}

export function createSqliteSyncServerAdapter<TAuthContext = unknown>(
  options: CreateSqliteSyncServerAdapterOptions,
): SyncServerAdapter<TAuthContext> {
  const adapter: SyncServerAdapter<TAuthContext> = {
    async acquire(transactionId, clientId, targets, expiresAt) {
      await ensureSyncServerStateTables(options.database)
      const busyTargets = await withImmediateTransaction(options.database, async () => {
        await deleteExpiredLocks(options.database, Date.now())

        const busy: SyncLockTarget[] = []

        for (const target of targets) {
          const lockKey = serializeServerLockKey(target)
          const rows = await options.database.query<{ transactionId: string }>(
            `SELECT "transactionId"
             FROM "${SYNC_SERVER_LOCKS_TABLE}"
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
          await options.database.execute(
            `INSERT INTO "${SYNC_SERVER_LOCKS_TABLE}" (
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
      } satisfies SyncLockAcquireResult
    },

    async release(transactionId) {
      await ensureSyncServerStateTables(options.database)
      await options.database.execute(
        `DELETE FROM "${SYNC_SERVER_LOCKS_TABLE}" WHERE "transactionId" = ?;`,
        [transactionId],
      )
    },

    async cleanupExpired(now) {
      await ensureSyncServerStateTables(options.database)
      await withImmediateTransaction(options.database, async () => {
        await deleteExpiredLocks(options.database, now)
        await markExpiredServerTransactions(options.database, now)
      })
    },

    async runInTransaction<TValue>(
      callback: (context: SyncServerOperationContext<TAuthContext>) => Promise<TValue>,
      runtimeOptions: { force?: boolean; auth?: TAuthContext } = {},
    ): Promise<TValue> {
      await options.database.execute('BEGIN IMMEDIATE')

      try {
        const result = await callback({
          adapter,
          auth: runtimeOptions.auth as TAuthContext,
          force: runtimeOptions.force ?? false,
          policies: {},
          metadata: options.metadata,
        })
        await options.database.execute('COMMIT')
        return result
      } catch (error) {
        try {
          await options.database.execute('ROLLBACK')
        } catch {
          // Ignore rollback failures and surface the original error.
        }

        throw error
      }
    },

    async listRows(tableName, listOptions = {}) {
      const tableMetadata = getTableMetadata(options.metadata, tableName)
      const where = listOptions.where ?? []
      const orderBy = listOptions.orderBy ?? []
      const { sql: whereSql, bind } = renderWhereClauses(where)
      const orderBySql = renderOrderByClauses(orderBy)
      const limitSql =
        typeof listOptions.limit === 'number'
          ? ` LIMIT ${Math.max(1, Math.trunc(listOptions.limit))}`
          : ''
      const rows = await options.database.query<Record<string, unknown>>(
        `SELECT *
         FROM "${escapeIdentifier(tableName)}"
         ${whereSql}
         ${orderBySql}${limitSql};`,
        bind,
      )

      return rows.map((row) => normalizeRow(tableMetadata, row))
    },

    async getRowByKey(tableName, key, keyColumns) {
      const tableMetadata = getTableMetadata(options.metadata, tableName)
      const nextKeyColumns = keyColumns ?? tableMetadata.keyColumns
      const { sql, bind } = renderKeyWhereClause(nextKeyColumns, key)
      const rows = await options.database.query<Record<string, unknown>>(
        `SELECT *
         FROM "${escapeIdentifier(tableName)}"
         ${sql}
         LIMIT 1;`,
        bind,
      )

      return rows[0] ? normalizeRow(tableMetadata, rows[0]) : null
    },

    async getRowByLookup(tableName, values) {
      const tableMetadata = getTableMetadata(options.metadata, tableName)
      const where = Object.entries(values).map(([column, value]) => ({
        column,
        equals: value,
      }))
      const { sql, bind } = renderWhereClauses(where)
      const rows = await options.database.query<Record<string, unknown>>(
        `SELECT *
         FROM "${escapeIdentifier(tableName)}"
         ${sql}
         LIMIT 1;`,
        bind,
      )

      return rows[0] ? normalizeRow(tableMetadata, rows[0]) : null
    },

    async insertRow(tableName, row) {
      const tableMetadata = getTableMetadata(options.metadata, tableName)
      const columns = Object.keys(row)
      const values = serializeRowValues(tableMetadata, row)
      await options.database.execute(
        `INSERT INTO "${escapeIdentifier(tableName)}" (${columns
          .map((column) => `"${escapeIdentifier(column)}"`)
          .join(', ')})
         VALUES (${columns.map(() => '?').join(', ')});`,
        columns.map((column) => values[column] as never),
      )

      return row
    },

    async updateRow(tableName, key, changes, keyColumns) {
      const tableMetadata = getTableMetadata(options.metadata, tableName)
      const entries = Object.entries(changes)

      if (entries.length === 0) {
        const existing = await adapter.getRowByKey(tableName, key, keyColumns)

        if (!existing) {
          throw new Error(`Row in "${tableName}" was not found.`)
        }

        return existing
      }

      const serializedChanges = serializeRowValues(
        tableMetadata,
        Object.fromEntries(entries),
      )
      const { sql, bind } = renderKeyWhereClause(
        keyColumns ?? tableMetadata.keyColumns,
        key,
      )

      await options.database.execute(
        `UPDATE "${escapeIdentifier(tableName)}"
         SET ${entries
           .map(([columnName]) => `"${escapeIdentifier(columnName)}" = ?`)
           .join(', ')}
         ${sql};`,
        [
          ...entries.map(([columnName]) => serializedChanges[columnName] as never),
          ...bind,
        ],
      )

      const nextRow = await adapter.getRowByKey(tableName, key, keyColumns)

      if (!nextRow) {
        throw new Error(`Row in "${tableName}" was not found after update.`)
      }

      return nextRow
    },

    async deleteRow(tableName, key, keyColumns) {
      const tableMetadata = getTableMetadata(options.metadata, tableName)
      const { sql, bind } = renderKeyWhereClause(
        keyColumns ?? tableMetadata.keyColumns,
        key,
      )
      await options.database.execute(
        `DELETE FROM "${escapeIdentifier(tableName)}" ${sql};`,
        bind,
      )
    },

    async rowExists(tableName, key, keyColumns) {
      return options.database.rowExists(tableName, key as never, keyColumns)
    },
  }

  return adapter
}

async function deleteExpiredLocks(
  database: AsyncSqliteDatabase,
  now: number,
): Promise<void> {
  await database.execute(
    `DELETE FROM "${SYNC_SERVER_LOCKS_TABLE}" WHERE "expiresAt" <= ?;`,
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

function getTableMetadata(
  metadata: SyncSchemaMetadata,
  tableName: string,
): SyncTableMetadata {
  const tableMetadata = metadata.tables[tableName]

  if (!tableMetadata) {
    throw new Error(`Unknown table "${tableName}".`)
  }

  return tableMetadata
}

function escapeIdentifier(identifier: string): string {
  return identifier.replaceAll('"', '""')
}

function renderWhereClauses(
  where: Array<{ column: string; equals: unknown }>,
): { sql: string; bind: SqlValue[] } {
  if (where.length === 0) {
    return {
      sql: '',
      bind: [],
    }
  }

  return {
    sql: `WHERE ${where
      .map((clause) => `${renderFieldExpression(clause.column)} = ?`)
      .join(' AND ')}`,
    bind: where.map((clause) => serializeDbValue(clause.equals) as SqlValue),
  }
}

function renderOrderByClauses(
  orderBy: Array<{ column: string; direction: 'asc' | 'desc' }>,
): string {
  if (orderBy.length === 0) {
    return ''
  }

  return `ORDER BY ${orderBy
    .map(
      (clause) =>
        `${renderFieldExpression(clause.column)} ${clause.direction.toUpperCase()}`,
    )
    .join(', ')}`
}

function renderKeyWhereClause(
  keyColumns: readonly string[],
  key: unknown,
): { sql: string; bind: SqlValue[] } {
  if (
    keyColumns.length === 1 &&
    (typeof key === 'string' || typeof key === 'number' || typeof key === 'bigint')
  ) {
    return {
      sql: `WHERE "${escapeIdentifier(keyColumns[0] ?? '_id')}" = ?`,
      bind: [serializeDbValue(key) as SqlValue],
    }
  }

  const keyRecord = key as Record<string, unknown>

  return {
    sql: `WHERE ${keyColumns
      .map((columnName) => `"${escapeIdentifier(columnName)}" = ?`)
      .join(' AND ')}`,
    bind: keyColumns.map(
      (columnName) => serializeDbValue(keyRecord[columnName]) as SqlValue,
    ),
  }
}

function renderFieldExpression(field: string): string {
  const [columnName, ...path] = field.split('.')

  if (!columnName) {
    throw new Error('Expected a column name.')
  }

  if (path.length === 0) {
    return `"${escapeIdentifier(columnName)}"`
  }

  return `json_extract("${escapeIdentifier(columnName)}", '$.${path.join('.')}')`
}

function serializeRowValues(
  tableMetadata: SyncTableMetadata,
  row: Record<string, unknown>,
): Record<string, SqlValue> {
  return Object.fromEntries(
    Object.entries(row).map(([columnName, value]) => [
      columnName,
      serializeColumnValue(tableMetadata.validatorDescriptors[columnName], value),
    ]),
  ) as Record<string, SqlValue>
}

function serializeColumnValue(
  descriptor: ColumnValidatorDescriptor | undefined,
  value: unknown,
): SqlValue {
  if (value === null || value === undefined || !descriptor) {
    return (value ?? null) as SqlValue
  }

  switch (descriptor.kind) {
    case 'array':
    case 'object':
    case 'record':
      return JSON.stringify(value)
    case 'nullable':
      return serializeColumnValue(descriptor.inner, value)
    case 'default':
      return serializeColumnValue(descriptor.inner, value)
    default:
      return serializeDbValue(value)
  }
}

function serializeDbValue(value: unknown): SqlValue {
  if (typeof value === 'bigint') {
    return value
  }

  return (value ?? null) as SqlValue
}

function normalizeRow(
  tableMetadata: SyncTableMetadata,
  row: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([columnName, value]) => [
      columnName,
      normalizeColumnValue(columnName, tableMetadata.validatorDescriptors[columnName], value),
    ]),
  )
}

function normalizeColumnValue(
  columnName: string,
  descriptor: ColumnValidatorDescriptor | undefined,
  value: unknown,
): unknown {
  if (value === null || value === undefined) {
    return value
  }

  if (
    columnName === '_createdAt' ||
    columnName === '_updatedAt' ||
    columnName === '_archivedAt'
  ) {
    return normalizeTimestampValue(value)
  }

  if (!descriptor) {
    return value
  }

  switch (descriptor.kind) {
    case 'array':
    case 'object':
    case 'record':
      return typeof value === 'string' ? JSON.parse(value) : value
    case 'nullable':
      return normalizeColumnValue(columnName, descriptor.inner, value)
    case 'default':
      return normalizeColumnValue(columnName, descriptor.inner, value)
    default:
      return value
  }
}

function normalizeTimestampValue(value: unknown): bigint {
  if (typeof value === 'bigint') {
    return value
  }

  if (typeof value === 'number') {
    return BigInt(value)
  }

  if (typeof value === 'string') {
    return BigInt(value)
  }

  throw new Error(`Expected timestamp-compatible value, received ${String(value)}.`)
}
