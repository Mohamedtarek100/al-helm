# Read-only: recover the qa-live.mjs text from an escaped chat-log line.
param([string]$Log)
$text = Get-Content -LiteralPath $Log -Raw -ErrorAction Stop

# Candidate lines that embed the script body as an escaped JSON string.
$best = $null
foreach ($line in ($text -split "`n")) {
  if ($line -notmatch 'export default async function run') { continue }
  $idx = $line.IndexOf('export default async function run')
  if ($idx -lt 0) { continue }
  $candidate = $line.Substring($idx)
  # Unescape the JSON-style sequences so the body becomes real source.
  $candidate = $candidate.Replace('\r\n', "`n").Replace('\n', "`n").Replace('\"', '"').Replace('\\', '\')
  if (-not $best -or $candidate.Length -gt $best.Length) { $best = $candidate }
}

if (-not $best) { 'NO BLOCK FOUND'; exit 0 }

"LENGTH: $($best.Length)"
"--- URL TARGET ---"
($best -split "`n" | Where-Object { $_ -match 'http|localhost|github\.io' } | Select-Object -First 10)
"--- FIRST 8 LINES ---"
($best -split "`n" | Select-Object -First 8)
