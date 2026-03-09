import type { SqliteDemoRow } from '@/lib/sqlite-demo-collections'

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

  return String(value)
}

export function getRowValue(row: SqliteDemoRow, columnName: string): unknown {
  return (row as unknown as Record<string, unknown>)[columnName] ?? null
}

export function isMultilineColumn(columnName: string): boolean {
  return columnName === 'body' || columnName === 'description'
}

export function formatReferenceOptionLabel(row: SqliteDemoRow): string {
  const record = row as unknown as Record<string, unknown>
  const title =
    typeof record.title === 'string'
      ? record.title
      : typeof record.name === 'string'
        ? record.name
        : null

  if (title) {
    return `${row._id} - ${title}`
  }

  return row._id
}
