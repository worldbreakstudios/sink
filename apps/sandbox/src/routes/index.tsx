import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  createSqliteDemoDatabase,
  FrontendSqliteDatabase,
  type SqliteExplorerSnapshot,
} from '@sink/lib'

export const Route = createFileRoute('/')({ component: App })

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
  const databaseRef = useRef<FrontendSqliteDatabase | null>(null)
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

  const refreshSnapshot = useCallback(() => {
    if (databaseRef.current === null) {
      return
    }

    setActionError(null)
    setSqliteState({
      status: 'ready',
      data: databaseRef.current.createExplorerSnapshot(),
    })
  }, [])

  const loadDemo = useCallback(async () => {
    databaseRef.current?.close()
    databaseRef.current = await createSqliteDemoDatabase()

    setActionError(null)
    setSqliteState({
      status: 'ready',
      data: databaseRef.current.createExplorerSnapshot(),
    })
  }, [])

  useEffect(() => {
    let cancelled = false

    setSqliteState({ status: 'loading' })

    loadDemo()
      .then(() => {
        if (!cancelled) {
          refreshSnapshot()
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setSqliteState({
            status: 'error',
            error: error instanceof Error ? error.message : 'Unknown SQLite error',
          })
        }
      })

    return () => {
      cancelled = true
      databaseRef.current?.close()
      databaseRef.current = null
    }
  }, [loadDemo])

  const tables = sqliteState.data?.tables ?? []
  const selectedTable = useMemo(
    () => tables.find((table) => table.name === selectedTableName) ?? tables[0],
    [selectedTableName, tables],
  )

  const commitCellEdit = useCallback(
    (rowId: number, columnName: string, value: string) => {
      if (databaseRef.current === null || !selectedTable) {
        return
      }

      try {
        databaseRef.current.updateCell(selectedTable.name, rowId, columnName, value)
        refreshSnapshot()
        setEditingCell(null)
      } catch (error) {
        setActionError(
          error instanceof Error ? error.message : 'Unable to update SQLite cell.',
        )
      }
    },
    [refreshSnapshot, selectedTable],
  )

  useEffect(() => {
    if (tables.length > 0 && !tables.some((table) => table.name === selectedTableName)) {
      setSelectedTableName(tables[0]?.name ?? '')
    }
  }, [selectedTableName, tables])

  const columnNames = selectedTable?.columns.map((column) => column.name) ?? []

  return (
    <main className="page-wrap py-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="m-0 text-2xl font-semibold text-slate-900">
            SQLite Sandbox
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            View tables, schema, and stored rows.
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
          Loading SQLite database...
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
                      <span className="text-xs text-slate-500">{table.rows.length}</span>
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
                onClick={() => {
                  if (databaseRef.current === null) {
                    return
                  }

                  try {
                    databaseRef.current.insertRow(selectedTable.name)
                    refreshSnapshot()
                  } catch (error) {
                    setActionError(
                      error instanceof Error
                        ? error.message
                        : 'Unable to insert SQLite row.',
                    )
                  }
                }}
                className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700"
              >
                Add row
              </button>
            </div>

            {selectedTable.rows.length === 0 ? (
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
                    {selectedTable.rows.map((row) => (
                      <tr key={`${selectedTable.name}-${row.rowId}`}>
                        {columnNames.map((columnName) => (
                          <td
                            key={`${selectedTable.name}-${row.rowId}-${columnName}`}
                            className="border-b border-slate-200 px-3 py-2 align-top text-slate-700"
                          >
                            {editingCell?.rowId === row.rowId &&
                            editingCell.columnName === columnName ? (
                              <input
                                autoFocus
                                value={editingCell.value}
                                onChange={(event) =>
                                  setEditingCell({
                                    rowId: row.rowId,
                                    columnName,
                                    value: event.target.value,
                                  })
                                }
                                onBlur={() =>
                                  commitCellEdit(
                                    row.rowId,
                                    columnName,
                                    editingCell.value,
                                  )
                                }
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    commitCellEdit(
                                      row.rowId,
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
                                    rowId: row.rowId,
                                    columnName,
                                    value: formatCellValue(
                                      row.values[columnName] ?? null,
                                    ),
                                  })
                                }
                                className="w-full text-left"
                              >
                                {formatCellValue(row.values[columnName] ?? null)}
                              </button>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="border-t border-slate-300 px-4 py-3 text-xs text-slate-500">
              Click a cell to edit it.
            </div>
          </div>
        </section>
      ) : null}
    </main>
  )
}
