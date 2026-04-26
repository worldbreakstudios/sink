import { defineTable, v } from '@worldbreakstudios/sink-lib'

export default defineTable('objects', {
  type_id: v.id('objectTypes', { enforceExists: true }),
})
  .withActorId(true, { pk: true })
  .withCreatedAt(true)
  .index('by_type_id', ['_actor', 'type_id'])
