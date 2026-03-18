import { createBatchTransaction, KEY_COLUMNS, type AnyKey, type AnyRow, type FieldRow, type ObjectRow, type ObjectTypeRow, type SchemaCollections } from '../generated/schema.gen.ts'
import type {
  InvalidationTarget,
  MutablePrototypeCollection,
  PrototypeKey,
  PrototypeRow,
  PrototypeTableName,
  QueryLocalContext,
} from './types.ts'
import { prototypeValuesEqual } from './json.ts'

export function getPrototypeCollection(
  collections: SchemaCollections,
  tableName: PrototypeTableName,
): MutablePrototypeCollection {
  const collection = collections[tableName] as unknown as MutablePrototypeCollection | undefined

  if (!collection) {
    throw new Error(`Missing collection for table "${tableName}".`)
  }

  return collection
}

export function getPrototypeRowKey(
  tableName: PrototypeTableName,
  row: PrototypeRow | Record<string, unknown>,
): PrototypeKey {
  const keyColumns = KEY_COLUMNS[tableName]
  const rowRecord = row as Record<string, unknown>

  if (keyColumns.length === 1) {
    return rowRecord[keyColumns[0]] as PrototypeKey
  }

  return Object.fromEntries(
    keyColumns.map((columnName) => [columnName, rowRecord[columnName]]),
  ) as unknown as PrototypeKey
}

export function serializePrototypeKey(
  tableName: PrototypeTableName,
  key: PrototypeKey,
): string {
  const keyColumns = KEY_COLUMNS[tableName]

  if (
    keyColumns.length === 1 &&
    (typeof key === 'string' || typeof key === 'number' || typeof key === 'bigint')
  ) {
    return String(key)
  }

  const keyRecord = key as unknown as Record<string, unknown>

  return JSON.stringify(
    keyColumns.map((columnName) => [columnName, normalizeSerializableValue(keyRecord[columnName])]),
  )
}

export function normalizeSerializableValue(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString()
  }

  return value ?? null
}

export function serializeLockValues(values: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, String(normalizeSerializableValue(value))]),
  )
}

export function createPrimaryLockTarget(
  tableName: PrototypeTableName,
  key: PrototypeKey,
): { tableName: PrototypeTableName; kind: 'primary'; keyName: string; values: Record<string, string> } {
  const keyColumns = KEY_COLUMNS[tableName]

  if (keyColumns.length === 1 && (typeof key === 'string' || typeof key === 'number' || typeof key === 'bigint')) {
    return {
      tableName,
      kind: 'primary',
      keyName: keyColumns[0],
      values: { [keyColumns[0]]: String(key) },
    }
  }

  const record = key as unknown as Record<string, unknown>

  return {
    tableName,
    kind: 'primary',
    keyName: keyColumns.join('+'),
    values: serializeLockValues(
      Object.fromEntries(keyColumns.map((columnName) => [columnName, record[columnName]])),
    ),
  }
}

export function createUniqueLockTarget(
  tableName: PrototypeTableName,
  uniqueName: string,
  values: Record<string, unknown>,
): { tableName: PrototypeTableName; kind: 'unique'; keyName: string; values: Record<string, string> } {
  return {
    tableName,
    kind: 'unique',
    keyName: uniqueName,
    values: serializeLockValues(values),
  }
}

export async function readLocalRowsForTable(
  collections: SchemaCollections,
  tableName: PrototypeTableName,
): Promise<AnyRow[]> {
  return getPrototypeCollection(collections, tableName).utils.readAll()
}

export async function reconcileScopedRows(
  context: QueryLocalContext,
  tableName: PrototypeTableName,
  nextRows: PrototypeRow[],
  scope: (row: PrototypeRow) => boolean,
): Promise<void> {
  const protectedKeys = await context.getProtectedRowKeys(tableName)
  const currentRows = (await readLocalRowsForTable(
    context.collections,
    tableName,
  )) as PrototypeRow[]
  const currentScopedRows = currentRows.filter(scope)
  const nextByKey = new Map(
    nextRows.map((row) => [serializePrototypeKey(tableName, getPrototypeRowKey(tableName, row)), row]),
  )
  const currentByKey = new Map(
    currentScopedRows.map((row) => [serializePrototypeKey(tableName, getPrototypeRowKey(tableName, row)), row]),
  )
  const tx = createBatchTransaction(context.collections, { autoCommit: false })
  const collection = getPrototypeCollection(context.collections, tableName)

  tx.mutate(() => {
    for (const row of currentScopedRows) {
      const key = getPrototypeRowKey(tableName, row)
      const serializedKey = serializePrototypeKey(tableName, key)

      if (protectedKeys.has(serializedKey) || nextByKey.has(serializedKey)) {
        continue
      }

      collection.delete(key as AnyKey)
    }

    for (const nextRow of nextRows) {
      const key = getPrototypeRowKey(tableName, nextRow)
      const serializedKey = serializePrototypeKey(tableName, key)

      if (protectedKeys.has(serializedKey)) {
        continue
      }

      const currentRow = currentByKey.get(serializedKey)

      if (!currentRow) {
        collection.insert(nextRow as AnyRow)
        continue
      }

      if (prototypeValuesEqual(currentRow, nextRow)) {
        continue
      }

      collection.update(key as AnyKey, (draft) => {
        Object.assign(draft, nextRow)
      })
    }
  })

  await tx.commit()
}

export function invalidationTouchesTable(
  targets: InvalidationTarget[],
  tableName: PrototypeTableName,
): boolean {
  return targets.some((target) => target.tableName === tableName)
}

export function objectRowBelongsToActor(
  row: ObjectRow,
  actorId: string,
): boolean {
  return row._actor === actorId
}

export function fieldRowBelongsToObject(
  row: FieldRow,
  actorId: string,
  objectId: string,
): boolean {
  return row._actor === actorId && row.object_id === objectId
}

export function normalizeObjectTypeRows(rows: ObjectTypeRow[]): ObjectTypeRow[] {
  return [...rows].sort((left, right) => left.name.localeCompare(right.name))
}
