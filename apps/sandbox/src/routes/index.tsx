import { useCallback, useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useLiveQuery } from '@tanstack/react-db'
import {
  createSqliteDemoCollectionsWorkspace,
  type NoteRecord,
  type NotebookRecord,
  type SqliteDemoCollectionsWorkspace,
  type SqliteInsertDraft,
  type SqliteDemoTableName,
  type SqliteExplorerSnapshot,
} from '@sink/lib'

export const Route = createFileRoute('/')({ component: App })

type DemoRow = NotebookRecord | NoteRecord
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

function App() {
  const [workspace, setWorkspace] =
    useState<SqliteDemoCollectionsWorkspace | null>(null)
  const [sqliteState, setSqliteState] = useState<{
    status: 'loading' | 'ready' | 'error'
    data?: SqliteExplorerSnapshot
    error?: string
  }>({ status: 'loading' })
  const [actionError, setActionError] = useState<string | null>(null)
  const [selectedTableName, setSelectedTableName] = useState<string>('')
  const [editingCell, setEditingCell] = useState<{
    rowId: number
    columnName: string
    value: string
  } | null>(null)
  const [insertModal, setInsertModal] = useState<{
    tableName: SqliteDemoTableName
    draft: SqliteInsertDraft
    transaction: PendingInsertTransaction
  } | null>(null)

  const notebooksQuery = useLiveQuery(
    () => workspace?.notebooksCollection,
    [workspace],
  )
  const notesQuery = useLiveQuery(() => workspace?.notesCollection, [workspace])

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

  useEffect(() => {
    if (workspace !== null) {
      refreshSnapshot(workspace)
    }
  }, [workspace, notebooksQuery.data, notesQuery.data, refreshSnapshot])

  const tables = sqliteState.data?.tables ?? []
  const selectedTable = useMemo(
    () => tables.find((table) => table.name === selectedTableName) ?? tables[0],
    [selectedTableName, tables],
  )

  useEffect(() => {
    if (tables.length > 0 && !tables.some((table) => table.name === selectedTableName)) {
      setSelectedTableName(tables[0]?.name ?? '')
    }
  }, [selectedTableName, tables])

  const notebooksRows = notebooksQuery.data ?? []
  const notesRows = notesQuery.data ?? []
  const selectedRows = useMemo(() => {
    if (selectedTable?.name === 'notes') {
      return notesRows as DemoRow[]
    }

    return notebooksRows as DemoRow[]
  }, [notebooksRows, notesRows, selectedTable?.name])

  const columnNames = selectedTable?.columns.map((column) => column.name) ?? []
  const tableCounts = useMemo(
    () => ({
      notebooks: notebooksRows.length,
      notes: notesRows.length,
    }),
    [notebooksRows.length, notesRows.length],
  )
  const modalTable = useMemo(
    () => tables.find((table) => table.name === insertModal?.tableName),
    [insertModal?.tableName, tables],
  )

  const commitCellEdit = useCallback(
    async (rowId: number, columnName: string, value: string) => {
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
        setActionError(null)
        setEditingCell(null)
      } catch (error) {
        setActionError(
          error instanceof Error ? error.message : 'Unable to update SQLite cell.',
        )
      }
    },
    [selectedTable, workspace],
  )

  const closeInsertModal = useCallback(() => {
    setInsertModal((currentModal) => {
      currentModal?.transaction.rollback()
      return null
    })
  }, [])

  return (
    <main className="page-wrap py-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="m-0 text-2xl font-semibold text-slate-900">
            SQLite Sandbox
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Live TanStack DB collections backed by SQLite Wasm.
          </p>
        </div>
        <button
          type="button"
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
          className="rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
        >
          Reload demo database
        </button>
      </div>

      {sqliteState.status === 'loading' ? (
        <div className="rounded border border-slate-300 bg-white p-4 text-sm text-slate-500">
          Loading SQLite collections...
        </div>
      ) : null}

      {sqliteState.status === 'error' ? (
        <div className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-700">
          {sqliteState.error}
        </div>
      ) : null}

      {sqliteState.status === 'ready' && selectedTable ? (
        <section className="space-y-4">
          {actionError ? (
            <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
              {actionError}
            </div>
          ) : null}

          <div className="overflow-hidden rounded border border-slate-300 bg-white">
            <div className="grid md:grid-cols-[220px_minmax(0,1fr)]">
              <aside className="border-b border-slate-300 md:border-r md:border-b-0">
                <div className="border-b border-slate-300 px-4 py-3">
                  <p className="m-0 text-sm font-medium text-slate-900">Tables</p>
                  <p className="mt-1 text-xs text-slate-500">
                    SQLite {sqliteState.data?.version}
                  </p>
                </div>
                <div className="p-2">
                  {tables.map((table) => (
                    <button
                      key={table.name}
                      type="button"
                      onClick={() => {
                        setEditingCell(null)
                        setSelectedTableName(table.name)
                      }}
                      aria-pressed={table.name === selectedTable.name}
                      className={`mb-1 flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm last:mb-0 ${
                        table.name === selectedTable.name
                          ? 'border-slate-300 bg-slate-100 text-slate-900'
                          : 'border-transparent bg-transparent text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <span>{table.name}</span>
                      <span className="text-xs text-slate-500">
                        {tableCounts[table.name as SqliteDemoTableName] ?? 0}
                      </span>
                    </button>
                  ))}
                </div>
              </aside>

              <div>
                <div className="border-b border-slate-300 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="m-0 text-base font-medium text-slate-900">
                      {selectedTable.name}
                    </h2>
                    <span className="text-xs text-slate-500">Schema view</span>
                  </div>
                </div>
                <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_320px]">
                  <div>
                    <h3 className="mb-2 text-sm font-medium text-slate-900">Schema</h3>
                    <pre className="overflow-x-auto rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                      {selectedTable.schema}
                    </pre>
                  </div>
                  <div>
                    <h3 className="mb-2 text-sm font-medium text-slate-900">Columns</h3>
                    <div className="overflow-x-auto rounded border border-slate-200">
                      <table className="min-w-full border-collapse text-sm">
                        <thead className="bg-slate-50 text-left text-slate-600">
                          <tr>
                            <th className="border-b border-slate-200 px-3 py-2 font-medium">
                              Name
                            </th>
                            <th className="border-b border-slate-200 px-3 py-2 font-medium">
                              Type
                            </th>
                            <th className="border-b border-slate-200 px-3 py-2 font-medium">
                              PK
                            </th>
                            <th className="border-b border-slate-200 px-3 py-2 font-medium">
                              Not Null
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedTable.columns.map((column) => (
                            <tr key={column.name}>
                              <td className="border-b border-slate-200 px-3 py-2 text-slate-900">
                                {column.name}
                              </td>
                              <td className="border-b border-slate-200 px-3 py-2 text-slate-600">
                                {column.type || '-'}
                              </td>
                              <td className="border-b border-slate-200 px-3 py-2 text-slate-600">
                                {column.pk ? 'yes' : ''}
                              </td>
                              <td className="border-b border-slate-200 px-3 py-2 text-slate-600">
                                {column.notnull ? 'yes' : ''}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded border border-slate-300 bg-white">
            <div className="flex items-center justify-between gap-3 border-b border-slate-300 px-4 py-3">
              <h3 className="m-0 text-sm font-medium text-slate-900">Rows</h3>
              <button
                type="button"
                onClick={async () => {
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
                className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700"
              >
                Add row
              </button>
            </div>

            {selectedRows.length === 0 ? (
              <div className="p-4 text-sm text-slate-500">No rows in this table.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse text-sm">
                  <thead className="bg-slate-50 text-left text-slate-600">
                    <tr>
                      {columnNames.map((columnName) => (
                        <th
                          key={columnName}
                          className="border-b border-slate-200 px-3 py-2 font-medium"
                        >
                          {columnName}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {selectedRows.map((row) => {
                      const rowId = Number(row.id)

                      return (
                        <tr key={`${selectedTable.name}-${rowId}`}>
                          {columnNames.map((columnName) => (
                            <td
                              key={`${selectedTable.name}-${rowId}-${columnName}`}
                              className="border-b border-slate-200 px-3 py-2 align-top text-slate-700"
                            >
                              {editingCell?.rowId === rowId &&
                              editingCell.columnName === columnName ? (
                                <input
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
                                  className="w-full rounded border border-slate-300 px-2 py-1 text-sm text-slate-900 outline-none"
                                />
                              ) : (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setEditingCell({
                                      rowId,
                                      columnName,
                                      value: formatCellValue(
                                        (row as unknown as Record<string, unknown>)[columnName] ??
                                          null,
                                      ),
                                    })
                                  }
                                  className="w-full text-left"
                                >
                                  {formatCellValue(
                                    (row as unknown as Record<string, unknown>)[columnName] ??
                                      null,
                                  )}
                                </button>
                              )}
                            </td>
                          ))}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="border-t border-slate-300 px-4 py-3 text-xs text-slate-500">
              Click a cell to edit it. Use Add row to open a transaction-backed insert form.
            </div>
          </div>
        </section>
      ) : null}

      {insertModal && modalTable ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4">
          <div className="w-full max-w-lg rounded border border-slate-300 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-300 px-4 py-3">
              <div>
                <h2 className="m-0 text-base font-medium text-slate-900">
                  Add row to {insertModal.tableName}
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  Transaction started. The insert runs when you submit.
                </p>
              </div>
              <button
                type="button"
                onClick={closeInsertModal}
                className="rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700"
              >
                Close
              </button>
            </div>

            <form
              className="space-y-4 p-4"
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
              {modalTable.columns.map((column) => (
                <label key={column.name} className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-900">
                    {column.name}
                  </span>
                  <input
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
                    className="w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-900"
                  />
                  <span className="mt-1 block text-xs text-slate-500">
                    {column.type || 'TEXT'}
                    {column.pk ? ' • primary key' : ''}
                    {column.notnull ? ' • required' : ''}
                  </span>
                </label>
              ))}

              <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={closeInsertModal}
                  className="rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded border border-slate-900 bg-slate-900 px-3 py-2 text-sm text-white"
                >
                  Submit row
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </main>
  )
}
