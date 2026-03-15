import { useCallback, useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useLiveQuery } from '@tanstack/react-db'
import { HotkeysProvider } from '@tanstack/react-hotkeys'
import type { SqliteCollection, SqliteExplorerSnapshot, SqliteIndexSnapshot } from '@sink/lib'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  createSqliteDemoCollectionsWorkspace,
  getSqliteDemoRowKey,
  serializeSqliteDemoKey,
  type SqliteDemoCollectionsWorkspace,
  type SqliteDemoId,
  type SqliteDemoRow,
  type SqliteDemoTableName,
} from '@/lib/sqlite-demo-collections'
import type { SqliteReferenceColumn } from '@sink/lib'
import { REFERENCE_COLUMNS, type TableName } from '@/data/generated/schema.gen'
import {
  CreateTableModal,
  DataTable,
  DeleteRowsModal,
  InsertRowModal,
  type InsertModalState,
  parseValue,
  type QueryResult,
  type QueryState,
  RightSidebar,
  TableSidebar,
  ThemeToggle,
} from './sandbox'

export const Route = createFileRoute('/')({
  ssr: false,
  component: App,
})

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message
  }

  if (typeof error === 'string') {
    return error
  }

  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
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
  const [insertModal, setInsertModal] = useState<InsertModalState | null>(null)
  const [selectedTableIndexes, setSelectedTableIndexes] = useState<SqliteIndexSnapshot[]>([])
  const [rightSidebarOpen, setRightSidebarOpen] = useState(true)
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null)
  const [createTableModalOpen, setCreateTableModalOpen] = useState(false)
  const [selectedRowKeys, setSelectedRowKeys] = useState<Set<string>>(new Set())
  const [deleteModal, setDeleteModal] = useState<{
    tableName: SqliteDemoTableName
    count: number
    keys: SqliteDemoId[]
  } | null>(null)
  const [isDeletingRows, setIsDeletingRows] = useState(false)

  const refreshSnapshot = useCallback(
    async (activeWorkspace: SqliteDemoCollectionsWorkspace) => {
      const tables = await activeWorkspace.inspectTables()
      setSqliteState({
        status: 'ready',
        data: {
          version: activeWorkspace.database.version,
          tables,
        },
      })
    },
    [],
  )

  const loadDemo = useCallback(async () => {
    const nextWorkspace = await createSqliteDemoCollectionsWorkspace()

    setWorkspace((currentWorkspace) => {
      if (currentWorkspace) {
        currentWorkspace.close().catch(console.error)
      }
      return nextWorkspace
    })

    setActionError(null)
    await refreshSnapshot(nextWorkspace)
  }, [refreshSnapshot])

  useEffect(() => {
    loadDemo().catch((error: unknown) => {
      setSqliteState({
        status: 'error',
        error: formatUnknownError(error),
      })
    })
  }, [loadDemo])

  useEffect(() => {
    return () => {
      workspace?.close().catch(console.error)
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
    () => selectedCollection as never,
    [selectedCollection as never],
  )

  const tableRows = useMemo(
    () => (selectedRowsQuery.data ?? []) as SqliteDemoRow[],
    [selectedRowsQuery.data],
  )

  // Get the actual selected document objects from the IDs
  const selectedDocuments = useMemo(() => {
    if (selectedRowKeys.size === 0 || selectedTable === undefined) return []
    const tableName = selectedTable.name as SqliteDemoTableName
    return tableRows.filter((row) =>
      selectedRowKeys.has(
        serializeSqliteDemoKey(tableName, getSqliteDemoRowKey(tableName, row)),
      ),
    )
  }, [selectedRowKeys, selectedTable, tableRows])

  const handleSelectionChange = useCallback((rowKeys: Set<string>) => {
    setSelectedRowKeys(new Set(rowKeys))
  }, [])

  // Get reference columns for the selected table
  const selectedTableReferenceColumns = useMemo(() => {
    if (!selectedTable) return {}
    return (REFERENCE_COLUMNS[selectedTable.name as TableName] ?? {}) as Record<string, SqliteReferenceColumn>
  }, [selectedTable])

  useEffect(() => {
    if (
      tables.length > 0 &&
      !tables.some((table) => table.name === selectedTableName)
    ) {
      setSelectedTableName(tables[0]?.name ?? '')
    }
  }, [selectedTableName, tables])

  // Clear query result when table changes
  useEffect(() => {
    setQueryResult(null)
    setSelectedRowKeys(new Set())
    setDeleteModal(null)
  }, [selectedTableName])

  // Load indexes for selected table
  useEffect(() => {
    if (workspace === null || selectedTable === undefined) {
      setSelectedTableIndexes([])
      return
    }

    workspace.database.getTableIndexes(selectedTable.name)
      .then(setSelectedTableIndexes)
      .catch((error) => {
        console.error('Failed to load table indexes:', error)
        setSelectedTableIndexes([])
      })
  }, [selectedTable, workspace])

  const modalTable = useMemo(
    () => tables.find((table) => table.name === insertModal?.tableName),
    [insertModal?.tableName, tables],
  )


  const handleCellEdit = useCallback(
    async (rowId: SqliteDemoId, columnName: string, value: string) => {
      if (workspace === null || selectedTable === undefined) return

      try {
        await workspace.updateCell(
          selectedTable.name as SqliteDemoTableName,
          rowId,
          columnName,
          value,
        )
        await refreshSnapshot(workspace)
        setActionError(null)
      } catch (error) {
        setActionError(formatUnknownError(error))
      }
    },
    [refreshSnapshot, selectedTable, workspace],
  )

  const handleAddRow = useCallback(async () => {
    if (workspace === null || selectedTable === undefined) return

    try {
      setActionError(null)
      const tableName = selectedTable.name as SqliteDemoTableName
      const transaction = workspace.createBatchTransaction({ autoCommit: false })
      const draft = await workspace.createInsertDraft(tableName)

      // Pre-load reference rows for FK columns
      const referenceRows: Record<string, SqliteDemoRow[]> = {}
      const tableSnapshot = tables.find((t) => t.name === tableName)
      if (tableSnapshot) {
        for (const column of tableSnapshot.columns) {
          const refCol = workspace.getReferenceColumn(tableName, column.name)
          if (refCol) {
            referenceRows[column.name] = await workspace.readRows(
              refCol.referencedTable as SqliteDemoTableName,
            )
          }
        }
      }

      setInsertModal({
        tableName,
        draft,
        transaction,
        referenceRows,
      })
    } catch (error) {
      setActionError(formatUnknownError(error))
    }
  }, [selectedTable, tables, workspace])

  const handleInsertSubmit = useCallback(async () => {
    if (workspace === null || insertModal === null) return

    try {
      await workspace.queueInsert(
        insertModal.tableName,
        insertModal.draft,
        insertModal.transaction,
      )
      await insertModal.transaction.commit()
      await refreshSnapshot(workspace)
      setActionError(null)
      setInsertModal(null)
    } catch (error) {
      setActionError(formatUnknownError(error))
      setInsertModal({
        tableName: insertModal.tableName,
        draft: insertModal.draft,
        transaction: workspace.createBatchTransaction({ autoCommit: false }),
        referenceRows: insertModal.referenceRows,
      })
    }
  }, [insertModal, refreshSnapshot, workspace])

  const handleInsertClose = useCallback(() => {
    setInsertModal((currentModal) => {
      currentModal?.transaction.rollback()
      return null
    })
  }, [])

  const handleDraftChange = useCallback((columnName: string, value: string) => {
    setInsertModal((currentModal) =>
      currentModal === null
        ? null
        : {
            ...currentModal,
            draft: { ...currentModal.draft, [columnName]: value },
          },
    )
  }, [])

  const handleDeleteSelected = useCallback(async (rowKeys: string[]) => {
    if (selectedTable === undefined || rowKeys.length === 0) return

    const tableName = selectedTable.name as SqliteDemoTableName
    const keySet = new Set(rowKeys)
    const rowsToDelete = tableRows.filter((row) =>
      keySet.has(
        serializeSqliteDemoKey(tableName, getSqliteDemoRowKey(tableName, row)),
      ),
    )

    if (rowsToDelete.length === 0) {
      return
    }

    setDeleteModal({
      tableName,
      count: rowsToDelete.length,
      keys: rowsToDelete.map((row) => getSqliteDemoRowKey(tableName, row)),
    })
  }, [selectedTable, tableRows])

  const handleDeleteModalClose = useCallback(() => {
    if (isDeletingRows) {
      return
    }

    setDeleteModal(null)
  }, [isDeletingRows])

  const handleDeleteConfirm = useCallback(async () => {
    if (workspace === null || deleteModal === null) return

    setIsDeletingRows(true)

    try {
      await workspace.deleteRows(deleteModal.tableName, deleteModal.keys)
      await refreshSnapshot(workspace)
      setQueryResult(null)
      setSelectedRowKeys(new Set())
      setDeleteModal(null)
      setActionError(null)
    } catch (error) {
      setActionError(formatUnknownError(error))
    } finally {
      setIsDeletingRows(false)
    }
  }, [deleteModal, refreshSnapshot, workspace])

  const persistenceBadgeVariant = workspace?.persistenceType === 'opfs'
    ? 'default'
    : workspace?.persistenceType === 'localStorage'
      ? 'secondary'
      : 'outline'

  const handleRunQuery = useCallback(async (query: QueryState) => {
    if (!workspace || !selectedTable) return

    const startTime = performance.now()

    try {
      const collection = workspace.collections[selectedTable.name as SqliteDemoTableName] as unknown as SqliteCollection<SqliteDemoRow, SqliteDemoId>

      // Build the query dynamically
      let q = collection.query().withIndex(query.indexName, (builder: any) => {
        let b = builder
        for (const c of query.constraints) {
          if (c.operator === 'isKnown' || c.operator === 'isUnknown') {
            b = b[c.operator](c.field)
            continue
          }

          const value = parseValue(c.value)
          b = b[c.operator](c.field, value)
        }
        return b
      })

      q = q.order(query.orderDirection)

      let rows: SqliteDemoRow[]
      switch (query.queryMethod) {
        case 'first': {
          const row = await q.first()
          rows = row ? [row] : []
          break
        }
        case 'unique': {
          const row = await q.unique()
          rows = row ? [row] : []
          break
        }
        case 'take':
          rows = await q.take(parseInt(query.takeCount) || 10)
          break
        case 'collect':
        default:
          rows = await q.collect()
          break
      }

      const executionTime = performance.now() - startTime

      setQueryResult({
        rows,
        executionTime,
      })
    } catch (err) {
      setQueryResult({
        rows: [],
        executionTime: 0,
        error: formatUnknownError(err),
      })
    }
  }, [workspace, selectedTable])

  const handleClearQuery = useCallback(() => {
    setQueryResult(null)
  }, [])


  return (
    <HotkeysProvider>
    <div className="flex h-screen flex-col bg-background">
      {/* Top Header Bar */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold">SQLite Sandbox</h1>
          {workspace && (
            <Badge variant={persistenceBadgeVariant} className="text-xs">
              {workspace.persistenceType.toUpperCase()}
            </Badge>
          )}
          {sqliteState.data?.version && (
            <span className="text-xs text-muted-foreground">
              SQLite {sqliteState.data.version}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!rightSidebarOpen && selectedTable && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRightSidebarOpen(true)}
              className="text-xs"
            >
              Show Schema
            </Button>
          )}
          <ThemeToggle />
        </div>
      </header>

      {/* Error Banner */}
      {actionError && (
        <div className="shrink-0 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {actionError}
        </div>
      )}

      {/* Main Content */}
      {sqliteState.status === 'loading' && (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Loading SQLite collections...
        </div>
      )}

      {sqliteState.status === 'error' && (
        <div className="flex flex-1 items-center justify-center text-sm text-destructive">
          {sqliteState.error}
        </div>
      )}

      {sqliteState.status === 'ready' && selectedTable && (
        <div className="flex min-h-0 flex-1">
          {/* Left Sidebar - Tables */}
          <TableSidebar
            tables={tables}
            selectedTableName={selectedTable.name}
            onSelectTable={setSelectedTableName}
            onCreateTable={() => setCreateTableModalOpen(true)}
          />

          {/* Center - Data Table */}
          <DataTable
            tableName={selectedTable.name}
            columns={selectedTable.columns}
            rows={tableRows}
            collections={workspace?.collections ?? null}
            queryResult={queryResult}
            onCellEdit={handleCellEdit}
            onAddRow={handleAddRow}
            onDeleteSelected={handleDeleteSelected}
            onClearQuery={handleClearQuery}
            onRunQuery={handleRunQuery}
            onSelectionChange={handleSelectionChange}
            selectedRowKeys={selectedRowKeys}
          />

          {/* Right Sidebar - Schema/Indexes/Document */}
          <RightSidebar
            tableName={selectedTable.name}
            tables={tables}
            indexes={selectedTableIndexes}
            isOpen={rightSidebarOpen}
            onClose={() => setRightSidebarOpen(false)}
            selectedRows={selectedDocuments}
            columns={selectedTable.columns}
            referenceColumns={selectedTableReferenceColumns}
          />
        </div>
      )}

      <InsertRowModal
        modal={insertModal}
        columns={modalTable?.columns ?? []}
        workspace={workspace}
        onClose={handleInsertClose}
        onSubmit={handleInsertSubmit}
        onDraftChange={handleDraftChange}
      />

      <CreateTableModal
        open={createTableModalOpen}
        onClose={() => setCreateTableModalOpen(false)}
      />

      <DeleteRowsModal
        modal={
          deleteModal
            ? {
                tableName: deleteModal.tableName,
                count: deleteModal.count,
              }
            : null
        }
        isDeleting={isDeletingRows}
        onClose={handleDeleteModalClose}
        onConfirm={handleDeleteConfirm}
      />
    </div>
    </HotkeysProvider>
  )
}
