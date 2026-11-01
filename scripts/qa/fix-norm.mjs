/** Replace subjectNameKey with the corrected normalization contract. */
import fs from 'node:fs'

const file = 'src/services/subjects.ts'
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
const Q = String.fromCharCode(39)

const start = lines.findIndex((l) => l.includes('export function subjectNameKey'))
if (start === -1) throw new Error('subjectNameKey not found')

// Replace the preceding doc comment too.
let docStart = start
while (docStart > 0 && !lines[docStart - 1].trim().startsWith('/**')) docStart -= 1
docStart -= 1

let end = start
while (end < lines.length && lines[end].trim() !== '}') end += 1

const block = [
  '/**',
  ' * Canonical comparison key for a subject name.',
  ' *',
  ' * The rule: conflate PRESENTATION differences only, never SEMANTIC ones.',
  ' *',
  ' *   1. NFKC  — folds compatibility forms (full-width letters, Arabic-Indic',
  ' *              digits, ligatures) so visually identical input compares equal.',
  ' *   2. Remove ONLY supported Arabic combining marks (harakat / tanween /',
  ' *              shadda / sukun) and tatweel. Other scripts keep their marks.',
  ' *   3. Lower-case — locale-independent.',
  ' *   4. Collapse runs of whitespace to one space, then trim.',
  ' *',
  ' * Punctuation, symbols and digits are PRESERVED: "C++" and "C#" are two',
  ' * different subjects, and so are "Math 1" and "Math1". An earlier version',
  ' * deleted whole Unicode categories, which silently merged those pairs.',
  ' *',
  ' * Mirrored in SQL by public.subject_name_key() (migration 202610250007).',
  ' * The display name is never altered by this function.',
  ' */',
  'export function subjectNameKey(name: string): string {',
  '  return cleanSubjectName(name)',
  '    .normalize(' + Q + 'NFKC' + Q + ')',
  '    // Arabic harakat/tanween/shadda/sukun (U+0617-061A, U+064B-0652, U+0670,',
  '    // U+06D6-06ED) and tatweel (U+0640, technically a letter).',
  '    .replace(/[\\u0617-\\u061A\\u064B-\\u0652\\u0670\\u06D6-\\u06ED\\u0640]/g, ' + Q + Q + ')',
  '    .toLowerCase()',
  '    .replace(/\\s+/g, ' + Q + ' + Q + ') ',
  '    .trim()',
  '}',
]

lines.splice(docStart, end - docStart + 1, ...block)
fs.writeFileSync(file, lines.join('\n'))
console.log('rewrote subjectNameKey (lines', docStart + 1, '-', end + 1, ')')
