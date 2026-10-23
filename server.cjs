const http = require('http')
const fs = require('fs')
const path = require('path')
const root = 'D:/EL 7lm/dist'
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.woff2': 'font/woff2', '.ico': 'image/x-icon' }
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0])
  // The app is built with base '/al-helm-app/' — strip that prefix for local serving.
  if (p.startsWith('/al-helm-app/')) p = p.slice('/al-helm-app'.length)
  if (p === '/') p = '/index.html'
  let f = path.join(root, p)
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    // Unknown paths fall back to the SPA entry only for navigations.
    if (!path.extname(p)) f = path.join(root, 'index.html')
    else { res.statusCode = 404; res.end('not found'); return }
  }
  res.setHeader('Content-Type', mime[path.extname(f)] || 'application/octet-stream')
  fs.createReadStream(f).pipe(res)
}).listen(4181, () => console.log('UP'))
