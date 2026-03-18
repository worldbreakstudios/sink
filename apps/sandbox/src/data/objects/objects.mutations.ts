import type { Id, ObjectRow } from '../generated/schema.gen.ts'
import { createObjectRow } from '../prototype/repository.ts'
import { createPrimaryLockTarget, readLocalRowsForTable } from '../prototype/helpers.ts'
import { prototypeValuesEqual } from '../prototype/json.ts'
import type { MutationDefinition } from '../prototype/types.ts'

export interface CreateObjectArgs {
  actorId: Id<'actors'>
  objectId: Id<'objects'>
  createdAt: bigint
  typeId: Id<'objectTypes'>
}

export interface ChangeObjectTypeArgs {
  actorId: Id<'actors'>
  objectId: Id<'objects'>
  nextTypeId: Id<'objectTypes'>
}

export interface ObjectMutationResult {
  object: ObjectRow
}

export const createObjectMutation = {
  kind: 'mutation',
  name: 'objects.create',
  lockTargets(args) {
    return [
      createPrimaryLockTarget('objects', {
        _actor: args.actorId,
        _id: args.objectId,
      }),
    ]
  },
  async applyLocal(context, args) {
    const row = createObjectRow({
      actorId: args.actorId,
      objectId: args.objectId,
      createdAt: args.createdAt,
      typeId: args.typeId,
    })

    context.transaction.mutate(() => {
      context.collections.objects.insert(row)
    })

    return { object: row }
  },
  async runServer(context, args) {
    const actorExists = await context.repo.actors.exists(args.actorId)

    if (!actorExists) {
      throw new Error('Actor not found.')
    }

    const objectType = await context.repo.objectTypes.getById(args.typeId)

    if (!objectType) {
      throw new Error('Object type not found.')
    }

    return {
      object: await context.repo.objects.create(
        createObjectRow({
          actorId: args.actorId,
          objectId: args.objectId,
          createdAt: args.createdAt,
          typeId: args.typeId,
        }),
      ),
    }
  },
  resultsEqual(localResult, serverResult) {
    return prototypeValuesEqual(localResult, serverResult)
  },
  invalidate(_args, result) {
    return [
      {
        tableName: 'objects',
        keys: [{
          _actor: result.object._actor,
          _id: result.object._id,
        }],
      },
    ]
  },
} satisfies MutationDefinition<CreateObjectArgs, ObjectMutationResult, ObjectMutationResult>

export const changeObjectTypeMutation = {
  kind: 'mutation',
  name: 'objects.changeType',
  lockTargets(args) {
    return [
      createPrimaryLockTarget('objects', {
        _actor: args.actorId,
        _id: args.objectId,
      }),
    ]
  },
  async applyLocal(context, args) {
    const currentRows = readLocalRowsForTable(context.collections, 'objects')
    const currentRow = (currentRows as ObjectRow[]).find(
      (row) => row._actor === args.actorId && row._id === args.objectId,
    )

    if (!currentRow) {
      throw new Error('Object not found.')
    }

    const nextRow: ObjectRow = {
      ...currentRow,
      type_id: args.nextTypeId,
    }

    context.transaction.mutate(() => {
      context.collections.objects.update(
        {
          _actor: args.actorId,
          _id: args.objectId,
        },
        (draft) => {
          draft.type_id = args.nextTypeId
        },
      )
    })

    return { object: nextRow }
  },
  async runServer(context, args) {
    const objectType = await context.repo.objectTypes.getById(args.nextTypeId)

    if (!objectType) {
      throw new Error('Object type not found.')
    }

    return {
      object: await context.repo.objects.changeType(
        {
          _actor: args.actorId,
          _id: args.objectId,
        },
        args.nextTypeId,
      ),
    }
  },
  resultsEqual(localResult, serverResult) {
    return prototypeValuesEqual(localResult, serverResult)
  },
  invalidate(_args, result) {
    return [
      {
        tableName: 'objects',
        keys: [{
          _actor: result.object._actor,
          _id: result.object._id,
        }],
      },
    ]
  },
} satisfies MutationDefinition<ChangeObjectTypeArgs, ObjectMutationResult, ObjectMutationResult>
