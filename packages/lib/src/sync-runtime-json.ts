export function serializeSyncPayload(value: unknown): string {
  return JSON.stringify(value, (_key, currentValue) => {
    if (typeof currentValue === 'bigint') {
      return {
        __sinkBigInt: currentValue.toString(),
      }
    }

    return currentValue
  })
}

export function parseSyncPayload<TValue = unknown>(value: string): TValue {
  return JSON.parse(value, (_key, currentValue) => {
    if (
      currentValue &&
      typeof currentValue === 'object' &&
      '__sinkBigInt' in currentValue
    ) {
      return BigInt(
        (currentValue as { __sinkBigInt: string }).__sinkBigInt,
      )
    }

    return currentValue
  }) as TValue
}

export function syncValuesEqual(left: unknown, right: unknown): boolean {
  return serializeSyncPayload(left) === serializeSyncPayload(right)
}
