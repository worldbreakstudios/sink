import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: ['src/index.ts', 'src/server.ts', 'src/browser.ts', 'src/vite.ts'],
    format: ['esm'],
    splitting: false,
    dts: true,
    sourcemap: true,
    clean: true,
    external: ['node:sqlite', '@sqlite.org/sqlite-wasm', '@tanstack/db'],
  },
  {
    entry: [
      'src/shared-opfs-dedicated.worker.ts',
      'src/shared-opfs-coordinator.shared-worker.ts',
    ],
    format: ['esm'],
    splitting: false,
    sourcemap: true,
    clean: false,
    external: ['node:sqlite', '@sqlite.org/sqlite-wasm', '@tanstack/db'],
  },
])
