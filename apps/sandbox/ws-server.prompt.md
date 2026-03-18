can you help me rewrite the generated server a bit. i don't love it. its too tightly coupled to sqlite and ideally I could swap whatever BE database I wanted in. For now can you delete all the server generation could and help me manually write some server code that I can use for a template of what I want. I imagine I might want to do something like define a `*.mutations.ts` and `*.queries.ts` file like I've pencilled into the objects folder in the sandbox data. these files control the mutations and queries that I'm going to generate -- they will let me add in access controls and give me typesafe helpers based on the schema of the table -- and they will let me add in any other server checks or logic i care about. then those queries and mutations will be used to generate both the server and the client code that will be used so that the logic is consistent on both sides of the stack. for mutations the client will publish an "open transaction" message on the websocket (and locally in the local sqlite table); it will then try to apply the update both locally and server-side. the server side mutation will happen by sending a websocket with the parameters needed for the function and then the server will apply. after that the client will send a commit message on the socket. when the server acks the message the client will close it's transaction and commit as well, likewise, if the server sends back that the transaction failed on the server, the client can abort the transaction. we should make sure that the rows that are being updated are locked by the primary keys being used for the update (either the ids, or the composite keys, or a unique key on the table) so that multiple clients cant start a transaction for the same rows. if there are conflicts, then when the second client tries to open the commit, the socket will return a signal that the transaction cannot be opened so that it knows to try again later after the first transaction has committed. hopefully by narrowing down to locking on explicit keys it will limit the overlap and conflicts. when the transaction commits, it should also send a signal over websocket to all the other clients with the keys of the updated rows so they can re-poll the server to get the most updated data for the tables they are looking at. all client queries should first return the local data while the server request is being run, and then once the server data streams in it should refresh to show the updated data. finally, I want the ability for apps to go completely offline and still work if desired. in these cases, the app should build up a queue of their mutations. the queue should have the mutations run as well as the results they got locally. when they log back online, it should start each mutation in a trasnaction, apply it, and then see if the result matches the local result - if the result matches, it should commit and move on to sync the next mutation in the queue (and pop the message that succeeded) on the otherhand if the result doesn't match, the server should abort the transaction and halt resyncing the queue. it should present the difference to the user and they can choose to either overwrite the server and pop the message when the transaction commits, or they can choose to load the most recent data from the server and overwrite the local version. then it should pop and continue moving through the queue. this design should hopefully allow a local first experience while providing realtime sync capabilities that are collaborative and let users experience multiplayer apps

for clariy, the queue should only be used when the client doesn't have an active WS connection with the server. I think you understand that but I just to be extra explicit. that will make it where when the users are online transactions are the way we avoid conflicts and then the only time the user needs to figure out conflict resolution is when they come back from being offline and they have pending updates to apply

As mentioned above, scrap the current implementation that is being codegenned, and write a prototype implemention of what this pattern would look like for the objects table and some of the other tables in the sandbox. once I feel good about the prototype we should then later implement codegen to make it where I can programattically generate the server and client code

---

PLAN

# Manual Query/Mutation Prototype with Online Transactions and Offline Replay

## Summary

- Remove the generated server path from the sandbox flow and replace it with a hand-written prototype built around shared `*.queries.ts` and `*.mutations.ts` definitions.
- Keep `schema.gen.ts` for client row/key/types and collection setup, but stop using `schema.server.gen.ts`, `--server-out`, and the generated websocket sync contract.
- Prototype the full flow for `objects`, `fields`, and `objectTypes`.
- Use named mutation RPCs, HTTP queries, websocket transaction control, DB-backed row/unique-key locks, and invalidation-driven repolls.
- The offline queue is used only when there is no active websocket connection. When the websocket is healthy, mutations always use the live transaction path and conflict avoidance happens through locks, not queue replay.

## Key Changes

- Delete the current server codegen path and remove the sandbox’s dependency on generated server artifacts.
- Replace sandbox sync wiring with a manual registry of shared query and mutation definitions.
- Keep per-table authoring files as the main template:
  - `objects/objects.queries.ts`, `objects/objects.mutations.ts`
  - add manual query/mutation files for `fields` and `objectTypes`
- Define shared hand-written definition shapes:
  - `QueryDefinition<TArgs, TResult>` with `name`, typed args, `readLocal`, `runServer`, `mergeServer`
  - `MutationDefinition<TArgs, TLocalResult, TServerResult>` with `name`, typed args, `lockTargets`, `applyLocal`, `runServer`, `resultsEqual`, `invalidate`
- Keep these definitions backend-agnostic by passing a `RepositoryContext` and `LockStore` interface into server execution rather than raw SQLite APIs.
- Add a SQLite-backed repository and a DB-backed lock store only as the sandbox implementation, not as the abstraction itself.
- Introduce two distinct local persistence layers:
  - `active_ws_transactions` for online in-flight transaction recovery only
  - `offline_mutation_queue` for mutations created while no websocket connection is active
- Do not use the old row-diff websocket sync path for this prototype. The new contract is named queries/mutations plus invalidation events.

## Online and Offline Mutation Flow

- Online mode:
  - If the websocket is connected, a mutation never enters the offline queue.
  - Client sends `txn_open` with mutation name, args, and computed lock targets.
  - Server acquires locks by PK, composite key, or declared unique key and returns `txn_opened` or `txn_open_denied`.
  - After `txn_opened`, client applies the mutation locally and records the in-flight transaction in `active_ws_transactions`.
  - Client sends `txn_commit` with mutation name, args, and the locally produced result.
  - Server runs the mutation, compares `serverResult` to `localResult`, and responds with either `txn_committed` or `txn_conflict`.
  - On `txn_committed`, client finalizes the local transaction, clears the in-flight record, and peers receive invalidation events with affected tables and keys.
  - On `txn_conflict`, server aborts, releases locks, client rolls back or corrects local state using the returned authoritative payload, and no offline queue item is created.
- Disconnect handling for online transactions:
  - If the socket drops before `txn_opened`, the mutation is treated as not started server-side.
  - If the socket drops after `txn_opened` but before `txn_committed` or `txn_conflict`, the client keeps the entry in `active_ws_transactions` and does not move it into the offline queue.
  - On reconnect, client sends `txn_status` for each uncertain transaction token and resolves it before allowing new conflicting mutations.
- Offline mode:
  - If there is no active websocket connection when the user mutates, client applies locally and appends the mutation to `offline_mutation_queue`.
  - Replay is strictly serial once the websocket reconnects.
  - For each queued item, client uses the same `txn_open` and `txn_commit` flow and compares `serverResult` to the stored `localResult`.
  - If results match, commit and pop the queue item.
  - If results differ, abort, stop replay, and surface a conflict UI with two actions:
    - `overwriteServer`
    - `acceptServer`
  - After resolution, pop the item and continue replay.

## Queries and Invalidation

- Use HTTP JSON endpoints for queries in the prototype, not websocket queries.
- Query definitions return local SQLite data first through `readLocal`, then fetch fresh server data in the background.
- `mergeServer` writes server results into local SQLite only for rows not touched by pending offline queue items or active in-flight websocket transactions.
- The server broadcasts `rows_invalidated` messages after committed mutations with affected tables and keys.
- Clients receiving invalidations repoll the corresponding HTTP queries and refresh local state.

## Public Interfaces

- Shared prototype interfaces:
  - `QueryDefinition`
  - `MutationDefinition`
  - `RepositoryContext`
  - `LockStore`
- Websocket messages:
  - `txn_open`
  - `txn_opened`
  - `txn_open_denied`
  - `txn_commit`
  - `txn_committed`
  - `txn_conflict`
  - `txn_abort`
  - `txn_status`
  - `txn_status_result`
  - `rows_invalidated`

## Test Plan

- Online mutation succeeds end to end without touching `offline_mutation_queue`.
- Second client is denied `txn_open` when targeting the same locked PK/composite/unique key.
- `fields.upsertByObjectFieldType` locks the unique index key correctly.
- Socket drop during an online transaction creates an uncertain in-flight record and resolves it via `txn_status` after reconnect.
- Offline mutation appends to the queue only when no websocket is active.
- Replay drains matching mutations in order and stops on the first mismatch.
- `overwriteServer` and `acceptServer` both resolve conflicts and resume replay.
- Query refresh repolls on invalidation and skips rows touched by pending local work.
- `objects`, `fields`, and `objectTypes` remain consistent across local SQLite, server repository state, and invalidation-driven refresh.

## Assumptions and Defaults

- Keep `schema.gen.ts` and existing client collection generation for now.
- Remove generated server/sync usage from the sandbox and from CLI-supported workflow.
- Use HTTP for queries and websocket only for transaction control and invalidations.
- Use DB-backed locks with lease expiry and release on commit, abort, disconnect recovery, or timeout.
- Online transactions are the only conflict-avoidance path while connected; user-facing conflict resolution is reserved for offline replay mismatches.
