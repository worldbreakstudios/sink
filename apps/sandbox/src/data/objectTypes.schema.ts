import { defineTable, v } from '@sink/lib'

export default defineTable('objectTypes', {
  id: v.id(),
  created_at: v.string(),
}, { orderBy: 'id ASC' })
