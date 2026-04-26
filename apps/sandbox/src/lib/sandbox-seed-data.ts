import type { AsyncSqliteDatabase } from '@worldbreakstudios/sink-lib'

const SANDBOX_FAKER_SEED = 20260322
const SANDBOX_ACTOR_COUNT = 3
const SANDBOX_OBJECT_TYPE_COUNT = 4
const SANDBOX_OBJECTS_PER_ACTOR = 5
const SANDBOX_DEMOS_PER_ACTOR = 4
const SANDBOX_MANUAL_ID_TEST_COUNT = 6

type SeedRow = Record<string, unknown>
type SeedDataset = {
  actors: SeedRow[]
  fieldTypes: SeedRow[]
  objectTypes: SeedRow[]
  objects: SeedRow[]
  fields: SeedRow[]
  demos: SeedRow[]
  idManualTests: SeedRow[]
}

export async function ensureSandboxSeedData(
  db: AsyncSqliteDatabase,
): Promise<void> {
  const tableCounts = await readSandboxSeedCounts(db)

  if (Object.values(tableCounts).every((count) => count > 0)) {
    return
  }

  const seedData = await buildSandboxSeedData(db)

  await db.execute('BEGIN;')

  try {
    // Keep lookup/base tables ahead of dependent rows so FK inserts stay valid.
    await insertRows(db, 'actors', seedData.actors)
    await insertRows(db, 'fieldTypes', seedData.fieldTypes)
    await insertRows(db, 'objectTypes', seedData.objectTypes)
    await insertRows(db, 'objects', seedData.objects)
    await insertRows(db, 'fields', seedData.fields)
    await insertRows(db, 'demos', seedData.demos)
    await insertRows(db, 'idManualTests', seedData.idManualTests)
    await db.execute('COMMIT;')
  } catch (error) {
    await db.execute('ROLLBACK;')
    throw error
  }
}

async function readSandboxSeedCounts(
  db: AsyncSqliteDatabase,
): Promise<Record<keyof SeedDataset, number>> {
  const [
    actors,
    fieldTypes,
    objectTypes,
    objects,
    fields,
    demos,
    idManualTests,
  ] = await Promise.all([
    countRows(db, 'actors'),
    countRows(db, 'fieldTypes'),
    countRows(db, 'objectTypes'),
    countRows(db, 'objects'),
    countRows(db, 'fields'),
    countRows(db, 'demos'),
    countRows(db, 'idManualTests'),
  ])

  return {
    actors,
    fieldTypes,
    objectTypes,
    objects,
    fields,
    demos,
    idManualTests,
  }
}

async function countRows(
  db: AsyncSqliteDatabase,
  tableName: string,
): Promise<number> {
  const rows = await db.query<{ count: number }>(
    `SELECT COUNT(*) AS count FROM "${tableName}";`,
  )

  return rows[0]?.count ?? 0
}

async function buildSandboxSeedData(
  db: AsyncSqliteDatabase,
): Promise<SeedDataset> {
  const { faker } = await import('@faker-js/faker')

  faker.seed(SANDBOX_FAKER_SEED)

  let timestampCursor = BigInt(Date.parse('2025-01-01T12:00:00.000Z'))
  const nextTimestamp = (maxStepMinutes = 180): bigint => {
    const value = timestampCursor
    timestampCursor += BigInt(
      faker.number.int({
        min: 2,
        max: maxStepMinutes,
      }) * 60_000,
    )
    return value
  }
  const createId = (prefix?: string): string => {
    const base = faker.string.alphanumeric({
      length: 24,
      casing: 'lower',
    })

    return prefix ? `${prefix}_${base}` : base
  }
  const createBaseRow = async (
    tableName: keyof SeedDataset | 'actors',
  ): Promise<SeedRow> => {
    const row = (await db.createInsertableRow(tableName)) as SeedRow
    return { ...row }
  }

  const actors = await Promise.all(
    Array.from({ length: SANDBOX_ACTOR_COUNT }, async () => {
      const row = await createBaseRow('actors')
      row._id = createId('actor')
      return row
    }),
  )

  const fieldTypeLabels = [
    'text',
    'rich_text',
    'status',
    'priority',
    'tag_set',
  ]
  const fieldTypes = await Promise.all(
    fieldTypeLabels.map(async (name) => {
      const row = await createBaseRow('fieldTypes')
      row._id = createId('field_type')
      row.name = name
      return row
    }),
  )
  const objectTypeNames = faker.helpers.uniqueArray(
    () =>
      faker.helpers.arrayElement([
        `${faker.word.adjective()} ${faker.word.noun()}`,
        faker.company.buzzNoun(),
        faker.commerce.department(),
      ]).toLowerCase(),
    SANDBOX_OBJECT_TYPE_COUNT,
  )
  const objectTypes = await Promise.all(
    objectTypeNames.map(async (name) => {
      const row = await createBaseRow('objectTypes')
      row._id = createId('object_type')
      row.name = name
      return row
    }),
  )

  const objects: SeedRow[] = []

  for (const actor of actors) {
    for (let index = 0; index < SANDBOX_OBJECTS_PER_ACTOR; index += 1) {
      const row = await createBaseRow('objects')
      row._actor = actor._id
      row._id = createId('object')
      row._createdAt = nextTimestamp()
      row.type_id = faker.helpers.arrayElement(objectTypes)._id
      objects.push(row)
    }
  }

  const statusChoices = ['draft', 'open', 'in_progress', 'done', 'blocked']
  const priorityChoices = ['low', 'medium', 'high', 'urgent']
  const fields: SeedRow[] = []

  for (const objectRow of objects) {
    const selectedFieldTypes = faker.helpers.arrayElements(
      fieldTypes,
      faker.number.int({
        min: 2,
        max: Math.min(4, fieldTypes.length),
      }),
    )

    for (const fieldType of selectedFieldTypes) {
      const row = await createBaseRow('fields')
      row._actor = objectRow._actor
      row._id = createId('field')
      row._createdAt = nextTimestamp()
      row.object_id = objectRow._id
      row.field_type_id = fieldType._id
      row.name = String(fieldType.name)

      switch (fieldType.name) {
        case 'status':
          row.body = faker.helpers.arrayElement(statusChoices)
          break
        case 'priority':
          row.body = faker.helpers.arrayElement(priorityChoices)
          break
        case 'tag_set':
          row.body = faker.helpers.arrayElements(
            ['alpha', 'beta', 'customer', 'internal', 'review'],
            faker.number.int({ min: 1, max: 3 }),
          ).join(', ')
          break
        case 'rich_text':
          row.body = faker.lorem.paragraphs({ min: 1, max: 2 }, '\n\n')
          break
        default:
          row.body = faker.lorem.sentence()
          break
      }

      fields.push(row)
    }
  }

  const demos: SeedRow[] = []

  for (const actor of actors) {
    const actorObjects = objects.filter((row) => row._actor === actor._id)

    for (let index = 0; index < SANDBOX_DEMOS_PER_ACTOR; index += 1) {
      const objectRow = faker.helpers.arrayElement(actorObjects)
      const optionalObjectRow = faker.datatype.boolean(0.65)
        ? faker.helpers.arrayElement(actorObjects)
        : null
      const createdAt = nextTimestamp()
      const archived = faker.datatype.boolean(0.15)
      const row = await createBaseRow('demos')

      row._actor = actor._id
      row._id = createId('demo')
      row._createdAt = createdAt
      row._updatedAt = createdAt + BigInt(faker.number.int({ min: 60_000, max: 21_600_000 }))
      row._archivedAt = archived
        ? createdAt + BigInt(faker.number.int({ min: 21_600_000, max: 172_800_000 }))
        : null
      row.label = `${faker.commerce.productName()} ${index + 1}`
      row.count = faker.number.int({ min: 1, max: 100 })
      row.ratio = Number(
        faker.number.float({
          min: 0.05,
          max: 0.99,
          fractionDigits: 3,
        }).toFixed(3),
      )
      row.is_active = faker.datatype.boolean(0.7)
      row.field_type_id = faker.helpers.arrayElement(fieldTypes)._id
      row.object_id = objectRow._id
      row.optional_object_id = optionalObjectRow?._id ?? null
      row.tags = faker.helpers.uniqueArray(
        () => faker.word.adjective().toLowerCase(),
        faker.number.int({ min: 2, max: 4 }),
      )
      row.checkpoints = Array.from(
        { length: faker.number.int({ min: 2, max: 4 }) },
        (_unused, checkpointIndex) => ({
          label: faker.hacker.verb(),
          done: checkpointIndex === 0 || faker.datatype.boolean(0.35),
          order: checkpointIndex + 1,
        }),
      )
      row.settings = {
        layout: {
          mode: faker.helpers.arrayElement(['stacked', 'board', 'table']),
          density: faker.helpers.arrayElement(['compact', 'comfortable', 'spacious']),
        },
        retries: faker.number.int({ min: 0, max: 5 }),
        showHints: faker.datatype.boolean(0.6),
        featuredFieldTypeId: faker.helpers.arrayElement(fieldTypes)._id,
        thresholds: Array.from({ length: 3 }, () =>
          Number(
            faker.number.float({
              min: 0.1,
              max: 0.95,
              fractionDigits: 2,
            }).toFixed(2),
          ),
        ).sort((left, right) => left - right),
      }
      row.translations = {
        en: {
          title: faker.company.catchPhrase(),
          enabled: true,
        },
        fr: {
          title: faker.company.buzzPhrase(),
          enabled: faker.datatype.boolean(0.45),
        },
      }
      row.default_status = faker.helpers.arrayElement(statusChoices)
      row.default_score = Number(
        faker.number.float({
          min: 0.2,
          max: 0.99,
          fractionDigits: 2,
        }).toFixed(2),
      )
      row.default_flags = {
        archived,
        pinned: faker.datatype.boolean(0.4),
      }
      row.optional_notes = faker.datatype.boolean(0.6)
        ? faker.helpers.uniqueArray(
            () => faker.lorem.words({ min: 2, max: 5 }),
            faker.number.int({ min: 1, max: 3 }),
          )
        : null
      row.optional_feature_toggles = faker.datatype.boolean(0.55)
        ? {
            beta: faker.datatype.boolean(),
            compact: faker.datatype.boolean(),
            experimentalSearch: faker.datatype.boolean(),
          }
        : null

      demos.push(row)
    }
  }

  const idManualTests = await Promise.all(
    Array.from({ length: SANDBOX_MANUAL_ID_TEST_COUNT }, async () => {
      const row = await createBaseRow('idManualTests')
      row._id = `manual_${createId()}`
      row.name = faker.person.fullName()
      return row
    }),
  )

  return {
    actors,
    fieldTypes,
    objectTypes,
    objects,
    fields,
    demos,
    idManualTests,
  }
}

async function insertRows(
  db: AsyncSqliteDatabase,
  tableName: string,
  rows: SeedRow[],
): Promise<void> {
  if (rows.length === 0) {
    return
  }

  const columns = Object.keys(rows[0] ?? {})

  if (columns.length === 0) {
    return
  }

  const placeholderGroup = `(${columns.map(() => '?').join(', ')})`
  const sql = `INSERT OR IGNORE INTO "${tableName}" (${columns
    .map((columnName) => `"${columnName}"`)
    .join(', ')}) VALUES ${rows.map(() => placeholderGroup).join(', ')};`
  const bind = rows.flatMap((row) =>
    columns.map((columnName) => toSqlBindValue(row[columnName])),
  )

  await db.execute(sql, bind)
}

function toSqlBindValue(value: unknown): string | number | bigint | Uint8Array | null {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value === 'boolean') {
    return value ? 1 : 0
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    value instanceof Uint8Array
  ) {
    return value
  }

  return JSON.stringify(value)
}
