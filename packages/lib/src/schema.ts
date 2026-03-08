export interface ColumnDescriptor<
  TReferencedTable extends string | undefined = undefined,
> {
  readonly sqliteType: string
  readonly tsType: string
  readonly isNullable: boolean
  readonly isPrimaryKey: boolean
  readonly defaultValue: unknown | undefined
  readonly referencedTable: TReferencedTable
}

export interface RegisteredSchemaTables {}

type RegisteredSchemaTableName = keyof RegisteredSchemaTables extends never
  ? string
  : Extract<keyof RegisteredSchemaTables, string>

function freeze<TReferencedTable extends string | undefined>(
  descriptor: ColumnDescriptor<TReferencedTable>,
): ColumnDescriptor<TReferencedTable> {
  return Object.freeze(descriptor)
}

export const v = {
  string(): ColumnDescriptor {
    return freeze({
      sqliteType: 'TEXT NOT NULL',
      tsType: 'string',
      isNullable: false,
      isPrimaryKey: false,
      defaultValue: undefined,
      referencedTable: undefined,
    })
  },

  number(): ColumnDescriptor {
    return freeze({
      sqliteType: 'INTEGER NOT NULL',
      tsType: 'number',
      isNullable: false,
      isPrimaryKey: false,
      defaultValue: undefined,
      referencedTable: undefined,
    })
  },

  float(): ColumnDescriptor {
    return freeze({
      sqliteType: 'REAL NOT NULL',
      tsType: 'number',
      isNullable: false,
      isPrimaryKey: false,
      defaultValue: undefined,
      referencedTable: undefined,
    })
  },

  boolean(): ColumnDescriptor {
    return freeze({
      sqliteType: 'INTEGER NOT NULL',
      tsType: 'boolean',
      isNullable: false,
      isPrimaryKey: false,
      defaultValue: undefined,
      referencedTable: undefined,
    })
  },

  id<TTableName extends RegisteredSchemaTableName>(
    tableName: TTableName,
  ): ColumnDescriptor<TTableName> {
    return freeze({
      sqliteType: 'TEXT NOT NULL',
      tsType: 'string',
      isNullable: false,
      isPrimaryKey: false,
      defaultValue: undefined,
      referencedTable: tableName,
    })
  },

  nullable<TReferencedTable extends string | undefined>(
    inner: ColumnDescriptor<TReferencedTable>,
  ): ColumnDescriptor<TReferencedTable> {
    const sqliteType = inner.sqliteType
      .replace(' NOT NULL', '')
      .replace(' PRIMARY KEY', '')
    return freeze({
      sqliteType,
      tsType: `${inner.tsType} | null`,
      isNullable: true,
      isPrimaryKey: false,
      defaultValue: undefined,
      referencedTable: inner.referencedTable,
    })
  },

  default<T, TReferencedTable extends string | undefined>(
    inner: ColumnDescriptor<TReferencedTable>,
    value: T,
  ): ColumnDescriptor<TReferencedTable> {
    return freeze({
      sqliteType: inner.sqliteType,
      tsType: inner.tsType,
      isNullable: inner.isNullable,
      isPrimaryKey: inner.isPrimaryKey,
      defaultValue: value,
      referencedTable: inner.referencedTable,
    })
  },
} as const

export interface TableDefinitionOptions {
  orderBy?: string
  withCreatedAt?: boolean
  withUpdatedAt?: boolean
  withArchivedAt?: boolean
}

export interface TableDefinition<
  TColumns extends Record<string, ColumnDescriptor<any>> = Record<
    string,
    ColumnDescriptor<any>
  >,
> {
  tableName: string
  columns: TColumns
  options: TableDefinitionOptions
  withCreatedAt(enabled?: boolean): TableDefinition<TColumns>
  withUpdatedAt(enabled?: boolean): TableDefinition<TColumns>
  withArchivedAt(enabled?: boolean): TableDefinition<TColumns>
}

function createTableDefinition<TColumns extends Record<string, ColumnDescriptor<any>>>(
  tableName: string,
  columns: TColumns,
  options: TableDefinitionOptions = {},
): TableDefinition<TColumns> {
  if (
    'id' in columns ||
    '_id' in columns ||
    '_createdAt' in columns ||
    '_updatedAt' in columns ||
    '_archivedAt' in columns
  ) {
    throw new Error(
      `Table "${tableName}" cannot define reserved system fields.`,
    )
  }

  return {
    tableName,
    columns,
    options,
    withCreatedAt(enabled = true) {
      return createTableDefinition(tableName, columns, {
        ...options,
        withCreatedAt: enabled,
      })
    },
    withUpdatedAt(enabled = true) {
      return createTableDefinition(tableName, columns, {
        ...options,
        withUpdatedAt: enabled,
      })
    },
    withArchivedAt(enabled = true) {
      return createTableDefinition(tableName, columns, {
        ...options,
        withArchivedAt: enabled,
      })
    },
  }
}

export function defineTable<TColumns extends Record<string, ColumnDescriptor<any>>>(
  tableName: string,
  columns: TColumns,
  options: TableDefinitionOptions = {},
): TableDefinition<TColumns> {
  return createTableDefinition(tableName, columns, options)
}
