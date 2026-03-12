import type { SqliteTableColumn, SqliteTableSnapshot, SqliteIndexSnapshot } from '@sink/lib'

/**
 * Generic row type that works with both generated schema rows and raw SQLite rows
 */
export type GenericRow = Record<string, unknown> & {
  _id: string
  _createdAt?: bigint | number
  _updatedAt?: bigint | number | null
  _archivedAt?: bigint | number | null
}

/**
 * Unified index definition format
 */
export interface IndexDefinition {
  name: string
  fields: readonly string[]
  unique: boolean
}

/**
 * Reference column (foreign key) information
 */
export interface ReferenceColumn {
  referencedTable: string
  enforceExists?: boolean
}

/**
 * Query constraint for the query builder
 */
export type Operator = 'eq' | 'gt' | 'gte' | 'lt' | 'lte'

export interface QueryConstraint {
  field: string
  operator: Operator
  value: string
}

/**
 * Query state for the query builder
 */
export type QueryMethod = 'collect' | 'first' | 'unique' | 'take'

export interface QueryState {
  indexName: string
  constraints: QueryConstraint[]
  orderDirection: 'asc' | 'desc'
  queryMethod: QueryMethod
  takeCount: string
}

/**
 * Query result from executing a query
 */
export interface QueryResult<TRow extends GenericRow = GenericRow> {
  rows: TRow[]
  executionTime: number
  error?: string
}

/**
 * Table metadata including indexes and reference columns
 */
export interface TableMetadata {
  indexes: Record<string, IndexDefinition>
  referenceColumns: Record<string, ReferenceColumn>
}

// Re-export types from @sink/lib for convenience
export type { SqliteTableColumn, SqliteTableSnapshot, SqliteIndexSnapshot }
