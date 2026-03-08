import { defineTable, v } from '@sink/lib'

export default defineTable(
  'objects',
  {
    type_id: v.id('objectTypes'),
  },
  { orderBy: '_id ASC' },
).withCreatedAt(true)
