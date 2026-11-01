const fs = require('fs')
const file = 'src/services/persistenceContract.test.ts'
const lines = fs.readFileSync(file, 'utf8').split('\n')
const index = lines.findIndex((line) => line.includes('getSession: async'))
if (index < 0) {
  console.log('NOT FOUND')
  process.exit(1)
}
const B = String.fromCharCode(123) // {
const C = String.fromCharCode(125) // }
const line =
  '      getSession: async () => (' + B +
  ' data: ' + B + ' session: ' + B + ' user: ' + B + ' id: cloudState.userId ' + C + ' + C + ', error: null ' + C + ') '
lines[index] = line
fs.writeFileSync(file, lines.join('\n'))
console.log('LINE NOW: ' + line)
