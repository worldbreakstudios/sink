import {
  createCollection,
  createTransaction,
  localOnlyCollectionOptions,
  type Collection,
  type PendingMutation,
  type Transaction,
  type TransactionConfig,
} from '@tanstack/db'
import type { LocalOnlyCollectionUtils } from '@tanstack/db'
import { FrontendSqliteDatabase } from './sqlite'

export interface CreateSqliteCollectionOptions<
  TRow extends object,
  TKey extends string | number,
> {
  id: string
  tableName: string
  keyColumn: keyof TRow & string
  getKey: (row: TRow) => TKey
  database: FrontendSqliteDatabase
  orderBy?: string
}

export interface SqliteCollectionUtils<TRow extends object>
  extends LocalOnlyCollectionUtils {
  readAll(): TRow[]
  persistMutations(transaction: { mutations: Array<PendingMutation<any>> }): Promise<void>
  createSqliteTransaction(
    config?: Omit<TransactionConfig<TRow>, 'mutationFn'>,
  ): Transaction<TRow>
}

export type SqliteCollection<
  TRow extends object,
  TKey extends string | number,
> = Collection<TRow, TKey, SqliteCollectionUtils<TRow>>

export function createSqliteCollection<
  TRow extends object,
  TKey extends string | number,
>(
  options: CreateSqliteCollectionOptions<TRow, TKey>,
): SqliteCollection<TRow, TKey> {
  const baseOptions = localOnlyCollectionOptions<TRow, TKey>({
    id: options.id,
    getKey: options.getKey,
    initialData: readAllRows(options.database, options.tableName, options.orderBy),
  })

  let collection!: SqliteCollection<TRow, TKey>

  const readAll = () =>
    readAllRows<TRow>(options.database, options.tableName, options.orderBy)

  const persistMutations = async (transaction: {
    mutations: Array<PendingMutation<any>>
  }) => {
    const relevantMutations = transaction.mutations.filter(
      (mutation): mutation is PendingMutation<TRow> =>
        mutation.collection === collection,
    )

    if (relevantMutations.length === 0) {
      return
    }

    persistSqliteMutations(options, relevantMutations)
    baseOptions.utils.acceptMutations({
      mutations: relevantMutations as Array<PendingMutation<Record<string, unknown>>>,
    })
  }

  const createSqliteTransaction = (
    config?: Omit<TransactionConfig<TRow>, 'mutationFn'>,
  ) =>
    createTransaction<TRow>({
      ...config,
      mutationFn: async ({ transaction }) => {
        await persistMutations(transaction)
      },
    })

  collection = createCollection({
    ...baseOptions,
    id: options.id,
    getKey: options.getKey,
    utils: {
      ...baseOptions.utils,
      readAll,
      persistMutations,
      createSqliteTransaction,
    },
  }) as unknown as SqliteCollection<TRow, TKey>

  return collection
}

function readAllRows<TRow extends object>(
  database: FrontendSqliteDatabase,
  tableName: string,
  orderBy?: string,
): TRow[] {
  const sql = orderBy
    ? `SELECT * FROM "${escapeIdentifier(tableName)}" ORDER BY ${orderBy};`
    : `SELECT * FROM "${escapeIdentifier(tableName)}";`

  return database.query<TRow>(sql)
}

function persistSqliteMutations<TRow extends object>(
  options: CreateSqliteCollectionOptions<TRow, string | number>,
  mutations: Array<PendingMutation<TRow>>,
): void {
  options.database.execute('BEGIN')

  try {
    for (const mutation of mutations) {
      applyMutation(options, mutation)
    }

    options.database.execute('COMMIT')
  } catch (error) {
    try {
      options.database.execute('ROLLBACK')
    } catch {
      // Ignore rollback errors and rethrow the original failure.
    }

    throw error
  }
}

function applyMutation<TRow extends object>(
  options: CreateSqliteCollectionOptions<TRow, string | number>,
  mutation: PendingMutation<TRow>,
): void {
  switch (mutation.type) {
    case 'insert':
      insertRow(options, mutation.modified)
      return
    case 'update':
      updateRow(options, mutation)
      return
    case 'delete':
      deleteRow(options, mutation.key)
      return
  }
}

function insertRow<TRow extends object>(
  options: CreateSqliteCollectionOptions<TRow, string | number>,
  row: TRow,
): void {
  const entries = Object.entries(row)

  if (entries.length === 0) {
    options.database.execute(
      `INSERT INTO "${escapeIdentifier(options.tableName)}" DEFAULT VALUES;`,
    )
    return
  }

  const columns = entries.map(([column]) => `"${escapeIdentifier(column)}"`)
  const values = entries.map(([, value]) => value)
  const placeholders = entries.map(() => '?')

  options.database.execute(
    `INSERT INTO "${escapeIdentifier(options.tableName)}" (${columns.join(', ')}) VALUES (${placeholders.join(', ')});`,
    values,
  )
}

function updateRow<TRow extends object>(
  options: CreateSqliteCollectionOptions<TRow, string | number>,
  mutation: PendingMutation<TRow>,
): void {
  const entries = Object.entries(mutation.changes).filter(
    ([column]) => column !== options.keyColumn,
  )

  if (entries.length === 0) {
    return
  }

  const assignments = entries.map(
    ([column]) => `"${escapeIdentifier(column)}" = ?`,
  )
  const values = entries.map(([, value]) => value)

  options.database.execute(
    `UPDATE "${escapeIdentifier(options.tableName)}" SET ${assignments.join(', ')} WHERE "${escapeIdentifier(options.keyColumn)}" = ?;`,
    [...values, mutation.key],
  )
}

function deleteRow<TRow extends object>(
  options: CreateSqliteCollectionOptions<TRow, string | number>,
  key: string | number,
): void {
  options.database.execute(
    `DELETE FROM "${escapeIdentifier(options.tableName)}" WHERE "${escapeIdentifier(options.keyColumn)}" = ?;`,
    [key],
  )
}

function escapeIdentifier(identifier: string): string {
  return identifier.replaceAll('"', '""')
}
