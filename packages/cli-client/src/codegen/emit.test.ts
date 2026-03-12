import { describe, expect, it } from 'vitest'
import { defineTable, v } from '@sink/lib'
import { emit } from './emit'

describe('emit', () => {
  it('auto-registers generated createCollections metadata without changing its signature', () => {
    const code = emit([
      defineTable('items', {
        name: v.string(),
      }),
    ])

    expect(code).toContain(
      'export async function createCollections(db: AsyncSqliteDatabase): Promise<SchemaCollections> {',
    )
    expect(code).toContain('registerSinkDevtoolsDatabase({')
    expect(code).toContain('database: db,')
    expect(code).toContain('collections,')
    expect(code).toContain('INDEXES,')
    expect(code).toContain('REFERENCE_COLUMNS,')
  })
})
