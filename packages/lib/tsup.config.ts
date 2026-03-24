import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: ['src/index.ts', 'src/server.ts', 'src/browser.ts', 'src/vite.ts'],
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: true,
    external: ['node:sqlite'],
  },
  {
    entry: [
      'src/shared-opfs-dedicated.worker.ts',
      'src/shared-opfs-coordinator.shared-worker.ts',
    ],
    format: ['esm'],
    sourcemap: true,
    clean: false,
    external: ['node:sqlite'],
  },
])
