import type {
  SerializedSqliteValue,
  SinkDevtoolsRowRecord,
} from '@sink/lib'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCellValue(value: SerializedSqliteValue | undefined): string {
  if (value === undefined || value === null) {
    return 'NULL'
  }

  if (typeof value === 'number' || typeof value === 'string') {
    return String(value)
  }

  if (value.type === 'bigint') {
    return value.value
  }

  return `[binary ${value.byteLength} bytes]`
}

export function getRowValue(
  row: SinkDevtoolsRowRecord,
  columnName: string,
): SerializedSqliteValue {
  return row[columnName] ?? null
}

export function getRowId(row: SinkDevtoolsRowRecord): SerializedSqliteValue {
  return row._id ?? ''
}

export function serializeRowKey(value: SerializedSqliteValue): string {
  if (value === null) {
    return 'null'
  }

  if (typeof value === 'number') {
    return `number:${value}`
  }

  if (typeof value === 'string') {
    return `string:${value}`
  }

  if (value.type === 'bigint') {
    return `bigint:${value.value}`
  }

  return `blob:${value.base64}`
}

export function isBlobValue(value: SerializedSqliteValue | undefined): boolean {
  return typeof value === 'object' && value !== null && value.type === 'blob'
}

export function isMultilineColumn(columnName: string): boolean {
  return columnName === 'body' || columnName === 'description'
}

export function formatReferenceOptionLabel(row: SinkDevtoolsRowRecord): string {
  const titleValue = row.title
  const nameValue = row.name
  const rowId = formatCellValue(getRowId(row))
  const title =
    typeof titleValue === 'string'
      ? titleValue
      : typeof nameValue === 'string'
        ? nameValue
        : null

  if (title) {
    return `${rowId} - ${title}`
  }

  return rowId
}
