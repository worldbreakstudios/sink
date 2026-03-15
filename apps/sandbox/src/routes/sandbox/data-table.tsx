import { useState, useCallback, useMemo, useEffect } from 'react'
import type { SqliteIndexDefinition, SqliteReferenceColumn } from '@sink/lib'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { SchemaCollections, TableName } from '@/data/generated/schema.gen'
import {
  INDEXES,
  REFERENCE_COLUMNS,
  SCHEMA_VALIDATORS,
} from '@/data/generated/schema.gen'
import {
  getSqliteDemoRowKey,
  serializeSqliteDemoKey,
  type SqliteDemoId,
  type SqliteDemoRow,
} from '@/lib/sqlite-demo-collections'
import { cn } from '@/lib/utils'
import { CellActionMenu } from './cell-action-menu'
import {
  formatCellValue,
  getRowValue,
  isMultilineColumn,
  isStructuredColumnType,
} from './utils'
import { ValueViewerModal } from './value-viewer-modal'

const DEFAULT_COLUMN_WIDTH = 150
const MIN_COLUMN_WIDTH = 50
const STORAGE_KEY_PREFIX = 'sandbox-table-layout:'
const HISTORY_STORAGE_KEY = 'sandbox-query-history'
const MAX_HISTORY_ITEMS = 50

type Operator = 'eq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'isKnown' | 'isUnknown'
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
  offsetCursor?: string
  generatedCode: string
  timestamp: number
}

const OPERATORS: Array<{ value: Operator; label: string }> = [
  { value: 'eq', label: '=' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '>=' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '<=' },
  { value: 'like', label: 'LIKE' },
  { value: 'isKnown', label: 'IS KNOWN' },
  { value: 'isUnknown', label: 'IS UNKNOWN' },
]

function operatorNeedsValue(operator: Operator): boolean {
  return operator !== 'isKnown' && operator !== 'isUnknown'
}

function isConstraintActive(constraint: Constraint): boolean {
  return operatorNeedsValue(constraint.operator)
    ? constraint.value.trim() !== ''
    : true
}

function isTextBackedSqlType(columnType: string | undefined): boolean {
  if (!columnType) {
    return false
  }

  const sqlType = columnType.toUpperCase()

  return (
    (sqlType.includes('TEXT') ||
      sqlType.includes('CHAR') ||
      sqlType.includes('CLOB')) &&
    !sqlType.includes('INT') &&
    !sqlType.includes('REAL') &&
    !sqlType.includes('FLOA') &&
    !sqlType.includes('DOUB') &&
    !sqlType.includes('BOOL')
  )
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
  const parsed = parseValue(value)

  if (parsed === '') return "''"
  if (parsed === null) return 'null'
  if (typeof parsed === 'boolean' || typeof parsed === 'number') {
    return String(parsed)
  }
  if (typeof parsed === 'bigint') {
    return `${parsed}n`
  }
  if (
    Array.isArray(parsed) ||
    (typeof parsed === 'object' && parsed !== null)
  ) {
    return JSON.stringify(parsed)
  }

  return `'${String(parsed).replace(/'/g, "\\'")}'`
}

function formatConstraintForCode(constraint: Constraint): string {
  if (!operatorNeedsValue(constraint.operator)) {
    return `.${constraint.operator}('${constraint.field}')`
  }

  return `.${constraint.operator}('${constraint.field}', ${formatValueForCode(constraint.value)})`
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
  if (value.startsWith('{') || value.startsWith('[')) {
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
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

function getColumnValidator(
  tableName: string,
  columnName: string,
  column: { name: string; type: string; notnull?: number; pk?: number },
  referenceColumns: Record<string, SqliteReferenceColumn>,
): string {
  const generatedValidator = (
    SCHEMA_VALIDATORS as Partial<Record<string, Record<string, string>>>
  )[tableName]?.[columnName]

  if (generatedValidator) {
    return generatedValidator
  }

  // System columns
  if (columnName === '_id') return 'v.id()'
  if (columnName === '_createdAt') return 'v.number()'
  if (columnName === '_updatedAt') return 'v.number()'
  if (columnName === '_archivedAt') return 'v.nullable(v.number())'

  const ref = referenceColumns[columnName]
  if (ref) {
    return ref.enforceExists
      ? `v.id('${ref.referencedTable}', { enforceExists: true })`
      : `v.id('${ref.referencedTable}')`
  }

  const sqlType = column.type.toUpperCase()
  let validator: string
  if (sqlType.includes('INT')) {
    validator = 'v.number()'
  } else if (sqlType.includes('REAL') || sqlType.includes('FLOAT') || sqlType.includes('DOUBLE')) {
    validator = 'v.number()'
  } else if (sqlType.includes('BOOL')) {
    validator = 'v.boolean()'
  } else {
    validator = 'v.string()'
  }

  if (column.notnull === 0 && column.pk === 0) {
    validator = `v.nullable(${validator})`
  }

  return validator
}

export interface QueryState {
  indexName: string
  constraints: Constraint[]
  orderDirection: 'asc' | 'desc'
  queryMethod: QueryMethod
  takeCount: string
  offsetCursor: string
}

export interface QueryResult {
  rows: SqliteDemoRow[]
  executionTime: number
  isLive?: boolean
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
  onDeleteSelected,
  onClearQuery,
  onRunQuery,
  onSelectionChange,
  selectedRowKeys,
}: {
  tableName: string
  columns: { name: string; type: string; pk?: number; notnull?: number }[]
  rows: SqliteDemoRow[]
  collections: SchemaCollections | null
  queryResult: QueryResult | null
  onCellEdit: (rowId: SqliteDemoId, columnName: string, value: string) => Promise<void>
  onAddRow: () => void
  onDeleteSelected?: (rowKeys: string[]) => Promise<void>
  onClearQuery?: () => void
  onRunQuery: (query: QueryState) => Promise<void>
  onSelectionChange?: (selectedIds: Set<string>) => void
  selectedRowKeys: Set<string>
}) {
  // Get reference columns for validator display
  const referenceColumns = useMemo(() => {
    return (REFERENCE_COLUMNS[tableName as TableName] ?? {}) as Record<string, SqliteReferenceColumn>
  }, [tableName])

  // Create a map from column name to column info for quick lookup
  const columnInfoMap = useMemo(() => {
    const map: Record<string, { name: string; type: string; pk?: number; notnull?: number }> = {}
    for (const col of columns) {
      map[col.name] = col
    }
    return map
  }, [columns])
  const getOperatorOptionsForField = useCallback((field: string) => {
    const rootField = field.split('.')[0] ?? field
    const rootColumnType = columnInfoMap[rootField]?.type
    const normalizedRootColumnType = rootColumnType?.toUpperCase() ?? ''
    const supportsLike =
      isTextBackedSqlType(rootColumnType) &&
      (field.includes('.') || !normalizedRootColumnType.includes('JSON_'))

    return OPERATORS.filter((operator) => {
      if (operator.value !== 'like') {
        return true
      }

      return supportsLike
    })
  }, [columnInfoMap])
  const [editingCell, setEditingCell] = useState<{
    rowId: SqliteDemoId
    rowKey: string
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
  const [offsetCursor, setOffsetCursor] = useState<string>('')
  const [isRunning, setIsRunning] = useState(false)
  const [activeTab, setActiveTab] = useState<'filters' | 'history'>('filters')
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory)
  const [isDeleting, setIsDeleting] = useState(false)

  // Value viewer modal state
  const [viewerModal, setViewerModal] = useState<{ columnName: string; value: string } | null>(null)

  // Display either query results or default rows
  const displayRows = queryResult?.rows ?? rows
  const isFiltered = queryResult !== null
  const getRowId = useCallback(
    (row: SqliteDemoRow) => getSqliteDemoRowKey(tableName as TableName, row),
    [tableName],
  )
  const getSerializedRowId = useCallback(
    (row: SqliteDemoRow) =>
      serializeSqliteDemoKey(tableName as TableName, getRowId(row)),
    [getRowId, tableName],
  )

  // Selection helpers
  const toggleRowSelection = useCallback((rowKey: string) => {
    const next = new Set(selectedRowKeys)
    if (next.has(rowKey)) {
      next.delete(rowKey)
    } else {
      next.add(rowKey)
    }
    onSelectionChange?.(next)
  }, [onSelectionChange, selectedRowKeys])

  const toggleAllSelection = useCallback(() => {
    if (selectedRowKeys.size === displayRows.length) {
      onSelectionChange?.(new Set())
      return
    }

    onSelectionChange?.(new Set(displayRows.map((row) => getSerializedRowId(row))))
  }, [displayRows, getSerializedRowId, onSelectionChange, selectedRowKeys.size])

  const isAllSelected = displayRows.length > 0 && selectedRowKeys.size === displayRows.length
  const isSomeSelected = selectedRowKeys.size > 0 && selectedRowKeys.size < displayRows.length

  const handleDeleteSelectedClick = useCallback(async () => {
    if (!onDeleteSelected || selectedRowKeys.size === 0) {
      return
    }

    setIsDeleting(true)

    try {
      await onDeleteSelected(Array.from(selectedRowKeys))
    } finally {
      setIsDeleting(false)
    }
  }, [onDeleteSelected, selectedRowKeys])

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

  // Get all fields that are part of any index (for filter menu)
  const allIndexFields = useMemo(() => {
    const fields = new Set<string>()
    for (const index of Object.values(tableIndexes)) {
      for (const field of index.fields) {
        fields.add(field)
      }
    }
    return fields
  }, [tableIndexes])

  const indexFields = useMemo(() => {
    if (!selectedIndex || !tableIndexes[selectedIndex]) return []
    return [...tableIndexes[selectedIndex].fields]
  }, [selectedIndex, tableIndexes])

  const isUniqueIndex = useMemo(() => {
    if (!selectedIndex || !tableIndexes[selectedIndex]) return false
    return !!tableIndexes[selectedIndex].unique
  }, [selectedIndex, tableIndexes])

  const offsetPlaceholder = useMemo(() => {
    if (indexFields.length === 0) {
      return 'cursor'
    }

    if (indexFields.length === 1) {
      return indexFields[0] ?? 'cursor'
    }

    return JSON.stringify(
      Object.fromEntries(indexFields.map((field) => [field, '...'])),
    )
  }, [indexFields])

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

    let code = `import { useLiveQuery } from '@tanstack/react-db'\n\nconst result = useLiveQuery((q) =>\n  collections.${tableName}\n    .query()\n    .withIndex('${selectedIndex}'`

    if (constraints.length > 0) {
      code += `, (builder) => builder`
      for (const c of constraints) {
        code += `\n    ${formatConstraintForCode(c)}`
      }
      code += `\n    )`
    } else {
      code += `)`
    }

    code += `\n    .order('${orderDirection}')`

    if (queryMethod === 'take' && offsetCursor.trim() !== '') {
      code += `\n    .offset(${formatValueForCode(offsetCursor)})`
    }

    switch (queryMethod) {
      case 'first':
        code += `\n    .toLiveQuery(q, { single: true })\n)`
        break
      case 'unique':
        code += `\n    .toLiveQuery(q, { limit: 2 })\n)\n\nif ((result.data?.length ?? 0) > 1) {\n  throw new Error('Expected a unique result, but found multiple rows.')\n}`
        break
      case 'take':
        code += `\n    .toLiveQuery(q, { limit: ${takeCount || '10'} })\n)`
        break
      case 'collect':
      default:
        code += `\n    .toLiveQuery(q)\n)`
        break
    }

    return code
  }, [tableName, selectedIndex, constraints, orderDirection, queryMethod, takeCount, offsetCursor])

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
      offsetCursor,
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
      offsetCursor,
      generatedCode,
      timestamp: Date.now(),
    }
    setHistory((prev) => {
      const updated = [entry, ...prev].slice(0, MAX_HISTORY_ITEMS)
      saveHistory(updated)
      return updated
    })
  }, [collections, selectedIndex, constraints, orderDirection, queryMethod, takeCount, offsetCursor, tableName, generatedCode, onRunQuery])

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
      prev.map((constraint, i) => {
        if (i !== index) {
          return constraint
        }

        const nextConstraint = { ...constraint, ...updates }
        const nextOperatorOptions = getOperatorOptionsForField(nextConstraint.field)

        if (!nextOperatorOptions.some((operator) => operator.value === nextConstraint.operator)) {
          nextConstraint.operator = 'eq'
        }

        return nextConstraint
      }),
    )
  }, [getOperatorOptionsForField])

  const removeConstraint = useCallback((index: number) => {
    setConstraints((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const handleClear = useCallback(() => {
    setSelectedIndex('')
    setConstraints([])
    setOrderDirection('asc')
    setQueryMethod('collect')
    setTakeCount('10')
    setOffsetCursor('')
    onClearQuery?.()
  }, [onClearQuery])

  // Prefill filter from cell action menu
  const handlePrefillFilter = useCallback((field: string, operator: Operator, value: string) => {
    // Find an index that contains this field
    const indexName = Object.entries(tableIndexes).find(
      ([, def]) => def.fields.includes(field)
    )?.[0]

    if (indexName) {
      setSelectedIndex(indexName)
      setConstraints([{ field, operator, value }])
      setFilterOpen(true)
      setActiveTab('filters')
    }
  }, [tableIndexes])

  const restoreFromHistory = useCallback((entry: HistoryEntry) => {
    setSelectedIndex(entry.indexName)
    setConstraints(entry.constraints)
    setOrderDirection(entry.orderDirection)
    setQueryMethod(entry.queryMethod)
    setTakeCount(entry.takeCount)
    setOffsetCursor(entry.offsetCursor ?? '')
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
    count += constraints.filter(isConstraintActive).length
    return count
  }, [selectedIndex, constraints])

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Table Header */}
      <div className="flex items-center justify-between border-b bg-background px-4 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">{tableName}</h1>
          <span className="whitespace-nowrap text-sm text-muted-foreground">
            {displayRows.length} {displayRows.length === 1 ? 'document' : 'documents'}
          </span>
          {isFiltered && queryResult.executionTime !== undefined && (
            <span className="text-xs text-muted-foreground">
              · {queryResult.isLive ? 'live' : `${queryResult.executionTime.toFixed(2)}ms`}
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
          {selectedRowKeys.size > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleDeleteSelectedClick}
              disabled={isDeleting}
              className="border-red-500/40 text-red-600 hover:bg-red-500/10 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18" />
                <path d="M8 6V4h8v2" />
                <path d="M19 6l-1 14H6L5 6" />
                <path d="M10 11v6" />
                <path d="M14 11v6" />
              </svg>
              {isDeleting
                ? 'Deleting...'
                : `Delete ${selectedRowKeys.size === 1 ? '1 document' : `${selectedRowKeys.size} documents`}`}
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
                      setOffsetCursor('')
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
                    {constraints.map((constraint, i) => {
                      const operatorOptions = getOperatorOptionsForField(constraint.field)

                      return (
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
                            <SelectTrigger size="sm" className="h-7 w-32 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {operatorOptions.map((operator) => (
                                <SelectItem key={operator.value} value={operator.value}>
                                  {operator.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {operatorNeedsValue(constraint.operator) ? (
                            <Input
                              value={constraint.value}
                              onChange={(e) => updateConstraint(i, { value: e.target.value })}
                              placeholder="value"
                              className="h-7 flex-1 text-xs"
                            />
                          ) : (
                            <div className="flex h-7 flex-1 items-center rounded-md border border-dashed border-input px-3 text-xs text-muted-foreground">
                              No value needed
                            </div>
                          )}
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
                      )
                    })}
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
                      <>
                        <Input
                          type="number"
                          value={takeCount}
                          onChange={(e) => setTakeCount(e.target.value)}
                          placeholder="Limit"
                          className="h-8 w-20 text-sm"
                          min="1"
                        />
                        <Input
                          value={offsetCursor}
                          onChange={(e) => setOffsetCursor(e.target.value)}
                          placeholder={offsetPlaceholder}
                          className="h-8 min-w-36 flex-1 text-sm"
                        />
                      </>
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
                {/* Checkbox column */}
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
                    <TooltipProvider delayDuration={300}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-help">{columnName}</span>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="font-mono text-xs">
                          {columnInfoMap[columnName]
                            ? getColumnValidator(tableName, columnName, columnInfoMap[columnName], referenceColumns)
                            : 'unknown'}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
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
                const rowId = getRowId(row)
                const rowKey = getSerializedRowId(row)
                const isRowSelected = selectedRowKeys.has(rowKey)

                return (
                  <TableRow
                    key={`${tableName}-${rowKey}`}
                    className={cn(
                      'group',
                      isRowSelected && 'bg-accent',
                    )}
                  >
                    {/* Checkbox cell */}
                    <TableCell className="w-10 px-3">
                      <Checkbox
                        checked={isRowSelected}
                        onCheckedChange={() => toggleRowSelection(rowKey)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Select row ${rowKey}`}
                      />
                    </TableCell>
                    {columnNames.map((columnName) => (
                      <TableCell
                        key={`${tableName}-${rowKey}-${columnName}`}
                        className="font-mono text-xs"
                        style={{
                          width: columnName === columnNames[columnNames.length - 1] ? undefined : (columnWidths[columnName] ?? DEFAULT_COLUMN_WIDTH),
                          minWidth: columnWidths[columnName] ?? DEFAULT_COLUMN_WIDTH,
                          maxWidth: columnName === columnNames[columnNames.length - 1] ? undefined : (columnWidths[columnName] ?? DEFAULT_COLUMN_WIDTH),
                        }}
                      >
                        {editingCell?.rowKey === rowKey &&
                        editingCell.columnName === columnName ? (
                          isMultilineColumn(columnName) ||
                          isStructuredColumnType(columnInfoMap[columnName]?.type ?? '') ? (
                            <Textarea
                              autoFocus
                              value={editingCell.value}
                              onChange={(event) =>
                                setEditingCell({
                                  rowId,
                                  rowKey,
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
                                  rowKey,
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
                        ) : (
                          <div className="group/cell flex items-center justify-between gap-1">
                            <span className={cn(
                              'truncate',
                              readOnlyColumns.has(columnName) && 'text-muted-foreground',
                            )}>
                              {formatCellValue(getRowValue(row, columnName))}
                            </span>
                            <CellActionMenu
                              value={formatCellValue(getRowValue(row, columnName))}
                              columnName={columnName}
                              isReadOnly={readOnlyColumns.has(columnName)}
                              canFilter={allIndexFields.has(columnName)}
                              onEdit={() =>
                                setEditingCell({
                                  rowId,
                                  rowKey,
                                  columnName,
                                  value: formatCellValue(getRowValue(row, columnName)),
                                })
                              }
                              onView={() =>
                                setViewerModal({
                                  columnName,
                                  value: formatCellValue(getRowValue(row, columnName)),
                                })
                              }
                              onFilter={(operator, value) =>
                                handlePrefillFilter(columnName, operator, value)
                              }
                            />
                          </div>
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

      {/* Value Viewer Modal */}
      <ValueViewerModal
        open={viewerModal !== null}
        onClose={() => setViewerModal(null)}
        columnName={viewerModal?.columnName ?? ''}
        value={viewerModal?.value ?? ''}
      />
    </div>
  )
}
