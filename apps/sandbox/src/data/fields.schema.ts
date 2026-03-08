import { defineTable, v } from '@sink/lib'

export default defineTable(
  'fields',
  {
    id: v.id(),
    object_id: v.number(),
    field_type_id: v.number(),
    name: v.string(),
    body: v.string(),
    created_at: v.string(),
  },
  { orderBy: 'id ASC' },
)
