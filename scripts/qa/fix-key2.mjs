/** Replace the subjectNameKey body using char codes (avoids transport mangling). */
import fs from 'node:fs'

const file = 'src/services/subjects.ts'
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
const Q = String.fromCharCode(39) // '
const EMPTY = Q + Q

const start = lines.findIndex((l) => l.includes('export function subjectNameKey'))
if (start === -1) throw new Error('subjectNameKey not found')

// Find the closing brace of the function.
let end = start
while (end < lines.length && lines[end].trim() !== '}') end += 1

const body = [
  'export function subjectNameKey(name: string): string {',
  '  return cleanSubjectName(name)',
  '    .normalize(' + Q + 'NFKC' + Q + ')',
  '    // \\p{M} = combining marks (Arabic harakat); \\p{P}/\\p{S} cover tatweel and',
  '    // separators. Letters are never touched, so distinct names stay distinct.',
  '    .replace(/[\\p{M}\\p{P}\\p{S}\\p{Z}\\s]+/gu, ' + EMPTY + ')',
  '    .toLowerCase()',
  '    .replace(/\\s+/g, ' + EMPTY + ')',
  '    .trim()',
  '}',
]

lines.splice(start, end - start + 1, ...body)
fs.writeFileSync(file, lines.join('\n'))
console.log('rewrote subjectNameKey at line', start + 1)
for (const l of body) console.log(l)
