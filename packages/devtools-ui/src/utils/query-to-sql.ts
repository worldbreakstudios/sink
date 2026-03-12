import type { QueryState, IndexDefinition } from '../types'
import { parseValue } from './parse'

const OPERATOR_MAP: Record<string, string> = {
  eq: '=',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
}

export interface SqlQuery {
  sql: string
  bind: unknown[]
}

/**
 * Convert a QueryState from the QueryBuilder into a SQL query
 * that can be executed via the devtools bridge.
 */
export function queryStateToSql(
  query: QueryState,
  tableName: string,
  indexes: Record<string, IndexDefinition>
): SqlQuery {
  const index = indexes[query.indexName]
  const bind: unknown[] = []

  // Build WHERE clause from constraints
  const whereClauses: string[] = []
  for (const constraint of query.constraints) {
    if (constraint.value === '') continue // Skip empty constraints

    const parsedValue = parseValue(constraint.value)
    bind.push(parsedValue)

    const sqlOperator = OPERATOR_MAP[constraint.operator] ?? '='
    whereClauses.push(`"${constraint.field}" ${sqlOperator} ?`)
  }

  // Build ORDER BY from index fields (use index order if available)
  const orderFields = index?.fields ?? ['_id']
  const orderBy = orderFields.map((f) => `"${f}"`).join(', ')

  // Build LIMIT based on query method
  let limit: number | null = null
  switch (query.queryMethod) {
    case 'first':
    case 'unique':
      limit = 1
      break
    case 'take':
      limit = parseInt(query.takeCount, 10) || 10
      break
    case 'collect':
    default:
      limit = null
      break
  }

  // Assemble the SQL query
  let sql = `SELECT * FROM "${tableName}"`

  if (whereClauses.length > 0) {
    sql += ` WHERE ${whereClauses.join(' AND ')}`
  }

  sql += ` ORDER BY ${orderBy} ${query.orderDirection.toUpperCase()}`

  if (limit !== null) {
    sql += ` LIMIT ${limit}`
  }

  return { sql, bind }
}
