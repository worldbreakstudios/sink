import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  SerializedSqliteValue,
  SinkDevtoolsQueryInput,
  SinkDevtoolsRowRecord,
  SinkDevtoolsSchemaMetadata,
  SqliteReferenceColumn,
  SqliteTableColumn,
} from '@sink/lib'
import { cn, formatCellValue, getRowId, getRowValue, isBlobValue, isMultilineColumn, serializeRowKey } from '../utils'
import { CellActionMenu } from './cell-action-menu'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { CodeBlock } from './ui/code-block'
import { Input } from './ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './ui/table'
import { Textarea } from './ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './ui/tooltip'
import { ValueViewerModal } from './value-viewer-modal'

const DEFAULT_COLUMN_WIDTH = 150
const MIN_COLUMN_WIDTH = 50
const STORAGE_KEY_PREFIX = 'sink-explorer-table-layout:'
const HISTORY_STORAGE_KEY = 'sink-explorer-query-history'
const MAX_HISTORY_ITEMS = 50

interface HistoryEntry {
  id: string
  tableName: string
  indexName: string
  constraints: SinkDevtoolsQueryInput['constraints']
  orderDirection: 'asc' | 'desc'
  queryMethod: SinkDevtoolsQueryInput['queryMethod']
  takeCount: string
  generatedCode: string
  timestamp: number
}

interface QueryResult {
  rows: SinkDevtoolsRowRecord[]
  executionTime: number
  error?: string
}

interface TableLayout {
  columnWidths: Record<string, number>
  columnOrder: string[]
}

function loadHistory(): HistoryEntry[] {
  try {
    const stored = localStorage.getItem(HISTORY_STORAGE_KEY)
    return stored ? (JSON.parse(stored) as HistoryEntry[]) : []
  } catch {
    return []
  }
}

function saveHistory(history: HistoryEntry[]): void {
  try {
    localStorage.setItem(
      HISTORY_STORAGE_KEY,
      JSON.stringify(history.slice(0, MAX_HISTORY_ITEMS)),
    )
  } catch {
    // Ignore storage errors in extension/private contexts.
  }
}

function loadTableLayout(tableName: string): TableLayout | null {
  try {
    const stored = localStorage.getItem(`${STORAGE_KEY_PREFIX}${tableName}`)
    return stored ? (JSON.parse(stored) as TableLayout) : null
  } catch {
    return null
  }
}

function saveTableLayout(tableName: string, layout: TableLayout): void {
  try {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${tableName}`, JSON.stringify(layout))
  } catch {
    // Ignore storage errors in extension/private contexts.
  }
}

function formatValueForCode(value: string): string {
  if (value === '') return "''"
  if (value === 'null') return 'null'
  if (value === 'true' || value === 'false') return value
  if (/^-?\d+n$/.test(value)) return value
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return value
  return `'${value.replace(/'/g, "\\'")}'`
}

function formatTimestamp(timestamp: number): string {
  const now = Date.now()
  const diffMs = now - timestamp
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`

  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

function getColumnValidator(
  columnName: string,
  column: SqliteTableColumn,
  referenceColumns: Partial<Record<string, SqliteReferenceColumn>>,
): string {
  if (columnName === '_id') return 'v.id()'
  if (columnName === '_createdAt') return 'v.number()'
  if (columnName === '_updatedAt') return 'v.optional(v.number())'
  if (columnName === '_archivedAt') return 'v.optional(v.number())'

  const referenceColumn = referenceColumns[columnName]

  if (referenceColumn) {
    return referenceColumn.enforceExists
      ? `v.id('${referenceColumn.referencedTable}', { enforceExists: true })`
      : `v.id('${referenceColumn.referencedTable}')`
  }

  const sqlType = column.type.toUpperCase()
  let validator = 'v.string()'

  if (sqlType.includes('INT') || sqlType.includes('REAL') || sqlType.includes('FLOAT')) {
    validator = 'v.number()'
  } else if (sqlType.includes('BOOL')) {
    validator = 'v.boolean()'
  }

  if (column.notnull === 0 && column.pk === 0) {
    validator = `v.optional(${validator})`
  }

  return validator
}

export { type QueryResult }

export function DataTable({
  tableName,
  columns,
  rows,
  schema,
  queryResult,
  onCellEdit,
  onAddRow,
  onRunQuery,
  onSelectionChange,
}: {
  tableName: string
  columns: SqliteTableColumn[]
  rows: SinkDevtoolsRowRecord[]
  schema: SinkDevtoolsSchemaMetadata
  queryResult: QueryResult | null
  onCellEdit: (
    rowId: SerializedSqliteValue,
    columnName: string,
    value: string,
  ) => Promise<void>
  onAddRow: () => void
  onRunQuery: (query: SinkDevtoolsQueryInput) => Promise<void>
  onSelectionChange?: (selectedRows: SinkDevtoolsRowRecord[]) => void
}) {
  const referenceColumns = useMemo(
    () =>
      (schema.referenceColumns[tableName] ?? {}) as Partial<
        Record<string, SqliteReferenceColumn>
      >,
    [schema.referenceColumns, tableName],
  )
  const columnInfoMap = useMemo(
    () => Object.fromEntries(columns.map((column) => [column.name, column])),
    [columns],
  )
  const [editingCell, setEditingCell] = useState<{
    rowId: SerializedSqliteValue
    rowKey: string
    columnName: string
    value: string
  } | null>(null)
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({})
  const [resizing, setResizing] = useState<{
    columnName: string
    startX: number
    startWidth: number
  } | null>(null)
  const [columnOrder, setColumnOrder] = useState<string[]>([])
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null)
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState('')
  const [constraints, setConstraints] = useState<
    SinkDevtoolsQueryInput['constraints']
  >([])
  const [orderDirection, setOrderDirection] = useState<'asc' | 'desc'>('asc')
  const [queryMethod, setQueryMethod] =
    useState<SinkDevtoolsQueryInput['queryMethod']>('collect')
  const [takeCount, setTakeCount] = useState('10')
  const [isRunning, setIsRunning] = useState(false)
  const [activeTab, setActiveTab] = useState<'filters' | 'history'>('filters')
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory)
  const [viewerModal, setViewerModal] = useState<{
    columnName: string
    value: string
  } | null>(null)
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    setSelectedRowIds(new Set())
  }, [tableName])

  const displayRows = queryResult?.rows ?? rows
  const isFiltered = queryResult !== null

  useEffect(() => {
    if (!onSelectionChange) {
      return
    }

    onSelectionChange(
      displayRows.filter((row) => selectedRowIds.has(serializeRowKey(getRowId(row)))),
    )
  }, [displayRows, onSelectionChange, selectedRowIds])

  const toggleRowSelection = useCallback((rowId: SerializedSqliteValue) => {
    const rowKey = serializeRowKey(rowId)
    setSelectedRowIds((current) => {
      const next = new Set(current)
      if (next.has(rowKey)) {
        next.delete(rowKey)
      } else {
        next.add(rowKey)
      }
      return next
    })
  }, [])

  const toggleAllSelection = useCallback(() => {
    setSelectedRowIds((current) => {
      if (current.size === displayRows.length) {
        return new Set()
      }

      return new Set(displayRows.map((row) => serializeRowKey(getRowId(row))))
    })
  }, [displayRows])

  const isAllSelected =
    displayRows.length > 0 && selectedRowIds.size === displayRows.length
  const isSomeSelected =
    selectedRowIds.size > 0 && selectedRowIds.size < displayRows.length

  const defaultColumnNames = useMemo(
    () => columns.map((column) => column.name),
    [columns],
  )
  const columnNames = useMemo(() => {
    if (columnOrder.length === 0) {
      return defaultColumnNames
    }

    const validOrder = columnOrder.filter((columnName) =>
      defaultColumnNames.includes(columnName),
    )
    const newColumns = defaultColumnNames.filter(
      (columnName) => !validOrder.includes(columnName),
    )

    return [...validOrder, ...newColumns]
  }, [columnOrder, defaultColumnNames])
  const tableIndexes = useMemo(
    () =>
      (schema.indexes[tableName] ?? {}) as Record<
        string,
        { fields: readonly string[]; unique: boolean }
      >,
    [schema.indexes, tableName],
  )
  const indexNames = useMemo(() => Object.keys(tableIndexes), [tableIndexes])
  const allIndexFields = useMemo(() => {
    const fields = new Set<string>()
    for (const index of Object.values(tableIndexes)) {
      for (const field of index.fields) {
        fields.add(field)
      }
    }
    return fields
  }, [tableIndexes])
  const indexFields = useMemo(
    () =>
      selectedIndex && tableIndexes[selectedIndex]
        ? [...tableIndexes[selectedIndex].fields]
        : [],
    [selectedIndex, tableIndexes],
  )
  const isUniqueIndex = useMemo(
    () => Boolean(selectedIndex && tableIndexes[selectedIndex]?.unique),
    [selectedIndex, tableIndexes],
  )

  useEffect(() => {
    if (isUniqueIndex && indexFields.length > 0) {
      setConstraints(
        indexFields.map((field) => ({
          field,
          operator: 'eq',
          value: '',
        })),
      )
    }
  }, [indexFields, isUniqueIndex])

  useEffect(() => {
    if (queryMethod !== 'unique' || indexFields.length === 0) {
      return
    }

    setConstraints((current) =>
      indexFields.map((field) => ({
        field,
        operator: 'eq',
        value: current.find((constraint) => constraint.field === field)?.value ?? '',
      })),
    )
  }, [indexFields, queryMethod])

  const isUniqueQueryValid = useMemo(
    () =>
      queryMethod !== 'unique' ||
      (constraints.length === indexFields.length &&
        constraints.every((constraint) => constraint.value.trim() !== '')),
    [constraints, indexFields, queryMethod],
  )

  const generatedCode = useMemo(() => {
    if (!selectedIndex) {
      return '// Select an index to build a query'
    }

    let code = `await collections.${tableName}\n  .query()\n  .withIndex('${selectedIndex}'`

    if (constraints.length > 0) {
      code += ', (q) => q'
      for (const constraint of constraints) {
        code += `\n    .${constraint.operator}('${constraint.field}', ${formatValueForCode(constraint.value)})`
      }
      code += '\n  )'
    } else {
      code += ')'
    }

    code += `\n  .order('${orderDirection}')`

    switch (queryMethod) {
      case 'first':
        return `${code}\n  .first()`
      case 'unique':
        return `${code}\n  .unique()`
      case 'take':
        return `${code}\n  .take(${takeCount || '10'})`
      case 'collect':
      default:
        return `${code}\n  .collect()`
    }
  }, [constraints, orderDirection, queryMethod, selectedIndex, tableName, takeCount])

  useEffect(() => {
    const savedLayout = loadTableLayout(tableName)
    if (savedLayout) {
      setColumnWidths(savedLayout.columnWidths)
      setColumnOrder(savedLayout.columnOrder)
      return
    }

    setColumnWidths({})
    setColumnOrder([])
  }, [tableName])

  useEffect(() => {
    if (Object.keys(columnWidths).length === 0 && columnOrder.length === 0) {
      return
    }

    saveTableLayout(tableName, { columnWidths, columnOrder })
  }, [columnOrder, columnWidths, tableName])

  useEffect(() => {
    if (!resizing) {
      return
    }

    const handleMouseMove = (event: MouseEvent) => {
      const delta = event.clientX - resizing.startX
      const newWidth = Math.max(MIN_COLUMN_WIDTH, resizing.startWidth + delta)
      setColumnWidths((current) => ({
        ...current,
        [resizing.columnName]: newWidth,
      }))
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

  const handleResizeStart = useCallback(
    (event: React.MouseEvent, columnName: string) => {
      event.preventDefault()
      const currentWidth = columnWidths[columnName] ?? DEFAULT_COLUMN_WIDTH
      setResizing({
        columnName,
        startX: event.clientX,
        startWidth: currentWidth,
      })
    },
    [columnWidths],
  )

  const handleDragStart = useCallback(
    (event: React.DragEvent, columnName: string) => {
      setDraggedColumn(columnName)
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', columnName)
    },
    [],
  )

  const handleDrop = useCallback(
    (event: React.DragEvent, targetColumn: string) => {
      event.preventDefault()
      const sourceColumn = event.dataTransfer.getData('text/plain')

      if (sourceColumn && sourceColumn !== targetColumn) {
        setColumnOrder((currentOrder) => {
          const workingOrder =
            currentOrder.length > 0 ? [...currentOrder] : [...columnNames]
          const sourceIndex = workingOrder.indexOf(sourceColumn)
          const targetIndex = workingOrder.indexOf(targetColumn)

          if (sourceIndex === -1 || targetIndex === -1) {
            return workingOrder
          }

          const [movedColumn] = workingOrder.splice(sourceIndex, 1)

          if (!movedColumn) {
            return workingOrder
          }

          workingOrder.splice(targetIndex, 0, movedColumn)
          return workingOrder
        })
      }

      setDraggedColumn(null)
      setDragOverColumn(null)
    },
    [columnNames],
  )

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
    async (
      rowId: SerializedSqliteValue,
      columnName: string,
      value: string,
    ) => {
      await onCellEdit(rowId, columnName, value)
      setEditingCell(null)
    },
    [onCellEdit],
  )

  const handleRun = useCallback(async () => {
    if (!selectedIndex) {
      return
    }

    const query: SinkDevtoolsQueryInput = {
      indexName: selectedIndex,
      constraints: [...constraints],
      orderDirection,
      queryMethod,
      takeCount,
    }

    setIsRunning(true)
    await onRunQuery(query)
    setIsRunning(false)

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

    setHistory((current) => {
      const next = [entry, ...current].slice(0, MAX_HISTORY_ITEMS)
      saveHistory(next)
      return next
    })
  }, [
    constraints,
    generatedCode,
    onRunQuery,
    orderDirection,
    queryMethod,
    selectedIndex,
    tableName,
    takeCount,
  ])

  const restoreFromHistory = useCallback((entry: HistoryEntry) => {
    setSelectedIndex(entry.indexName)
    setConstraints(entry.constraints)
    setOrderDirection(entry.orderDirection)
    setQueryMethod(entry.queryMethod)
    setTakeCount(entry.takeCount)
    setActiveTab('filters')
  }, [])

  const removeFromHistory = useCallback((historyId: string) => {
    setHistory((current) => {
      const next = current.filter((entry) => entry.id !== historyId)
      saveHistory(next)
      return next
    })
  }, [])

  const handleClear = useCallback(() => {
    setSelectedIndex('')
    setConstraints([])
    setOrderDirection('asc')
    setQueryMethod('collect')
    setTakeCount('10')
  }, [])

  const activeFilterCount = useMemo(() => {
    let count = 0
    if (selectedIndex) count += 1
    count += constraints.filter((constraint) => constraint.value.trim() !== '').length
    return count
  }, [constraints, selectedIndex])

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b bg-background px-4 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">{tableName}</h1>
          <span className="whitespace-nowrap text-sm text-muted-foreground">
            {displayRows.length} {displayRows.length === 1 ? 'document' : 'documents'}
          </span>
          {isFiltered && queryResult?.executionTime !== undefined && (
            <span className="text-xs text-muted-foreground">
              · {queryResult.executionTime.toFixed(2)}ms
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={filterOpen ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setFilterOpen((current) => !current)}
            className="gap-1"
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
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
            Filter & Sort
            {activeFilterCount > 0 && (
              <span className="ml-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] text-primary-foreground">
                {activeFilterCount}
              </span>
            )}
          </Button>
          {isFiltered && (
            <Button variant="ghost" size="sm" onClick={handleClear} className="text-xs">
              Clear filter
            </Button>
          )}
          <Button size="sm" onClick={() => {
            setEditingCell(null)
            onAddRow()
          }}>
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
              className="mr-1"
            >
              <path d="M5 12h14" />
              <path d="M12 5v14" />
            </svg>
            Add
          </Button>
        </div>
      </div>

      {filterOpen && (
        <div className="border-b bg-muted/30">
          <div className="flex items-center gap-1 border-b px-4">
            {(['filters', 'history'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={cn(
                  'border-b-2 px-3 py-2 text-xs font-medium transition-colors',
                  activeTab === tab
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {tab === 'filters'
                  ? 'Filters'
                  : `History ${history.length > 0 ? `(${history.length})` : ''}`}
              </button>
            ))}
          </div>

          {activeTab === 'filters' ? (
            <div className="flex gap-4 p-4">
              <div className="flex flex-1 flex-col gap-3">
                <div className="flex items-center gap-2">
                  <label className="w-16 shrink-0 text-xs font-medium text-muted-foreground">
                    Index
                  </label>
                  <Select
                    value={selectedIndex}
                    onValueChange={(value) => {
                      setSelectedIndex(value === '_default' ? '' : value)
                      setConstraints([])
                      setQueryMethod('collect')
                    }}
                  >
                    <SelectTrigger className="h-8 flex-1 text-sm">
                      <SelectValue placeholder="Select index" />
                    </SelectTrigger>
                    <SelectContent>
                      {indexNames.map((indexName) => (
                        <SelectItem key={indexName} value={indexName}>
                          {indexName} ({tableIndexes[indexName]?.fields.join(', ')})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center gap-2">
                  <label className="w-16 shrink-0 text-xs font-medium text-muted-foreground">
                    Order
                  </label>
                  <Select
                    value={orderDirection}
                    onValueChange={(value) => setOrderDirection(value as 'asc' | 'desc')}
                  >
                    <SelectTrigger className="h-8 w-32 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="asc">Ascending</SelectItem>
                      <SelectItem value="desc">Descending</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {selectedIndex && queryMethod === 'unique' ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <label className="w-16 shrink-0 text-xs font-medium text-muted-foreground">
                        Match
                      </label>
                      <span className="text-xs text-muted-foreground">
                        Fill all fields for exact match
                      </span>
                    </div>
                    {indexFields.map((field, index) => (
                      <div key={field} className="ml-[72px] flex items-center gap-2">
                        <span className="w-24 shrink-0 text-xs font-medium">{field}</span>
                        <span className="text-xs text-muted-foreground">=</span>
                        <Input
                          value={constraints[index]?.value ?? ''}
                          onChange={(event) =>
                            setConstraints((current) =>
                              current.map((constraint, constraintIndex) =>
                                constraintIndex === index
                                  ? { ...constraint, value: event.target.value }
                                  : constraint,
                              ),
                            )
                          }
                          placeholder={`Enter ${field}`}
                          className="h-7 flex-1 text-xs"
                        />
                      </div>
                    ))}
                  </div>
                ) : selectedIndex ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <label className="w-16 shrink-0 text-xs font-medium text-muted-foreground">
                        Where
                      </label>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const firstField = indexFields[0]
                          if (!firstField) {
                            return
                          }
                          setConstraints((current) => [
                            ...current,
                            {
                              field: firstField,
                              operator: 'eq',
                              value: '',
                            },
                          ])
                        }}
                        className="h-7 text-xs"
                      >
                        + Add filter
                      </Button>
                    </div>
                    {constraints.map((constraint, index) => (
                      <div key={`${constraint.field}-${index}`} className="ml-[72px] flex items-center gap-2">
                        <Select
                          value={constraint.field}
                          onValueChange={(value) =>
                            setConstraints((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, field: value } : item,
                              ),
                            )
                          }
                        >
                          <SelectTrigger size="sm" className="h-7 w-28 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {indexFields.map((field) => (
                              <SelectItem key={field} value={field}>
                                {field}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select
                          value={constraint.operator}
                          onValueChange={(value) =>
                            setConstraints((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index
                                  ? {
                                      ...item,
                                      operator: value as SinkDevtoolsQueryInput['constraints'][number]['operator'],
                                    }
                                  : item,
                              ),
                            )
                          }
                        >
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
                          onChange={(event) =>
                            setConstraints((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, value: event.target.value }
                                  : item,
                              ),
                            )
                          }
                          placeholder="value"
                          className="h-7 flex-1 text-xs"
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setConstraints((current) =>
                              current.filter((_, itemIndex) => itemIndex !== index),
                            )
                          }
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
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
                            <path d="M18 6 6 18" />
                            <path d="m6 6 12 12" />
                          </svg>
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : null}

                {selectedIndex && (
                  <div className="flex items-center gap-2">
                    <label className="w-16 shrink-0 text-xs font-medium text-muted-foreground">
                      Return
                    </label>
                    <Select
                      value={queryMethod}
                      onValueChange={(value) =>
                        setQueryMethod(value as SinkDevtoolsQueryInput['queryMethod'])
                      }
                    >
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
                        onChange={(event) => setTakeCount(event.target.value)}
                        placeholder="10"
                        className="h-8 w-16 text-sm"
                        min="1"
                      />
                    )}
                  </div>
                )}

                <div className="flex items-center gap-2 pt-2">
                  <Button
                    onClick={handleRun}
                    disabled={isRunning || !selectedIndex || !isUniqueQueryValid}
                    size="sm"
                  >
                    {isRunning
                      ? 'Running...'
                      : queryMethod === 'unique' && !isUniqueQueryValid
                        ? 'Fill all fields'
                        : 'Apply Filter'}
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleClear}>
                    Clear
                  </Button>
                  {queryResult?.error && (
                    <span className="text-xs text-destructive">{queryResult.error}</span>
                  )}
                </div>
              </div>

              <div className="w-72 shrink-0">
                <div className="mb-2 text-xs font-medium text-muted-foreground">
                  Generated Code
                </div>
                <CodeBlock code={generatedCode} language="typescript" />
              </div>
            </div>
          ) : (
            <div className="max-h-64 overflow-auto">
              {history.length === 0 ? (
                <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                  No query history yet.
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between border-b px-4 py-2">
                    <span className="text-xs text-muted-foreground">
                      {history.length} queries
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setHistory([])
                        saveHistory([])
                      }}
                      className="h-6 text-xs text-muted-foreground hover:text-destructive"
                    >
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
                        onClick={(event) => {
                          event.stopPropagation()
                          removeFromHistory(entry.id)
                        }}
                        className="h-6 w-6 shrink-0 p-0 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
                      >
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
                        >
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

      <div className="flex-1 overflow-auto">
        {displayRows.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {isFiltered ? 'No matching rows.' : 'No rows in this table.'}
          </div>
        ) : (
          <Table className="w-full min-w-max">
            <TableHeader className="sticky top-0 bg-muted/50 backdrop-blur-sm">
              <TableRow>
                <TableHead className="w-10 px-3">
                  <Checkbox
                    checked={isAllSelected ? true : isSomeSelected ? 'indeterminate' : false}
                    onCheckedChange={toggleAllSelection}
                    aria-label="Select all"
                  />
                </TableHead>
                {columnNames.map((columnName) => (
                  <TableHead
                    key={columnName}
                    draggable
                    onDragStart={(event) => handleDragStart(event, columnName)}
                    onDragOver={(event) => {
                      event.preventDefault()
                      setDragOverColumn(columnName)
                    }}
                    onDragLeave={() => setDragOverColumn(null)}
                    onDrop={(event) => handleDrop(event, columnName)}
                    onDragEnd={() => {
                      setDraggedColumn(null)
                      setDragOverColumn(null)
                    }}
                    className={cn(
                      'relative cursor-grab whitespace-nowrap active:cursor-grabbing',
                      dragOverColumn === columnName &&
                        draggedColumn !== columnName &&
                        'bg-primary/10',
                      draggedColumn === columnName && 'opacity-50',
                    )}
                    style={{
                      width:
                        columnName === columnNames[columnNames.length - 1]
                          ? undefined
                          : (columnWidths[columnName] ?? DEFAULT_COLUMN_WIDTH),
                      minWidth: columnWidths[columnName] ?? DEFAULT_COLUMN_WIDTH,
                    }}
                  >
                    <TooltipProvider delayDuration={300}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-help">{columnName}</span>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="font-mono text-xs">
                          {columnInfoMap[columnName]
                            ? getColumnValidator(
                                columnName,
                                columnInfoMap[columnName]!,
                                referenceColumns,
                              )
                            : 'unknown'}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <div
                      onMouseDown={(event) => handleResizeStart(event, columnName)}
                      className={cn(
                        'absolute bottom-0 right-0 top-0 w-1 cursor-col-resize',
                        'hover:bg-primary/40',
                        resizing?.columnName === columnName
                          ? 'bg-primary/50'
                          : 'bg-border',
                      )}
                    />
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayRows.map((row) => {
                const rowId = getRowId(row)
                const rowKey = serializeRowKey(rowId)
                const isRowSelected = selectedRowIds.has(rowKey)

                return (
                  <TableRow
                    key={`${tableName}-${rowKey}`}
                    className={cn('group', isRowSelected && 'bg-accent')}
                  >
                    <TableCell className="w-10 px-3">
                      <Checkbox
                        checked={isRowSelected}
                        onCheckedChange={() => toggleRowSelection(rowId)}
                        onClick={(event) => event.stopPropagation()}
                        aria-label={`Select row ${rowKey}`}
                      />
                    </TableCell>
                    {columnNames.map((columnName) => {
                      const rawValue = getRowValue(row, columnName)
                      const value = formatCellValue(rawValue)
                      const cellReadOnly =
                        readOnlyColumns.has(columnName) || isBlobValue(rawValue)

                      return (
                        <TableCell
                          key={`${tableName}-${rowKey}-${columnName}`}
                          className="font-mono text-xs"
                          style={{
                            width:
                              columnName === columnNames[columnNames.length - 1]
                                ? undefined
                                : (columnWidths[columnName] ?? DEFAULT_COLUMN_WIDTH),
                            minWidth: columnWidths[columnName] ?? DEFAULT_COLUMN_WIDTH,
                            maxWidth:
                              columnName === columnNames[columnNames.length - 1]
                                ? undefined
                                : (columnWidths[columnName] ?? DEFAULT_COLUMN_WIDTH),
                          }}
                        >
                          {editingCell?.rowKey === rowKey &&
                          editingCell.columnName === columnName ? (
                            isMultilineColumn(columnName) ? (
                              <Textarea
                                autoFocus
                                value={editingCell.value}
                                onChange={(event) =>
                                  setEditingCell({
                                    ...editingCell,
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
                                    ...editingCell,
                                    value: event.target.value,
                                  })
                                }
                                onBlur={() =>
                                  commitCellEdit(rowId, columnName, editingCell.value)
                                }
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    void commitCellEdit(rowId, columnName, editingCell.value)
                                  }

                                  if (event.key === 'Escape') {
                                    setEditingCell(null)
                                  }
                                }}
                                className="h-7 text-xs"
                              />
                            )
                          ) : (
                            <div className="group/cell flex items-center justify-between gap-1">
                              <span
                                className={cn(
                                  'truncate',
                                  cellReadOnly && 'text-muted-foreground',
                                )}
                              >
                                {value}
                              </span>
                              <CellActionMenu
                                value={value}
                                columnName={columnName}
                                isReadOnly={cellReadOnly}
                                canFilter={allIndexFields.has(columnName)}
                                onEdit={() =>
                                  setEditingCell({
                                    rowId,
                                    rowKey,
                                    columnName,
                                    value,
                                  })
                                }
                                onView={() =>
                                  setViewerModal({
                                    columnName,
                                    value,
                                  })
                                }
                                onFilter={(operator, operatorValue) => {
                                  const indexName = Object.entries(tableIndexes).find(
                                    ([, definition]) =>
                                      definition.fields.includes(columnName),
                                  )?.[0]

                                  if (!indexName) {
                                    return
                                  }

                                  setSelectedIndex(indexName)
                                  setConstraints([
                                    {
                                      field: columnName,
                                      operator,
                                      value: operatorValue,
                                    },
                                  ])
                                  setFilterOpen(true)
                                  setActiveTab('filters')
                                }}
                              />
                            </div>
                          )}
                        </TableCell>
                      )
                    })}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <ValueViewerModal
        open={viewerModal !== null}
        onClose={() => setViewerModal(null)}
        columnName={viewerModal?.columnName ?? ''}
        value={viewerModal?.value ?? ''}
      />
    </div>
  )
}
