import { useState, useCallback, useMemo } from 'react'
import type { SqliteTableColumn } from '@sink/lib'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Rows</CardTitle>
          <CardDescription>
            Click a cell to edit it. New rows are inserted through a modal-backed transaction.
          </CardDescription>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            setEditingCell(null)
            onAddRow()
          }}
        >
          Add row
        </Button>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No rows in this table.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {columnNames.map((columnName) => (
                  <TableHead key={columnName}>{columnName}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const rowId = row._id

                return (
                  <TableRow key={`${tableName}-${rowId}`}>
                    {columnNames.map((columnName) => (
                      <TableCell key={`${tableName}-${rowId}-${columnName}`}>
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
                            />
                          )
                        ) : readOnlyColumns.has(columnName) ? (
                          <span className="block w-full text-left text-sm">
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
                            className="w-full text-left text-sm"
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
      </CardContent>
    </Card>
  )
}
