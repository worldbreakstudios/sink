import { CodeBlock } from '../CodeBlock'

interface SchemaPanelProps {
  schemaSource: string
  tableName: string
}

export function SchemaPanel({ schemaSource, tableName }: SchemaPanelProps) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Generated schema for <code className="rounded bg-muted px-1">{tableName}</code>
      </p>
      <CodeBlock code={schemaSource.trim()} language="typescript" />
    </div>
  )
}
