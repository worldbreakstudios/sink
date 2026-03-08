import { defineTable, v } from '@sink/lib'

export default defineTable(
  'objectTypes',
  {
    id: v.id(),
    name: v.string(),
  },
  { orderBy: 'id ASC' },
)
