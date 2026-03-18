import type {
  CoordinatorClientMessage,
  CoordinatorServerMessage,
} from '../lib/shared-opfs-protocol.ts'
import { serializeWorkerError } from '../lib/shared-opfs-protocol.ts'

const sharedScope = globalThis as unknown as {
  addEventListener(
    type: 'connect',
    listener: (event: MessageEvent) => void,
  ): void
  setInterval(handler: () => void, timeout: number): number
}
const HEARTBEAT_INTERVAL_MS = 5_000
const HEARTBEAT_TIMEOUT_MS = 15_000
const SHARED_OPFS_DEBUG = import.meta.env.DEV

interface ConnectedTab {
  tabId: string
  port: MessagePort
  connectedAt: number
  lastSeenAt: number
  ready: boolean
}

interface PendingDbRequest {
  requesterTabId: string
  requestId: string
  method: CoordinatorClientMessage extends infer T
    ? T extends { type: 'db-request'; method: infer TMethod }
      ? TMethod
      : never
    : never
  args: CoordinatorClientMessage extends infer T
    ? T extends { type: 'db-request'; args: infer TArgs }
      ? TArgs
      : never
    : never
}

const tabs = new Map<string, ConnectedTab>()
const pendingRequests: PendingDbRequest[] = []
let activeTabId: string | null = null

sharedScope.addEventListener('connect', (event: MessageEvent) => {
  const port = event.ports[0]

  if (!port) {
    return
  }

  debugCoordinator('port:connect')
  port.start()
  port.addEventListener('message', (messageEvent: MessageEvent<CoordinatorClientMessage>) => {
    handlePortMessage(port, messageEvent.data)
  })
})

sharedScope.setInterval(() => {
  cleanupStaleTabs(Date.now())
}, HEARTBEAT_INTERVAL_MS)

function handlePortMessage(port: MessagePort, message: CoordinatorClientMessage): void {
  switch (message.type) {
    case 'register': {
      debugCoordinator('tab:register', {
        tabId: shortId(message.tabId),
      })
      tabs.set(message.tabId, {
        tabId: message.tabId,
        port,
        connectedAt: Date.now(),
        lastSeenAt: Date.now(),
        ready: false,
      })
      electActiveTab()
      notifyRoles()
      return
    }
    case 'heartbeat': {
      const tab = tabs.get(message.tabId)

      if (tab) {
        tab.lastSeenAt = message.sentAt
      }
      return
    }
    case 'unregister': {
      debugCoordinator('tab:unregister', {
        tabId: shortId(message.tabId),
      })
      removeTab(message.tabId)
      return
    }
    case 'active-ready': {
      const tab = tabs.get(message.tabId)

      if (!tab || message.tabId !== activeTabId) {
        return
      }

      tab.ready = true
      debugCoordinator('tab:active-ready', {
        tabId: shortId(message.tabId),
        pendingRequests: pendingRequests.length,
      })
      flushPendingRequests()
      return
    }
    case 'active-failed': {
      const tab = tabs.get(message.tabId)

      if (!tab) {
        return
      }

      tab.ready = false
      debugCoordinator('tab:active-failed', {
        tabId: shortId(message.tabId),
        error: message.error.message,
      })
      if (activeTabId === message.tabId) {
        activeTabId = null
        electActiveTab(message.tabId)
        notifyRoles()
        if (!activeTabId) {
          failPendingRequests(message.error.message)
        }
      }
      return
    }
    case 'db-request': {
      const tab = tabs.get(message.tabId)

      if (tab) {
        tab.lastSeenAt = Date.now()
      }

      debugCoordinator('request:queued', {
        tabId: shortId(message.tabId),
        requestId: message.requestId,
        method: message.method,
        pendingRequests: pendingRequests.length + 1,
        activeTabId: activeTabId ? shortId(activeTabId) : null,
      })
      pendingRequests.push({
        requesterTabId: message.tabId,
        requestId: message.requestId,
        method: message.method,
        args: message.args,
      })

      electActiveTab()
      flushPendingRequests()
      return
    }
    case 'db-response': {
      const requester = tabs.get(message.requesterTabId)

      if (!requester) {
        debugCoordinator('response:dropped-requester-missing', {
          requesterTabId: shortId(message.requesterTabId),
          requestId: message.requestId,
        })
        return
      }

      debugCoordinator('response:forwarded', {
        requestId: message.requestId,
        requesterTabId: shortId(message.requesterTabId),
        executorTabId: shortId(message.executorTabId),
        ok: message.ok,
      })

      const response: CoordinatorServerMessage = message.ok
        ? {
          type: 'db-result',
          requestId: message.requestId,
          ok: true,
          result: message.result,
        }
        : {
          type: 'db-result',
          requestId: message.requestId,
          ok: false,
          error: message.error,
        }

      requester.port.postMessage(response)
      return
    }
  }
}

function cleanupStaleTabs(now: number): void {
  const staleTabIds = [...tabs.values()]
    .filter((tab) => now - tab.lastSeenAt > HEARTBEAT_TIMEOUT_MS)
    .map((tab) => tab.tabId)

  if (staleTabIds.length === 0) {
    return
  }

  for (const staleTabId of staleTabIds) {
    debugCoordinator('tab:stale-removed', {
      tabId: shortId(staleTabId),
    })
    tabs.delete(staleTabId)
  }

  if (activeTabId && !tabs.has(activeTabId)) {
    activeTabId = null
  }

  electActiveTab()
  notifyRoles()
}

function removeTab(tabId: string): void {
  tabs.delete(tabId)
  debugCoordinator('tab:removed', {
    tabId: shortId(tabId),
  })

  if (activeTabId === tabId) {
    activeTabId = null
    electActiveTab(tabId)
  }

  notifyRoles()
}

function electActiveTab(excludedTabId?: string): void {
  if (activeTabId && tabs.has(activeTabId)) {
    return
  }

  const nextActiveTab = [...tabs.values()]
    .sort((left, right) => left.connectedAt - right.connectedAt)
    .find((tab) => tab.tabId !== excludedTabId)

  activeTabId = nextActiveTab?.tabId ?? null
  debugCoordinator('tab:elected-active', {
    activeTabId: activeTabId ? shortId(activeTabId) : null,
    excludedTabId: excludedTabId ? shortId(excludedTabId) : null,
    totalTabs: tabs.size,
  })

  if (nextActiveTab) {
    nextActiveTab.ready = false
  }
}

function notifyRoles(): void {
  debugCoordinator('roles:notify', {
    activeTabId: activeTabId ? shortId(activeTabId) : null,
    tabs: [...tabs.keys()].map((tabId) => shortId(tabId)),
  })
  for (const tab of tabs.values()) {
    const message: CoordinatorServerMessage = {
      type: 'role',
      tabId: tab.tabId,
      isActive: tab.tabId === activeTabId,
    }
    tab.port.postMessage(message)
  }
}

function flushPendingRequests(): void {
  if (!activeTabId) {
    if (pendingRequests.length > 0) {
      debugCoordinator('flush:blocked-no-active-tab', {
        pendingRequests: pendingRequests.length,
      })
    }
    return
  }

  const activeTab = tabs.get(activeTabId)

  if (!activeTab || !activeTab.ready) {
    if (pendingRequests.length > 0) {
      debugCoordinator('flush:blocked-active-not-ready', {
        activeTabId: shortId(activeTabId),
        pendingRequests: pendingRequests.length,
      })
    }
    return
  }

  while (pendingRequests.length > 0) {
    const nextRequest = pendingRequests.shift()

    if (!nextRequest) {
      break
    }

    const requester = tabs.get(nextRequest.requesterTabId)

    if (!requester) {
      continue
    }

    debugCoordinator('flush:dispatch', {
      requestId: nextRequest.requestId,
      method: nextRequest.method,
      requesterTabId: shortId(nextRequest.requesterTabId),
      activeTabId: shortId(activeTabId),
      remaining: pendingRequests.length,
    })
    const message: CoordinatorServerMessage = {
      type: 'execute-request',
      requesterTabId: nextRequest.requesterTabId,
      requestId: nextRequest.requestId,
      method: nextRequest.method,
      args: nextRequest.args,
    }
    activeTab.port.postMessage(message)
  }
}

function failPendingRequests(message: string): void {
  debugCoordinator('flush:fail-pending', {
    pendingRequests: pendingRequests.length,
    message,
  })
  while (pendingRequests.length > 0) {
    const request = pendingRequests.shift()

    if (!request) {
      continue
    }

    const requester = tabs.get(request.requesterTabId)

    if (!requester) {
      continue
    }

    const response: CoordinatorServerMessage = {
      type: 'db-result',
      requestId: request.requestId,
      ok: false,
      error: serializeWorkerError(new Error(message)),
    }
    requester.port.postMessage(response)
  }
}

function debugCoordinator(event: string, details?: Record<string, unknown>): void {
  if (!SHARED_OPFS_DEBUG) {
    return
  }

  if (details) {
    console.debug('[shared-opfs:coordinator]', event, details)
    return
  }

  console.debug('[shared-opfs:coordinator]', event)
}

function shortId(value: string): string {
  return value.slice(0, 8)
}
