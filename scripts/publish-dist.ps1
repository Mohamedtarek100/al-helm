# Scoped publication of the verified web build to al-helm-app/main.
#
# Deliberately does NOT use the workflow's broad `rm -rf` cleanup: release
# assets (downloads/, ota/, releases/, icons/) and repository metadata must
# survive a site update.
param(
  [string]$Dist = 'd:\EL 7lm\dist',
  [string]$Pub = "$env:TEMP\al-helm-app-publish"
)

$ErrorActionPreference = 'Stop'

# 1. Replace ONLY the generated site entry point and its assets directory.
if (Test-Path (Join-Path $Pub 'assets')) { Remove-Item (Join-Path $Pub 'assets') -Recurse -Force }
New-Item -ItemType Directory -Force -Path (Join-Path $Pub 'assets') | Out-Null
Copy-Item -Path (Join-Path $Dist 'assets\*') -Destination (Join-Path $Pub 'assets') -Recurse -Force

# 2. Copy the root-level site files the build produces (never the release dirs).
$siteFiles = @('index.html', 'favicon.svg', 'logo.svg', 'manifest.webmanifest', 'sw.js')
foreach ($file in $siteFiles) {
  $source = Join-Path $Dist $file
  if (Test-Path $source) { Copy-Item $source -Destination (Join-Path $Pub $file) -Force }
}

# 2b. Icons are part of the PWA shell the service worker precaches.
if (Test-Path (Join-Path $Dist 'icons')) {
  Copy-Item (Join-Path $Dist 'icons') -Destination (Join-Path $Pub 'icons') -Recurse -Force
}

# 3. Guard: the release assets must still be present after the copy.
foreach ($required in @('downloads', 'ota')) {
  if (-not (Test-Path (Join-Path $Pub $required))) { throw "Release directory '$required' disappeared - aborting." }
}

"PUBLISH SYNCED"
"entry bundle: " + ([regex]::Match((Get-Content (Join-Path $Pub 'index.html') -Raw), 'assets/(index-[^"]+\.js)').Groups[1].Value)
