import { defineTable, v } from '@sink/lib'

export default defineTable(
  'fields',
  {
    object_id: v.id('objects'),
    field_type_id: v.id('fieldTypes'),
    name: v.string(),
    body: v.string(),
    created_at: v.string(),
  },
  { orderBy: '_id ASC' },
)
