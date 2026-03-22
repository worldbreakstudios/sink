import type { AsyncSqliteDatabase } from '@sink/lib'

const aliceActorId = '0d3cf6b9c81d41c8b8ad84c3550d0e62'
const bobActorId = 'c24370ab27aa4a7d9a2f6d679c5f9d08'
const textFieldTypeId = '6f8a2d9c4b7e1a3055d4f913a27be1c0'
const richTextFieldTypeId = '2aa74d9e51c84f63b08d72ce4a19f6b2'
const statusFieldTypeId = '1bd91f0a6c7e4d3fb185aa9246ce8f71'
const noteObjectTypeId = '24a7c31ef20d4b68a15f77c2de983ab4'
const taskObjectTypeId = '38e5d72ab904f36be21d44a89f0c6d3f'
const inboxObjectId = '4ea96bf14cd82750a8d2e6719f43bc05'
const taskObjectId = '57c9e20f34b8716ad2495ce30f8ab164'
const titleFieldId = '68f1be24ad70953c41e28fd6bc3a0175'
const bodyFieldId = '73a2d5f91c8e4067bb14de2559fa6c82'
const statusFieldId = '8ce34a71d29540f6ab167e4c3d8bf025'
const demoRowId = '9df6271b493d4b1ebed6e9442e680f11'

const inboxObjectCreatedAt = 1709748000000n
const taskObjectCreatedAt = 1709748600000n
const titleFieldCreatedAt = 1709748120000n
const bodyFieldCreatedAt = 1709748180000n
const statusFieldCreatedAt = 1709748720000n
const demoCreatedAt = 1709748840000n
const demoUpdatedAt = 1709748900000n

export async function ensureSandboxSeedData(
  db: AsyncSqliteDatabase,
): Promise<void> {
  const existingRows = await db.query<{ count: number }>(
    'SELECT COUNT(*) AS count FROM fieldTypes;',
  )

  if ((existingRows[0]?.count ?? 0) === 0) {
    await seedCoreData(db)
  }

  const existingDemoRows = await db.query<{ count: number }>(
    'SELECT COUNT(*) AS count FROM demos;',
  )

  if ((existingDemoRows[0]?.count ?? 0) === 0) {
    await seedCodegenDemoTable(db)
  }
}

async function seedCoreData(db: AsyncSqliteDatabase): Promise<void> {
  await db.execute(
    `INSERT INTO actors (_id) VALUES (?), (?);`,
    [aliceActorId, bobActorId],
  )

  await db.execute(
    `INSERT INTO fieldTypes (_id, name) VALUES (?, ?), (?, ?), (?, ?);`,
    [textFieldTypeId, 'text', richTextFieldTypeId, 'rich_text', statusFieldTypeId, 'status'],
  )

  await db.execute(
    `INSERT INTO objectTypes (_id, name) VALUES (?, ?), (?, ?);`,
    [noteObjectTypeId, 'note', taskObjectTypeId, 'task'],
  )

  await db.execute(
    `INSERT INTO objects (_actor, _id, _createdAt, type_id) VALUES (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?);`,
    [
      aliceActorId, inboxObjectId, inboxObjectCreatedAt, noteObjectTypeId,
      aliceActorId, taskObjectId, taskObjectCreatedAt, taskObjectTypeId,
      bobActorId, inboxObjectId, inboxObjectCreatedAt, noteObjectTypeId,
    ],
  )

  await db.execute(
    `INSERT INTO fields (_actor, _id, _createdAt, object_id, field_type_id, name, body) VALUES (?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?);`,
    [
      aliceActorId, titleFieldId, titleFieldCreatedAt, inboxObjectId, textFieldTypeId, 'title', 'Welcome note title',
      aliceActorId, bodyFieldId, bodyFieldCreatedAt, inboxObjectId, richTextFieldTypeId, 'body', 'Initial sandbox note body',
      aliceActorId, statusFieldId, statusFieldCreatedAt, taskObjectId, statusFieldTypeId, 'status', 'open',
    ],
  )
}

async function seedCodegenDemoTable(db: AsyncSqliteDatabase): Promise<void> {
  await db.execute(
    `INSERT INTO demos (
      _actor,
      _id,
      _createdAt,
      _updatedAt,
      _archivedAt,
      label,
      count,
      ratio,
      is_active,
      field_type_id,
      object_id,
      optional_object_id,
      tags,
      checkpoints,
      settings,
      translations,
      default_status,
      default_score,
      default_flags,
      optional_notes,
      optional_feature_toggles
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      aliceActorId,
      demoRowId,
      demoCreatedAt,
      demoUpdatedAt,
      null,
      'All codegen types',
      7,
      0.875,
      1,
      richTextFieldTypeId,
      inboxObjectId,
      taskObjectId,
      JSON.stringify(['demo', 'nested', 'codegen']),
      JSON.stringify([
        { label: 'Define schema', done: true, order: 1 },
        { label: 'Generate types', done: true, order: 2 },
        { label: 'Render in sandbox', done: false, order: 3 },
      ]),
      JSON.stringify({
        layout: {
          mode: 'stacked',
          density: 'comfortable',
        },
        retries: 3,
        showHints: true,
        featuredFieldTypeId: textFieldTypeId,
        thresholds: [0.25, 0.5, 0.75],
      }),
      JSON.stringify({
        en: {
          title: 'Codegen demo',
          enabled: true,
        },
        fr: {
          title: 'Demo de generation',
          enabled: false,
        },
      }),
      'seeded',
      0.98,
      JSON.stringify({
        archived: false,
        pinned: true,
      }),
      JSON.stringify(['nullable array example', 'edit me as JSON']),
      JSON.stringify({
        beta: true,
        compact: false,
      }),
    ],
  )
}
