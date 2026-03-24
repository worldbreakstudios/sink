import path from 'node:path'

const SINK_BROWSER_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
} as const

type AliasEntry = {
  find: string
  replacement: string
}

type AliasValue = AliasEntry[] | Record<string, string>

interface SinkViteConfig {
  server?: {
    headers?: Record<string, string>
    fs?: {
      allow?: string[]
    }
  }
  preview?: {
    headers?: Record<string, string>
  }
  optimizeDeps?: {
    exclude?: string[]
  }
  worker?: {
    format?: string
  }
  resolve?: {
    alias?: AliasValue
    dedupe?: string[]
  }
}

export interface SinkViteOptions {
  localSourceRoot?: string
}

export interface SinkVitePlugin {
  name: string
  config(config: SinkViteConfig): SinkViteConfig
}

export function sinkVite(options: SinkViteOptions = {}): SinkVitePlugin {
  return {
    name: 'sink-vite',
    config(config) {
      const localSourceRoot = options.localSourceRoot
        ? path.resolve(options.localSourceRoot)
        : null

      config.server ??= {}
      config.server.headers = {
        ...(config.server.headers ?? {}),
        ...SINK_BROWSER_HEADERS,
      }

      config.preview ??= {}
      config.preview.headers = {
        ...(config.preview.headers ?? {}),
        ...SINK_BROWSER_HEADERS,
      }

      config.optimizeDeps ??= {}
      config.optimizeDeps.exclude = appendUnique(
        config.optimizeDeps.exclude,
        [
          '@sqlite.org/sqlite-wasm',
          '@worldbreakstudios/sink-lib',
          '@worldbreakstudios/sink-lib/browser',
        ],
      )

      config.worker ??= {}
      config.worker.format = 'es'

      config.resolve ??= {}
      config.resolve.dedupe = appendUnique(config.resolve.dedupe, ['@tanstack/db'])

      if (localSourceRoot) {
        config.server.fs ??= {}
        config.server.fs.allow = appendUnique(config.server.fs.allow, [
          localSourceRoot,
        ])
        config.resolve.alias = mergeAliases(
          config.resolve.alias,
          createLocalSourceAliases(localSourceRoot),
        )
      }

      return config
    },
  }
}

function appendUnique(
  existing: readonly string[] | undefined,
  next: readonly string[],
): string[] {
  return [...new Set([...(existing ?? []), ...next])]
}

function mergeAliases(
  existing: AliasValue | undefined,
  next: readonly AliasEntry[],
): AliasEntry[] {
  return [...next, ...normalizeAliases(existing)]
}

function normalizeAliases(value: AliasValue | undefined): AliasEntry[] {
  if (!value) {
    return []
  }

  if (Array.isArray(value)) {
    return [...value]
  }

  return Object.entries(value).map(([find, replacement]) => ({
    find,
    replacement,
  }))
}

function createLocalSourceAliases(localSourceRoot: string): AliasEntry[] {
  return [
    {
      find: '@worldbreakstudios/sink-lib/server',
      replacement: path.resolve(localSourceRoot, 'packages/lib/src/server.ts'),
    },
    {
      find: '@worldbreakstudios/sink-lib/browser',
      replacement: path.resolve(localSourceRoot, 'packages/lib/src/browser.ts'),
    },
    {
      find: '@worldbreakstudios/sink-lib',
      replacement: path.resolve(localSourceRoot, 'packages/lib/src/index.ts'),
    },
  ]
}
