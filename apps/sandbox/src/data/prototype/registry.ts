import { listFieldsByObjectQuery } from '@/data/fields.queries'
import { upsertFieldByObjectTypeMutation } from '@/data/fields.mutations'
import { listObjectTypesQuery } from '@/data/objectTypes.queries'
import { renameObjectTypeMutation } from '@/data/objectTypes.mutations'
import {
  changeObjectTypeMutation,
  createObjectMutation,
} from '@/data/objects/objects.mutations'
import {
  getObjectByIdQuery,
  listObjectsByActorQuery,
} from '@/data/objects/objects.queries'
import type { MutationRegistry, QueryRegistry } from './types'

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
