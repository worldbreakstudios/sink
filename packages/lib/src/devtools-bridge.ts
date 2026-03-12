import type { AsyncSqliteDatabase, PersistenceType } from './sqlite.js'

export interface DatabaseInfo {
  name: string
  database: AsyncSqliteDatabase
  persistenceType: PersistenceType
}

export interface SinkDevToolsRegistry {
  databases: Map<string, DatabaseInfo>
  register(name: string, database: AsyncSqliteDatabase, persistenceType: PersistenceType): void
  unregister(name: string): void
  list(): string[]
  get(name: string): DatabaseInfo | undefined
  onUpdate: Set<() => void>
}

declare global {
  interface Window {
    __SINK_DEVTOOLS__?: SinkDevToolsRegistry
  }
}

let registryCounter = 0

function getOrCreateRegistry(): SinkDevToolsRegistry | null {
  if (typeof window === 'undefined') return null

  if (!window.__SINK_DEVTOOLS__) {
    window.__SINK_DEVTOOLS__ = {
      databases: new Map<string, DatabaseInfo>(),
      onUpdate: new Set<() => void>(),
      register(name: string, database: AsyncSqliteDatabase, persistenceType: PersistenceType) {
        this.databases.set(name, { name, database, persistenceType })
        this.onUpdate.forEach((callback: () => void) => callback())
      },
      unregister(name: string) {
        this.databases.delete(name)
        this.onUpdate.forEach((callback: () => void) => callback())
      },
      list(): string[] {
        return Array.from(this.databases.keys())
      },
      get(name: string): DatabaseInfo | undefined {
        return this.databases.get(name)
      },
    }
  }

  return window.__SINK_DEVTOOLS__
}

function generateDatabaseName(filename?: string): string {
  if (filename) {
    // Extract name from filename: "my-app.db" -> "my-app"
    const baseName = filename.replace(/\.db$/, '').replace(/^file:/, '')
    return baseName
  }

  // Generate a unique name for unnamed databases
  registryCounter++
  return `database-${registryCounter}`
}

export function registerDatabaseForDevTools(
  database: AsyncSqliteDatabase,
  persistenceType: PersistenceType,
  filename?: string,
): () => void {
  const registry = getOrCreateRegistry()
  if (!registry) return () => {}

  const name = generateDatabaseName(filename)
  registry.register(name, database, persistenceType)

  // Return cleanup function
  return () => registry.unregister(name)
}

export function getDevToolsRegistry(): SinkDevToolsRegistry | null {
  return getOrCreateRegistry()
}
