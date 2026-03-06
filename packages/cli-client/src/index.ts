export interface SandboxSnapshot {
  input: string
  normalizedInput: string
  tokens: string[]
  generatedAt: string
}

export function normalizeInput(input: string): string {
  return input.trim().replace(/\s+/g, ' ').toLowerCase()
}

export function tokenizeInput(input: string): string[] {
  const normalized = normalizeInput(input)

  return normalized.length === 0 ? [] : normalized.split(' ')
}

export function createSandboxSnapshot(input: string): SandboxSnapshot {
  return {
    input,
    normalizedInput: normalizeInput(input),
    tokens: tokenizeInput(input),
    generatedAt: new Date().toISOString(),
  }
}

export function formatCliMessage(input: string): string {
  const snapshot = createSandboxSnapshot(input)
  const tokenCountLabel =
    snapshot.tokens.length === 1 ? '1 token' : `${snapshot.tokens.length} tokens`

  return `input="${snapshot.normalizedInput || '(empty)'}" (${tokenCountLabel})`
}
