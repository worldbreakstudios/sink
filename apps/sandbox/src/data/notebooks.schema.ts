import { defineTable, v } from '@sink/lib'

export default defineTable(
  'notebooks',
  {
    name: v.string(),
    description: v.nullable(v.string()),
    test: v.nullable(v.string()),
  },
  { orderBy: '_id ASC' },
)
  .withCreatedAt(true)
  .withUpdatedAt(true)
