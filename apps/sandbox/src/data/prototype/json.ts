const BIGINT_SENTINEL = '__sink_bigint__'

function encodeValue(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return { [BIGINT_SENTINEL]: value.toString() }
  }

  if (Array.isArray(value)) {
    return value.map((entry) => encodeValue(entry))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, encodeValue(entry)]),
    )
  }

  return value
}

function decodeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => decodeValue(entry))
  }

  if (
    value &&
    typeof value === 'object' &&
    BIGINT_SENTINEL in value &&
    typeof (value as Record<string, unknown>)[BIGINT_SENTINEL] === 'string'
  ) {
    return BigInt((value as Record<string, string>)[BIGINT_SENTINEL]!)
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, decodeValue(entry)]),
    )
  }

  return value
}

export function serializePrototypeJson(value: unknown): string {
  return JSON.stringify(encodeValue(value))
}

export function parsePrototypeJson<TValue>(value: string): TValue {
  return decodeValue(JSON.parse(value)) as TValue
}

export function normalizePrototypeValue(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return `${value.toString()}n`
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizePrototypeValue(entry))
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalizePrototypeValue(entry)]),
    )
  }

  return value
}

export function prototypeValuesEqual(left: unknown, right: unknown): boolean {
  return serializePrototypeJson(normalizePrototypeValue(left)) === serializePrototypeJson(normalizePrototypeValue(right))
}
