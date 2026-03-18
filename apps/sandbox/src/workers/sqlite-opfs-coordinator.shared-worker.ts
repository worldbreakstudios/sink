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
      removeTab(message.tabId)
      return
    }
    case 'active-ready': {
      const tab = tabs.get(message.tabId)

      if (!tab || message.tabId !== activeTabId) {
        return
      }

      tab.ready = true
      flushPendingRequests()
      return
    }
    case 'active-failed': {
      const tab = tabs.get(message.tabId)

      if (!tab) {
        return
      }

      tab.ready = false
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
        return
      }

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

  if (nextActiveTab) {
    nextActiveTab.ready = false
  }
}

function notifyRoles(): void {
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
    return
  }

  const activeTab = tabs.get(activeTabId)

  if (!activeTab || !activeTab.ready) {
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
