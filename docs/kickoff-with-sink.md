# Kick Off A New Project With Sink

This guide is intentionally opinionated.

For a brand-new Sink app, the default should be the full local-first stack on day one, not a stripped-down "we added sync later" setup. The reason to adopt Sink early is that it gives you the whole runtime that makes a modern app feel instant and resilient:

- browser-local SQLite
- OPFS persistence when the browser supports it
- fallback local persistence when OPFS is unavailable
- generated typed collections, queries, mutations, and schema metadata
- optimistic local writes
- offline mutation queueing and replay
- websocket-driven invalidation and refresh
- a server runtime backed by SQLite
- row locking for collaborative mutation flows

That is the product. Sink is not just "sync." It is the local-first data foundation that keeps you from building your own local database layer, offline queue, replay logic, invalidation channel, and reconciliation model.

The examples in this guide mirror the direction of the sandbox in this repo, but the structure below is more aggressive about recommending the full setup from the start.

If you are starting a fresh app, prefer TanStack Start on top of Vite. If you already have another Vite-compatible app shape, the same Sink architecture still applies.

## What A Kickstarted Sink App Should Include

Bake these in up front:

- `sinkVite()` in `vite.config.ts`
- app tables in `src/**/*.schema.ts`
- generated runtime files under `src/data/generated/`
- a browser workspace created with `createGeneratedBrowserWorkspace(...)`
- `createSharedOpfsDatabase(...)` with a local fallback such as `localStorage`
- a real sync server created with `createGeneratedSyncServerRuntime(...)`
- auth context wired into the sync server from the beginning
- websocket and query paths wired in dev and production
- local-first queries modeled around `readLocal`, `runServer`, and `mergeServer`

If you skip those pieces, you can still make Sink work. But that is not the recommended kickoff path.

## Architecture At A Glance

```text
browser app
  |
  |-- generated collections + queries + mutations
  |-- createGeneratedBrowserWorkspace(...)
  |-- createSharedOpfsDatabase(...)
  |-- optimistic local writes
  |-- offline queue + replay
  |-- watchQuery / refreshQuery
  |
  +--> local SQLite in OPFS
  |      |
  |      +--> shared across tabs with built-in coordination
  |      +--> falls back to localStorage when OPFS is unavailable
  |
  +--> POST /api/query
  |
  +--> WS /ws/transactions
           |
           v
sync server
  |
  |-- createGeneratedSyncServerRuntime(...)
  |-- getAuthContext(request)
  |-- generated query + mutation registry
  |-- invalidation broadcast
  |-- row locks + transaction state
  |
  +--> server SQLite database
```

That architecture is why Sink is compelling. Realtime matters more when it sits on top of a real local database. Offline matters more when the app can queue writes and replay them later. Generated operations matter more when the same schema drives both the browser and server runtime.

## Recommended Project Shape

```text
my-app/
  src/
    data/
      auth.ts
      projects.schema.ts
      tasks.schema.ts
      projects.policy.ts
      projects.queries.ts
      generated/
    lib/
      sink.ts
    routes/
  sync-server.ts
  vite.config.ts
  package.json
```

The important mindset is that your Sink schema and query definitions are app architecture, not hidden config.

## 1. Scaffold And Install

For a new app, TanStack Start is the best default because it fits naturally with Vite, TanStack Router, and TanStack DB.

Example scaffold flow:

```sh
bun create @tanstack/start@latest
cd my-app
```

Install Sink and the TanStack DB packages your browser app will use:

```sh
bun add @worldbreakstudios/sink-lib @tanstack/db @tanstack/react-db
bun add -d @worldbreakstudios/sink-cli vite
```

If you are developing against a sibling `sink/` checkout instead of a published package, keep the CLI and runtime on the same Sink version.

Add these scripts to `package.json`:

```json
{
  "scripts": {
    "sink:generate": "sink generate --cwd .",
    "sink:watch": "sink generate --cwd . --watch",
    "sync:server": "bun run ./sync-server.ts"
  }
}
```

The generator watches more than schema files. As your app grows, it will also pick up changes under `src/` for:

- `*.schema.ts`
- `*.policy.ts`
- `*.queries.ts`
- `*.mutations.ts`

## 2. Wire Vite For The Real Browser Runtime

Start with `sinkVite()`. This is the baseline Vite integration for Sink's browser SQLite runtime.

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { sinkVite } from '@worldbreakstudios/sink-lib/vite'

export default defineConfig({
  plugins: [sinkVite(), react()],
  server: {
    proxy: {
      '/api/query': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
      '/ws/transactions': {
        target: 'http://127.0.0.1:3001',
        ws: true,
      },
    },
  },
})
```

Why this matters:

- `sinkVite()` adds the COOP/COEP dev and preview headers Sink needs for shared OPFS mode
- it configures Vite's worker handling for the browser SQLite runtime
- the dev proxy keeps your query endpoint and websocket endpoint on the same origin as the app, which is especially useful once auth cookies are involved

If you are iterating against a local Sink checkout, use:

```ts
sinkVite({ localSourceRoot: '../sink' })
```

### Browser SQLite Assets

The SQLite runtime assets are part of the setup contract. They are not optional implementation detail.

For the default Vite + packaged Sink runtime path, you should not need an app-local `public/vendor` copy step. Sink resolves its packaged runtime assets automatically.

If your deployment serves those assets from a custom location, set `sqliteRuntime.assetBaseUrl` to the directory that contains:

- `sqlite3.wasm`
- `sqlite3-worker1.mjs`
- `sqlite3-opfs-async-proxy.js`

Example override:

```ts
const { database } = await createSharedOpfsDatabase({
  filename: 'my-app.db',
  fallbackPersistence: 'localStorage',
  sqliteRuntime: {
    assetBaseUrl: '/vendor/sink-sqlite/',
  },
})
```

Production still needs matching `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers if you want shared OPFS mode outside local dev.

## 3. Define Schemas Early

Define Sink tables under `src/`. These files are the source of truth for the generated runtime.

```ts
// src/data/projects.schema.ts
import { defineTable, v } from '@worldbreakstudios/sink-lib'

export default defineTable('projects', {
  owner_id: v.string(),
  name: v.string(),
  status: v.default(v.string(), 'active'),
  notes: v.nullable(v.string()),
})
  .withCreatedAt(true)
  .index('by_owner_id', ['owner_id'])
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

Important conventions:

- do not declare `_id` yourself; Sink adds it implicitly
- `.withCreatedAt(true)` adds the `_createdAt` column for you
- `actors` is auto-added by the CLI if you do not define it
- use `.withActorId(true)` when rows should be actor-scoped
- use `.withActorId(true, { pk: true })` when `_actor` is part of the primary key

Treat schema design as part of the product architecture. It shapes the local database, the generated collections, the generated queries and mutations, and the server contract.

## 4. Generate The Runtime

Run:

```sh
bun run sink:generate
```

You should expect generated output like:

- `src/data/generated/schema.gen.ts`
- `src/data/generated/operations.gen.ts`

What those generated files give you:

- typed table metadata
- `createAllTables(...)`
- `createCollections(...)`
- generated CRUD helpers
- generated list and get queries
- generated insert, update, delete, and upsert mutations
- `SYNC_METADATA`
- `createGeneratedSyncClient(...)`
- `createGeneratedSyncServerRuntime(...)`

Do not hand-edit anything under `src/data/generated/`.

## 5. Create The Browser Workspace

This is the real browser bootstrap for Sink. Do not stop at "I can open a SQLite database." Go straight to the full sync-aware workspace.

```ts
// src/lib/sink.ts
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

function resolveSinkServerBaseUrl(): string {
  return import.meta.env.VITE_SINK_SERVER_URL?.trim() || window.location.origin
}

function resolveSinkWebSocketUrl(serverBaseUrl: string): string {
  const url = new URL(serverBaseUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = '/ws/transactions'
  url.search = ''
  url.hash = ''
  return url.toString()
}

export async function createSinkWorkspace() {
  const serverBaseUrl = resolveSinkServerBaseUrl()

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
      createBatchTransaction: createSyncBatchTransaction,
      serverBaseUrl: syncServerBaseUrl,
      websocketUrl,
    }) =>
      createGeneratedSyncClient({
        database,
        collections,
        createBatchTransaction: createSyncBatchTransaction,
        serverBaseUrl: syncServerBaseUrl,
        websocketUrl,
      }),
    queries: generatedQueries,
    mutations: generatedMutations,
    serverBaseUrl,
    websocketUrl: resolveSinkWebSocketUrl(serverBaseUrl),
  })
}
```

This is the setup worth recommending by default because it gives you:

- browser-local SQLite
- OPFS persistence when available
- automatic fallback persistence when OPFS is unavailable
- built-in cross-tab coordination for the shared local database
- a started sync client
- generated query and mutation wiring
- websocket connectivity
- offline queue tables and transaction state tables on the client

`createGeneratedBrowserWorkspace(...)` also starts watching the generated `table.list` queries so your local collections stay in sync with invalidations from the server.

### Prewarm The Workspace

If Sink is central to the app, prewarm it during client bootstrap instead of waiting for the first screen that happens to need data.

For example, create the workspace at app startup in your root route or client entry so the database, worker runtime, and sync client come up early.

Two values are especially useful to surface in development:

- `workspace.persistenceType` tells you whether you are on `opfs`, `localStorage`, or memory
- `workspace.syncClient.getSnapshot()` tells you whether the websocket is connected and whether the offline queue is growing

## 6. Create The Sync Server And Wire Auth

`sink generate` does not create a runnable sync server file for you. You still write that entrypoint yourself, and you should wire auth into it on day one.

```ts
// src/data/auth.ts
export interface AppAuthContext {
  userId: string | null
}
```

```ts
// sync-server.ts
import type { IncomingMessage } from 'node:http'
import { ServerSqliteDatabase } from '@worldbreakstudios/sink-lib/server'
import { createAllTables } from './src/data/generated/schema.gen.ts'
import { createGeneratedSyncServerRuntime } from './src/data/generated/operations.gen.ts'
import type { AppAuthContext } from './src/data/auth.ts'

const port = Number.parseInt(process.env.PORT ?? '3001', 10)
const hostname = process.env.HOST ?? '127.0.0.1'
const websocketPath = process.env.SINK_TX_PATH ?? '/ws/transactions'
const databasePath =
  process.env.SINK_SERVER_DB_PATH ??
  new URL('./sync.db', import.meta.url).pathname

function getAuthContext(request: IncomingMessage): AppAuthContext {
  const header = request.headers['x-demo-user-id']
  return {
    userId: typeof header === 'string' ? header : null,
  }
}

const database = new ServerSqliteDatabase(databasePath)
await createAllTables(database)

const server = await createGeneratedSyncServerRuntime<AppAuthContext>({
  database,
  port,
  hostname,
  websocketPath,
  getAuthContext,
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

That gives you:

- a real server SQLite database on disk
- generated HTTP query handling
- generated websocket transaction handling
- Sink's internal server state tables
- auth context on both query and mutation execution paths

Run it with:

```sh
bun run sync:server
curl http://127.0.0.1:3001/health
```

You should get:

```json
{ "ok": true }
```

### Add Table Policies

Once the server has auth context, put authorization and read scoping into table policies instead of scattering that logic across ad hoc server endpoints.

```ts
// src/data/projects.policy.ts
import { defineTablePolicies } from '@worldbreakstudios/sink-lib'
import type { AppAuthContext } from './auth'

export default defineTablePolicies<AppAuthContext>('projects', {
  authorize({ auth }) {
    return Boolean(auth.userId)
  },
  readScope({ auth }) {
    if (!auth.userId) {
      return [{ column: 'owner_id', equals: '__no-access__' }]
    }

    return [{ column: 'owner_id', equals: auth.userId }]
  },
})
```

This is the better mental model:

- `getAuthContext(...)` turns a request into app auth state
- policies decide what that auth state is allowed to read or mutate
- generated queries and mutations call into those policies automatically

## 7. Model Local-First Queries On Purpose

One of Sink's strongest ideas is the `readLocal` -> `runServer` -> `mergeServer` query shape.

That pattern is how you get all of these at once:

- instant local reads
- server-backed refresh
- safe merge back into the local database
- websocket-triggered revalidation

The generated `table.list`, `table.get`, and indexed query helpers already follow this model. As your app grows, custom app queries should follow it too.

Example:

```ts
// src/data/projects.queries.ts
import {
  defineQuery,
  invalidationTouchesTable,
  readLocalRowsForTable,
  reconcileScopedRows,
  rowMatchesWhere,
} from '@worldbreakstudios/sink-lib'
import { SYNC_METADATA } from './generated/operations.gen'
import type { ProjectRow, SchemaCollections } from './generated/schema.gen'

export interface ProjectsForOwnerArgs {
  ownerId: string
}

export const projectsForOwnerQuery = defineQuery<
  ProjectsForOwnerArgs,
  ProjectRow[],
  SchemaCollections
>({
  kind: 'query',
  name: 'projects.listForOwner',
  tables: ['projects'],
  async readLocal(context, args) {
    return readLocalRowsForTable<ProjectRow>(context.collections, 'projects').filter(
      (row) => row.owner_id === args.ownerId,
    )
  },
  async runServer(context, args) {
    return await context.adapter.listRows('projects', {
      where: [{ column: 'owner_id', equals: args.ownerId }],
      orderBy: [{ column: '_createdAt', direction: 'desc' }],
    }) as ProjectRow[]
  },
  async mergeServer(context, args, result) {
    await reconcileScopedRows(context, SYNC_METADATA, 'projects', result, (row) =>
      rowMatchesWhere(row, [{ column: 'owner_id', equals: args.ownerId }]),
    )
  },
  matchesInvalidation(_args, targets) {
    return invalidationTouchesTable(targets, 'projects')
  },
})
```

When you want the client to keep a custom query warm, subscribe to it explicitly:

```ts
const stopWatching = workspace.syncClient.watchQuery(projectsForOwnerQuery, {
  ownerId: currentUserId,
})

await workspace.syncClient.refreshQuery(projectsForOwnerQuery, {
  ownerId: currentUserId,
})
```

This is the point where Sink stops feeling like a transport library and starts feeling like a local-first app model.

## 8. What Happens Offline, Over WebSockets, And Across Tabs

These behaviors should be treated as product features, not hidden implementation details.

### Offline Writes

When the websocket is unavailable, Sink can still apply the local mutation result immediately, commit it to the local database, and enqueue the mutation for later replay.

That means your app can keep moving even when the network is flaky or the browser is temporarily offline.

### Replay And Conflict Handling

When connectivity returns, the sync client reconnects, refreshes subscribed queries, and replays the offline queue.

If the server result conflicts with the local optimistic result, the client tracks that conflict in its local queue state so your app can surface a resolution flow.

### WebSocket Invalidations

The websocket path is not optional if you want the full Sink experience. It is what lets the server broadcast row invalidations so watched queries refresh without polling.

### Cross-Tab Local Database Coordination

In shared OPFS mode, Sink coordinates one active owner tab for the local SQLite file and forwards requests from the other open tabs. You get one logical local database for the app without having to build your own cross-tab database manager.

## 9. Verify The Whole Story Early

Do not stop at "the page loaded." Verify the actual Sink value proposition.

Recommended day-one checks:

1. Start the app and the sync server.
2. Confirm `workspace.persistenceType` is `opfs` when your browser supports shared OPFS.
3. Open two tabs. Write in one tab and confirm the other refreshes.
4. Toggle browser offline in devtools. Perform a mutation and confirm the UI updates immediately.
5. Inspect `workspace.syncClient.getSnapshot()` and confirm the offline queue increased while offline.
6. Reconnect the browser and confirm the queued mutation replays.
7. Reload the app and confirm the local data is still there.

If you never test offline queueing, replay, websocket invalidation, and reload persistence, you have not really validated the Sink integration yet.

## 10. Production Notes

### Persistence And Topology

For a kickoff project, keep the deployment story simple:

- the browser keeps its local SQLite database in OPFS when possible
- the sync server keeps its SQLite database on disk wherever `SINK_SERVER_DB_PATH` points
- start with one sync server process per SQLite file unless you have a deliberate reason to design a more complex topology

That is the easiest way to understand the system before you optimize deployment shape.

### Auth And Network Paths

Make these decisions explicit:

- where auth is resolved from on the sync server
- whether the browser talks to the sync server on the same origin or a separate origin
- how `/api/query` and `/ws/transactions` are routed in production

If your auth relies on cookies or same-origin session middleware, proxying those paths through the app origin is usually the cleanest default in development.

### Browser Runtime Assets

If you serve SQLite worker assets from a custom location in production, set `sqliteRuntime.assetBaseUrl` and verify the browser can fetch:

- `sqlite3.wasm`
- `sqlite3-worker1.mjs`
- `sqlite3-opfs-async-proxy.js`

### Custom Server Adapters

Many real apps eventually need a small adapter layer for SQLite serialization details such as booleans or JSON-shaped values. Start with the generated SQLite adapter, but treat a custom adapter as a normal extension point rather than a strange edge case.

## 11. Debugging Checklist

When Sink looks broken, these are the first things to check:

- generated files are stale; rerun `bun run sink:generate`
- the app defines a schema, policy, query, or mutation file outside `src/`
- `/api/query` works but `/ws/transactions` is missing or not proxied with `ws: true`
- the browser fell back from OPFS because COOP/COEP, `SharedWorker`, or OPFS support is missing
- the SQLite runtime assets are being served from the wrong path
- `getAuthContext(...)` is returning the wrong user or no user
- a table policy is correctly denying access, but it looks like "sync is broken"
- the server has fresh rows, but your query's `matchesInvalidation(...)` logic is too broad or too narrow
- the local queue contains pending or conflict rows in `_sink_offline_mutation_queue`
- the client still has open transaction state in `_sink_active_ws_transactions`
- the server lock tables `_sink_server_transactions` or `_sink_server_locks` show rows that explain a blocked mutation

Helpful runtime signals:

- `workspace.persistenceType`
- `workspace.syncClient.getSnapshot()`
- `getSharedOpfsSupportStatus()`

## Kickoff Checklist

If you want the shortest "did we actually set this up the right way?" list, use this:

1. Add `sinkVite()` to `vite.config.ts`.
2. Proxy both `/api/query` and `/ws/transactions` in development.
3. Define `src/**/*.schema.ts`.
4. Run `sink generate`.
5. Use `createGeneratedBrowserWorkspace(...)`, not just a hand-rolled local SQLite helper.
6. Use `createSharedOpfsDatabase(...)` with a fallback such as `localStorage`.
7. Create a real `sync-server.ts`.
8. Pass `getAuthContext(...)` into `createGeneratedSyncServerRuntime(...)`.
9. Add `*.policy.ts` files for read scoping and authorization.
10. Verify offline queueing, replay, reload persistence, and cross-tab refresh.

That is the recommended day-one Sink setup.

## Useful Reference Points In This Repo

If you want to compare the guide against working code in this repo, start here:

- `apps/sandbox/vite.config.ts`
- `apps/sandbox/sync-server.ts`
- `apps/sandbox/src/lib/sqlite-demo-collections.ts`
- `packages/lib/src/generated-browser-workspace.ts`
- `packages/lib/src/sync-runtime-client.ts`
- `packages/lib/src/shared-opfs-database.ts`

Those files are the fastest way to connect the kickoff guidance to the actual runtime shape.
