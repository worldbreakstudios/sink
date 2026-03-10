import { useCallback, useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useLiveQuery } from '@tanstack/react-db'
import type { SqliteCollection, SqliteExplorerSnapshot, SqliteIndexSnapshot } from '@sink/lib'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  createSqliteDemoCollectionsWorkspace,
  type SqliteDemoCollectionsWorkspace,
  type SqliteDemoId,
  type SqliteDemoRow,
  type SqliteDemoTableName,
} from '@/lib/sqlite-demo-collections'
import {
  DataTable,
  InsertRowModal,
  type InsertModalState,
  RightSidebar,
  TableSidebar,
  ThemeToggle,
} from './sandbox'

export const Route = createFileRoute('/')({
  ssr: false,
  component: App,
})

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
        error: error instanceof Error ? error.message : 'Unknown SQLite error',
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
    () => selectedCollection,
    [selectedCollection],
  )

  const selectedRows = useMemo(
    () => (selectedRowsQuery.data ?? []) as SqliteDemoRow[],
    [selectedRowsQuery.data],
  )

  useEffect(() => {
    if (
      tables.length > 0 &&
      !tables.some((table) => table.name === selectedTableName)
    ) {
      setSelectedTableName(tables[0]?.name ?? '')
    }
  }, [selectedTableName, tables])

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
        setActionError(
          error instanceof Error
            ? error.message
            : 'Unable to update SQLite cell.',
        )
      }
    },
    [refreshSnapshot, selectedTable, workspace],
  )

  const handleAddRow = useCallback(async () => {
    if (workspace === null || selectedTable === undefined) return

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
      setActionError(
        error instanceof Error ? error.message : 'Unable to insert SQLite row.',
      )
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

  const persistenceBadgeVariant = workspace?.persistenceType === 'opfs'
    ? 'default'
    : workspace?.persistenceType === 'localStorage'
      ? 'secondary'
      : 'outline'


  return (
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
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
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
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="mr-1"
            >
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
              <path d="M16 21h5v-5" />
            </svg>
            Reload
          </Button>
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
          />

          {/* Center - Data Table */}
          <DataTable
            tableName={selectedTable.name}
            columns={selectedTable.columns}
            rows={selectedRows}
            onCellEdit={handleCellEdit}
            onAddRow={handleAddRow}
          />

          {/* Right Sidebar - Schema/Indexes */}
          <RightSidebar
            tableName={selectedTable.name}
            indexes={selectedTableIndexes}
            isOpen={rightSidebarOpen}
            onClose={() => setRightSidebarOpen(false)}
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
    </div>
  )
}
