import { defineTable, v } from '@sink/lib'

export default defineTable('notes', {
  notebook_id: v.id('notebooks'),
  title: v.string(),
  body: v.string(),
  status: v.string(),
  created_at: v.string(),
}, { orderBy: '_id ASC' })
