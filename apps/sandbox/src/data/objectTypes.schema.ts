import { defineTable, v } from '@sink/lib'

export default defineTable(
  'objectTypes',
  {
    name: v.string(),
  },
  { orderBy: '_id ASC' },
).index('by_name', ['name'])
