import { defineTable, v } from '@worldbreakstudios/sink-lib'

export default defineTable('fieldTypes', {
  name: v.string(),
}).index('by_name', ['name'])
