import { useState } from 'react'
import type { SqliteIndexSnapshot } from '@sink/lib'
import { cn } from '@/lib/utils'

type TabType = 'schema' | 'indexes'

export function RightSidebar({
  tableName,
  schema,
  indexes,
  isOpen,
  onClose,
}: {
  tableName: string
  schema: string
  indexes: SqliteIndexSnapshot[]
  isOpen: boolean
  onClose: () => void
}) {
  const [activeTab, setActiveTab] = useState<TabType>('schema')

  if (!isOpen) return null

  return (
    <aside className="flex w-80 flex-col border-l bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-medium">
          {activeTab === 'schema' ? 'Schema' : 'Indexes'} for table{' '}
          <span className="font-semibold">{tableName}</span>
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
        <button
          type="button"
          onClick={() => setActiveTab('schema')}
          className={cn(
            'flex-1 px-4 py-2 text-sm font-medium transition-colors',
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
            'flex-1 px-4 py-2 text-sm font-medium transition-colors',
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
        {activeTab === 'schema' ? (
          <SchemaPanel schema={schema} />
        ) : (
          <IndexesPanel indexes={indexes} />
        )}
      </div>
    </aside>
  )
}

function SchemaPanel({ schema }: { schema: string }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        This is the SQLite CREATE TABLE statement for this table.
      </p>
      <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
        <code>{schema}</code>
      </pre>
    </div>
  )
}

function IndexesPanel({ indexes }: { indexes: SqliteIndexSnapshot[] }) {
  const regularIndexes = indexes.filter((idx) => !idx.name.startsWith('sqlite_'))

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

        {regularIndexes.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {indexes.length === 0 ? 'No indexes on this table.' : 'No custom indexes.'}
          </p>
        ) : (
          <div className="space-y-3">
            {regularIndexes.map((index) => (
              <div key={index.name} className="rounded-md border bg-card p-3">
                <div className="mb-1 font-mono text-sm">{index.name}</div>
                <div className="text-xs text-muted-foreground">
                  <span className="font-medium">Fields:</span>{' '}
                  {index.fields.join(', ') || '(none)'}
                </div>
                {index.unique && (
                  <div className="mt-1">
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                      unique
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
