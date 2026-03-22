import type { AsyncSqliteDatabase } from '@sink/lib'
import {
  SYNC_SERVER_LOCKS_TABLE,
  SYNC_SERVER_TRANSACTIONS_TABLE,
  ensureSyncServerStateTables,
} from '@sink/lib/server'
import { createAllTables } from '../data/generated/schema.gen.ts'
export { ensureSandboxSeedData } from './sandbox-seed-data.ts'
import { ensureSandboxSeedData } from './sandbox-seed-data.ts'

export async function resetSandboxSeedData(db: AsyncSqliteDatabase): Promise<void> {
  await createAllTables(db)
  await ensureSyncServerStateTables(db)

  await db.execute('PRAGMA foreign_keys = OFF;')

  try {
    for (const tableName of SANDBOX_RESET_TABLES) {
      await db.execute(`DELETE FROM "${tableName}";`)
    }
  } finally {
    await db.execute('PRAGMA foreign_keys = ON;')
  }

  await ensureSandboxSeedData(db)
}
const SANDBOX_RESET_TABLES = [
  'demos',
  'fields',
  'objects',
  'idManualTests',
  'objectTypes',
  'fieldTypes',
  'actors',
  SYNC_SERVER_TRANSACTIONS_TABLE,
  SYNC_SERVER_LOCKS_TABLE,
] as const
