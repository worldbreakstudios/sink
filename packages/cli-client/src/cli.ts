import { formatCliMessage } from './index'
import { generate } from './codegen/generate'

const args = process.argv.slice(2)
const command = args[0]

if (command === 'generate') {
  const cwdIdx = args.indexOf('--cwd')
  const outIdx = args.indexOf('--out')
  const cwd: string = cwdIdx !== -1 ? (args[cwdIdx + 1] ?? '.') : '.'
  const out: string | undefined = outIdx !== -1 ? args[outIdx + 1] : undefined

  generate({ cwd, out }).catch((err) => {
    console.error(err)
    process.exit(1)
  })
} else {
  const input = args.join(' ')
  console.log(`sink cli -> ${formatCliMessage(input)}`)
}
