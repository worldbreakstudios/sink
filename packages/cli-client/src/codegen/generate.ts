import fs from 'node:fs'
import path from 'node:path'
import { discoverSchemaFiles, resolveOutputPath, resolveServerOutputPath } from './discover'
import { loadSchemaFiles } from './load-schema'
import { emit } from './emit'
import { emitServer } from './emit-server'

export interface GenerateOptions {
  cwd: string
  out?: string
  serverOut?: string
}

export async function generate(options: GenerateOptions): Promise<void> {
  const srcDir = path.resolve(options.cwd, 'src')
  const outputPath = resolveOutputPath(options.cwd, options.out)
  const serverOutputPath = options.serverOut
    ? resolveServerOutputPath(options.cwd, options.serverOut)
    : null

  const files = await discoverSchemaFiles(srcDir)
  if (files.length === 0) {
    console.log('No *.schema.ts files found.')
    return
  }

  const definitions = await loadSchemaFiles(files)
  const code = emit(definitions)

  const outputDir = path.dirname(outputPath)
  fs.mkdirSync(outputDir, { recursive: true })
  fs.writeFileSync(outputPath, code, 'utf-8')

  const gitignorePath = path.join(outputDir, '.gitignore')
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, '*\n', 'utf-8')
  }

  const outputs = [path.relative(options.cwd, outputPath)]

  if (serverOutputPath) {
    const relativeImportPath = toImportPath(
      path.relative(path.dirname(serverOutputPath), outputPath),
      { preserveTsExtension: true },
    )
    const serverCode = emitServer(relativeImportPath)
    const serverOutputDir = path.dirname(serverOutputPath)

    fs.mkdirSync(serverOutputDir, { recursive: true })
    fs.writeFileSync(serverOutputPath, serverCode, 'utf-8')

    const serverGitignorePath = path.join(serverOutputDir, '.gitignore')
    if (!fs.existsSync(serverGitignorePath)) {
      fs.writeFileSync(serverGitignorePath, '*\n', 'utf-8')
    }

    outputs.push(path.relative(options.cwd, serverOutputPath))
  }

  console.log(
    `Generated schema for ${definitions.length} table${definitions.length === 1 ? '' : 's'} -> ${outputs.join(', ')}`,
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
    if (filename && filename.endsWith('.schema.ts')) {
      rebuild()
    }
  })

  console.log('Watching for *.schema.ts changes...')

  process.on('SIGINT', () => {
    watcher.close()
    process.exit(0)
  })
}

function toImportPath(
  relativePath: string,
  options: { preserveTsExtension?: boolean } = {},
): string {
  const normalizedPath = relativePath
    .replace(
      options.preserveTsExtension ? /\.(cts|mts|js|jsx)$/ : /\.(cts|mts|ts|tsx|js|jsx)$/,
      '',
    )
    .split(path.sep)
    .join('/')
  return normalizedPath.startsWith('.') ? normalizedPath : `./${normalizedPath}`
}
