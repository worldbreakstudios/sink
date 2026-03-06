export default function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="mt-20 border-t border-[var(--line)] px-4 pb-14 pt-10 text-[var(--sea-ink-soft)]">
      <div className="page-wrap flex flex-col items-center justify-between gap-4 text-center sm:flex-row sm:text-left">
        <p className="m-0 text-sm">
          &copy; {year} Sink workspace sandbox.
        </p>
        <p className="island-kicker m-0">Built with npm workspaces + TanStack Start</p>
      </div>
      <div className="mt-4 flex justify-center gap-4">
        <a
          href="https://tanstack.com/start/latest/docs/framework/react/overview"
          target="_blank"
          rel="noreferrer"
          className="rounded-xl p-2 text-[var(--sea-ink-soft)] transition hover:bg-[var(--link-bg-hover)] hover:text-[var(--sea-ink)]"
        >
          <span className="sr-only">Open TanStack Start docs</span>
          <svg viewBox="0 0 16 16" aria-hidden="true" width="32" height="32">
            <path
              fill="currentColor"
              d="M8 1.25a6.75 6.75 0 1 0 6.75 6.75A6.758 6.758 0 0 0 8 1.25Zm0 1.5A5.25 5.25 0 1 1 2.75 8 5.256 5.256 0 0 1 8 2.75Zm-.75 1.5v4.06l2.93 2.93 1.06-1.06-2.49-2.5V4.25Z"
            />
          </svg>
        </a>
        <a
          href="https://docs.npmjs.com/cli/v11/using-npm/workspaces"
          target="_blank"
          rel="noreferrer"
          className="rounded-xl p-2 text-[var(--sea-ink-soft)] transition hover:bg-[var(--link-bg-hover)] hover:text-[var(--sea-ink)]"
        >
          <span className="sr-only">Open npm workspaces docs</span>
          <svg viewBox="0 0 16 16" aria-hidden="true" width="32" height="32">
            <path
              fill="currentColor"
              d="M3 2.5A1.5 1.5 0 0 0 1.5 4v8A1.5 1.5 0 0 0 3 13.5h10a1.5 1.5 0 0 0 1.5-1.5V6.31a1.5 1.5 0 0 0-.44-1.06l-2.81-2.81A1.5 1.5 0 0 0 10.19 2H3Zm0 1.5h7v2.5a.5.5 0 0 0 .5.5H13v5H3Zm2.25 5.25v1.5h5.5v-1.5Z"
            />
          </svg>
        </a>
      </div>
    </footer>
  )
}
