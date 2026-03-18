import type { FieldRow, Id } from '@/data/generated/schema.gen'
import { fieldRowBelongsToObject, invalidationTouchesTable, reconcileScopedRows } from '@/data/prototype/helpers'
import type { QueryDefinition } from '@/data/prototype/types'

export interface ListFieldsByObjectArgs {
  actorId: Id<'actors'>
  objectId: Id<'objects'>
}

export const listFieldsByObjectQuery = {
  kind: 'query',
  name: 'fields.listByObject',
  tables: ['fields'],
  async readLocal(context, args) {
    const rows = await context.collections.fields.utils.readAll()
    return (rows as FieldRow[]).filter((row) =>
      fieldRowBelongsToObject(row, args.actorId, args.objectId),
    )
  },
  async runServer(context, args) {
    return context.repo.fields.listByObject(args)
  },
  async mergeServer(context, args, result) {
    await reconcileScopedRows(
      context,
      'fields',
      result,
      (row) =>
        fieldRowBelongsToObject(
          row as FieldRow,
          args.actorId,
          args.objectId,
        ),
    )
  },
  matchesInvalidation(_args, targets) {
    return invalidationTouchesTable(targets, 'fields')
  },
} satisfies QueryDefinition<ListFieldsByObjectArgs, FieldRow[]>
