import type {
  SinkDevtoolsChangeEvent,
  SinkDevtoolsRpcResponse,
} from '@sink/lib'

declare global {
  interface Window {
    __sinkDevtoolsContentLoaded__?: boolean
  }
}

if (!window.__sinkDevtoolsContentLoaded__) {
  window.__sinkDevtoolsContentLoaded__ = true

  const port = chrome.runtime.connect({ name: 'sink-devtools-content' })

  port.onMessage.addListener((message: {
    type?: 'enable-page-bridge' | 'panel-rpc'
    request?: unknown
  }) => {
    if (message.type === 'enable-page-bridge') {
      window.postMessage(
        {
          source: '__sink_devtools_content__',
          type: 'enable',
        },
        '*',
      )
      return
    }

    if (message.type === 'panel-rpc' && message.request) {
      window.postMessage(
        {
          source: '__sink_devtools_content__',
          type: 'rpc-request',
          request: message.request,
        },
        '*',
      )
    }
  })

  window.addEventListener('message', (event) => {
    if (event.source !== window) {
      return
    }

    const data = event.data as {
      source?: string
      type?: 'enabled' | 'rpc-response' | 'change'
      response?: SinkDevtoolsRpcResponse
      event?: SinkDevtoolsChangeEvent
    }

    if (data.source !== '__sink_devtools_page__') {
      return
    }

    if (data.type === 'enabled') {
      port.postMessage({ type: 'page-enabled' })
      return
    }

    if (data.type === 'rpc-response' && data.response) {
      port.postMessage({
        type: 'rpc-response',
        response: data.response,
      })
      return
    }

    if (data.type === 'change' && data.event) {
      port.postMessage({
        type: 'change',
        event: data.event,
      })
    }
  })
}
