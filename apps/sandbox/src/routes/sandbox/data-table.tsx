import { useState, useCallback, useMemo } from 'react'
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
import { formatCellValue, getRowValue, isMultilineColumn } from './utils'

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

  const columnNames = columns.map((column) => column.name)

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
          <Table>
            <TableHeader className="sticky top-0 bg-muted/50 backdrop-blur-sm">
              <TableRow>
                {columnNames.map((columnName) => (
                  <TableHead key={columnName} className="whitespace-nowrap">
                    {columnName}
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
                        className="max-w-xs truncate font-mono text-xs"
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
                          <span className="text-muted-foreground">
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
                            className="w-full text-left hover:text-primary"
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
