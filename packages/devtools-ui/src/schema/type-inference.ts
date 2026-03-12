/**
 * Infer TypeScript type from SQLite column type
 */
export function inferTsType(sqlType: string): 'string' | 'number' | 'boolean' {
  const normalized = sqlType.toUpperCase()

  if (normalized.includes('INT')) {
    return 'number'
  }
  if (normalized.includes('REAL') || normalized.includes('FLOAT') || normalized.includes('DOUBLE')) {
    return 'number'
  }
  if (normalized.includes('BOOL')) {
    return 'boolean'
  }
  return 'string'
}
