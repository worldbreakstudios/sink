import { defineTable, v } from '@sink/lib'

export default defineTable('objects', {
  id: v.id(),
  type_id: v.string(),
  created_at: v.string(),
}, { orderBy: 'id ASC' })
