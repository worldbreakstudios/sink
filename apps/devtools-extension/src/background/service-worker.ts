// Background service worker to relay messages between DevTools panel and content scripts

import type { ContentScriptMessage } from '@/shared/types'

// Store connections from DevTools panels, keyed by tab ID
const panelConnections = new Map<number, chrome.runtime.Port>()

// Handle connections from DevTools panels
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'sink-devtools-panel') {
    return
  }

  // The panel sends its tab ID as the first message
  const extensionListener = (message: { tabId: number } | ContentScriptMessage) => {
    if ('tabId' in message && typeof message.tabId === 'number') {
      // Register this panel connection for the tab
      panelConnections.set(message.tabId, port)
      console.log(`[Sink DevTools] Panel connected for tab ${message.tabId}`)
      return
    }

    // Forward messages from panel to content script
    const contentScriptMessage = message as ContentScriptMessage
    if (contentScriptMessage.type === 'SINK_DEVTOOLS_RELAY' && contentScriptMessage.direction === 'to_page') {
      // Find which tab this panel is for
      for (const [tabId, panelPort] of panelConnections) {
        if (panelPort === port) {
          chrome.tabs.sendMessage(tabId, contentScriptMessage)
          break
        }
      }
    }
  }

  port.onMessage.addListener(extensionListener)

  port.onDisconnect.addListener(() => {
    // Remove the panel connection
    for (const [tabId, panelPort] of panelConnections) {
      if (panelPort === port) {
        panelConnections.delete(tabId)
        console.log(`[Sink DevTools] Panel disconnected for tab ${tabId}`)
        break
      }
    }
  })
})

// Handle messages from content scripts and forward to the appropriate panel
chrome.runtime.onMessage.addListener((message: ContentScriptMessage, sender) => {
  if (message.type !== 'SINK_DEVTOOLS_RELAY' || message.direction !== 'to_panel') {
    return
  }

  const tabId = sender.tab?.id
  if (tabId === undefined) {
    return
  }

  // Forward to the panel connected to this tab
  const panelPort = panelConnections.get(tabId)
  if (panelPort) {
    panelPort.postMessage(message)
  }
})

console.log('[Sink DevTools] Background service worker started')
