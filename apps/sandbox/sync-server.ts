import {
  ServerSqliteDatabase,
  type SyncInvalidationTarget,
} from '@sink/lib/server'
import { createAllTables } from './src/data/generated/schema.gen.ts'
import { createGeneratedSyncServerRuntime } from './src/data/generated/operations.gen.ts'
import { ensureSandboxSeedData, resetSandboxSeedData } from './src/lib/server-seed.ts'

const port = Number.parseInt(process.env.PORT ?? '3001', 10)
const hostname = process.env.HOST ?? '127.0.0.1'
const websocketPath = process.env.SINK_TX_PATH ?? '/ws/transactions'
const resetPath = process.env.SINK_RESET_PATH ?? '/api/reset-demo'
const databasePath =
  process.env.SINK_SERVER_DB_PATH ??
  new URL('./sandbox-sync.db', import.meta.url).pathname

const database = new ServerSqliteDatabase(databasePath)
await createAllTables(database)
await ensureSandboxSeedData(database)

const server = await createGeneratedSyncServerRuntime({
  database,
  port,
  hostname,
  websocketPath,
  async handleHttpRequest(request, response) {
    if (request.method !== 'POST' || request.url !== resetPath) {
      return false
    }

    await resetSandboxSeedData(database)
    response.statusCode = 200
    response.setHeader('Content-Type', 'application/json')
    response.end(
      JSON.stringify({
        ok: true,
        invalidations: DEMO_RESET_INVALIDATIONS,
      }),
    )
    return true
  },
  onError(error) {
    console.error('[prototype-sync-server]', error)
  },
})

console.log(
  `Prototype sync server listening at http://${hostname}:${port} and ws://${hostname}:${port}${websocketPath} using ${databasePath}`,
)

async function shutdown(exitCode = 0): Promise<void> {
  await server.close()
  await database.close()
  process.exit(exitCode)
}

process.on('SIGINT', () => {
  void shutdown(0)
})

process.on('SIGTERM', () => {
  void shutdown(0)
})

const DEMO_RESET_INVALIDATIONS: SyncInvalidationTarget[] = [
  {
    tableName: 'objectTypes',
    keys: [],
  },
  {
    tableName: 'objects',
    keys: [],
  },
  {
    tableName: 'fields',
    keys: [],
  },
]
