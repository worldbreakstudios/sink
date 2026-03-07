import { defineTable, v } from '@sink/lib'

export default defineTable('notes', {
  id: v.id(),
  notebook_id: v.number(),
  title: v.string(),
  body: v.string(),
  status: v.string(),
  created_at: v.string(),
}, { orderBy: 'id ASC' })
