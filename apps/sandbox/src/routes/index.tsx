import { useCallback, useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useLiveQuery } from '@tanstack/react-db'
import type { SqliteCollection, SqliteExplorerSnapshot } from '@sink/lib'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  createSqliteDemoCollectionsWorkspace,
  type SqliteDemoCollectionsWorkspace,
  type SqliteDemoId,
  type SqliteDemoRow,
  type SqliteDemoTableName,
} from '@/lib/sqlite-demo-collections'
import {
  CollectionCounter,
  DataTable,
  IndexedQueryPreview,
  type IndexedQueryPreviewData,
  InsertRowModal,
  type InsertModalState,
  TableSchema,
  TableSidebar,
} from './sandbox'

export const Route = createFileRoute('/')({
  ssr: false,
  component: App,
})

function App() {
  const [workspace, setWorkspace] = useState<SqliteDemoCollectionsWorkspace | null>(null)
  const [sqliteState, setSqliteState] = useState<{
    status: 'loading' | 'ready' | 'error'
    data?: SqliteExplorerSnapshot
    error?: string
  }>({ status: 'loading' })
  const [actionError, setActionError] = useState<string | null>(null)
  const [selectedTableName, setSelectedTableName] = useState<string>('')
  const [insertModal, setInsertModal] = useState<InsertModalState | null>(null)
  const [tableCounts, setTableCounts] = useState<Record<string, number>>({})

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

  const selectedRowsQuery = useLiveQuery(() => selectedCollection, [selectedCollection])

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

  const modalTable = useMemo(
    () => tables.find((table) => table.name === insertModal?.tableName),
    [insertModal?.tableName, tables],
  )

  const updateTableCount = useCallback((tableName: string, count: number) => {
    setTableCounts((prev) =>
      prev[tableName] === count ? prev : { ...prev, [tableName]: count },
    )
  }, [])

  const selectedTableIndexes = useMemo(
    () =>
      workspace !== null && selectedTable !== undefined
        ? workspace.database.getTableIndexes(selectedTable.name)
        : [],
    [selectedTable, workspace],
  )

  const indexedQueryPreview = useMemo((): IndexedQueryPreviewData | null => {
    if (workspace === null || selectedTable === undefined) {
      return null
    }

    switch (selectedTable.name as SqliteDemoTableName) {
      case 'fields': {
        const firstField = workspace.collections.fields.utils.readAll()[0]
        if (!firstField) return null

        return {
          title: 'by_object_id',
          query: `fields.query().withIndex('by_object_id', (q) => q.eq('object_id', '${firstField.object_id}')).take(5)`,
          rows: workspace.collections.fields
            .query()
            .withIndex('by_object_id', (q) => q.eq('object_id', firstField.object_id))
            .take(5),
        }
      }
      case 'fieldTypes': {
        return {
          title: 'by_name',
          query: `fieldTypes.query().withIndex('by_name').take(5)`,
          rows: workspace.collections.fieldTypes.query().withIndex('by_name').take(5),
        }
      }
      case 'objects': {
        const firstObject = workspace.collections.objects.utils.readAll()[0]
        if (!firstObject) return null

        return {
          title: 'by_type_id',
          query: `objects.query().withIndex('by_type_id', (q) => q.eq('type_id', '${firstObject.type_id}')).take(5)`,
          rows: workspace.collections.objects
            .query()
            .withIndex('by_type_id', (q) => q.eq('type_id', firstObject.type_id))
            .take(5),
        }
      }
      case 'objectTypes': {
        return {
          title: 'by_name',
          query: `objectTypes.query().withIndex('by_name').take(5)`,
          rows: workspace.collections.objectTypes.query().withIndex('by_name').take(5),
        }
      }
      default:
        return null
    }
  }, [selectedTable, workspace, selectedRows])

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
        refreshSnapshot(workspace)
        setActionError(null)
      } catch (error) {
        setActionError(
          error instanceof Error ? error.message : 'Unable to update SQLite cell.',
        )
      }
    },
    [refreshSnapshot, selectedTable, workspace],
  )

  const handleAddRow = useCallback(() => {
    if (workspace === null || selectedTable === undefined) return

    setActionError(null)
    const tableName = selectedTable.name as SqliteDemoTableName
    const transaction = workspace.createBatchTransaction({ autoCommit: false })

    setInsertModal({
      tableName,
      draft: workspace.createInsertDraft(tableName),
      transaction,
    })
  }, [selectedTable, workspace])

  const handleInsertSubmit = useCallback(async () => {
    if (workspace === null || insertModal === null) return

    try {
      workspace.queueInsert(insertModal.tableName, insertModal.draft, insertModal.transaction)
      await insertModal.transaction.commit()
      refreshSnapshot(workspace)
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

  return (
    <main className="page-wrap py-8">
      {workspace !== null &&
        tables.map((table) => (
          <CollectionCounter
            key={table.name}
            tableName={table.name}
            collection={
              workspace.collections[
                table.name as SqliteDemoTableName
              ] as SqliteCollection<SqliteDemoRow, SqliteDemoId>
            }
            onCount={updateTableCount}
          />
        ))}

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">SQLite Sandbox</h1>
        </div>
        <Button
          variant="outline"
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
          Reload demo database
        </Button>
      </div>

      {sqliteState.status === 'loading' && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Loading SQLite collections...
          </CardContent>
        </Card>
      )}

      {sqliteState.status === 'error' && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="p-6 text-sm text-destructive">
            {sqliteState.error}
          </CardContent>
        </Card>
      )}

      {sqliteState.status === 'ready' && selectedTable && (
        <section className="space-y-4">
          {actionError && (
            <Card className="border-amber-300 bg-amber-50">
              <CardContent className="p-4 text-sm text-amber-900">{actionError}</CardContent>
            </Card>
          )}

          <Card className="overflow-hidden">
            <div className="grid md:grid-cols-[240px_minmax(0,1fr)]">
              <TableSidebar
                tables={tables}
                selectedTableName={selectedTable.name}
                tableCounts={tableCounts}
                sqliteVersion={sqliteState.data?.version}
                onSelectTable={setSelectedTableName}
              />
              <TableSchema schema={selectedTable.schema} indexes={selectedTableIndexes} />
            </div>
          </Card>

          {indexedQueryPreview && (
            <IndexedQueryPreview
              preview={indexedQueryPreview}
              tableName={selectedTable.name}
            />
          )}

          <DataTable
            tableName={selectedTable.name}
            columns={selectedTable.columns}
            rows={selectedRows}
            onCellEdit={handleCellEdit}
            onAddRow={handleAddRow}
          />
        </section>
      )}

      <InsertRowModal
        modal={insertModal}
        columns={modalTable?.columns ?? []}
        workspace={workspace}
        onClose={handleInsertClose}
        onSubmit={handleInsertSubmit}
        onDraftChange={handleDraftChange}
      />
    </main>
  )
}
