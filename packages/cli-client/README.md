# @worldbreakstudios/sink-cli

CLI tooling for the sink workspace. Provides the `sink` command with schema code generation.

## Setup

The CLI is available as the `sink` bin after building:

```bash
pnpm --filter @worldbreakstudios/sink-cli run build
```

## Commands

### `sink generate`

Discovers `*.schema.ts` files, loads their table definitions, and generates a single TypeScript file containing types, SQL DDL, TanStack DB collections, and typed CRUD helpers.

```bash
# One-shot generation
pnpm exec sink generate --cwd apps/sandbox

# Watch mode — regenerates on schema file changes
pnpm exec sink generate --cwd apps/sandbox --watch

# During development (skip build step)
npx tsx packages/cli-client/src/cli.ts generate --cwd apps/sandbox --watch
```

**Flags:**

| Flag | Default | Description |
|------|---------|-------------|
| `--cwd <dir>` | `.` | Project root directory to search for schema files |
| `--out <path>` | `src/data/generated/schema.gen.ts` | Output file path (relative to `--cwd`) |
| `--watch` | off | Watch for `.schema.ts` changes and regenerate automatically |

### How it works

1. **Discover** — Globs for `**/*.schema.ts` under `<cwd>/src/`
2. **Load** — Dynamically imports each schema file using [jiti](https://github.com/unjs/jiti) and extracts the `defineTable()` default export
3. **Validate** — Checks each table has exactly one `v.id()` primary key and no duplicate table names
4. **Emit** — Generates a single `.gen.ts` file
5. **Write** — Writes the output file and creates a `.gitignore` in the output directory to exclude generated files from version control

### Generated output

The generated `schema.gen.ts` contains:

#### Row type interfaces

```ts
export interface NoteRow {
  id: number
  notebook_id: number
  title: string
  body: string
  status: string
  created_at: string
}
```

#### SQL DDL constants

```ts
export const SQL_CREATE_NOTES = `CREATE TABLE IF NOT EXISTS "notes" (...);`
export const SQL_CREATE_ALL = [SQL_CREATE_NOTEBOOKS, SQL_CREATE_NOTES] as const
export function createAllTables(db: FrontendSqliteDatabase): void { ... }
```

#### Collection factory

```ts
export function createCollections(db: FrontendSqliteDatabase): SchemaCollections { ... }
```

Returns an object with a TanStack DB `SqliteCollection` per table, ready for use with `useLiveQuery`.

#### Batch transaction helper

```ts
export function createBatchTransaction(
  collections: SchemaCollections,
  config?: Omit<TransactionConfig<AnyRow>, 'mutationFn'>,
) { ... }
```

Creates a transaction that persists mutations across all collections.

#### Typed CRUD helpers

Per-table insert, update, and delete — both single and batch variants:

```ts
// Single operations
insertNote(collections, { notebook_id: 1, title: 'Hello', ... })
updateNote(collections, id, { title: 'Updated' })
deleteNote(collections, id)

// Batch operations
insertNotes(collections, [{ ... }, { ... }])
updateNotes(collections, [{ id: 1, changes: { ... } }])
deleteNotes(collections, [1, 2, 3])
```

Insert helpers accept `Omit<Row, 'id'>` since the primary key is auto-incremented.

### Example schema file

```ts
// src/data/notes.schema.ts
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

See the [`@worldbreakstudios/sink-lib` README](../lib/README.md) for the full list of supported validators.
