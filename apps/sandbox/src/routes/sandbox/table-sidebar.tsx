import type { SqliteTableSnapshot } from '@sink/lib'
import { Button } from '@/components/ui/button'
import { CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export function TableSidebar({
  tables,
  selectedTableName,
  tableCounts,
  sqliteVersion,
  onSelectTable,
}: {
  tables: SqliteTableSnapshot[]
  selectedTableName: string
  tableCounts: Record<string, number>
  sqliteVersion: string | undefined
  onSelectTable: (tableName: string) => void
}) {
  return (
    <aside className="border-b md:border-b-0 md:border-r">
      <CardHeader className="border-b p-4">
        <CardTitle className="text-base">Tables</CardTitle>
        <CardDescription>SQLite {sqliteVersion}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-1 p-2">
        {tables.map((table) => (
          <Button
            key={table.name}
            variant={table.name === selectedTableName ? 'secondary' : 'ghost'}
            className={cn(
              'w-full justify-between',
              table.name === selectedTableName && 'font-semibold',
            )}
            onClick={() => onSelectTable(table.name)}
          >
            <span>{table.name}</span>
            <span className="text-xs text-muted-foreground">
              {tableCounts[table.name] ?? 0}
            </span>
          </Button>
        ))}
      </CardContent>
    </aside>
  )
}
