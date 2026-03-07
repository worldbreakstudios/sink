import { defineTable, v } from '@sink/lib'

export default defineTable('properties', {
  id: v.id(),
  object_id: v.number(),
  name: v.string(),
  body: v.string(),
  created_at: v.string(),
}, { orderBy: 'id ASC' })
