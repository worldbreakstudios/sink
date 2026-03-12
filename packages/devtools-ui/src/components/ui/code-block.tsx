import { useEffect, useState, useCallback } from 'react'
import { codeToHtml } from 'shiki'
import { cn } from '../../utils'

interface CodeBlockProps {
  code: string
  language?: string
  className?: string
}

export function CodeBlock({ code, language = 'typescript', className }: CodeBlockProps) {
  const [html, setHtml] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false

    codeToHtml(code, {
      lang: language,
      themes: {
        light: 'vitesse-light',
        dark: 'vitesse-dark',
      },
      defaultColor: false,
    }).then((result) => {
      if (!cancelled) {
        setHtml(result)
      }
    })

    return () => {
      cancelled = true
    }
  }, [code, language])

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }, [code])

  return (
    <div className={cn('group relative', className)}>
      {/* Copy Button */}
      <button
        type="button"
        onClick={handleCopy}
        className={cn(
          'absolute right-2 top-2 z-10 rounded-md border px-2 py-1 text-xs font-medium transition-all',
          '',
          copied
            ? 'border-green-500 bg-green-500/10 text-green-600 dark:text-green-400'
            : 'border-neutral-300 bg-white/90 text-neutral-600 hover:bg-white hover:text-neutral-900 dark:border-neutral-600 dark:bg-neutral-800/90 dark:text-neutral-300 dark:hover:bg-neutral-700 dark:hover:text-neutral-100',
        )}
      >
        {copied ? (
          <span className="flex items-center gap-1">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
            Copied
          </span>
        ) : (
          <span className="flex items-center gap-1">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
              <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
            </svg>
            Copy
          </span>
        )}
      </button>

      {/* Code Content */}
      {html ? (
        <div
          className="overflow-x-auto rounded-md text-xs leading-relaxed [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:p-3"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="overflow-x-auto rounded-md bg-[#fafafa] p-3 text-xs leading-relaxed text-neutral-800 dark:bg-[#121212] dark:text-neutral-200">
          <code>{code}</code>
        </pre>
      )}
    </div>
  )
}
