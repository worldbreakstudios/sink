import { syncValuesEqual } from './sync-runtime-json.js'
import type {
  MutableSyncCollection,
  SyncBatchTransactionLike,
  SyncInvalidationTarget,
  SyncLockTarget,
  SyncMutationPolicyContext,
  SyncOrderClause,
  SyncQueryLocalContext,
  SyncQueryPolicyContext,
  SyncSchemaMetadata,
  SyncServerOperationContext,
  SyncTableMetadata,
  SyncWhereClause,
  TablePolicyHooks,
} from './sync-runtime-types.js'

export function getSyncCollection(
  collections: object,
  tableName: string,
): MutableSyncCollection {
  const collection = (collections as Record<string, unknown>)[tableName] as
    | MutableSyncCollection
    | undefined

  if (!collection) {
    throw new Error(`Missing collection for table "${tableName}".`)
  }

  return collection
}

export function readLocalRowsForTable(
  collections: object,
  tableName: string,
): Array<Record<string, unknown>>
export function readLocalRowsForTable<TRow extends object>(
  collections: object,
  tableName: string,
): TRow[]
export function readLocalRowsForTable<TRow extends object>(
  collections: object,
  tableName: string,
): TRow[] {
  return [...getSyncCollection(collections, tableName).toArray] as TRow[]
}

export function getRowKey(
  tableMetadata: SyncTableMetadata,
  row: object,
): unknown {
  const keyColumns = tableMetadata.keyColumns
  const rowRecord = row as Record<string, unknown>

  if (keyColumns.length === 1) {
    return rowRecord[keyColumns[0] ?? '_id']
  }

  return Object.fromEntries(
    keyColumns.map((columnName) => [columnName, rowRecord[columnName]]),
  )
}

export function serializeRowKey(
  keyColumns: readonly string[],
  key: unknown,
): string {
  if (
    keyColumns.length === 1 &&
    (typeof key === 'string' ||
      typeof key === 'number' ||
      typeof key === 'bigint')
  ) {
    return String(key)
  }

  const record = key as Record<string, unknown>

  return JSON.stringify(
    keyColumns.map((columnName) => [
      columnName,
      normalizeSerializableValue(record[columnName]),
    ]),
  )
}

export function serializeInvalidationKey(
  metadata: SyncSchemaMetadata,
  tableName: string,
  key: unknown,
): string {
  return serializeRowKey(metadata.tables[tableName]?.keyColumns ?? ['_id'], key)
}

export function normalizeSerializableValue(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString()
  }

  return value ?? null
}

export function serializeLockValues(
  values: Record<string, unknown>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      String(normalizeSerializableValue(value)),
    ]),
  )
}

export function createPrimaryLockTarget(
  tableMetadata: SyncTableMetadata,
  tableName: string,
  key: unknown,
): SyncLockTarget {
  const keyColumns = tableMetadata.keyColumns

  if (
    keyColumns.length === 1 &&
    (typeof key === 'string' ||
      typeof key === 'number' ||
      typeof key === 'bigint')
  ) {
    return {
      tableName,
      kind: 'primary',
      keyName: keyColumns[0] ?? '_id',
      values: {
        [keyColumns[0] ?? '_id']: String(key),
      },
    }
  }

  const record = key as Record<string, unknown>

  return {
    tableName,
    kind: 'primary',
    keyName: keyColumns.join('+'),
    values: serializeLockValues(
      Object.fromEntries(
        keyColumns.map((columnName) => [columnName, record[columnName]]),
      ),
    ),
  }
}

export function createUniqueLockTarget(
  tableName: string,
  uniqueName: string,
  values: Record<string, unknown>,
): SyncLockTarget {
  return {
    tableName,
    kind: 'unique',
    keyName: uniqueName,
    values: serializeLockValues(values),
  }
}

export async function reconcileScopedRows(
  context: SyncQueryLocalContext<Record<string, unknown>>,
  metadata: SyncSchemaMetadata,
  tableName: string,
  nextRows: object[],
  scope: (row: object) => boolean,
): Promise<void> {
  const tableMetadata = metadata.tables[tableName]

  if (!tableMetadata) {
    throw new Error(`Unknown sync table "${tableName}".`)
  }

  const protectedKeys = await context.getProtectedRowKeys(tableName)
  const currentRows = readLocalRowsForTable(context.collections, tableName)
  const currentScopedRows = currentRows.filter(scope)
  const nextByKey = new Map(
    nextRows.map((row) => [
      serializeRowKey(tableMetadata.keyColumns, getRowKey(tableMetadata, row)),
      row,
    ]),
  )
  const currentByKey = new Map(
    currentScopedRows.map((row) => [
      serializeRowKey(tableMetadata.keyColumns, getRowKey(tableMetadata, row)),
      row,
    ]),
  )
  const tx = context.createBatchTransaction(context.collections, {
    autoCommit: false,
  }) as SyncBatchTransactionLike
  const collection = getSyncCollection(context.collections, tableName)

  tx.mutate(() => {
    for (const row of currentScopedRows) {
      const key = getRowKey(tableMetadata, row)
      const serializedKey = serializeRowKey(tableMetadata.keyColumns, key)

      if (protectedKeys.has(serializedKey) || nextByKey.has(serializedKey)) {
        continue
      }

      collection.delete(key)
    }

    for (const nextRow of nextRows) {
      const key = getRowKey(tableMetadata, nextRow)
      const serializedKey = serializeRowKey(tableMetadata.keyColumns, key)

      if (protectedKeys.has(serializedKey)) {
        continue
      }

      const currentRow = currentByKey.get(serializedKey)

      if (!currentRow) {
        collection.insert(nextRow)
        continue
      }

      if (syncValuesEqual(currentRow, nextRow)) {
        continue
      }

      collection.update(key, (draft) => {
        Object.assign(draft, nextRow)
      })
    }
  })

  await tx.commit()
}

export function invalidationTouchesTable(
  targets: SyncInvalidationTarget[],
  tableName: string,
): boolean {
  return targets.some((target) => target.tableName === tableName)
}

export function rowMatchesWhere(
  row: object,
  where: readonly SyncWhereClause[],
): boolean {
  return where.every((clause) => getFieldValue(row, clause.column) === clause.equals)
}

export function sortRows<TRow extends object>(
  rows: TRow[],
  orderBy: readonly SyncOrderClause[],
): TRow[] {
  if (orderBy.length === 0) {
    return [...rows]
  }

  return [...rows].sort((left, right) => {
    for (const order of orderBy) {
      const leftValue = getFieldValue(left, order.column)
      const rightValue = getFieldValue(right, order.column)

      if (leftValue === rightValue) {
        continue
      }

      const direction = order.direction === 'desc' ? -1 : 1

      if (leftValue === null || leftValue === undefined) {
        return -1 * direction
      }

      if (rightValue === null || rightValue === undefined) {
        return 1 * direction
      }

      if (typeof leftValue === 'bigint' && typeof rightValue === 'bigint') {
        return leftValue < rightValue ? -1 * direction : 1 * direction
      }

      if (leftValue < rightValue) {
        return -1 * direction
      }

      if (leftValue > rightValue) {
        return 1 * direction
      }
    }

    return 0
  })
}

export function getFieldValue(
  row: object,
  field: string,
): unknown {
  const path = field.split('.')
  let current: unknown = row

  for (const segment of path) {
    if (!current || typeof current !== 'object') {
      return undefined
    }

    current = (current as Record<string, unknown>)[segment]
  }

  return current
}

export function assertAuthorized(
  result: boolean | void,
  operationName: string,
): void {
  if (result === false) {
    throw new Error(`Not authorized to execute "${operationName}".`)
  }
}

export async function resolveReadScope<TArgs, TAuthContext>(
  policy: TablePolicyHooks<TAuthContext> | undefined,
  context: SyncQueryPolicyContext<TArgs, TAuthContext>,
): Promise<SyncWhereClause[]> {
  return (await policy?.readScope?.(
    context as SyncQueryPolicyContext<unknown, TAuthContext>,
  )) ?? []
}

export async function runMutationPolicyInputPhases<TArgs, TAuthContext>(
  policy: TablePolicyHooks<TAuthContext> | undefined,
  context: SyncMutationPolicyContext<TArgs, unknown, TAuthContext>,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  assertAuthorized(
    await policy?.authorize?.(
      context as SyncMutationPolicyContext<unknown, unknown, TAuthContext>,
    ),
    context.operationName,
  )
  await policy?.validateInput?.(
    context as SyncMutationPolicyContext<unknown, unknown, TAuthContext>,
  )

  return (
    (await policy?.transformInput?.({
      ...(context as SyncMutationPolicyContext<
        unknown,
        unknown,
        TAuthContext
      >),
      input,
    })) ?? input
  )
}

export async function runMutationPolicyExistingPhases<TArgs, TAuthContext>(
  policy: TablePolicyHooks<TAuthContext> | undefined,
  context: SyncMutationPolicyContext<TArgs, unknown, TAuthContext>,
): Promise<void> {
  await policy?.validateExisting?.(
    context as SyncMutationPolicyContext<unknown, unknown, TAuthContext>,
  )
}

export async function runPolicyAfterCommit<TArgs, TAuthContext>(
  policy: TablePolicyHooks<TAuthContext> | undefined,
  context: SyncMutationPolicyContext<TArgs, unknown, TAuthContext>,
  result: unknown,
): Promise<void> {
  await policy?.afterCommit?.({
    ...(context as SyncMutationPolicyContext<unknown, unknown, TAuthContext>),
    result,
  })
}

export async function validateReferenceColumns(
  adapter: SyncServerOperationContext['adapter'],
  metadata: SyncSchemaMetadata,
  tableName: string,
  row: Record<string, unknown>,
): Promise<void> {
  const tableMetadata = metadata.tables[tableName]

  if (!tableMetadata) {
    throw new Error(`Unknown table "${tableName}".`)
  }

  for (const [columnName, reference] of Object.entries(
    tableMetadata.referenceColumns,
  )) {
    if (!reference || !reference.enforceExists) {
      continue
    }

    const value = row[columnName]

    if (value === null || value === undefined) {
      continue
    }

    const key =
      reference.keyColumns.length === 1
        ? value
        : Object.fromEntries(
            reference.keyColumns.map((keyColumn) => {
              if (keyColumn === '_actor') {
                return ['_actor', row._actor]
              }

              if (keyColumn === '_id') {
                return ['_id', value]
              }

              return [keyColumn, row[keyColumn]]
            }),
          )

    const exists = await adapter.rowExists(
      reference.referencedTable,
      key,
      reference.keyColumns,
    )

    if (!exists) {
      throw new Error(
        `Referenced row "${reference.referencedTable}.${columnName}" was not found.`,
      )
    }
  }
}
