import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import type { SqliteIndexSnapshot, SqliteReferenceColumn, SqliteTableSnapshot } from '@sink/lib'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { KEY_COLUMNS, type TableName } from '@/data/generated/schema.gen'
import { CodeBlock } from '@/components/ui/code-block'
import { getSchemaSource } from '@/lib/schema-sources'
import type { SqliteDemoRow } from '@/lib/sqlite-demo-collections'
import { cn } from '@/lib/utils'
import { DocumentPreviewPanel } from './document-preview-panel'

type TabType = 'schema' | 'indexes' | 'document'

const MIN_WIDTH = 200
const MAX_WIDTH = 600
const DEFAULT_WIDTH = 320

export function RightSidebar({
  tableName,
  tables,
  indexes,
  isOpen,
  onClose,
  selectedRows,
  columns,
  referenceColumns,
}: {
  tableName: string
  tables: SqliteTableSnapshot[]
  indexes: SqliteIndexSnapshot[]
  isOpen: boolean
  onClose: () => void
  selectedRows?: SqliteDemoRow[]
  columns?: { name: string; type: string; pk?: number; notnull?: number }[]
  referenceColumns?: Record<string, SqliteReferenceColumn>
}) {
  const [activeTab, setActiveTab] = useState<TabType>('schema')
  const hasSelectedRows = selectedRows && selectedRows.length > 0

  // Auto-switch to document tab when rows are selected
  useEffect(() => {
    if (hasSelectedRows) {
      setActiveTab('document')
    }
  }, [hasSelectedRows])
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [isResizing, setIsResizing] = useState(false)
  const sidebarRef = useRef<HTMLElement>(null)
  const schemaSource = useMemo(() => getSchemaSource(tableName, tables), [tableName, tables])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsResizing(true)
  }, [])

  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!sidebarRef.current) return
      const containerRight = window.innerWidth
      const newWidth = containerRight - e.clientX
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, newWidth)))
    }

    const handleMouseUp = () => {
      setIsResizing(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing])

  if (!isOpen) return null

  return (
    <aside
      ref={sidebarRef}
      style={{ width }}
      className="relative flex shrink-0 flex-col border-l border-sidebar-border bg-sidebar text-sidebar-foreground"
    >
      <div
        onMouseDown={handleMouseDown}
        className={cn(
          'absolute left-0 top-0 bottom-0 w-1 cursor-col-resize transition-colors',
          'hover:bg-sidebar-primary/20',
          isResizing && 'bg-sidebar-primary/35',
        )}
      />
      <div className="flex items-center justify-between border-b border-sidebar-border px-4 py-3">
        <h2 className="font-heading text-sm font-semibold tracking-tight">
          {activeTab === 'document' ? 'Document Preview' : activeTab === 'schema' ? 'Schema' : 'Indexes'}{' '}
          {activeTab !== 'document' && (
            <>for table <span className="font-semibold">{tableName}</span></>
          )}
        </h2>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="size-8 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          aria-label="Close sidebar"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </Button>
      </div>

      <div className="flex gap-2 border-b border-sidebar-border px-3 py-2">
        {hasSelectedRows && (
          <Button
            variant={activeTab === 'document' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('document')}
            className={cn(
              'flex-1 rounded-lg',
              activeTab === 'document'
                ? 'bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90'
                : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
            )}
          >
            {selectedRows.length === 1 ? 'Document' : `Documents (${selectedRows.length})`}
          </Button>
        )}
        <Button
          variant={activeTab === 'schema' ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setActiveTab('schema')}
          className={cn(
            'flex-1 rounded-lg',
            activeTab === 'schema'
              ? 'bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90'
              : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
          )}
        >
          Schema
        </Button>
        <Button
          variant={activeTab === 'indexes' ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setActiveTab('indexes')}
          className={cn(
            'flex-1 rounded-lg',
            activeTab === 'indexes'
              ? 'bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90'
              : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
          )}
        >
          Indexes
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {activeTab === 'document' && hasSelectedRows && columns && referenceColumns ? (
          <DocumentPreviewPanel
            tableName={tableName}
            rows={selectedRows}
            columns={columns}
            referenceColumns={referenceColumns}
          />
        ) : activeTab === 'schema' ? (
          <SchemaPanel schemaSource={schemaSource} tableName={tableName} />
        ) : (
          <IndexesPanel tableName={tableName} indexes={indexes} />
        )}
      </div>
    </aside>
  )
}

function SchemaPanel({ schemaSource, tableName }: { schemaSource: string; tableName: string }) {
  return (
    <Card className="border-sidebar-border bg-card/70">
      <CardHeader className="space-y-3 p-4">
        <Badge variant="outline" className="w-fit font-mono text-[11px]">
          {tableName}
        </Badge>
        <CardTitle className="font-heading text-base">Generated schema</CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <CodeBlock
          code={schemaSource.trim()}
          language="typescript"
          formatLanguage="typescript"
        />
      </CardContent>
    </Card>
  )
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
      variant="ghost"
      size="icon"
      onClick={handleCopy}
      className={cn(
        'ml-2 size-7 text-muted-foreground',
        'hover:bg-accent hover:text-accent-foreground',
        copied && 'text-green-600 dark:text-green-400',
      )}
      aria-label="Copy index name"
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

function IndexesPanel({
  tableName,
  indexes,
}: {
  tableName: string
  indexes: SqliteIndexSnapshot[]
}) {
  const regularIndexes = indexes.filter((idx) => !idx.name.startsWith('sqlite_'))

  // Primary key index (implicit, always exists)
  const pkIndex: SqliteIndexSnapshot = {
    name: 'by_id',
    tableName: '',
    unique: 1,
    origin: 'pk',
    partial: 0,
    fields: [...(KEY_COLUMNS[tableName as TableName] ?? ['_id'])],
  }

  const allIndexes = [pkIndex, ...regularIndexes]

  return (
    <div className="space-y-4">
      <Card className="border-sidebar-border bg-card/70">
        <CardHeader className="p-4">
          <CardTitle className="flex items-center gap-2 font-heading text-base">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-muted-foreground"
          >
            <path d="M3 3h18" />
            <path d="M3 9h18" />
            <path d="M3 15h18" />
            <path d="M3 21h18" />
          </svg>
            Indexes
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-3 p-4 pt-0">
          {allIndexes.map((index) => (
            <Card key={index.name} className="group rounded-2xl border-border/70 bg-background/70 shadow-none">
              <CardContent className="p-3">
              <div className="mb-1 flex items-start justify-between gap-1">
                <span className="break-all font-mono text-sm">{index.name}</span>
                <CopyButton text={index.name} />
              </div>
              <div className="text-xs text-muted-foreground">
                <span className="font-medium">Fields:</span>{' '}
                {index.fields.join(', ') || '(none)'}
              </div>
              <div className="mt-1 flex gap-1">
                {!!index.unique && (
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                    unique
                  </span>
                )}
                {index.origin === 'pk' && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                    primary key
                  </span>
                )}
              </div>
              </CardContent>
            </Card>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
