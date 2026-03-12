import type {
  SinkDevtoolsRowRecord,
  SqliteReferenceColumn,
  SqliteTableColumn,
} from '@sink/lib'
import { formatCellValue, formatReferenceOptionLabel, isMultilineColumn } from '../utils'
import { Button } from './ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Textarea } from './ui/textarea'

export interface InsertModalState {
  tableName: string
  draft: Record<string, string>
  referenceRows: Record<string, SinkDevtoolsRowRecord[]>
}

export function InsertRowModal({
  modal,
  columns,
  referenceColumns,
  onClose,
  onSubmit,
  onDraftChange,
}: {
  modal: InsertModalState | null
  columns: SqliteTableColumn[]
  referenceColumns: Partial<Record<string, SqliteReferenceColumn>>
  onClose: () => void
  onSubmit: () => Promise<void>
  onDraftChange: (columnName: string, value: string) => void
}) {
  if (!modal) {
    return null
  }

  const editableColumns = columns.filter(
    (column) => column.pk === 0 && !column.name.startsWith('_'),
  )

  return (
    <Dialog open={modal !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add row to {modal.tableName}</DialogTitle>
          <DialogDescription>
            This helper queues a single insert into the inspected Sink database.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault()
            await onSubmit()
          }}
        >
          <div className="grid gap-4">
            {editableColumns.map((column) => {
              const referenceColumn = referenceColumns[column.name]
              const referenceRows = referenceColumn
                ? (modal.referenceRows[column.name] ?? [])
                : []

              return (
                <div key={column.name} className="grid gap-2">
                  <Label htmlFor={`insert-${column.name}`}>{column.name}</Label>
                  {referenceColumn ? (
                    <select
                      id={`insert-${column.name}`}
                      value={modal.draft[column.name] ?? ''}
                      onChange={(event) => onDraftChange(column.name, event.target.value)}
                      className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
                    >
                      {referenceRows.length === 0 ? (
                        <option value="">No rows available</option>
                      ) : null}
                      {referenceRows.map((row) => (
                        <option
                          key={formatCellValue(row._id)}
                          value={formatCellValue(row._id)}
                        >
                          {formatReferenceOptionLabel(row)}
                        </option>
                      ))}
                    </select>
                  ) : isMultilineColumn(column.name) ? (
                    <Textarea
                      id={`insert-${column.name}`}
                      value={modal.draft[column.name] ?? ''}
                      onChange={(event) => onDraftChange(column.name, event.target.value)}
                    />
                  ) : (
                    <Input
                      id={`insert-${column.name}`}
                      value={modal.draft[column.name] ?? ''}
                      onChange={(event) => onDraftChange(column.name, event.target.value)}
                    />
                  )}
                  <p className="text-xs text-muted-foreground">
                    {referenceColumn ? 'ID' : column.type || 'TEXT'}
                    {referenceColumn
                      ? ` • references ${referenceColumn.referencedTable}`
                      : ''}
                    {column.pk ? ' • primary key' : ''}
                    {column.notnull ? ' • required' : ''}
                  </p>
                </div>
              )
            })}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Submit row</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
