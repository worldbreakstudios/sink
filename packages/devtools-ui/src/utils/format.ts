import type { GenericRow } from '../types'

/**
 * Format a cell value for display
 */
export function formatCellValue(value: unknown): string {
  if (value === null) {
    return 'NULL'
  }

  if (value === undefined) {
    return ''
  }

  if (value instanceof Uint8Array || value instanceof Int8Array) {
    return `[binary ${value.byteLength} bytes]`
  }

  if (value instanceof ArrayBuffer) {
    return `[binary ${value.byteLength} bytes]`
  }

  if (typeof value === 'bigint') {
    return value.toString()
  }

  return String(value)
}

/**
 * Get a value from a row by column name
 */
export function getRowValue(row: GenericRow, columnName: string): unknown {
  return row[columnName] ?? null
}

/**
 * Check if a column should use multiline input
 */
export function isMultilineColumn(columnName: string): boolean {
  return columnName === 'body' || columnName === 'description' || columnName === 'content'
}

/**
 * Format a reference option label for FK dropdowns
 */
export function formatReferenceOptionLabel(row: GenericRow): string {
  const title =
    typeof row.title === 'string'
      ? row.title
      : typeof row.name === 'string'
        ? row.name
        : null

  if (title) {
    return `${row._id} - ${title}`
  }

  return row._id
}

/**
 * Format a timestamp for display
 */
export function formatTimestamp(timestamp: number): string {
  const now = new Date()
  const diffMs = now.getTime() - timestamp
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`

  const date = new Date(timestamp)
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
