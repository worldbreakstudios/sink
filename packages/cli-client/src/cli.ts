import path from 'node:path'
import { formatCliMessage } from './index'
import { generate, watch } from './codegen/generate'

function getInvocationCwd(): string {
  return process.env.INIT_CWD ?? process.env.PWD ?? process.cwd()
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const command = args[0]

  if (command === 'generate') {
    const cwdIdx = args.indexOf('--cwd')
    const outIdx = args.indexOf('--out')
    const cwdArg = cwdIdx !== -1 ? (args[cwdIdx + 1] ?? '.') : '.'
    const cwd = path.resolve(getInvocationCwd(), cwdArg)
    const out: string | undefined = outIdx !== -1 ? args[outIdx + 1] : undefined
    const useWatch = args.includes('--watch')

    const run = useWatch ? watch : generate
    await run({ cwd, out })
    return
  }

  const input = args.join(' ')
  console.log(`sink cli -> ${formatCliMessage(input)}`)
}

await main().catch((err) => {
  console.error(err)
  process.exit(1)
})
