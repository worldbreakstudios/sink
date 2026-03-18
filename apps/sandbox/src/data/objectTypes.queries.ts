import type { ObjectTypeRow } from '@/data/generated/schema.gen'
import { type QueryDefinition } from '@/data/prototype/types'
import { invalidationTouchesTable, normalizeObjectTypeRows, reconcileScopedRows } from '@/data/prototype/helpers'

export interface ListObjectTypesArgs {}

export const listObjectTypesQuery = {
  kind: 'query',
  name: 'objectTypes.listAll',
  tables: ['objectTypes'],
  async readLocal(context) {
    const rows = await context.collections.objectTypes.utils.readAll()
    return normalizeObjectTypeRows(rows as ObjectTypeRow[])
  },
  async runServer(context) {
    return normalizeObjectTypeRows(await context.repo.objectTypes.listAll())
  },
  async mergeServer(context, _args, result) {
    await reconcileScopedRows(
      context,
      'objectTypes',
      result,
      () => true,
    )
  },
  matchesInvalidation(_args, targets) {
    return invalidationTouchesTable(targets, 'objectTypes')
  },
} satisfies QueryDefinition<ListObjectTypesArgs, ObjectTypeRow[]>
