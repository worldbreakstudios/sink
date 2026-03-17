import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { TableName } from '@/data/generated/schema.gen'
import { serializeSqliteDemoKey, getSqliteDemoRowKey } from '@/lib/sqlite-demo-collections'
import type { SqliteDemoRow } from '@/lib/sqlite-demo-collections'
import { formatReferenceOptionLabel } from './utils'

export interface IndexedQueryPreviewData {
  title: string
  query: string
  rows: SqliteDemoRow[]
}

export function IndexedQueryPreview({
  preview,
  tableName,
}: {
  preview: IndexedQueryPreviewData
  tableName: TableName
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Indexed Query Preview</CardTitle>
        <CardDescription>
          Using `{preview.title}` on `{tableName}`.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <pre className="overflow-x-auto rounded-md border bg-muted p-3 text-xs text-muted-foreground">
          {preview.query}
        </pre>
        <div className="space-y-1 text-sm">
          {preview.rows.map((row) => (
            <div
              key={serializeSqliteDemoKey(tableName, getSqliteDemoRowKey(tableName, row))}
              className="rounded-md border px-3 py-2"
            >
              {formatReferenceOptionLabel(tableName, row)}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
