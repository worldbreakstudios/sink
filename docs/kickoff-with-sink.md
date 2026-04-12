# Kick Off A New Project With Sink

This guide mirrors how the sandbox in this repo is wired today and shows the recommended full Sink setup for a fresh app in another repo.

The sandbox proves six things:

1. Sink expects a Vite app to install `sinkVite()` so SQLite worker assets and COOP/COEP headers are configured.
2. Your app defines tables in `src/**/*.schema.ts`.
3. `sink generate` emits typed runtime files into `src/data/generated/`.
4. The browser boot path can use `createSharedOpfsDatabase()` for offline local persistence plus built-in cross-tab coordination.
5. The backend sync path is driven by `createGeneratedSyncServerRuntime(...)` plus a real SQLite database on the server.
6. The schema files remain the long-term source of truth as your data model evolves over time.

## Recommended Starting Point

For a new Sink app, the recommended default is the full setup:

- local offline persistence in the browser
- built-in cross-tab management for that local database
- a backend sync server with its own SQLite database
- schema-driven codegen so the system can evolve cleanly over time

That combination is what makes Sink most valuable. The local-only path is still useful for debugging, prototypes, or temporarily reducing scope, but it should not be the default recommendation.

If you are starting a brand-new app, prefer TanStack Start.

Sink only requires a Vite-compatible app, but TanStack Start is the ideal default because:

- the sandbox in this repo is already a TanStack Start app
- it fits naturally with TanStack Router and TanStack DB
- you can keep browser UI, server routes, sync endpoints, and schema evolution work in one project

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
3. Generate the schema/runtime files.
4. Wire the browser database, the sync server, and the client/server connection together.

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

For quick local experimentation, you can create a small app-local wrapper around the generated schema helpers. The sandbox does this in `src/lib/sqlite-demo-collections.ts`; a reduced version looks like this:

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

This local-only helper is useful, but the recommended production-oriented path is the sync-aware workspace later in this guide.

## Cross-Tab Management

If your app is open in multiple tabs, Sink manages the local OPFS database through a built-in coordination layer. You do not need to wire this up yourself. It starts automatically when you call `createSharedOpfsDatabase(...)`.

There are two worker roles involved:

- a shared background coordinator worker: one per browser origin/app, shared across tabs
- a dedicated SQLite worker: one per tab, but only the active tab keeps its worker opened against OPFS

The high-level model is:

1. Each tab registers itself with the coordinator worker.
2. The coordinator elects one tab as the active owner.
3. The active tab opens the OPFS-backed SQLite database in its dedicated worker.
4. All tabs send database requests through the coordinator.
5. The coordinator forwards those requests to the active tab.
6. The active tab executes them and sends results back to the original requester.

That means there is still a single logical local database, but only one tab is directly attached to the OPFS file at a time.

### What The Coordinator Worker Does

The shared coordinator worker is responsible for:

- tracking which tabs are connected
- electing the active tab
- sending role updates to tabs
- queueing database requests until the active tab is ready
- forwarding results back to the requesting tab
- detecting stale tabs and failing over if the active tab disappears

Sink currently elects the oldest connected live tab as the active tab. If that tab goes away, another connected tab is promoted automatically.

### What The Active Tab Does

The active tab:

- opens the OPFS database in its dedicated worker
- holds the browser lock used to act as the current owner when Web Locks are available
- executes SQLite calls on behalf of every tab
- reports readiness or startup failure back to the coordinator

Non-active tabs do not open OPFS directly. They still get a normal `AsyncSqliteDatabase` interface, but their requests are proxied through the coordinator to the active tab.

### Heartbeats And Failover

Each tab sends a heartbeat to the coordinator every 5 seconds. If a tab stops heartbeating for roughly 15 seconds, the coordinator treats it as stale and removes it.

If the stale tab was the active one, the coordinator elects a new active tab and tells it to open the database. Pending requests are held until the new active tab reports that it is ready.

Tabs also unregister on `pagehide` and `beforeunload`, so normal navigations and closes usually fail over faster than the heartbeat timeout.

### Fallback Behavior

The shared OPFS path only activates when all of these are available:

- OPFS
- `Worker`
- `SharedWorker`
- `MessageChannel`

If that environment is not available, Sink falls back to the configured non-OPFS persistence mode, usually `localStorage`, and then to memory if needed.

### Debugging Notes

- `getSharedOpfsBrowserTabId()` gives you a short per-tab identifier that is useful for debugging which tab is active.
- `clearSharedOpfsDatabase(...)` can fail while another tab still has the app open, because another tab may still own the OPFS file.
- If you see a timeout like “waiting for the shared OPFS coordinator” or “waiting for the shared OPFS worker,” it usually means the active tab failed to come up or disappeared mid-request.

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

## What You Can Defer

The sandbox includes some extras that are helpful but not part of the core recommended path:

- seed scripts
- schema inspection tooling
- reset/debug endpoints
- lock inspection UI

You can defer those while still keeping the main Sink shape: local offline DB, cross-tab coordination, backend sync server, and generated schema/runtime files.

## Set Up The Sync Server

For the recommended server-backed setup, there is one important expectation to set first:

`sink generate` does not create a runnable `sync-server.ts` file for you, and it does not pre-create a backend SQLite database file on disk.

What it does generate is the sync contract in `src/data/generated/operations.gen.ts`, including:

- `SYNC_METADATA`
- `generatedQueries`
- `generatedMutations`
- `createGeneratedSyncClient(...)`
- `createGeneratedSyncServerRuntime(...)`

You still write a small server entrypoint yourself. The backend SQLite file is created the first time your server opens it with `new ServerSqliteDatabase(databasePath)`.

### Server Script

Add a script like this to your app `package.json`:

```json
{
  "scripts": {
    "sync:server": "bun run ./sync-server.ts"
  }
}
```

Then create `sync-server.ts` at your app root:

```ts
// sync-server.ts
import { ServerSqliteDatabase } from '@worldbreakstudios/sink-lib/server'
import { createAllTables } from './src/data/generated/schema.gen.ts'
import { createGeneratedSyncServerRuntime } from './src/data/generated/operations.gen.ts'

const port = Number.parseInt(process.env.PORT ?? '3001', 10)
const hostname = process.env.HOST ?? '127.0.0.1'
const websocketPath = process.env.SINK_TX_PATH ?? '/ws/transactions'
const databasePath =
  process.env.SINK_SERVER_DB_PATH ??
  new URL('./sync.db', import.meta.url).pathname

const database = new ServerSqliteDatabase(databasePath)

await createAllTables(database)

const server = await createGeneratedSyncServerRuntime({
  database,
  port,
  hostname,
  websocketPath,
  onError(error) {
    console.error('[sink-sync-server]', error)
  },
})

console.log(
  `Sink sync server listening at http://${hostname}:${port} and ws://${hostname}:${port}${websocketPath} using ${databasePath}`,
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
```

What that does:

- opens or creates `sync.db`
- creates your app tables via `createAllTables(database)`
- starts the generated HTTP + WebSocket sync runtime
- creates Sink’s internal server state tables automatically

Sink’s internal server tables are separate from your app tables. They are created automatically by the sync runtime under names like `_sink_server_transactions` and `_sink_server_locks`.

### Start And Verify The Server

Run:

```sh
bun run sync:server
```

Then verify the built-in health endpoint:

```sh
curl http://127.0.0.1:3001/health
```

You should get back:

```json
{ "ok": true }
```

### Point The Client At The Server

Add your server URL to `.env.local`:

```sh
VITE_SINK_SERVER_URL=http://127.0.0.1:3001
```

For the recommended full setup, use a sync-aware workspace like this:

```ts
// src/lib/sink-sync.ts
import {
  createGeneratedBrowserWorkspace,
  createSharedOpfsDatabase,
} from '@worldbreakstudios/sink-lib'
import {
  SYNC_METADATA,
  createGeneratedSyncClient,
  generatedMutations,
  generatedQueries,
} from '../data/generated/operations.gen'
import {
  createAllTables,
  createBatchTransaction,
  createCollections,
} from '../data/generated/schema.gen'

function resolveServerUrl(): string {
  return import.meta.env.VITE_SINK_SERVER_URL?.trim() || 'http://127.0.0.1:3001'
}

function resolveWebSocketUrl(serverBaseUrl: string): string {
  const url = new URL(serverBaseUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = '/ws/transactions'
  url.search = ''
  url.hash = ''
  return url.toString()
}

export async function createSinkSyncWorkspace() {
  const serverBaseUrl = resolveServerUrl()

  return createGeneratedBrowserWorkspace({
    metadata: SYNC_METADATA,
    createDatabase: () =>
      createSharedOpfsDatabase({
        filename: 'my-app.db',
        fallbackPersistence: 'localStorage',
      }),
    createAllTables,
    createCollections,
    createBatchTransaction,
    createSyncClient: ({
      database,
      collections,
      createBatchTransaction,
      serverBaseUrl: syncServerBaseUrl,
      websocketUrl,
    }) =>
      createGeneratedSyncClient({
        database,
        collections,
        createBatchTransaction,
        serverBaseUrl: syncServerBaseUrl,
        websocketUrl,
      }),
    queries: generatedQueries,
    mutations: generatedMutations,
    serverBaseUrl,
    websocketUrl: resolveWebSocketUrl(serverBaseUrl),
  })
}
```

That is the equivalent of the sandbox’s sync-enabled browser bootstrap, just stripped down for a new app. If you already built the smaller local-only helper earlier, this is the version you should graduate to for the real default architecture.

### Optional Extensions

As your app grows, you can add these under `src/` and rerun codegen:

- `*.policy.ts`
- `*.queries.ts`
- `*.mutations.ts`

Those files extend the generated sync contract, but they are optional for a first pass.

## Gotchas

- `sink generate` only scans under `src/`, so keep schema and sync definition files there.
- Treat `src/data/generated/*` as build output. Do not hand-edit those files.
- `sink generate` does not emit a runnable sync server file or a prebuilt backend `.db` file.
- The backend SQLite file is created when your server process opens it.
- `createGeneratedSyncServerRuntime(...)` creates Sink’s internal sync tables automatically, but you still need to call `createAllTables(database)` for your app tables.
- The strongest Sink setup is not “browser only”; it is browser-local persistence plus cross-tab coordination plus a backend sync server.
- `sinkVite()` is not optional if you want the same browser SQLite behavior as the sandbox.
- If you deploy behind a custom server, production still needs matching `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers for shared OPFS mode.
- If a table references an actor-scoped table, the referencing table must also opt into `.withActorId(true)`. The CLI validates this.
- Generated insert helpers already understand implicit `_id` and timestamp fields, so prefer them over hand-rolling inserts on day one.

## Minimal Checklist

1. Add `@worldbreakstudios/sink-lib`, `@tanstack/db`, and `@tanstack/react-db`.
2. Add `sinkVite()` to `vite.config.ts`.
3. Create `src/**/*.schema.ts`.
4. Run `sink generate --cwd .`.
5. Wire the browser database with `createSharedOpfsDatabase()` so you get offline persistence and cross-tab coordination.
6. Create a backend server with `ServerSqliteDatabase`, `createAllTables(database)`, and `createGeneratedSyncServerRuntime(...)`.
7. Point the client at that server and use a sync-aware workspace built with `createGeneratedBrowserWorkspace(...)`.
8. Use the generated CRUD helpers, collections, and sync contract as your schema evolves over time.

That is the recommended path from zero to a real Sink-backed app, and it matches the direction the sandbox is exercising.
