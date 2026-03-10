import { useState, useCallback, useMemo, useEffect } from 'react'
import type { SqliteCollection, SqliteIndexDefinition } from '@sink/lib'
import { Button } from '@/components/ui/button'
import { CodeBlock } from '@/components/ui/code-block'
import { Input } from '@/components/ui/input'
import type { SchemaCollections, TableName } from '@/data/generated/schema.gen'
import { INDEXES } from '@/data/generated/schema.gen'
import type { SqliteDemoRow } from '@/lib/sqlite-demo-collections'
import { cn } from '@/lib/utils'

const DEFAULT_HEIGHT = 300
const MIN_HEIGHT = 150
const MAX_HEIGHT = 600
const STORAGE_KEY = 'sandbox-query-panel-height'

type Operator = 'eq' | 'gt' | 'gte' | 'lt' | 'lte'

interface Constraint {
  field: string
  operator: Operator
  value: string
}

interface QueryResult {
  rows: SqliteDemoRow[]
  rowCount: number
  executionTime: number
  generatedCode: string
}

export function QueryPanel({
  collections,
  tableName,
}: {
  collections: SchemaCollections | null
  tableName: string
}) {
  const [selectedIndex, setSelectedIndex] = useState<string>('')
  const [constraints, setConstraints] = useState<Constraint[]>([])
  const [orderDirection, setOrderDirection] = useState<'asc' | 'desc'>('asc')
  const [limit, setLimit] = useState<string>('')
  const [result, setResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [height, setHeight] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) return Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, parseInt(stored, 10)))
    } catch {}
    return DEFAULT_HEIGHT
  })
  const [resizing, setResizing] = useState<{ startY: number; startHeight: number } | null>(null)

  // Handle resize
  useEffect(() => {
    if (!resizing) return

    const handleMouseMove = (e: MouseEvent) => {
      // Dragging up decreases Y, which should increase height
      const delta = resizing.startY - e.clientY
      const newHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, resizing.startHeight + delta))
      setHeight(newHeight)
    }

    const handleMouseUp = () => {
      setResizing(null)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [resizing])

  // Persist height
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(height))
    } catch {}
  }, [height])

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setResizing({ startY: e.clientY, startHeight: height })
  }, [height])

  // Get indexes for current table
  const tableIndexes = useMemo(() => {
    const indexes = INDEXES[tableName as TableName]
    if (!indexes) return {}
    return indexes as Record<string, SqliteIndexDefinition<readonly string[]>>
  }, [tableName])

  const indexNames = useMemo(() => Object.keys(tableIndexes), [tableIndexes])

  // Get fields for selected index
  const indexFields = useMemo(() => {
    if (!selectedIndex || !tableIndexes[selectedIndex]) return []
    return [...tableIndexes[selectedIndex].fields]
  }, [selectedIndex, tableIndexes])

  // Generate the TypeScript code
  const generatedCode = useMemo(() => {
    if (!selectedIndex) return `// Select an index to build a query`

    let code = `await collections.${tableName}\n  .query()\n  .withIndex('${selectedIndex}'`

    if (constraints.length > 0) {
      code += `, (q) => q`
      for (const c of constraints) {
        code += `\n    .${c.operator}('${c.field}', ${formatValueForCode(c.value)})`
      }
      code += `\n  )`
    } else {
      code += `)`
    }

    code += `\n  .order('${orderDirection}')`

    if (limit && parseInt(limit) > 0) {
      code += `\n  .take(${limit})`
    } else {
      code += `\n  .collect()`
    }

    return code
  }, [tableName, selectedIndex, constraints, orderDirection, limit])

  const handleRun = useCallback(async () => {
    if (!collections || !selectedIndex) return

    setIsRunning(true)
    setError(null)
    setResult(null)

    const startTime = performance.now()

    try {
      const collection = collections[tableName as TableName] as unknown as SqliteCollection<SqliteDemoRow, string>

      // Build the query dynamically
      let query = collection.query().withIndex(selectedIndex, (q: any) => {
        let builder = q
        for (const c of constraints) {
          const value = parseValue(c.value)
          builder = builder[c.operator](c.field, value)
        }
        return builder
      })

      query = query.order(orderDirection)

      let rows: SqliteDemoRow[]
      if (limit && parseInt(limit) > 0) {
        rows = await query.take(parseInt(limit))
      } else {
        rows = await query.collect()
      }

      const executionTime = performance.now() - startTime

      setResult({
        rows,
        rowCount: rows.length,
        executionTime,
        generatedCode,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Query failed')
    } finally {
      setIsRunning(false)
    }
  }, [collections, tableName, selectedIndex, constraints, orderDirection, limit, generatedCode])

  const addConstraint = useCallback(() => {
    const firstField = indexFields[0]
    if (!firstField) return
    setConstraints((prev) => [
      ...prev,
      { field: firstField, operator: 'eq' as Operator, value: '' },
    ])
  }, [indexFields])

  const updateConstraint = useCallback((index: number, updates: Partial<Constraint>) => {
    setConstraints((prev) =>
      prev.map((c, i) => (i === index ? { ...c, ...updates } : c)),
    )
  }, [])

  const removeConstraint = useCallback((index: number) => {
    setConstraints((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const handleClear = useCallback(() => {
    setSelectedIndex('')
    setConstraints([])
    setOrderDirection('asc')
    setLimit('')
    setResult(null)
    setError(null)
  }, [])

  return (
    <div className="flex flex-col border-t" style={{ height }}>
      {/* Resize Handle */}
      <div
        onMouseDown={handleResizeStart}
        className={cn(
          'h-1 cursor-ns-resize bg-border transition-colors hover:bg-primary/40',
          resizing && 'bg-primary/50',
        )}
      />
      {/* Query Builder */}
      <div className="flex min-h-0 flex-1 gap-4 overflow-auto border-b bg-muted/30 p-4">
        {/* Left: Query config */}
        <div className="flex flex-1 flex-col gap-3">
          {/* Index Selection */}
          <div className="flex items-center gap-2">
            <label className="w-16 shrink-0 text-xs font-medium text-muted-foreground">Index</label>
            <select
              value={selectedIndex}
              onChange={(e) => {
                setSelectedIndex(e.target.value)
                setConstraints([])
              }}
              className="h-8 flex-1 rounded-md border bg-background px-2 text-sm"
            >
              <option value="">Select an index...</option>
              {indexNames.map((name) => (
                <option key={name} value={name}>
                  {name} ({tableIndexes[name]?.fields.join(', ')})
                </option>
              ))}
            </select>
          </div>

          {/* Constraints */}
          {selectedIndex && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <label className="w-16 shrink-0 text-xs font-medium text-muted-foreground">Where</label>
                <Button variant="outline" size="sm" onClick={addConstraint} className="h-7 text-xs">
                  + Add constraint
                </Button>
              </div>
              {constraints.map((constraint, i) => (
                <div key={i} className="ml-[72px] flex items-center gap-2">
                  <select
                    value={constraint.field}
                    onChange={(e) => updateConstraint(i, { field: e.target.value })}
                    className="h-7 rounded-md border bg-background px-2 text-xs"
                  >
                    {indexFields.map((field) => (
                      <option key={field} value={field}>{field}</option>
                    ))}
                  </select>
                  <select
                    value={constraint.operator}
                    onChange={(e) => updateConstraint(i, { operator: e.target.value as Operator })}
                    className="h-7 w-20 rounded-md border bg-background px-2 text-xs"
                  >
                    <option value="eq">=</option>
                    <option value="gt">&gt;</option>
                    <option value="gte">&gt;=</option>
                    <option value="lt">&lt;</option>
                    <option value="lte">&lt;=</option>
                  </select>
                  <Input
                    value={constraint.value}
                    onChange={(e) => updateConstraint(i, { value: e.target.value })}
                    placeholder="value"
                    className="h-7 flex-1 text-xs"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeConstraint(i)}
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 6 6 18" />
                      <path d="m6 6 12 12" />
                    </svg>
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Order & Limit */}
          {selectedIndex && (
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <label className="w-16 shrink-0 text-xs font-medium text-muted-foreground">Order</label>
                <select
                  value={orderDirection}
                  onChange={(e) => setOrderDirection(e.target.value as 'asc' | 'desc')}
                  className="h-8 rounded-md border bg-background px-2 text-sm"
                >
                  <option value="asc">Ascending</option>
                  <option value="desc">Descending</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-muted-foreground">Limit</label>
                <Input
                  type="number"
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                  placeholder="all"
                  className="h-8 w-20 text-sm"
                />
              </div>
            </div>
          )}
        </div>

        {/* Right: Generated code preview */}
        <div className="flex w-80 flex-col gap-2">
          <div className="text-xs font-medium text-muted-foreground">Generated Code</div>
          <div className="flex-1 overflow-auto">
            <CodeBlock code={generatedCode} language="typescript" />
          </div>
          <div className="flex gap-2">
            <Button onClick={handleRun} disabled={isRunning || !collections || !selectedIndex} size="sm" className="flex-1">
              {isRunning ? 'Running...' : 'Run Query'}
            </Button>
            <Button variant="outline" size="sm" onClick={handleClear}>
              Clear
            </Button>
          </div>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="shrink-0 border-b border-red-300 bg-red-50 px-4 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          <span className="font-medium">Error:</span> {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Results Header */}
          <div className="flex shrink-0 items-center gap-3 border-b bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
            <span>
              {result.rowCount} {result.rowCount === 1 ? 'row' : 'rows'}
            </span>
            <span>·</span>
            <span>{result.executionTime.toFixed(2)}ms</span>
          </div>

          {/* Results Table */}
          {result.rows.length > 0 && result.rows[0] ? (
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
                  <tr>
                    {Object.keys(result.rows[0] as object).map((col) => (
                      <th
                        key={col}
                        className="whitespace-nowrap border-b px-3 py-2 text-left font-medium"
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, i) => (
                    <tr key={i} className="border-b last:border-b-0 hover:bg-muted/30">
                      {Object.values(row).map((value, j) => (
                        <td key={j} className="max-w-xs truncate px-3 py-1.5 font-mono">
                          {formatValue(value)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              Query returned no rows.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function formatValue(value: unknown): string {
  if (value === null) return 'NULL'
  if (value === undefined) return ''
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function formatValueForCode(value: string): string {
  // Try to detect type
  if (value === '') return "''"
  if (value === 'null') return 'null'
  if (value === 'true' || value === 'false') return value
  if (/^\d+n$/.test(value)) return value // bigint
  if (/^\d+$/.test(value)) return value // number
  return `'${value.replace(/'/g, "\\'")}'`
}

function parseValue(value: string): unknown {
  if (value === '') return ''
  if (value === 'null') return null
  if (value === 'true') return true
  if (value === 'false') return false
  if (/^\d+n$/.test(value)) return BigInt(value.slice(0, -1))
  if (/^\d+$/.test(value)) {
    const num = parseInt(value, 10)
    // Use bigint for large numbers (timestamps)
    if (num > Number.MAX_SAFE_INTEGER / 1000) {
      return BigInt(value)
    }
    return num
  }
  return value
}
