import type { ObjectTypeRow } from '../generated/schema.gen.ts'
import { type QueryDefinition } from '../prototype/types.ts'
import {
  invalidationTouchesTable,
  normalizeObjectTypeRows,
  readLocalRowsForTable,
  reconcileScopedRows,
} from '../prototype/helpers.ts'

export interface ListObjectTypesArgs {}

export const listObjectTypesQuery = {
  kind: 'query',
  name: 'objectTypes.listAll',
  tables: ['objectTypes'],
  async readLocal(context) {
    const rows = readLocalRowsForTable(context.collections, 'objectTypes')
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
