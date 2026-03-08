import { defineTable, v } from '@sink/lib'

export default defineTable(
  'fieldTypes',
  {
    id: v.id(),
    name: v.string(),
  },
  { orderBy: 'id ASC' },
)
