import { useState, useEffect, useMemo, useCallback } from 'react'
import { useDevToolsBridge } from './hooks/useDevToolsBridge'
import {
  DataTable,
  RightSidebar,
  TableSidebar,
  ThemeToggle,
  generateSchemaSource,
  detectReferences,
  parseSchemaReferences,
  queryStateToSql,
  type IndexDefinition,
  type ReferenceColumn,
  type QueryState,
  type QueryResult,
  type GenericRow,
} from '@sink/devtools-ui'
import type { SqliteIndexSnapshot } from '@sink/lib'
import { RefreshCw, Database } from 'lucide-react'

export function App() {
  const {
    databases,
    tables,
    selectedDatabase,
    setSelectedDatabase,
    refresh,
    isConnected,
    sendMessage,
  } = useDevToolsBridge()

  const [selectedTableName, setSelectedTableName] = useState<string | null>(null)
  const [rightSidebarOpen, setRightSidebarOpen] = useState(true)
  const [selectedTableIndexes, setSelectedTableIndexes] = useState<SqliteIndexSnapshot[]>([])
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set())
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  // Auto-select first table
  useEffect(() => {
    if (tables.length > 0 && !selectedTableName) {
      setSelectedTableName(tables[0]!.name)
    }
  }, [tables, selectedTableName])

  // Load indexes when table changes
  useEffect(() => {
    if (!selectedDatabase || !selectedTableName) {
      setSelectedTableIndexes([])
      return
    }

    sendMessage<{ type: 'TABLE_INDEXES'; indexes: SqliteIndexSnapshot[] }>({
      type: 'GET_TABLE_INDEXES',
      databaseName: selectedDatabase,
      tableName: selectedTableName,
    })
      .then((response) => setSelectedTableIndexes(response.indexes))
      .catch(() => setSelectedTableIndexes([]))
  }, [selectedDatabase, selectedTableName, sendMessage])

  // Clear selection and query when table changes
  useEffect(() => {
    setSelectedRowIds(new Set())
    setQueryResult(null)
  }, [selectedTableName])

  const selectedTable = useMemo(
    () => tables.find((t) => t.name === selectedTableName),
    [tables, selectedTableName]
  )

  const selectedDb = useMemo(
    () => databases.find((d) => d.name === selectedDatabase),
    [databases, selectedDatabase]
  )

  // Get table metadata (indexes and reference columns) - reverse-engineered
  const tableMetadata = useMemo(() => {
    if (!selectedTable) return { indexes: {}, referenceColumns: {} }

    const availableTableNames = tables.map((t) => t.name)

    // Build referenceColumns from schema + naming conventions
    const referenceColumns: Record<string, ReferenceColumn> = {
      ...parseSchemaReferences(selectedTable.schema ?? ''),
    }
    for (const col of selectedTable.columns) {
      if (!referenceColumns[col.name]) {
        const detected = detectReferences(col, availableTableNames)
        if (detected) referenceColumns[col.name] = detected
      }
    }

    // Convert SqliteIndexSnapshot[] to Record<string, IndexDefinition>
    const indexes: Record<string, IndexDefinition> = {}
    for (const idx of selectedTableIndexes) {
      indexes[idx.name] = {
        name: idx.name,
        fields: idx.fields,
        unique: idx.unique === 1,
      }
    }

    return { indexes, referenceColumns }
  }, [selectedTable, tables, selectedTableIndexes])

  // Generate schema source for the right sidebar
  const schemaSource = useMemo(() => {
    if (!selectedTable) return ''
    return generateSchemaSource(
      selectedTable,
      tableMetadata.indexes,
      tableMetadata.referenceColumns
    )
  }, [selectedTable, tableMetadata])

  // Convert table rows to GenericRow format for DataTable
  const tableRows = useMemo(() => {
    if (!selectedTable) return []
    return selectedTable.rows.map((row) => ({
      ...row.values,
      _id: row.values._id as string,
    })) as GenericRow[]
  }, [selectedTable])

  // Get selected row objects
  const selectedRows = useMemo(() => {
    if (!selectedTable || selectedRowIds.size === 0) return []
    return selectedTable.rows
      .filter((row) => selectedRowIds.has(row.values._id as string))
      .map((row) => ({ ...row.values, _id: row.values._id as string }) as GenericRow)
  }, [selectedTable, selectedRowIds])

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true)
    await refresh()
    setIsRefreshing(false)
  }, [refresh])

  const handleSelectionChange = useCallback((ids: Set<string>) => {
    setSelectedRowIds(ids)
  }, [])

  const handleCellEdit = useCallback(
    async (rowId: string, columnName: string, value: string) => {
      if (!selectedDatabase || !selectedTableName) return
      try {
        // Find the numeric rowId from the _id
        const row = selectedTable?.rows.find((r) => r.values._id === rowId)
        if (!row) throw new Error('Row not found')

        await sendMessage({
          type: 'UPDATE_CELL',
          databaseName: selectedDatabase,
          tableName: selectedTableName,
          rowId: row.rowId,
          columnName,
          value,
        })
        setActionError(null)
        await handleRefresh()
      } catch (error) {
        setActionError(error instanceof Error ? error.message : 'Failed to update cell')
      }
    },
    [selectedDatabase, selectedTableName, selectedTable, sendMessage, handleRefresh]
  )

  const handleAddRow = useCallback(async () => {
    if (!selectedDatabase || !selectedTableName) return
    try {
      await sendMessage({
        type: 'INSERT_ROW',
        databaseName: selectedDatabase,
        tableName: selectedTableName,
      })
      setActionError(null)
      await handleRefresh()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Failed to insert row')
    }
  }, [selectedDatabase, selectedTableName, sendMessage, handleRefresh])

  const handleDeleteRows = useCallback(
    async (rowIds: string[]) => {
      if (!selectedDatabase || !selectedTableName || !selectedTable) return
      try {
        // Convert _id values to numeric rowIds
        const numericRowIds = rowIds
          .map((id) => selectedTable.rows.find((r) => r.values._id === id)?.rowId)
          .filter((id): id is number => id !== undefined)

        await sendMessage({
          type: 'DELETE_ROWS',
          databaseName: selectedDatabase,
          tableName: selectedTableName,
          rowIds: numericRowIds,
        })
        setActionError(null)
        await handleRefresh()
      } catch (error) {
        setActionError(error instanceof Error ? error.message : 'Failed to delete rows')
      }
    },
    [selectedDatabase, selectedTableName, selectedTable, sendMessage, handleRefresh]
  )

  const handleRunQuery = useCallback(
    async (query: QueryState) => {
      if (!selectedDatabase || !selectedTableName) return

      const startTime = performance.now()

      try {
        const { sql, bind } = queryStateToSql(query, selectedTableName, tableMetadata.indexes)

        const result = await sendMessage<{ type: 'QUERY_RESULT'; rows: Record<string, unknown>[] }>({
          type: 'EXECUTE_QUERY',
          databaseName: selectedDatabase,
          sql,
          bind,
        })

        const executionTime = performance.now() - startTime

        setQueryResult({
          rows: result.rows.map((r) => ({ ...r, _id: r._id as string })) as GenericRow[],
          executionTime,
        })
        setActionError(null)
      } catch (error) {
        setQueryResult(null)
        setActionError(error instanceof Error ? error.message : 'Query execution failed')
      }
    },
    [selectedDatabase, selectedTableName, tableMetadata.indexes, sendMessage]
  )

  if (!isConnected) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-foreground">
        <div className="text-center">
          <Database className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <div className="text-lg font-medium">Connecting to page...</div>
          <div className="mt-2 text-sm text-muted-foreground">
            Make sure the page uses @sink/lib with createDatabase()
          </div>
        </div>
      </div>
    )
  }

  if (databases.length === 0) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-foreground">
        <div className="text-center">
          <Database className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <div className="text-lg font-medium">No databases found</div>
          <div className="mt-2 text-sm text-muted-foreground">
            This page doesn't have any registered @sink/lib databases
          </div>
          <button
            onClick={handleRefresh}
            className="mt-4 inline-flex items-center rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* Header */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold">Sink SQLite DevTools</h1>
          {selectedDb && (
            <>
              <span
                className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                  selectedDb.persistenceType === 'opfs'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {selectedDb.persistenceType.toUpperCase()}
              </span>
              <span className="text-xs text-muted-foreground">v{selectedDb.version}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {databases.length > 1 && (
            <select
              value={selectedDatabase ?? ''}
              onChange={(e) => setSelectedDatabase(e.target.value)}
              className="h-8 rounded-md border bg-background px-2 text-xs"
            >
              {databases.map((db) => (
                <option key={db.name} value={db.name}>
                  {db.name}
                </option>
              ))}
            </select>
          )}
          {!rightSidebarOpen && selectedTable && (
            <button
              onClick={() => setRightSidebarOpen(true)}
              className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted"
            >
              Show Panel
            </button>
          )}
          <ThemeToggle />
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      {/* Error Banner */}
      {actionError && (
        <div className="flex shrink-0 items-center justify-between border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <span>{actionError}</span>
          <button
            onClick={() => setActionError(null)}
            className="rounded p-1 hover:bg-amber-200 dark:hover:bg-amber-800"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Main Content */}
      <div className="flex min-h-0 flex-1">
        {/* Left Sidebar */}
        <TableSidebar
          tables={tables}
          selectedTableName={selectedTableName ?? ''}
          onSelectTable={setSelectedTableName}
          showCreateButton={false}
        />

        {/* Data Table */}
        {selectedTable && (
          <DataTable
            tableName={selectedTable.name}
            columns={selectedTable.columns}
            rows={tableRows}
            indexes={tableMetadata.indexes}
            referenceColumns={tableMetadata.referenceColumns}
            queryResult={queryResult}
            onCellEdit={handleCellEdit}
            onAddRow={handleAddRow}
            onDeleteRows={handleDeleteRows}
            onRunQuery={handleRunQuery}
            onSelectionChange={handleSelectionChange}
            enableQueryBuilder={Object.keys(tableMetadata.indexes).length > 0}
          />
        )}

        {/* Right Sidebar */}
        {selectedTable && (
          <RightSidebar
            tableName={selectedTable.name}
            indexes={selectedTableIndexes}
            columns={selectedTable.columns}
            referenceColumns={tableMetadata.referenceColumns}
            schemaSource={schemaSource}
            selectedRows={selectedRows}
            isOpen={rightSidebarOpen}
            onClose={() => setRightSidebarOpen(false)}
          />
        )}
      </div>
    </div>
  )
}
