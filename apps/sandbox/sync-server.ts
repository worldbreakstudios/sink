import { ServerSqliteDatabase } from '@sink/lib/server'
import { createGeneratedSyncServer } from './src/data/generated/schema.server.gen.ts'

const port = Number.parseInt(process.env.PORT ?? '3001', 10)
const hostname = process.env.HOST ?? '127.0.0.1'
const websocketPath = process.env.SINK_SYNC_PATH ?? '/ws/sync'
const databasePath =
  process.env.SINK_SERVER_DB_PATH ??
  new URL('./sandbox-sync.db', import.meta.url).pathname

const database = new ServerSqliteDatabase(databasePath)
const server = await createGeneratedSyncServer({
  database,
  port,
  hostname,
  path: websocketPath,
  onError(error) {
    console.error('[sink-sync-server]', error)
  },
})

console.log(
  `Sink sync server listening at ws://${hostname}:${port}${websocketPath} using ${databasePath}`,
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
