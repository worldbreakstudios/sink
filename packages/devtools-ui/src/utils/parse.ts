/**
 * Parse a string value into its appropriate type
 * Used for query constraint values
 */
export function parseValue(value: string): unknown {
  if (value === '') return ''
  if (value === 'null') return null
  if (value === 'true') return true
  if (value === 'false') return false

  // BigInt literal (e.g., "123n")
  if (/^\d+n$/.test(value)) {
    return BigInt(value.slice(0, -1))
  }

  // Integer
  if (/^\d+$/.test(value)) {
    const num = parseInt(value, 10)
    // Convert to BigInt if very large
    if (num > Number.MAX_SAFE_INTEGER / 1000) {
      return BigInt(value)
    }
    return num
  }

  // Float
  if (/^-?\d+\.\d+$/.test(value)) {
    return parseFloat(value)
  }

  return value
}

/**
 * Format a value for display in generated code
 */
export function formatValueForCode(value: string): string {
  if (value === '') return "''"
  if (value === 'null') return 'null'
  if (value === 'true' || value === 'false') return value

  // BigInt literal
  if (/^\d+n$/.test(value)) return value

  // Number
  if (/^\d+$/.test(value) || /^-?\d+\.\d+$/.test(value)) return value

  // String - escape single quotes
  return `'${value.replace(/'/g, "\\'")}'`
}
