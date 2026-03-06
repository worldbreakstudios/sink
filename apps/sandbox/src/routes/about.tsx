import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/about')({
  component: About,
})

function About() {
  return (
    <main className="page-wrap px-4 py-12">
      <section className="island-shell rounded-2xl p-6 sm:p-8">
        <p className="island-kicker mb-2">About The Workspace</p>
        <h1 className="display-title mb-3 text-4xl font-bold text-[var(--sea-ink)] sm:text-5xl">
          One repo for the library and the playground.
        </h1>
        <p className="m-0 max-w-3xl text-base leading-8 text-[var(--sea-ink-soft)]">
          Keep your reusable CLI logic in the library package, then import it
          into this TanStack Start app to test parsing, formatting, and edge
          cases before you commit to a richer command interface.
        </p>
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-2">
        <article className="island-shell rounded-2xl p-6">
          <h2 className="mb-3 text-lg font-semibold text-[var(--sea-ink)]">
            Package layout
          </h2>
          <ul className="m-0 list-disc space-y-2 pl-5 text-sm text-[var(--sea-ink-soft)]">
            <li>
              <code>packages/cli-client</code> contains the shared library and
              CLI entrypoint.
            </li>
            <li>
              <code>apps/sandbox</code> is the browser-based integration surface.
            </li>
          </ul>
        </article>

        <article className="island-shell rounded-2xl p-6">
          <h2 className="mb-3 text-lg font-semibold text-[var(--sea-ink)]">
            Root commands
          </h2>
          <ul className="m-0 list-disc space-y-2 pl-5 text-sm text-[var(--sea-ink-soft)]">
            <li>
              <code>npm run dev</code> starts the sandbox app.
            </li>
            <li>
              <code>npm run cli -- hello world</code> exercises the CLI package.
            </li>
            <li>
              <code>npm run build</code> builds all workspaces that expose a
              build script.
            </li>
          </ul>
        </article>
      </section>
    </main>
  )
}
