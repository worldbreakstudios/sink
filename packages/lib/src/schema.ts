export interface ColumnDescriptor {
  readonly sqliteType: string
  readonly tsType: string
  readonly isNullable: boolean
  readonly isPrimaryKey: boolean
  readonly defaultValue: unknown | undefined
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
    })
  },

  number(): ColumnDescriptor {
    return freeze({
      sqliteType: 'INTEGER NOT NULL',
      tsType: 'number',
      isNullable: false,
      isPrimaryKey: false,
      defaultValue: undefined,
    })
  },

  float(): ColumnDescriptor {
    return freeze({
      sqliteType: 'REAL NOT NULL',
      tsType: 'number',
      isNullable: false,
      isPrimaryKey: false,
      defaultValue: undefined,
    })
  },

  boolean(): ColumnDescriptor {
    return freeze({
      sqliteType: 'INTEGER NOT NULL',
      tsType: 'boolean',
      isNullable: false,
      isPrimaryKey: false,
      defaultValue: undefined,
    })
  },

  id(): ColumnDescriptor {
    return freeze({
      sqliteType: 'INTEGER PRIMARY KEY',
      tsType: 'number',
      isNullable: false,
      isPrimaryKey: true,
      defaultValue: undefined,
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
    })
  },

  default<T>(inner: ColumnDescriptor, value: T): ColumnDescriptor {
    return freeze({
      sqliteType: inner.sqliteType,
      tsType: inner.tsType,
      isNullable: inner.isNullable,
      isPrimaryKey: inner.isPrimaryKey,
      defaultValue: value,
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
  return { tableName, columns, options }
}
