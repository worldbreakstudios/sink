import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import type { SqliteIndexSnapshot, SqliteReferenceColumn, SqliteTableSnapshot } from '@sink/lib'
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
      className="relative flex shrink-0 flex-col border-l bg-background"
    >
      {/* Resize Handle */}
      <div
        onMouseDown={handleMouseDown}
        className={cn(
          'absolute left-0 top-0 bottom-0 w-1 cursor-col-resize transition-colors',
          'hover:bg-primary/20',
          isResizing && 'bg-primary/30',
        )}
      />
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-medium">
          {activeTab === 'document' ? 'Document Preview' : activeTab === 'schema' ? 'Schema' : 'Indexes'}{' '}
          {activeTab !== 'document' && (
            <>for table <span className="font-semibold">{tableName}</span></>
          )}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
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
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b">
        {hasSelectedRows && (
          <button
            type="button"
            onClick={() => setActiveTab('document')}
            className={cn(
              'flex-1 whitespace-nowrap px-3 py-2 text-sm font-medium transition-colors',
              activeTab === 'document'
                ? 'border-b-2 border-primary text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {selectedRows.length === 1 ? 'Document' : `Documents (${selectedRows.length})`}
          </button>
        )}
        <button
          type="button"
          onClick={() => setActiveTab('schema')}
          className={cn(
            'flex-1 whitespace-nowrap px-3 py-2 text-sm font-medium transition-colors',
            activeTab === 'schema'
              ? 'border-b-2 border-primary text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          Schema
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('indexes')}
          className={cn(
            'flex-1 whitespace-nowrap px-3 py-2 text-sm font-medium transition-colors',
            activeTab === 'indexes'
              ? 'border-b-2 border-primary text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          Indexes
        </button>
      </div>

      {/* Content */}
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
          <IndexesPanel indexes={indexes} />
        )}
      </div>
    </aside>
  )
}

function SchemaPanel({ schemaSource, tableName }: { schemaSource: string; tableName: string }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Generated schema for <code className="rounded bg-muted px-1">{tableName}</code>
      </p>
      <CodeBlock code={schemaSource.trim()} language="typescript" />
    </div>
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
    <button
      type="button"
      onClick={handleCopy}
      className={cn(
        'ml-2 rounded p-1 text-muted-foreground',
        'hover:bg-muted hover:text-foreground',
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
    </button>
  )
}

function IndexesPanel({ indexes }: { indexes: SqliteIndexSnapshot[] }) {
  const regularIndexes = indexes.filter((idx) => !idx.name.startsWith('sqlite_'))

  // Primary key index (implicit, always exists)
  const pkIndex: SqliteIndexSnapshot = {
    name: 'by_id',
    tableName: '',
    unique: 1,
    origin: 'pk',
    partial: 0,
    fields: ['_id'],
  }

  const allIndexes = [pkIndex, ...regularIndexes]

  return (
    <div className="space-y-4">
      {/* Database Indexes */}
      <div>
        <div className="mb-2 flex items-center gap-2">
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
          <span className="text-sm font-medium">Indexes</span>
        </div>

        <div className="space-y-3">
          {allIndexes.map((index) => (
            <div key={index.name} className="group rounded-md border bg-card p-3">
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
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
