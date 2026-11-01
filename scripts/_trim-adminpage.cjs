 // One-off: drop the legacy section definitions now hosted in
// components/admin/sections/LegacySections.tsx.
// Verified by content before writing: the file must still contain the marker.
const fs = require('fs')
const file = 'src/pages/AdminPage.tsx'
const lines = fs.readFileSync(file, 'utf8').split('\n')

const marker = lines.findIndex((l) => l.includes('Shared async state'))
if (marker < 0) { console.log('MARKER NOT FOUND'); process.exit(1) }

// Keep everything before the comment block that introduces useAsync, and
// everything from the final line of the component (closing brace).
const header = lines.findIndex((l) => l.trim() === '/* ------------------------------------------------------------------ */' && lines[lines.indexOf(l) + 1]?.includes('Shared async state'))
const cut = header > 0 ? header : marker - 1
const out = lines.slice(0, cut).join('\n').replace(/\s+$/, '') + '\n'
fs.writeFileSync(file, out)
console.log('TRIMMED to ' + out.split('\n').length + ' lines')
