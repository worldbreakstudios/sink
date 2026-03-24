import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const packageJsonPath = require.resolve('@sqlite.org/sqlite-wasm/package.json')
const sqliteDistDir = path.resolve(path.dirname(packageJsonPath), 'dist')
const outputDir = path.resolve(import.meta.dirname, '..', 'dist')
const assetFilenames = [
  'sqlite3.wasm',
  'sqlite3-worker1.mjs',
  'sqlite3-opfs-async-proxy.js',
]

await fs.mkdir(outputDir, { recursive: true })

await Promise.all(
  assetFilenames.map(async (filename) => {
    await fs.copyFile(
      path.resolve(sqliteDistDir, filename),
      path.resolve(outputDir, filename),
    )
  }),
)
