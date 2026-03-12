import type { SqliteTableColumn } from '@sink/lib'
import type { ReferenceColumn } from '../types'

/**
 * Convert camelCase or PascalCase to snake_case
 */
function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`).replace(/^_/, '')
}

/**
 * Get simple plural form (basic English pluralization)
 */
function toPlural(str: string): string {
  if (str.endsWith('y')) {
    return str.slice(0, -1) + 'ies'
  }
  if (str.endsWith('s') || str.endsWith('x') || str.endsWith('ch') || str.endsWith('sh')) {
    return str + 'es'
  }
  return str + 's'
}

/**
 * Detect foreign key references from column naming conventions
 *
 * Conventions detected:
 * - column_name_id -> references column_name or column_names table
 * - columnNameId -> references columnName or columnNames table
 */
export function detectReferences(
  column: SqliteTableColumn,
  availableTables: string[]
): ReferenceColumn | null {
  const name = column.name

  // Check for _id suffix (snake_case)
  if (name.endsWith('_id') && name !== '_id') {
    const tableName = name.slice(0, -3) // Remove _id
    const matchingTable = availableTables.find(
      (t) => t === tableName || t === toPlural(tableName)
    )
    if (matchingTable) {
      return { referencedTable: matchingTable, enforceExists: true }
    }
  }

  // Check for Id suffix (camelCase)
  if (name.endsWith('Id') && name !== 'id' && name !== '_id') {
    const baseName = name.slice(0, -2)
    const snakeName = toSnakeCase(baseName)
    const matchingTable = availableTables.find(
      (t) =>
        t === snakeName ||
        t === toPlural(snakeName) ||
        t === baseName ||
        t === toPlural(baseName)
    )
    if (matchingTable) {
      return { referencedTable: matchingTable, enforceExists: true }
    }
  }

  return null
}

/**
 * Parse CREATE TABLE SQL to extract REFERENCES constraints
 */
export function parseSchemaReferences(createTableSql: string): Record<string, ReferenceColumn> {
  const refs: Record<string, ReferenceColumn> = {}

  if (!createTableSql) return refs

  // Match: "column_name" TYPE ... REFERENCES "table_name"
  // Also handles: column_name TYPE ... REFERENCES table_name
  const refRegex = /["']?(\w+)["']?\s+\w+[^,]*REFERENCES\s+["']?(\w+)["']?/gi
  let match

  while ((match = refRegex.exec(createTableSql)) !== null) {
    const columnName = match[1]!
    const tableName = match[2]!
    refs[columnName] = { referencedTable: tableName, enforceExists: true }
  }

  return refs
}
