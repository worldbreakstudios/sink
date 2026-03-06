import { formatCliMessage } from './index'

const input = process.argv.slice(2).join(' ')

console.log(`sink cli -> ${formatCliMessage(input)}`)
