import type { TableName } from '@/data/generated/schema.gen'
import {
  formatSqliteDemoKey,
  getSqliteDemoRowKey,
} from '@/lib/sqlite-demo-collections'
import type { SqliteDemoRow } from '@/lib/sqlite-demo-collections'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  )
}

export function formatCellValue(value: unknown): string {
  if (value === null) {
    return 'NULL'
  }

  if (value instanceof Uint8Array || value instanceof Int8Array) {
    return `[binary ${value.byteLength} bytes]`
  }

  if (value instanceof ArrayBuffer) {
    return `[binary ${value.byteLength} bytes]`
  }

  if (Array.isArray(value) || isPlainObject(value)) {
    return JSON.stringify(value, null, 2)
  }

  return String(value)
}

export function getRowValue(row: SqliteDemoRow, columnName: string): unknown {
  return (row as unknown as Record<string, unknown>)[columnName] ?? null
}

export function isMultilineColumn(columnName: string): boolean {
  return columnName === 'body' || columnName === 'description'
}

export function isStructuredColumnType(columnType: string): boolean {
  const normalizedType = columnType.toUpperCase()

  return (
    normalizedType.includes('JSON_ARRAY') ||
    normalizedType.includes('JSON_OBJECT') ||
    normalizedType.includes('JSON_RECORD')
  )
}

export function formatReferenceOptionLabel(
  tableName: TableName,
  row: SqliteDemoRow,
): string {
  const record = row as unknown as Record<string, unknown>
  const title =
    typeof record.title === 'string'
      ? record.title
      : typeof record.name === 'string'
        ? record.name
        : null
  const keyLabel = formatSqliteDemoKey(tableName, getSqliteDemoRowKey(tableName, row))

  if (title) {
    return `${keyLabel} - ${title}`
  }

  return keyLabel
}
