import { defineTable, v } from '@worldbreakstudios/sink-lib'

export default defineTable('demos', {
  label: v.string(),
  count: v.number(),
  ratio: v.float(),
  is_active: v.boolean(),
  field_type_id: v.id('fieldTypes', { enforceExists: true }),
  object_id: v.id('objects'),
  optional_object_id: v.nullable(v.id('objects')),
  tags: v.array(v.string()),
  checkpoints: v.array(v.object({
    label: v.string(),
    done: v.boolean(),
    order: v.number(),
  })),
  settings: v.object({
    layout: v.object({
      mode: v.string(),
      density: v.string(),
    }),
    retries: v.number(),
    showHints: v.boolean(),
    featuredFieldTypeId: v.id('fieldTypes'),
    thresholds: v.array(v.float()),
  }),
  translations: v.record(v.string(), v.object({
    title: v.string(),
    enabled: v.boolean(),
  })),
  default_status: v.default(v.string(), 'draft'),
  default_score: v.default(v.float(), 0.75),
  default_flags: v.default(v.object({
    archived: v.boolean(),
    pinned: v.boolean(),
  }), { archived: false, pinned: true }),
  optional_notes: v.nullable(v.array(v.string())),
  optional_feature_toggles: v.nullable(v.record(v.string(), v.boolean())),
})
  .withActorId(true)
  .withCreatedAt(true)
  .withUpdatedAt(true)
  .withArchivedAt(true)
  .index('by_label', ['_actor', 'label'])
  .index('by_field_type_id', ['_actor', 'field_type_id'])
  .index('by_settings_layout_mode', ['_actor', 'settings.layout.mode'])
