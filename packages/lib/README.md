# @worldbreakstudios/sink-lib

Core SQLite utilities for building offline-first apps with TanStack DB.

## Standalone Browser Apps

Browser apps should consume the packaged runtime instead of aliasing into `src`.

Install the browser peers in the app itself so the bundler can resolve their runtime assets directly:

```sh
pnpm add @worldbreakstudios/sink-lib @sqlite.org/sqlite-wasm @tanstack/db
```

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { sinkVite } from '@worldbreakstudios/sink-lib/vite'

export default defineConfig({
  plugins: [sinkVite()],
})
```

```ts
// app.ts
import { createSharedOpfsDatabase } from '@worldbreakstudios/sink-lib/browser'

const { database } = await createSharedOpfsDatabase({
  filename: 'app.db',
  fallbackPersistence: 'localStorage',
})
```

`sinkVite()` wires in the Vite settings Sink needs for browser sqlite:

- COOP/COEP dev and preview headers
- `worker.format = 'es'`
- `optimizeDeps.exclude = ['@sqlite.org/sqlite-wasm', '@worldbreakstudios/sink-lib', '@worldbreakstudios/sink-lib/browser']`

If you want to develop against a local Sink checkout from another app repo, opt in explicitly:

```ts
import { defineConfig } from 'vite'
import { sinkVite } from '@worldbreakstudios/sink-lib/vite'

export default defineConfig({
  plugins: [sinkVite({ localSourceRoot: '../sink' })],
})
```

That mode adds source aliases and `server.fs.allow` for the provided Sink repo path. Production servers still need to send matching COOP/COEP headers if you use OPFS.

## Schema Definition API

Define your database tables in `*.schema.ts` files using `defineTable` and the `v` validator builder. These files are consumed by the `sink generate` CLI to produce typed collections, SQL DDL, and CRUD helpers.

### `defineTable(tableName, columns, options?)`

Creates a table definition. Each file should have a single `defineTable` as its default export.

```ts
// notes.schema.ts
import { defineTable, v } from '@worldbreakstudios/sink-lib'

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
import { createSqliteCollection } from '@worldbreakstudios/sink-lib'

const collection = createSqliteCollection<MyRow, number>({
  id: 'my-collection',
  tableName: 'my_table',
  keyColumn: 'id',
  getKey: (row) => row.id,
  database: db,
  orderBy: 'id ASC',
})
```
