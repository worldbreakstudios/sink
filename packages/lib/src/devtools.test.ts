import { describe, expect, it, beforeEach } from 'vitest'
import {
  __internalSinkDevtools,
  createSqliteCollection,
  deserializeSqliteValue,
  instrumentSqliteDatabase,
  registerSinkDevtoolsDatabase,
  serializeSqliteValue,
  type AsyncSqliteDatabase,
  type SqliteTableColumn,
} from './index.js'

const ITEM_COLUMNS: SqliteTableColumn[] = [
  {
    cid: 0,
    name: '_id',
    type: 'TEXT',
    notnull: 1,
    dflt_value: null,
    pk: 1,
  },
  {
    cid: 1,
    name: 'name',
    type: 'TEXT',
    notnull: 1,
    dflt_value: null,
    pk: 0,
  },
]

function createFakeDatabase(): AsyncSqliteDatabase {
  const rows: Array<Record<string, unknown>> = []

  return {
    version: '3.0.0',
    async execute() {
      return undefined
    },
    async query<TRow extends object = Record<string, unknown>>(sql: string) {
      if (sql.includes('SELECT * FROM "items"')) {
        return rows as TRow[]
      }

      return [] as TRow[]
    },
    async getTableColumns() {
      return ITEM_COLUMNS
    },
    async getTableIndexes() {
      return []
    },
    async rowExists() {
      return true
    },
    async coerceTableValue(_tableName, _columnName, rawValue) {
      return rawValue
    },
    async createInsertableRow() {
      return {
        _id: 'draft-id',
        name: '',
      }
    },
    async inspectTables() {
      return [
        {
          name: 'items',
          schema: 'CREATE TABLE "items" ("_id" TEXT PRIMARY KEY, "name" TEXT NOT NULL)',
          columns: ITEM_COLUMNS,
          rows: [],
        },
      ]
    },
    async close() {
      return undefined
    },
  }
}

beforeEach(() => {
  __internalSinkDevtools.resetForTests()
})

describe('Sink devtools serialization', () => {
  it('serializes string, number, and null values', () => {
    expect(serializeSqliteValue('hello')).toBe('hello')
    expect(serializeSqliteValue(42)).toBe(42)
    expect(serializeSqliteValue(null)).toBeNull()
  })

  it('serializes bigint and blob values', () => {
    expect(serializeSqliteValue(123n)).toEqual({
      type: 'bigint',
      value: '123',
    })

    const blob = new Uint8Array([1, 2, 3, 4])
    const serialized = serializeSqliteValue(blob)

    expect(serialized).toMatchObject({
      type: 'blob',
      byteLength: 4,
    })
    expect(deserializeSqliteValue(serialized)).toEqual(blob)
  })
})

describe('Sink devtools registration', () => {
  it('tracks multiple registered databases with persistence labels', () => {
    const opfsDb = instrumentSqliteDatabase(createFakeDatabase(), 'opfs', 'app.db')
    const storageDb = instrumentSqliteDatabase(
      createFakeDatabase(),
      'localStorage',
      'localStorage',
    )
    const memoryDb = instrumentSqliteDatabase(createFakeDatabase(), 'memory', 'memory')

    for (const database of [opfsDb, storageDb, memoryDb]) {
      registerSinkDevtoolsDatabase({
        database,
        tableNames: ['items'],
        INDEXES: {
          items: {
            by_id: {
              fields: ['_id'],
              unique: true,
            },
          },
        },
        REFERENCE_COLUMNS: {
          items: {},
        },
      })
    }

    expect(__internalSinkDevtools.listRegisteredSinkDevtoolsDatabases()).toEqual([
      expect.objectContaining({
        displayLabel: 'app.db',
        persistenceType: 'opfs',
      }),
      expect.objectContaining({
        displayLabel: 'localStorage',
        persistenceType: 'localStorage',
      }),
      expect.objectContaining({
        displayLabel: 'memory',
        persistenceType: 'memory',
      }),
    ])
  })
})

describe('Sink devtools change notifications', () => {
  it('emits table-scoped change events for collection mutations', async () => {
    const database = createFakeDatabase()
    const collection = await createSqliteCollection<{
      _id: string
      name: string
    }, string, {
      by_id: {
        fields: readonly ['_id']
        unique: true
      }
    }>({
      id: 'items',
      tableName: 'items',
      keyColumn: '_id',
      getKey: (row) => row._id,
      database,
      indexes: {
        by_id: {
          fields: ['_id'] as const,
          unique: true,
        },
      },
      referenceColumns: {},
    })

    registerSinkDevtoolsDatabase({
      database,
      collections: {
        items: collection as never,
      },
      tableNames: ['items'],
      INDEXES: {
        items: {
          by_id: {
            fields: ['_id'],
            unique: true,
          },
        },
      },
      REFERENCE_COLUMNS: {
        items: {},
      },
    })

    const events: Array<{ tableNames: string[]; source: string }> = []
    const unsubscribe = __internalSinkDevtools.subscribeToSinkDevtoolsChanges(
      (event) => {
        events.push({
          tableNames: event.tableNames,
          source: event.source,
        })
      },
    )

    const transaction = collection.utils.createSqliteTransaction()
    transaction.mutate(() => {
      collection.insert({
        _id: '1',
        name: 'first',
      })
    })
    await transaction.isPersisted.promise
    unsubscribe()

    expect(events).toContainEqual({
      tableNames: ['items'],
      source: 'collection',
    })
  })

  it('emits change events for instrumented raw SQL writes', async () => {
    const baseDatabase = createFakeDatabase()
    const database = instrumentSqliteDatabase(baseDatabase, 'memory', 'memory')

    registerSinkDevtoolsDatabase({
      database,
      tableNames: ['items'],
      INDEXES: {
        items: {
          by_id: {
            fields: ['_id'],
            unique: true,
          },
        },
      },
      REFERENCE_COLUMNS: {
        items: {},
      },
    })

    const events: string[] = []
    const unsubscribe = __internalSinkDevtools.subscribeToSinkDevtoolsChanges(
      (event) => {
        events.push(event.source)
      },
    )

    await database.execute('UPDATE "items" SET "name" = ? WHERE "_id" = ?', [
      'next',
      '1',
    ])
    unsubscribe()

    expect(events).toContain('execute')
  })
})
