import fs from 'node:fs'
import type { TableDefinition } from '@sink/lib'

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

    seenNames.add(def.tableName)
    definitions.push(def)
  }

  return definitions
}
