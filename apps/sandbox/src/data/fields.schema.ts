import { defineTable, v } from '@sink/lib'

export default defineTable('fields', {
  object_id: v.id('objects', { enforceExists: true }),
  field_type_id: v.id('fieldTypes', { enforceExists: true }),
  name: v.string(),
  body: v.string(),
})
  .withActorId(true, { pk: true })
  .withCreatedAt(true)
  .index('by_object_id', ['_actor', 'object_id'])
  .uniqueIndex('by_object_id_field_type', ['_actor', 'object_id', 'field_type_id'])
