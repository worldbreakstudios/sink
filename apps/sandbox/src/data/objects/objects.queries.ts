import type { Id, ObjectKey, ObjectRow } from '@/data/generated/schema.gen'
import { invalidationTouchesTable, objectRowBelongsToActor, reconcileScopedRows } from '@/data/prototype/helpers'
import type { QueryDefinition } from '@/data/prototype/types'

export interface ListObjectsByActorArgs {
  actorId: Id<'actors'>
}

export interface GetObjectByIdArgs {
  actorId: Id<'actors'>
  objectId: Id<'objects'>
}

export const listObjectsByActorQuery = {
  kind: 'query',
  name: 'objects.listByActor',
  tables: ['objects'],
  async readLocal(context, args) {
    const rows = await context.collections.objects.utils.readAll()
    return (rows as ObjectRow[]).filter((row) =>
      objectRowBelongsToActor(row, args.actorId),
    )
  },
  async runServer(context, args) {
    return context.repo.objects.listByActor(args.actorId)
  },
  async mergeServer(context, args, result) {
    await reconcileScopedRows(
      context,
      'objects',
      result,
      (row) => objectRowBelongsToActor(row as ObjectRow, args.actorId),
    )
  },
  matchesInvalidation(_args, targets) {
    return invalidationTouchesTable(targets, 'objects')
  },
} satisfies QueryDefinition<ListObjectsByActorArgs, ObjectRow[]>

export const getObjectByIdQuery = {
  kind: 'query',
  name: 'objects.getById',
  tables: ['objects'],
  async readLocal(context, args) {
    const rows = await context.collections.objects.utils.readAll()
    return (
      (rows as ObjectRow[]).find(
        (row) => row._actor === args.actorId && row._id === args.objectId,
      ) ?? null
    )
  },
  async runServer(context, args) {
    return context.repo.objects.getById({
      _actor: args.actorId,
      _id: args.objectId,
    } satisfies ObjectKey)
  },
  async mergeServer(context, args, result) {
    await reconcileScopedRows(
      context,
      'objects',
      result ? [result] : [],
      (row) =>
        (row as ObjectRow)._actor === args.actorId &&
        (row as ObjectRow)._id === args.objectId,
    )
  },
  matchesInvalidation(_args, targets) {
    return invalidationTouchesTable(targets, 'objects')
  },
} satisfies QueryDefinition<GetObjectByIdArgs, ObjectRow | null>
