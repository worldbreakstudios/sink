import { OpfsDatabase } from '@sink/lib'
import type { SqlValue } from '@sqlite.org/sqlite-wasm'
import type {
  DedicatedWorkerRequest,
  DedicatedWorkerResponse,
  SharedSqliteMethod,
  SharedSqliteMethodArgs,
  SharedSqliteMethodResult,
} from '../lib/shared-opfs-protocol.ts'
import { serializeWorkerError } from '../lib/shared-opfs-protocol.ts'
const SHARED_OPFS_DEBUG = import.meta.env.DEV

const workerScope = globalThis as unknown as {
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<DedicatedWorkerRequest>) => void,
  ): void
  postMessage(message: DedicatedWorkerResponse): void
}

let database: OpfsDatabase | null = null
let activeFilename: string | null = null
let operationQueue: Promise<void> = Promise.resolve()

workerScope.addEventListener('message', (event: MessageEvent<DedicatedWorkerRequest>) => {
  const message = event.data
  debugWorker('message:received', {
    requestId: message.requestId,
    type: message.type,
    activeFilename,
  })

  operationQueue = operationQueue
    .then(() => handleMessage(message))
    .catch((error) => {
      debugWorker('message:error', {
        requestId: message.requestId,
        type: message.type,
        error: getErrorMessage(error),
      })
      postResponse({
        type: 'response',
        requestId: message.requestId,
        ok: false,
        error: serializeWorkerError(error),
      })
    })
})

async function handleMessage(message: DedicatedWorkerRequest): Promise<void> {
  switch (message.type) {
    case 'open': {
      debugWorker('open:start', {
        requestId: message.requestId,
        filename: message.filename,
      })
      if (database && activeFilename === message.filename) {
        debugWorker('open:reused-existing-db', {
          requestId: message.requestId,
          filename: message.filename,
        })
        postResponse({
          type: 'response',
          requestId: message.requestId,
          ok: true,
          result: null,
        })
        return
      }

      await closeDatabase()
      database = await OpfsDatabase.create(message.filename)
      activeFilename = message.filename
      debugWorker('open:success', {
        requestId: message.requestId,
        filename: message.filename,
      })
      postResponse({
        type: 'response',
        requestId: message.requestId,
        ok: true,
        result: null,
      })
      return
    }
    case 'close': {
      debugWorker('close:start', {
        requestId: message.requestId,
        filename: activeFilename,
      })
      await closeDatabase()
      debugWorker('close:success', {
        requestId: message.requestId,
      })
      postResponse({
        type: 'response',
        requestId: message.requestId,
        ok: true,
        result: null,
      })
      return
    }
    case 'call': {
      debugWorker('call:start', {
        requestId: message.requestId,
        method: message.method,
      })
      const result = await callDatabaseMethod(message.method, message.args)
      debugWorker('call:success', {
        requestId: message.requestId,
        method: message.method,
      })
      postResponse({
        type: 'response',
        requestId: message.requestId,
        ok: true,
        result,
      })
      return
    }
  }
}

async function callDatabaseMethod<TMethod extends SharedSqliteMethod>(
  method: TMethod,
  args: SharedSqliteMethodArgs[TMethod],
): Promise<SharedSqliteMethodResult[TMethod]> {
  const currentDatabase = database

  if (!currentDatabase) {
    throw new Error('DB is not opened.')
  }

  switch (method) {
    case 'execute': {
      const [sql, bind] = args as SharedSqliteMethodArgs['execute']
      await currentDatabase.execute(sql, bind as SqlValue[] | undefined)
      return null as SharedSqliteMethodResult[TMethod]
    }
    case 'query': {
      const [sql, bind] = args as SharedSqliteMethodArgs['query']
      return currentDatabase.query(sql, bind as SqlValue[] | undefined) as unknown as SharedSqliteMethodResult[TMethod]
    }
    case 'getTableColumns': {
      const [tableName] = args as SharedSqliteMethodArgs['getTableColumns']
      return currentDatabase.getTableColumns(tableName) as unknown as SharedSqliteMethodResult[TMethod]
    }
    case 'getTableIndexes': {
      const [tableName] = args as SharedSqliteMethodArgs['getTableIndexes']
      return currentDatabase.getTableIndexes(tableName) as unknown as SharedSqliteMethodResult[TMethod]
    }
    case 'rowExists': {
      const [tableName, key, keyColumns] = args as SharedSqliteMethodArgs['rowExists']
      return currentDatabase.rowExists(tableName, key, keyColumns) as unknown as SharedSqliteMethodResult[TMethod]
    }
    case 'coerceTableValue': {
      const [tableName, columnName, rawValue] = args as SharedSqliteMethodArgs['coerceTableValue']
      return currentDatabase.coerceTableValue(tableName, columnName, rawValue) as unknown as SharedSqliteMethodResult[TMethod]
    }
    case 'createInsertableRow': {
      const [tableName] = args as SharedSqliteMethodArgs['createInsertableRow']
      return currentDatabase.createInsertableRow(tableName) as unknown as SharedSqliteMethodResult[TMethod]
    }
    case 'inspectTables': {
      const [limit] = args as SharedSqliteMethodArgs['inspectTables']
      return currentDatabase.inspectTables(limit) as unknown as SharedSqliteMethodResult[TMethod]
    }
    case 'close': {
      await closeDatabase()
      return null as SharedSqliteMethodResult[TMethod]
    }
  }
}

async function closeDatabase(): Promise<void> {
  if (!database) {
    activeFilename = null
    debugWorker('close:noop-no-database')
    return
  }

  const currentDatabase = database
  database = null
  activeFilename = null
  debugWorker('close:database-begin')
  await currentDatabase.close()
  debugWorker('close:database-finished')
}

function postResponse(message: DedicatedWorkerResponse): void {
  workerScope.postMessage(message)
}

function debugWorker(event: string, details?: Record<string, unknown>): void {
  if (!SHARED_OPFS_DEBUG) {
    return
  }

  if (details) {
    console.debug('[shared-opfs:worker]', event, details)
    return
  }

  console.debug('[shared-opfs:worker]', event)
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
