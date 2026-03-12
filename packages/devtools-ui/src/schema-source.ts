import type {
  SinkDevtoolsSchemaMetadata,
  SqliteTableColumn,
} from '@sink/lib'

export function generateSchemaSource(
  tableName: string,
  columns: SqliteTableColumn[],
  schema: SinkDevtoolsSchemaMetadata,
): string {
  const referenceColumns = schema.referenceColumns[tableName] ?? {}
  const tableIndexes = schema.indexes[tableName] ?? {}
  const implicitColumnNames = new Set([
    '_id',
    '_createdAt',
    '_updatedAt',
    '_archivedAt',
  ])
  const userColumns = columns.filter((column) => !implicitColumnNames.has(column.name))
  const hasCreatedAt = columns.some((column) => column.name === '_createdAt')
  const hasUpdatedAt = columns.some((column) => column.name === '_updatedAt')
  const hasArchivedAt = columns.some((column) => column.name === '_archivedAt')
  const schemaFields = userColumns.map((column) => {
    const referenceColumn = referenceColumns[column.name]
    let validator: string

    if (referenceColumn) {
      validator = referenceColumn.enforceExists
        ? `v.id('${referenceColumn.referencedTable}', { enforceExists: true })`
        : `v.id('${referenceColumn.referencedTable}')`
    } else {
      validator = inferValidator(column)
    }

    if (column.notnull === 0 && column.pk === 0) {
      validator = `v.optional(${validator})`
    }

    return `    ${column.name}: ${validator},`
  })
  let code = `import { defineTable, v } from '@sink/lib'

export default defineTable('${tableName}', {
${schemaFields.join('\n')}
})`

  if (hasCreatedAt) {
    code += '\n  .withCreatedAt(true)'
  }

  if (hasUpdatedAt) {
    code += '\n  .withUpdatedAt(true)'
  }

  if (hasArchivedAt) {
    code += '\n  .withArchivedAt(true)'
  }

  for (const [indexName, indexDefinition] of Object.entries(tableIndexes)) {
    if (indexName === 'by_id' || indexName === 'by_creation_time') {
      continue
    }

    const fields = indexDefinition.fields.map((field) => `'${field}'`).join(', ')
    code += indexDefinition.unique
      ? `\n  .uniqueIndex('${indexName}', [${fields}])`
      : `\n  .index('${indexName}', [${fields}])`
  }

  return code
}

function inferValidator(column: SqliteTableColumn): string {
  const sqlType = column.type.toUpperCase()

  if (sqlType.includes('INT') || sqlType.includes('REAL') || sqlType.includes('FLOAT')) {
    return 'v.number()'
  }

  if (sqlType.includes('BOOL')) {
    return 'v.boolean()'
  }

  return 'v.string()'
}
