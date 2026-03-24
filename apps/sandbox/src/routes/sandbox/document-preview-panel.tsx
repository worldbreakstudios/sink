import { useState, useCallback } from 'react'
import type { SqliteReferenceColumn } from '@worldbreakstudios/sink-lib'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { SCHEMA_VALIDATORS, type TableName } from '@/data/generated/schema.gen'
import { cn } from '@/lib/utils'
import {
  formatSqliteDemoKey,
  getSqliteDemoRowKey,
  type SqliteDemoRow,
} from '@/lib/sqlite-demo-collections'
import { formatCellValue, getRowValue } from './utils'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface DocumentPreviewPanelProps {
  tableName: string
  rows: SqliteDemoRow[]
  columns: { name: string; type: string; pk?: number; notnull?: number }[]
  referenceColumns: Record<string, SqliteReferenceColumn>
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }, [text])

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={handleCopy}
      className={cn(
        'size-7 shrink-0',
        'hover:bg-accent',
        copied ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground hover:text-foreground',
      )}
      aria-label="Copy value"
    >
      {copied ? (
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
          <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
        </svg>
      )}
    </Button>
  )
}

function getColumnValidator(
  tableName: string,
  columnName: string,
  column: { name: string; type: string; notnull?: number; pk?: number },
  referenceColumns: Record<string, SqliteReferenceColumn>,
): string {
  const generatedValidator = (
    SCHEMA_VALIDATORS as Partial<Record<string, Record<string, string>>>
  )[tableName]?.[columnName]

  if (generatedValidator) {
    return generatedValidator
  }

  if (columnName === '_id') return 'v.id()'
  if (columnName === '_createdAt') return 'v.number()'
  if (columnName === '_updatedAt') return 'v.number()'
  if (columnName === '_archivedAt') return 'v.nullable(v.number())'

  const ref = referenceColumns[columnName]
  if (ref) {
    return ref.enforceExists
      ? `v.id('${ref.referencedTable}', { enforceExists: true })`
      : `v.id('${ref.referencedTable}')`
  }

  const sqlType = column.type.toUpperCase()
  let validator: string
  if (sqlType.includes('INT')) {
    validator = 'v.number()'
  } else if (sqlType.includes('REAL') || sqlType.includes('FLOAT') || sqlType.includes('DOUBLE')) {
    validator = 'v.number()'
  } else if (sqlType.includes('BOOL')) {
    validator = 'v.boolean()'
  } else {
    validator = 'v.string()'
  }

  if (column.notnull === 0 && column.pk === 0) {
    validator = `v.nullable(${validator})`
  }

  return validator
}

function MultiValueCopyButton({
  columnName,
  rows,
}: {
  columnName: string
  rows: SqliteDemoRow[]
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
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleCopy}
            className={cn(
              'size-7 shrink-0',
              'hover:bg-accent',
              copied ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground hover:text-foreground',
            )}
            aria-label={`Copy '${columnName}' for selected documents`}
          >
            {copied ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
              </svg>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="left">
          <p className="text-xs">Copy '{columnName}' for selected documents</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export function DocumentPreviewPanel({
  tableName,
  rows,
  columns,
  referenceColumns,
}: DocumentPreviewPanelProps) {
  // Single document view
  if (rows.length === 1) {
    const row = rows[0]!
    const rowKeyLabel = formatSqliteDemoKey(
      tableName as TableName,
      getSqliteDemoRowKey(tableName as TableName, row),
    )
    return (
      <div className="space-y-2">
        <div className="mb-3 flex items-center gap-2">
          <Badge variant="secondary">Document</Badge>
          <code className="rounded-md bg-muted px-2 py-1">{rowKeyLabel}</code>
        </div>
        {columns.map((column) => {
          const value = getRowValue(row, column.name)
          const formattedValue = formatCellValue(value)
          const validator = getColumnValidator(tableName, column.name, column, referenceColumns)

          return (
            <Card key={column.name} className="rounded-2xl border-border/70 bg-card/80 shadow-none">
              <CardContent className="p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-muted-foreground">{column.name}</span>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-muted-foreground font-mono">{validator}</span>
                  <CopyButton text={formattedValue} />
                </div>
              </div>
              <pre className="text-sm font-mono break-all whitespace-pre-wrap max-h-32 overflow-auto">
                {formattedValue}
              </pre>
              </CardContent>
            </Card>
          )
        })}
      </div>
    )
  }

  // Multiple documents view
  return (
    <div className="space-y-2">
      <Badge variant="secondary" className="mb-3 whitespace-nowrap">
        {rows.length} documents selected
      </Badge>
      {columns.map((column) => {
        const validator = getColumnValidator(tableName, column.name, column, referenceColumns)

        return (
          <Card key={column.name} className="rounded-2xl border-border/70 bg-card/80 shadow-none">
            <CardContent className="p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-muted-foreground">{column.name}</span>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-muted-foreground font-mono">{validator}</span>
                <MultiValueCopyButton columnName={column.name} rows={rows} />
              </div>
            </div>
            <span className="text-sm text-muted-foreground italic">multiple values</span>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
