import { defineTable, v } from '@sink/lib'

export default defineTable(
  'fields',
  {
    object_id: v.id('objects', { enforceExists: true }),
    field_type_id: v.id('fieldTypes', { enforceExists: true }),
    name: v.string(),
    body: v.string(),
  },
  { orderBy: '_createdAt ASC' },
).withCreatedAt(true)
