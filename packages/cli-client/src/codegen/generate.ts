import fs from 'node:fs'
import path from 'node:path'
import { discoverSchemaFiles, resolveOutputPath } from './discover'
import { loadSchemaFiles } from './load-schema'
import { emit } from './emit'

export interface GenerateOptions {
  cwd: string
  out?: string
}

export async function generate(options: GenerateOptions): Promise<void> {
  const srcDir = path.resolve(options.cwd, 'src')
  const outputPath = resolveOutputPath(options.cwd, options.out)

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

  const relOutput = path.relative(options.cwd, outputPath)
  console.log(
    `Generated schema for ${definitions.length} table${definitions.length === 1 ? '' : 's'} -> ${relOutput}`,
  )
}
