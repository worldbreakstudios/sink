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
import type { AsyncSqliteDatabase } from './sqlite'

export interface CreateSqliteCollectionOptions<
  TRow extends object,
  TKey extends string | number,
  TIndexes extends SqliteIndexMap = Record<string, never>,
> {
  id: string
  tableName: string
  keyColumn: keyof TRow & string
  getKey: (row: TRow) => TKey
  database: AsyncSqliteDatabase
  orderBy?: string
  referenceColumns?: Partial<Record<keyof TRow & string, SqliteReferenceColumn>>
  indexes?: TIndexes
}

export interface SqliteReferenceColumn {
  referencedTable: string
  enforceExists: boolean
}

export interface SqliteIndexDefinition<
  TFields extends readonly string[] = readonly string[],
> {
  fields: TFields
  unique: boolean
}

export type SqliteIndexMap = Record<string, SqliteIndexDefinition<readonly string[]>>

export interface SqliteCollectionUtils<TRow extends object>
  extends LocalOnlyCollectionUtils {
  readAll(): Promise<TRow[]>
  persistMutations(transaction: { mutations: Array<PendingMutation<any>> }): Promise<void>
  createSqliteTransaction(
    config?: Omit<TransactionConfig<TRow>, 'mutationFn'>,
  ): Transaction<TRow>
}

export type SqliteCollection<
  TRow extends object,
  TKey extends string | number,
  TIndexes extends SqliteIndexMap = Record<string, never>,
> = Collection<TRow, TKey, SqliteCollectionUtils<TRow>> & {
  query(): SqliteQueryInitializer<TRow, TIndexes>
}

type Head<TFields extends readonly string[]> = TFields extends readonly [
  infer THead extends string,
  ...readonly string[],
]
  ? THead
  : never

type Tail<TFields extends readonly string[]> = TFields extends readonly [
  string,
  ...infer TRest extends readonly string[],
]
  ? TRest
  : []

type IndexFieldValue<TRow, TField extends string> = TField extends keyof TRow
  ? TRow[TField]
  : unknown

export interface SqliteIndexRangeBuilder<
  TRow extends object,
  TFields extends readonly string[],
> {
  eq<TField extends Head<TFields>>(
    field: TField,
    value: IndexFieldValue<TRow, TField>,
  ): SqliteIndexRangeBuilder<TRow, Tail<TFields>>
  gt<TField extends Head<TFields>>(
    field: TField,
    value: IndexFieldValue<TRow, TField>,
  ): SqliteBoundIndexRangeBuilder<TRow, TField, false, true>
  gte<TField extends Head<TFields>>(
    field: TField,
    value: IndexFieldValue<TRow, TField>,
  ): SqliteBoundIndexRangeBuilder<TRow, TField, false, true>
  lt<TField extends Head<TFields>>(
    field: TField,
    value: IndexFieldValue<TRow, TField>,
  ): SqliteBoundIndexRangeBuilder<TRow, TField, true, false>
  lte<TField extends Head<TFields>>(
    field: TField,
    value: IndexFieldValue<TRow, TField>,
  ): SqliteBoundIndexRangeBuilder<TRow, TField, true, false>
}

export interface SqliteBoundIndexRangeBuilder<
  TRow extends object,
  TField extends string,
  THasLower extends boolean,
  THasUpper extends boolean,
> {
  gt<TNextField extends THasLower extends true ? never : TField>(
    field: TNextField,
    value: IndexFieldValue<TRow, TNextField>,
  ): SqliteBoundIndexRangeBuilder<TRow, TField, true, THasUpper>
  gte<TNextField extends THasLower extends true ? never : TField>(
    field: TNextField,
    value: IndexFieldValue<TRow, TNextField>,
  ): SqliteBoundIndexRangeBuilder<TRow, TField, true, THasUpper>
  lt<TNextField extends THasUpper extends true ? never : TField>(
    field: TNextField,
    value: IndexFieldValue<TRow, TNextField>,
  ): SqliteBoundIndexRangeBuilder<TRow, TField, THasLower, true>
  lte<TNextField extends THasUpper extends true ? never : TField>(
    field: TNextField,
    value: IndexFieldValue<TRow, TNextField>,
  ): SqliteBoundIndexRangeBuilder<TRow, TField, THasLower, true>
}

export interface SqliteQueryInitializer<
  TRow extends object,
  TIndexes extends SqliteIndexMap,
> {
  withIndex<TIndexName extends keyof TIndexes & string>(
    indexName: TIndexName,
    build?:
      | ((
          builder: SqliteIndexRangeBuilder<TRow, TIndexes[TIndexName]['fields']>,
        ) => unknown)
      | undefined,
  ): SqliteIndexedQuery<TRow>
}

export interface SqliteIndexedQuery<TRow extends object> {
  order(direction: 'asc' | 'desc'): SqliteIndexedQuery<TRow>
  collect(): Promise<TRow[]>
  first(): Promise<TRow | null>
  unique(): Promise<TRow | null>
  take(limit: number): Promise<TRow[]>
}

export async function createSqliteCollection<
  TRow extends object,
  TKey extends string | number,
  TIndexes extends SqliteIndexMap = Record<string, never>,
>(
  options: CreateSqliteCollectionOptions<TRow, TKey, TIndexes>,
): Promise<SqliteCollection<TRow, TKey, TIndexes>> {
  // Load initial data asynchronously
  const initialData = await readAllRows<TRow>(options.database, options.tableName, options.orderBy)

  // Cache table columns for system fields (avoid repeated async calls)
  const tableColumns = await options.database.getTableColumns(options.tableName)
  const columnNames = new Set(tableColumns.map((column) => column.name))

  const baseOptions = localOnlyCollectionOptions<TRow, TKey>({
    id: options.id,
    getKey: options.getKey,
    initialData,
  })

  let collection!: SqliteCollection<TRow, TKey, TIndexes>

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

    await persistSqliteMutations(
      options as unknown as CreateSqliteCollectionOptions<
        TRow,
        string | number,
        SqliteIndexMap
      >,
      relevantMutations,
      columnNames,
    )
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
  }) as unknown as SqliteCollection<TRow, TKey, TIndexes>

  collection.query = () =>
    createSqliteQueryInitializer<TRow, TIndexes>(
      options.database,
      options.tableName,
      options.indexes ?? ({} as TIndexes),
    )

  return collection
}

async function readAllRows<TRow extends object>(
  database: AsyncSqliteDatabase,
  tableName: string,
  orderBy?: string,
): Promise<TRow[]> {
  const sql = orderBy
    ? `SELECT * FROM "${escapeIdentifier(tableName)}" ORDER BY ${orderBy};`
    : `SELECT * FROM "${escapeIdentifier(tableName)}";`

  return database.query<TRow>(sql)
}

function createSqliteQueryInitializer<
  TRow extends object,
  TIndexes extends SqliteIndexMap,
>(
  database: AsyncSqliteDatabase,
  tableName: string,
  indexes: TIndexes,
): SqliteQueryInitializer<TRow, TIndexes> {
  return {
    withIndex(indexName, build) {
      const runtimeIndex = indexes[indexName]

      if (!runtimeIndex) {
        throw new Error(`Index "${String(indexName)}" not found on table "${tableName}".`)
      }

      const rangeBuilder = new RuntimeIndexRangeBuilder<TRow>()

      if (build) {
        build(
          rangeBuilder as unknown as SqliteIndexRangeBuilder<
            TRow,
            TIndexes[typeof indexName]['fields']
          >,
        )
      }

      return createIndexedQuery<TRow>(
        database,
        tableName,
        runtimeIndex.fields,
        rangeBuilder.getState(),
      )
    },
  }
}

function createIndexedQuery<TRow extends object>(
  database: AsyncSqliteDatabase,
  tableName: string,
  indexFields: readonly string[],
  range: SqliteQueryRangeState,
): SqliteIndexedQuery<TRow> {
  let direction: 'asc' | 'desc' = 'asc'

  const run = async (limit?: number): Promise<TRow[]> => {
    const { sql, bind } = buildIndexedSelectSql(
      tableName,
      indexFields,
      range,
      direction,
      limit,
    )
    return database.query<TRow>(sql, bind as any)
  }

  return {
    order(nextDirection) {
      direction = nextDirection
      return this
    },
    async collect() {
      return run()
    },
    async first() {
      const rows = await run(1)
      return rows[0] ?? null
    },
    async unique() {
      const rows = await run(2)

      if (rows.length > 1) {
        throw new Error('Expected a unique result, but found multiple rows.')
      }

      return rows[0] ?? null
    },
    async take(limit) {
      return run(limit)
    },
  }
}

async function persistSqliteMutations<TRow extends object>(
  options: CreateSqliteCollectionOptions<TRow, string | number, SqliteIndexMap>,
  mutations: Array<PendingMutation<TRow>>,
  columnNames: Set<string>,
): Promise<void> {
  await options.database.execute('BEGIN')

  try {
    for (const mutation of mutations) {
      await applyMutation(options, mutation, columnNames)
    }

    await options.database.execute('COMMIT')
  } catch (error) {
    try {
      await options.database.execute('ROLLBACK')
    } catch {
      // Ignore rollback errors and rethrow the original failure.
    }

    throw error
  }
}

async function applyMutation<TRow extends object>(
  options: CreateSqliteCollectionOptions<TRow, string | number, SqliteIndexMap>,
  mutation: PendingMutation<TRow>,
  columnNames: Set<string>,
): Promise<void> {
  switch (mutation.type) {
    case 'insert':
      await insertRow(options, mutation.modified, columnNames)
      return
    case 'update':
      await updateRow(options, mutation, columnNames)
      return
    case 'delete':
      await deleteRow(options, mutation.key)
      return
  }
}

async function insertRow<TRow extends object>(
  options: CreateSqliteCollectionOptions<TRow, string | number, SqliteIndexMap>,
  row: TRow,
  columnNames: Set<string>,
): Promise<void> {
  const completeRow = withInsertSystemFields(row, columnNames)
  await validateReferenceColumns(options, completeRow)
  const entries = Object.entries(completeRow)

  if (entries.length === 0) {
    await options.database.execute(
      `INSERT INTO "${escapeIdentifier(options.tableName)}" DEFAULT VALUES;`,
    )
    return
  }

  const columns = entries.map(([column]) => `"${escapeIdentifier(column)}"`)
  const values = entries.map(([, value]) => value) as any[]
  const placeholders = entries.map(() => '?')

  await options.database.execute(
    `INSERT INTO "${escapeIdentifier(options.tableName)}" (${columns.join(', ')}) VALUES (${placeholders.join(', ')});`,
    values,
  )
}

async function updateRow<TRow extends object>(
  options: CreateSqliteCollectionOptions<TRow, string | number, SqliteIndexMap>,
  mutation: PendingMutation<TRow>,
  columnNames: Set<string>,
): Promise<void> {
  const changes = withUpdateSystemFields(mutation.changes, columnNames)
  await validateReferenceColumns(options, changes)
  const entries = Object.entries(changes).filter(
    ([column]) => column !== options.keyColumn,
  )

  if (entries.length === 0) {
    return
  }

  const assignments = entries.map(
    ([column]) => `"${escapeIdentifier(column)}" = ?`,
  )
  const values = entries.map(([, value]) => value) as any[]

  await options.database.execute(
    `UPDATE "${escapeIdentifier(options.tableName)}" SET ${assignments.join(', ')} WHERE "${escapeIdentifier(options.keyColumn)}" = ?;`,
    [...values, mutation.key],
  )
}

async function deleteRow<TRow extends object>(
  options: CreateSqliteCollectionOptions<TRow, string | number, SqliteIndexMap>,
  key: string | number,
): Promise<void> {
  await options.database.execute(
    `DELETE FROM "${escapeIdentifier(options.tableName)}" WHERE "${escapeIdentifier(options.keyColumn)}" = ?;`,
    [key],
  )
}

function escapeIdentifier(identifier: string): string {
  return identifier.replaceAll('"', '""')
}

function withInsertSystemFields<TRow extends object>(
  row: TRow,
  columnNames: Set<string>,
): Record<string, unknown> {
  const nextRow = { ...(row as Record<string, unknown>) }

  if (columnNames.has('_createdAt') && nextRow._createdAt === undefined) {
    nextRow._createdAt = currentTimestamp()
  }

  if (columnNames.has('_updatedAt') && nextRow._updatedAt === undefined) {
    nextRow._updatedAt = currentTimestamp()
  }

  if (columnNames.has('_archivedAt') && nextRow._archivedAt === undefined) {
    nextRow._archivedAt = null
  }

  return nextRow
}

function withUpdateSystemFields<TRow extends object>(
  changes: Partial<TRow>,
  columnNames: Set<string>,
): Record<string, unknown> {
  const nextChanges = { ...(changes as Record<string, unknown>) }

  if (columnNames.has('_updatedAt') && nextChanges._updatedAt === undefined) {
    nextChanges._updatedAt = currentTimestamp()
  }

  return nextChanges
}

async function validateReferenceColumns<TRow extends object>(
  options: CreateSqliteCollectionOptions<TRow, string | number, SqliteIndexMap>,
  rowOrChanges: Record<string, unknown>,
): Promise<void> {
  const referenceColumns = options.referenceColumns as
    | Record<string, SqliteReferenceColumn | undefined>
    | undefined

  for (const [columnName, config] of Object.entries(referenceColumns ?? {})) {
    if (!config?.enforceExists || !(columnName in rowOrChanges)) {
      continue
    }

    const value = rowOrChanges[columnName]

    if (value === null || value === undefined || value === '') {
      continue
    }

    const exists = await options.database.rowExists(config.referencedTable, value as any)
    if (!exists) {
      throw new Error(
        `Referenced ${config.referencedTable} row "${String(value)}" does not exist.`,
      )
    }
  }
}

function currentTimestamp(): bigint {
  return BigInt(Date.now())
}

type SqliteComparisonOperator = '=' | '>' | '>=' | '<' | '<='

interface SqliteQueryRangeState {
  equals: Array<{ field: string; value: unknown }>
  lowerBound: { field: string; value: unknown; operator: '>' | '>=' } | null
  upperBound: { field: string; value: unknown; operator: '<' | '<=' } | null
}

class RuntimeIndexRangeBuilder<TRow extends object>
  implements SqliteIndexRangeBuilder<TRow, readonly string[]>,
    SqliteBoundIndexRangeBuilder<TRow, string, boolean, boolean>
{
  private state: SqliteQueryRangeState = {
    equals: [],
    lowerBound: null,
    upperBound: null,
  }

  eq(field: string, value: unknown) {
    this.state.equals.push({ field, value })
    return this as unknown as RuntimeIndexRangeBuilder<TRow>
  }

  gt(field: string, value: unknown) {
    this.setBound(field, value, '>')
    return this as unknown as RuntimeIndexRangeBuilder<TRow>
  }

  gte(field: string, value: unknown) {
    this.setBound(field, value, '>=')
    return this as unknown as RuntimeIndexRangeBuilder<TRow>
  }

  lt(field: string, value: unknown) {
    this.setBound(field, value, '<')
    return this as unknown as RuntimeIndexRangeBuilder<TRow>
  }

  lte(field: string, value: unknown) {
    this.setBound(field, value, '<=')
    return this as unknown as RuntimeIndexRangeBuilder<TRow>
  }

  getState(): SqliteQueryRangeState {
    return {
      equals: [...this.state.equals],
      lowerBound: this.state.lowerBound,
      upperBound: this.state.upperBound,
    }
  }

  private setBound(
    field: string,
    value: unknown,
    operator: Exclude<SqliteComparisonOperator, '='>,
  ): void {
    const target =
      operator === '>' || operator === '>=' ? 'lowerBound' : 'upperBound'
    const existing = this.state[target]

    if (existing !== null && existing.field !== field) {
      throw new Error(`Index range bound must stay on field "${existing.field}".`)
    }

    if (target === 'lowerBound') {
      this.state.lowerBound = { field, value, operator: operator as '>' | '>=' }
      return
    }

    this.state.upperBound = { field, value, operator: operator as '<' | '<=' }
  }
}

function buildIndexedSelectSql(
  tableName: string,
  indexFields: readonly string[],
  range: SqliteQueryRangeState,
  direction: 'asc' | 'desc',
  limit?: number,
): { sql: string; bind: unknown[] } {
  const whereClauses: string[] = []
  const bind: unknown[] = []

  for (const equality of range.equals) {
    appendWhereClause(whereClauses, bind, equality.field, '=', equality.value)
  }

  if (range.lowerBound) {
    appendWhereClause(
      whereClauses,
      bind,
      range.lowerBound.field,
      range.lowerBound.operator,
      range.lowerBound.value,
    )
  }

  if (range.upperBound) {
    appendWhereClause(
      whereClauses,
      bind,
      range.upperBound.field,
      range.upperBound.operator,
      range.upperBound.value,
    )
  }

  const whereSql =
    whereClauses.length > 0 ? ` WHERE ${whereClauses.join(' AND ')}` : ''
  const orderSql = ` ORDER BY ${indexFields
    .map((field) => `${fieldPathToSqlExpression(field)} ${direction.toUpperCase()}`)
    .join(', ')}`
  const limitSql = limit !== undefined ? ' LIMIT ?' : ''

  if (limit !== undefined) {
    bind.push(limit)
  }

  return {
    sql: `SELECT * FROM "${escapeIdentifier(tableName)}"${whereSql}${orderSql}${limitSql};`,
    bind,
  }
}

function appendWhereClause(
  whereClauses: string[],
  bind: unknown[],
  field: string,
  operator: SqliteComparisonOperator,
  value: unknown,
): void {
  whereClauses.push(`${fieldPathToSqlExpression(field)} ${operator} ?`)
  bind.push(value)
}

function fieldPathToSqlExpression(fieldPath: string): string {
  if (!fieldPath.includes('.')) {
    return `"${escapeIdentifier(fieldPath)}"`
  }

  const [root, ...segments] = fieldPath.split('.')
  const jsonPath = `$.${segments.join('.')}`
  if (!root) {
    throw new Error(`Invalid field path "${fieldPath}".`)
  }
  return `json_extract("${escapeIdentifier(root)}", '${jsonPath.replace(/'/g, "''")}')`
}
