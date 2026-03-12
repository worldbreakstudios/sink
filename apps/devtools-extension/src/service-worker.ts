interface PanelInitMessage {
  type: 'panel-init'
  tabId: number
}

interface PanelRpcMessage {
  type: 'panel-rpc'
  tabId: number
  request: unknown
}

interface PanelEnableMessage {
  type: 'panel-enable'
  tabId: number
}

type PanelMessage = PanelInitMessage | PanelRpcMessage | PanelEnableMessage

const panelPorts = new Map<number, chrome.runtime.Port>()
const contentPorts = new Map<number, chrome.runtime.Port>()
const contentWaiters = new Map<number, Array<(port: chrome.runtime.Port | null) => void>>()

async function ensureContentScript(tabId: number): Promise<chrome.runtime.Port | null> {
  const existingPort = contentPorts.get(tabId)

  if (existingPort) {
    return existingPort
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content-script.js'],
    })
  } catch (error) {
    console.warn('Failed to inject Sink content script:', error)
    return null
  }

  return new Promise((resolve) => {
    const waiters = contentWaiters.get(tabId) ?? []
    waiters.push(resolve)
    contentWaiters.set(tabId, waiters)

    setTimeout(() => {
      const remainingWaiters = contentWaiters.get(tabId)
      if (!remainingWaiters?.includes(resolve)) {
        return
      }

      contentWaiters.set(
        tabId,
        remainingWaiters.filter((waiter) => waiter !== resolve),
      )
      resolve(contentPorts.get(tabId) ?? null)
    }, 1500)
  })
}

function flushContentWaiters(tabId: number, port: chrome.runtime.Port | null): void {
  const waiters = contentWaiters.get(tabId)

  if (!waiters) {
    return
  }

  contentWaiters.delete(tabId)
  for (const waiter of waiters) {
    waiter(port)
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'sink-devtools-panel') {
    let activeTabId: number | null = null

    port.onMessage.addListener((message: PanelMessage) => {
      if (message.type === 'panel-init') {
        activeTabId = message.tabId
        panelPorts.set(message.tabId, port)
        void ensureContentScript(message.tabId).then((contentPort) => {
          port.postMessage({
            type: 'panel-ready',
            tabId: message.tabId,
            ready: Boolean(contentPort),
          })
        })
        return
      }

      if (message.type === 'panel-enable') {
        const contentPort = contentPorts.get(message.tabId)
        contentPort?.postMessage({ type: 'enable-page-bridge' })
        return
      }

      const contentPort = contentPorts.get(message.tabId)
      contentPort?.postMessage({
        type: 'panel-rpc',
        request: message.request,
      })
    })

    port.onDisconnect.addListener(() => {
      if (activeTabId !== null) {
        panelPorts.delete(activeTabId)
      }
    })

    return
  }

  if (port.name !== 'sink-devtools-content') {
    return
  }

  const tabId = port.sender?.tab?.id

  if (tabId === undefined) {
    return
  }

  contentPorts.set(tabId, port)
  flushContentWaiters(tabId, port)

  port.onMessage.addListener((message: unknown) => {
    panelPorts.get(tabId)?.postMessage(message)
  })

  port.onDisconnect.addListener(() => {
    contentPorts.delete(tabId)
    flushContentWaiters(tabId, null)
  })
})
