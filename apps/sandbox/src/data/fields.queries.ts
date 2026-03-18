import type { FieldRow, Id } from './generated/schema.gen.ts'
import { fieldRowBelongsToObject, invalidationTouchesTable, readLocalRowsForTable, reconcileScopedRows } from './prototype/helpers.ts'
import type { QueryDefinition } from './prototype/types.ts'

export interface ListFieldsByObjectArgs {
  actorId: Id<'actors'>
  objectId: Id<'objects'>
}

export const listFieldsByObjectQuery = {
  kind: 'query',
  name: 'fields.listByObject',
  tables: ['fields'],
  async readLocal(context, args) {
    const rows = readLocalRowsForTable(context.collections, 'fields')
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
