# Read-only: list every distinct qa-live.mjs body fragment found in VS Code logs.
$root = "$env:APPDATA\Code\logs"
$seen = @{}
foreach ($log in Get-ChildItem $root -Recurse -File -Filter '*.log' -ErrorAction SilentlyContinue) {
  $text = Get-Content $log.FullName -Raw -ErrorAction SilentlyContinue
  if (-not $text) { continue }
  foreach ($line in ($text -split "`n")) {
    if ($line -notmatch 'export default async function run') { continue }
    $idx = $line.IndexOf('export default async function run')
    if ($idx -lt 0) { continue }
    $body = $line.Substring($idx)
    # Keep only the first line after the signature: it identifies the target URL.
    $firstTarget = ($body -split "`n" | Where-Object { $_ -match 'goto\(' } | Select-Object -First 1)
    $key = if ($firstTarget) { $firstTarget.Trim() } else { '(no goto)' }
    if (-not $seen.ContainsKey($key)) { $seen[$key] = @() }
    $seen[$key] += $log.Name
  }
}
"=== DISTINCT TARGETS FOUND ==="
$seen.GetEnumerator() | ForEach-Object { "{0}   [in {1} log lines]" -f $_.Key, $_.Value.Count }
