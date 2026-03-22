import type { SqliteReferenceColumn } from '@sink/lib'
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
import {
  isMultilineColumn,
  isStructuredColumnType,
} from './utils'

export interface EditCellModalState {
  tableName: string
  rowKey: string
  columnName: string
  columnType: string
  value: string
}

export function EditCellModal({
  modal,
  referenceColumn,
  onClose,
  onSubmit,
  onValueChange,
}: {
  modal: EditCellModalState | null
  referenceColumn: SqliteReferenceColumn | null
  onClose: () => Promise<void> | void
  onSubmit: () => Promise<void>
  onValueChange: (value: string) => void
}) {
  if (!modal) {
    return null
  }

  const isExpandedEditor =
    isMultilineColumn(modal.columnName) ||
    isStructuredColumnType(modal.columnType)

  return (
    <Dialog open={modal !== null} onOpenChange={(open) => !open && void onClose()}>
      <DialogContent className="max-h-[calc(100vh-2rem)] max-w-[min(42rem,calc(100vw-2rem))] overflow-y-auto">
        <DialogHeader className="min-w-0 pr-8">
          <DialogTitle>
            Edit {modal.tableName}.{modal.columnName}
          </DialogTitle>
          <DialogDescription className="space-y-1">
            <span className="block">
              This edit is holding a sync transaction for row <code>{modal.rowKey}</code>.
            </span>
            <span className="block">
              Submit will commit the transaction. Cancel will abort it.
            </span>
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault()
            await onSubmit()
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="edit-cell-value">{modal.columnName}</Label>
            {isExpandedEditor ? (
              <Textarea
                id="edit-cell-value"
                autoFocus
                value={modal.value}
                onChange={(event) => onValueChange(event.target.value)}
                className="min-h-32"
              />
            ) : (
              <Input
                id="edit-cell-value"
                autoFocus
                value={modal.value}
                onChange={(event) => onValueChange(event.target.value)}
              />
            )}
            <p className="text-xs text-muted-foreground">
              {referenceColumn ? 'ID' : modal.columnType || 'TEXT'}
              {referenceColumn
                ? ` • references ${referenceColumn.referencedTable}`
                : ''}
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => void onClose()}>
              Cancel
            </Button>
            <Button type="submit">Save change</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
