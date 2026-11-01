/** One-shot patch: fix the mock signature line (temporary; delete after use). */
import fs from 'node:fs'

const file = 'src/services/reminders.scheduling.test.ts'
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)

const LT = String.fromCharCode(60) // <
const GT = String.fromCharCode(62) // >
const LB = String.fromCharCode(123) // {
const RB = String.fromCharCode(125) // }

// Target: Array<{ id: number; title?: string; schedule?: { at?: Date }> }) => {
const correct =
  '    schedule: async (input: { notifications: Array' + LT + LB +
  ' id: number; title?: string; schedule?: ' + LB + ' at?: Date ' + RB +
  ' + RB + GT + ' }) => {
  '

  const index = lines.findIndex((line) => line.startsWith('    schedule: async (input:'))
  if (index === -1) throw new Error('target line not found')
  lines[index] = correct
  fs.writeFileSync(file, lines.join('\n'))
  console.log('patched:', correct)
