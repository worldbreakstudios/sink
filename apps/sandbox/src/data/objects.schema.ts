import { defineTable, v } from '@sink/lib'

export default defineTable('objects', {
  type_id: v.id('objectTypes'),
  created_at: v.string(),
}, { orderBy: '_id ASC' })
