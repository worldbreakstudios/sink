import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ThemeToggle } from './theme-toggle'

interface SettingsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  isClearingLocal: boolean
  isResettingServer: boolean
  onHardClearLocal: () => void
  onHardResetServer: () => void
  debug: {
    persistenceType: string | null
    connection: string
    tabId: string | null
    activeTransactions: number
    offlineQueue: number
    locks: number
    conflicts: number
    sqliteVersion: string | null
    serverUrl: string
    lastError: string | null
  }
}

function DebugRow({
  label,
  value,
}: {
  label: string
  value: string | number
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-border/70 bg-background/60 px-3 py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <code className="rounded-md bg-muted px-2 py-1 text-xs">{String(value)}</code>
    </div>
  )
}

export function SettingsModal({
  open,
  onOpenChange,
  isClearingLocal,
  isResettingServer,
  onHardClearLocal,
  onHardResetServer,
  debug,
}: SettingsModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] max-w-3xl overflow-y-auto">
        <DialogHeader className="pr-8">
          <DialogTitle className="font-heading text-xl">Sandbox settings</DialogTitle>
          <DialogDescription>
            Maintenance controls, appearance settings, and sync debug information
            for this sandbox session.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle className="font-heading text-base">Appearance</CardTitle>
              <CardDescription>
                Theme controls for the sandbox workspace.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between gap-4 rounded-xl border border-border/70 bg-background/60 px-4 py-3">
                <div className="space-y-1">
                  <div className="text-sm font-medium">Theme</div>
                  <p className="text-sm text-muted-foreground">
                    Toggle between light and dark mode.
                  </p>
                </div>
                <ThemeToggle />
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle className="font-heading text-base">Maintenance</CardTitle>
              <CardDescription>
                Reset local or demo-server state for testing.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-xl border border-border/70 bg-background/60 p-4">
                <div className="mb-3 space-y-1">
                  <div className="text-sm font-medium">Hard clear local DB</div>
                  <p className="text-sm text-muted-foreground">
                    Removes the browser-local sandbox database and reloads the page.
                  </p>
                </div>
                <Button
                  variant="outline"
                  className="w-full justify-center border-red-300 text-red-700 hover:bg-red-50 hover:text-red-800 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/60"
                  disabled={isClearingLocal || isResettingServer}
                  onClick={onHardClearLocal}
                >
                  {isClearingLocal ? 'Clearing Local DB…' : 'Hard Clear Local DB'}
                </Button>
              </div>

              <div className="rounded-xl border border-border/70 bg-background/60 p-4">
                <div className="mb-3 space-y-1">
                  <div className="text-sm font-medium">Hard reset demo server</div>
                  <p className="text-sm text-muted-foreground">
                    Resets the shared demo server database back to seeded data.
                  </p>
                </div>
                <Button
                  variant="outline"
                  className="w-full justify-center border-orange-300 text-orange-700 hover:bg-orange-50 hover:text-orange-800 dark:border-orange-900 dark:text-orange-300 dark:hover:bg-orange-950/60"
                  disabled={isClearingLocal || isResettingServer}
                  onClick={onHardResetServer}
                >
                  {isResettingServer
                    ? 'Resetting Demo Server…'
                    : 'Hard Reset Demo Server'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="rounded-2xl">
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="font-heading text-base">Debug panel</CardTitle>
              <Badge variant="outline">On demand</Badge>
            </div>
            <CardDescription>
              Current sync, persistence, and workspace state for this tab.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <DebugRow
              label="Persistence"
              value={debug.persistenceType ?? 'unavailable'}
            />
            <DebugRow label="Connection" value={debug.connection} />
            <DebugRow label="Tab ID" value={debug.tabId ?? 'unavailable'} />
            <DebugRow
              label="Active transactions"
              value={debug.activeTransactions}
            />
            <DebugRow label="Offline queue" value={debug.offlineQueue} />
            <DebugRow label="Locked rows" value={debug.locks} />
            <DebugRow label="Conflicts" value={debug.conflicts} />
            <DebugRow
              label="SQLite version"
              value={debug.sqliteVersion ?? 'unknown'}
            />
            <DebugRow label="Server URL" value={debug.serverUrl} />
            <DebugRow label="Last sync error" value={debug.lastError ?? 'none'} />
          </CardContent>
        </Card>
      </DialogContent>
    </Dialog>
  )
}
