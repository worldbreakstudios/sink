import type { AsyncSqliteDatabase, SqliteKey } from './sqlite'
import type {
  SqliteMutationEvent,
  SqliteReferenceColumn,
} from './sqlite-collection'

export type SqliteMutationOrigin = 'local' | 'remote'
export type SqliteMutationLogSyncStatus = 'pending' | 'acked'

export interface SqliteMutationLogEntry {
  localSequence: number
  eventId: string
  origin: SqliteMutationOrigin
  tableName: string
  mutationType: SqliteMutationEvent['mutationType']
  sourceInstanceId: string
  publishedAt: number
  serverSequence: number | null
  syncStatus: SqliteMutationLogSyncStatus
  event: SqliteMutationEvent
}

export interface SqliteSyncState {
  clientId: string
  lastServerSequence: number
  schemaHash: string
}

export interface SqliteSyncIndexMetadata {
  fields: readonly string[]
  unique: boolean
}

export interface SqliteSyncTableMetadata {
  keyColumns: readonly string[]
  hasUpdatedAt: boolean
  hasActorId: boolean
  referenceColumns: Partial<Record<string, SqliteReferenceColumn>>
  indexes: Record<string, SqliteSyncIndexMetadata>
}

export interface SqliteSyncSchema {
  schemaHash: string
  tables: Record<string, SqliteSyncTableMetadata>
}

export interface SqliteMutationAck {
  eventId: string
  status: 'acked' | 'rejected'
  serverSequence: number | null
  reason?: string
}

export type SqliteSyncClientMessage =
  | {
      type: 'hello'
      clientId: string
      lastServerSequence: number
      schemaHash: string
    }
  | {
      type: 'mutation_events'
      clientId: string
      events: SqliteMutationEvent[]
    }

export type SqliteSyncServerMessage =
  | {
      type: 'hello_ack'
      clientId: string
      schemaHash: string
      lastServerSequence: number
      events: SqliteMutationEvent[]
    }
  | {
      type: 'mutation_ack'
      acks: SqliteMutationAck[]
      correctiveEvents: SqliteMutationEvent[]
      lastServerSequence: number
    }
  | {
      type: 'mutation_events'
      events: SqliteMutationEvent[]
      lastServerSequence: number
    }
  | {
      type: 'error'
      message: string
    }

export const SQLITE_MUTATION_LOG_TABLE = '_sink_mutation_log'
export const SQLITE_SYNC_STATE_TABLE = '_sink_sync_state'

const ensuredSyncTables = new WeakMap<AsyncSqliteDatabase, Promise<void>>()

export async function ensureSqliteSyncTables(
  database: AsyncSqliteDatabase,
): Promise<void> {
  const existing = ensuredSyncTables.get(database)

  if (existing) {
    await existing
    return
  }

  const promise = (async () => {
    await database.execute(
      `CREATE TABLE IF NOT EXISTS "${SQLITE_MUTATION_LOG_TABLE}" (
        "localSequence" INTEGER PRIMARY KEY AUTOINCREMENT,
        "eventId" TEXT NOT NULL UNIQUE,
        "origin" TEXT NOT NULL,
        "tableName" TEXT NOT NULL,
        "mutationType" TEXT NOT NULL,
        "sourceInstanceId" TEXT NOT NULL,
        "publishedAt" INTEGER NOT NULL,
        "serverSequence" INTEGER,
        "syncStatus" TEXT NOT NULL,
        "eventJson" TEXT NOT NULL
      );`,
    )
    await database.execute(
      `CREATE INDEX IF NOT EXISTS "idx_${SQLITE_MUTATION_LOG_TABLE}_pending"
       ON "${SQLITE_MUTATION_LOG_TABLE}" ("origin", "syncStatus", "localSequence");`,
    )
    await database.execute(
      `CREATE TABLE IF NOT EXISTS "${SQLITE_SYNC_STATE_TABLE}" (
        "id" INTEGER PRIMARY KEY CHECK ("id" = 1),
        "clientId" TEXT NOT NULL,
        "lastServerSequence" INTEGER NOT NULL DEFAULT 0,
        "schemaHash" TEXT NOT NULL DEFAULT ''
      );`,
    )
  })()

  ensuredSyncTables.set(database, promise)

  try {
    await promise
  } catch (error) {
    ensuredSyncTables.delete(database)
    throw error
  }
}

export async function getSqliteSyncState(
  database: AsyncSqliteDatabase,
  schemaHash: string,
): Promise<SqliteSyncState> {
  await ensureSqliteSyncTables(database)

  const row = await readRawSyncState(database)

  if (!row) {
    const state: SqliteSyncState = {
      clientId: crypto.randomUUID(),
      lastServerSequence: 0,
      schemaHash,
    }
    await database.execute(
      `INSERT INTO "${SQLITE_SYNC_STATE_TABLE}" ("id", "clientId", "lastServerSequence", "schemaHash")
       VALUES (1, ?, ?, ?);`,
      [state.clientId, state.lastServerSequence, state.schemaHash],
    )
    return state
  }

  if (row.schemaHash !== schemaHash) {
    await database.execute(
      `UPDATE "${SQLITE_SYNC_STATE_TABLE}"
       SET "schemaHash" = ?, "lastServerSequence" = 0
       WHERE "id" = 1;`,
      [schemaHash],
    )

    return {
      clientId: row.clientId,
      lastServerSequence: 0,
      schemaHash,
    }
  }

  return {
    clientId: row.clientId,
    lastServerSequence: row.lastServerSequence,
    schemaHash: row.schemaHash,
  }
}

export async function updateSqliteSyncState(
  database: AsyncSqliteDatabase,
  patch: Partial<SqliteSyncState>,
): Promise<SqliteSyncState> {
  await ensureSqliteSyncTables(database)
  const currentRow = await readRawSyncState(database)
  const current =
    currentRow === null
      ? {
          clientId: crypto.randomUUID(),
          lastServerSequence: 0,
          schemaHash: patch.schemaHash ?? '',
        }
      : {
          clientId: currentRow.clientId,
          lastServerSequence: currentRow.lastServerSequence,
          schemaHash: currentRow.schemaHash,
        }
  const nextState: SqliteSyncState = {
    clientId: patch.clientId ?? current.clientId,
    lastServerSequence: patch.lastServerSequence ?? current.lastServerSequence,
    schemaHash: patch.schemaHash ?? current.schemaHash,
  }

  await database.execute(
    `INSERT INTO "${SQLITE_SYNC_STATE_TABLE}" ("id", "clientId", "lastServerSequence", "schemaHash")
     VALUES (1, ?, ?, ?)
     ON CONFLICT("id") DO UPDATE SET
       "clientId" = excluded."clientId",
       "lastServerSequence" = excluded."lastServerSequence",
       "schemaHash" = excluded."schemaHash";`,
    [nextState.clientId, nextState.lastServerSequence, nextState.schemaHash],
  )

  return nextState
}

export async function appendSqliteMutationEventsToLog(
  database: AsyncSqliteDatabase,
  events: SqliteMutationEvent[],
): Promise<void> {
  if (events.length === 0) {
    return
  }

  for (const event of events) {
    await database.execute(
      `INSERT OR IGNORE INTO "${SQLITE_MUTATION_LOG_TABLE}" (
        "eventId",
        "origin",
        "tableName",
        "mutationType",
        "sourceInstanceId",
        "publishedAt",
        "serverSequence",
        "syncStatus",
        "eventJson"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        event.eventId,
        event.origin,
        event.tableName,
        event.mutationType,
        event.sourceInstanceId,
        event.publishedAt,
        event.serverSequence ?? null,
        event.origin === 'local' ? 'pending' : 'acked',
        serializeSqliteSyncPayload(event),
      ],
    )
  }
}

export async function getSqliteMutationLogEntryByEventId(
  database: AsyncSqliteDatabase,
  eventId: string,
): Promise<SqliteMutationLogEntry | null> {
  await ensureSqliteSyncTables(database)

  const rows = await database.query<SqliteMutationLogRow>(
    `SELECT *
     FROM "${SQLITE_MUTATION_LOG_TABLE}"
     WHERE "eventId" = ?
     LIMIT 1;`,
    [eventId],
  )

  const row = rows[0]
  return row ? hydrateMutationLogRow(row) : null
}

export async function listPendingSqliteMutationLogEntries(
  database: AsyncSqliteDatabase,
  limit = 250,
): Promise<SqliteMutationLogEntry[]> {
  await ensureSqliteSyncTables(database)

  const rows = await database.query<SqliteMutationLogRow>(
    `SELECT *
     FROM "${SQLITE_MUTATION_LOG_TABLE}"
     WHERE "origin" = 'local' AND "syncStatus" = 'pending'
     ORDER BY "localSequence" ASC
     LIMIT ${Math.max(1, Math.trunc(limit))};`,
  )

  return rows.map(hydrateMutationLogRow)
}

export async function markSqliteMutationEventsAcked(
  database: AsyncSqliteDatabase,
  acknowledgements: SqliteMutationAck[],
): Promise<void> {
  if (acknowledgements.length === 0) {
    return
  }

  await ensureSqliteSyncTables(database)

  for (const acknowledgement of acknowledgements) {
    await database.execute(
      `UPDATE "${SQLITE_MUTATION_LOG_TABLE}"
       SET "syncStatus" = 'acked',
           "serverSequence" = ?
       WHERE "eventId" = ?;`,
      [acknowledgement.serverSequence, acknowledgement.eventId],
    )
  }
}

export async function applySqliteMutationEventToDatabase(
  database: AsyncSqliteDatabase,
  event: SqliteMutationEvent,
): Promise<boolean> {
  await ensureSqliteSyncTables(database)

  await database.execute('BEGIN')

  try {
    const existingEntry = await getSqliteMutationLogEntryByEventId(
      database,
      event.eventId,
    )

    if (existingEntry) {
      await database.execute('COMMIT')
      return false
    }

    const columns = await database.getTableColumns(event.tableName)
    const structuredColumns = getStructuredColumns(columns)

    for (const rowDiff of event.rowDiffs) {
      switch (rowDiff.changeType) {
        case 'inserted':
        case 'updated': {
          const row = rowDiff.afterRow

          if (!row) {
            continue
          }

          await upsertRow(
            database,
            event.tableName,
            row,
            structuredColumns,
          )
          break
        }
        case 'deleted': {
          const key = rowDiff.key ?? getEventRowKey(
            rowDiff.beforeRow,
            rowDiff.afterRow,
            event.keyColumns,
          )

          if (key === null) {
            continue
          }

          await deleteRow(database, event.tableName, key, event.keyColumns)
          break
        }
        case 'unchanged':
          break
      }
    }

    await appendSqliteMutationEventsToLog(database, [event])
    await database.execute('COMMIT')
    return true
  } catch (error) {
    try {
      await database.execute('ROLLBACK')
    } catch {
      // Ignore rollback errors and surface the original failure.
    }

    throw error
  }
}

export function serializeSqliteSyncPayload(value: unknown): string {
  return JSON.stringify(value, (_key, nestedValue) => {
    if (typeof nestedValue === 'bigint') {
      return {
        __sinkType: 'bigint',
        value: nestedValue.toString(),
      }
    }

    return nestedValue
  })
}

export function parseSqliteSyncPayload<TValue>(value: string): TValue {
  return JSON.parse(value, (_key, nestedValue) => {
    if (
      isPlainObject(nestedValue) &&
      nestedValue.__sinkType === 'bigint' &&
      typeof nestedValue.value === 'string'
    ) {
      return BigInt(nestedValue.value)
    }

    return nestedValue
  }) as TValue
}

interface SqliteMutationLogRow {
  localSequence: number
  eventId: string
  origin: SqliteMutationOrigin
  tableName: string
  mutationType: SqliteMutationEvent['mutationType']
  sourceInstanceId: string
  publishedAt: number
  serverSequence: number | null
  syncStatus: SqliteMutationLogSyncStatus
  eventJson: string
}

async function readRawSyncState(
  database: AsyncSqliteDatabase,
): Promise<{
  clientId: string
  lastServerSequence: number
  schemaHash: string
} | null> {
  const rows = await database.query<{
    clientId: string
    lastServerSequence: number
    schemaHash: string
  }>(
    `SELECT "clientId", "lastServerSequence", "schemaHash"
     FROM "${SQLITE_SYNC_STATE_TABLE}"
     WHERE "id" = 1;`,
  )

  return rows[0] ?? null
}

type StructuredColumnKind = 'array' | 'object' | 'record'
type StructuredColumns = Partial<Record<string, StructuredColumnKind>>

function hydrateMutationLogRow(row: SqliteMutationLogRow): SqliteMutationLogEntry {
  return {
    localSequence: row.localSequence,
    eventId: row.eventId,
    origin: row.origin,
    tableName: row.tableName,
    mutationType: row.mutationType,
    sourceInstanceId: row.sourceInstanceId,
    publishedAt: row.publishedAt,
    serverSequence: row.serverSequence,
    syncStatus: row.syncStatus,
    event: parseSqliteSyncPayload<SqliteMutationEvent>(row.eventJson),
  }
}

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

          if (isStructuredValue(kind, parsed)) {
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

function isStructuredValue(
  kind: StructuredColumnKind,
  value: unknown,
): boolean {
  if (kind === 'array') {
    return Array.isArray(value)
  }

  return isPlainObject(value)
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

function getEventRowKey(
  beforeRow: Record<string, unknown> | null,
  afterRow: Record<string, unknown> | null,
  keyColumns: readonly string[],
): SqliteKey | null {
  const row = afterRow ?? beforeRow

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

function escapeIdentifier(identifier: string): string {
  return identifier.replaceAll('"', '""')
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
