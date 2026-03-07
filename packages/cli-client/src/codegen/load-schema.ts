import type { TableDefinition } from '@sink/lib'

export async function loadSchemaFiles(
  files: string[],
): Promise<TableDefinition[]> {
  const { createJiti } = await import('jiti')
  const jiti = createJiti(import.meta.url, { interopDefault: true })

  const definitions: TableDefinition[] = []
  const seenNames = new Set<string>()

  for (const file of files) {
    const mod = await jiti.import(file) as { default?: TableDefinition }
    const def = mod.default ?? (mod as unknown as TableDefinition)

    if (!def || !def.tableName || !def.columns) {
      throw new Error(`Schema file ${file} must have a default export from defineTable()`)
    }

    if (seenNames.has(def.tableName)) {
      throw new Error(`Duplicate table name: "${def.tableName}"`)
    }

    const idColumns = Object.entries(def.columns).filter(
      ([, col]) => col.isPrimaryKey,
    )
    if (idColumns.length !== 1) {
      throw new Error(
        `Table "${def.tableName}" must have exactly one v.id() column, found ${idColumns.length}`,
      )
    }

    seenNames.add(def.tableName)
    definitions.push(def)
  }

  return definitions
}
