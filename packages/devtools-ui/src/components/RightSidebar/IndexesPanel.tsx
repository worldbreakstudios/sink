import type { SqliteIndexSnapshot } from '@sink/lib'
import { CopyButton } from '../CopyButton'

interface IndexesPanelProps {
  indexes: SqliteIndexSnapshot[]
}

export function IndexesPanel({ indexes }: IndexesPanelProps) {
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
