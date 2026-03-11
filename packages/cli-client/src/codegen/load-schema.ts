import fs from 'node:fs'
import {
  RESERVED_INDEX_NAMES,
  RESERVED_SYSTEM_FIELD_NAMES,
  getEffectiveTableFieldNames,
  type TableDefinition,
} from '@sink/lib'

export async function loadSchemaFiles(
  files: string[],
): Promise<TableDefinition[]> {
  const { createJiti } = await import('jiti')
  const jiti = createJiti(import.meta.url, { interopDefault: true })

  const definitions: TableDefinition[] = []
  const seenNames = new Set<string>()

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf-8')
    const mod = jiti.evalModule(source, { filename: file }) as { default?: TableDefinition }
    const def = mod.default ?? (mod as unknown as TableDefinition)

    if (!def || !def.tableName || !def.columns) {
      throw new Error(`Schema file ${file} must have a default export from defineTable()`)
    }

    if (seenNames.has(def.tableName)) {
      throw new Error(`Duplicate table name: "${def.tableName}"`)
    }

    const primaryKeyColumns = Object.entries(def.columns).filter(
      ([, col]) => col.isPrimaryKey,
    )
    if (primaryKeyColumns.length > 0) {
      throw new Error(
        `Table "${def.tableName}" cannot declare a primary key column; "_id" is implicit.`,
      )
    }

    validateIndexes(def)

    seenNames.add(def.tableName)
    definitions.push(def)
  }

  return definitions
}

function validateIndexes(def: TableDefinition): void {
  const seenIndexNames = new Set<string>()
  const effectiveFields = new Set(getEffectiveTableFieldNames(def))

  for (const index of def.indexes) {
    if (seenIndexNames.has(index.name)) {
      throw new Error(
        `Table "${def.tableName}" has a duplicate index name "${index.name}".`,
      )
    }

    if (RESERVED_INDEX_NAMES.includes(index.name as (typeof RESERVED_INDEX_NAMES)[number])) {
      throw new Error(`Table "${def.tableName}" cannot define reserved index "${index.name}".`)
    }

    if (index.staged) {
      throw new Error(
        `Table "${def.tableName}" index "${index.name}" is staged, but staged indexes are not supported yet.`,
      )
    }

    if (index.fields.length === 0) {
      throw new Error(`Table "${def.tableName}" index "${index.name}" must include at least one field.`)
    }

    const seenFields = new Set<string>()

    for (const field of index.fields) {
      if (seenFields.has(field)) {
        throw new Error(
          `Table "${def.tableName}" index "${index.name}" has duplicate field "${field}".`,
        )
      }

      const [topLevelField] = field.split('.')

      if (!topLevelField || !effectiveFields.has(topLevelField)) {
        throw new Error(
          `Table "${def.tableName}" index "${index.name}" references unknown field "${field}".`,
        )
      }

      const isAllowedSystemField = effectiveFields.has(field) && field.startsWith('_')
      if (
        !isAllowedSystemField &&
        RESERVED_SYSTEM_FIELD_NAMES.includes(
          topLevelField as (typeof RESERVED_SYSTEM_FIELD_NAMES)[number],
        )
      ) {
        throw new Error(
          `Table "${def.tableName}" index "${index.name}" cannot index reserved field "${field}".`,
        )
      }

      seenFields.add(field)
    }

    seenIndexNames.add(index.name)
  }
}
