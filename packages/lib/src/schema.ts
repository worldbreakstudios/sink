export type TableId<TTableName extends string> = string & {
  readonly __tableName: TTableName
}

export type JsonColumnKind = 'array' | 'object' | 'record'

export type ColumnValidatorDescriptor =
  | { kind: 'string' }
  | { kind: 'number' }
  | { kind: 'float' }
  | { kind: 'boolean' }
  | { kind: 'id'; referencedTable: string }
  | { kind: 'array'; element: ColumnValidatorDescriptor }
  | { kind: 'object'; fields: Record<string, ColumnValidatorDescriptor> }
  | {
    kind: 'record'
    keys: ColumnValidatorDescriptor
    values: ColumnValidatorDescriptor
  }

export interface ColumnDescriptor<
  TValue = unknown,
  TReferencedTable extends string | undefined = string | undefined,
> {
  readonly sqliteType: string
  readonly tsType: string
  readonly __valueType?: TValue
  readonly isNullable: boolean
  readonly isPrimaryKey: boolean
  readonly defaultValue: unknown | undefined
  readonly referencedTable: TReferencedTable
  readonly enforceExists: boolean
  readonly jsonKind: JsonColumnKind | null
  readonly validator: ColumnValidatorDescriptor
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
  '_createdAt',
  '_updatedAt',
  '_archivedAt',
] as const

export const RESERVED_INDEX_NAMES = ['by_id', 'by_creation_time'] as const

type RegisteredSchemaTableName = keyof RegisteredSchemaTables extends never
  ? string
  : Extract<keyof RegisteredSchemaTables, string>

type ObjectColumnFields = Record<string, ColumnDescriptor<any, any>>

export type ColumnValue<TDescriptor extends ColumnDescriptor<any, any>> =
  TDescriptor extends ColumnDescriptor<infer TValue, any> ? TValue : never

type ObjectColumnValue<TFields extends ObjectColumnFields> = {
  [TKey in keyof TFields]: ColumnValue<TFields[TKey]>
}

function freeze<TValue, TReferencedTable extends string | undefined>(
  descriptor: ColumnDescriptor<TValue, TReferencedTable>,
): ColumnDescriptor<TValue, TReferencedTable> {
  return Object.freeze(descriptor)
}

function renderValidatorTsType(validator: ColumnValidatorDescriptor): string {
  switch (validator.kind) {
    case 'string':
      return 'string'
    case 'number':
    case 'float':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'id':
      return `Id<'${validator.referencedTable}'>`
    case 'array':
      return `Array<${renderValidatorTsType(validator.element)}>`
    case 'object': {
      const fields = Object.entries(validator.fields).map(
        ([fieldName, fieldValidator]) =>
          `${fieldName}: ${renderValidatorTsType(fieldValidator)}`,
      )
      return `{ ${fields.join('; ')} }`
    }
    case 'record':
      return `Record<string, ${renderValidatorTsType(validator.values)}>`
  }
}

function createDescriptor<TValue, TReferencedTable extends string | undefined>(
  config: Omit<ColumnDescriptor<TValue, TReferencedTable>, 'tsType'> & {
    tsType?: string
  },
): ColumnDescriptor<TValue, TReferencedTable> {
  return freeze({
    ...config,
    tsType: config.tsType ?? renderValidatorTsType(config.validator),
  })
}

export const v = {
  string(): ColumnDescriptor<string> {
    return createDescriptor({
      sqliteType: 'TEXT NOT NULL',
      isNullable: false,
      isPrimaryKey: false,
      defaultValue: undefined,
      referencedTable: undefined,
      enforceExists: false,
      jsonKind: null,
      validator: { kind: 'string' },
    })
  },

  number(): ColumnDescriptor<number> {
    return createDescriptor({
      sqliteType: 'INTEGER NOT NULL',
      isNullable: false,
      isPrimaryKey: false,
      defaultValue: undefined,
      referencedTable: undefined,
      enforceExists: false,
      jsonKind: null,
      validator: { kind: 'number' },
    })
  },

  float(): ColumnDescriptor<number> {
    return createDescriptor({
      sqliteType: 'REAL NOT NULL',
      isNullable: false,
      isPrimaryKey: false,
      defaultValue: undefined,
      referencedTable: undefined,
      enforceExists: false,
      jsonKind: null,
      validator: { kind: 'float' },
    })
  },

  boolean(): ColumnDescriptor<boolean> {
    return createDescriptor({
      sqliteType: 'INTEGER NOT NULL',
      isNullable: false,
      isPrimaryKey: false,
      defaultValue: undefined,
      referencedTable: undefined,
      enforceExists: false,
      jsonKind: null,
      validator: { kind: 'boolean' },
    })
  },

  id<TTableName extends RegisteredSchemaTableName>(
    tableName: TTableName,
    options: IdColumnOptions = {},
  ): ColumnDescriptor<TableId<TTableName>, TTableName> {
    return createDescriptor({
      sqliteType: 'TEXT NOT NULL',
      isNullable: false,
      isPrimaryKey: false,
      defaultValue: undefined,
      referencedTable: tableName,
      enforceExists: options.enforceExists ?? false,
      jsonKind: null,
      validator: { kind: 'id', referencedTable: tableName },
    })
  },

  array<TItem>(
    inner: ColumnDescriptor<TItem, any>,
  ): ColumnDescriptor<TItem[]> {
    return createDescriptor({
      sqliteType: 'JSON_ARRAY TEXT NOT NULL',
      isNullable: false,
      isPrimaryKey: false,
      defaultValue: undefined,
      referencedTable: undefined,
      enforceExists: false,
      jsonKind: 'array',
      validator: {
        kind: 'array',
        element: inner.validator,
      },
    })
  },

  object<TFields extends ObjectColumnFields>(
    fields: TFields,
  ): ColumnDescriptor<ObjectColumnValue<TFields>> {
    return createDescriptor({
      sqliteType: 'JSON_OBJECT TEXT NOT NULL',
      isNullable: false,
      isPrimaryKey: false,
      defaultValue: undefined,
      referencedTable: undefined,
      enforceExists: false,
      jsonKind: 'object',
      validator: {
        kind: 'object',
        fields: Object.fromEntries(
          Object.entries(fields).map(([fieldName, field]) => [
            fieldName,
            field.validator,
          ]),
        ),
      },
    })
  },

  record<TKeys extends ColumnDescriptor<string, any>, TValue>(
    keys: TKeys,
    values: ColumnDescriptor<TValue, any>,
  ): ColumnDescriptor<Record<string, TValue>> {
    return createDescriptor({
      sqliteType: 'JSON_RECORD TEXT NOT NULL',
      isNullable: false,
      isPrimaryKey: false,
      defaultValue: undefined,
      referencedTable: undefined,
      enforceExists: false,
      jsonKind: 'record',
      validator: {
        kind: 'record',
        keys: keys.validator,
        values: values.validator,
      },
    })
  },

  nullable<TValue, TReferencedTable extends string | undefined>(
    inner: ColumnDescriptor<TValue, TReferencedTable>,
  ): ColumnDescriptor<TValue | null, TReferencedTable> {
    const sqliteType = inner.sqliteType
      .replace(' NOT NULL', '')
      .replace(' PRIMARY KEY', '')
    return createDescriptor({
      sqliteType,
      tsType: inner.isNullable ? inner.tsType : `${inner.tsType} | null`,
      isNullable: true,
      isPrimaryKey: false,
      defaultValue: undefined,
      referencedTable: inner.referencedTable,
      enforceExists: inner.enforceExists,
      jsonKind: inner.jsonKind,
      validator: inner.validator,
    })
  },

  default<TValue, TReferencedTable extends string | undefined>(
    inner: ColumnDescriptor<TValue, TReferencedTable>,
    value: TValue,
  ): ColumnDescriptor<TValue, TReferencedTable> {
    return createDescriptor({
      sqliteType: inner.sqliteType,
      isNullable: inner.isNullable,
      isPrimaryKey: inner.isPrimaryKey,
      defaultValue: value,
      referencedTable: inner.referencedTable,
      enforceExists: inner.enforceExists,
      jsonKind: inner.jsonKind,
      validator: inner.validator,
    })
  },
} as const

export interface TableDefinitionOptions {
  withCreatedAt?: boolean
  withUpdatedAt?: boolean
  withArchivedAt?: boolean
}

export interface TableDefinition<
  TColumns extends Record<string, ColumnDescriptor<any, any>> = Record<
    string,
    ColumnDescriptor<any, any>
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
  withCreatedAt(enabled?: boolean): TableDefinition<TColumns>
  withUpdatedAt(enabled?: boolean): TableDefinition<TColumns>
  withArchivedAt(enabled?: boolean): TableDefinition<TColumns>
}

export function getImplicitSystemFields(
  options: TableDefinitionOptions,
): readonly string[] {
  const fields = ['_id']

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

function createTableDefinition<TColumns extends Record<string, ColumnDescriptor<any, any>>>(
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

export function defineTable<TColumns extends Record<string, ColumnDescriptor<any, any>>>(
  tableName: string,
  columns: TColumns,
  options: TableDefinitionOptions = {},
): TableDefinition<TColumns> {
  return createTableDefinition(tableName, columns, options)
}
