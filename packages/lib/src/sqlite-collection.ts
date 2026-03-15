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

/**
 * Fluent query builder for SQLite collections.
 *
 * Queries default to using the `by_id` index if no index is specified:
 * ```ts
 * collection.query().collect()           // All rows, ordered by _id ASC
 * collection.query().order('desc').take(10)  // Last 10 by _id
 * ```
 *
 * Use `.withIndex()` for queries on other indexes:
 * ```ts
 * collection.query().withIndex('by_email', q => q.eq('email', 'test@example.com')).first()
 * ```
 */
export interface SqliteQuery<
  TRow extends object,
  TIndexes extends SqliteIndexMap,
> {
  /**
   * Select an index to query. If not called, defaults to `by_id`.
   */
  withIndex<TIndexName extends keyof TIndexes & string>(
    indexName: TIndexName,
    build?:
      | ((
          builder: SqliteIndexRangeBuilder<TRow, TIndexes[TIndexName]['fields']>,
        ) => unknown)
      | undefined,
  ): SqliteQuery<TRow, TIndexes>

  /**
   * Set the sort direction. Defaults to 'asc'.
   */
  order(direction: 'asc' | 'desc'): SqliteQuery<TRow, TIndexes>

  /**
   * Execute the query and return all matching rows.
   */
  collect(): Promise<TRow[]>

  /**
   * Execute the query and return the first matching row, or null.
   */
  first(): Promise<TRow | null>

  /**
   * Execute the query and return the single matching row.
   * Throws if more than one row matches.
   */
  unique(): Promise<TRow | null>

  /**
   * Execute the query and return up to `limit` rows.
   */
  take(limit: number): Promise<TRow[]>
}

// Keep old interface names as aliases for backwards compatibility
export type SqliteQueryInitializer<
  TRow extends object,
  TIndexes extends SqliteIndexMap,
> = SqliteQuery<TRow, TIndexes>

export type SqliteIndexedQuery<TRow extends object> = SqliteQuery<TRow, Record<string, never>>

type StructuredColumnKind = 'array' | 'object' | 'record'
type StructuredColumns = Partial<Record<string, StructuredColumnKind>>

function getStructuredColumnKind(columnType: string): StructuredColumnKind | null {
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
  const structuredColumns: StructuredColumns = {}

  for (const column of columns) {
    const kind = getStructuredColumnKind(column.type)

    if (kind !== null) {
      structuredColumns[column.name] = kind
    }
  }

  return structuredColumns
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
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

function serializeStructuredValue(
  kind: StructuredColumnKind,
  value: unknown,
): unknown {
  if (value === null || value === undefined) {
    return value
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)

      if (isStructuredValue(kind, parsed)) {
        return value
      }
    } catch {
      // Fall through and encode the raw string as JSON.
    }
  }

  return JSON.stringify(value)
}

function serializeColumnValue(
  columnName: string,
  value: unknown,
  structuredColumns: StructuredColumns,
): unknown {
  const kind = structuredColumns[columnName]

  if (!kind) {
    return value
  }

  return serializeStructuredValue(kind, value)
}

function serializeRowValues(
  row: Record<string, unknown>,
  structuredColumns: StructuredColumns,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([columnName, value]) => [
      columnName,
      serializeColumnValue(columnName, value, structuredColumns),
    ]),
  )
}

function deserializeStructuredValue(
  kind: StructuredColumnKind,
  value: unknown,
): unknown {
  if (typeof value !== 'string') {
    return value
  }

  try {
    const parsed = JSON.parse(value)

    return isStructuredValue(kind, parsed) ? parsed : value
  } catch {
    return value
  }
}

function deserializeRowValues<TRow extends object>(
  row: Record<string, unknown>,
  structuredColumns: StructuredColumns,
): TRow {
  return Object.fromEntries(
    Object.entries(row).map(([columnName, value]) => {
      const kind = structuredColumns[columnName]

      if (!kind) {
        return [columnName, value]
      }

      return [columnName, deserializeStructuredValue(kind, value)]
    }),
  ) as TRow
}

export async function createSqliteCollection<
  TRow extends object,
  TKey extends string | number,
  TIndexes extends SqliteIndexMap = Record<string, never>,
>(
  options: CreateSqliteCollectionOptions<TRow, TKey, TIndexes>,
): Promise<SqliteCollection<TRow, TKey, TIndexes>> {
  // Cache table columns for system fields (avoid repeated async calls)
  const tableColumns = await options.database.getTableColumns(options.tableName)
  const columnNames = new Set(tableColumns.map((column) => column.name))
  const structuredColumns = getStructuredColumns(tableColumns)

  // Load initial data asynchronously (ordered by _id)
  const initialData = await readAllRows<TRow>(
    options.database,
    options.tableName,
    structuredColumns,
  )

  const baseOptions = localOnlyCollectionOptions<TRow, TKey>({
    id: options.id,
    getKey: options.getKey,
    initialData,
  })

  let collection!: SqliteCollection<TRow, TKey, TIndexes>

  const readAll = () =>
    readAllRows<TRow>(options.database, options.tableName, structuredColumns)

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
      structuredColumns,
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
    createSqliteQuery<TRow, TIndexes>(
      options.database,
      options.tableName,
      options.indexes ?? ({} as TIndexes),
      structuredColumns,
    )

  return collection
}

async function readAllRows<TRow extends object>(
  database: AsyncSqliteDatabase,
  tableName: string,
  structuredColumns: StructuredColumns,
): Promise<TRow[]> {
  const rows = await database.query<Record<string, unknown>>(
    `SELECT * FROM "${escapeIdentifier(tableName)}" ORDER BY "_id" ASC;`,
  )

  return rows.map((row) => deserializeRowValues<TRow>(row, structuredColumns))
}

function createSqliteQuery<
  TRow extends object,
  TIndexes extends SqliteIndexMap,
>(
  database: AsyncSqliteDatabase,
  tableName: string,
  indexes: TIndexes,
  structuredColumns: StructuredColumns,
  initialIndexFields: readonly string[] = ['_id'],
  initialRange: SqliteQueryRangeState = { equals: [], lowerBound: null, upperBound: null },
): SqliteQuery<TRow, TIndexes> {
  let indexFields = initialIndexFields
  let range = initialRange
  let direction: 'asc' | 'desc' = 'asc'

  const run = async (limit?: number): Promise<TRow[]> => {
    const { sql, bind } = buildIndexedSelectSql(
      tableName,
      indexFields,
      range,
      direction,
      structuredColumns,
      limit,
    )
    const rows = await database.query<Record<string, unknown>>(sql, bind as any)
    return rows.map((row) => deserializeRowValues<TRow>(row, structuredColumns))
  }

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

      indexFields = runtimeIndex.fields
      range = rangeBuilder.getState()
      return this
    },
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
  structuredColumns: StructuredColumns,
): Promise<void> {
  await options.database.execute('BEGIN')

  try {
    for (const mutation of mutations) {
      await applyMutation(options, mutation, columnNames, structuredColumns)
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
  structuredColumns: StructuredColumns,
): Promise<void> {
  const snapshotQuery = buildMutationSnapshotQuery(options, mutation.key)
  const beforeRows = await queryMutationRows(
    options.database,
    snapshotQuery,
    structuredColumns,
  )

  switch (mutation.type) {
    case 'insert':
      await insertRow(options, mutation.modified, columnNames, structuredColumns)
      break
    case 'update':
      await updateRow(options, mutation, columnNames, structuredColumns)
      break
    case 'delete':
      await deleteRow(options, mutation.key)
      break
  }

  const afterRows = await queryMutationRows(
    options.database,
    snapshotQuery,
    structuredColumns,
  )
  logMutationDiff(options, mutation, snapshotQuery, beforeRows, afterRows)
}

interface MutationSnapshotQuery {
  sql: string
  whereClause: string
  bind: Array<string | number>
}

interface MutationRowDiff {
  rowIndex: number
  changeType: 'inserted' | 'updated' | 'deleted' | 'unchanged'
  changes: Record<string, { before: unknown; after: unknown }>
}

function buildMutationSnapshotQuery<TRow extends object>(
  options: CreateSqliteCollectionOptions<TRow, string | number, SqliteIndexMap>,
  key: string | number,
): MutationSnapshotQuery {
  const escapedTableName = escapeIdentifier(options.tableName)
  const escapedKeyColumn = escapeIdentifier(options.keyColumn)
  const whereClause = `WHERE "${escapedKeyColumn}" = ?`

  return {
    sql: `SELECT * FROM "${escapedTableName}" ${whereClause} ORDER BY "${escapedKeyColumn}" ASC;`,
    whereClause,
    bind: [key],
  }
}

async function queryMutationRows(
  database: AsyncSqliteDatabase,
  snapshotQuery: MutationSnapshotQuery,
  structuredColumns: StructuredColumns,
): Promise<Array<Record<string, unknown>>> {
  const rows = await database.query<Record<string, unknown>>(
    snapshotQuery.sql,
    snapshotQuery.bind,
  )

  return rows.map((row) => deserializeRowValues(row, structuredColumns))
}

function logMutationDiff<TRow extends object>(
  options: CreateSqliteCollectionOptions<TRow, string | number, SqliteIndexMap>,
  mutation: PendingMutation<TRow>,
  snapshotQuery: MutationSnapshotQuery,
  beforeRows: Array<Record<string, unknown>>,
  afterRows: Array<Record<string, unknown>>,
): void {
  const rowDiffs = buildMutationRowDiffs(beforeRows, afterRows)
  console.dir(
    {
      tableName: options.tableName,
      mutationType: mutation.type,
      keyColumn: options.keyColumn,
      key: mutation.key,
      snapshotSql: snapshotQuery.sql,
      whereClause: snapshotQuery.whereClause,
      whereBind: snapshotQuery.bind,
      rowDiffs,
    },
    { depth: null },
  )
}

function buildMutationRowDiffs(
  beforeRows: Array<Record<string, unknown>>,
  afterRows: Array<Record<string, unknown>>,
): MutationRowDiff[] {
  const rowCount = Math.max(beforeRows.length, afterRows.length)
  const diffs: MutationRowDiff[] = []

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const beforeRow = beforeRows[rowIndex]
    const afterRow = afterRows[rowIndex]
    const changes = diffRowValues(beforeRow, afterRow)

    diffs.push({
      rowIndex,
      changeType:
        beforeRow === undefined
          ? 'inserted'
          : afterRow === undefined
            ? 'deleted'
            : Object.keys(changes).length === 0
              ? 'unchanged'
              : 'updated',
      changes,
    })
  }

  return diffs
}

function diffRowValues(
  beforeRow: Record<string, unknown> | undefined,
  afterRow: Record<string, unknown> | undefined,
): Record<string, { before: unknown; after: unknown }> {
  const changes: Record<string, { before: unknown; after: unknown }> = {}
  const keys = new Set([
    ...Object.keys(beforeRow ?? {}),
    ...Object.keys(afterRow ?? {}),
  ])

  for (const key of keys) {
    const beforeValue = beforeRow?.[key]
    const afterValue = afterRow?.[key]

    if (Object.is(beforeValue, afterValue)) {
      continue
    }

    changes[key] = {
      before: beforeValue,
      after: afterValue,
    }
  }

  return changes
}

async function insertRow<TRow extends object>(
  options: CreateSqliteCollectionOptions<TRow, string | number, SqliteIndexMap>,
  row: TRow,
  columnNames: Set<string>,
  structuredColumns: StructuredColumns,
): Promise<void> {
  const completeRow = withInsertSystemFields(row, columnNames)
  await validateReferenceColumns(options, completeRow)
  const serializedRow = serializeRowValues(completeRow, structuredColumns)
  const entries = Object.entries(serializedRow)

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
  structuredColumns: StructuredColumns,
): Promise<void> {
  const changes = withUpdateSystemFields(mutation.changes, columnNames)
  await validateReferenceColumns(options, changes)
  const serializedChanges = serializeRowValues(changes, structuredColumns)
  const entries = Object.entries(serializedChanges).filter(
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
  structuredColumns: StructuredColumns,
  limit?: number,
): { sql: string; bind: unknown[] } {
  const whereClauses: string[] = []
  const bind: unknown[] = []

  for (const equality of range.equals) {
    appendWhereClause(
      whereClauses,
      bind,
      equality.field,
      '=',
      equality.value,
      structuredColumns,
    )
  }

  if (range.lowerBound) {
    appendWhereClause(
      whereClauses,
      bind,
      range.lowerBound.field,
      range.lowerBound.operator,
      range.lowerBound.value,
      structuredColumns,
    )
  }

  if (range.upperBound) {
    appendWhereClause(
      whereClauses,
      bind,
      range.upperBound.field,
      range.upperBound.operator,
      range.upperBound.value,
      structuredColumns,
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
  structuredColumns: StructuredColumns,
): void {
  whereClauses.push(`${fieldPathToSqlExpression(field)} ${operator} ?`)
  bind.push(serializeQueryValue(field, value, structuredColumns))
}

function serializeQueryValue(
  fieldPath: string,
  value: unknown,
  structuredColumns: StructuredColumns,
): unknown {
  if (value === null || value === undefined) {
    return value
  }

  const [rootField] = fieldPath.split('.')

  if (!rootField) {
    return value
  }

  const kind = structuredColumns[rootField]

  if (!kind) {
    return value
  }

  if (!fieldPath.includes('.')) {
    return serializeStructuredValue(kind, value)
  }

  return isPlainObject(value) || Array.isArray(value)
    ? JSON.stringify(value)
    : value
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
