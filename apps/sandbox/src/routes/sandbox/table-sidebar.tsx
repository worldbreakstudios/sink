import type { SqliteTableSnapshot } from '@sink/lib'
import { cn } from '@/lib/utils'

function TableIcon({ className }: { className?: string }) {
  return (
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
      className={className}
    >
      <path d="M12 3v18" />
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M3 9h18" />
      <path d="M3 15h18" />
    </svg>
  )
}

export function TableSidebar({
  tables,
  selectedTableName,
  onSelectTable,
  onCreateTable,
  onClose,
}: {
  tables: SqliteTableSnapshot[]
  selectedTableName: string
  onSelectTable: (tableName: string) => void
  onCreateTable?: () => void
  onClose?: () => void
}) {
  return (
    <aside className="flex w-52 flex-col border-r bg-muted/30">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Tables
        </h2>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Collapse tables sidebar"
          >
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
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        ) : null}
      </div>

      {/* Table List */}
      <nav className="flex-1 overflow-auto p-2">
        <ul className="space-y-0.5">
          {tables.map((table) => (
            <li key={table.name}>
              <button
                type="button"
                onClick={() => onSelectTable(table.name)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                  table.name === selectedTableName
                    ? 'bg-primary/10 font-medium text-primary'
                    : 'text-foreground hover:bg-muted',
                )}
              >
                <TableIcon
                  className={cn(
                    'shrink-0',
                    table.name === selectedTableName
                      ? 'text-primary'
                      : 'text-muted-foreground',
                  )}
                />
                <span className="truncate">{table.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* Footer */}
      {onCreateTable ? (
        <div className="border-t p-2">
          <button
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={onCreateTable}
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
              <path d="M5 12h14" />
              <path d="M12 5v14" />
            </svg>
            <span>Create Table</span>
          </button>
        </div>
      ) : null}
    </aside>
  )
}
