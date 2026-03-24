import type { SqliteTableSnapshot } from '@worldbreakstudios/sink-lib'
import { Button } from '@/components/ui/button'
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
    <aside className="flex w-56 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex items-center justify-between border-b border-sidebar-border px-3 py-3">
        <h2 className="font-heading text-xs font-semibold uppercase tracking-[0.2em] text-sidebar-foreground/70">
          Tables
        </h2>
        {onClose ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="size-7 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
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
          </Button>
        ) : null}
      </div>

      <nav className="flex-1 overflow-auto p-2.5">
        <ul className="space-y-1">
          {tables.map((table) => (
            <li key={table.name}>
              <Button
                variant={table.name === selectedTableName ? 'secondary' : 'ghost'}
                onClick={() => onSelectTable(table.name)}
                className={cn(
                  'h-auto w-full justify-start gap-2.5 rounded-xl px-3 py-2 text-left text-sm shadow-none',
                  table.name === selectedTableName
                    ? 'bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90'
                    : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                )}
              >
                <TableIcon
                  className={cn(
                    'shrink-0',
                    table.name === selectedTableName
                      ? 'text-sidebar-primary-foreground'
                      : 'text-sidebar-foreground/55',
                  )}
                />
                <span className="truncate">{table.name}</span>
              </Button>
            </li>
          ))}
        </ul>
      </nav>

      {onCreateTable ? (
        <div className="border-t border-sidebar-border p-2.5">
          <Button
            variant="outline"
            className="w-full justify-start border-sidebar-border bg-sidebar text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
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
          </Button>
        </div>
      ) : null}
    </aside>
  )
}
