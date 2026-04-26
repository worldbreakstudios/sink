import { defineTable, v } from '@worldbreakstudios/sink-lib'

export default defineTable('objectTypes', {
  name: v.string(),
}).index('by_name', ['name'])
