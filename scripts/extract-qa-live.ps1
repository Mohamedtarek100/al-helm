# Read-only: pull the largest text block that looks like qa-live.mjs out of a log.
param([string]$Log)
$text = Get-Content -LiteralPath $Log -Raw -ErrorAction Stop
# Split on the marker; keep segments that contain the script's signature.
$parts = $text -split 'qa-live\.mjs'
$best = $null
foreach ($part in $parts) {
  if ($part -notmatch 'export default async function run') { continue }
  # Take from the start of the function to the end of its body heuristically.
  $start = $part.IndexOf('export default async function run')
  $segment = $part.Substring($start)
  if (-not $best -or $segment.Length -gt $best.Length) { $best = $segment }
}
if ($best) {
  "FOUND block length: $($best.Length)"
  "--- first 12 lines ---"
  ($best -split "`n" | Select-Object -First 12)
  "--- URL references ---"
  ($best -split "`n" | Select-String -Pattern 'localhost|github\.io|http' | Select-Object -First 8 | ForEach-Object { $_.Line.Trim() })
}
else {
  'NO BLOCK FOUND'
}
