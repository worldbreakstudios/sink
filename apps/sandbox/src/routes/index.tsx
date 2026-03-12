import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { SinkExplorer, type ExplorerClient } from '@sink/devtools-ui'
import { createLocalExplorerClient } from '@/lib/local-explorer-client'
import { ThemeToggle } from './sandbox'

export const Route = createFileRoute('/')({
  ssr: false,
  component: App,
})

function App() {
  const [state, setState] = useState<{
    status: 'loading' | 'ready' | 'error'
    client?: ExplorerClient
    close?: () => Promise<void>
    error?: string
  }>({
    status: 'loading',
  })

  useEffect(() => {
    let closed = false
    let teardown: (() => Promise<void>) | undefined

    createLocalExplorerClient()
      .then(({ client, close }) => {
        if (closed) {
          void close()
          return
        }

        teardown = close
        setState({
          status: 'ready',
          client,
          close,
        })
      })
      .catch((error: unknown) => {
        setState({
          status: 'error',
          error:
            error instanceof Error ? error.message : 'Unable to load SQLite sandbox.',
        })
      })

    return () => {
      closed = true
      void teardown?.()
    }
  }, [])

  if (state.status === 'loading' || !state.client) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        Loading SQLite collections...
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-destructive">
        {state.error}
      </div>
    )
  }

  return (
    <SinkExplorer
      client={state.client}
      title="SQLite Sandbox"
      headerActions={<ThemeToggle />}
    />
  )
}
