import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  SinkDevtoolsRowRecord,
  SinkDevtoolsSchemaMetadata,
  SqliteIndexSnapshot,
  SqliteReferenceColumn,
  SqliteTableColumn,
} from '@sink/lib'
import { generateSchemaSource } from '../schema-source'
import { cn } from '../utils'
import { DocumentPreviewPanel } from './document-preview-panel'
import { CodeBlock } from './ui/code-block'

type TabType = 'schema' | 'indexes' | 'document'

const MIN_WIDTH = 200
const MAX_WIDTH = 600
const DEFAULT_WIDTH = 320

export function RightSidebar({
  tableName,
  schema,
  indexes,
  isOpen,
  onClose,
  selectedRows,
  columns,
  referenceColumns,
}: {
  tableName: string
  schema: SinkDevtoolsSchemaMetadata
  indexes: SqliteIndexSnapshot[]
  isOpen: boolean
  onClose: () => void
  selectedRows?: SinkDevtoolsRowRecord[]
  columns?: SqliteTableColumn[]
  referenceColumns?: Partial<Record<string, SqliteReferenceColumn>>
}) {
  const [activeTab, setActiveTab] = useState<TabType>('schema')
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [isResizing, setIsResizing] = useState(false)
  const sidebarRef = useRef<HTMLElement>(null)
  const hasSelectedRows = (selectedRows?.length ?? 0) > 0
  const schemaSource = useMemo(
    () =>
      columns
        ? generateSchemaSource(tableName, columns, schema)
        : `// No schema found for table "${tableName}"`,
    [columns, schema, tableName],
  )

  useEffect(() => {
    if (hasSelectedRows) {
      setActiveTab('document')
    }
  }, [hasSelectedRows])

  const handleMouseDown = useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    setIsResizing(true)
  }, [])

  useEffect(() => {
    if (!isResizing) {
      return
    }

    const handleMouseMove = (event: MouseEvent) => {
      if (!sidebarRef.current) {
        return
      }

      const newWidth = window.innerWidth - event.clientX
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

  if (!isOpen) {
    return null
  }

  return (
    <aside
      ref={sidebarRef}
      style={{ width }}
      className="relative flex shrink-0 flex-col border-l bg-background"
    >
      <div
        onMouseDown={handleMouseDown}
        className={cn(
          'absolute bottom-0 left-0 top-0 w-1 cursor-col-resize transition-colors',
          'hover:bg-primary/20',
          isResizing && 'bg-primary/30',
        )}
      />
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-medium">
          {activeTab === 'document'
            ? 'Document Preview'
            : activeTab === 'schema'
              ? 'Schema'
              : 'Indexes'}{' '}
          {activeTab !== 'document' && (
            <>
              for table <span className="font-semibold">{tableName}</span>
            </>
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
            {selectedRows?.length === 1
              ? 'Document'
              : `Documents (${selectedRows?.length ?? 0})`}
          </button>
        )}
        {(['schema', 'indexes'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={cn(
              'flex-1 whitespace-nowrap px-3 py-2 text-sm font-medium transition-colors',
              activeTab === tab
                ? 'border-b-2 border-primary text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab === 'schema' ? 'Schema' : 'Indexes'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-4">
        {activeTab === 'document' && hasSelectedRows && columns && referenceColumns ? (
          <DocumentPreviewPanel
            rows={selectedRows ?? []}
            columns={columns}
            referenceColumns={referenceColumns}
          />
        ) : activeTab === 'schema' ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Generated schema for{' '}
              <code className="rounded bg-muted px-1">{tableName}</code>
            </p>
            <CodeBlock code={schemaSource.trim()} language="typescript" />
          </div>
        ) : (
          <IndexesPanel indexes={indexes} />
        )}
      </div>
    </aside>
  )
}

function CopyButton({ text }: { text: string }) {
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
        'ml-2 rounded p-1 text-muted-foreground',
        'hover:bg-muted hover:text-foreground',
        copied && 'text-green-600 dark:text-green-400',
      )}
      aria-label="Copy index name"
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

function IndexesPanel({ indexes }: { indexes: SqliteIndexSnapshot[] }) {
  const regularIndexes = indexes.filter((index) => !index.name.startsWith('sqlite_'))
  const allIndexes: SqliteIndexSnapshot[] = [
    {
      name: 'by_id',
      tableName: '',
      unique: 1,
      origin: 'pk',
      partial: 0,
      fields: ['_id'],
    },
    ...regularIndexes,
  ]

  return (
    <div className="space-y-4">
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
