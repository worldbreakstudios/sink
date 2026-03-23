import { glob } from 'glob'
import path from 'node:path'

export async function discoverSchemaFiles(srcDir: string): Promise<string[]> {
  return discoverFiles(srcDir, '**/*.schema.ts')
}

export async function discoverPolicyFiles(srcDir: string): Promise<string[]> {
  return discoverFiles(srcDir, '**/*.policy.ts')
}

export async function discoverQueryFiles(srcDir: string): Promise<string[]> {
  return discoverFiles(srcDir, '**/*.queries.ts')
}

export async function discoverMutationFiles(srcDir: string): Promise<string[]> {
  return discoverFiles(srcDir, '**/*.mutations.ts')
}

export function resolveOutputPath(cwd: string, out?: string): string {
  if (out) {
    return path.resolve(cwd, out)
  }
  return path.resolve(cwd, 'src/data/generated/schema.gen.ts')
}

export function resolveOperationsOutputPath(cwd: string, out?: string): string {
  const schemaOutputPath = resolveOutputPath(cwd, out)
  return path.resolve(path.dirname(schemaOutputPath), 'operations.gen.ts')
}

async function discoverFiles(srcDir: string, pattern: string): Promise<string[]> {
  const files = await glob(pattern, { cwd: srcDir, absolute: true })
  return files.sort((left, right) => left.localeCompare(right))
}
