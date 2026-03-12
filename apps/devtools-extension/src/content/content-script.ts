import type { ContentScriptMessage, PageMessage, PanelMessage } from '@/shared/types'

// Inject the page bridge script into the page context
function injectPageBridge() {
  const script = document.createElement('script')
  script.src = chrome.runtime.getURL('page-bridge.js')
  ;(document.head || document.documentElement).appendChild(script)
  script.onload = () => script.remove()
}

// Run injection as early as possible
injectPageBridge()

// Listen for messages from the DevTools panel (via chrome.runtime)
chrome.runtime.onMessage.addListener(
  (message: ContentScriptMessage) => {
    if (message.type !== 'SINK_DEVTOOLS_RELAY' || message.direction !== 'to_page') {
      return
    }

    // Forward to page via window.postMessage
    window.postMessage(
      {
        source: 'SINK_DEVTOOLS_PANEL',
        requestId: message.requestId,
        payload: message.payload,
      } as PanelMessage,
      '*'
    )
  }
)

// Listen for messages from the page (via window.postMessage)
window.addEventListener('message', (event) => {
  // Only accept messages from the same window
  if (event.source !== window) return

  const message = event.data as PageMessage
  if (message?.source !== 'SINK_DEVTOOLS_PAGE') return

  // Forward to DevTools panel via chrome.runtime
  chrome.runtime.sendMessage({
    type: 'SINK_DEVTOOLS_RELAY',
    direction: 'to_panel',
    requestId: message.requestId,
    payload: message.payload,
  } satisfies ContentScriptMessage)
})

console.log('[Sink DevTools] Content script loaded')
