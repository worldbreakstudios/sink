# Kick Off A New Project With Sink

This guide mirrors how the sandbox in this repo is wired today, then trims it down to the minimum you need for a fresh app in another repo.

The sandbox proves four things:

1. Sink expects a Vite app to install `sinkVite()` so SQLite worker assets and COOP/COEP headers are configured.
2. Your app defines tables in `src/**/*.schema.ts`.
3. `sink generate` emits typed runtime files into `src/data/generated/`.
4. The browser boot path is: `createSharedOpfsDatabase()` -> `createAllTables()` -> `createCollections()`.

## Recommended Starting Point

Start with local-only persistence first. Add the sync/server layer later if you need multi-device or multi-user coordination.

If you are starting a brand-new app, prefer TanStack Start.

Sink only requires a Vite-compatible app, but TanStack Start is the ideal default because:

- the sandbox in this repo is already a TanStack Start app
- it fits naturally with TanStack Router and TanStack DB
- you can keep browser UI, server routes, and future sync-related endpoints in one project

If you already have another Vite app shape, that is still fine. The rest of this guide applies there too.

Suggested project shape:

```text
my-app/
  src/
    data/
      projects.schema.ts
      tasks.schema.ts
      generated/
    lib/
      sink.ts
    routes/ or components/
  vite.config.ts
  package.json
```

## Install

The recommended flow is:

1. Scaffold your app with TanStack Start.
2. Add Sink to that app.

Recommended TanStack Start scaffold commands for a new React app:

```sh
bun create @tanstack/start@latest
```

```sh
bunx @tanstack/cli create
```

During the scaffold prompts, pick the React/TanStack Start path that is closest to the sandbox in this repo.

Good defaults:

- framework: `react`
- routing style: file-based routing
- package manager: `bun`

After scaffolding, move into the new app repo and add Sink there.

If Sink is available through your registry:

```sh
cd my-app
bun add @worldbreakstudios/sink-lib @tanstack/db @tanstack/react-db
bun add -d @worldbreakstudios/sink-cli vite
```

If you are developing against a sibling `sink/` checkout instead, use local package specs or run the CLI from the Sink repo directly. The important part is keeping the library and CLI on the same Sink version.

## Wire Vite

The sandbox uses Vite plus `sinkVite()`. That is the cleanest setup for a new project too.

If you are using TanStack Start, this is still the right place to wire Sink because TanStack Start sits on top of Vite.

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { sinkVite } from '@worldbreakstudios/sink-lib/vite'

export default defineConfig({
  plugins: [
    sinkVite(),
    react(),
  ],
})
```

If you want your app repo to bundle straight from a local Sink checkout while you are iterating on Sink itself:

```ts
sinkVite({ localSourceRoot: '../sink' })
```

## Define Schemas

Put schema files under `src/`. The CLI discovers `**/*.schema.ts` below that directory.

Important conventions from the current codebase:

- Do not declare `_id` yourself. Sink adds it implicitly.
- `actors` is auto-added by the CLI if you do not define it.
- Use `.withActorId(true)` only when you want actor-scoped rows.
- Use `.withActorId(true, { pk: true })` when `_actor` should be part of the primary key.

Example:

```ts
// src/data/projects.schema.ts
import { defineTable, v } from '@worldbreakstudios/sink-lib'

export default defineTable('projects', {
  name: v.string(),
  status: v.default(v.string(), 'active'),
  notes: v.nullable(v.string()),
})
  .withCreatedAt(true)
  .index('by_name', ['name'])
```

```ts
// src/data/tasks.schema.ts
import { defineTable, v } from '@worldbreakstudios/sink-lib'

export default defineTable('tasks', {
  project_id: v.id('projects', { enforceExists: true }),
  title: v.string(),
  done: v.default(v.boolean(), false),
})
  .withCreatedAt(true)
  .index('by_project_id', ['project_id'])
```

## Run Codegen

If the CLI is installed in your app repo:

```json
{
  "scripts": {
    "sink:generate": "sink generate --cwd .",
    "sink:watch": "sink generate --cwd . --watch"
  }
}
```

Then run:

```sh
bun run sink:generate
```

If you would rather run the CLI from the Sink repo while your app lives next door, run this from your app repo root:

```sh
bunx tsx ../sink/packages/cli-client/src/cli.ts generate --cwd .
```

What the CLI generates today:

- `src/data/generated/schema.gen.ts`
- `src/data/generated/operations.gen.ts`

Even if you are not using sync yet, `operations.gen.ts` is expected output.

The generator also watches more than schema files. It will regenerate when these files change under `src/`:

- `*.schema.ts`
- `*.policy.ts`
- `*.queries.ts`
- `*.mutations.ts`

## Bootstrap The Browser Database

Create a small app-local wrapper around the generated schema helpers. The sandbox does this in `src/lib/sqlite-demo-collections.ts`; your first version can be much smaller:

```ts
// src/lib/sink.ts
import { createSharedOpfsDatabase } from '@worldbreakstudios/sink-lib/browser'
import {
  createAllTables,
  createCollections,
  createBatchTransaction,
} from '../data/generated/schema.gen'

export async function createSinkWorkspace() {
  const { database, persistenceType } = await createSharedOpfsDatabase({
    filename: 'my-app.db',
    fallbackPersistence: 'localStorage',
  })

  await createAllTables(database)

  const collections = await createCollections(database)

  return {
    database,
    persistenceType,
    collections,
    createBatchTransaction: (config?: Parameters<typeof createBatchTransaction>[1]) =>
      createBatchTransaction(collections, config),
  }
}
```

That gives you:

- a browser SQLite database backed by shared OPFS when available
- automatic fallback to `localStorage` if OPFS/shared workers are unavailable
- one typed TanStack DB collection per table
- generated batch transaction helpers

## Read And Write Data

The generated file includes typed CRUD helpers, so your first write path can stay very small:

```ts
import { insertProject, insertTask } from '../data/generated/schema.gen'

await insertProject(workspace.collections, {
  name: 'Inbox',
  status: 'active',
  notes: null,
})

const projects = await workspace.collections.projects.utils.readAll()

await insertTask(workspace.collections, {
  project_id: projects[0]!._id,
  title: 'Ship the first screen',
  done: false,
})
```

For reactive UI, the sandbox subscribes to whole collections with `useLiveQuery()`:

```ts
import { useLiveQuery } from '@tanstack/react-db'

const projectsQuery = useLiveQuery(
  () => workspace.collections.projects as never,
  [workspace.collections.projects as never],
)
```

That gives you a live array in `projectsQuery.data`.

## What To Ignore At First

The sandbox includes extra pieces that are useful later but not required for day one:

- seed scripts
- schema inspection tooling
- reset/debug endpoints
- websocket sync runtime
- lock inspection UI

You do not need any of that to get a local app running.

## Add Sync Later

When you are ready for server-backed sync, the sandbox’s pattern is:

1. Keep using the same schema files and generated `schema.gen.ts`.
2. Start consuming the generated `operations.gen.ts`.
3. On the client, build a higher-level workspace with `createGeneratedBrowserWorkspace(...)`.
4. On the server, create a `ServerSqliteDatabase`, call `createAllTables(database)`, then start `createGeneratedSyncServerRuntime(...)`.
5. Add optional `*.policy.ts`, `*.queries.ts`, and `*.mutations.ts` files under `src/` as your sync contract grows.

If you are just kicking off a new project, skip this until the local-only flow feels good.

## Gotchas

- `sink generate` only scans under `src/`, so keep schema and sync definition files there.
- Treat `src/data/generated/*` as build output. Do not hand-edit those files.
- `sinkVite()` is not optional if you want the same browser SQLite behavior as the sandbox.
- If you deploy behind a custom server, production still needs matching `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers for shared OPFS mode.
- If a table references an actor-scoped table, the referencing table must also opt into `.withActorId(true)`. The CLI validates this.
- Generated insert helpers already understand implicit `_id` and timestamp fields, so prefer them over hand-rolling inserts on day one.

## Minimal Checklist

1. Add `@worldbreakstudios/sink-lib`, `@tanstack/db`, and `@tanstack/react-db`.
2. Add `sinkVite()` to `vite.config.ts`.
3. Create `src/**/*.schema.ts`.
4. Run `sink generate --cwd .`.
5. Call `createSharedOpfsDatabase()`, then `createAllTables()`, then `createCollections()`.
6. Use the generated CRUD helpers and TanStack DB collections in your UI.

That is the smallest path from zero to a working Sink-backed app, and it matches the architecture the sandbox is already exercising.
