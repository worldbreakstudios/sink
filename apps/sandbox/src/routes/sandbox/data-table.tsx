import { useState, useCallback, useMemo, useEffect } from 'react'
import type { SqliteIndexDefinition } from '@sink/lib'
import { Button } from '@/components/ui/button'
import { CodeBlock } from '@/components/ui/code-block'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import type { SchemaCollections, TableName } from '@/data/generated/schema.gen'
import { INDEXES } from '@/data/generated/schema.gen'
import type { SqliteDemoId, SqliteDemoRow } from '@/lib/sqlite-demo-collections'
import { cn } from '@/lib/utils'
import { formatCellValue, getRowValue, isMultilineColumn } from './utils'

const DEFAULT_COLUMN_WIDTH = 150
const MIN_COLUMN_WIDTH = 50
const STORAGE_KEY_PREFIX = 'sandbox-table-layout:'
const HISTORY_STORAGE_KEY = 'sandbox-query-history'
const MAX_HISTORY_ITEMS = 50

type Operator = 'eq' | 'gt' | 'gte' | 'lt' | 'lte'
type QueryMethod = 'collect' | 'first' | 'unique' | 'take'

interface Constraint {
  field: string
  operator: Operator
  value: string
}

interface HistoryEntry {
  id: string
  tableName: string
  indexName: string
  constraints: Constraint[]
  orderDirection: 'asc' | 'desc'
  queryMethod: QueryMethod
  takeCount: string
  generatedCode: string
  timestamp: number
}

function loadHistory(): HistoryEntry[] {
  try {
    const stored = localStorage.getItem(HISTORY_STORAGE_KEY)
    if (stored) return JSON.parse(stored) as HistoryEntry[]
  } catch {}
  return []
}

function saveHistory(history: HistoryEntry[]): void {
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history.slice(0, MAX_HISTORY_ITEMS)))
  } catch {}
}

function ReadOnlyCell({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }, [value])

  return (
    <div className="group/cell flex items-center gap-1">
      <span className="truncate text-muted-foreground">{value}</span>
      <button
        type="button"
        onClick={handleCopy}
        className={cn(
          'shrink-0 rounded p-0.5',
          'hover:bg-muted',
          copied ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground hover:text-foreground',
        )}
        aria-label="Copy value"
      >
        {copied ? (
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
          </svg>
        )}
      </button>
    </div>
  )
}

interface TableLayout {
  columnWidths: Record<string, number>
  columnOrder: string[]
}

function loadTableLayout(tableName: string): TableLayout | null {
  try {
    const stored = localStorage.getItem(`${STORAGE_KEY_PREFIX}${tableName}`)
    if (stored) {
      return JSON.parse(stored) as TableLayout
    }
  } catch {
    // Ignore parse errors
  }
  return null
}

function saveTableLayout(tableName: string, layout: TableLayout): void {
  try {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${tableName}`, JSON.stringify(layout))
  } catch {
    // Ignore storage errors
  }
}

function formatValueForCode(value: string): string {
  if (value === '') return "''"
  if (value === 'null') return 'null'
  if (value === 'true' || value === 'false') return value
  if (/^\d+n$/.test(value)) return value
  if (/^\d+$/.test(value)) return value
  return `'${value.replace(/'/g, "\\'")}'`
}

export function parseValue(value: string): unknown {
  if (value === '') return ''
  if (value === 'null') return null
  if (value === 'true') return true
  if (value === 'false') return false
  if (/^\d+n$/.test(value)) return BigInt(value.slice(0, -1))
  if (/^\d+$/.test(value)) {
    const num = parseInt(value, 10)
    if (num > Number.MAX_SAFE_INTEGER / 1000) {
      return BigInt(value)
    }
    return num
  }
  return value
}

function formatTimestamp(timestamp: number): string {
  const now = new Date()
  const diffMs = now.getTime() - timestamp
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`

  const date = new Date(timestamp)
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export interface QueryState {
  indexName: string
  constraints: Constraint[]
  orderDirection: 'asc' | 'desc'
  queryMethod: QueryMethod
  takeCount: string
}

export interface QueryResult {
  rows: SqliteDemoRow[]
  executionTime: number
  error?: string
}

export function DataTable({
  tableName,
  columns,
  rows,
  collections,
  queryResult,
  onCellEdit,
  onAddRow,
  onRunQuery,
}: {
  tableName: string
  columns: { name: string; pk?: number }[]
  rows: SqliteDemoRow[]
  collections: SchemaCollections | null
  queryResult: QueryResult | null
  onCellEdit: (rowId: SqliteDemoId, columnName: string, value: string) => Promise<void>
  onAddRow: () => void
  onRunQuery: (query: QueryState) => Promise<void>
}) {
  const [editingCell, setEditingCell] = useState<{
    rowId: SqliteDemoId
    columnName: string
    value: string
  } | null>(null)
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({})
  const [resizing, setResizing] = useState<{ columnName: string; startX: number; startWidth: number } | null>(null)
  const [columnOrder, setColumnOrder] = useState<string[]>([])
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null)
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null)

  // Filter panel state
  const [filterOpen, setFilterOpen] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState<string>('')
  const [constraints, setConstraints] = useState<Constraint[]>([])
  const [orderDirection, setOrderDirection] = useState<'asc' | 'desc'>('asc')
  const [queryMethod, setQueryMethod] = useState<QueryMethod>('collect')
  const [takeCount, setTakeCount] = useState<string>('10')
  const [isRunning, setIsRunning] = useState(false)
  const [activeTab, setActiveTab] = useState<'filters' | 'history'>('filters')
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory)

  // Display either query results or default rows
  const displayRows = queryResult?.rows ?? rows
  const isFiltered = queryResult !== null

  const defaultColumnNames = useMemo(() => columns.map((column) => column.name), [columns])

  const columnNames = useMemo(() => {
    if (columnOrder.length === 0) return defaultColumnNames
    const validOrder = columnOrder.filter((name) => defaultColumnNames.includes(name))
    const newColumns = defaultColumnNames.filter((name) => !validOrder.includes(name))
    return [...validOrder, ...newColumns]
  }, [columnOrder, defaultColumnNames])

  // Get indexes for current table
  const tableIndexes = useMemo(() => {
    const indexes = INDEXES[tableName as TableName]
    if (!indexes) return {}
    return indexes as Record<string, SqliteIndexDefinition<readonly string[]>>
  }, [tableName])

  const indexNames = useMemo(() => Object.keys(tableIndexes), [tableIndexes])

  const indexFields = useMemo(() => {
    if (!selectedIndex || !tableIndexes[selectedIndex]) return []
    return [...tableIndexes[selectedIndex].fields]
  }, [selectedIndex, tableIndexes])

  const isUniqueIndex = useMemo(() => {
    if (!selectedIndex || !tableIndexes[selectedIndex]) return false
    return !!tableIndexes[selectedIndex].unique
  }, [selectedIndex, tableIndexes])

  // When a unique index is selected, pre-populate all fields as constraints
  useEffect(() => {
    if (isUniqueIndex && indexFields.length > 0) {
      const uniqueConstraints: Constraint[] = indexFields.map((field) => ({
        field,
        operator: 'eq' as Operator,
        value: '',
      }))
      setConstraints(uniqueConstraints)
    }
  }, [isUniqueIndex, indexFields])

  // When unique query method is selected, ensure all index fields are constrained
  useEffect(() => {
    if (queryMethod === 'unique' && indexFields.length > 0) {
      const uniqueConstraints: Constraint[] = indexFields.map((field) => ({
        field,
        operator: 'eq' as Operator,
        value: constraints.find((c) => c.field === field)?.value ?? '',
      }))
      setConstraints(uniqueConstraints)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryMethod, indexFields])

  const isUniqueQueryValid = useMemo(() => {
    if (queryMethod !== 'unique') return true
    return constraints.length === indexFields.length && constraints.every((c) => c.value.trim() !== '')
  }, [queryMethod, constraints, indexFields])

  // Generate code
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

    switch (queryMethod) {
      case 'first':
        code += `\n  .first()`
        break
      case 'unique':
        code += `\n  .unique()`
        break
      case 'take':
        code += `\n  .take(${takeCount || '10'})`
        break
      case 'collect':
      default:
        code += `\n  .collect()`
        break
    }

    return code
  }, [tableName, selectedIndex, constraints, orderDirection, queryMethod, takeCount])

  // Load saved layout when table changes
  useEffect(() => {
    const saved = loadTableLayout(tableName)
    if (saved) {
      setColumnWidths(saved.columnWidths)
      setColumnOrder(saved.columnOrder)
    } else {
      setColumnWidths({})
      setColumnOrder([])
    }
  }, [tableName])

  useEffect(() => {
    if (Object.keys(columnWidths).length > 0 || columnOrder.length > 0) {
      saveTableLayout(tableName, { columnWidths, columnOrder })
    }
  }, [tableName, columnWidths, columnOrder])

  useEffect(() => {
    if (!resizing) return

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - resizing.startX
      const newWidth = Math.max(MIN_COLUMN_WIDTH, resizing.startWidth + delta)
      setColumnWidths((prev) => ({ ...prev, [resizing.columnName]: newWidth }))
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

  const handleResizeStart = useCallback((e: React.MouseEvent, columnName: string) => {
    e.preventDefault()
    const currentWidth = columnWidths[columnName] ?? DEFAULT_COLUMN_WIDTH
    setResizing({ columnName, startX: e.clientX, startWidth: currentWidth })
  }, [columnWidths])

  const handleDragStart = useCallback((e: React.DragEvent, columnName: string) => {
    setDraggedColumn(columnName)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', columnName)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, columnName: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverColumn(columnName)
  }, [])

  const handleDragLeave = useCallback(() => {
    setDragOverColumn(null)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent, targetColumn: string) => {
    e.preventDefault()
    const sourceColumn = e.dataTransfer.getData('text/plain')

    if (sourceColumn && sourceColumn !== targetColumn) {
      setColumnOrder((prevOrder) => {
        const currentOrder = prevOrder.length > 0 ? prevOrder : columnNames
        const newOrder = [...currentOrder]
        const sourceIndex = newOrder.indexOf(sourceColumn)
        const targetIndex = newOrder.indexOf(targetColumn)

        if (sourceIndex !== -1 && targetIndex !== -1) {
          newOrder.splice(sourceIndex, 1)
          newOrder.splice(targetIndex, 0, sourceColumn)
        }

        return newOrder
      })
    }

    setDraggedColumn(null)
    setDragOverColumn(null)
  }, [columnNames])

  const handleDragEnd = useCallback(() => {
    setDraggedColumn(null)
    setDragOverColumn(null)
  }, [])

  const readOnlyColumns = useMemo(
    () =>
      new Set(
        columns
          .filter((column) => column.pk || column.name.startsWith('_'))
          .map((column) => column.name),
      ),
    [columns],
  )

  const commitCellEdit = useCallback(
    async (rowId: SqliteDemoId, columnName: string, value: string) => {
      await onCellEdit(rowId, columnName, value)
      setEditingCell(null)
    },
    [onCellEdit],
  )

  const handleRun = useCallback(async () => {
    if (!collections || !selectedIndex) return

    setIsRunning(true)
    await onRunQuery({
      indexName: selectedIndex,
      constraints: [...constraints],
      orderDirection,
      queryMethod,
      takeCount,
    })
    setIsRunning(false)

    // Add to history
    const entry: HistoryEntry = {
      id: crypto.randomUUID(),
      tableName,
      indexName: selectedIndex,
      constraints: [...constraints],
      orderDirection,
      queryMethod,
      takeCount,
      generatedCode,
      timestamp: Date.now(),
    }
    setHistory((prev) => {
      const updated = [entry, ...prev].slice(0, MAX_HISTORY_ITEMS)
      saveHistory(updated)
      return updated
    })
  }, [collections, selectedIndex, constraints, orderDirection, queryMethod, takeCount, tableName, generatedCode, onRunQuery])

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
    setQueryMethod('collect')
    setTakeCount('10')
  }, [])

  const restoreFromHistory = useCallback((entry: HistoryEntry) => {
    setSelectedIndex(entry.indexName)
    setConstraints(entry.constraints)
    setOrderDirection(entry.orderDirection)
    setQueryMethod(entry.queryMethod)
    setTakeCount(entry.takeCount)
    setActiveTab('filters')
  }, [])

  const removeFromHistory = useCallback((id: string) => {
    setHistory((prev) => {
      const updated = prev.filter((e) => e.id !== id)
      saveHistory(updated)
      return updated
    })
  }, [])

  const clearHistory = useCallback(() => {
    setHistory([])
    saveHistory([])
  }, [])

  const activeFilterCount = useMemo(() => {
    let count = 0
    if (selectedIndex) count++
    count += constraints.filter((c) => c.value.trim() !== '').length
    return count
  }, [selectedIndex, constraints])

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Table Header */}
      <div className="flex items-center justify-between border-b bg-background px-4 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">{tableName}</h1>
          <span className="text-sm text-muted-foreground">
            {displayRows.length} {displayRows.length === 1 ? 'document' : 'documents'}
          </span>
          {isFiltered && queryResult.executionTime !== undefined && (
            <span className="text-xs text-muted-foreground">
              · {queryResult.executionTime.toFixed(2)}ms
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={filterOpen ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setFilterOpen(!filterOpen)}
            className="gap-1"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
            Filter & Sort
            {activeFilterCount > 0 && (
              <span className="ml-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground">
                {activeFilterCount}
              </span>
            )}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={cn('transition-transform', filterOpen && 'rotate-180')}
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </Button>
          {isFiltered && (
            <Button variant="ghost" size="sm" onClick={handleClear} className="text-xs">
              Clear filter
            </Button>
          )}
          <Button size="sm" onClick={() => { setEditingCell(null); onAddRow() }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1">
              <path d="M5 12h14" />
              <path d="M12 5v14" />
            </svg>
            Add
          </Button>
        </div>
      </div>

      {/* Filter Panel */}
      {filterOpen && (
        <div className="border-b bg-muted/30">
          {/* Tabs */}
          <div className="flex items-center gap-1 border-b px-4">
            <button
              type="button"
              onClick={() => setActiveTab('filters')}
              className={cn(
                'border-b-2 px-3 py-2 text-xs font-medium transition-colors',
                activeTab === 'filters'
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              Filters
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className={cn(
                'border-b-2 px-3 py-2 text-xs font-medium transition-colors',
                activeTab === 'history'
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              History {history.length > 0 && `(${history.length})`}
            </button>
          </div>

          {activeTab === 'filters' && (
            <div className="flex gap-4 p-4">
              <div className="flex flex-1 flex-col gap-3">
                {/* Index Selection */}
                <div className="flex items-center gap-2">
                  <label className="w-16 shrink-0 text-xs font-medium text-muted-foreground">Index</label>
                  <Select
                    value={selectedIndex}
                    onValueChange={(value) => {
                      setSelectedIndex(value === '_default' ? '' : value)
                      setConstraints([])
                      setQueryMethod('collect')
                    }}
                  >
                    <SelectTrigger className="h-8 flex-1 text-sm">
                      <SelectValue placeholder="By creation time (default)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_default">By creation time (default)</SelectItem>
                      {indexNames.map((name) => (
                        <SelectItem key={name} value={name}>
                          {name} ({tableIndexes[name]?.fields.join(', ')})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Order Direction */}
                <div className="flex items-center gap-2">
                  <label className="w-16 shrink-0 text-xs font-medium text-muted-foreground">Order</label>
                  <Select value={orderDirection} onValueChange={(value) => setOrderDirection(value as 'asc' | 'desc')}>
                    <SelectTrigger className="h-8 w-32 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="asc">Ascending</SelectItem>
                      <SelectItem value="desc">Descending</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Constraints */}
                {selectedIndex && queryMethod === 'unique' ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <label className="w-16 shrink-0 text-xs font-medium text-muted-foreground">Match</label>
                      <span className="text-xs text-muted-foreground">Fill all fields for exact match</span>
                    </div>
                    {indexFields.map((field, i) => (
                      <div key={field} className="ml-[72px] flex items-center gap-2">
                        <span className="w-24 shrink-0 text-xs font-medium">{field}</span>
                        <span className="text-xs text-muted-foreground">=</span>
                        <Input
                          value={constraints[i]?.value ?? ''}
                          onChange={(e) => updateConstraint(i, { value: e.target.value })}
                          placeholder={`Enter ${field}`}
                          className="h-7 flex-1 text-xs"
                        />
                      </div>
                    ))}
                  </div>
                ) : selectedIndex && (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <label className="w-16 shrink-0 text-xs font-medium text-muted-foreground">Where</label>
                      <Button variant="outline" size="sm" onClick={addConstraint} className="h-7 text-xs">
                        + Add filter
                      </Button>
                    </div>
                    {constraints.map((constraint, i) => (
                      <div key={i} className="ml-[72px] flex items-center gap-2">
                        <Select value={constraint.field} onValueChange={(value) => updateConstraint(i, { field: value })}>
                          <SelectTrigger size="sm" className="h-7 w-28 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {indexFields.map((field) => (
                              <SelectItem key={field} value={field}>{field}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select value={constraint.operator} onValueChange={(value) => updateConstraint(i, { operator: value as Operator })}>
                          <SelectTrigger size="sm" className="h-7 w-16 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="eq">=</SelectItem>
                            <SelectItem value="gt">&gt;</SelectItem>
                            <SelectItem value="gte">&gt;=</SelectItem>
                            <SelectItem value="lt">&lt;</SelectItem>
                            <SelectItem value="lte">&lt;=</SelectItem>
                          </SelectContent>
                        </Select>
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

                {/* Return Method */}
                {selectedIndex && (
                  <div className="flex items-center gap-2">
                    <label className="w-16 shrink-0 text-xs font-medium text-muted-foreground">Return</label>
                    <Select value={queryMethod} onValueChange={(value) => setQueryMethod(value as QueryMethod)}>
                      <SelectTrigger size="sm" className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="collect">All rows</SelectItem>
                        <SelectItem value="first">First row</SelectItem>
                        {isUniqueIndex && <SelectItem value="unique">Exact match</SelectItem>}
                        <SelectItem value="take">First n rows</SelectItem>
                      </SelectContent>
                    </Select>
                    {queryMethod === 'take' && (
                      <Input
                        type="number"
                        value={takeCount}
                        onChange={(e) => setTakeCount(e.target.value)}
                        placeholder="10"
                        className="h-8 w-16 text-sm"
                        min="1"
                      />
                    )}
                  </div>
                )}

                {/* Run Button */}
                <div className="flex items-center gap-2 pt-2">
                  <Button
                    onClick={handleRun}
                    disabled={isRunning || !collections || !selectedIndex || !isUniqueQueryValid}
                    size="sm"
                  >
                    {isRunning ? 'Running...' : queryMethod === 'unique' && !isUniqueQueryValid ? 'Fill all fields' : 'Apply Filter'}
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleClear}>
                    Clear
                  </Button>
                  {queryResult?.error && (
                    <span className="text-xs text-destructive">{queryResult.error}</span>
                  )}
                </div>
              </div>

              {/* Code Preview */}
              <div className="w-72 shrink-0">
                <div className="text-xs font-medium text-muted-foreground mb-2">Generated Code</div>
                <CodeBlock code={generatedCode} language="typescript" />
              </div>
            </div>
          )}

          {activeTab === 'history' && (
            <div className="max-h-64 overflow-auto">
              {history.length === 0 ? (
                <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                  No query history yet.
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between border-b px-4 py-2">
                    <span className="text-xs text-muted-foreground">{history.length} queries</span>
                    <Button variant="ghost" size="sm" onClick={clearHistory} className="h-6 text-xs text-muted-foreground hover:text-destructive">
                      Clear all
                    </Button>
                  </div>
                  {history.map((entry) => (
                    <div
                      key={entry.id}
                      className="group flex cursor-pointer items-start gap-3 border-b px-4 py-3 hover:bg-muted/50"
                      onClick={() => restoreFromHistory(entry)}
                    >
                      <div className="flex-1 overflow-hidden">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium">{entry.tableName}</span>
                          <span className="text-xs text-muted-foreground">·</span>
                          <span className="text-xs text-muted-foreground">{entry.indexName}</span>
                          {entry.tableName !== tableName && (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-900 dark:text-amber-300">
                              different table
                            </span>
                          )}
                        </div>
                        <pre className="mt-1 truncate font-mono text-xs text-muted-foreground">
                          {entry.generatedCode.split('\n').slice(0, 2).join(' ')}...
                        </pre>
                        <div className="mt-1 text-[10px] text-muted-foreground">
                          {formatTimestamp(entry.timestamp)}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          removeFromHistory(entry.id)
                        }}
                        className="h-6 w-6 shrink-0 p-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 6 6 18" />
                          <path d="m6 6 12 12" />
                        </svg>
                      </Button>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Table Content */}
      <div className="flex-1 overflow-auto">
        {displayRows.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {isFiltered ? 'No matching rows.' : 'No rows in this table.'}
          </div>
        ) : (
          <Table className="w-full min-w-max">
            <TableHeader className="sticky top-0 bg-muted/50 backdrop-blur-sm">
              <TableRow>
                {columnNames.map((columnName) => (
                  <TableHead
                    key={columnName}
                    draggable
                    onDragStart={(e) => handleDragStart(e, columnName)}
                    onDragOver={(e) => handleDragOver(e, columnName)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, columnName)}
                    onDragEnd={handleDragEnd}
                    className={cn(
                      'relative cursor-grab whitespace-nowrap active:cursor-grabbing',
                      dragOverColumn === columnName && draggedColumn !== columnName && 'bg-primary/10',
                      draggedColumn === columnName && 'opacity-50',
                    )}
                    style={{
                      width: columnName === columnNames[columnNames.length - 1] ? undefined : (columnWidths[columnName] ?? DEFAULT_COLUMN_WIDTH),
                      minWidth: columnWidths[columnName] ?? DEFAULT_COLUMN_WIDTH,
                    }}
                  >
                    {columnName}
                    <div
                      onMouseDown={(e) => handleResizeStart(e, columnName)}
                      className={cn(
                        'absolute right-0 top-0 bottom-0 w-1 cursor-col-resize',
                        'hover:bg-primary/40',
                        resizing?.columnName === columnName ? 'bg-primary/50' : 'bg-border',
                      )}
                    />
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayRows.map((row) => {
                const rowId = row._id

                return (
                  <TableRow key={`${tableName}-${rowId}`} className="group">
                    {columnNames.map((columnName) => (
                      <TableCell
                        key={`${tableName}-${rowId}-${columnName}`}
                        className="font-mono text-xs"
                        style={{
                          width: columnName === columnNames[columnNames.length - 1] ? undefined : (columnWidths[columnName] ?? DEFAULT_COLUMN_WIDTH),
                          minWidth: columnWidths[columnName] ?? DEFAULT_COLUMN_WIDTH,
                          maxWidth: columnName === columnNames[columnNames.length - 1] ? undefined : (columnWidths[columnName] ?? DEFAULT_COLUMN_WIDTH),
                        }}
                      >
                        {editingCell?.rowId === rowId &&
                        editingCell.columnName === columnName ? (
                          isMultilineColumn(columnName) ? (
                            <Textarea
                              autoFocus
                              value={editingCell.value}
                              onChange={(event) =>
                                setEditingCell({
                                  rowId,
                                  columnName,
                                  value: event.target.value,
                                })
                              }
                              onBlur={() =>
                                commitCellEdit(rowId, columnName, editingCell.value)
                              }
                              className="min-h-24"
                            />
                          ) : (
                            <Input
                              autoFocus
                              value={editingCell.value}
                              onChange={(event) =>
                                setEditingCell({
                                  rowId,
                                  columnName,
                                  value: event.target.value,
                                })
                              }
                              onBlur={() =>
                                commitCellEdit(rowId, columnName, editingCell.value)
                              }
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  commitCellEdit(rowId, columnName, editingCell.value)
                                }

                                if (event.key === 'Escape') {
                                  setEditingCell(null)
                                }
                              }}
                              className="h-7 text-xs"
                            />
                          )
                        ) : readOnlyColumns.has(columnName) ? (
                          <ReadOnlyCell value={formatCellValue(getRowValue(row, columnName))} />
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              setEditingCell({
                                rowId,
                                columnName,
                                value: formatCellValue(getRowValue(row, columnName)),
                              })
                            }
                            className="block w-full truncate text-left hover:text-primary"
                          >
                            {formatCellValue(getRowValue(row, columnName))}
                          </button>
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}
