import { useState, useCallback } from 'react'
import type { SqliteTableColumn } from '@sink/lib'
import type { GenericRow, ReferenceColumn } from '../../types'
import { cn } from '../../utils/cn'
import { formatCellValue, getRowValue } from '../../utils/format'
import { getColumnValidator } from '../../schema/validator-generator'
import { CopyButton } from '../CopyButton'

interface DocumentPreviewPanelProps<TRow extends GenericRow> {
  rows: TRow[]
  columns: SqliteTableColumn[]
  referenceColumns: Record<string, ReferenceColumn>
}

function MultiValueCopyButton<TRow extends GenericRow>({
  columnName,
  rows,
}: {
  columnName: string
  rows: TRow[]
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      const values = rows.map((row) => getRowValue(row, columnName))
      await navigator.clipboard.writeText(JSON.stringify(values, null, 2))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }, [columnName, rows])

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(
        'shrink-0 rounded p-1',
        'hover:bg-muted',
        copied ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground hover:text-foreground'
      )}
      aria-label={`Copy '${columnName}' for selected documents`}
      title={`Copy '${columnName}' for selected documents`}
    >
      {copied ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      ) : (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
          <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
        </svg>
      )}
    </button>
  )
}

export function DocumentPreviewPanel<TRow extends GenericRow>({
  rows,
  columns,
  referenceColumns,
}: DocumentPreviewPanelProps<TRow>) {
  // Single document view
  if (rows.length === 1) {
    const row = rows[0]!
    return (
      <div className="space-y-2">
        <p className="mb-3 text-xs text-muted-foreground">
          Document <code className="rounded bg-muted px-1">{row._id}</code>
        </p>
        {columns.map((column) => {
          const value = getRowValue(row, column.name)
          const formattedValue = formatCellValue(value)
          const validator = getColumnValidator(column, referenceColumns[column.name])

          return (
            <div key={column.name} className="rounded-md border bg-card p-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">{column.name}</span>
                <div className="flex items-center gap-1">
                  <span className="font-mono text-[10px] text-muted-foreground">{validator}</span>
                  <CopyButton text={formattedValue} />
                </div>
              </div>
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono text-sm">
                {formattedValue}
              </pre>
            </div>
          )
        })}
      </div>
    )
  }

  // Multiple documents view
  return (
    <div className="space-y-2">
      <p className="mb-3 whitespace-nowrap text-xs text-muted-foreground">
        <span className="font-medium">{rows.length} documents</span> selected
      </p>
      {columns.map((column) => {
        const validator = getColumnValidator(column, referenceColumns[column.name])

        return (
          <div key={column.name} className="rounded-md border bg-card p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">{column.name}</span>
              <div className="flex items-center gap-1">
                <span className="font-mono text-[10px] text-muted-foreground">{validator}</span>
                <MultiValueCopyButton columnName={column.name} rows={rows} />
              </div>
            </div>
            <span className="text-sm italic text-muted-foreground">multiple values</span>
          </div>
        )
      })}
    </div>
  )
}
