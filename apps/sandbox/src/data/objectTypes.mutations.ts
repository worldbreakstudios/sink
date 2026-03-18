import type { Id, ObjectTypeRow } from './generated/schema.gen.ts'
import { createPrimaryLockTarget } from './prototype/helpers.ts'
import { prototypeValuesEqual } from './prototype/json.ts'
import type { MutationDefinition } from './prototype/types.ts'

export interface RenameObjectTypeArgs {
  objectTypeId: Id<'objectTypes'>
  name: string
}

export interface RenameObjectTypeResult {
  objectType: ObjectTypeRow
}

export const renameObjectTypeMutation = {
  kind: 'mutation',
  name: 'objectTypes.rename',
  lockTargets(args) {
    return [
      createPrimaryLockTarget('objectTypes', args.objectTypeId),
    ]
  },
  async applyLocal(context, args) {
    const currentRows = await context.collections.objectTypes.utils.readAll()
    const currentRow = currentRows.find((row) => row._id === args.objectTypeId) as ObjectTypeRow | undefined

    if (!currentRow) {
      throw new Error('Object type not found.')
    }

    const nextRow: ObjectTypeRow = {
      ...currentRow,
      name: args.name,
    }

    context.transaction.mutate(() => {
      context.collections.objectTypes.update(args.objectTypeId, (draft) => {
        draft.name = args.name
      })
    })

    return { objectType: nextRow }
  },
  async runServer(context, args) {
    return {
      objectType: await context.repo.objectTypes.rename(
        args.objectTypeId,
        args.name,
      ),
    }
  },
  resultsEqual(localResult, serverResult) {
    return prototypeValuesEqual(localResult, serverResult)
  },
  invalidate(_args, result) {
    return [
      {
        tableName: 'objectTypes',
        keys: [result.objectType._id],
      },
    ]
  },
} satisfies MutationDefinition<
  RenameObjectTypeArgs,
  RenameObjectTypeResult,
  RenameObjectTypeResult
>
