import { useCallback, useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useLiveQuery } from '@tanstack/react-db'
import type { SqliteCollection, SqliteExplorerSnapshot, SqliteIndexSnapshot } from '@sink/lib'
import { Badge } from '@/components/ui/badge'
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
  const [tableCounts, setTableCounts] = useState<Record<string, number>>({})
  const [selectedTableIndexes, setSelectedTableIndexes] = useState<SqliteIndexSnapshot[]>([])
  const [indexedQueryPreview, setIndexedQueryPreview] = useState<IndexedQueryPreviewData | null>(null)

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

  useEffect(() => {
    if (workspace === null || selectedTable === undefined) {
      setIndexedQueryPreview(null)
      return
    }

    const loadPreview = async () => {
      switch (selectedTable.name as SqliteDemoTableName) {
        case 'fields': {
          const allFields = await workspace.collections.fields.utils.readAll()
          const firstField = allFields[0]
          if (!firstField) {
            setIndexedQueryPreview(null)
            return
          }

          const rows = await workspace.collections.fields
            .query()
            .withIndex('by_object_id', (q) =>
              q.eq('object_id', firstField.object_id),
            )
            .take(5)

          setIndexedQueryPreview({
            title: 'by_object_id',
            query: `fields.query().withIndex('by_object_id', (q) => q.eq('object_id', '${firstField.object_id}')).take(5)`,
            rows,
          })
          break
        }
        case 'fieldTypes': {
          const rows = await workspace.collections.fieldTypes
            .query()
            .withIndex('by_name')
            .take(5)

          setIndexedQueryPreview({
            title: 'by_name',
            query: `fieldTypes.query().withIndex('by_name').take(5)`,
            rows,
          })
          break
        }
        case 'objects': {
          const allObjects = await workspace.collections.objects.utils.readAll()
          const firstObject = allObjects[0]
          if (!firstObject) {
            setIndexedQueryPreview(null)
            return
          }

          const rows = await workspace.collections.objects
            .query()
            .withIndex('by_type_id', (q) =>
              q.eq('type_id', firstObject.type_id),
            )
            .take(5)

          setIndexedQueryPreview({
            title: 'by_type_id',
            query: `objects.query().withIndex('by_type_id', (q) => q.eq('type_id', '${firstObject.type_id}')).take(5)`,
            rows,
          })
          break
        }
        case 'objectTypes': {
          const rows = await workspace.collections.objectTypes
            .query()
            .withIndex('by_name')
            .take(5)

          setIndexedQueryPreview({
            title: 'by_name',
            query: `objectTypes.query().withIndex('by_name').take(5)`,
            rows,
          })
          break
        }
        default:
          setIndexedQueryPreview(null)
      }
    }

    loadPreview().catch((error) => {
      console.error('Failed to load indexed query preview:', error)
      setIndexedQueryPreview(null)
    })
  }, [selectedTable, workspace])

  const modalTable = useMemo(
    () => tables.find((table) => table.name === insertModal?.tableName),
    [insertModal?.tableName, tables],
  )

  const updateTableCount = useCallback((tableName: string, count: number) => {
    setTableCounts((prev) =>
      prev[tableName] === count ? prev : { ...prev, [tableName]: count },
    )
  }, [])

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
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">
            SQLite Sandbox
          </h1>
          {workspace && (
            <Badge variant={persistenceBadgeVariant} className="text-xs">
              {workspace.persistenceType.toUpperCase()}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setActionError(null)
              setSqliteState({ status: 'loading' })
              loadDemo().catch((error: unknown) => {
                setSqliteState({
                  status: 'error',
                  error:
                    error instanceof Error
                      ? error.message
                      : 'Unknown SQLite error',
                })
              })
            }}
          >
            Reload demo database
          </Button>
          <ThemeToggle />
        </div>
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
              <CardContent className="p-4 text-sm text-amber-900">
                {actionError}
              </CardContent>
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
              <TableSchema
                schema={selectedTable.schema}
                indexes={selectedTableIndexes}
              />
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
