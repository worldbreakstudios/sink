import type { SqliteIndexSnapshot } from '@sink/lib'
import { CardContent } from '@/components/ui/card'

export function TableSchema({
  schema,
  indexes,
}: {
  schema: string
  indexes: SqliteIndexSnapshot[]
}) {
  return (
    <CardContent className="p-4">
      <div className="space-y-4">
        <pre className="overflow-x-auto rounded-md border bg-muted p-3 text-xs text-muted-foreground">
          {schema}
        </pre>
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Indexes</h3>
          {indexes.length === 0 ? (
            <p className="text-xs text-muted-foreground">No indexes on this table.</p>
          ) : (
            <div className="space-y-2">
              {indexes.map((index) => (
                <div
                  key={index.name}
                  className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
                >
                  <div className="font-mono text-foreground">{index.name}</div>
                  <div>
                    fields: {index.fields.length > 0 ? index.fields.join(', ') : '(none)'}
                  </div>
                  <div>
                    {index.unique ? 'unique' : 'non-unique'}
                    {index.partial ? ' • partial' : ''}
                    {index.origin ? ` • origin: ${index.origin}` : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </CardContent>
  )
}
