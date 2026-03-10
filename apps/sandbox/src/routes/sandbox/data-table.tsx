import { useState, useCallback, useMemo, useEffect } from 'react'
import type { SqliteTableColumn } from '@sink/lib'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import type { SqliteDemoId, SqliteDemoRow } from '@/lib/sqlite-demo-collections'
import { cn } from '@/lib/utils'
import { formatCellValue, getRowValue, isMultilineColumn } from './utils'

const DEFAULT_COLUMN_WIDTH = 150
const MIN_COLUMN_WIDTH = 50
const STORAGE_KEY_PREFIX = 'sandbox-table-layout:'

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

export function DataTable({
  tableName,
  columns,
  rows,
  onCellEdit,
  onAddRow,
}: {
  tableName: string
  columns: SqliteTableColumn[]
  rows: SqliteDemoRow[]
  onCellEdit: (rowId: SqliteDemoId, columnName: string, value: string) => Promise<void>
  onAddRow: () => void
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

  const defaultColumnNames = useMemo(() => columns.map((column) => column.name), [columns])

  // Use custom order if set, otherwise use default
  const columnNames = useMemo(() => {
    if (columnOrder.length === 0) return defaultColumnNames
    // Filter to only include columns that still exist
    const validOrder = columnOrder.filter((name) => defaultColumnNames.includes(name))
    // Add any new columns that aren't in the order
    const newColumns = defaultColumnNames.filter((name) => !validOrder.includes(name))
    return [...validOrder, ...newColumns]
  }, [columnOrder, defaultColumnNames])

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

  // Save layout when widths or order change
  useEffect(() => {
    // Only save if there's something to save
    if (Object.keys(columnWidths).length > 0 || columnOrder.length > 0) {
      saveTableLayout(tableName, { columnWidths, columnOrder })
    }
  }, [tableName, columnWidths, columnOrder])

  // Handle column resize
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

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Table Header */}
      <div className="flex items-center justify-between border-b bg-background px-4 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">{tableName}</h1>
          <span className="text-sm text-muted-foreground">
            {rows.length} {rows.length === 1 ? 'document' : 'documents'}
          </span>
        </div>
        <Button size="sm" onClick={() => { setEditingCell(null); onAddRow() }}>
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

      {/* Table Content */}
      <div className="flex-1 overflow-auto">
        {rows.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            No rows in this table.
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
                    {/* Resize handle */}
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
              {rows.map((row) => {
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
                          <span className="block truncate text-muted-foreground">
                            {formatCellValue(getRowValue(row, columnName))}
                          </span>
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
