import { useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  createSandboxSnapshot,
  formatCliMessage,
  tokenizeInput,
} from '@sink/cli-client'
import { runSqliteDemo, type SqliteDemoResult } from '@sink/lib'

export const Route = createFileRoute('/')({ component: App })

function App() {
  const [input, setInput] = useState('hello sandbox')
  const [sqliteDemo, setSqliteDemo] = useState<{
    status: 'loading' | 'ready' | 'error'
    data?: SqliteDemoResult
    error?: string
  }>({ status: 'loading' })
  const snapshot = useMemo(() => createSandboxSnapshot(input), [input])
  const previewArgs = useMemo(() => tokenizeInput(input), [input])

  useEffect(() => {
    let cancelled = false

    setSqliteDemo({ status: 'loading' })

    runSqliteDemo(input)
      .then((data) => {
        if (!cancelled) {
          setSqliteDemo({ status: 'ready', data })
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setSqliteDemo({
            status: 'error',
            error: error instanceof Error ? error.message : 'Unknown SQLite error',
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [input])

  return (
    <main className="page-wrap px-4 pb-8 pt-14">
      <section className="island-shell rise-in relative overflow-hidden rounded-4xl px-6 py-10 sm:px-10 sm:py-14">
        <div className="pointer-events-none absolute -left-20 -top-24 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(79,184,178,0.32),transparent_66%)]" />
        <div className="pointer-events-none absolute -bottom-20 -right-20 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(47,106,74,0.18),transparent_66%)]" />
        <p className="island-kicker mb-3">Workspace Sandbox</p>
        <h1 className="display-title mb-5 max-w-3xl text-4xl leading-[1.02] font-bold tracking-tight text-(--sea-ink) sm:text-6xl">
          Build on top of SQLite Wasm in the browser.
        </h1>
        <p className="mb-8 max-w-2xl text-base text-(--sea-ink-soft) sm:text-lg">
          The sandbox imports both <code>@sink/cli-client</code> and{' '}
          <code>@sink/lib</code> directly from the workspace so you can test a
          frontend SQLite data layer alongside the CLI package.
        </p>
        <div className="flex flex-wrap gap-3">
          <a
            href="/about"
            className="rounded-full border border-[rgba(23,58,64,0.2)] bg-white/50 px-5 py-2.5 text-sm font-semibold text-(--sea-ink) no-underline transition hover:-translate-y-0.5 hover:border-[rgba(23,58,64,0.35)]"
          >
            Workspace Notes
          </a>
          <button
            type="button"
            onClick={() => setInput('Offline-first note store')}
            className="rounded-full border border-[rgba(50,143,151,0.3)] bg-[rgba(79,184,178,0.14)] px-5 py-2.5 text-sm font-semibold text-(--lagoon-deep) transition hover:-translate-y-0.5 hover:bg-[rgba(79,184,178,0.24)]"
          >
            Load Sample Input
          </button>
        </div>
      </section>

      <section className="mt-8 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <article className="island-shell rounded-2xl p-6">
          <p className="island-kicker mb-2">CLI Preview</p>
          <label
            htmlFor="sandbox-input"
            className="mb-3 block text-sm font-semibold text-(--sea-ink)"
          >
            Try a label you might store in SQLite
          </label>
          <input
            id="sandbox-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="type a command phrase"
            className="w-full rounded-2xl border border-(--chip-line) bg-white/80 px-4 py-3 text-sm text-(--sea-ink) outline-none transition focus:border-[rgba(50,143,151,0.5)]"
          />
          <div className="mt-5 rounded-2xl border border-(--chip-line) bg-[rgba(255,255,255,0.55)] p-4">
            <p className="m-0 text-sm font-semibold text-(--sea-ink)">
              CLI output
            </p>
            <p className="mt-2 font-mono text-sm text-(--sea-ink-soft)">
              {`sink ${previewArgs.join(' ')}`.trim()}
            </p>
            <p className="mt-3 text-sm text-(--sea-ink-soft)">
              {formatCliMessage(input)}
            </p>
          </div>
        </article>

        <article className="island-shell rounded-2xl p-6">
          <p className="island-kicker mb-2">SQLite Demo</p>
          <h2 className="mb-4 text-xl font-semibold text-(--sea-ink)">
            `@sink/lib` now wraps SQLite Wasm for frontend data work.
          </h2>
          <p className="mb-2 text-sm font-semibold text-(--sea-ink)">
            @sink/lib
          </p>
          <pre className="overflow-x-auto rounded-2xl bg-[rgba(23,58,64,0.92)] p-4 text-sm text-[rgba(237,249,244,0.92)]">
            {sqliteDemo.status === 'ready'
              ? JSON.stringify(sqliteDemo.data, null, 2)
              : sqliteDemo.status === 'error'
                ? JSON.stringify({ error: sqliteDemo.error }, null, 2)
                : JSON.stringify({ status: 'Loading SQLite demo...' }, null, 2)}
          </pre>
          <p className="mb-2 mt-5 text-sm font-semibold text-(--sea-ink)">
            @sink/cli-client
          </p>
          <pre className="overflow-x-auto rounded-2xl bg-[rgba(23,58,64,0.92)] p-4 text-sm text-[rgba(237,249,244,0.92)]">
            {JSON.stringify(snapshot, null, 2)}
          </pre>
        </article>
      </section>

      <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          [
            'packages/cli-client',
            'Shared TypeScript helpers and a CLI entrypoint live together.',
          ],
          [
            'packages/lib',
            'This package now owns the browser-side SQLite wrapper and future data APIs.',
          ],
          [
            'apps/sandbox',
            'Use TanStack Start to poke at behavior while building the library.',
          ],
          [
            'npm workspaces',
            'One install at the repo root links both modules together.',
          ],
        ].map(([title, desc], index) => (
          <article
            key={title}
            className="island-shell feature-card rise-in rounded-2xl p-5"
            style={{ animationDelay: `${index * 90 + 80}ms` }}
          >
            <h2 className="mb-2 text-base font-semibold text-(--sea-ink)">
              {title}
            </h2>
            <p className="m-0 text-sm text-(--sea-ink-soft)">{desc}</p>
          </article>
        ))}
      </section>

      <section className="island-shell mt-8 rounded-2xl p-6">
        <p className="island-kicker mb-2">Next Steps</p>
        <ul className="m-0 list-disc space-y-2 pl-5 text-sm text-(--sea-ink-soft)">
          <li>
            Add more pure functions in <code>packages/cli-client/src</code>.
          </li>
          <li>
            Add repository-style helpers in <code>packages/lib/src</code>.
          </li>
          <li>
            Grow the CLI in <code>packages/cli-client/src/cli.ts</code>.
          </li>
          <li>
            Use this sandbox to probe schema, queries, and migration ideas quickly.
          </li>
        </ul>
      </section>
    </main>
  )
}
