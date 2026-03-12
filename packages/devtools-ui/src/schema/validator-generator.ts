import type { SqliteTableColumn } from '@sink/lib'
import type { ReferenceColumn } from '../types'
import { inferTsType } from './type-inference'

/**
 * Generate validator string for a column
 * Returns strings like 'v.string()', 'v.number()', 'v.id("tableName")'
 */
export function getColumnValidator(
  column: SqliteTableColumn,
  referenceColumn?: ReferenceColumn
): string {
  const { name, type, notnull, pk } = column

  // System columns have fixed validators
  if (name === '_id') return 'v.id()'
  if (name === '_createdAt') return 'v.number()'
  if (name === '_updatedAt') return 'v.optional(v.number())'
  if (name === '_archivedAt') return 'v.optional(v.number())'

  // Foreign key reference
  if (referenceColumn) {
    const refValidator = referenceColumn.enforceExists
      ? `v.id('${referenceColumn.referencedTable}', { enforceExists: true })`
      : `v.id('${referenceColumn.referencedTable}')`

    // Wrap with optional if nullable
    if (notnull === 0 && pk === 0) {
      return `v.optional(${refValidator})`
    }
    return refValidator
  }

  // Infer from SQL type
  const tsType = inferTsType(type)
  let validator: string

  switch (tsType) {
    case 'number':
      validator = 'v.number()'
      break
    case 'boolean':
      validator = 'v.boolean()'
      break
    default:
      validator = 'v.string()'
  }

  // Wrap with optional if nullable and not primary key
  if (notnull === 0 && pk === 0) {
    validator = `v.optional(${validator})`
  }

  return validator
}
