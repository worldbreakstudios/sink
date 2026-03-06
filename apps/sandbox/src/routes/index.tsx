import { useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { runSqliteDemo, type SqliteExplorerSnapshot } from '@sink/lib'

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
  const [sqliteState, setSqliteState] = useState<{
    status: 'loading' | 'ready' | 'error'
    data?: SqliteExplorerSnapshot
    error?: string
  }>({ status: 'loading' })
  const [selectedTableName, setSelectedTableName] = useState<string>('')

  const loadDemo = useMemo(
    () => () =>
      runSqliteDemo()
        .then((data) => ({ status: 'ready', data }) as const)
        .catch((error: unknown) => ({
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown SQLite error',
        }) as const),
    [],
  )

  useEffect(() => {
    let cancelled = false

    setSqliteState({ status: 'loading' })

    loadDemo()
      .then((data) => {
        if (!cancelled) {
          setSqliteState(data)
        }
      })

    return () => {
      cancelled = true
    }
  }, [loadDemo])

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
            setSqliteState({ status: 'loading' })

            loadDemo().then((data) => {
              setSqliteState(data)
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
                      onClick={() => setSelectedTableName(table.name)}
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
            <div className="border-b border-slate-300 px-4 py-3">
              <h3 className="m-0 text-sm font-medium text-slate-900">Rows</h3>
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
                    {selectedTable.rows.map((row, rowIndex) => (
                      <tr key={`${selectedTable.name}-${rowIndex}`}>
                        {columnNames.map((columnName) => (
                          <td
                            key={`${selectedTable.name}-${rowIndex}-${columnName}`}
                            className="border-b border-slate-200 px-3 py-2 align-top text-slate-700"
                          >
                            {formatCellValue(row[columnName] ?? null)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      ) : null}
    </main>
  )
}
