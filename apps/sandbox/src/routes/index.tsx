import { useCallback, useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useLiveQuery } from '@tanstack/react-db'
import {
  type SqliteCollection,
  type SqliteExplorerSnapshot,
} from '@sink/lib'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import {
  createSqliteDemoCollectionsWorkspace,
  type SqliteDemoCollectionsWorkspace,
  type SqliteDemoId,
  type SqliteDemoRow,
  type SqliteDemoTableName,
  type SqliteInsertDraft,
} from '@/lib/sqlite-demo-collections'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/')({
  ssr: false,
  component: App,
})

type PendingInsertTransaction = ReturnType<
  SqliteDemoCollectionsWorkspace['createBatchTransaction']
>

function formatCellValue(value: unknown): string {
  if (value === null) {
    return 'NULL'
  }

  if (value instanceof Uint8Array || value instanceof Int8Array) {
    return `[binary ${value.byteLength} bytes]`
  }

  if (value instanceof ArrayBuffer) {
    return `[binary ${value.byteLength} bytes]`
  }

  return String(value)
}

function getRowValue(row: SqliteDemoRow, columnName: string): unknown {
  return (row as unknown as Record<string, unknown>)[columnName] ?? null
}

function isMultilineColumn(columnName: string): boolean {
  return columnName === 'body' || columnName === 'description'
}

function formatReferenceOptionLabel(row: SqliteDemoRow): string {
  const record = row as unknown as Record<string, unknown>
  const title = typeof record.title === 'string'
    ? record.title
    : typeof record.name === 'string'
      ? record.name
      : null

  if (title) {
    return `${row._id} - ${title}`
  }

  return row._id
}

function App() {
  const [workspace, setWorkspace] =
    useState<SqliteDemoCollectionsWorkspace | null>(null)
  const [tableCountsRevision, setTableCountsRevision] = useState(0)
  const [sqliteState, setSqliteState] = useState<{
    status: 'loading' | 'ready' | 'error'
    data?: SqliteExplorerSnapshot
    error?: string
  }>({ status: 'loading' })
  const [actionError, setActionError] = useState<string | null>(null)
  const [selectedTableName, setSelectedTableName] = useState<string>('')
  const [editingCell, setEditingCell] = useState<{
    rowId: SqliteDemoId
    columnName: string
    value: string
  } | null>(null)
  const [insertModal, setInsertModal] = useState<{
    tableName: SqliteDemoTableName
    draft: SqliteInsertDraft
    transaction: PendingInsertTransaction
  } | null>(null)

  const refreshSnapshot = useCallback(
    (activeWorkspace: SqliteDemoCollectionsWorkspace) => {
      setSqliteState({
        status: 'ready',
        data: {
          version: activeWorkspace.database.version,
          tables: activeWorkspace.inspectTables(),
        },
      })
    },
    [],
  )

  const loadDemo = useCallback(async () => {
    const nextWorkspace = await createSqliteDemoCollectionsWorkspace()

    setWorkspace((currentWorkspace) => {
      currentWorkspace?.close()
      return nextWorkspace
    })

    setActionError(null)
    refreshSnapshot(nextWorkspace)
  }, [refreshSnapshot])

  useEffect(() => {
    loadDemo().catch((error: unknown) => {
      setSqliteState({
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown SQLite error',
      })
    })
  }, [loadDemo])

  useEffect(() => {
    return () => {
      workspace?.close()
    }
  }, [workspace])

  const tables = sqliteState.data?.tables ?? []
  const selectedTable = useMemo(
    () => tables.find((table) => table.name === selectedTableName) ?? tables[0],
    [selectedTableName, tables],
  )

  const selectedCollection = useMemo(
    () =>
      workspace !== null && selectedTable !== undefined
        ? (workspace.collections[
            selectedTable.name as SqliteDemoTableName
          ] as unknown as SqliteCollection<SqliteDemoRow, SqliteDemoId>)
        : undefined,
    [selectedTable?.name, workspace],
  )

  const selectedRowsQuery = useLiveQuery(
    () => selectedCollection,
    [selectedCollection],
  )

  useEffect(() => {
    if (workspace !== null) {
      refreshSnapshot(workspace)
    }
  }, [refreshSnapshot, selectedRowsQuery.data, workspace])

  useEffect(() => {
    if (tables.length > 0 && !tables.some((table) => table.name === selectedTableName)) {
      setSelectedTableName(tables[0]?.name ?? '')
    }
  }, [selectedTableName, tables])

  const selectedRows = (selectedRowsQuery.data ?? []) as SqliteDemoRow[]

  const columns = selectedTable?.columns ?? []
  const columnNames = columns.map((column) => column.name)
  const readOnlyColumns = useMemo(
    () =>
      new Set(
        columns
          .filter((column) => column.pk || column.name.startsWith('_'))
          .map((column) => column.name),
      ),
    [columns],
  )
  const modalTable = useMemo(
    () => tables.find((table) => table.name === insertModal?.tableName),
    [insertModal?.tableName, tables],
  )
  const editableInsertColumns = useMemo(
    () =>
      modalTable?.columns.filter(
        (column) => column.pk === 0 && !column.name.startsWith('_'),
      ) ?? [],
    [modalTable],
  )
  const tableCounts = useMemo(
    () => {
      if (workspace === null) {
        return Object.fromEntries(
          tables.map((table) => [table.name, table.rows.length]),
        ) as Record<string, number>
      }

      return Object.fromEntries(
        tables.map((table) => [
          table.name,
          workspace.readRows(table.name as SqliteDemoTableName).length,
        ]),
      ) as Record<string, number>
    },
    [tableCountsRevision, tables, workspace, selectedRowsQuery.data],
  )
  const selectedTableIndexes = useMemo(
    () =>
      workspace !== null && selectedTable !== undefined
        ? workspace.database.getTableIndexes(selectedTable.name)
        : [],
    [selectedTable, workspace],
  )
  const indexedQueryPreview = useMemo(() => {
    if (workspace === null || selectedTable === undefined) {
      return null
    }

    switch (selectedTable.name as SqliteDemoTableName) {
      case 'fields': {
        const firstField = workspace.collections.fields.utils.readAll()[0]

        if (!firstField) {
          return null
        }

        const rows = workspace.collections.fields
          .query()
          .withIndex('by_object_id', (q) => q.eq('object_id', firstField.object_id))
          .take(5)

        return {
          title: 'by_object_id',
          query: `fields.query().withIndex('by_object_id', (q) => q.eq('object_id', '${firstField.object_id}')).take(5)`,
          rows,
        }
      }
      case 'fieldTypes': {
        const rows = workspace.collections.fieldTypes.query().withIndex('by_name').take(5)

        return {
          title: 'by_name',
          query: `fieldTypes.query().withIndex('by_name').take(5)`,
          rows,
        }
      }
      case 'objects': {
        const firstObject = workspace.collections.objects.utils.readAll()[0]

        if (!firstObject) {
          return null
        }

        const rows = workspace.collections.objects
          .query()
          .withIndex('by_type_id', (q) => q.eq('type_id', firstObject.type_id))
          .take(5)

        return {
          title: 'by_type_id',
          query: `objects.query().withIndex('by_type_id', (q) => q.eq('type_id', '${firstObject.type_id}')).take(5)`,
          rows,
        }
      }
      case 'objectTypes': {
        const rows = workspace.collections.objectTypes.query().withIndex('by_name').take(5)

        return {
          title: 'by_name',
          query: `objectTypes.query().withIndex('by_name').take(5)`,
          rows,
        }
      }
      default:
        return null
    }
  }, [selectedTable, workspace, selectedRows])

  const commitCellEdit = useCallback(
    async (rowId: SqliteDemoId, columnName: string, value: string) => {
      if (workspace === null || selectedTable === undefined) {
        return
      }

      try {
        await workspace.updateCell(
          selectedTable.name as SqliteDemoTableName,
          rowId,
          columnName,
          value,
        )
        refreshSnapshot(workspace)
        setTableCountsRevision((current) => current + 1)
        setActionError(null)
        setEditingCell(null)
      } catch (error) {
        setActionError(
          error instanceof Error ? error.message : 'Unable to update SQLite cell.',
        )
      }
    },
    [refreshSnapshot, selectedTable, workspace],
  )

  const closeInsertModal = useCallback(() => {
    setInsertModal((currentModal) => {
      currentModal?.transaction.rollback()
      return null
    })
  }, [])

  return (
    <main className="page-wrap py-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">SQLite Sandbox</h1>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            setEditingCell(null)
            setActionError(null)
            setSqliteState({ status: 'loading' })
            loadDemo().catch((error: unknown) => {
              setSqliteState({
                status: 'error',
                error: error instanceof Error ? error.message : 'Unknown SQLite error',
              })
            })
          }}
        >
          Reload demo database
        </Button>
      </div>

      {sqliteState.status === 'loading' ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Loading SQLite collections...
          </CardContent>
        </Card>
      ) : null}

      {sqliteState.status === 'error' ? (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-6 text-sm text-destructive">
            {sqliteState.error}
          </CardContent>
        </Card>
      ) : null}

      {sqliteState.status === 'ready' && selectedTable ? (
        <section className="space-y-4">
          {actionError ? (
            <Card className="border-amber-300 bg-amber-50">
              <CardContent className="p-4 text-sm text-amber-900">
                {actionError}
              </CardContent>
            </Card>
          ) : null}

          <Card className="overflow-hidden">
            <div className="grid md:grid-cols-[240px_minmax(0,1fr)]">
              <aside className="border-b md:border-b-0 md:border-r">
                <CardHeader className="border-b p-4">
                  <CardTitle className="text-base">Tables</CardTitle>
                  <CardDescription>
                    SQLite {sqliteState.data?.version}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-1 p-2">
                  {tables.map((table) => (
                    <Button
                      key={table.name}
                      variant={table.name === selectedTable.name ? 'secondary' : 'ghost'}
                      className={cn(
                        'w-full justify-between',
                        table.name === selectedTable.name && 'font-semibold',
                      )}
                      onClick={() => {
                        setEditingCell(null)
                        setSelectedTableName(table.name)
                      }}
                    >
                      <span>{table.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {tableCounts[table.name as SqliteDemoTableName] ?? 0}
                      </span>
                    </Button>
                  ))}
                </CardContent>
              </aside>

              <CardContent className="p-4">
                <div className="space-y-4">
                  <pre className="overflow-x-auto rounded-md border bg-muted p-3 text-xs text-muted-foreground">
                    {selectedTable.schema}
                  </pre>
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium">Indexes</h3>
                    {selectedTableIndexes.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No indexes on this table.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {selectedTableIndexes.map((index) => (
                          <div
                            key={index.name}
                            className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
                          >
                            <div className="font-mono text-foreground">{index.name}</div>
                            <div>
                              fields: {index.fields.length > 0 ? index.fields.join(', ') : '(none)'}
                            </div>
                            <div>
                              {index.unique ? 'unique' : 'non-unique'}
                              {index.partial ? ' • partial' : ''}
                              {index.origin ? ` • origin: ${index.origin}` : ''}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </div>
          </Card>

          {indexedQueryPreview ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Indexed Query Preview
                </CardTitle>
                <CardDescription>
                  Using `{indexedQueryPreview.title}` on `{selectedTable.name}`.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <pre className="overflow-x-auto rounded-md border bg-muted p-3 text-xs text-muted-foreground">
                  {indexedQueryPreview.query}
                </pre>
                <div className="space-y-1 text-sm">
                  {indexedQueryPreview.rows.map((row) => (
                    <div key={row._id} className="rounded-md border px-3 py-2">
                      {formatReferenceOptionLabel(row)}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base">Rows</CardTitle>
                <CardDescription>
                  Click a cell to edit it. New rows are inserted through a modal-backed
                  transaction.
                </CardDescription>
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  if (workspace === null || selectedTable === undefined) {
                    return
                  }

                  setEditingCell(null)
                  setActionError(null)

                  const tableName = selectedTable.name as SqliteDemoTableName
                  const transaction = workspace.createBatchTransaction({
                    autoCommit: false,
                  })

                  setInsertModal({
                    tableName,
                    draft: workspace.createInsertDraft(tableName),
                    transaction,
                  })
                }}
              >
                Add row
              </Button>
            </CardHeader>
            <CardContent>
              {selectedRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No rows in this table.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      {columnNames.map((columnName) => (
                        <TableHead key={columnName}>{columnName}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedRows.map((row) => {
                      const rowId = row._id

                      return (
                        <TableRow key={`${selectedTable.name}-${rowId}`}>
                          {columnNames.map((columnName) => (
                            <TableCell key={`${selectedTable.name}-${rowId}-${columnName}`}>
                              {editingCell?.rowId === rowId &&
                              editingCell.columnName === columnName ? (
                                isMultilineColumn(columnName) ? (
                                  <Textarea
                                    autoFocus
                                    value={editingCell.value}
                                    onChange={(event) =>
                                      setEditingCell({
                                        rowId,
                                        columnName,
                                        value: event.target.value,
                                      })
                                    }
                                    onBlur={() =>
                                      commitCellEdit(
                                        rowId,
                                        columnName,
                                        editingCell.value,
                                      )
                                    }
                                    className="min-h-24"
                                  />
                                ) : (
                                  <Input
                                    autoFocus
                                    value={editingCell.value}
                                    onChange={(event) =>
                                      setEditingCell({
                                        rowId,
                                        columnName,
                                        value: event.target.value,
                                      })
                                    }
                                    onBlur={() =>
                                      commitCellEdit(
                                        rowId,
                                        columnName,
                                        editingCell.value,
                                      )
                                    }
                                    onKeyDown={(event) => {
                                      if (event.key === 'Enter') {
                                        commitCellEdit(
                                          rowId,
                                          columnName,
                                          editingCell.value,
                                        )
                                      }

                                      if (event.key === 'Escape') {
                                        setEditingCell(null)
                                      }
                                    }}
                                  />
                                )
                              ) : (
                                readOnlyColumns.has(columnName) ? (
                                  <span className="block w-full text-left text-sm">
                                    {formatCellValue(getRowValue(row, columnName))}
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setEditingCell({
                                        rowId,
                                        columnName,
                                        value: formatCellValue(getRowValue(row, columnName)),
                                      })
                                    }
                                    className="w-full text-left text-sm"
                                  >
                                    {formatCellValue(getRowValue(row, columnName))}
                                  </button>
                                )
                              )}
                            </TableCell>
                          ))}
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </section>
      ) : null}

      <Dialog
        open={insertModal !== null}
        onOpenChange={(open) => {
          if (!open) {
            closeInsertModal()
          }
        }}
      >
        {insertModal && modalTable ? (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add row to {insertModal.tableName}</DialogTitle>
              <DialogDescription>
                A TanStack DB transaction is already open. Your insert will be queued and
                committed when you submit this form.
              </DialogDescription>
            </DialogHeader>

            <form
              className="space-y-4"
              onSubmit={async (event) => {
                event.preventDefault()

                if (workspace === null) {
                  return
                }

                try {
                  workspace.queueInsert(
                    insertModal.tableName,
                    insertModal.draft,
                    insertModal.transaction,
                  )
                  await insertModal.transaction.commit()
                  refreshSnapshot(workspace)
                  setTableCountsRevision((current) => current + 1)
                  setActionError(null)
                  setInsertModal(null)
                } catch (error) {
                  setActionError(
                    error instanceof Error
                      ? error.message
                      : 'Unable to insert SQLite row.',
                  )
                  setInsertModal({
                    tableName: insertModal.tableName,
                    draft: insertModal.draft,
                    transaction: workspace.createBatchTransaction({
                      autoCommit: false,
                    }),
                  })
                }
              }}
            >
              <div className="grid gap-4">
                {editableInsertColumns.map((column) => (
                  (() => {
                    const referenceColumn = workspace?.getReferenceColumn(
                      insertModal.tableName,
                      column.name,
                    )
                    const referenceRows = referenceColumn
                      ? workspace?.readRows(
                          referenceColumn.referencedTable as SqliteDemoTableName,
                        ) ?? []
                      : []

                    return (
                      <div key={column.name} className="grid gap-2">
                        <Label htmlFor={`insert-${column.name}`}>{column.name}</Label>
                        {referenceColumn ? (
                          <select
                            id={`insert-${column.name}`}
                            value={insertModal.draft[column.name] ?? ''}
                            onChange={(event) =>
                              setInsertModal((currentModal) =>
                                currentModal === null
                                  ? null
                                  : {
                                      ...currentModal,
                                      draft: {
                                        ...currentModal.draft,
                                        [column.name]: event.target.value,
                                      },
                                    },
                              )
                            }
                            className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
                          >
                            {referenceRows.length === 0 ? (
                              <option value="">No rows available</option>
                            ) : null}
                            {referenceRows.map((row) => (
                              <option key={row._id} value={row._id}>
                                {formatReferenceOptionLabel(row)}
                              </option>
                            ))}
                          </select>
                        ) : isMultilineColumn(column.name) ? (
                          <Textarea
                            id={`insert-${column.name}`}
                            value={insertModal.draft[column.name] ?? ''}
                            onChange={(event) =>
                              setInsertModal((currentModal) =>
                                currentModal === null
                                  ? null
                                  : {
                                      ...currentModal,
                                      draft: {
                                        ...currentModal.draft,
                                        [column.name]: event.target.value,
                                      },
                                    },
                              )
                            }
                          />
                        ) : (
                          <Input
                            id={`insert-${column.name}`}
                            value={insertModal.draft[column.name] ?? ''}
                            onChange={(event) =>
                              setInsertModal((currentModal) =>
                                currentModal === null
                                  ? null
                                  : {
                                      ...currentModal,
                                      draft: {
                                        ...currentModal.draft,
                                        [column.name]: event.target.value,
                                      },
                                    },
                              )
                            }
                          />
                        )}
                        <p className="text-xs text-muted-foreground">
                          {referenceColumn ? 'ID' : column.type || 'TEXT'}
                          {referenceColumn
                            ? ` • references ${referenceColumn.referencedTable}`
                            : ''}
                          {column.pk ? ' • primary key' : ''}
                          {column.notnull ? ' • required' : ''}
                        </p>
                      </div>
                    )
                  })()
                ))}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={closeInsertModal}>
                  Cancel
                </Button>
                <Button type="submit">Submit row</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        ) : null}
      </Dialog>
    </main>
  )
}
