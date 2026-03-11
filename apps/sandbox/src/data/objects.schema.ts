import { defineTable, v } from '@sink/lib'

export default defineTable('objects', {
  type_id: v.id('objectTypes', { enforceExists: true }),
}).withCreatedAt(true)
  .index('by_type_id', ['type_id'])
