import { useState, useMemo, useCallback, useEffect } from 'react'
import type { IndexDefinition, QueryState, QueryConstraint, Operator, QueryMethod } from '../../types'
import { cn } from '../../utils/cn'
import { formatValueForCode } from '../../utils/parse'
import { formatTimestamp } from '../../utils/format'
import { CodeBlock } from '../CodeBlock'

const MAX_HISTORY_ITEMS = 50
const HISTORY_STORAGE_KEY = 'devtools-ui-query-history'

interface HistoryEntry {
  id: string
  tableName: string
  indexName: string
  constraints: QueryConstraint[]
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

export interface PrefillFilter {
  field: string
  operator: Operator
  value: string
}

interface QueryBuilderProps {
  tableName: string
  indexes: Record<string, IndexDefinition>
  isOpen: boolean
  onClose: () => void
  onRunQuery: (query: QueryState) => Promise<void>
  prefillFilter?: PrefillFilter | null
  onPrefillConsumed?: () => void
}

export function QueryBuilder({
  tableName,
  indexes,
  isOpen,
  onClose,
  onRunQuery,
  prefillFilter,
  onPrefillConsumed,
}: QueryBuilderProps) {
  const [selectedIndex, setSelectedIndex] = useState<string>('')
  const [constraints, setConstraints] = useState<QueryConstraint[]>([])
  const [orderDirection, setOrderDirection] = useState<'asc' | 'desc'>('asc')
  const [queryMethod, setQueryMethod] = useState<QueryMethod>('collect')
  const [takeCount, setTakeCount] = useState<string>('10')
  const [isRunning, setIsRunning] = useState(false)
  const [activeTab, setActiveTab] = useState<'filters' | 'history'>('filters')
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory)

  const indexNames = useMemo(() => Object.keys(indexes), [indexes])

  // Handle prefill filter from cell action menu
  useEffect(() => {
    if (!prefillFilter) return

    // Find an index that contains this field
    const indexName = Object.entries(indexes).find(
      ([, def]) => def.fields.includes(prefillFilter.field)
    )?.[0]

    if (indexName) {
      setSelectedIndex(indexName)
      setConstraints([{
        field: prefillFilter.field,
        operator: prefillFilter.operator,
        value: prefillFilter.value,
      }])
      setActiveTab('filters')
      onPrefillConsumed?.()
    }
  }, [prefillFilter, indexes, onPrefillConsumed])

  const indexFields = useMemo(() => {
    if (!selectedIndex || !indexes[selectedIndex]) return []
    return [...indexes[selectedIndex].fields]
  }, [selectedIndex, indexes])

  const isUniqueIndex = useMemo(() => {
    if (!selectedIndex || !indexes[selectedIndex]) return false
    return indexes[selectedIndex].unique
  }, [selectedIndex, indexes])

  // When unique index selected, pre-populate constraints
  useEffect(() => {
    if (isUniqueIndex && indexFields.length > 0) {
      const uniqueConstraints: QueryConstraint[] = indexFields.map((field) => ({
        field,
        operator: 'eq' as Operator,
        value: '',
      }))
      setConstraints(uniqueConstraints)
    }
  }, [isUniqueIndex, indexFields])

  // When unique method selected, ensure all fields are constrained
  useEffect(() => {
    if (queryMethod === 'unique' && indexFields.length > 0) {
      const uniqueConstraints: QueryConstraint[] = indexFields.map((field) => ({
        field,
        operator: 'eq' as Operator,
        value: constraints.find((c) => c.field === field)?.value ?? '',
      }))
      setConstraints(uniqueConstraints)
    }
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

  const handleRun = useCallback(async () => {
    if (!selectedIndex) return

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
  }, [selectedIndex, constraints, orderDirection, queryMethod, takeCount, tableName, generatedCode, onRunQuery])

  const addConstraint = useCallback(() => {
    const firstField = indexFields[0]
    if (!firstField) return
    setConstraints((prev) => [...prev, { field: firstField, operator: 'eq' as Operator, value: '' }])
  }, [indexFields])

  const updateConstraint = useCallback((index: number, updates: Partial<QueryConstraint>) => {
    setConstraints((prev) => prev.map((c, i) => (i === index ? { ...c, ...updates } : c)))
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

  if (!isOpen) return null

  const tableHistory = history.filter((e) => e.tableName === tableName)

  return (
    <div className="border-b bg-muted/30">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('filters')}
            className={cn(
              'px-3 py-1 text-sm font-medium transition-colors rounded',
              activeTab === 'filters' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Query Builder
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={cn(
              'px-3 py-1 text-sm font-medium transition-colors rounded',
              activeTab === 'history' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            History {tableHistory.length > 0 && `(${tableHistory.length})`}
          </button>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>

      {activeTab === 'filters' ? (
        <div className="p-4 space-y-4">
          {/* Index Selection */}
          <div className="flex gap-4 items-start">
            <div className="flex-1 space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Index</label>
              <select
                value={selectedIndex}
                onChange={(e) => {
                  setSelectedIndex(e.target.value)
                  setConstraints([])
                }}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="">Select an index...</option>
                {indexNames.map((name) => (
                  <option key={name} value={name}>
                    {name} ({indexes[name]!.fields.join(', ')})
                    {indexes[name]!.unique && ' [unique]'}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Order</label>
              <select
                value={orderDirection}
                onChange={(e) => setOrderDirection(e.target.value as 'asc' | 'desc')}
                className="rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Method</label>
              <select
                value={queryMethod}
                onChange={(e) => setQueryMethod(e.target.value as QueryMethod)}
                className="rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="collect">collect()</option>
                <option value="first">first()</option>
                <option value="unique">unique()</option>
                <option value="take">take(n)</option>
              </select>
            </div>

            {queryMethod === 'take' && (
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Count</label>
                <input
                  type="number"
                  value={takeCount}
                  onChange={(e) => setTakeCount(e.target.value)}
                  className="w-20 rounded-md border bg-background px-3 py-2 text-sm"
                  min="1"
                />
              </div>
            )}
          </div>

          {/* Constraints */}
          {selectedIndex && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">Constraints</label>
                {!isUniqueIndex && queryMethod !== 'unique' && (
                  <button
                    type="button"
                    onClick={addConstraint}
                    className="text-xs text-primary hover:underline"
                  >
                    + Add constraint
                  </button>
                )}
              </div>
              {constraints.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No constraints (will return all rows)</p>
              ) : (
                <div className="space-y-2">
                  {constraints.map((constraint, index) => (
                    <div key={index} className="flex gap-2 items-center">
                      <select
                        value={constraint.field}
                        onChange={(e) => updateConstraint(index, { field: e.target.value })}
                        className="rounded-md border bg-background px-2 py-1.5 text-sm"
                        disabled={queryMethod === 'unique'}
                      >
                        {indexFields.map((field) => (
                          <option key={field} value={field}>
                            {field}
                          </option>
                        ))}
                      </select>
                      <select
                        value={constraint.operator}
                        onChange={(e) => updateConstraint(index, { operator: e.target.value as Operator })}
                        className="rounded-md border bg-background px-2 py-1.5 text-sm"
                        disabled={queryMethod === 'unique'}
                      >
                        <option value="eq">=</option>
                        <option value="gt">&gt;</option>
                        <option value="gte">&gt;=</option>
                        <option value="lt">&lt;</option>
                        <option value="lte">&lt;=</option>
                      </select>
                      <input
                        type="text"
                        value={constraint.value}
                        onChange={(e) => updateConstraint(index, { value: e.target.value })}
                        placeholder="value"
                        className="flex-1 rounded-md border bg-background px-2 py-1.5 text-sm"
                      />
                      {!isUniqueIndex && queryMethod !== 'unique' && (
                        <button
                          type="button"
                          onClick={() => removeConstraint(index)}
                          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 6 6 18" />
                            <path d="m6 6 12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Generated Code Preview */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Generated Query</label>
            <CodeBlock code={generatedCode} language="typescript" />
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleRun}
              disabled={!selectedIndex || isRunning || (queryMethod === 'unique' && !isUniqueQueryValid)}
              className={cn(
                'rounded-md px-4 py-2 text-sm font-medium transition-colors',
                'bg-primary text-primary-foreground hover:bg-primary/90',
                'disabled:cursor-not-allowed disabled:opacity-50'
              )}
            >
              {isRunning ? 'Running...' : 'Run Query'}
            </button>
            <button
              type="button"
              onClick={handleClear}
              className="rounded-md border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Clear
            </button>
          </div>
        </div>
      ) : (
        <div className="p-4 space-y-3 max-h-64 overflow-auto">
          {tableHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No query history for this table</p>
          ) : (
            tableHistory.map((entry) => (
              <div key={entry.id} className="rounded-md border bg-card p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{formatTimestamp(entry.timestamp)}</span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => restoreFromHistory(entry)}
                      className="rounded px-2 py-1 text-xs text-primary hover:bg-primary/10"
                    >
                      Restore
                    </button>
                    <button
                      type="button"
                      onClick={() => removeFromHistory(entry.id)}
                      className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                    >
                      Remove
                    </button>
                  </div>
                </div>
                <pre className="text-xs font-mono bg-muted p-2 rounded overflow-x-auto">
                  {entry.generatedCode}
                </pre>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
