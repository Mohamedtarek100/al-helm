function undo(s) { const bytes = Buffer.from(Array.from(s, c => c.charCodeAt(0) <= 255 ? c.charCodeAt(0) : 63)); return new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
const samples = ['Ø§Ù„Ù…Ù‡Ø§Ù…ÙŠ', 'Ù…Ù‡Ø§Ù…ÙŠ', 'Ø§Ù„Ø¬Ù„Ø³Ø©']
for (const s of samples) { try { const once = undo(s); const twice = undo(once); console.log(JSON.stringify({ s, once, twice })) } catch (e) { console.log(JSON.stringify({ s, error: e.message })) } }
