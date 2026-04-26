import { copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SQLITE_ASSET_FILENAMES = [
  'sqlite3.wasm',
  'sqlite3-worker1.mjs',
  'sqlite3-opfs-async-proxy.js',
]

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceDir = path.resolve(
  packageDir,
  'node_modules/@sqlite.org/sqlite-wasm/dist',
)
const targetDir = path.resolve(packageDir, 'dist')

await mkdir(targetDir, { recursive: true })

await Promise.all(
  SQLITE_ASSET_FILENAMES.map(async (filename) => {
    await copyFile(
      path.resolve(sourceDir, filename),
      path.resolve(targetDir, filename),
    )
  }),
)
