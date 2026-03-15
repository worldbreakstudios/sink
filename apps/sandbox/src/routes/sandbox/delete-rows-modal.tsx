import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface DeleteRowsModalState {
  tableName: string
  count: number
}

export function DeleteRowsModal({
  modal,
  isDeleting,
  onClose,
  onConfirm,
}: {
  modal: DeleteRowsModalState | null
  isDeleting: boolean
  onClose: () => void
  onConfirm: () => Promise<void>
}) {
  if (modal === null) {
    return null
  }

  return (
    <Dialog open={modal !== null} onOpenChange={(open) => !open && !isDeleting && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            Delete {modal.count === 1 ? 'document' : `${modal.count} documents`}?
          </DialogTitle>
          <DialogDescription>
            This will permanently delete{' '}
            <span className="font-medium text-foreground">
              {modal.count === 1 ? '1 row' : `${modal.count} rows`}
            </span>{' '}
            from <span className="font-medium text-foreground">{modal.tableName}</span>.
            This action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isDeleting}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              void onConfirm()
            }}
            disabled={isDeleting}
            className="bg-red-600 text-white hover:bg-red-700"
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
