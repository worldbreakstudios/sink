import type { SqliteTableSnapshot } from '@sink/lib'
import type { IndexDefinition, ReferenceColumn } from '../types'
import { getColumnValidator } from './validator-generator'

/**
 * Generate defineTable schema source code from table metadata
 *
 * This works for both:
 * - Sandbox: pass INDEXES[tableName] and REFERENCE_COLUMNS[tableName] from generated schema
 * - DevTools: pass reverse-engineered indexes and reference columns
 */
export function generateSchemaSource(
  table: SqliteTableSnapshot,
  indexes: Record<string, IndexDefinition>,
  referenceColumns: Record<string, ReferenceColumn>
): string {
  // Separate implicit columns from user columns
  const implicitColumnNames = new Set(['_id', '_createdAt', '_updatedAt', '_archivedAt'])
  const userColumns = table.columns.filter((col) => !implicitColumnNames.has(col.name))

  // Detect which implicit columns exist
  const hasCreatedAt = table.columns.some((col) => col.name === '_createdAt')
  const hasUpdatedAt = table.columns.some((col) => col.name === '_updatedAt')
  const hasArchivedAt = table.columns.some((col) => col.name === '_archivedAt')

  // Generate validator for each column
  const schemaFields = userColumns.map((col) => {
    const validator = getColumnValidator(col, referenceColumns[col.name])
    return `    ${col.name}: ${validator},`
  })

  // Build the defineTable call
  let code = `import { defineTable, v } from '@sink/lib'

export default defineTable('${table.name}', {
${schemaFields.join('\n')}
})`

  // Add implicit column methods
  if (hasCreatedAt) {
    code += `\n  .withCreatedAt(true)`
  }
  if (hasUpdatedAt) {
    code += `\n  .withUpdatedAt(true)`
  }
  if (hasArchivedAt) {
    code += `\n  .withArchivedAt(true)`
  }

  // Add indexes (skip by_id and by_creation_time as they're implicit)
  const implicitIndexNames = new Set(['by_id', 'by_creation_time'])
  for (const [indexName, indexDef] of Object.entries(indexes)) {
    if (implicitIndexNames.has(indexName)) continue

    const columnsStr = indexDef.fields.map((c) => `'${c}'`).join(', ')
    if (indexDef.unique) {
      code += `\n  .uniqueIndex('${indexName}', [${columnsStr}])`
    } else {
      code += `\n  .index('${indexName}', [${columnsStr}])`
    }
  }

  return code
}

/**
 * Get schema source for a table by name
 * Convenience wrapper that finds the table in the list
 */
export function getSchemaSource(
  tableName: string,
  tables: SqliteTableSnapshot[],
  indexes: Record<string, IndexDefinition>,
  referenceColumns: Record<string, ReferenceColumn>
): string {
  const table = tables.find((t) => t.name === tableName)
  if (!table) {
    return `// No schema found for table "${tableName}"`
  }

  return generateSchemaSource(table, indexes, referenceColumns)
}
