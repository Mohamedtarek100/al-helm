 // Truncate AdminPage.tsx at the end of the real component, dropping the
// half-wrapped legacy block that was appended after it.
// Verified by content checks before writing; refuses if the shape is unexpected.
const fs = require('fs')
const file = 'src/pages/AdminPage.tsx'
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)

const endIdx = lines.findIndex((l) => l.includes('</AdminLayout>'))
if (endIdx < 0) { console.error('NO </AdminLayout> FOUND'); process.exit(1) }

// The component closes two lines after </AdminLayout>: "  )" then "}".
let closeIdx = -1
for (let i = endIdx; i < Math.min(endIdx + 6, lines.length); i += 1) {
  if (lines[i].trim() === '}') { closeIdx = i; break }
}
if (closeIdx < 0) { console.error('COMPONENT CLOSE NOT FOUND'); process.exit(1) }

const kept = lines.slice(0, closeIdx + 1)
const dropped = lines.length - kept.length
if (dropped < 100) { console.error('REFUSING: only ' + dropped + ' trailing lines — unexpected shape'); process.exit(1) }

fs.writeFileSync(file, kept.join('\n') + '\n')
console.log('KEPT ' + kept.length + ' lines, DROPPED ' + dropped + ' trailing lines')
