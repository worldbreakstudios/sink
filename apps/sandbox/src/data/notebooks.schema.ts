import { defineTable, v } from '@sink/lib'

export default defineTable('notebooks', {
  id: v.id(),
  name: v.string(),
  description: v.nullable(v.string()),
  test: v.nullable(v.string()),
  created_at: v.string(),
}, { orderBy: 'id ASC' })
