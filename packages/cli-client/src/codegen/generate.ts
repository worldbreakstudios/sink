import fs from 'node:fs'
import path from 'node:path'
import {
  discoverMutationFiles,
  discoverPolicyFiles,
  discoverQueryFiles,
  discoverSchemaFiles,
  resolveOperationsOutputPath,
  resolveOutputPath,
} from './discover'
import { loadSchemaFiles } from './load-schema'
import { emit } from './emit'
import { emitOperations } from './emit-operations'

export interface GenerateOptions {
  cwd: string
  out?: string
}

export async function generate(options: GenerateOptions): Promise<void> {
  const srcDir = path.resolve(options.cwd, 'src')
  const outputPath = resolveOutputPath(options.cwd, options.out)
  const operationsOutputPath = resolveOperationsOutputPath(options.cwd, options.out)

  const files = await discoverSchemaFiles(srcDir)
  if (files.length === 0) {
    console.log('No *.schema.ts files found.')
    return
  }

  const definitions = await loadSchemaFiles(files)
  const code = emit(definitions)
  const policyFiles = await discoverPolicyFiles(srcDir)
  const queryFiles = await discoverQueryFiles(srcDir)
  const mutationFiles = await discoverMutationFiles(srcDir)
  const operationsCode = emitOperations({
    definitions,
    operationsOutputPath,
    schemaOutputPath: outputPath,
    policyFiles,
    queryFiles,
    mutationFiles,
  })

  const outputDir = path.dirname(outputPath)
  fs.mkdirSync(outputDir, { recursive: true })
  fs.writeFileSync(outputPath, code, 'utf-8')
  fs.writeFileSync(operationsOutputPath, operationsCode, 'utf-8')

  const gitignorePath = path.join(outputDir, '.gitignore')
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, '*\n', 'utf-8')
  }

  console.log(
    `Generated schema and operations for ${definitions.length} table${definitions.length === 1 ? '' : 's'} -> ${path.relative(options.cwd, outputPath)}, ${path.relative(options.cwd, operationsOutputPath)}`,
  )
}

export async function watch(options: GenerateOptions): Promise<void> {
  const srcDir = path.resolve(options.cwd, 'src')

  await generate(options)

  let lastSnapshot = await createWatchSnapshot(srcDir)
  let checking = false

  const poll = async () => {
    if (checking) {
      return
    }

    checking = true

    try {
      const nextSnapshot = await createWatchSnapshot(srcDir)

      if (nextSnapshot !== lastSnapshot) {
        lastSnapshot = nextSnapshot
        await generate(options)
      }
    } catch (err) {
      console.error('Generate failed:', err)
    } finally {
      checking = false
    }
  }

  const interval = setInterval(() => {
    void poll()
  }, 250)

  console.log('Watching for schema/policy/query/mutation changes...')

  const close = () => {
    clearInterval(interval)
    process.exit(0)
  }

  process.on('SIGINT', close)
  process.on('SIGTERM', close)
}

async function createWatchSnapshot(srcDir: string): Promise<string> {
  const files = await discoverWatchFiles(srcDir)
  const snapshotEntries = await Promise.all(
    files.map(async (file) => {
      const stats = await fs.promises.stat(file)
      return `${file}:${stats.mtimeMs}:${stats.size}`
    }),
  )

  return snapshotEntries.join('\n')
}

async function discoverWatchFiles(srcDir: string): Promise<string[]> {
  const fileGroups = await Promise.all([
    discoverSchemaFiles(srcDir),
    discoverPolicyFiles(srcDir),
    discoverQueryFiles(srcDir),
    discoverMutationFiles(srcDir),
  ])

  return [...new Set(fileGroups.flat())].sort((left, right) =>
    left.localeCompare(right),
  )
}
