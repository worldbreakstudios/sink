import { formatCliMessage } from './index'
import { generate, watch } from './codegen/generate'

const args = process.argv.slice(2)
const command = args[0]

if (command === 'generate') {
  const cwdIdx = args.indexOf('--cwd')
  const outIdx = args.indexOf('--out')
  const serverOutIdx = args.indexOf('--server-out')
  const cwd: string = cwdIdx !== -1 ? (args[cwdIdx + 1] ?? '.') : '.'
  const out: string | undefined = outIdx !== -1 ? args[outIdx + 1] : undefined
  const serverOut: string | undefined =
    serverOutIdx !== -1 ? args[serverOutIdx + 1] : undefined
  const useWatch = args.includes('--watch')

  const run = useWatch ? watch : generate
  run({ cwd, out, serverOut }).catch((err) => {
    console.error(err)
    process.exit(1)
  })
} else {
  const input = args.join(' ')
  console.log(`sink cli -> ${formatCliMessage(input)}`)
}
