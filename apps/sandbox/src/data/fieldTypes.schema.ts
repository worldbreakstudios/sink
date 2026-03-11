import { defineTable, v } from '@sink/lib'

export default defineTable('fieldTypes', {
  name: v.string(),
}).index('by_name', ['name'])
