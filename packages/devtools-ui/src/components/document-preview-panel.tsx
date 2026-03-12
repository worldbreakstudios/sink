import { useCallback, useState } from 'react'
import type { SinkDevtoolsRowRecord, SqliteReferenceColumn } from '@sink/lib'
import { cn, formatCellValue, getRowValue } from '../utils'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './ui/tooltip'

interface DocumentPreviewPanelProps {
  rows: SinkDevtoolsRowRecord[]
  columns: { name: string; type: string; notnull?: number; pk?: number }[]
  referenceColumns: Partial<Record<string, SqliteReferenceColumn>>
}

function CopyButton({
  text,
  label,
}: {
  text: string
  label: string
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (error) {
      console.error('Failed to copy:', error)
    }
  }, [text])

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(
        'shrink-0 rounded p-1',
        'hover:bg-muted',
        copied
          ? 'text-green-600 dark:text-green-400'
          : 'text-muted-foreground hover:text-foreground',
      )}
      aria-label={label}
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

function getColumnValidator(
  columnName: string,
  column: { name: string; type: string; notnull?: number; pk?: number },
  referenceColumns: Partial<Record<string, SqliteReferenceColumn>>,
): string {
  if (columnName === '_id') return 'v.id()'
  if (columnName === '_createdAt') return 'v.number()'
  if (columnName === '_updatedAt') return 'v.optional(v.number())'
  if (columnName === '_archivedAt') return 'v.optional(v.number())'

  const referenceColumn = referenceColumns[columnName]

  if (referenceColumn) {
    return referenceColumn.enforceExists
      ? `v.id('${referenceColumn.referencedTable}', { enforceExists: true })`
      : `v.id('${referenceColumn.referencedTable}')`
  }

  const sqlType = column.type.toUpperCase()
  let validator = 'v.string()'

  if (sqlType.includes('INT') || sqlType.includes('REAL') || sqlType.includes('FLOAT')) {
    validator = 'v.number()'
  } else if (sqlType.includes('BOOL')) {
    validator = 'v.boolean()'
  }

  if (column.notnull === 0 && column.pk === 0) {
    validator = `v.optional(${validator})`
  }

  return validator
}

function MultiValueCopyButton({
  columnName,
  rows,
}: {
  columnName: string
  rows: SinkDevtoolsRowRecord[]
}) {
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div>
            <CopyButton
              label={`Copy '${columnName}' for selected documents`}
              text={JSON.stringify(rows.map((row) => getRowValue(row, columnName)), null, 2)}
            />
          </div>
        </TooltipTrigger>
        <TooltipContent side="left">
          <p className="text-xs">Copy '{columnName}' for selected documents</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export function DocumentPreviewPanel({
  rows,
  columns,
  referenceColumns,
}: DocumentPreviewPanelProps) {
  if (rows.length === 1) {
    const row = rows[0]!

    return (
      <div className="space-y-2">
        <p className="mb-3 text-xs text-muted-foreground">
          Document <code className="rounded bg-muted px-1">{formatCellValue(row._id)}</code>
        </p>
        {columns.map((column) => {
          const formattedValue = formatCellValue(getRowValue(row, column.name))
          const validator = getColumnValidator(column.name, column, referenceColumns)

          return (
            <div key={column.name} className="rounded-md border bg-card p-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  {column.name}
                </span>
                <div className="flex items-center gap-1">
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {validator}
                  </span>
                  <CopyButton label={`Copy '${column.name}' value`} text={formattedValue} />
                </div>
              </div>
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all text-sm font-mono">
                {formattedValue}
              </pre>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <p className="mb-3 whitespace-nowrap text-xs text-muted-foreground">
        <span className="font-medium">{rows.length} documents</span> selected
      </p>
      {columns.map((column) => (
        <div key={column.name} className="rounded-md border bg-card p-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              {column.name}
            </span>
            <div className="flex items-center gap-1">
              <span className="font-mono text-[10px] text-muted-foreground">
                {getColumnValidator(column.name, column, referenceColumns)}
              </span>
              <MultiValueCopyButton columnName={column.name} rows={rows} />
            </div>
          </div>
          <span className="text-sm italic text-muted-foreground">multiple values</span>
        </div>
      ))}
    </div>
  )
}
