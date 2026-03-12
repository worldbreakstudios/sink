// This script runs in the PAGE context (injected via script tag)
// It has access to window.__SINK_DEVTOOLS__ which is set by pages using @sink/lib
// It CANNOT import from @sink/lib since it's not bundled with the page

// Types matching the shared protocol
interface PanelMessage {
  source: 'SINK_DEVTOOLS_PANEL'
  requestId: string
  payload: PanelToPageMessage
}

interface PageMessage {
  source: 'SINK_DEVTOOLS_PAGE'
  requestId: string
  payload: PageToPanelMessage
}

type PanelToPageMessage =
  | { type: 'DISCOVER_DATABASES' }
  | { type: 'INSPECT_TABLES'; databaseName: string; limit?: number }
  | { type: 'GET_TABLE_COLUMNS'; databaseName: string; tableName: string }
  | { type: 'GET_TABLE_INDEXES'; databaseName: string; tableName: string }
  | { type: 'EXECUTE_QUERY'; databaseName: string; sql: string; bind?: unknown[] }
  | { type: 'UPDATE_CELL'; databaseName: string; tableName: string; rowId: number; columnName: string; value: string }
  | { type: 'INSERT_ROW'; databaseName: string; tableName: string }
  | { type: 'DELETE_ROWS'; databaseName: string; tableName: string; rowIds: number[] }
  | { type: 'COERCE_VALUE'; databaseName: string; tableName: string; columnName: string; rawValue: string }
  | { type: 'CREATE_INSERTABLE_ROW'; databaseName: string; tableName: string }

type PageToPanelMessage =
  | { type: 'DATABASES_LIST'; databases: DatabaseInfo[] }
  | { type: 'TABLES_SNAPSHOT'; tables: unknown[] }
  | { type: 'TABLE_COLUMNS'; columns: unknown[] }
  | { type: 'TABLE_INDEXES'; indexes: unknown[] }
  | { type: 'QUERY_RESULT'; rows: unknown[] }
  | { type: 'MUTATION_SUCCESS' }
  | { type: 'COERCED_VALUE'; value: unknown }
  | { type: 'INSERTABLE_ROW'; row: unknown }
  | { type: 'ERROR'; message: string; originalType: string }

interface DatabaseInfo {
  name: string
  version: string
  persistenceType: string
}

// The registry is set up by pages using @sink/lib's createDatabase()
interface SinkDevToolsRegistry {
  list(): string[]
  get(name: string): {
    name: string
    database: {
      version: string
      inspectTables(limit?: number): Promise<unknown[]>
      getTableColumns(tableName: string): Promise<unknown[]>
      getTableIndexes(tableName: string): Promise<unknown[]>
      query(sql: string, bind?: unknown[]): Promise<unknown[]>
      execute(sql: string, bind?: unknown[]): Promise<void>
      coerceTableValue(tableName: string, columnName: string, rawValue: string): Promise<unknown>
      createInsertableRow(tableName: string): Promise<unknown>
    }
    persistenceType: string
  } | undefined
}

// Use type assertion to access the registry without conflicting with @sink/lib's global declaration
function getRegistry(): SinkDevToolsRegistry | undefined {
  return (window as unknown as { __SINK_DEVTOOLS__?: SinkDevToolsRegistry }).__SINK_DEVTOOLS__
}

function postResponse(requestId: string, payload: PageToPanelMessage) {
  window.postMessage(
    {
      source: 'SINK_DEVTOOLS_PAGE',
      requestId,
      payload,
    } satisfies PageMessage,
    '*'
  )
}

function postError(requestId: string, message: string, originalType: string) {
  postResponse(requestId, { type: 'ERROR', message, originalType })
}

async function handleMessage(requestId: string, message: PanelToPageMessage) {
  const registry = getRegistry()

  switch (message.type) {
    case 'DISCOVER_DATABASES': {
      if (!registry) {
        postResponse(requestId, { type: 'DATABASES_LIST', databases: [] })
        return
      }

      const databases: DatabaseInfo[] = registry.list().map((name: string) => {
        const info = registry.get(name)!
        return {
          name,
          version: info.database.version,
          persistenceType: info.persistenceType,
        }
      })

      postResponse(requestId, { type: 'DATABASES_LIST', databases })
      break
    }

    case 'INSPECT_TABLES': {
      if (!registry) {
        postError(requestId, 'No databases registered', message.type)
        return
      }

      const info = registry.get(message.databaseName)
      if (!info) {
        postError(requestId, `Database "${message.databaseName}" not found`, message.type)
        return
      }

      try {
        const tables = await info.database.inspectTables(message.limit ?? 100)
        postResponse(requestId, { type: 'TABLES_SNAPSHOT', tables })
      } catch (error) {
        postError(requestId, String(error), message.type)
      }
      break
    }

    case 'GET_TABLE_COLUMNS': {
      if (!registry) {
        postError(requestId, 'No databases registered', message.type)
        return
      }

      const info = registry.get(message.databaseName)
      if (!info) {
        postError(requestId, `Database "${message.databaseName}" not found`, message.type)
        return
      }

      try {
        const columns = await info.database.getTableColumns(message.tableName)
        postResponse(requestId, { type: 'TABLE_COLUMNS', columns })
      } catch (error) {
        postError(requestId, String(error), message.type)
      }
      break
    }

    case 'GET_TABLE_INDEXES': {
      if (!registry) {
        postError(requestId, 'No databases registered', message.type)
        return
      }

      const info = registry.get(message.databaseName)
      if (!info) {
        postError(requestId, `Database "${message.databaseName}" not found`, message.type)
        return
      }

      try {
        const indexes = await info.database.getTableIndexes(message.tableName)
        postResponse(requestId, { type: 'TABLE_INDEXES', indexes })
      } catch (error) {
        postError(requestId, String(error), message.type)
      }
      break
    }

    case 'EXECUTE_QUERY': {
      if (!registry) {
        postError(requestId, 'No databases registered', message.type)
        return
      }

      const info = registry.get(message.databaseName)
      if (!info) {
        postError(requestId, `Database "${message.databaseName}" not found`, message.type)
        return
      }

      try {
        const rows = await info.database.query(message.sql, message.bind)
        postResponse(requestId, { type: 'QUERY_RESULT', rows })
      } catch (error) {
        postError(requestId, String(error), message.type)
      }
      break
    }

    case 'UPDATE_CELL': {
      if (!registry) {
        postError(requestId, 'No databases registered', message.type)
        return
      }

      const info = registry.get(message.databaseName)
      if (!info) {
        postError(requestId, `Database "${message.databaseName}" not found`, message.type)
        return
      }

      try {
        const coercedValue = await info.database.coerceTableValue(
          message.tableName,
          message.columnName,
          message.value
        )

        await info.database.execute(
          `UPDATE "${message.tableName}" SET "${message.columnName}" = ? WHERE rowid = ?`,
          [coercedValue, message.rowId]
        )

        postResponse(requestId, { type: 'MUTATION_SUCCESS' })
      } catch (error) {
        postError(requestId, String(error), message.type)
      }
      break
    }

    case 'INSERT_ROW': {
      if (!registry) {
        postError(requestId, 'No databases registered', message.type)
        return
      }

      const info = registry.get(message.databaseName)
      if (!info) {
        postError(requestId, `Database "${message.databaseName}" not found`, message.type)
        return
      }

      try {
        const row = await info.database.createInsertableRow(message.tableName) as Record<string, unknown>
        const entries = Object.entries(row)

        if (entries.length === 0) {
          await info.database.execute(`INSERT INTO "${message.tableName}" DEFAULT VALUES`)
        } else {
          const columns = entries.map(([col]) => `"${col}"`).join(', ')
          const placeholders = entries.map(() => '?').join(', ')
          const values = entries.map(([, val]) => val)
          await info.database.execute(
            `INSERT INTO "${message.tableName}" (${columns}) VALUES (${placeholders})`,
            values
          )
        }

        postResponse(requestId, { type: 'MUTATION_SUCCESS' })
      } catch (error) {
        postError(requestId, String(error), message.type)
      }
      break
    }

    case 'DELETE_ROWS': {
      if (!registry) {
        postError(requestId, 'No databases registered', message.type)
        return
      }

      const info = registry.get(message.databaseName)
      if (!info) {
        postError(requestId, `Database "${message.databaseName}" not found`, message.type)
        return
      }

      try {
        const placeholders = message.rowIds.map(() => '?').join(', ')
        await info.database.execute(
          `DELETE FROM "${message.tableName}" WHERE rowid IN (${placeholders})`,
          message.rowIds
        )

        postResponse(requestId, { type: 'MUTATION_SUCCESS' })
      } catch (error) {
        postError(requestId, String(error), message.type)
      }
      break
    }

    case 'COERCE_VALUE': {
      if (!registry) {
        postError(requestId, 'No databases registered', message.type)
        return
      }

      const info = registry.get(message.databaseName)
      if (!info) {
        postError(requestId, `Database "${message.databaseName}" not found`, message.type)
        return
      }

      try {
        const value = await info.database.coerceTableValue(
          message.tableName,
          message.columnName,
          message.rawValue
        )
        postResponse(requestId, { type: 'COERCED_VALUE', value })
      } catch (error) {
        postError(requestId, String(error), message.type)
      }
      break
    }

    case 'CREATE_INSERTABLE_ROW': {
      if (!registry) {
        postError(requestId, 'No databases registered', message.type)
        return
      }

      const info = registry.get(message.databaseName)
      if (!info) {
        postError(requestId, `Database "${message.databaseName}" not found`, message.type)
        return
      }

      try {
        const row = await info.database.createInsertableRow(message.tableName)
        postResponse(requestId, { type: 'INSERTABLE_ROW', row })
      } catch (error) {
        postError(requestId, String(error), message.type)
      }
      break
    }

    default: {
      // @ts-expect-error exhaustive check
      postError(requestId, `Unknown message type: ${message.type}`, 'UNKNOWN')
    }
  }
}

// Listen for messages from the content script
window.addEventListener('message', (event) => {
  if (event.source !== window) return

  const message = event.data as PanelMessage
  if (message?.source !== 'SINK_DEVTOOLS_PANEL') return

  handleMessage(message.requestId, message.payload)
})

console.log('[Sink DevTools] Page bridge loaded')
