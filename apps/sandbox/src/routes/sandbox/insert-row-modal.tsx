import type { SqliteTableColumn } from '@sink/lib'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type {
  SqliteDemoCollectionsWorkspace,
  SqliteDemoRow,
  SqliteDemoTableName,
  SqliteInsertDraft,
} from '@/lib/sqlite-demo-collections'
import { formatReferenceOptionLabel, isMultilineColumn } from './utils'

type PendingInsertTransaction = ReturnType<
  SqliteDemoCollectionsWorkspace['createBatchTransaction']
>

export interface InsertModalState {
  tableName: SqliteDemoTableName
  draft: SqliteInsertDraft
  transaction: PendingInsertTransaction
  referenceRows: Record<string, SqliteDemoRow[]>
}

export function InsertRowModal({
  modal,
  columns,
  workspace,
  onClose,
  onSubmit,
  onDraftChange,
}: {
  modal: InsertModalState | null
  columns: SqliteTableColumn[]
  workspace: SqliteDemoCollectionsWorkspace | null
  onClose: () => void
  onSubmit: () => Promise<void>
  onDraftChange: (columnName: string, value: string) => void
}) {
  if (!modal || !workspace) {
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
            A TanStack DB transaction is already open. Your insert will be queued and
            committed when you submit this form.
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
              const referenceColumn = workspace.getReferenceColumn(
                modal.tableName,
                column.name,
              )
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
                        <option key={row._id} value={row._id}>
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
