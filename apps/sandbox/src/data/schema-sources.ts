// Import raw schema file contents for display in the UI
import fieldsSchema from './fields.schema.ts?raw'
import fieldTypesSchema from './fieldTypes.schema.ts?raw'
import objectsSchema from './objects.schema.ts?raw'
import objectTypesSchema from './objectTypes.schema.ts?raw'

export const SCHEMA_SOURCES: Record<string, string> = {
  fields: fieldsSchema,
  fieldTypes: fieldTypesSchema,
  objects: objectsSchema,
  objectTypes: objectTypesSchema,
}

export function getSchemaSource(tableName: string): string {
  return SCHEMA_SOURCES[tableName] ?? `// No schema file found for ${tableName}`
}
