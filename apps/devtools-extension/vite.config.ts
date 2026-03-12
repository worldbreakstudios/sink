import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [tailwindcss(), react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        devtools: path.resolve(__dirname, 'devtools.html'),
        panel: path.resolve(__dirname, 'panel.html'),
        'service-worker': path.resolve(__dirname, 'src/service-worker.ts'),
        'content-script': path.resolve(__dirname, 'src/content-script.ts'),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'service-worker' || chunk.name === 'content-script'
            ? '[name].js'
            : 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
})
