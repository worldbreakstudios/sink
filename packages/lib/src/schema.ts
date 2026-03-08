export interface ColumnDescriptor {
  readonly sqliteType: string
  readonly tsType: string
  readonly isNullable: boolean
  readonly isPrimaryKey: boolean
  readonly defaultValue: unknown | undefined
  readonly referencedTable: string | undefined
}

function freeze(descriptor: ColumnDescriptor): ColumnDescriptor {
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

  id(tableName: string): ColumnDescriptor {
    return freeze({
      sqliteType: 'TEXT NOT NULL',
      tsType: 'string',
      isNullable: false,
      isPrimaryKey: false,
      defaultValue: undefined,
      referencedTable: tableName,
    })
  },

  nullable(inner: ColumnDescriptor): ColumnDescriptor {
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

  default<T>(inner: ColumnDescriptor, value: T): ColumnDescriptor {
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
}

export interface TableDefinition<
  TColumns extends Record<string, ColumnDescriptor> = Record<
    string,
    ColumnDescriptor
  >,
> {
  tableName: string
  columns: TColumns
  options: TableDefinitionOptions
}

export function defineTable<TColumns extends Record<string, ColumnDescriptor>>(
  tableName: string,
  columns: TColumns,
  options: TableDefinitionOptions = {},
): TableDefinition<TColumns> {
  if ('id' in columns || '_id' in columns) {
    throw new Error(
      `Table "${tableName}" cannot define "id" or "_id"; "_id" is an implicit reserved system field.`,
    )
  }

  return { tableName, columns, options }
}
