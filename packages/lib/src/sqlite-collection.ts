import {
  and,
  createCollection,
  createTransaction,
  eq,
  gt,
  gte,
  isNull,
  isUndefined,
  like as tanstackLike,
  lt,
  lte,
  not,
  or,
  type Collection,
  type InitialQueryBuilder,
  type PendingMutation,
  type QueryBuilder,
  type SyncConfig,
  type Transaction,
  type TransactionConfig,
} from "@tanstack/db";
import type { SqlValue } from "@sqlite.org/sqlite-wasm";
import type { LocalOnlyCollectionUtils } from "@tanstack/db";
import type { SqliteMutationOrigin } from "./sqlite-sync-core";
import type {
  AsyncSqliteDatabase,
  SqliteCompositeKey,
  SqliteKey,
} from "./sqlite";

export interface CreateSqliteCollectionOptions<
  TRow extends object,
  TKey,
  TIndexes extends SqliteIndexMap = Record<string, never>,
> {
  id: string;
  tableName: string;
  keyColumns: ReadonlyArray<keyof TRow & string>;
  getKey: (row: TRow) => TKey;
  serializeKey: (key: TKey) => string | number;
  deserializeKey: (key: string | number) => TKey;
  database: AsyncSqliteDatabase;
  referenceColumns?: Partial<
    Record<keyof TRow & string, SqliteReferenceColumn>
  >;
  indexes?: TIndexes;
}

export interface SqliteReferenceColumn {
  referencedTable: string;
  enforceExists: boolean;
  keyColumns: readonly string[];
  actorScoped: boolean;
}

export interface SqliteIndexDefinition<
  TFields extends readonly string[] = readonly string[],
> {
  fields: TFields;
  unique: boolean;
}

export type SqliteIndexMap = Record<
  string,
  SqliteIndexDefinition<readonly string[]>
>;

export interface SqliteCollectionUtils<
  TRow extends object,
> extends LocalOnlyCollectionUtils {
  readAll(): Promise<TRow[]>;
  persistMutations(transaction: {
    mutations: Array<PendingMutation<any>>;
  }): Promise<void>;
  createSqliteTransaction(
    config?: Omit<TransactionConfig<TRow>, "mutationFn">,
  ): Transaction<TRow>;
  dispose(): void;
}

export type SqliteCollection<
  TRow extends object,
  TKey,
  TIndexes extends SqliteIndexMap = Record<string, never>,
> = Omit<
  Collection<TRow, string | number, SqliteCollectionUtils<TRow>>,
  "update" | "delete"
> & {
  update(key: TKey, updater: (draft: TRow) => void): void;
  delete(key: TKey): void;
  query(): SqliteQueryInitializer<TRow, TIndexes>;
};

export type SqliteRowKey = SqliteKey;

type ChannelEventListener<TEvent> = (event: TEvent) => void;

export interface ChannelEventBus<TEvent> {
  publish(channel: string, event: TEvent): void;
  subscribe(
    channel: string,
    listener: ChannelEventListener<TEvent>,
  ): () => void;
}

export interface SqliteMutationChange {
  before: unknown;
  after: unknown;
}

export interface SqliteMutationRowDiff {
  key: SqliteRowKey | null;
  changeType: "inserted" | "updated" | "deleted" | "unchanged";
  changes: Record<string, SqliteMutationChange>;
  beforeRow: Record<string, unknown> | null;
  afterRow: Record<string, unknown> | null;
}

export interface SqliteMutationEvent {
  eventId: string;
  origin: SqliteMutationOrigin;
  tableName: string;
  sourceInstanceId: string;
  mutationType: PendingMutation<Record<string, unknown>>["type"];
  keyColumns: readonly string[];
  rowDiffs: SqliteMutationRowDiff[];
  publishedAt: number;
  serverSequence: number | null;
}

export interface SqliteLiveQueryOptions {
  limit?: number;
  single?: boolean;
}

function createChannelEventBus<TEvent>(): ChannelEventBus<TEvent> {
  const listenersByChannel = new Map<
    string,
    Set<ChannelEventListener<TEvent>>
  >();

  return {
    publish(channel, event) {
      const listeners = listenersByChannel.get(channel);

      if (!listeners) {
        return;
      }

      for (const listener of Array.from(listeners)) {
        try {
          listener(event);
        } catch (error) {
          console.error("Failed to handle event bus message.", error);
        }
      }
    },
    subscribe(channel, listener) {
      const listeners = listenersByChannel.get(channel) ?? new Set();
      listeners.add(listener);
      listenersByChannel.set(channel, listeners);

      return () => {
        const currentListeners = listenersByChannel.get(channel);

        if (!currentListeners) {
          return;
        }

        currentListeners.delete(listener);

        if (currentListeners.size === 0) {
          listenersByChannel.delete(channel);
        }
      };
    },
  };
}

export const sqliteMutationEventBus =
  createChannelEventBus<SqliteMutationEvent>();

export function getSqliteMutationChannel(tableName: string): string {
  return tableName;
}

export function subscribeToSqliteMutationEvents(
  tableName: string,
  listener: ChannelEventListener<SqliteMutationEvent>,
): () => void {
  return sqliteMutationEventBus.subscribe(
    getSqliteMutationChannel(tableName),
    listener,
  );
}

type Head<TFields extends readonly string[]> = TFields extends readonly [
  infer THead extends string,
  ...(readonly string[]),
]
  ? THead
  : never;

type Tail<TFields extends readonly string[]> = TFields extends readonly [
  string,
  ...infer TRest extends readonly string[],
]
  ? TRest
  : [];

type IndexFieldValue<TRow, TField extends string> = TField extends keyof TRow
  ? TRow[TField]
  : unknown;

export interface SqliteIndexRangeBuilder<
  TRow extends object,
  TFields extends readonly string[],
> {
  eq<TField extends Head<TFields>>(
    field: TField,
    value: IndexFieldValue<TRow, TField>,
  ): SqliteIndexRangeBuilder<TRow, Tail<TFields>>;
  gt<TField extends Head<TFields>>(
    field: TField,
    value: IndexFieldValue<TRow, TField>,
  ): SqliteBoundIndexRangeBuilder<TRow, TField, false, true>;
  gte<TField extends Head<TFields>>(
    field: TField,
    value: IndexFieldValue<TRow, TField>,
  ): SqliteBoundIndexRangeBuilder<TRow, TField, false, true>;
  lt<TField extends Head<TFields>>(
    field: TField,
    value: IndexFieldValue<TRow, TField>,
  ): SqliteBoundIndexRangeBuilder<TRow, TField, true, false>;
  lte<TField extends Head<TFields>>(
    field: TField,
    value: IndexFieldValue<TRow, TField>,
  ): SqliteBoundIndexRangeBuilder<TRow, TField, true, false>;
  like<TField extends Head<TFields>>(
    field: TField,
    value: IndexFieldValue<TRow, TField>,
  ): SqliteIndexRangeBuilder<TRow, Tail<TFields>>;
  isKnown<TField extends Head<TFields>>(
    field: TField,
  ): SqliteIndexRangeBuilder<TRow, Tail<TFields>>;
  isUnknown<TField extends Head<TFields>>(
    field: TField,
  ): SqliteIndexRangeBuilder<TRow, Tail<TFields>>;
}

export interface SqliteBoundIndexRangeBuilder<
  TRow extends object,
  TField extends string,
  THasLower extends boolean,
  THasUpper extends boolean,
> {
  gt<TNextField extends THasLower extends true ? never : TField>(
    field: TNextField,
    value: IndexFieldValue<TRow, TNextField>,
  ): SqliteBoundIndexRangeBuilder<TRow, TField, true, THasUpper>;
  gte<TNextField extends THasLower extends true ? never : TField>(
    field: TNextField,
    value: IndexFieldValue<TRow, TNextField>,
  ): SqliteBoundIndexRangeBuilder<TRow, TField, true, THasUpper>;
  lt<TNextField extends THasUpper extends true ? never : TField>(
    field: TNextField,
    value: IndexFieldValue<TRow, TNextField>,
  ): SqliteBoundIndexRangeBuilder<TRow, TField, THasLower, true>;
  lte<TNextField extends THasUpper extends true ? never : TField>(
    field: TNextField,
    value: IndexFieldValue<TRow, TNextField>,
  ): SqliteBoundIndexRangeBuilder<TRow, TField, THasLower, true>;
  like<TNextField extends TField>(
    field: TNextField,
    value: IndexFieldValue<TRow, TNextField>,
  ): SqliteBoundIndexRangeBuilder<TRow, TField, THasLower, THasUpper>;
  isKnown<TNextField extends TField>(
    field: TNextField,
  ): SqliteBoundIndexRangeBuilder<TRow, TField, THasLower, THasUpper>;
  isUnknown<TNextField extends TField>(
    field: TNextField,
  ): SqliteBoundIndexRangeBuilder<TRow, TField, THasLower, THasUpper>;
}

/**
 * Fluent query builder for SQLite collections.
 *
 * Queries default to using the `by_id` index if no index is specified:
 * ```ts
 * collection.query().collect()           // All rows, ordered by primary key ASC
 * collection.query().order('desc').take(10)  // Last 10 by primary key
 * ```
 *
 * Use `.withIndex()` for queries on other indexes:
 * ```ts
 * collection.query().withIndex('by_email', q => q.eq('email', 'test@example.com')).first()
 * ```
 */
export interface SqliteQuery<
  TRow extends object,
  TIndexes extends SqliteIndexMap,
> {
  /**
   * Select an index to query. If not called, defaults to `by_id`.
   */
  withIndex<TIndexName extends keyof TIndexes & string>(
    indexName: TIndexName,
    build?:
      | ((
          builder: SqliteIndexRangeBuilder<
            TRow,
            TIndexes[TIndexName]["fields"]
          >,
        ) => unknown)
      | undefined,
  ): SqliteQuery<TRow, TIndexes>;

  /**
   * Set the sort direction. Defaults to 'asc'.
   */
  order(direction: "asc" | "desc"): SqliteQuery<TRow, TIndexes>;

  /**
   * Start the result window strictly after the provided index key.
   * For multi-field indexes, pass an object keyed by the indexed fields.
   */
  offset(cursor: unknown): SqliteQuery<TRow, TIndexes>;

  /**
   * Execute the query and return all matching rows after the offset key.
   */
  collect(): Promise<TRow[]>;

  /**
   * Execute the query and return the first matching row after the offset key,
   * or null.
   */
  first(): Promise<TRow | null>;

  /**
   * Execute the query and return the single matching row after the offset key.
   * Throws if more than one row matches.
   */
  unique(): Promise<TRow | null>;

  /**
   * Execute the query and return up to `limit` rows after the offset key.
   */
  take(limit: number): Promise<TRow[]>;

  /**
   * Build a TanStack DB query that can be passed to `useLiveQuery`.
   */
  toLiveQuery(
    query: InitialQueryBuilder,
    options?: SqliteLiveQueryOptions,
  ): QueryBuilder<any>;
}

// Keep old interface names as aliases for backwards compatibility
export type SqliteQueryInitializer<
  TRow extends object,
  TIndexes extends SqliteIndexMap,
> = SqliteQuery<TRow, TIndexes>;

export type SqliteIndexedQuery<TRow extends object> = SqliteQuery<
  TRow,
  Record<string, never>
>;

type StructuredColumnKind = "array" | "object" | "record";
type StructuredColumns = Partial<Record<string, StructuredColumnKind>>;

function getStructuredColumnKind(
  columnType: string,
): StructuredColumnKind | null {
  const normalizedType = columnType.toUpperCase();

  if (normalizedType.includes("JSON_ARRAY")) {
    return "array";
  }

  if (normalizedType.includes("JSON_OBJECT")) {
    return "object";
  }

  if (normalizedType.includes("JSON_RECORD")) {
    return "record";
  }

  return null;
}

function getStructuredColumns(
  columns: Array<{ name: string; type: string }>,
): StructuredColumns {
  const structuredColumns: StructuredColumns = {};

  for (const column of columns) {
    const kind = getStructuredColumnKind(column.type);

    if (kind !== null) {
      structuredColumns[column.name] = kind;
    }
  }

  return structuredColumns;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStructuredValue(
  kind: StructuredColumnKind,
  value: unknown,
): boolean {
  if (kind === "array") {
    return Array.isArray(value);
  }

  return isPlainObject(value);
}

function serializeStructuredValue(
  kind: StructuredColumnKind,
  value: unknown,
): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);

      if (isStructuredValue(kind, parsed)) {
        return value;
      }
    } catch {
      // Fall through and encode the raw string as JSON.
    }
  }

  return JSON.stringify(value);
}

function serializeColumnValue(
  columnName: string,
  value: unknown,
  structuredColumns: StructuredColumns,
): unknown {
  const kind = structuredColumns[columnName];

  if (!kind) {
    return value;
  }

  return serializeStructuredValue(kind, value);
}

function serializeRowValues(
  row: Record<string, unknown>,
  structuredColumns: StructuredColumns,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([columnName, value]) => [
      columnName,
      serializeColumnValue(columnName, value, structuredColumns),
    ]),
  );
}

function deserializeStructuredValue(
  kind: StructuredColumnKind,
  value: unknown,
): unknown {
  if (typeof value !== "string") {
    return value;
  }

  try {
    const parsed = JSON.parse(value);

    return isStructuredValue(kind, parsed) ? parsed : value;
  } catch {
    return value;
  }
}

function deserializeRowValues<TRow extends object>(
  row: Record<string, unknown>,
  structuredColumns: StructuredColumns,
): TRow {
  return Object.fromEntries(
    Object.entries(row).map(([columnName, value]) => {
      const kind = structuredColumns[columnName];

      if (!kind) {
        return [columnName, value];
      }

      return [columnName, deserializeStructuredValue(kind, value)];
    }),
  ) as TRow;
}

function normalizeRowKey(
  key: SqliteRowKey,
  keyColumns: readonly string[],
): SqliteRowKey {
  if (keyColumns.length === 1 && !isPlainObject(key)) {
    return key;
  }

  if (!isPlainObject(key)) {
    throw new Error(
      `Expected an object key with columns ${keyColumns.join(", ")}.`,
    );
  }

  const normalizedKey: SqliteCompositeKey = {};

  for (const columnName of keyColumns) {
    const value = key[columnName];

    if (value === undefined) {
      throw new Error(`Missing key column "${columnName}".`);
    }

    normalizedKey[columnName] = value as never;
  }

  return normalizedKey;
}

function getRowKeyFromRow(
  row: Record<string, unknown>,
  keyColumns: readonly string[],
): SqliteRowKey {
  if (keyColumns.length === 1) {
    const keyColumn = keyColumns[0];

    if (!keyColumn) {
      throw new Error("Missing key column.");
    }

    return row[keyColumn] as SqliteRowKey;
  }

  return Object.fromEntries(
    keyColumns.map((columnName) => [columnName, row[columnName]]),
  ) as SqliteCompositeKey;
}

function buildKeyPredicate(
  key: SqliteRowKey,
  keyColumns: readonly string[],
): { whereClause: string; bind: SqlValue[] } {
  const normalizedKey = normalizeRowKey(key, keyColumns);

  if (keyColumns.length === 1 && !isPlainObject(normalizedKey)) {
    const keyColumn = keyColumns[0];

    if (!keyColumn) {
      throw new Error("Missing key column.");
    }

    return {
      whereClause: `WHERE "${escapeIdentifier(keyColumn)}" = ?`,
      bind: [normalizedKey as SqlValue],
    };
  }

  return {
    whereClause: `WHERE ${keyColumns
      .map((columnName) => `"${escapeIdentifier(columnName)}" = ?`)
      .join(" AND ")}`,
    bind: keyColumns.map(
      (columnName) =>
        (normalizedKey as Record<string, unknown>)[columnName] as SqlValue,
    ),
  };
}

function buildOrderByClause(keyColumns: readonly string[]): string {
  return keyColumns
    .map((columnName) => `"${escapeIdentifier(columnName)}" ASC`)
    .join(", ");
}

type SqliteSyncMessage<TRow extends object> =
  | {
      type: "insert" | "update";
      key: string | number;
      value: TRow;
      previousValue?: TRow;
    }
  | {
      type: "delete";
      key: string | number;
    };

interface SqliteSyncController<TRow extends object> {
  sync: SyncConfig<TRow, string | number>;
  confirmMutations(mutations: Array<PendingMutation<TRow>>): void;
  applyMutationEvent(event: SqliteMutationEvent): void;
}

function createSqliteSyncController<TRow extends object, TKey>(params: {
  initialData: TRow[];
  getSerializedRowKey: (row: TRow) => string | number;
  serializeKey: (key: TKey) => string | number;
}): SqliteSyncController<TRow> {
  const syncedRows = new Map<string | number, TRow>(
    params.initialData.map((row) => [params.getSerializedRowKey(row), row]),
  );
  let syncBegin:
    | ((options?: { immediate?: boolean }) => void)
    | null = null;
  let syncWrite: ((message: SqliteSyncMessage<TRow>) => void) | null = null;
  let syncCommit: (() => void) | null = null;

  const writeMessages = (messages: SqliteSyncMessage<TRow>[]) => {
    if (!syncBegin || !syncWrite || !syncCommit || messages.length === 0) {
      return;
    }

    syncBegin();

    for (const message of messages) {
      syncWrite(message);
    }

    syncCommit();
  };

  return {
    sync: {
      rowUpdateMode: "full",
      sync: ({ begin, write, commit, markReady }) => {
        syncBegin = begin;
        syncWrite = write as (message: SqliteSyncMessage<TRow>) => void;
        syncCommit = commit;

        const initialMessages = Array.from(
          syncedRows.entries(),
          ([key, value]) =>
            ({
              type: "insert",
              key,
              value,
            }) as const,
        );

        writeMessages(initialMessages);
        markReady();

        return () => {
          syncBegin = null;
          syncWrite = null;
          syncCommit = null;
        };
      },
      getSyncMetadata: () => ({}),
    },
    confirmMutations(mutations) {
      const messages: SqliteSyncMessage<TRow>[] = [];

      for (const mutation of mutations) {
        const serializedKey = mutation.key as string | number;

        switch (mutation.type) {
          case "insert":
            syncedRows.set(serializedKey, mutation.modified);
            messages.push({
              type: "insert",
              key: serializedKey,
              value: mutation.modified,
            });
            break;
          case "update":
            syncedRows.set(serializedKey, mutation.modified);
            messages.push({
              type: "update",
              key: serializedKey,
              value: mutation.modified,
              previousValue: mutation.original as TRow,
            });
            break;
          case "delete":
            syncedRows.delete(serializedKey);
            messages.push({
              type: "delete",
              key: serializedKey,
            });
            break;
        }
      }

      writeMessages(messages);
    },
    applyMutationEvent(event) {
      const messages: SqliteSyncMessage<TRow>[] = [];

      for (const rowDiff of event.rowDiffs) {
        switch (rowDiff.changeType) {
          case "inserted": {
            if (!rowDiff.afterRow) {
              continue;
            }

            const nextRow = rowDiff.afterRow as TRow;
            const serializedKey = params.getSerializedRowKey(nextRow);
            syncedRows.set(serializedKey, nextRow);
            messages.push({
              type: "insert",
              key: serializedKey,
              value: nextRow,
            });
            break;
          }
          case "updated": {
            if (!rowDiff.afterRow) {
              continue;
            }

            const nextRow = rowDiff.afterRow as TRow;
            const serializedKey = params.getSerializedRowKey(nextRow);
            syncedRows.set(serializedKey, nextRow);
            messages.push({
              type: "update",
              key: serializedKey,
              value: nextRow,
              previousValue: rowDiff.beforeRow
                ? (rowDiff.beforeRow as TRow)
                : undefined,
            });
            break;
          }
          case "deleted": {
            const serializedKey =
              rowDiff.key === null
                ? null
                : params.serializeKey(rowDiff.key as TKey);

            if (serializedKey === null) {
              continue;
            }

            syncedRows.delete(serializedKey);
            messages.push({
              type: "delete",
              key: serializedKey,
            });
            break;
          }
          case "unchanged":
            break;
        }
      }

      writeMessages(messages);
    },
  };
}

export async function createSqliteCollection<
  TRow extends object,
  TKey,
  TIndexes extends SqliteIndexMap = Record<string, never>,
>(
  options: CreateSqliteCollectionOptions<TRow, TKey, TIndexes>,
): Promise<SqliteCollection<TRow, TKey, TIndexes>> {
  // Cache table columns for system fields (avoid repeated async calls)
  const tableColumns = await options.database.getTableColumns(
    options.tableName,
  );
  const columnNames = new Set(tableColumns.map((column) => column.name));
  const structuredColumns = getStructuredColumns(tableColumns);

  // Load initial data asynchronously in primary-key order.
  const initialData = await readAllRows<TRow>(
    options.database,
    options.tableName,
    structuredColumns,
    options.keyColumns,
  );
  const sourceInstanceId = crypto.randomUUID();
  let collection!: SqliteCollection<TRow, TKey, TIndexes>;
  let disposeMutationSubscription = () => {};
  let baseCollection!: Collection<
    TRow,
    string | number,
    SqliteCollectionUtils<TRow>
  >;

  const readAll = () =>
    readAllRows<TRow>(
      options.database,
      options.tableName,
      structuredColumns,
      options.keyColumns,
    );

  const syncController = createSqliteSyncController<TRow, TKey>({
    initialData,
    getSerializedRowKey: (row) => options.serializeKey(options.getKey(row)),
    serializeKey: options.serializeKey,
  });

  const acceptMutations: SqliteCollectionUtils<TRow>["acceptMutations"] = (
    transaction,
  ) => {
    const relevantMutations = transaction.mutations.filter(
      (mutation) => mutation.collection === baseCollection,
    ) as Array<PendingMutation<TRow>>;

    if (relevantMutations.length === 0) {
      return;
    }

    syncController.confirmMutations(relevantMutations);
  };

  const persistMutations = async (transaction: {
    mutations: Array<PendingMutation<any>>;
  }) => {
    const relevantMutations = transaction.mutations.filter(
      (mutation): mutation is PendingMutation<TRow> =>
        mutation.collection === baseCollection,
    );

    if (relevantMutations.length === 0) {
      return;
    }

    const mutationEvents = await persistSqliteMutations(
      options,
      relevantMutations,
      columnNames,
      structuredColumns,
      sourceInstanceId,
    );
    acceptMutations({
      mutations: relevantMutations as Array<
        PendingMutation<Record<string, unknown>>
      >,
    });

    for (const mutationEvent of mutationEvents) {
      logMutationDiff(mutationEvent);
    }
  };

  const createSqliteTransaction = (
    config?: Omit<TransactionConfig<TRow>, "mutationFn">,
  ) =>
    createTransaction<TRow>({
      ...config,
      mutationFn: async ({ transaction }) => {
        await persistMutations(transaction);
      },
    });

  baseCollection = createCollection({
    id: options.id,
    getKey: (row) => options.serializeKey(options.getKey(row)),
    sync: syncController.sync,
    startSync: true,
    gcTime: 0,
    onInsert: async ({ transaction }) => {
      await persistMutations(transaction);
    },
    onUpdate: async ({ transaction }) => {
      await persistMutations(transaction);
    },
    onDelete: async ({ transaction }) => {
      await persistMutations(transaction);
    },
    utils: {
      acceptMutations,
      readAll,
      persistMutations,
      createSqliteTransaction,
      dispose() {
        disposeMutationSubscription();
      },
    },
  });

  disposeMutationSubscription = subscribeToSqliteMutationEvents(
    options.tableName,
    (event) => {
      if (event.sourceInstanceId === sourceInstanceId) {
        return;
      }

      syncController.applyMutationEvent(event);
    },
  );

  collection = baseCollection as unknown as SqliteCollection<
    TRow,
    TKey,
    TIndexes
  >;
  const baseUpdate = baseCollection.update.bind(baseCollection) as (
    key: string | number,
    updater: (draft: TRow) => void,
  ) => void;
  const baseDelete = baseCollection.delete.bind(baseCollection) as (
    key: string | number,
  ) => void;

  collection.update = ((key, updater) =>
    baseUpdate(
      options.serializeKey(key),
      updater,
    )) as SqliteCollection<
    TRow,
    TKey,
    TIndexes
  >["update"];

  collection.delete = ((key) =>
    baseDelete(
      options.serializeKey(key),
    )) as SqliteCollection<
    TRow,
    TKey,
    TIndexes
  >["delete"];

  collection.query = () =>
    createSqliteQuery<TRow, TIndexes>(
      baseCollection,
      options.database,
      options.tableName,
      options.indexes ?? ({} as TIndexes),
      structuredColumns,
      options.keyColumns,
    );

  return collection;
}

async function readAllRows<TRow extends object>(
  database: AsyncSqliteDatabase,
  tableName: string,
  structuredColumns: StructuredColumns,
  keyColumns: readonly string[],
): Promise<TRow[]> {
  const rows = await database.query<Record<string, unknown>>(
    `SELECT * FROM "${escapeIdentifier(tableName)}" ORDER BY ${buildOrderByClause(keyColumns)};`,
  );

  return rows.map((row) => deserializeRowValues<TRow>(row, structuredColumns));
}

function getFieldPathRef(
  row: Record<string, unknown>,
  fieldPath: string,
): unknown {
  return fieldPath
    .split(".")
    .reduce<unknown>((value, segment) => (value as Record<string, unknown>)?.[
      segment
    ], row);
}

function combineLiveExpressions(expressions: unknown[]): unknown | null {
  if (expressions.length === 0) {
    return null;
  }

  if (expressions.length === 1) {
    return expressions[0] ?? null;
  }

  const [first, second, ...rest] = expressions;

  if (!first || !second) {
    return first ?? second ?? null;
  }

  return and(first as never, second as never, ...(rest as never[]));
}

function combineLiveOrExpressions(expressions: unknown[]): unknown | null {
  if (expressions.length === 0) {
    return null;
  }

  if (expressions.length === 1) {
    return expressions[0] ?? null;
  }

  const [first, second, ...rest] = expressions;

  if (!first || !second) {
    return first ?? second ?? null;
  }

  return or(first as never, second as never, ...(rest as never[]));
}

function buildLiveRangeExpression(
  row: Record<string, unknown>,
  range: SqliteQueryRangeState,
): unknown | null {
  const expressions: unknown[] = [];

  for (const equality of range.equals) {
    expressions.push(eq(getFieldPathRef(row, equality.field) as never, equality.value));
  }

  for (const likeMatch of range.likes) {
    expressions.push(
      tanstackLike(
        getFieldPathRef(row, likeMatch.field) as never,
        likeMatch.value as never,
      ),
    );
  }

  for (const nullCheck of range.nullChecks) {
    const fieldRef = getFieldPathRef(row, nullCheck.field) as never;
    const unknownValueExpression = or(
      isNull(fieldRef),
      isUndefined(fieldRef),
    );

    expressions.push(
      nullCheck.operator === "IS NULL"
        ? unknownValueExpression
        : not(unknownValueExpression),
    );
  }

  if (range.lowerBound) {
    const fieldRef = getFieldPathRef(row, range.lowerBound.field) as never;

    expressions.push(
      range.lowerBound.operator === ">"
        ? gt(fieldRef, range.lowerBound.value as never)
        : gte(fieldRef, range.lowerBound.value as never),
    );
  }

  if (range.upperBound) {
    const fieldRef = getFieldPathRef(row, range.upperBound.field) as never;

    expressions.push(
      range.upperBound.operator === "<"
        ? lt(fieldRef, range.upperBound.value as never)
        : lte(fieldRef, range.upperBound.value as never),
    );
  }

  return combineLiveExpressions(expressions);
}

function buildLiveCursorExpression(
  row: Record<string, unknown>,
  indexFields: readonly string[],
  cursorValues: Record<string, unknown> | null,
  direction: "asc" | "desc",
): unknown | null {
  if (!cursorValues || indexFields.length === 0) {
    return null;
  }

  const comparisonOperator = direction === "asc" ? gt : lt;
  const cursorBranches: unknown[] = [];

  for (let fieldIndex = 0; fieldIndex < indexFields.length; fieldIndex += 1) {
    const field = indexFields[fieldIndex];

    if (!field) {
      continue;
    }

    const branchExpressions: unknown[] = [];

    for (let prefixIndex = 0; prefixIndex < fieldIndex; prefixIndex += 1) {
      const prefixField = indexFields[prefixIndex];

      if (!prefixField) {
        continue;
      }

      branchExpressions.push(
        eq(
          getFieldPathRef(row, prefixField) as never,
          cursorValues[prefixField] as never,
        ),
      );
    }

    branchExpressions.push(
      comparisonOperator(
        getFieldPathRef(row, field) as never,
        cursorValues[field] as never,
      ),
    );

    cursorBranches.push(combineLiveExpressions(branchExpressions));
  }

  return combineLiveOrExpressions(cursorBranches);
}

function createTanStackLiveQuery<TRow extends object>(
  query: InitialQueryBuilder,
  sourceCollection: Collection<TRow, string | number, SqliteCollectionUtils<TRow>>,
  range: SqliteQueryRangeState,
  indexFields: readonly string[],
  cursorValues: Record<string, unknown> | null,
  direction: "asc" | "desc",
  options?: SqliteLiveQueryOptions,
): QueryBuilder<any> {
  let liveQuery = query.from({ row: sourceCollection });

  const liveLimit = options?.limit ?? (options?.single ? 1 : undefined);

  if (
    range.equals.length > 0 ||
    range.likes.length > 0 ||
    range.nullChecks.length > 0 ||
    range.lowerBound !== null ||
    range.upperBound !== null ||
    cursorValues !== null
  ) {
    liveQuery = liveQuery.where(({ row }) => {
      const expression = combineLiveExpressions([
        buildLiveRangeExpression(
          row as unknown as Record<string, unknown>,
          range,
        ),
        buildLiveCursorExpression(
          row as unknown as Record<string, unknown>,
          indexFields,
          cursorValues,
          direction,
        ),
      ]);

      if (!expression) {
        throw new Error("Expected a live query filter expression.");
      }

      return expression as never;
    }) as typeof liveQuery;
  }

  for (const field of indexFields) {
    liveQuery = liveQuery.orderBy(
      ({ row }) =>
        getFieldPathRef(row as unknown as Record<string, unknown>, field) as never,
      direction,
    ) as typeof liveQuery;
  }

  liveQuery = liveQuery.select(({ row }) => ({ ...row }) as never) as typeof liveQuery;

  if (liveLimit !== undefined) {
    liveQuery = liveQuery.limit(liveLimit) as typeof liveQuery;
  }

  if (options?.single) {
    return liveQuery.findOne();
  }

  return liveQuery;
}

function normalizeIndexCursor(
  cursor: unknown,
  indexFields: readonly string[],
): Record<string, unknown> {
  if (indexFields.length === 0) {
    throw new Error("Cannot offset a query without index fields.");
  }

  if (indexFields.length === 1) {
    const field = indexFields[0];

    if (!field) {
      throw new Error("Missing index field.");
    }

    if (isPlainObject(cursor) && field in cursor) {
      return { [field]: cursor[field] };
    }

    return { [field]: cursor };
  }

  if (!isPlainObject(cursor)) {
    throw new Error(
      `Composite index offsets must be objects with fields: ${indexFields.join(", ")}.`,
    );
  }

  return Object.fromEntries(
    indexFields.map((field) => {
      if (!(field in cursor)) {
        throw new Error(`Missing offset field "${field}".`);
      }

      return [field, cursor[field]];
    }),
  );
}

function createSqliteQuery<
  TRow extends object,
  TIndexes extends SqliteIndexMap,
>(
  sourceCollection: Collection<
    TRow,
    string | number,
    SqliteCollectionUtils<TRow>
  >,
  database: AsyncSqliteDatabase,
  tableName: string,
  indexes: TIndexes,
  structuredColumns: StructuredColumns,
  initialIndexFields: readonly string[] = ["_id"],
  initialRange: SqliteQueryRangeState = {
    equals: [],
    likes: [],
    nullChecks: [],
    lowerBound: null,
    upperBound: null,
  },
): SqliteQuery<TRow, TIndexes> {
  let indexFields = initialIndexFields;
  let range = initialRange;
  let cursorInput: unknown | null = null;
  let direction: "asc" | "desc" = "asc";

  const run = async (limit?: number): Promise<TRow[]> => {
    const cursorValues =
      cursorInput === null ? null : normalizeIndexCursor(cursorInput, indexFields);
    const { sql, bind } = buildIndexedSelectSql(
      tableName,
      indexFields,
      range,
      cursorValues,
      direction,
      structuredColumns,
      limit,
    );
    const rows = await database.query<Record<string, unknown>>(
      sql,
      bind as any,
    );
    return rows.map((row) =>
      deserializeRowValues<TRow>(row, structuredColumns),
    );
  };

  return {
    withIndex(indexName, build) {
      const runtimeIndex = indexes[indexName];

      if (!runtimeIndex) {
        throw new Error(
          `Index "${String(indexName)}" not found on table "${tableName}".`,
        );
      }

      const rangeBuilder = new RuntimeIndexRangeBuilder<TRow>();

      if (build) {
        build(
          rangeBuilder as unknown as SqliteIndexRangeBuilder<
            TRow,
            TIndexes[typeof indexName]["fields"]
          >,
        );
      }

      indexFields = runtimeIndex.fields;
      range = rangeBuilder.getState();
      return this;
    },
    order(nextDirection) {
      direction = nextDirection;
      return this;
    },
    offset(cursor) {
      cursorInput = cursor;
      return this;
    },
    async collect() {
      return run();
    },
    async first() {
      const rows = await run(1);
      return rows[0] ?? null;
    },
    async unique() {
      const rows = await run(2);

      if (rows.length > 1) {
        throw new Error("Expected a unique result, but found multiple rows.");
      }

      return rows[0] ?? null;
    },
    async take(limit) {
      return run(limit);
    },
    toLiveQuery(query, options) {
      return createTanStackLiveQuery(
        query,
        sourceCollection,
        range,
        indexFields,
        cursorInput === null ? null : normalizeIndexCursor(cursorInput, indexFields),
        direction,
        options,
      );
    },
  };
}

async function persistSqliteMutations<TRow extends object>(
  options: CreateSqliteCollectionOptions<TRow, any, SqliteIndexMap>,
  mutations: Array<PendingMutation<TRow>>,
  columnNames: Set<string>,
  structuredColumns: StructuredColumns,
  sourceInstanceId: string,
): Promise<SqliteMutationEvent[]> {
  const mutationEvents: SqliteMutationEvent[] = [];

  await options.database.execute("BEGIN");

  try {
    for (const mutation of mutations) {
      mutationEvents.push(
        await applyMutation(
          options,
          mutation,
          columnNames,
          structuredColumns,
          sourceInstanceId,
        ),
      );
    }

    await options.database.execute("COMMIT");
    return mutationEvents;
  } catch (error) {
    try {
      await options.database.execute("ROLLBACK");
    } catch {
      // Ignore rollback errors and rethrow the original failure.
    }

    throw error;
  }
}

function deserializeMutationKey<TRow extends object, TKey>(
  options: CreateSqliteCollectionOptions<TRow, TKey, SqliteIndexMap>,
  mutationKey: unknown,
): TKey {
  if (typeof mutationKey === "string" || typeof mutationKey === "number") {
    return options.deserializeKey(mutationKey);
  }

  return mutationKey as TKey;
}

async function applyMutation<TRow extends object>(
  options: CreateSqliteCollectionOptions<TRow, any, SqliteIndexMap>,
  mutation: PendingMutation<TRow>,
  columnNames: Set<string>,
  structuredColumns: StructuredColumns,
  sourceInstanceId: string,
): Promise<SqliteMutationEvent> {
  const mutationKey = deserializeMutationKey(
    options,
    mutation.key,
  ) as SqliteRowKey;
  const snapshotQuery = buildMutationSnapshotQuery(options, mutationKey);
  const beforeRows = await queryMutationRows(
    options.database,
    snapshotQuery,
    structuredColumns,
  );

  switch (mutation.type) {
    case "insert":
      await insertRow(
        options,
        mutation.modified,
        columnNames,
        structuredColumns,
      );
      break;
    case "update":
      await updateRow(
        options,
        mutation,
        columnNames,
        structuredColumns,
        beforeRows[0],
        mutationKey,
      );
      break;
    case "delete":
      await deleteRow(options, mutationKey);
      break;
  }

  const afterRows = await queryMutationRows(
    options.database,
    snapshotQuery,
    structuredColumns,
  );
  return createMutationEvent(
    options,
    mutation,
    beforeRows,
    afterRows,
    mutationKey,
    sourceInstanceId,
  );
}

interface MutationSnapshotQuery {
  sql: string;
  bind: SqlValue[];
}

function buildMutationSnapshotQuery<TRow extends object>(
  options: CreateSqliteCollectionOptions<TRow, any, SqliteIndexMap>,
  key: SqliteRowKey,
): MutationSnapshotQuery {
  const escapedTableName = escapeIdentifier(options.tableName);
  const predicate = buildKeyPredicate(key, options.keyColumns);

  return {
    sql: `SELECT * FROM "${escapedTableName}" ${predicate.whereClause} ORDER BY ${buildOrderByClause(options.keyColumns)};`,
    bind: predicate.bind,
  };
}

async function queryMutationRows(
  database: AsyncSqliteDatabase,
  snapshotQuery: MutationSnapshotQuery,
  structuredColumns: StructuredColumns,
): Promise<Array<Record<string, unknown>>> {
  const rows = await database.query<Record<string, unknown>>(
    snapshotQuery.sql,
    snapshotQuery.bind,
  );

  return rows.map((row) => deserializeRowValues(row, structuredColumns));
}

function createMutationEvent<TRow extends object>(
  options: CreateSqliteCollectionOptions<TRow, any, SqliteIndexMap>,
  mutation: PendingMutation<TRow>,
  beforeRows: Array<Record<string, unknown>>,
  afterRows: Array<Record<string, unknown>>,
  mutationKey: SqliteRowKey,
  sourceInstanceId: string,
): SqliteMutationEvent {
  const rowDiffs = buildMutationRowDiffs(
    beforeRows,
    afterRows,
    options.keyColumns,
    mutationKey,
  );

  return {
    eventId: crypto.randomUUID(),
    origin: "local",
    tableName: options.tableName,
    sourceInstanceId,
    mutationType: mutation.type,
    keyColumns: [...options.keyColumns],
    rowDiffs,
    publishedAt: Date.now(),
    serverSequence: null,
  };
}

function logMutationDiff(event: SqliteMutationEvent): void {
  sqliteMutationEventBus.publish(event.tableName, event);
}

function buildMutationRowDiffs(
  beforeRows: Array<Record<string, unknown>>,
  afterRows: Array<Record<string, unknown>>,
  keyColumns: readonly string[],
  fallbackKey: SqliteRowKey,
): SqliteMutationRowDiff[] {
  const rowCount = Math.max(beforeRows.length, afterRows.length);
  const diffs: SqliteMutationRowDiff[] = [];

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const beforeRow = beforeRows[rowIndex];
    const afterRow = afterRows[rowIndex];
    const changes = diffRowValues(beforeRow, afterRow);

    diffs.push({
      key: resolveMutationRowKey(beforeRow, afterRow, keyColumns, fallbackKey),
      changeType:
        beforeRow === undefined
          ? "inserted"
          : afterRow === undefined
            ? "deleted"
            : Object.keys(changes).length === 0
            ? "unchanged"
              : "updated",
      changes,
      beforeRow: beforeRow ?? null,
      afterRow: afterRow ?? null,
    });
  }

  return diffs;
}

function resolveMutationRowKey(
  beforeRow: Record<string, unknown> | undefined,
  afterRow: Record<string, unknown> | undefined,
  keyColumns: readonly string[],
  fallbackKey: SqliteRowKey,
): SqliteRowKey | null {
  if (afterRow) {
    return getRowKeyFromRow(afterRow, keyColumns);
  }

  if (beforeRow) {
    return getRowKeyFromRow(beforeRow, keyColumns);
  }

  return fallbackKey ? normalizeRowKey(fallbackKey, keyColumns) : null;
}

function diffRowValues(
  beforeRow: Record<string, unknown> | undefined,
  afterRow: Record<string, unknown> | undefined,
): Record<string, SqliteMutationChange> {
  const changes: Record<string, SqliteMutationChange> = {};
  const keys = new Set([
    ...Object.keys(beforeRow ?? {}),
    ...Object.keys(afterRow ?? {}),
  ]);

  for (const key of keys) {
    const beforeValue = beforeRow?.[key];
    const afterValue = afterRow?.[key];

    if (areMutationValuesEqual(beforeValue, afterValue)) {
      continue;
    }

    changes[key] = {
      before: beforeValue,
      after: afterValue,
    };
  }

  return changes;
}

function areMutationValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) {
      return false;
    }

    return left.every((value, index) =>
      areMutationValuesEqual(value, right[index]),
    );
  }

  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);

    if (leftKeys.length !== rightKeys.length) {
      return false;
    }

    return leftKeys.every((key) => {
      if (!Object.prototype.hasOwnProperty.call(right, key)) {
        return false;
      }

      return areMutationValuesEqual(left[key], right[key]);
    });
  }

  return false;
}

async function insertRow<TRow extends object>(
  options: CreateSqliteCollectionOptions<TRow, any, SqliteIndexMap>,
  row: TRow,
  columnNames: Set<string>,
  structuredColumns: StructuredColumns,
): Promise<void> {
  const completeRow = withInsertSystemFields(row, columnNames);
  await validateReferenceColumns(options, completeRow);
  const serializedRow = serializeRowValues(completeRow, structuredColumns);
  const entries = Object.entries(serializedRow);

  if (entries.length === 0) {
    await options.database.execute(
      `INSERT INTO "${escapeIdentifier(options.tableName)}" DEFAULT VALUES;`,
    );
    return;
  }

  const columns = entries.map(([column]) => `"${escapeIdentifier(column)}"`);
  const values = entries.map(([, value]) => value) as any[];
  const placeholders = entries.map(() => "?");

  await options.database.execute(
    `INSERT INTO "${escapeIdentifier(options.tableName)}" (${columns.join(", ")}) VALUES (${placeholders.join(", ")});`,
    values,
  );
}

async function updateRow<TRow extends object>(
  options: CreateSqliteCollectionOptions<TRow, any, SqliteIndexMap>,
  mutation: PendingMutation<TRow>,
  columnNames: Set<string>,
  structuredColumns: StructuredColumns,
  existingRow: Record<string, unknown> | undefined,
  mutationKey: SqliteRowKey,
): Promise<void> {
  const changes = withUpdateSystemFields(mutation.changes, columnNames);
  await validateReferenceColumns(options, changes, existingRow);
  const serializedChanges = serializeRowValues(changes, structuredColumns);
  const entries = Object.entries(serializedChanges).filter(
    ([column]) => !options.keyColumns.includes(column as keyof TRow & string),
  );

  if (entries.length === 0) {
    return;
  }

  const assignments = entries.map(
    ([column]) => `"${escapeIdentifier(column)}" = ?`,
  );
  const values = entries.map(([, value]) => value) as any[];
  const predicate = buildKeyPredicate(mutationKey, options.keyColumns);

  await options.database.execute(
    `UPDATE "${escapeIdentifier(options.tableName)}" SET ${assignments.join(", ")} ${predicate.whereClause};`,
    [...values, ...predicate.bind],
  );
}

async function deleteRow<TRow extends object>(
  options: CreateSqliteCollectionOptions<TRow, any, SqliteIndexMap>,
  key: SqliteRowKey,
): Promise<void> {
  const predicate = buildKeyPredicate(key, options.keyColumns);

  await options.database.execute(
    `DELETE FROM "${escapeIdentifier(options.tableName)}" ${predicate.whereClause};`,
    predicate.bind,
  );
}

function escapeIdentifier(identifier: string): string {
  return identifier.replaceAll('"', '""');
}

function withInsertSystemFields<TRow extends object>(
  row: TRow,
  columnNames: Set<string>,
): Record<string, unknown> {
  const nextRow = { ...(row as Record<string, unknown>) };

  if (columnNames.has("_createdAt") && nextRow._createdAt === undefined) {
    nextRow._createdAt = currentTimestamp();
  }

  if (columnNames.has("_updatedAt") && nextRow._updatedAt === undefined) {
    nextRow._updatedAt = currentTimestamp();
  }

  if (columnNames.has("_archivedAt") && nextRow._archivedAt === undefined) {
    nextRow._archivedAt = null;
  }

  return nextRow;
}

function withUpdateSystemFields<TRow extends object>(
  changes: Partial<TRow>,
  columnNames: Set<string>,
): Record<string, unknown> {
  const nextChanges = { ...(changes as Record<string, unknown>) };

  if (columnNames.has("_updatedAt") && nextChanges._updatedAt === undefined) {
    nextChanges._updatedAt = currentTimestamp();
  }

  return nextChanges;
}

async function validateReferenceColumns<TRow extends object>(
  options: CreateSqliteCollectionOptions<TRow, any, SqliteIndexMap>,
  rowOrChanges: Record<string, unknown>,
  existingRow?: Record<string, unknown>,
): Promise<void> {
  const referenceColumns = options.referenceColumns as
    | Record<string, SqliteReferenceColumn | undefined>
    | undefined;
  const nextRow = existingRow ? { ...existingRow, ...rowOrChanges } : rowOrChanges;

  for (const [columnName, config] of Object.entries(referenceColumns ?? {})) {
    const shouldValidate =
      columnName in rowOrChanges ||
      (config?.actorScoped === true && "_actor" in rowOrChanges);

    if (!config?.enforceExists || !shouldValidate) {
      continue;
    }

    const value = nextRow[columnName];

    if (value === null || value === undefined || value === "") {
      continue;
    }

    const actorId = nextRow._actor;

    if (config.actorScoped && actorId === undefined) {
      throw new Error(
        `Cannot validate actor-scoped reference "${columnName}" without an "_actor" value.`,
      );
    }

    const referenceKey = config.actorScoped
      ? {
          _actor: actorId as never,
          _id: value as never,
        }
      : value;

    const exists = await options.database.rowExists(
      config.referencedTable,
      referenceKey as SqliteKey,
      config.keyColumns,
    );
    if (!exists) {
      throw new Error(
        `Referenced ${config.referencedTable} row "${String(value)}" does not exist.`,
      );
    }
  }
}

function currentTimestamp(): bigint {
  return BigInt(Date.now());
}

type SqliteComparisonOperator = "=" | ">" | ">=" | "<" | "<=";
type SqliteMatchOperator = SqliteComparisonOperator | "LIKE";
type SqliteNullCheckOperator = "IS NULL" | "IS NOT NULL";

interface SqliteQueryRangeState {
  equals: Array<{ field: string; value: unknown }>;
  likes: Array<{ field: string; value: unknown }>;
  nullChecks: Array<{ field: string; operator: SqliteNullCheckOperator }>;
  lowerBound: { field: string; value: unknown; operator: ">" | ">=" } | null;
  upperBound: { field: string; value: unknown; operator: "<" | "<=" } | null;
}

class RuntimeIndexRangeBuilder<TRow extends object>
  implements
    SqliteIndexRangeBuilder<TRow, readonly string[]>,
    SqliteBoundIndexRangeBuilder<TRow, string, boolean, boolean>
{
  private state: SqliteQueryRangeState = {
    equals: [],
    likes: [],
    nullChecks: [],
    lowerBound: null,
    upperBound: null,
  };

  eq(field: string, value: unknown) {
    this.state.equals.push({ field, value });
    return this as unknown as RuntimeIndexRangeBuilder<TRow>;
  }

  gt(field: string, value: unknown) {
    this.setBound(field, value, ">");
    return this as unknown as RuntimeIndexRangeBuilder<TRow>;
  }

  gte(field: string, value: unknown) {
    this.setBound(field, value, ">=");
    return this as unknown as RuntimeIndexRangeBuilder<TRow>;
  }

  lt(field: string, value: unknown) {
    this.setBound(field, value, "<");
    return this as unknown as RuntimeIndexRangeBuilder<TRow>;
  }

  lte(field: string, value: unknown) {
    this.setBound(field, value, "<=");
    return this as unknown as RuntimeIndexRangeBuilder<TRow>;
  }

  like(field: string, value: unknown) {
    this.state.likes.push({ field, value });
    return this as unknown as RuntimeIndexRangeBuilder<TRow>;
  }

  isKnown(field: string) {
    this.state.nullChecks.push({ field, operator: "IS NOT NULL" });
    return this as unknown as RuntimeIndexRangeBuilder<TRow>;
  }

  isUnknown(field: string) {
    this.state.nullChecks.push({ field, operator: "IS NULL" });
    return this as unknown as RuntimeIndexRangeBuilder<TRow>;
  }

  getState(): SqliteQueryRangeState {
    return {
      equals: [...this.state.equals],
      likes: [...this.state.likes],
      nullChecks: [...this.state.nullChecks],
      lowerBound: this.state.lowerBound,
      upperBound: this.state.upperBound,
    };
  }

  private setBound(
    field: string,
    value: unknown,
    operator: Exclude<SqliteComparisonOperator, "=">,
  ): void {
    const target =
      operator === ">" || operator === ">=" ? "lowerBound" : "upperBound";
    const existing = this.state[target];

    if (existing !== null && existing.field !== field) {
      throw new Error(
        `Index range bound must stay on field "${existing.field}".`,
      );
    }

    if (target === "lowerBound") {
      this.state.lowerBound = {
        field,
        value,
        operator: operator as ">" | ">=",
      };
      return;
    }

    this.state.upperBound = { field, value, operator: operator as "<" | "<=" };
  }
}

function buildIndexedSelectSql(
  tableName: string,
  indexFields: readonly string[],
  range: SqliteQueryRangeState,
  cursorValues: Record<string, unknown> | null,
  direction: "asc" | "desc",
  structuredColumns: StructuredColumns,
  limit?: number,
): { sql: string; bind: unknown[] } {
  const whereClauses: string[] = [];
  const bind: unknown[] = [];

  for (const equality of range.equals) {
    appendWhereClause(
      whereClauses,
      bind,
      equality.field,
      "=",
      equality.value,
      structuredColumns,
    );
  }

  for (const like of range.likes) {
    appendWhereClause(
      whereClauses,
      bind,
      like.field,
      "LIKE",
      like.value,
      structuredColumns,
    );
  }

  for (const nullCheck of range.nullChecks) {
    appendNullCheckClause(
      whereClauses,
      nullCheck.field,
      nullCheck.operator,
    );
  }

  if (range.lowerBound) {
    appendWhereClause(
      whereClauses,
      bind,
      range.lowerBound.field,
      range.lowerBound.operator,
      range.lowerBound.value,
      structuredColumns,
    );
  }

  if (range.upperBound) {
    appendWhereClause(
      whereClauses,
      bind,
      range.upperBound.field,
      range.upperBound.operator,
      range.upperBound.value,
      structuredColumns,
    );
  }

  if (cursorValues) {
    appendCursorClause(
      whereClauses,
      bind,
      indexFields,
      cursorValues,
      direction,
      structuredColumns,
    );
  }

  const whereSql =
    whereClauses.length > 0 ? ` WHERE ${whereClauses.join(" AND ")}` : "";
  const orderSql = ` ORDER BY ${indexFields
    .map(
      (field) =>
        `${fieldPathToSqlExpression(field)} ${direction.toUpperCase()}`,
    )
    .join(", ")}`;
  const limitSql = limit !== undefined ? " LIMIT ?" : "";

  if (limit !== undefined) {
    bind.push(limit);
  }

  return {
    sql: `SELECT * FROM "${escapeIdentifier(tableName)}"${whereSql}${orderSql}${limitSql};`,
    bind,
  };
}

function appendWhereClause(
  whereClauses: string[],
  bind: unknown[],
  field: string,
  operator: SqliteMatchOperator,
  value: unknown,
  structuredColumns: StructuredColumns,
): void {
  whereClauses.push(`${fieldPathToSqlExpression(field)} ${operator} ?`);
  bind.push(serializeQueryValue(field, value, structuredColumns));
}

function appendNullCheckClause(
  whereClauses: string[],
  field: string,
  operator: SqliteNullCheckOperator,
): void {
  whereClauses.push(`${fieldPathToSqlExpression(field)} ${operator}`);
}

function appendCursorClause(
  whereClauses: string[],
  bind: unknown[],
  indexFields: readonly string[],
  cursorValues: Record<string, unknown>,
  direction: "asc" | "desc",
  structuredColumns: StructuredColumns,
): void {
  const comparisonOperator = direction === "asc" ? ">" : "<";
  const branchClauses: string[] = [];

  for (let fieldIndex = 0; fieldIndex < indexFields.length; fieldIndex += 1) {
    const field = indexFields[fieldIndex];

    if (!field) {
      continue;
    }

    const branchParts: string[] = [];

    for (let prefixIndex = 0; prefixIndex < fieldIndex; prefixIndex += 1) {
      const prefixField = indexFields[prefixIndex];

      if (!prefixField) {
        continue;
      }

      branchParts.push(`${fieldPathToSqlExpression(prefixField)} = ?`);
      bind.push(
        serializeQueryValue(
          prefixField,
          cursorValues[prefixField],
          structuredColumns,
        ),
      );
    }

    branchParts.push(`${fieldPathToSqlExpression(field)} ${comparisonOperator} ?`);
    bind.push(
      serializeQueryValue(field, cursorValues[field], structuredColumns),
    );
    branchClauses.push(`(${branchParts.join(" AND ")})`);
  }

  if (branchClauses.length > 0) {
    whereClauses.push(`(${branchClauses.join(" OR ")})`);
  }
}

function serializeQueryValue(
  fieldPath: string,
  value: unknown,
  structuredColumns: StructuredColumns,
): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  const [rootField] = fieldPath.split(".");

  if (!rootField) {
    return value;
  }

  const kind = structuredColumns[rootField];

  if (!kind) {
    return value;
  }

  if (!fieldPath.includes(".")) {
    return serializeStructuredValue(kind, value);
  }

  return isPlainObject(value) || Array.isArray(value)
    ? JSON.stringify(value)
    : value;
}

function fieldPathToSqlExpression(fieldPath: string): string {
  if (!fieldPath.includes(".")) {
    return `"${escapeIdentifier(fieldPath)}"`;
  }

  const [root, ...segments] = fieldPath.split(".");
  const jsonPath = `$.${segments.join(".")}`;
  if (!root) {
    throw new Error(`Invalid field path "${fieldPath}".`);
  }
  return `json_extract("${escapeIdentifier(root)}", '${jsonPath.replace(/'/g, "''")}')`;
}
