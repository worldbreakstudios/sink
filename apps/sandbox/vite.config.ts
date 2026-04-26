import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import tsconfigPaths from 'vite-tsconfig-paths'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nitro } from 'nitro/vite'
import { sinkVite } from '@worldbreakstudios/sink-lib/vite'

const config = defineConfig({
  optimizeDeps: {
    include: ['@tanstack/db'],
  },
  resolve: {
    dedupe: ['@tanstack/db'],
  },
  plugins: [
    sinkVite(),
    devtools(),
    nitro({
      rollupConfig: { external: [/^@sentry\//] },
      routeRules: {
        '/**': {
          headers: {
            'Cross-Origin-Embedder-Policy': 'require-corp',
            'Cross-Origin-Opener-Policy': 'same-origin',
          },
        },
      },
    }),
    tsconfigPaths({ projects: ['./tsconfig.json'] }),
    tailwindcss(),
    tanstackStart({
      router: {
        routeFileIgnorePattern: '^sandbox$',
      },
    }),
    viteReact(),
  ],
})

export default config
