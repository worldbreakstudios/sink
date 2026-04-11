import { OpfsDatabase } from './sqlite.js'
import type { SqlValue } from '@sqlite.org/sqlite-wasm'
import type {
  DedicatedWorkerRequest,
  DedicatedWorkerResponse,
  SharedSqliteMethod,
  SharedSqliteMethodArgs,
  SharedSqliteMethodResult,
} from './shared-opfs-protocol.js'
import { serializeWorkerError } from './shared-opfs-protocol.js'

interface WorkerMessageEvent<TValue> {
  data: TValue
}

const workerScope = globalThis as unknown as {
  addEventListener(
    type: 'message',
    listener: (event: WorkerMessageEvent<DedicatedWorkerRequest>) => void,
  ): void
  postMessage(message: DedicatedWorkerResponse): void
}

let database: OpfsDatabase | null = null
let activeFilename: string | null = null
let operationQueue: Promise<void> = Promise.resolve()

workerScope.addEventListener(
  'message',
  (event: WorkerMessageEvent<DedicatedWorkerRequest>) => {
    const message = event.data

    operationQueue = operationQueue
      .then(() => handleMessage(message))
      .catch((error) => {
        postResponse({
          type: 'response',
          requestId: message.requestId,
          ok: false,
          error: serializeWorkerError(error),
        })
      })
  },
)

async function handleMessage(message: DedicatedWorkerRequest): Promise<void> {
  switch (message.type) {
    case 'open': {
      if (database && activeFilename === message.filename) {
        postResponse({
          type: 'response',
          requestId: message.requestId,
          ok: true,
          result: null,
        })
        return
      }

      await closeDatabase()
      database = await OpfsDatabase.create(message.filename, {
        sqliteRuntime: message.sqliteRuntime,
      })
      activeFilename = message.filename
      postResponse({
        type: 'response',
        requestId: message.requestId,
        ok: true,
        result: null,
      })
      return
    }
    case 'close': {
      await closeDatabase()
      postResponse({
        type: 'response',
        requestId: message.requestId,
        ok: true,
        result: null,
      })
      return
    }
    case 'call': {
      const result = await callDatabaseMethod(message.method, message.args)
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
      return currentDatabase.query(sql, bind as SqlValue[] | undefined) as Promise<
        SharedSqliteMethodResult[TMethod]
      >
    }
    case 'getTableColumns': {
      const [tableName] = args as SharedSqliteMethodArgs['getTableColumns']
      return currentDatabase.getTableColumns(
        tableName,
      ) as Promise<SharedSqliteMethodResult[TMethod]>
    }
    case 'getTableIndexes': {
      const [tableName] = args as SharedSqliteMethodArgs['getTableIndexes']
      return currentDatabase.getTableIndexes(
        tableName,
      ) as Promise<SharedSqliteMethodResult[TMethod]>
    }
    case 'rowExists': {
      const [tableName, key, keyColumns] = args as SharedSqliteMethodArgs['rowExists']
      return currentDatabase.rowExists(
        tableName,
        key,
        keyColumns,
      ) as Promise<SharedSqliteMethodResult[TMethod]>
    }
    case 'coerceTableValue': {
      const [tableName, columnName, rawValue] =
        args as SharedSqliteMethodArgs['coerceTableValue']
      return currentDatabase.coerceTableValue(
        tableName,
        columnName,
        rawValue,
      ) as Promise<SharedSqliteMethodResult[TMethod]>
    }
    case 'createInsertableRow': {
      const [tableName] = args as SharedSqliteMethodArgs['createInsertableRow']
      return currentDatabase.createInsertableRow(
        tableName,
      ) as Promise<SharedSqliteMethodResult[TMethod]>
    }
    case 'inspectTables': {
      const [limit] = args as SharedSqliteMethodArgs['inspectTables']
      return currentDatabase.inspectTables(
        limit,
      ) as Promise<SharedSqliteMethodResult[TMethod]>
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
    return
  }

  const currentDatabase = database
  database = null
  activeFilename = null
  await currentDatabase.close()
}

function postResponse(message: DedicatedWorkerResponse): void {
  workerScope.postMessage(message)
}
