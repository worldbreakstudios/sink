import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import type { SqliteTableColumn } from '@sink/lib'
import type {
  GenericRow,
  IndexDefinition,
  ReferenceColumn,
  Operator,
  QueryState,
  QueryResult,
} from '../../types'
import { cn } from '../../utils/cn'
import { formatCellValue, getRowValue } from '../../utils/format'
import { CellActionMenu } from '../CellActionMenu'
import { ValueViewerModal } from '../ValueViewerModal'
import { Button } from '../ui/button'
import { Checkbox } from '../ui/checkbox'
import { Input } from '../ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table'
import { QueryBuilder, type PrefillFilter } from './QueryBuilder'

const DEFAULT_COLUMN_WIDTH = 150
const MIN_COLUMN_WIDTH = 50
const STORAGE_KEY_PREFIX = 'devtools-ui-table-layout:'

interface TableLayout {
  columnWidths: Record<string, number>
  columnOrder: string[]
}

function loadTableLayout(tableName: string): TableLayout | null {
  try {
    const stored = localStorage.getItem(`${STORAGE_KEY_PREFIX}${tableName}`)
    if (stored) return JSON.parse(stored) as TableLayout
  } catch {}
  return null
}

function saveTableLayout(tableName: string, layout: TableLayout): void {
  try {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${tableName}`, JSON.stringify(layout))
  } catch {}
}

export interface DataTableProps<TRow extends GenericRow> {
  tableName: string
  columns: SqliteTableColumn[]
  rows: TRow[]
  indexes: Record<string, IndexDefinition>
  referenceColumns: Record<string, ReferenceColumn>
  queryResult?: QueryResult<TRow> | null
  onCellEdit?: (rowId: string, columnName: string, value: string) => Promise<void>
  onAddRow?: () => Promise<void>
  onDeleteRows?: (rowIds: string[]) => Promise<void>
  onRunQuery?: (query: QueryState) => Promise<void>
  onSelectionChange?: (selectedIds: Set<string>) => void
  readOnly?: boolean
  enableQueryBuilder?: boolean
  className?: string
}

export function DataTable<TRow extends GenericRow>({
  tableName,
  columns,
  rows,
  indexes,
  queryResult,
  onCellEdit,
  onAddRow,
  onDeleteRows,
  onRunQuery,
  onSelectionChange,
  readOnly = false,
  enableQueryBuilder = true,
  className,
}: DataTableProps<TRow>) {
  const [editingCell, setEditingCell] = useState<{ rowId: string; columnName: string; value: string } | null>(null)
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({})
  const [resizing, setResizing] = useState<{ columnName: string; startX: number; startWidth: number } | null>(null)
  const [columnOrder, setColumnOrder] = useState<string[]>([])
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null)
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set())
  const [viewerModal, setViewerModal] = useState<{ columnName: string; value: string } | null>(null)
  const [prefillFilter, setPrefillFilter] = useState<PrefillFilter | null>(null)
  const editInputRef = useRef<HTMLInputElement>(null)

  // Display either query results or default rows
  const displayRows = queryResult?.rows ?? rows
  const isFiltered = queryResult !== null

  // Clear selection when table changes
  useEffect(() => {
    setSelectedRowIds(new Set())
  }, [tableName])

  // Notify parent of selection changes
  useEffect(() => {
    onSelectionChange?.(selectedRowIds)
  }, [selectedRowIds, onSelectionChange])

  // Focus edit input when editing
  useEffect(() => {
    if (editingCell && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [editingCell])

  const defaultColumnNames = useMemo(() => columns.map((col) => col.name), [columns])

  const columnNames = useMemo(() => {
    if (columnOrder.length === 0) return defaultColumnNames
    const validOrder = columnOrder.filter((name) => defaultColumnNames.includes(name))
    const newColumns = defaultColumnNames.filter((name) => !validOrder.includes(name))
    return [...validOrder, ...newColumns]
  }, [columnOrder, defaultColumnNames])

  const readOnlyColumns = useMemo(
    () => new Set(columns.filter((col) => col.pk || col.name.startsWith('_')).map((col) => col.name)),
    [columns]
  )

  // Get all fields that are part of any index (for filter menu)
  const allIndexFields = useMemo(() => {
    const fields = new Set<string>()
    for (const index of Object.values(indexes)) {
      for (const field of index.fields) {
        fields.add(field)
      }
    }
    return fields
  }, [indexes])

  // Handle prefill filter from cell action menu
  const handlePrefillFilter = useCallback((field: string, operator: Operator, value: string) => {
    setPrefillFilter({ field, operator, value })
    setFilterOpen(true)
  }, [])

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

  // Save layout changes
  useEffect(() => {
    if (Object.keys(columnWidths).length > 0 || columnOrder.length > 0) {
      saveTableLayout(tableName, { columnWidths, columnOrder })
    }
  }, [tableName, columnWidths, columnOrder])

  // Column resize handling
  useEffect(() => {
    if (!resizing) return

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - resizing.startX
      const newWidth = Math.max(MIN_COLUMN_WIDTH, resizing.startWidth + delta)
      setColumnWidths((prev) => ({ ...prev, [resizing.columnName]: newWidth }))
    }

    const handleMouseUp = () => setResizing(null)

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

  // Column drag and drop
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

  const handleDragLeave = useCallback(() => setDragOverColumn(null), [])

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

  // Row selection
  const toggleRowSelection = useCallback((rowId: string) => {
    setSelectedRowIds((prev) => {
      const next = new Set(prev)
      if (next.has(rowId)) {
        next.delete(rowId)
      } else {
        next.add(rowId)
      }
      return next
    })
  }, [])

  const toggleAllSelection = useCallback(() => {
    setSelectedRowIds((prev) => {
      if (prev.size === displayRows.length) {
        return new Set()
      }
      return new Set(displayRows.map((r) => r._id))
    })
  }, [displayRows])

  const isAllSelected = displayRows.length > 0 && selectedRowIds.size === displayRows.length
  const isSomeSelected = selectedRowIds.size > 0 && selectedRowIds.size < displayRows.length

  // Cell editing
  const handleCellDoubleClick = useCallback(
    (row: TRow, columnName: string) => {
      if (readOnly || readOnlyColumns.has(columnName)) return
      const value = getRowValue(row, columnName)
      setEditingCell({ rowId: row._id, columnName, value: formatCellValue(value) })
    },
    [readOnly, readOnlyColumns]
  )

  const commitCellEdit = useCallback(async () => {
    if (!editingCell || !onCellEdit) return
    await onCellEdit(editingCell.rowId, editingCell.columnName, editingCell.value)
    setEditingCell(null)
  }, [editingCell, onCellEdit])

  const cancelCellEdit = useCallback(() => setEditingCell(null), [])

  const handleEditKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        commitCellEdit()
      } else if (e.key === 'Escape') {
        cancelCellEdit()
      }
    },
    [commitCellEdit, cancelCellEdit]
  )

  const handleDeleteSelected = useCallback(async () => {
    if (onDeleteRows && selectedRowIds.size > 0) {
      await onDeleteRows(Array.from(selectedRowIds))
      setSelectedRowIds(new Set())
    }
  }, [onDeleteRows, selectedRowIds])

  return (
    <div className={cn('flex flex-1 flex-col min-w-0', className)}>
      {/* Query Builder */}
      {enableQueryBuilder && onRunQuery && (
        <QueryBuilder
          tableName={tableName}
          indexes={indexes}
          isOpen={filterOpen}
          onClose={() => setFilterOpen(false)}
          onRunQuery={onRunQuery}
          prefillFilter={prefillFilter}
          onPrefillConsumed={() => setPrefillFilter(null)}
        />
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between border-b bg-background px-4 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">{tableName}</h1>
          <span className="whitespace-nowrap text-sm text-muted-foreground">
            {displayRows.length} {displayRows.length === 1 ? 'document' : 'documents'}
          </span>
          {isFiltered && queryResult && queryResult.executionTime !== undefined && (
            <span className="text-xs text-muted-foreground">
              · {queryResult.executionTime.toFixed(2)}ms
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {selectedRowIds.size > 0 && onDeleteRows && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleDeleteSelected}
              className="border-destructive/50 text-destructive hover:bg-destructive/10"
            >
              Delete ({selectedRowIds.size})
            </Button>
          )}
          {enableQueryBuilder && onRunQuery && (
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
          )}
          {onAddRow && (
            <Button size="sm" onClick={onAddRow}>
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1">
                <path d="M5 12h14" />
                <path d="M12 5v14" />
              </svg>
              Add
            </Button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {displayRows.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {isFiltered ? 'No rows match the query' : 'No rows in this table'}
          </div>
        ) : (
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                {/* Checkbox column */}
                <TableHead className="w-10 border-r px-3">
                  <Checkbox
                    checked={isAllSelected ? true : isSomeSelected ? 'indeterminate' : false}
                    onCheckedChange={toggleAllSelection}
                  />
                </TableHead>
                {columnNames.map((columnName) => {
                  const width = columnWidths[columnName] ?? DEFAULT_COLUMN_WIDTH
                  const column = columns.find((c) => c.name === columnName)

                  return (
                    <TableHead
                      key={columnName}
                      style={{ width, minWidth: MIN_COLUMN_WIDTH }}
                      draggable
                      onDragStart={(e) => handleDragStart(e, columnName)}
                      onDragOver={(e) => handleDragOver(e, columnName)}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => handleDrop(e, columnName)}
                      onDragEnd={handleDragEnd}
                      className={cn(
                        'relative select-none border-r',
                        draggedColumn === columnName && 'opacity-50',
                        dragOverColumn === columnName && 'bg-primary/10'
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate">{columnName}</span>
                        {column && (
                          <span className="shrink-0 text-[10px] font-normal text-muted-foreground">
                            {column.type}
                          </span>
                        )}
                      </div>
                      {/* Resize handle */}
                      <div
                        onMouseDown={(e) => handleResizeStart(e, columnName)}
                        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/30"
                      />
                    </TableHead>
                  )
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayRows.map((row) => {
                const isSelected = selectedRowIds.has(row._id)

                return (
                  <TableRow
                    key={row._id}
                    className={cn(
                      isSelected && 'bg-primary/5'
                    )}
                  >
                    {/* Checkbox */}
                    <TableCell className="border-r px-3">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleRowSelection(row._id)}
                      />
                    </TableCell>
                    {columnNames.map((columnName) => {
                      const width = columnWidths[columnName] ?? DEFAULT_COLUMN_WIDTH
                      const rawValue = getRowValue(row, columnName)
                      const displayValue = formatCellValue(rawValue)
                      const isEditing =
                        editingCell?.rowId === row._id && editingCell?.columnName === columnName
                      const isReadOnly = readOnly || readOnlyColumns.has(columnName)

                      return (
                        <TableCell
                          key={columnName}
                          style={{ width, minWidth: MIN_COLUMN_WIDTH, maxWidth: width }}
                          className="group relative border-r"
                          onDoubleClick={() => handleCellDoubleClick(row, columnName)}
                        >
                          {isEditing ? (
                            <Input
                              ref={editInputRef}
                              type="text"
                              value={editingCell.value}
                              onChange={(e) =>
                                setEditingCell({ ...editingCell, value: e.target.value })
                              }
                              onKeyDown={handleEditKeyDown}
                              onBlur={commitCellEdit}
                              className="h-6 px-1 py-0.5 text-xs font-mono"
                            />
                          ) : (
                            <div className="group/cell flex min-w-0 items-center justify-between gap-1">
                              <span
                                className={cn(
                                  'min-w-0 truncate font-mono text-xs',
                                  rawValue === null && 'italic text-muted-foreground',
                                  isReadOnly && 'text-muted-foreground'
                                )}
                              >
                                {displayValue}
                              </span>
                              <CellActionMenu
                                value={displayValue}
                                columnName={columnName}
                                isReadOnly={isReadOnly}
                                canFilter={allIndexFields.has(columnName)}
                                onEdit={() =>
                                  setEditingCell({
                                    rowId: row._id,
                                    columnName,
                                    value: displayValue,
                                  })
                                }
                                onView={() =>
                                  setViewerModal({
                                    columnName,
                                    value: displayValue,
                                  })
                                }
                                onFilter={(operator, value) =>
                                  handlePrefillFilter(columnName, operator, value)
                                }
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

export { QueryBuilder } from './QueryBuilder'
