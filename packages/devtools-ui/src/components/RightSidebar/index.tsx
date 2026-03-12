import { useState, useCallback, useEffect, useRef } from 'react'
import type { SqliteIndexSnapshot, SqliteTableColumn } from '@sink/lib'
import type { GenericRow, ReferenceColumn } from '../../types'
import { cn } from '../../utils/cn'
import { DocumentPreviewPanel } from './DocumentPreviewPanel'
import { SchemaPanel } from './SchemaPanel'
import { IndexesPanel } from './IndexesPanel'

type TabType = 'schema' | 'indexes' | 'document'

const MIN_WIDTH = 200
const MAX_WIDTH = 600
const DEFAULT_WIDTH = 320

export interface RightSidebarProps<TRow extends GenericRow> {
  tableName: string
  indexes: SqliteIndexSnapshot[]
  columns: SqliteTableColumn[]
  referenceColumns: Record<string, ReferenceColumn>
  schemaSource: string
  selectedRows?: TRow[]
  isOpen: boolean
  onClose: () => void
}

export function RightSidebar<TRow extends GenericRow>({
  tableName,
  indexes,
  columns,
  referenceColumns,
  schemaSource,
  selectedRows,
  isOpen,
  onClose,
}: RightSidebarProps<TRow>) {
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
          'absolute bottom-0 left-0 top-0 w-1 cursor-col-resize transition-colors',
          'hover:bg-primary/20',
          isResizing && 'bg-primary/30'
        )}
      />

      {/* Header */}
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
                : 'text-muted-foreground hover:text-foreground'
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
              : 'text-muted-foreground hover:text-foreground'
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
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Indexes
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {activeTab === 'document' && hasSelectedRows ? (
          <DocumentPreviewPanel
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

export { DocumentPreviewPanel } from './DocumentPreviewPanel'
export { SchemaPanel } from './SchemaPanel'
export { IndexesPanel } from './IndexesPanel'
