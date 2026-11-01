 # Writes ota/apk-manifest.json from the ACTUAL verified APK.
# Values are read from the built artifact, never typed by hand.
param([string]$Pub = "$env:TEMP\al-helm-app-publish")

$ErrorActionPreference = 'Stop'
$apkName = '4ulife-1.5-debug.apk'
$apkPath = Join-Path $Pub "downloads\$apkName"
if (-not (Test-Path $apkPath)) { throw "APK missing: $apkPath" }

$hash = (Get-FileHash $apkPath -Algorithm SHA256).Hash.ToLower()

$manifest = [ordered]@{
  version     = '1.5'
  versionCode = 6
  apkUrl      = "https://mohamedtarek100.github.io/al-helm-app/downloads/$apkName"
  sha256      = $hash
  notes       = 'Critical fix: the app no longer shows a blank page at launch (i18n provider ordering). Includes the exam-date fix, Urgent priority, Dream Studio tools, app lock and temporary Guest mode.'
  publishedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
}

$dir = Join-Path $Pub 'ota'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$json = $manifest | ConvertTo-Json -Depth 4
[IO.File]::WriteAllText((Join-Path $dir 'apk-manifest.json'), $json + "`n", (New-Object Text.UTF8Encoding($false)))

'MANIFEST WRITTEN'
$json
