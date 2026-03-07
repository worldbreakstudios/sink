# @sink/lib

Core SQLite utilities for building offline-first apps with TanStack DB.

## Schema Definition API

Define your database tables in `*.schema.ts` files using `defineTable` and the `v` validator builder. These files are consumed by the `sink generate` CLI to produce typed collections, SQL DDL, and CRUD helpers.

### `defineTable(tableName, columns, options?)`

Creates a table definition. Each file should have a single `defineTable` as its default export.

```ts
// notes.schema.ts
import { defineTable, v } from '@sink/lib'

export default defineTable('notes', {
  id: v.id(),
  notebook_id: v.number(),
  title: v.string(),
  body: v.string(),
  status: v.default(v.string(), 'draft'),
  created_at: v.string(),
}, { orderBy: 'id ASC' })
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `tableName` | `string` | The SQLite table name |
| `columns` | `Record<string, ColumnDescriptor>` | Column definitions using `v` validators |
| `options.orderBy` | `string` (optional) | Default `ORDER BY` clause for queries |

### Validators (`v`)

Each validator returns a frozen `ColumnDescriptor` describing the column's SQLite type, TypeScript type, nullability, and default value.

| Validator | SQLite Type | TypeScript Type | Description |
|-----------|-------------|-----------------|-------------|
| `v.id()` | `INTEGER PRIMARY KEY` | `number` | Auto-increment primary key. Exactly one required per table. |
| `v.string()` | `TEXT NOT NULL` | `string` | Non-nullable text column |
| `v.number()` | `INTEGER NOT NULL` | `number` | Non-nullable integer column |
| `v.float()` | `REAL NOT NULL` | `number` | Non-nullable floating-point column |
| `v.boolean()` | `INTEGER NOT NULL` | `boolean` | Boolean stored as 0/1 |
| `v.nullable(inner)` | Removes `NOT NULL` | `T \| null` | Wraps any validator to allow nulls |
| `v.default(inner, value)` | Adds `DEFAULT` clause | Same as inner | Sets a SQL default value |

### Composing validators

Validators can be composed:

```ts
v.nullable(v.string())              // TEXT         -> string | null
v.default(v.string(), 'untitled')   // TEXT NOT NULL DEFAULT 'untitled' -> string
v.default(v.number(), 0)            // INTEGER NOT NULL DEFAULT 0 -> number
```

## SQLite Utilities

### `FrontendSqliteDatabase`

In-memory SQLite database wrapper built on `@sqlite.org/sqlite-wasm`.

```ts
const db = await FrontendSqliteDatabase.createInMemory()

db.execute('CREATE TABLE foo (id INTEGER PRIMARY KEY, name TEXT)')
db.execute('INSERT INTO foo (name) VALUES (?)', ['bar'])

const rows = db.query<{ id: number; name: string }>('SELECT * FROM foo')

db.close()
```

### `createSqliteCollection`

Creates a TanStack DB collection backed by a SQLite table, enabling reactive queries with `useLiveQuery`.

```ts
import { createSqliteCollection } from '@sink/lib'

const collection = createSqliteCollection<MyRow, number>({
  id: 'my-collection',
  tableName: 'my_table',
  keyColumn: 'id',
  getKey: (row) => row.id,
  database: db,
  orderBy: 'id ASC',
})
```
