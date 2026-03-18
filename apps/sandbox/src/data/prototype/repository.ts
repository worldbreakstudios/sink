import type { AsyncSqliteDatabase } from '@sink/lib'
import type {
  FieldRow,
  Id,
  ObjectRow,
  ObjectTypeRow,
} from '../generated/schema.gen.ts'
import type { RepositoryContext } from './types.ts'

export function createSqlitePrototypeRepository(
  database: AsyncSqliteDatabase,
): RepositoryContext {
  return {
    actors: {
      async exists(actorId) {
        const rows = await database.query<{ matches: number }>(
          'SELECT COUNT(*) AS matches FROM "actors" WHERE "_id" = ?;',
          [actorId],
        )
        return (rows[0]?.matches ?? 0) > 0
      },
    },
    objectTypes: {
      async listAll() {
        const rows = await database.query<ObjectTypeRow>(
          'SELECT * FROM "objectTypes" ORDER BY "name" ASC, "_id" ASC;',
        )
        return rows
      },
      async getById(objectTypeId) {
        const rows = await database.query<ObjectTypeRow>(
          'SELECT * FROM "objectTypes" WHERE "_id" = ? LIMIT 1;',
          [objectTypeId],
        )
        return rows[0] ?? null
      },
      async rename(objectTypeId, name) {
        await database.execute(
          'UPDATE "objectTypes" SET "name" = ? WHERE "_id" = ?;',
          [name, objectTypeId],
        )
        const nextRow = await this.getById(objectTypeId)

        if (!nextRow) {
          throw new Error('Object type not found after rename.')
        }

        return nextRow
      },
    },
    objects: {
      async listByActor(actorId) {
        const rows = await database.query<Record<string, unknown>>(
          'SELECT * FROM "objects" WHERE "_actor" = ? ORDER BY "_createdAt" ASC, "_id" ASC;',
          [actorId],
        )
        return rows.map((row) => normalizeObjectRow(row))
      },
      async getById(key) {
        const rows = await database.query<Record<string, unknown>>(
          'SELECT * FROM "objects" WHERE "_actor" = ? AND "_id" = ? LIMIT 1;',
          [key._actor, key._id],
        )
        return rows[0] ? normalizeObjectRow(rows[0]) : null
      },
      async create(row) {
        await database.execute(
          'INSERT INTO "objects" ("_actor", "_id", "_createdAt", "type_id") VALUES (?, ?, ?, ?);',
          [row._actor, row._id, row._createdAt, row.type_id],
        )
        return row
      },
      async changeType(key, nextTypeId) {
        await database.execute(
          'UPDATE "objects" SET "type_id" = ? WHERE "_actor" = ? AND "_id" = ?;',
          [nextTypeId, key._actor, key._id],
        )

        const nextRow = await this.getById(key)

        if (!nextRow) {
          throw new Error('Object not found after update.')
        }

        return nextRow
      },
    },
    fields: {
      async listByObject(args) {
        const rows = await database.query<Record<string, unknown>>(
          `SELECT *
           FROM "fields"
           WHERE "_actor" = ? AND "object_id" = ?
           ORDER BY "_createdAt" ASC, "_id" ASC;`,
          [args.actorId, args.objectId],
        )
        return rows.map((row) => normalizeFieldRow(row))
      },
      async getByObjectFieldType(args) {
        const rows = await database.query<Record<string, unknown>>(
          `SELECT *
           FROM "fields"
           WHERE "_actor" = ? AND "object_id" = ? AND "field_type_id" = ?
           LIMIT 1;`,
          [args.actorId, args.objectId, args.fieldTypeId],
        )
        return rows[0] ? normalizeFieldRow(rows[0]) : null
      },
      async upsertByObjectFieldType(row) {
        const existing = await this.getByObjectFieldType({
          actorId: row._actor,
          objectId: row.object_id,
          fieldTypeId: row.field_type_id,
        })

        if (existing) {
          await database.execute(
            `UPDATE "fields"
             SET "name" = ?, "body" = ?
             WHERE "_actor" = ? AND "_id" = ?;`,
            [row.name, row.body, existing._actor, existing._id],
          )

          return {
            mode: 'updated' as const,
            field: {
              ...existing,
              name: row.name,
              body: row.body,
            },
          }
        }

        await database.execute(
          `INSERT INTO "fields" (
            "_actor",
            "_id",
            "_createdAt",
            "object_id",
            "field_type_id",
            "name",
            "body"
          ) VALUES (?, ?, ?, ?, ?, ?, ?);`,
          [
            row._actor,
            row._id,
            row._createdAt,
            row.object_id,
            row.field_type_id,
            row.name,
            row.body,
          ],
        )

        return {
          mode: 'inserted' as const,
          field: row,
        }
      },
    },
  }
}

export function normalizeObjectRow(row: Record<string, unknown>): ObjectRow {
  return {
    _actor: row._actor as Id<'actors'>,
    _id: row._id as Id<'objects'>,
    _createdAt: normalizeTimestamp(row._createdAt),
    type_id: row.type_id as Id<'objectTypes'>,
  }
}

export function normalizeFieldRow(row: Record<string, unknown>): FieldRow {
  return {
    _actor: row._actor as Id<'actors'>,
    _id: row._id as Id<'fields'>,
    _createdAt: normalizeTimestamp(row._createdAt),
    object_id: row.object_id as Id<'objects'>,
    field_type_id: row.field_type_id as Id<'fieldTypes'>,
    name: String(row.name ?? ''),
    body: String(row.body ?? ''),
  }
}

export function createObjectRow(input: {
  actorId: Id<'actors'>
  objectId: Id<'objects'>
  createdAt: bigint
  typeId: Id<'objectTypes'>
}): ObjectRow {
  return {
    _actor: input.actorId,
    _id: input.objectId,
    _createdAt: input.createdAt,
    type_id: input.typeId,
  }
}

export function createFieldRow(input: {
  actorId: Id<'actors'>
  fieldId: Id<'fields'>
  createdAt: bigint
  objectId: Id<'objects'>
  fieldTypeId: Id<'fieldTypes'>
  name: string
  body: string
}): FieldRow {
  return {
    _actor: input.actorId,
    _id: input.fieldId,
    _createdAt: input.createdAt,
    object_id: input.objectId,
    field_type_id: input.fieldTypeId,
    name: input.name,
    body: input.body,
  }
}

function normalizeTimestamp(value: unknown): bigint {
  if (typeof value === 'bigint') {
    return value
  }

  if (typeof value === 'number') {
    return BigInt(value)
  }

  if (typeof value === 'string') {
    return BigInt(value)
  }

  throw new Error(`Expected timestamp-compatible value, received ${String(value)}.`)
}
