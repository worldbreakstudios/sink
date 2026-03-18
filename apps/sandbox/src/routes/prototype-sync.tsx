import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useLiveQuery } from '@tanstack/react-db'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { listFieldsByObjectQuery } from '@/data/fields.queries'
import { upsertFieldByObjectTypeMutation } from '@/data/fields.mutations'
import { serializePrototypeJson } from '@/data/prototype/json'
import type { PrototypeSyncSnapshot } from '@/data/prototype/types'
import { listObjectTypesQuery } from '@/data/objectTypes.queries'
import { changeObjectTypeMutation, createObjectMutation } from '@/data/objects/objects.mutations'
import { listObjectsByActorQuery } from '@/data/objects/objects.queries'
import type { FieldRow, Id, ObjectRow, ObjectTypeRow } from '@/data/generated/schema.gen'
import {
  createPrototypeSyncWorkspace,
  resolvePrototypeServerUrl,
  type PrototypeSyncWorkspace,
} from '@/lib/prototype-sync-workspace'
import { hardClearSqliteDemoLocalDatabase } from '@/lib/sqlite-demo-collections'

const emptySyncSnapshot: PrototypeSyncSnapshot = {
  connection: 'stopped',
  activeTransactions: 0,
  offlineQueue: 0,
  conflicts: [],
  lastError: null,
  lastInvalidationAt: null,
} as const

export const Route = createFileRoute('/prototype-sync')({
  ssr: false,
  component: PrototypeSyncPage,
})

interface FieldDraft {
  fieldTypeId: Id<'fieldTypes'> | ''
  name: string
  body: string
}

function PrototypeSyncPage() {
  const [workspace, setWorkspace] = useState<PrototypeSyncWorkspace | null>(null)
  const [loadingError, setLoadingError] = useState<string | null>(null)
  const [selectedActorId, setSelectedActorId] = useState<Id<'actors'> | ''>('')
  const [newObjectTypeId, setNewObjectTypeId] = useState<Id<'objectTypes'> | ''>('')
  const [fieldDrafts, setFieldDrafts] = useState<Record<string, FieldDraft>>({})
  const [actionError, setActionError] = useState<string | null>(null)
  const [resetError, setResetError] = useState<string | null>(null)
  const [isClearingLocal, setIsClearingLocal] = useState(false)
  const [isResettingServer, setIsResettingServer] = useState(false)
  const workspaceRef = useRef<PrototypeSyncWorkspace | null>(null)

  useEffect(() => {
    let cancelled = false

    createPrototypeSyncWorkspace()
      .then((nextWorkspace) => {
        if (cancelled) {
          void nextWorkspace.close().catch((error) => {
            if (!isExpectedShutdownError(error)) {
              console.error(error)
            }
          })
          return
        }

        workspaceRef.current = nextWorkspace
        setWorkspace(nextWorkspace)
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadingError(error instanceof Error ? error.message : String(error))
        }
      })

    return () => {
      cancelled = true
      const currentWorkspace = workspaceRef.current
      workspaceRef.current = null

      if (currentWorkspace) {
        void currentWorkspace.close().catch((error) => {
          if (!isExpectedShutdownError(error)) {
            console.error(error)
          }
        })
      }
    }
  }, [])

  const syncSnapshot = useSyncExternalStore(
    workspace?.syncClient.subscribe ?? (() => () => {}),
    workspace?.syncClient.getSnapshot ?? (() => emptySyncSnapshot),
  )

  const actorsCollection = workspace?.base.collections.actors
  const objectTypesCollection = workspace?.base.collections.objectTypes
  const objectsCollection = workspace?.base.collections.objects
  const fieldsCollection = workspace?.base.collections.fields
  const fieldTypesCollection = workspace?.base.collections.fieldTypes

  const actorsQuery = useLiveQuery(
    () => actorsCollection as never,
    [actorsCollection as never],
  )
  const objectTypesQuery = useLiveQuery(
    () => objectTypesCollection as never,
    [objectTypesCollection as never],
  )
  const objectsQuery = useLiveQuery(
    () => objectsCollection as never,
    [objectsCollection as never],
  )
  const fieldsQuery = useLiveQuery(
    () => fieldsCollection as never,
    [fieldsCollection as never],
  )
  const fieldTypesQuery = useLiveQuery(
    () => fieldTypesCollection as never,
    [fieldTypesCollection as never],
  )

  const actors = (actorsQuery.data ?? []) as Array<{ _id: Id<'actors'> }>
  const objectTypes = (objectTypesQuery.data ?? []) as ObjectTypeRow[]
  const objects = ((objectsQuery.data ?? []) as ObjectRow[]).filter((row) =>
    selectedActorId === '' ? false : row._actor === selectedActorId,
  )
  const fields = ((fieldsQuery.data ?? []) as FieldRow[]).filter((row) =>
    selectedActorId === '' ? false : row._actor === selectedActorId,
  )
  const fieldTypes = (fieldTypesQuery.data ?? []) as Array<{
    _id: Id<'fieldTypes'>
    name: string
  }>
  const watchedObjectIds = objects.map((objectRow) => objectRow._id).join('|')

  useEffect(() => {
    if (selectedActorId === '' && actors[0]?._id) {
      setSelectedActorId(actors[0]._id)
    }
  }, [actors, selectedActorId])

  useEffect(() => {
    if (newObjectTypeId === '' && objectTypes[0]?._id) {
      setNewObjectTypeId(objectTypes[0]._id)
    }
  }, [newObjectTypeId, objectTypes])

  useEffect(() => {
    if (!workspace) {
      return
    }

    const dispose = workspace.syncClient.watchQuery(listObjectTypesQuery, {})
    return dispose
  }, [workspace])

  useEffect(() => {
    if (!workspace || selectedActorId === '') {
      return
    }

    const dispose = workspace.syncClient.watchQuery(listObjectsByActorQuery, {
      actorId: selectedActorId,
    })
    return dispose
  }, [workspace, selectedActorId])

  useEffect(() => {
    if (!workspace || selectedActorId === '') {
      return
    }

    const disposers = objects.map((objectRow) =>
      workspace.syncClient.watchQuery(listFieldsByObjectQuery, {
        actorId: selectedActorId,
        objectId: objectRow._id,
      }),
    )

    return () => {
      for (const dispose of disposers) {
        dispose()
      }
    }
  }, [selectedActorId, watchedObjectIds, workspace])

  const handleCreateObject = async () => {
    if (!workspace || selectedActorId === '' || newObjectTypeId === '') {
      return
    }

    try {
      setActionError(null)
      const insertableRow = await workspace.base.database.createInsertableRow('objects')
      const rowRecord = insertableRow as Record<string, unknown>

      await workspace.syncClient.executeMutation(createObjectMutation, {
        actorId: selectedActorId,
        objectId: rowRecord._id as Id<'objects'>,
        createdAt: rowRecord._createdAt as bigint,
        typeId: newObjectTypeId,
      })
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    }
  }

  const handleChangeType = async (
    objectId: Id<'objects'>,
    nextTypeId: Id<'objectTypes'>,
  ) => {
    if (!workspace || selectedActorId === '') {
      return
    }

    try {
      setActionError(null)
      await workspace.syncClient.executeMutation(changeObjectTypeMutation, {
        actorId: selectedActorId,
        objectId,
        nextTypeId,
      })
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    }
  }

  const handleFieldDraftChange = (
    objectId: string,
    patch: Partial<FieldDraft>,
  ) => {
    setFieldDrafts((current) => ({
      ...current,
      [objectId]: {
        fieldTypeId: '',
        name: '',
        body: '',
        ...current[objectId],
        ...patch,
      },
    }))
  }

  const handleUpsertField = async (objectRow: ObjectRow) => {
    if (!workspace) {
      return
    }

    const draft = fieldDrafts[objectRow._id] ?? {
      fieldTypeId: '',
      name: '',
      body: '',
    }

    if (draft.fieldTypeId === '') {
      setActionError('Choose a field type before upserting a field.')
      return
    }

    try {
      setActionError(null)
      const existingField = fields.find(
        (fieldRow) =>
          fieldRow.object_id === objectRow._id &&
          fieldRow.field_type_id === draft.fieldTypeId,
      )
      const insertableRow = existingField
        ? null
        : (await workspace.base.database.createInsertableRow('fields')) as Record<
            string,
            unknown
          >

      await workspace.syncClient.executeMutation(
        upsertFieldByObjectTypeMutation,
        {
          actorId: objectRow._actor,
          objectId: objectRow._id,
          fieldTypeId: draft.fieldTypeId,
          fieldId: existingField?._id ?? (insertableRow?._id as Id<'fields'>),
          createdAt:
            existingField?._createdAt ??
            (insertableRow?._createdAt as bigint),
          name: draft.name,
          body: draft.body,
        },
      )
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    }
  }

  const handleHardClearLocal = async () => {
    const confirmed = window.confirm(
      'Hard clear the local sandbox database and reload this page? This only removes browser-local data. If it fails, close other sandbox tabs and try again.',
    )

    if (!confirmed || isClearingLocal) {
      return
    }

    setIsClearingLocal(true)
    setActionError(null)
    setLoadingError(null)
    setResetError(null)

    const currentWorkspace = workspaceRef.current

    try {
      if (currentWorkspace) {
        await currentWorkspace.close().catch((error) => {
          if (!isExpectedShutdownError(error)) {
            throw error
          }
        })
        workspaceRef.current = null
        setWorkspace(null)
      }

      await hardClearSqliteDemoLocalDatabase()
      window.location.reload()
    } catch (error) {
      setResetError(error instanceof Error ? error.message : String(error))

      if (!workspaceRef.current) {
        try {
          const reopenedWorkspace = await createPrototypeSyncWorkspace()
          workspaceRef.current = reopenedWorkspace
          setWorkspace(reopenedWorkspace)
        } catch (reopenError) {
          setLoadingError(
            reopenError instanceof Error ? reopenError.message : String(reopenError),
          )
        }
      }

      setIsClearingLocal(false)
    }
  }

  const handleHardResetServer = async () => {
    const confirmed = window.confirm(
      'Hard reset the demo server database back to the seeded state and reload this page?',
    )

    if (!confirmed || isResettingServer) {
      return
    }

    setIsResettingServer(true)
    setActionError(null)
    setResetError(null)

    try {
      const response = await fetch(
        new URL('/api/reset-demo', resolvePrototypeServerUrl()).toString(),
        {
          method: 'POST',
        },
      )

      if (!response.ok) {
        throw new Error(`Server reset failed with ${response.status}.`)
      }

      window.location.reload()
    } catch (error) {
      setResetError(error instanceof Error ? error.message : String(error))
      setIsResettingServer(false)
    }
  }

  if (loadingError) {
    return (
      <main className="page-wrap py-8">
        <Card>
          <CardHeader>
            <CardTitle>Prototype Sync</CardTitle>
            <CardDescription>{loadingError}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {resetError && (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {resetError}
              </div>
            )}
            <Button
              variant="outline"
              className="border-red-300 text-red-700 hover:bg-red-50 hover:text-red-800"
              disabled={isClearingLocal || isResettingServer}
              onClick={() => {
                void handleHardClearLocal()
              }}
            >
              {isClearingLocal ? 'Clearing Local DB…' : 'Hard Clear Local DB'}
            </Button>
            <Button
              variant="outline"
              className="border-orange-300 text-orange-700 hover:bg-orange-50 hover:text-orange-800"
              disabled={isClearingLocal || isResettingServer}
              onClick={() => {
                void handleHardResetServer()
              }}
            >
              {isResettingServer ? 'Resetting Demo Server…' : 'Hard Reset Demo Server'}
            </Button>
          </CardContent>
        </Card>
      </main>
    )
  }

  if (!workspace) {
    return (
      <main className="page-wrap py-8">
        <Card>
          <CardHeader>
            <CardTitle>Prototype Sync</CardTitle>
            <CardDescription>Loading local workspace and manual sync client…</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {resetError && (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {resetError}
              </div>
            )}
            <Button
              variant="outline"
              className="border-red-300 text-red-700 hover:bg-red-50 hover:text-red-800"
              disabled={isClearingLocal || isResettingServer}
              onClick={() => {
                void handleHardClearLocal()
              }}
            >
              {isClearingLocal ? 'Clearing Local DB…' : 'Hard Clear Local DB'}
            </Button>
            <Button
              variant="outline"
              className="border-orange-300 text-orange-700 hover:bg-orange-50 hover:text-orange-800"
              disabled={isClearingLocal || isResettingServer}
              onClick={() => {
                void handleHardResetServer()
              }}
            >
              {isResettingServer ? 'Resetting Demo Server…' : 'Hard Reset Demo Server'}
            </Button>
          </CardContent>
        </Card>
      </main>
    )
  }

  return (
    <main className="page-wrap space-y-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Manual Sync Prototype</h1>
          <p className="text-sm text-muted-foreground">
            Named queries and mutations for `objects`, `fields`, and `objectTypes`.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={syncSnapshot.connection === 'connected' ? 'default' : 'secondary'}>
            {syncSnapshot.connection}
          </Badge>
          <Badge variant="outline">active {syncSnapshot.activeTransactions}</Badge>
          <Badge variant="outline">queue {syncSnapshot.offlineQueue}</Badge>
          <Button
            variant="outline"
            className="border-red-300 text-red-700 hover:bg-red-50 hover:text-red-800"
            disabled={isClearingLocal || isResettingServer}
            onClick={() => {
              void handleHardClearLocal()
            }}
          >
            {isClearingLocal ? 'Clearing Local DB…' : 'Hard Clear Local DB'}
          </Button>
          <Button
            variant="outline"
            className="border-orange-300 text-orange-700 hover:bg-orange-50 hover:text-orange-800"
            disabled={isClearingLocal || isResettingServer}
            onClick={() => {
              void handleHardResetServer()
            }}
          >
            {isResettingServer ? 'Resetting Demo Server…' : 'Hard Reset Demo Server'}
          </Button>
          <Link
            to="/"
            className="inline-flex h-9 items-center justify-center rounded-md border border-input bg-background px-4 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
          >
            Back To Explorer
          </Link>
        </div>
      </div>

      {(actionError || resetError || syncSnapshot.lastError) && (
        <Card className="border-amber-300">
          <CardContent className="pt-6 text-sm text-amber-900">
            {actionError ?? resetError ?? syncSnapshot.lastError}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Actor Scope</CardTitle>
              <CardDescription>Queries and mutations are actor-scoped in this prototype.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Label htmlFor="actor-select">Actor</Label>
              <select
                id="actor-select"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={selectedActorId}
                onChange={(event) => setSelectedActorId(event.target.value as Id<'actors'>)}
              >
                {actors.map((actor) => (
                  <option key={actor._id} value={actor._id}>
                    {actor._id}
                  </option>
                ))}
              </select>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Create Object</CardTitle>
              <CardDescription>Uses `objects.create` over the live transaction path when connected.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Label htmlFor="object-type-select">Object type</Label>
              <select
                id="object-type-select"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={newObjectTypeId}
                onChange={(event) => setNewObjectTypeId(event.target.value as Id<'objectTypes'>)}
              >
                {objectTypes.map((objectType) => (
                  <option key={objectType._id} value={objectType._id}>
                    {objectType.name}
                  </option>
                ))}
              </select>
              <Button className="w-full" onClick={handleCreateObject}>
                Create Object
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Object Types</CardTitle>
              <CardDescription>Served through the manual query registry.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {objectTypes.map((objectType) => (
                <div key={objectType._id} className="flex items-center justify-between rounded-md border px-3 py-2">
                  <span>{objectType.name}</span>
                  <code className="text-xs text-muted-foreground">{objectType._id}</code>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {syncSnapshot.conflicts.length > 0 && (
            <Card className="border-destructive">
              <CardHeader>
                <CardTitle>Offline Conflicts</CardTitle>
                <CardDescription>
                  These only appear when queued offline mutations replay and diverge from the server result.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {syncSnapshot.conflicts.map((conflict) => (
                  <div key={conflict.queueId} className="rounded-lg border p-4">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <div>
                        <div className="font-medium">{conflict.mutationName}</div>
                        <div className="text-xs text-muted-foreground">
                          queue #{conflict.queueId}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={() => {
                            void workspace.syncClient.overwriteOfflineConflict(conflict.queueId)
                          }}
                        >
                          Overwrite Server
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            void workspace.syncClient.acceptOfflineConflict(conflict.queueId)
                          }}
                        >
                          Accept Server
                        </Button>
                      </div>
                    </div>
                    <div className="grid gap-3 lg:grid-cols-2">
                      <pre className="overflow-auto rounded-md bg-muted p-3 text-xs">
                        {serializePrototypeJson(conflict.localResult)}
                      </pre>
                      <pre className="overflow-auto rounded-md bg-muted p-3 text-xs">
                        {serializePrototypeJson(conflict.conflict?.serverResult ?? null)}
                      </pre>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4">
            {objects.map((objectRow) => {
              const objectFields = fields.filter((fieldRow) => fieldRow.object_id === objectRow._id)
              const draft = fieldDrafts[objectRow._id] ?? {
                fieldTypeId: '',
                name: '',
                body: '',
              }

              return (
                <Card key={`${objectRow._actor}:${objectRow._id}`}>
                  <CardHeader>
                    <CardTitle className="text-base">Object {objectRow._id}</CardTitle>
                    <CardDescription>
                      created {objectRow._createdAt.toString()} • current type {objectRow.type_id}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex flex-wrap items-end gap-3">
                      <div className="min-w-56 flex-1 space-y-2">
                        <Label htmlFor={`change-type-${objectRow._id}`}>Change type</Label>
                        <select
                          id={`change-type-${objectRow._id}`}
                          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                          value={objectRow.type_id}
                          onChange={(event) => {
                            void handleChangeType(
                              objectRow._id,
                              event.target.value as Id<'objectTypes'>,
                            )
                          }}
                        >
                          {objectTypes.map((objectType) => (
                            <option key={objectType._id} value={objectType._id}>
                              {objectType.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="text-sm font-medium">Fields</div>
                      {objectFields.length === 0 ? (
                        <div className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
                          No fields yet for this object.
                        </div>
                      ) : (
                        objectFields.map((fieldRow) => (
                          <div key={fieldRow._id} className="rounded-md border px-3 py-2">
                            <div className="text-sm font-medium">{fieldRow.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {fieldRow.field_type_id}
                            </div>
                            <p className="mt-2 text-sm">{fieldRow.body}</p>
                          </div>
                        ))
                      )}
                    </div>

                    <div className="grid gap-3 rounded-lg border bg-muted/30 p-4">
                      <div className="text-sm font-medium">Upsert field by unique key</div>
                      <div className="grid gap-3 lg:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor={`field-type-${objectRow._id}`}>Field type</Label>
                          <select
                            id={`field-type-${objectRow._id}`}
                            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                            value={draft.fieldTypeId}
                            onChange={(event) =>
                              handleFieldDraftChange(objectRow._id, {
                                fieldTypeId: event.target.value as Id<'fieldTypes'>,
                              })}
                          >
                            <option value="">Choose a field type</option>
                            {fieldTypes.map((fieldType) => (
                              <option key={fieldType._id} value={fieldType._id}>
                                {fieldType.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`field-name-${objectRow._id}`}>Name</Label>
                          <Input
                            id={`field-name-${objectRow._id}`}
                            value={draft.name}
                            onChange={(event) =>
                              handleFieldDraftChange(objectRow._id, { name: event.target.value })}
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`field-body-${objectRow._id}`}>Body</Label>
                        <Textarea
                          id={`field-body-${objectRow._id}`}
                          value={draft.body}
                          onChange={(event) =>
                            handleFieldDraftChange(objectRow._id, { body: event.target.value })}
                        />
                      </div>
                      <Button
                        variant="outline"
                        onClick={() => {
                          void handleUpsertField(objectRow)
                        }}
                      >
                        Upsert Field
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </div>
      </div>
    </main>
  )
}

function isExpectedShutdownError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }

  return (
    error.message.includes('Shared OPFS database closed') ||
    error.message.includes('Shared OPFS database worker closed') ||
    error.message.includes('Shared OPFS database is closed') ||
    error.message.includes('Prototype sync client stopped.')
  )
}
