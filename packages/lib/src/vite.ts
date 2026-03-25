import path from 'node:path'
import type { Alias, AliasOptions, Plugin, UserConfig } from 'vite'

const SINK_BROWSER_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
} as const

export interface SinkViteOptions {
  localSourceRoot?: string
}

export function sinkVite(options: SinkViteOptions = {}): Plugin {
  return {
    name: 'sink-vite',
    config(config: UserConfig): UserConfig {
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
  existing: AliasOptions | undefined,
  next: readonly Alias[],
): Alias[] {
  return [...next, ...normalizeAliases(existing)]
}

function normalizeAliases(value: AliasOptions | undefined): Alias[] {
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

function createLocalSourceAliases(localSourceRoot: string): Alias[] {
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
