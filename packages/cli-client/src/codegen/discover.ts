import { glob } from 'glob'
import path from 'node:path'

export async function discoverSchemaFiles(srcDir: string): Promise<string[]> {
  const pattern = '**/*.schema.ts'
  const files = await glob(pattern, { cwd: srcDir, absolute: true })
  return files.sort((a, b) => a.localeCompare(b))
}

export function resolveOutputPath(cwd: string, out?: string): string {
  if (out) {
    return path.resolve(cwd, out)
  }
  return path.resolve(cwd, 'src/data/generated/schema.gen.ts')
}

export function resolveServerOutputPath(cwd: string, out?: string): string {
  if (out) {
    return path.resolve(cwd, out)
  }

  return path.resolve(cwd, 'src/data/generated/schema.server.gen.ts')
}
