import { ServerSqliteDatabase } from '@sink/lib/server'
import { createAllTables } from './src/data/generated/schema.gen.ts'
import type { InvalidationTarget } from './src/data/prototype/types.ts'
import { createPrototypeServer } from './src/data/prototype/server.ts'
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

const server = await createPrototypeServer({
  database,
  port,
  hostname,
  websocketPath,
  resetPath,
  async resetDemo() {
    await resetSandboxSeedData(database)
    return DEMO_RESET_INVALIDATIONS
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

const DEMO_RESET_INVALIDATIONS: InvalidationTarget[] = [
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
