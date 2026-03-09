import { useEffect } from 'react'
import { useLiveQuery } from '@tanstack/react-db'
import type { SqliteCollection } from '@sink/lib'
import type { SqliteDemoId, SqliteDemoRow } from '@/lib/sqlite-demo-collections'

export function CollectionCounter({
  tableName,
  collection,
  onCount,
}: {
  tableName: string
  collection: SqliteCollection<SqliteDemoRow, SqliteDemoId>
  onCount: (tableName: string, count: number) => void
}) {
  const query = useLiveQuery(() => collection, [collection])
  const count = query.data?.length ?? 0

  useEffect(() => {
    onCount(tableName, count)
  }, [tableName, count, onCount])

  return null
}
