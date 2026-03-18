import type { FieldKey, FieldRow, Id } from './generated/schema.gen.ts'
import { createFieldRow } from './prototype/repository.ts'
import { createUniqueLockTarget, readLocalRowsForTable } from './prototype/helpers.ts'
import { prototypeValuesEqual } from './prototype/json.ts'
import type { MutationDefinition } from './prototype/types.ts'

export interface UpsertFieldByObjectTypeArgs {
  actorId: Id<'actors'>
  objectId: Id<'objects'>
  fieldTypeId: Id<'fieldTypes'>
  fieldId: Id<'fields'>
  createdAt: bigint
  name: string
  body: string
}

export interface UpsertFieldByObjectTypeResult {
  field: FieldRow
  mode: 'inserted' | 'updated'
}

export const upsertFieldByObjectTypeMutation = {
  kind: 'mutation',
  name: 'fields.upsertByObjectFieldType',
  lockTargets(args) {
    return [
      createUniqueLockTarget('fields', 'by_object_id_field_type', {
        _actor: args.actorId,
        object_id: args.objectId,
        field_type_id: args.fieldTypeId,
      }),
    ]
  },
  async applyLocal(context, args) {
    const currentRows = readLocalRowsForTable(context.collections, 'fields')
    const existingRow = (currentRows as FieldRow[]).find(
      (row) =>
        row._actor === args.actorId &&
        row.object_id === args.objectId &&
        row.field_type_id === args.fieldTypeId,
    )

    if (existingRow) {
      const nextField: FieldRow = {
        ...existingRow,
        name: args.name,
        body: args.body,
      }

      context.transaction.mutate(() => {
        context.collections.fields.update(
          {
            _actor: existingRow._actor,
            _id: existingRow._id,
          } satisfies FieldKey,
          (draft) => {
            draft.name = args.name
            draft.body = args.body
          },
        )
      })

      return {
        field: nextField,
        mode: 'updated' as const,
      }
    }

    const nextField = createFieldRow({
      actorId: args.actorId,
      fieldId: args.fieldId,
      createdAt: args.createdAt,
      objectId: args.objectId,
      fieldTypeId: args.fieldTypeId,
      name: args.name,
      body: args.body,
    })

    context.transaction.mutate(() => {
      context.collections.fields.insert(nextField)
    })

    return {
      field: nextField,
      mode: 'inserted' as const,
    }
  },
  async runServer(context, args) {
    const object = await context.repo.objects.getById({
      _actor: args.actorId,
      _id: args.objectId,
    })

    if (!object) {
      throw new Error('Object not found.')
    }

    return context.repo.fields.upsertByObjectFieldType(
      createFieldRow({
        actorId: args.actorId,
        fieldId: args.fieldId,
        createdAt: args.createdAt,
        objectId: args.objectId,
        fieldTypeId: args.fieldTypeId,
        name: args.name,
        body: args.body,
      }),
    )
  },
  resultsEqual(localResult, serverResult) {
    return prototypeValuesEqual(localResult, serverResult)
  },
  invalidate(_args, result) {
    return [
      {
        tableName: 'fields',
        keys: [{
          _actor: result.field._actor,
          _id: result.field._id,
        }],
      },
    ]
  },
} satisfies MutationDefinition<
  UpsertFieldByObjectTypeArgs,
  UpsertFieldByObjectTypeResult,
  UpsertFieldByObjectTypeResult
>
