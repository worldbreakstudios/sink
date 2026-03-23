import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useLiveQuery } from '@tanstack/react-db'
import { HotkeysProvider } from '@tanstack/react-hotkeys'
import {
  getSharedOpfsBrowserTabId,
  type SqliteCollection,
  type SqliteExplorerSnapshot,
  type SqliteIndexSnapshot,
  type SyncClientSnapshot,
} from '@sink/lib'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  createSqliteDemoCollectionsWorkspace,
  getSqliteDemoRowKey,
  hardClearSqliteDemoLocalDatabase,
  resolveSqliteDemoServerUrl,
  serializeSqliteDemoKey,
  type SqliteDemoCollectionsWorkspace,
  type SqliteDemoId,
  type SqliteDemoRow,
  type SqliteDemoTableName,
} from '@/lib/sqlite-demo-collections'
import type { SqliteReferenceColumn } from '@sink/lib'
import {
  INDEXES,
  KEY_COLUMNS,
  REFERENCE_COLUMNS,
  type TableName,
} from '@/data/generated/schema.gen'
import {
  buildOffsetCursorInput,
  DataTable,
  DeleteRowsModal,
  InsertRowModal,
  type InsertModalState,
  parseValue,
  type QueryResult,
  type QueryState,
  RightSidebar,
  SettingsModal,
  TableSidebar,
} from './sandbox'

export const Route = createFileRoute('/')({
  ssr: false,
  component: App,
})

const emptySyncSnapshot: SyncClientSnapshot = {
  connection: 'stopped',
  activeTransactions: 0,
  offlineQueue: 0,
  conflicts: [],
  lastError: null,
  lastInvalidationAt: null,
} as const

interface DemoServerLock {
  transactionId: string
  clientId: string
  mutationName: string
  expiresAt: number
  updatedAt: number
  lockTargets: Array<{
    tableName: string
    kind: 'primary' | 'unique'
    keyName: string
    values: Record<string, string>
  }>
}

interface DemoLockedRowInfo {
  count: number
  title: string
}

const demoLocksEndpoint = new URL('/api/locks-demo', resolveSqliteDemoServerUrl()).toString()

function serializeDemoLockedRowKey(
  tableName: SqliteDemoTableName,
  values: Record<string, string>,
): string {
  const keyColumns = KEY_COLUMNS[tableName]

  if (keyColumns.length === 1) {
    return values[keyColumns[0] ?? '_id'] ?? ''
  }

  return JSON.stringify(
    keyColumns.map((columnName) => [columnName, values[columnName] ?? null]),
  )
}

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
  const browserTabId = getSharedOpfsBrowserTabId()
  const [workspace, setWorkspace] =
    useState<SqliteDemoCollectionsWorkspace | null>(null)
  const workspaceRef = useRef<SqliteDemoCollectionsWorkspace | null>(null)
  const [sqliteState, setSqliteState] = useState<{
    status: 'loading' | 'ready' | 'error'
    data?: SqliteExplorerSnapshot
    error?: string
  }>({ status: 'loading' })
  const [actionError, setActionError] = useState<string | null>(null)
  const [resetError, setResetError] = useState<string | null>(null)
  const [dismissedActionError, setDismissedActionError] = useState<string | null>(null)
  const [dismissedResetError, setDismissedResetError] = useState<string | null>(null)
  const [dismissedSyncError, setDismissedSyncError] = useState<string | null>(null)
  const [selectedTableName, setSelectedTableName] = useState<string>('')
  const [insertModal, setInsertModal] = useState<InsertModalState | null>(null)
  const [selectedTableIndexes, setSelectedTableIndexes] = useState<SqliteIndexSnapshot[]>([])
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true)
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false)
  const [activeQuery, setActiveQuery] = useState<QueryState | null>(null)
  const [selectedRowKeys, setSelectedRowKeys] = useState<Set<string>>(new Set())
  const [deleteModal, setDeleteModal] = useState<{
    tableName: SqliteDemoTableName
    count: number
    keys: SqliteDemoId[]
  } | null>(null)
  const [isDeletingRows, setIsDeletingRows] = useState(false)
  const [isClearingLocal, setIsClearingLocal] = useState(false)
  const [isResettingServer, setIsResettingServer] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [serverLocks, setServerLocks] = useState<DemoServerLock[]>([])

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
    const previousWorkspace = workspaceRef.current
    workspaceRef.current = nextWorkspace
    setWorkspace(nextWorkspace)

    setActionError(null)
    setResetError(null)
    await refreshSnapshot(nextWorkspace)

    if (previousWorkspace && previousWorkspace !== nextWorkspace) {
      await previousWorkspace.close().catch((error) => {
        if (!isExpectedShutdownError(error)) {
          console.error(error)
        }
      })
    }
  }, [refreshSnapshot])

  useEffect(() => {
    let cancelled = false

    loadDemo().catch((error: unknown) => {
      if (!cancelled) {
        setSqliteState({
          status: 'error',
          error: formatUnknownError(error),
        })
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
  }, [loadDemo])

  useEffect(() => {
    if (!workspace) {
      setServerLocks([])
      return
    }

    let cancelled = false

    const loadLocks = async () => {
      try {
        const response = await fetch(demoLocksEndpoint)

        if (!response.ok) {
          throw new Error(`Failed to load locks (${response.status}).`)
        }

        const payload = (await response.json()) as { locks?: DemoServerLock[] }

        if (!cancelled) {
          setServerLocks(payload.locks ?? [])
        }
      } catch {
        if (!cancelled) {
          setServerLocks([])
        }
      }
    }

    void loadLocks()
    const intervalId = window.setInterval(() => {
      void loadLocks()
    }, 1000)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [workspace])

  useEffect(() => {
    if (actionError === null) {
      setDismissedActionError(null)
    }
  }, [actionError])

  useEffect(() => {
    if (resetError === null) {
      setDismissedResetError(null)
    }
  }, [resetError])

  const syncSnapshot = useSyncExternalStore(
    workspace?.syncClient.subscribe ?? (() => () => {}),
    workspace?.syncClient.getSnapshot ?? (() => emptySyncSnapshot),
  )

  useEffect(() => {
    if (syncSnapshot.lastError === null || syncSnapshot.connection === 'connected') {
      setDismissedSyncError(null)
    }
  }, [syncSnapshot.connection, syncSnapshot.lastError])

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

  const lockedRowsByKey = useMemo<Record<string, DemoLockedRowInfo>>(() => {
    if (!selectedTable) {
      return {}
    }

    const tableName = selectedTable.name as SqliteDemoTableName
    const entries = new Map<string, DemoLockedRowInfo>()

    for (const lock of serverLocks) {
      const primaryTargets = lock.lockTargets.filter(
        (target) => target.tableName === tableName && target.kind === 'primary',
      )

      for (const target of primaryTargets) {
        const rowKey = serializeDemoLockedRowKey(tableName, target.values)
        const existing = entries.get(rowKey)
        const expiresInSeconds = Math.max(
          0,
          Math.ceil((lock.expiresAt - Date.now()) / 1000),
        )
        const detail = `${lock.mutationName} • ${lock.clientId.slice(0, 8)} • ${expiresInSeconds}s`

        entries.set(rowKey, {
          count: (existing?.count ?? 0) + 1,
          title: existing ? `${existing.title}\n${detail}` : detail,
        })
      }
    }

    return Object.fromEntries(entries)
  }, [selectedTable, serverLocks])

  const selectedRowsQuery = useLiveQuery(
    () => selectedCollection as never,
    [selectedCollection as never],
  )

  const tableRows = useMemo(
    () => (selectedRowsQuery.data ?? []) as SqliteDemoRow[],
    [selectedRowsQuery.data],
  )

  const indexedRowsQuery = useLiveQuery(
    (q) => {
      if (!selectedCollection || !activeQuery) {
        return undefined
      }

      const sqliteQuery = selectedCollection
        .query()
        .withIndex(activeQuery.indexName, (builder: any) => {
          let nextBuilder = builder

          for (const constraint of activeQuery.constraints) {
            if (constraint.operator === 'isKnown' || constraint.operator === 'isUnknown') {
              nextBuilder = nextBuilder[constraint.operator](constraint.field)
              continue
            }

            nextBuilder = nextBuilder[constraint.operator](
              constraint.field,
              parseValue(constraint.value),
            )
          }

          return nextBuilder
        })
        .order(activeQuery.orderDirection)

      const activeTableIndexes =
        selectedTable === undefined
          ? {}
          : (INDEXES[selectedTable.name as TableName] ?? {}) as Record<
              string,
              { fields: readonly string[] }
            >

      const offsetCursor =
        activeQuery.queryMethod === 'take'
          ? buildOffsetCursorInput(
              [...(activeTableIndexes[activeQuery.indexName]?.fields ?? [])],
              activeQuery.offsetCursor,
            )
          : null

      if (offsetCursor !== null) {
        sqliteQuery.offset(offsetCursor)
      }

      switch (activeQuery.queryMethod) {
        case 'first':
          return sqliteQuery.toLiveQuery(q, { single: true })
        case 'unique':
          return sqliteQuery.toLiveQuery(q, { limit: 2 })
        case 'take':
          return sqliteQuery.toLiveQuery(q, {
            limit: parseInt(activeQuery.takeCount) || 10,
          })
        case 'collect':
        default:
          return sqliteQuery.toLiveQuery(q)
      }
    },
    [activeQuery, selectedCollection, selectedTable?.name],
  )

  const queryResult = useMemo<QueryResult | null>(() => {
    if (!activeQuery) {
      return null
    }

    if (activeQuery.queryMethod === 'first') {
      const row = indexedRowsQuery.data as SqliteDemoRow | undefined

      return {
        rows: row ? [row] : [],
        executionTime: 0,
        isLive: true,
      }
    }

    const rows = (indexedRowsQuery.data ?? []) as SqliteDemoRow[]

    if (activeQuery.queryMethod === 'unique') {
      if (rows.length > 1) {
        return {
          rows: [],
          executionTime: 0,
          isLive: true,
          error: 'Expected a unique result, but found multiple rows.',
        }
      }

      return {
        rows,
        executionTime: 0,
        isLive: true,
      }
    }

    return {
      rows,
      executionTime: 0,
      isLive: true,
    }
  }, [activeQuery, indexedRowsQuery.data])

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
    setActiveQuery(null)
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

  const handleCellEditStart = useCallback(
    async (rowId: SqliteDemoId, columnName: string) => {
      if (workspace === null || selectedTable === undefined) {
        return false
      }

      try {
        await workspace.beginCellEditTransaction(
          selectedTable.name as SqliteDemoTableName,
          rowId,
          columnName,
        )
        setActionError(null)
        return true
      } catch (error) {
        setActionError(formatUnknownError(error))
        return false
      }
    },
    [selectedTable, workspace],
  )

  const handleCellEditCancel = useCallback(
    async (rowId: SqliteDemoId, columnName: string) => {
      if (workspace === null || selectedTable === undefined) {
        return
      }

      try {
        await workspace.cancelCellEditTransaction(
          selectedTable.name as SqliteDemoTableName,
          rowId,
          columnName,
        )
        setActionError(null)
      } catch (error) {
        setActionError(formatUnknownError(error))
      }
    },
    [selectedTable, workspace],
  )

  const handleAddRow = useCallback(async () => {
    if (workspace === null || selectedTable === undefined) return

    try {
      setActionError(null)
      const tableName = selectedTable.name as SqliteDemoTableName
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
        referenceRows,
      })
    } catch (error) {
      setActionError(formatUnknownError(error))
    }
  }, [selectedTable, tables, workspace])

  const handleInsertSubmit = useCallback(async () => {
    if (workspace === null || insertModal === null) return

    try {
      await workspace.queueInsert(insertModal.tableName, insertModal.draft)
      await refreshSnapshot(workspace)
      setActionError(null)
      setInsertModal(null)
    } catch (error) {
      setActionError(formatUnknownError(error))
    }
  }, [insertModal, refreshSnapshot, workspace])

  const handleInsertClose = useCallback(() => {
    setInsertModal(null)
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
      setActiveQuery(null)
      setSelectedRowKeys(new Set())
      setDeleteModal(null)
      setActionError(null)
    } catch (error) {
      setActionError(formatUnknownError(error))
    } finally {
      setIsDeletingRows(false)
    }
  }, [deleteModal, refreshSnapshot, workspace])

  const handleRunQuery = useCallback(async (query: QueryState) => {
    setActiveQuery(query)
  }, [])

  const handleClearQuery = useCallback(() => {
    setActiveQuery(null)
  }, [])

  const handleHardClearLocal = useCallback(async () => {
    const confirmed = window.confirm(
      'Hard clear the local sandbox database and reload this page? This only removes browser-local data. If it fails, close other sandbox tabs and try again.',
    )

    if (!confirmed || isClearingLocal) {
      return
    }

    setIsClearingLocal(true)
    setActionError(null)
    setResetError(null)
    setSqliteState({ status: 'loading' })

    const currentWorkspace = workspaceRef.current

    try {
      if (currentWorkspace) {
        await currentWorkspace.close().catch((error) => {
          if (!isExpectedShutdownError(error)) {
            throw error
          }
        })
      }

      workspaceRef.current = null
      setWorkspace(null)
      await hardClearSqliteDemoLocalDatabase()
      window.location.reload()
    } catch (error) {
      setResetError(formatUnknownError(error))
      setIsClearingLocal(false)
      await loadDemo().catch((reloadError) => {
        setSqliteState({
          status: 'error',
          error: formatUnknownError(reloadError),
        })
      })
    }
  }, [isClearingLocal, loadDemo])

  const handleHardResetServer = useCallback(async () => {
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
        new URL('/api/reset-demo', resolveSqliteDemoServerUrl()).toString(),
        {
          method: 'POST',
        },
      )

      if (!response.ok) {
        throw new Error(`Server reset failed with ${response.status}.`)
      }

      window.location.reload()
    } catch (error) {
      setResetError(formatUnknownError(error))
      setIsResettingServer(false)
    }
  }, [isResettingServer])


  return (
    <HotkeysProvider>
      <div className="flex h-screen flex-col bg-background text-foreground">
        <header className="shrink-0 border-b bg-card/80 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-card/70">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h1 className="font-heading text-base font-semibold tracking-tight">
                SQLite Sandbox
              </h1>
              <p className="text-sm text-muted-foreground">
                Generated sync runtime playground
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSettingsOpen(true)}
              className="gap-2 rounded-xl"
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
              >
                <path d="M12 2v4" />
                <path d="M12 18v4" />
                <path d="m4.93 4.93 2.83 2.83" />
                <path d="m16.24 16.24 2.83 2.83" />
                <path d="M2 12h4" />
                <path d="M18 12h4" />
                <path d="m4.93 19.07 2.83-2.83" />
                <path d="m16.24 7.76 2.83-2.83" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              Settings
            </Button>
          </div>
        </header>

        {actionError && actionError !== dismissedActionError && (
          <div className="shrink-0 border-b bg-card/50 px-4 py-3">
            <DismissibleBanner
              className="border-amber-300/70 bg-amber-50/80 text-amber-950 dark:border-amber-800 dark:bg-amber-950/70 dark:text-amber-100"
              onDismiss={() => setDismissedActionError(actionError)}
            >
              {actionError}
            </DismissibleBanner>
          </div>
        )}
        {resetError && resetError !== dismissedResetError && (
          <div className="shrink-0 border-b bg-card/50 px-4 py-3">
            <DismissibleBanner
              className="border-orange-300/70 bg-orange-50/80 text-orange-950 dark:border-orange-800 dark:bg-orange-950/70 dark:text-orange-100"
              onDismiss={() => setDismissedResetError(resetError)}
            >
              {resetError}
            </DismissibleBanner>
          </div>
        )}
        {syncSnapshot.lastError &&
          syncSnapshot.connection !== 'connected' &&
          syncSnapshot.lastError !== dismissedSyncError && (
          <div className="shrink-0 border-b bg-card/50 px-4 py-3">
            <DismissibleBanner
              className="border-border/70 bg-muted/40 text-muted-foreground"
              onDismiss={() => setDismissedSyncError(syncSnapshot.lastError)}
            >
                Sync status: {syncSnapshot.lastError}
            </DismissibleBanner>
          </div>
        )}

        {sqliteState.status === 'loading' && (
          <div className="flex flex-1 items-center justify-center px-4">
            <Card className="w-full max-w-md border-border/70 bg-card/80 shadow-sm">
              <CardContent className="px-6 py-8 text-center text-sm text-muted-foreground">
                Loading synced SQLite workspace...
              </CardContent>
            </Card>
          </div>
        )}

        {sqliteState.status === 'error' && (
          <div className="flex flex-1 items-center justify-center px-4">
            <Card className="w-full max-w-md border-destructive/40 bg-card shadow-sm">
              <CardContent className="px-6 py-8 text-center text-sm text-destructive">
                {sqliteState.error}
              </CardContent>
            </Card>
          </div>
        )}

        {sqliteState.status === 'ready' && selectedTable && (
          <div className="relative flex min-h-0 flex-1 bg-muted/20">
            {!leftSidebarOpen && (
              <SidebarRibbon
                side="left"
                label="Tables"
                onClick={() => setLeftSidebarOpen(true)}
              />
            )}

            {/* Left Sidebar - Tables */}
            {leftSidebarOpen && (
              <TableSidebar
                tables={tables}
                selectedTableName={selectedTable.name}
                onSelectTable={setSelectedTableName}
                onClose={() => setLeftSidebarOpen(false)}
              />
            )}

            {/* Center - Data Table */}
            <DataTable
              tableName={selectedTable.name}
              columns={selectedTable.columns}
              rows={tableRows}
              collections={workspace?.collections ?? null}
              queryResult={queryResult}
              remoteInvalidationAt={syncSnapshot.lastInvalidationAt}
              lockedRowsByKey={lockedRowsByKey}
              onCellEditStart={handleCellEditStart}
              onCellEdit={handleCellEdit}
              onCellEditCancel={handleCellEditCancel}
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

            {!rightSidebarOpen && (
              <SidebarRibbon
                side="right"
                label="Schema"
                onClick={() => setRightSidebarOpen(true)}
              />
            )}
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

        <SettingsModal
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          isClearingLocal={isClearingLocal}
          isResettingServer={isResettingServer}
          onHardClearLocal={() => {
            void handleHardClearLocal()
          }}
          onHardResetServer={() => {
            void handleHardResetServer()
          }}
          debug={{
            persistenceType: workspace?.persistenceType ?? null,
            connection: syncSnapshot.connection,
            tabId: browserTabId,
            activeTransactions: syncSnapshot.activeTransactions,
            offlineQueue: syncSnapshot.offlineQueue,
            locks: Object.keys(lockedRowsByKey).length,
            conflicts: syncSnapshot.conflicts.length,
            sqliteVersion: sqliteState.data?.version ?? null,
            serverUrl: resolveSqliteDemoServerUrl(),
            lastError: syncSnapshot.lastError,
          }}
        />
      </div>
    </HotkeysProvider>
  )
}

function SidebarRibbon({
  side,
  label,
  onClick,
}: {
  side: 'left' | 'right'
  label: string
  onClick: () => void
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      aria-label={`Open ${label.toLowerCase()} sidebar`}
      className={[
        'absolute top-1/2 z-50 h-24 w-8 -translate-y-1/2 rounded-none border bg-card/95 px-0 py-0 text-muted-foreground shadow-md backdrop-blur transition-colors hover:bg-accent hover:text-accent-foreground',
        side === 'left'
          ? 'left-0 rounded-r-2xl border-l-0'
          : 'right-0 rounded-l-2xl border-r-0',
      ].join(' ')}
    >
      <span className="-rotate-90 whitespace-nowrap text-[11px] font-medium">
        <span className="mr-1.5 inline-flex align-middle">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <circle cx="7" cy="7" r="1.5" />
            <circle cx="7" cy="12" r="1.5" />
            <circle cx="7" cy="17" r="1.5" />
            <circle cx="12" cy="7" r="1.5" />
            <circle cx="12" cy="12" r="1.5" />
            <circle cx="12" cy="17" r="1.5" />
          </svg>
        </span>
        {label}
      </span>
    </Button>
  )
}

function DismissibleBanner({
  children,
  className,
  onDismiss,
}: {
  children: ReactNode
  className?: string
  onDismiss: () => void
}) {
  return (
    <Card className={['shadow-none', className].filter(Boolean).join(' ')}>
      <CardContent className="flex items-start gap-3 px-4 py-3">
        <div className="min-w-0 flex-1 text-sm">{children}</div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onDismiss}
          aria-label="Dismiss warning"
          className="h-7 w-7 shrink-0 rounded-md text-current hover:bg-black/5 dark:hover:bg-white/10"
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
            aria-hidden="true"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </Button>
      </CardContent>
    </Card>
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
    error.message.includes('Sync client stopped.')
  )
}
