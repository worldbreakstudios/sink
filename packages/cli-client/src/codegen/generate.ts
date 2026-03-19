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

  let timeout: ReturnType<typeof setTimeout> | null = null

  const rebuild = () => {
    if (timeout) clearTimeout(timeout)
    timeout = setTimeout(async () => {
      try {
        await generate(options)
      } catch (err) {
        console.error('Generate failed:', err)
      }
    }, 100)
  }

  const watcher = fs.watch(srcDir, { recursive: true }, (_event, filename) => {
    if (
      filename &&
      (filename.endsWith('.schema.ts') ||
        filename.endsWith('.policy.ts') ||
        filename.endsWith('.queries.ts') ||
        filename.endsWith('.mutations.ts'))
    ) {
      rebuild()
    }
  })

  console.log('Watching for schema/policy/query/mutation changes...')

  process.on('SIGINT', () => {
    watcher.close()
    process.exit(0)
  })
}
