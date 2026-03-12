import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import type {
  SerializedSqliteValue,
  SinkDevtoolsDatabaseSummary,
  SinkDevtoolsExplorerSnapshot,
  SinkDevtoolsRowRecord,
  SqliteIndexSnapshot,
} from '@sink/lib'
import type { ExplorerClient } from './types'
import type { InsertModalState } from './components/insert-row-modal'
import type { QueryResult } from './components/data-table'
import { CreateTableModal } from './components/create-table-modal'
import { DataTable } from './components/data-table'
import { InsertRowModal } from './components/insert-row-modal'
import { RightSidebar } from './components/right-sidebar'
import { TableSidebar } from './components/table-sidebar'
import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './components/ui/select'

export function SinkExplorer({
  client,
  title = 'Sink',
  headerActions,
}: {
  client: ExplorerClient
  title?: string
  headerActions?: ReactNode
}) {
  const [databases, setDatabases] = useState<SinkDevtoolsDatabaseSummary[]>([])
  const [selectedDatabaseId, setSelectedDatabaseId] = useState('')
  const [selectedTableName, setSelectedTableName] = useState('')
  const [snapshotState, setSnapshotState] = useState<{
    status: 'loading' | 'ready' | 'error'
    snapshot?: SinkDevtoolsExplorerSnapshot
    error?: string
  }>({ status: 'loading' })
  const [rows, setRows] = useState<SinkDevtoolsRowRecord[]>([])
  const [selectedRows, setSelectedRows] = useState<SinkDevtoolsRowRecord[]>([])
  const [indexes, setIndexes] = useState<SqliteIndexSnapshot[]>([])
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null)
  const [insertModal, setInsertModal] = useState<InsertModalState | null>(null)
  const [rightSidebarOpen, setRightSidebarOpen] = useState(true)
  const [createTableModalOpen, setCreateTableModalOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const selectedDatabase = useMemo(
    () =>
      databases.find((database) => database.id === selectedDatabaseId) ??
      databases[0] ??
      null,
    [databases, selectedDatabaseId],
  )
  const tables = snapshotState.snapshot?.tables ?? []
  const selectedTable = useMemo(
    () => tables.find((table) => table.name === selectedTableName) ?? tables[0] ?? null,
    [selectedTableName, tables],
  )
  const selectedTableReferenceColumns = useMemo(
    () =>
      selectedDatabase && selectedTable
        ? selectedDatabase.schema.referenceColumns[selectedTable.name] ?? {}
        : {},
    [selectedDatabase, selectedTable],
  )

  const refreshRowsAndIndexes = useCallback(
    async (databaseId: string, tableName: string) => {
      const [nextRows, nextIndexes] = await Promise.all([
        client.readRows(databaseId, tableName),
        client.getTableIndexes(databaseId, tableName),
      ])
      setRows(nextRows)
      setIndexes(nextIndexes)
      setSelectedRows([])
    },
    [client],
  )

  const refreshSnapshot = useCallback(
    async (databaseId: string) => {
      const snapshot = await client.getExplorerSnapshot(databaseId)
      setSnapshotState({
        status: 'ready',
        snapshot,
      })
      return snapshot
    },
    [client],
  )

  const refreshDatabases = useCallback(async () => {
    const nextDatabases = await client.listDatabases()
    setDatabases(nextDatabases)
    setSelectedDatabaseId((current) =>
      nextDatabases.some((database) => database.id === current)
        ? current
        : (nextDatabases[0]?.id ?? ''),
    )
    return nextDatabases
  }, [client])

  const refreshCurrent = useCallback(async () => {
    const nextDatabases = await refreshDatabases()
    const databaseId =
      nextDatabases.find((database) => database.id === selectedDatabaseId)?.id ??
      nextDatabases[0]?.id

    if (!databaseId) {
      setSnapshotState({
        status: 'ready',
        snapshot: {
          version: '',
          tables: [],
        },
      })
      setRows([])
      setIndexes([])
      return
    }

    const snapshot = await refreshSnapshot(databaseId)
    const tableName =
      snapshot.tables.find((table) => table.name === selectedTableName)?.name ??
      snapshot.tables[0]?.name

    if (tableName) {
      setSelectedTableName(tableName)
      await refreshRowsAndIndexes(databaseId, tableName)
    } else {
      setRows([])
      setIndexes([])
    }
  }, [
    refreshDatabases,
    refreshRowsAndIndexes,
    refreshSnapshot,
    selectedDatabaseId,
    selectedTableName,
  ])

  useEffect(() => {
    refreshCurrent().catch((error: unknown) => {
      setSnapshotState({
        status: 'error',
        error:
          error instanceof Error ? error.message : 'Unable to load Sink databases.',
      })
    })
  }, [refreshCurrent])

  useEffect(() => {
    if (!selectedDatabase) {
      return
    }

    refreshSnapshot(selectedDatabase.id).catch((error: unknown) => {
      setSnapshotState({
        status: 'error',
        error:
          error instanceof Error ? error.message : 'Unable to refresh Sink database.',
      })
    })
  }, [refreshSnapshot, selectedDatabase?.id])

  useEffect(() => {
    if (!selectedDatabase || !selectedTable) {
      return
    }

    refreshRowsAndIndexes(selectedDatabase.id, selectedTable.name).catch(
      (error: unknown) => {
        setActionError(
          error instanceof Error ? error.message : 'Unable to load table rows.',
        )
      },
    )
  }, [refreshRowsAndIndexes, selectedDatabase?.id, selectedTable?.name])

  useEffect(() => {
    if (!selectedDatabase) {
      return
    }

    const subscription = client.subscribeChanges(selectedDatabase.id, () => {
      refreshCurrent().catch(console.error)
    })

    return () => {
      void Promise.resolve(subscription).then((unsubscribe) => {
        unsubscribe()
      })
    }
  }, [client, refreshCurrent, selectedDatabase?.id])

  useEffect(() => {
    if (
      tables.length > 0 &&
      !tables.some((table) => table.name === selectedTableName)
    ) {
      setSelectedTableName(tables[0]?.name ?? '')
    }
  }, [selectedTableName, tables])

  useEffect(() => {
    setQueryResult(null)
  }, [selectedDatabase?.id, selectedTable?.name])

  const handleCellEdit = useCallback(
    async (rowId: SerializedSqliteValue, columnName: string, value: string) => {
      if (!selectedDatabase || !selectedTable) {
        return
      }

      try {
        await client.updateCell(
          selectedDatabase.id,
          selectedTable.name,
          rowId,
          columnName,
          value,
        )
        await refreshCurrent()
        setActionError(null)
      } catch (error) {
        setActionError(
          error instanceof Error
            ? error.message
            : 'Unable to update SQLite cell.',
        )
      }
    },
    [client, refreshCurrent, selectedDatabase, selectedTable],
  )

  const handleAddRow = useCallback(async () => {
    if (!selectedDatabase || !selectedTable) {
      return
    }

    try {
      const [draft, referenceRows] = await Promise.all([
        client.createInsertDraft(selectedDatabase.id, selectedTable.name),
        client.getReferenceRows(selectedDatabase.id, selectedTable.name),
      ])

      setInsertModal({
        tableName: selectedTable.name,
        draft,
        referenceRows,
      })
      setActionError(null)
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'Unable to prepare row insert.',
      )
    }
  }, [client, selectedDatabase, selectedTable])

  const handleInsertSubmit = useCallback(async () => {
    if (!selectedDatabase || !insertModal) {
      return
    }

    try {
      await client.insertDraft(
        selectedDatabase.id,
        insertModal.tableName,
        insertModal.draft,
      )
      await refreshCurrent()
      setInsertModal(null)
      setActionError(null)
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'Unable to insert SQLite row.',
      )
    }
  }, [client, insertModal, refreshCurrent, selectedDatabase])

  const handleRunQuery = useCallback(
    async (query: Parameters<typeof client.runIndexedQuery>[2]) => {
      if (!selectedDatabase || !selectedTable) {
        return
      }

      const start = performance.now()

      try {
        const resultRows = await client.runIndexedQuery(
          selectedDatabase.id,
          selectedTable.name,
          query,
        )
        setQueryResult({
          rows: resultRows,
          executionTime: performance.now() - start,
        })
      } catch (error) {
        setQueryResult({
          rows: [],
          executionTime: 0,
          error: error instanceof Error ? error.message : 'Query failed.',
        })
      }
    },
    [client, selectedDatabase, selectedTable],
  )

  const persistenceBadgeVariant =
    selectedDatabase?.persistenceType === 'opfs'
      ? 'default'
      : selectedDatabase?.persistenceType === 'localStorage'
        ? 'secondary'
        : 'outline'

  if (snapshotState.status === 'error') {
    return (
      <div className="flex h-full items-center justify-center text-sm text-destructive">
        {snapshotState.error}
      </div>
    )
  }

  if (snapshotState.status === 'loading') {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading Sink explorer...
      </div>
    )
  }

  if (databases.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <div className="max-w-md space-y-3">
          <h2 className="text-lg font-semibold">No registered Sink databases</h2>
          <p className="text-sm text-muted-foreground">
            Upgrade <code>@sink/lib</code>, rerun <code>sink generate</code>, rebuild
            the app, and refresh the page so generated collections can register their
            schema metadata with the devtools bridge.
          </p>
          <Button variant="outline" onClick={() => void refreshCurrent()}>
            Refresh
          </Button>
        </div>
      </div>
    )
  }

  if (!selectedDatabase || !selectedTable) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No Sink tables found in the selected database.
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center justify-between border-b px-4">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold">{title}</h1>
          <Badge variant={persistenceBadgeVariant} className="text-xs">
            {selectedDatabase.persistenceType.toUpperCase()}
          </Badge>
          {snapshotState.snapshot?.version && (
            <span className="text-xs text-muted-foreground">
              SQLite {snapshotState.snapshot.version}
            </span>
          )}
          {databases.length > 1 && (
            <Select value={selectedDatabase.id} onValueChange={setSelectedDatabaseId}>
              <SelectTrigger className="h-8 w-52 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {databases.map((database) => (
                  <SelectItem key={database.id} value={database.id}>
                    {database.displayLabel}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!rightSidebarOpen && (
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
            variant="outline"
            size="sm"
            onClick={() => void refreshCurrent()}
            className="text-xs"
          >
            Refresh
          </Button>
          {headerActions}
        </div>
      </header>

      {actionError && (
        <div className="shrink-0 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {actionError}
        </div>
      )}

      {!selectedDatabase.supportsExecuteNotifications && (
        <div className="shrink-0 border-b border-sky-200 bg-sky-50 px-4 py-2 text-xs text-sky-900 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200">
          Raw SQL writes outside generated Sink collection mutations require a manual refresh on this database.
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <TableSidebar
          tables={tables}
          selectedTableName={selectedTable.name}
          onSelectTable={setSelectedTableName}
          onCreateTable={() => setCreateTableModalOpen(true)}
        />

        <DataTable
          tableName={selectedTable.name}
          columns={selectedTable.columns}
          rows={rows}
          schema={selectedDatabase.schema}
          queryResult={queryResult}
          onCellEdit={handleCellEdit}
          onAddRow={handleAddRow}
          onRunQuery={handleRunQuery}
          onSelectionChange={setSelectedRows}
        />

        <RightSidebar
          tableName={selectedTable.name}
          schema={selectedDatabase.schema}
          indexes={indexes}
          isOpen={rightSidebarOpen}
          onClose={() => setRightSidebarOpen(false)}
          selectedRows={selectedRows}
          columns={selectedTable.columns}
          referenceColumns={selectedTableReferenceColumns}
        />
      </div>

      <InsertRowModal
        modal={insertModal}
        columns={selectedTable.columns}
        referenceColumns={selectedTableReferenceColumns}
        onClose={() => setInsertModal(null)}
        onSubmit={handleInsertSubmit}
        onDraftChange={(columnName, value) => {
          setInsertModal((current) =>
            current
              ? {
                  ...current,
                  draft: {
                    ...current.draft,
                    [columnName]: value,
                  },
                }
              : null,
          )
        }}
      />

      <CreateTableModal
        open={createTableModalOpen}
        onClose={() => setCreateTableModalOpen(false)}
      />
    </div>
  )
}
