import { useState, useCallback, useMemo } from 'react'
import { Button } from './ui/button'
import { CodeBlock } from './ui/code-block'
import { Checkbox } from './ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'
import { Input } from './ui/input'
import { Label } from './ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select'

const COLUMN_TYPES = [
  { value: 'string', label: 'String' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'id', label: 'ID (FK)' },
] as const

type ColumnType = (typeof COLUMN_TYPES)[number]['value']

interface ColumnDefinition {
  id: string
  name: string
  type: ColumnType
  referencedTable: string
  optional: boolean
  enforceExists: boolean
}

interface IndexDefinition {
  id: string
  columns: string[]
  unique: boolean
}

function createEmptyColumn(): ColumnDefinition {
  return {
    id: crypto.randomUUID(),
    name: '',
    type: 'string',
    referencedTable: '',
    optional: false,
    enforceExists: true,
  }
}

function createEmptyIndex(): IndexDefinition {
  return {
    id: crypto.randomUUID(),
    columns: [],
    unique: false,
  }
}

function deriveIndexName(columns: string[]): string {
  if (columns.length === 0) return ''
  return 'by_' + columns.join('_')
}

function toSnakeCase(str: string): string {
  return str
    .replace(/([A-Z])/g, '_$1')
    .replace(/[\s-]+/g, '_')
    .replace(/^_/, '')
    .toLowerCase()
}

interface ImplicitColumns {
  createdAt: boolean
  updatedAt: boolean
  archivedAt: boolean
}

function generateCode(
  tableName: string,
  columns: ColumnDefinition[],
  indexes: IndexDefinition[],
  implicitColumns: ImplicitColumns,
): string {
  const snakeName = toSnakeCase(tableName) || 'my_table'
  const validColumns = columns.filter((col) => col.name.trim())

  if (validColumns.length === 0) {
    return `// Add columns to generate code`
  }

  // Generate schema fields
  const schemaFields = validColumns.map((col) => {
    let validator: string
    if (col.type === 'id') {
      const refTable = col.referencedTable || 'table'
      validator = col.enforceExists
        ? `v.id('${refTable}', { enforceExists: true })`
        : `v.id('${refTable}')`
    } else if (col.type === 'number') {
      validator = 'v.number()'
    } else if (col.type === 'boolean') {
      validator = 'v.boolean()'
    } else {
      validator = 'v.string()'
    }

    if (col.optional) {
      validator = `v.optional(${validator})`
    }

    return `    ${col.name}: ${validator},`
  })

  // Build the defineTable call
  let code = `import { defineTable, v } from '@sink/lib'

export default defineTable(
  '${snakeName}',
  {
${schemaFields.join('\n')}
  },
)`

  // Add implicit column methods
  if (implicitColumns.createdAt) {
    code += `\n  .withCreatedAt(true)`
  }
  if (implicitColumns.updatedAt) {
    code += `\n  .withUpdatedAt(true)`
  }
  if (implicitColumns.archivedAt) {
    code += `\n  .withArchivedAt(true)`
  }

  // Add indexes
  const validIndexes = indexes.filter((idx) => idx.columns.length > 0)
  for (const idx of validIndexes) {
    const indexName = deriveIndexName(idx.columns)
    const columnsStr = idx.columns.map((c) => `'${c}'`).join(', ')
    if (idx.unique) {
      code += `\n  .uniqueIndex('${indexName}', [${columnsStr}])`
    } else {
      code += `\n  .index('${indexName}', [${columnsStr}])`
    }
  }

  return code
}

export function CreateTableModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const [tableName, setTableName] = useState('')
  const [columns, setColumns] = useState<ColumnDefinition[]>([createEmptyColumn()])
  const [indexes, setIndexes] = useState<IndexDefinition[]>([])
  const [implicitColumns, setImplicitColumns] = useState<ImplicitColumns>({
    createdAt: true,
    updatedAt: false,
    archivedAt: false,
  })

  const addColumn = useCallback(() => {
    setColumns((prev) => [...prev, createEmptyColumn()])
  }, [])

  const removeColumn = useCallback((id: string) => {
    setColumns((prev) => prev.filter((col) => col.id !== id))
  }, [])

  const updateColumn = useCallback((id: string, updates: Partial<ColumnDefinition>) => {
    setColumns((prev) =>
      prev.map((col) => (col.id === id ? { ...col, ...updates } : col)),
    )
  }, [])

  const addIndex = useCallback(() => {
    setIndexes((prev) => [...prev, createEmptyIndex()])
  }, [])

  const removeIndex = useCallback((id: string) => {
    setIndexes((prev) => prev.filter((idx) => idx.id !== id))
  }, [])

  const updateIndex = useCallback((id: string, updates: Partial<IndexDefinition>) => {
    setIndexes((prev) =>
      prev.map((idx) => (idx.id === id ? { ...idx, ...updates } : idx)),
    )
  }, [])

  const updateImplicitColumn = useCallback((key: keyof ImplicitColumns, value: boolean) => {
    setImplicitColumns((prev) => ({ ...prev, [key]: value }))
  }, [])

  const handleReset = useCallback(() => {
    setTableName('')
    setColumns([createEmptyColumn()])
    setIndexes([])
    setImplicitColumns({ createdAt: true, updatedAt: false, archivedAt: false })
  }, [])

  const handleClose = useCallback(() => {
    handleReset()
    onClose()
  }, [handleReset, onClose])

  const columnNames = useMemo(
    () => columns.filter((c) => c.name.trim()).map((c) => c.name),
    [columns],
  )

  // All available columns for indexes (user columns + implicit columns)
  const indexableColumns = useMemo(() => {
    const cols = ['_id', ...columnNames]
    if (implicitColumns.createdAt) cols.push('_createdAt')
    if (implicitColumns.updatedAt) cols.push('_updatedAt')
    if (implicitColumns.archivedAt) cols.push('_archivedAt')
    return cols
  }, [columnNames, implicitColumns])

  const moveIndexColumn = useCallback((indexId: string, fromIdx: number, toIdx: number) => {
    if (toIdx < 0) return
    setIndexes((prev) =>
      prev.map((idx) => {
        if (idx.id !== indexId) return idx
        if (toIdx >= idx.columns.length) return idx
        const cols = [...idx.columns]
        const removed = cols.splice(fromIdx, 1)[0]
        if (removed === undefined) return idx
        cols.splice(toIdx, 0, removed)
        return { ...idx, columns: cols }
      }),
    )
  }, [])

  const generatedCode = useMemo(
    () => generateCode(tableName, columns, indexes, implicitColumns),
    [tableName, columns, indexes, implicitColumns],
  )

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Create Table</DialogTitle>
          <DialogDescription>
            Define your table schema. Copy the generated code to add it to your project.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-6 min-h-0 flex-1 overflow-hidden">
          {/* Left: Form */}
          <div className="flex-1 overflow-auto space-y-4 p-0.5 -m-0.5">
            {/* Table Name */}
            <div className="space-y-2">
              <Label htmlFor="table-name">Table Name</Label>
              <Input
                id="table-name"
                value={tableName}
                onChange={(e) => setTableName(e.target.value)}
                placeholder="users"
              />
            </div>

            {/* Columns */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Columns</Label>
                <Button variant="outline" size="sm" onClick={addColumn}>
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
                    <path d="M5 12h14" />
                    <path d="M12 5v14" />
                  </svg>
                  Add Column
                </Button>
              </div>

              <div className="space-y-3">
                {columns.map((column, index) => (
                  <div
                    key={column.id}
                    className="rounded-lg border bg-muted/30 p-3 space-y-3"
                  >
                    {/* Column header row */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-muted-foreground w-6">
                        {index + 1}.
                      </span>
                      <Input
                        value={column.name}
                        onChange={(e) => updateColumn(column.id, { name: e.target.value })}
                        placeholder="column_name"
                        className="flex-1 h-8 text-sm"
                      />
                      <Select
                        value={column.type}
                        onValueChange={(value) =>
                          updateColumn(column.id, { type: value as ColumnType })
                        }
                      >
                        <SelectTrigger size="sm" className="w-28">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {COLUMN_TYPES.map((type) => (
                            <SelectItem key={type.value} value={type.value}>
                              {type.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeColumn(column.id)}
                        disabled={columns.length === 1}
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
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
                          <path d="M18 6 6 18" />
                          <path d="m6 6 12 12" />
                        </svg>
                      </Button>
                    </div>

                    {/* Options row */}
                    <div className="flex items-center gap-4 pl-8">
                      <label className="flex items-center gap-2 text-xs">
                        <Checkbox
                          checked={column.optional}
                          onCheckedChange={(checked) =>
                            updateColumn(column.id, { optional: checked === true })
                          }
                        />
                        <span>Optional</span>
                      </label>
                      {column.type === 'id' && (
                        <>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">References:</span>
                            <Input
                              value={column.referencedTable}
                              onChange={(e) =>
                                updateColumn(column.id, { referencedTable: e.target.value })
                              }
                              placeholder="tableName"
                              className="h-7 w-28 text-xs"
                            />
                          </div>
                          <label className="flex items-center gap-2 text-xs">
                            <Checkbox
                              checked={column.enforceExists}
                              onCheckedChange={(checked) =>
                                updateColumn(column.id, { enforceExists: checked === true })
                              }
                            />
                            <span>Enforce Exists</span>
                          </label>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Implicit Columns */}
            <div className="space-y-2">
              <Label>Implicit Columns</Label>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={implicitColumns.createdAt}
                    onCheckedChange={(checked) => updateImplicitColumn('createdAt', checked === true)}
                  />
                  <span>_createdAt</span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={implicitColumns.updatedAt}
                    onCheckedChange={(checked) => updateImplicitColumn('updatedAt', checked === true)}
                  />
                  <span>_updatedAt</span>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={implicitColumns.archivedAt}
                    onCheckedChange={(checked) => updateImplicitColumn('archivedAt', checked === true)}
                  />
                  <span>_archivedAt</span>
                </label>
              </div>
            </div>

            {/* Indexes */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Indexes</Label>
                <Button variant="outline" size="sm" onClick={addIndex}>
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
                    <path d="M5 12h14" />
                    <path d="M12 5v14" />
                  </svg>
                  Add Index
                </Button>
              </div>

              {indexes.length === 0 ? (
                <p className="text-xs text-muted-foreground">No indexes defined.</p>
              ) : (
                <div className="space-y-3">
                  {indexes.map((idx) => (
                    <div
                      key={idx.id}
                      className="rounded-lg border bg-muted/30 p-3 space-y-3"
                    >
                      <div className="flex items-center gap-2">
                        <span className="flex-1 font-mono text-sm text-muted-foreground">
                          {idx.columns.length > 0 ? deriveIndexName(idx.columns) : '(select columns)'}
                        </span>
                        <label className="flex items-center gap-2 text-xs">
                          <Checkbox
                            checked={idx.unique}
                            onCheckedChange={(checked) =>
                              updateIndex(idx.id, { unique: checked === true })
                            }
                          />
                          <span>Unique</span>
                        </label>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeIndex(idx.id)}
                          className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
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
                            <path d="M18 6 6 18" />
                            <path d="m6 6 12 12" />
                          </svg>
                        </Button>
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">Columns:</span>
                          <Select
                            value=""
                            onValueChange={(value) => {
                              if (value && !idx.columns.includes(value)) {
                                updateIndex(idx.id, { columns: [...idx.columns, value] })
                              }
                            }}
                          >
                            <SelectTrigger size="sm" className="h-7 w-auto gap-1 px-2 [&>span]:hidden">
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
                                className="shrink-0"
                              >
                                <path d="M5 12h14" />
                                <path d="M12 5v14" />
                              </svg>
                            </SelectTrigger>
                            <SelectContent position="popper" className="z-100">
                              {indexableColumns
                                .filter((col) => !idx.columns.includes(col))
                                .map((col) => (
                                  <SelectItem key={col} value={col}>
                                    {col}
                                  </SelectItem>
                                ))}
                              {indexableColumns.filter((col) => !idx.columns.includes(col)).length === 0 && (
                                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                                  All columns added
                                </div>
                              )}
                            </SelectContent>
                          </Select>
                        </div>
                        {idx.columns.length > 0 && (
                          <div className="flex flex-col gap-1 pl-4">
                            {idx.columns.map((col, colIdx) => (
                              <div
                                key={col}
                                className="flex items-center gap-1 text-xs"
                              >
                                <span className="w-4 text-muted-foreground">{colIdx + 1}.</span>
                                <span className="flex-1 font-mono">{col}</span>
                                <button
                                  type="button"
                                  onClick={() => moveIndexColumn(idx.id, colIdx, colIdx - 1)}
                                  disabled={colIdx === 0}
                                  className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="m18 15-6-6-6 6"/>
                                  </svg>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => moveIndexColumn(idx.id, colIdx, colIdx + 1)}
                                  disabled={colIdx === idx.columns.length - 1}
                                  className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="m6 9 6 6 6-6"/>
                                  </svg>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    updateIndex(idx.id, { columns: idx.columns.filter((c) => c !== col) })
                                  }}
                                  className="p-0.5 text-muted-foreground hover:text-destructive"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M18 6 6 18" />
                                    <path d="m6 6 12 12" />
                                  </svg>
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right: Code Preview */}
          <div className="w-80 shrink-0 flex flex-col min-h-0">
            <div className="text-xs font-medium text-muted-foreground mb-2">
              Generated Code
            </div>
            <div className="flex-1 overflow-auto">
              <CodeBlock code={generatedCode} language="typescript" />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-4 border-t mt-4">
          <Button variant="outline" size="sm" onClick={handleReset}>
            Reset
          </Button>
          <Button variant="outline" onClick={handleClose}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
