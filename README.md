# Sink Workspace

This repo is set up as a workspace repo with three modules:

- `packages/cli-client`: a TypeScript library package with a CLI entrypoint
- `packages/lib`: a frontend-focused TypeScript library built on SQLite Wasm
- `apps/sandbox`: a TanStack Start app for testing the library locally

## Getting started

With `npm`:

```bash
npm install
npm run dev
```

With `pnpm`:

```bash
pnpm install
pnpm run dev
```

## Useful scripts

```bash
npm run cli -- hello world
npm run build
npm run lint
npm run typecheck
```

If you use `pnpm`, install from the repo root so workspace packages resolve locally.
