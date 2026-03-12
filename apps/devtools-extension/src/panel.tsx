import { StrictMode, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { SinkExplorer } from '@sink/devtools-ui'
import { RemoteExplorerClient } from './remote-explorer-client'
import './styles.css'

function getTabId(): number {
  const value = new URLSearchParams(window.location.search).get('tabId')
  return value ? Number.parseInt(value, 10) : NaN
}

function isLocalOrigin(origin: string): boolean {
  try {
    const url = new URL(origin)
    return (
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '0.0.0.0' ||
      url.hostname.endsWith('.local')
    )
  } catch {
    return false
  }
}

function toOriginPattern(origin: string): string {
  const url = new URL(origin)
  return `${url.origin}/*`
}

async function getInspectedOrigin(): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.devtools.inspectedWindow.eval('window.location.origin', (result, exception) => {
      if (exception) {
        reject(new Error(exception.value ?? 'Unable to determine inspected origin.'))
        return
      }

      resolve(String(result))
    })
  })
}

async function getAllowedOrigins(): Promise<string[]> {
  const result = await chrome.storage.local.get('allowedOrigins')
  return Array.isArray(result.allowedOrigins) ? result.allowedOrigins : []
}

function PanelApp() {
  const tabId = useMemo(() => getTabId(), [])
  const [originState, setOriginState] = useState<{
    status: 'loading' | 'ready' | 'error'
    origin?: string
    error?: string
  }>({ status: 'loading' })
  const [accessGranted, setAccessGranted] = useState(false)
  const [client, setClient] = useState<RemoteExplorerClient | null>(null)
  const [emptyState, setEmptyState] = useState<{
    title: string
    description: string
  } | null>(null)

  useEffect(() => {
    getInspectedOrigin()
      .then(async (origin) => {
        const allowedOrigins = await getAllowedOrigins()
        const originPattern = toOriginPattern(origin)
        const hasHostAccess = await chrome.permissions.contains({
          origins: [originPattern],
        })

        setOriginState({
          status: 'ready',
          origin,
        })
        setAccessGranted(
          hasHostAccess && (isLocalOrigin(origin) || allowedOrigins.includes(origin)),
        )
      })
      .catch((error: unknown) => {
        setOriginState({
          status: 'error',
          error:
            error instanceof Error ? error.message : 'Unable to inspect current tab.',
        })
      })
  }, [])

  useEffect(() => {
    if (!accessGranted || !Number.isFinite(tabId)) {
      return
    }

    let disposed = false
    let connectedClient: RemoteExplorerClient | null = null

    RemoteExplorerClient.connect(tabId)
      .then(async (nextClient) => {
        if (disposed) {
          nextClient.dispose()
          return
        }

        connectedClient = nextClient
        setClient(nextClient)

        try {
          const databases = await nextClient.listDatabases()
          if (databases.length === 0) {
            setEmptyState({
              title: 'Upgrade and rerun codegen required',
              description:
                'This page is running Sink, but no generated database metadata is registered yet. Upgrade `@sink/lib`, rerun `sink generate`, rebuild the app, and refresh the page.',
            })
            return
          }

          setEmptyState(null)
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Sink runtime not found.'
          setEmptyState({
            title: 'No Sink runtime found',
            description:
              `${message} Open a page that initializes Sink after granting host access, then refresh this panel.`,
          })
        }
      })
      .catch((error: unknown) => {
        setEmptyState({
          title: 'No Sink runtime found',
          description:
            error instanceof Error
              ? error.message
              : 'Unable to initialize the Sink bridge for this tab.',
        })
      })

    return () => {
      disposed = true
      connectedClient?.dispose()
    }
  }, [accessGranted, tabId])

  if (originState.status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        Loading Sink panel...
      </div>
    )
  }

  if (originState.status === 'error' || !originState.origin) {
    return (
      <div className="flex h-screen items-center justify-center px-6 text-center text-sm text-destructive">
        {originState.error}
      </div>
    )
  }

  if (!accessGranted) {
    return (
      <PermissionPrompt
        origin={originState.origin}
        onGrant={async () => {
          const originPattern = toOriginPattern(originState.origin!)
          const granted = await chrome.permissions.request({
            origins: [originPattern],
          })

          if (!granted) {
            return
          }

          if (!isLocalOrigin(originState.origin!)) {
            const allowedOrigins = await getAllowedOrigins()
            const nextOrigins = Array.from(new Set([...allowedOrigins, originState.origin!]))
            await chrome.storage.local.set({ allowedOrigins: nextOrigins })
          }

          setAccessGranted(true)
        }}
      />
    )
  }

  if (emptyState) {
    return (
      <EmptyPanel
        title={emptyState.title}
        description={emptyState.description}
        onRefresh={() => window.location.reload()}
      />
    )
  }

  if (!client) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        Connecting to inspected page...
      </div>
    )
  }

  return <SinkExplorer client={client} title="Sink" />
}

function PermissionPrompt({
  origin,
  onGrant,
}: {
  origin: string
  onGrant: () => Promise<void>
}) {
  return (
    <EmptyPanel
      title="Origin access required"
      description={`Grant this extension access to ${origin} so the panel can inject its content bridge and talk to the inspected Sink runtime.`}
      actionLabel="Grant access"
      onRefresh={onGrant}
    />
  )
}

function EmptyPanel({
  title,
  description,
  actionLabel = 'Refresh',
  onRefresh,
}: {
  title: string
  description: string
  actionLabel?: string
  onRefresh: () => void | Promise<void>
}) {
  return (
    <div className="flex h-screen items-center justify-center px-6">
      <div className="max-w-md space-y-3 text-center">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
        <button
          type="button"
          onClick={() => void onRefresh()}
          className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          {actionLabel}
        </button>
      </div>
    </div>
  )
}

const root = document.getElementById('root')

if (!root) {
  throw new Error('Sink panel root element not found.')
}

createRoot(root).render(
  <StrictMode>
    <PanelApp />
  </StrictMode>,
)
