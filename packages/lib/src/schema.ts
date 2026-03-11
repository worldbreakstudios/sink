export interface ColumnDescriptor<
  TReferencedTable extends string | undefined = undefined,
> {
  readonly sqliteType: string
  readonly tsType: string
  readonly isNullable: boolean
  readonly isPrimaryKey: boolean
  readonly defaultValue: unknown | undefined
  readonly referencedTable: TReferencedTable
  readonly enforceExists: boolean
}

export interface RegisteredSchemaTables {}

export interface IdColumnOptions {
  enforceExists?: boolean
}

export interface TableIndexOptions<
  TFields extends readonly string[] = readonly string[],
> {
  fields: TFields
  staged?: boolean
  unique?: boolean
}

export interface TableIndexDefinition<
  TFields extends readonly string[] = readonly string[],
> {
  name: string
  fields: TFields
  staged: boolean
  unique: boolean
}

export const RESERVED_SYSTEM_FIELD_NAMES = [
  'id',
  '_id',
  '_actorId',
  '_createdAt',
  '_updatedAt',
  '_archivedAt',
] as const

export const RESERVED_INDEX_NAMES = ['by_id', 'by_creation_time', 'by_actor_id'] as const

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
      enforceExists: false,
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
      enforceExists: false,
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
      enforceExists: false,
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
      enforceExists: false,
    })
  },

  id<TTableName extends RegisteredSchemaTableName>(
    tableName: TTableName,
    options: IdColumnOptions = {},
  ): ColumnDescriptor<TTableName> {
    return freeze({
      sqliteType: 'TEXT NOT NULL',
      tsType: 'string',
      isNullable: false,
      isPrimaryKey: false,
      defaultValue: undefined,
      referencedTable: tableName,
      enforceExists: options.enforceExists ?? false,
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
      enforceExists: inner.enforceExists,
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
      enforceExists: inner.enforceExists,
    })
  },
} as const

export interface TableDefinitionOptions {
  orderBy?: string
  withActorId?: boolean
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
  indexes: readonly TableIndexDefinition[]
  index(
    name: string,
    fields: readonly string[],
  ): TableDefinition<TColumns>
  index(
    name: string,
    options: TableIndexOptions,
  ): TableDefinition<TColumns>
  uniqueIndex(
    name: string,
    fields: readonly string[],
  ): TableDefinition<TColumns>
  uniqueIndex(
    name: string,
    options: TableIndexOptions,
  ): TableDefinition<TColumns>
  withActorId(enabled?: boolean): TableDefinition<TColumns>
  withCreatedAt(enabled?: boolean): TableDefinition<TColumns>
  withUpdatedAt(enabled?: boolean): TableDefinition<TColumns>
  withArchivedAt(enabled?: boolean): TableDefinition<TColumns>
}

export function getImplicitSystemFields(
  options: TableDefinitionOptions,
): readonly string[] {
  const fields = ['_id']

  if (options.withActorId) {
    fields.push('_actorId')
  }

  if (options.withCreatedAt) {
    fields.push('_createdAt')
  }

  if (options.withUpdatedAt) {
    fields.push('_updatedAt')
  }

  if (options.withArchivedAt) {
    fields.push('_archivedAt')
  }

  return fields
}

export function getEffectiveTableFieldNames(def: TableDefinition): readonly string[] {
  return [...getImplicitSystemFields(def.options), ...Object.keys(def.columns)]
}

function normalizeIndexDefinition(
  name: string,
  fieldsOrOptions: readonly string[] | TableIndexOptions,
  unique = false,
): TableIndexDefinition {
  if (RESERVED_INDEX_NAMES.includes(name as (typeof RESERVED_INDEX_NAMES)[number])) {
    throw new Error(`Index "${name}" is reserved.`)
  }

  if (Array.isArray(fieldsOrOptions)) {
    return {
      name,
      fields: [...fieldsOrOptions],
      staged: false,
      unique,
    }
  }

  const options = fieldsOrOptions as TableIndexOptions

  return {
    name,
    fields: [...options.fields],
    staged: options.staged ?? false,
    unique: options.unique ?? unique,
  }
}

function createTableDefinition<TColumns extends Record<string, ColumnDescriptor<any>>>(
  tableName: string,
  columns: TColumns,
  options: TableDefinitionOptions = {},
  indexes: readonly TableIndexDefinition[] = [],
): TableDefinition<TColumns> {
  if (
    RESERVED_SYSTEM_FIELD_NAMES.some((fieldName) => fieldName in columns)
  ) {
    throw new Error(
      `Table "${tableName}" cannot define reserved system fields.`,
    )
  }

  return {
    tableName,
    columns,
    options,
    indexes,
    index(name, fieldsOrOptions) {
      return createTableDefinition(
        tableName,
        columns,
        options,
        [...indexes, normalizeIndexDefinition(name, fieldsOrOptions)],
      )
    },
    uniqueIndex(name, fieldsOrOptions) {
      return createTableDefinition(
        tableName,
        columns,
        options,
        [...indexes, normalizeIndexDefinition(name, fieldsOrOptions, true)],
      )
    },
    withActorId(enabled = true) {
      return createTableDefinition(tableName, columns, {
        ...options,
        withActorId: enabled,
      }, indexes)
    },
    withCreatedAt(enabled = true) {
      return createTableDefinition(tableName, columns, {
        ...options,
        withCreatedAt: enabled,
      }, indexes)
    },
    withUpdatedAt(enabled = true) {
      return createTableDefinition(tableName, columns, {
        ...options,
        withUpdatedAt: enabled,
      }, indexes)
    },
    withArchivedAt(enabled = true) {
      return createTableDefinition(tableName, columns, {
        ...options,
        withArchivedAt: enabled,
      }, indexes)
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
