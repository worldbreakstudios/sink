import { upsertFieldByObjectTypeMutation } from '../fields/fields.mutations.ts'
import { listFieldsByObjectQuery } from '../fields/fields.queries.ts'
import {
  renameObjectTypeMutation,
} from '../objectTypes/objectTypes.mutations.ts'
import { listObjectTypesQuery } from '../objectTypes/objectTypes.queries.ts'
import {
  changeObjectTypeMutation,
  createObjectMutation,
} from '../objects/objects.mutations.ts'
import {
  getObjectByIdQuery,
  listObjectsByActorQuery,
} from '../objects/objects.queries.ts'
import type { MutationRegistry, QueryRegistry } from './types.ts'

export const prototypeQueries = {
  [listObjectTypesQuery.name]: listObjectTypesQuery,
  [listObjectsByActorQuery.name]: listObjectsByActorQuery,
  [getObjectByIdQuery.name]: getObjectByIdQuery,
  [listFieldsByObjectQuery.name]: listFieldsByObjectQuery,
} satisfies QueryRegistry

export const prototypeMutations = {
  [createObjectMutation.name]: createObjectMutation,
  [changeObjectTypeMutation.name]: changeObjectTypeMutation,
  [upsertFieldByObjectTypeMutation.name]: upsertFieldByObjectTypeMutation,
  [renameObjectTypeMutation.name]: renameObjectTypeMutation,
} satisfies MutationRegistry
