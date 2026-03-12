import { useState, useEffect, useCallback, useRef } from 'react'
import type {
  DatabaseInfo,
  PanelToPageMessage,
  PageToPanelMessage,
  ContentScriptMessage,
} from '@/shared/types'
import type { SqliteTableSnapshot } from '@sink/lib'

interface DevToolsBridgeState {
  databases: DatabaseInfo[]
  tables: SqliteTableSnapshot[]
  selectedDatabase: string | null
  isConnected: boolean
}

export function useDevToolsBridge() {
  const [state, setState] = useState<DevToolsBridgeState>({
    databases: [],
    tables: [],
    selectedDatabase: null,
    isConnected: false,
  })

  const pendingRequests = useRef<Map<string, (response: PageToPanelMessage) => void>>(new Map())
  const portRef = useRef<chrome.runtime.Port | null>(null)

  // Generate unique request ID
  const generateRequestId = useCallback(() => {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  }, [])

  // Initialize port connection to background service worker
  useEffect(() => {
    const port = chrome.runtime.connect({ name: 'sink-devtools-panel' })
    portRef.current = port

    // Send the tab ID to register this panel
    port.postMessage({ tabId: chrome.devtools.inspectedWindow.tabId })

    // Listen for messages from background (relayed from content script)
    port.onMessage.addListener((message: ContentScriptMessage) => {
      if (message.type !== 'SINK_DEVTOOLS_RELAY' || message.direction !== 'to_panel') {
        return
      }

      const callback = pendingRequests.current.get(message.requestId)
      if (callback) {
        callback(message.payload as PageToPanelMessage)
      }
    })

    port.onDisconnect.addListener(() => {
      console.log('[Sink DevTools] Port disconnected')
      portRef.current = null
    })

    return () => {
      port.disconnect()
    }
  }, [])

  // Send message to page and wait for response
  const sendMessage = useCallback(
    <T extends PageToPanelMessage>(message: PanelToPageMessage): Promise<T> => {
      return new Promise((resolve, reject) => {
        if (!portRef.current) {
          reject(new Error('Not connected to background'))
          return
        }

        const requestId = generateRequestId()

        const timeoutId = setTimeout(() => {
          pendingRequests.current.delete(requestId)
          reject(new Error('Request timeout'))
        }, 10000)

        pendingRequests.current.set(requestId, (response) => {
          clearTimeout(timeoutId)
          pendingRequests.current.delete(requestId)

          if (response.type === 'ERROR') {
            reject(new Error(response.message))
          } else {
            resolve(response as T)
          }
        })

        // Send via port to background, which forwards to content script
        portRef.current.postMessage({
          type: 'SINK_DEVTOOLS_RELAY',
          direction: 'to_page',
          requestId,
          payload: message,
        } satisfies ContentScriptMessage)
      })
    },
    [generateRequestId]
  )

  // Discover databases
  const discoverDatabases = useCallback(async () => {
    try {
      const response = await sendMessage<{ type: 'DATABASES_LIST'; databases: DatabaseInfo[] }>({
        type: 'DISCOVER_DATABASES',
      })

      setState((prev) => ({
        ...prev,
        databases: response.databases,
        isConnected: true,
      }))

      return response.databases
    } catch (error) {
      console.error('Failed to discover databases:', error)
      setState((prev) => ({ ...prev, isConnected: false }))
      return []
    }
  }, [sendMessage])

  // Load tables for selected database
  const loadTables = useCallback(
    async (databaseName: string) => {
      try {
        const response = await sendMessage<{ type: 'TABLES_SNAPSHOT'; tables: SqliteTableSnapshot[] }>({
          type: 'INSPECT_TABLES',
          databaseName,
          limit: 100,
        })

        setState((prev) => ({
          ...prev,
          tables: response.tables,
        }))
      } catch (error) {
        console.error('Failed to load tables:', error)
      }
    },
    [sendMessage]
  )

  // Set selected database
  const setSelectedDatabase = useCallback(
    (databaseName: string) => {
      setState((prev) => ({
        ...prev,
        selectedDatabase: databaseName,
        tables: [],
      }))
      loadTables(databaseName)
    },
    [loadTables]
  )

  // Refresh everything
  const refresh = useCallback(async () => {
    const databases = await discoverDatabases()
    if (databases.length > 0 && state.selectedDatabase) {
      await loadTables(state.selectedDatabase)
    } else if (databases.length > 0) {
      setSelectedDatabase(databases[0]!.name)
    }
  }, [discoverDatabases, loadTables, state.selectedDatabase, setSelectedDatabase])

  // Initial discovery (with delay to ensure port is connected)
  useEffect(() => {
    const timer = setTimeout(async () => {
      const databases = await discoverDatabases()
      if (databases.length > 0) {
        setSelectedDatabase(databases[0]!.name)
      }
    }, 100)

    return () => clearTimeout(timer)
  }, [discoverDatabases, setSelectedDatabase])

  return {
    ...state,
    setSelectedDatabase,
    refresh,
    sendMessage,
  }
}
