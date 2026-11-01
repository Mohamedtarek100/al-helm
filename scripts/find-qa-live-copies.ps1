# Read-only search for any surviving copy of qa-live.mjs outside the repo.
$roots = @(
  "$env:USERPROFILE\.codegpt",
  "$env:APPDATA\Code\User\globalStorage",
  "$env:APPDATA\Code\logs"
)
foreach ($root in $roots) {
  if (-not (Test-Path $root)) { continue }
  Get-ChildItem $root -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Length -lt 20MB -and $_.Extension -in '.json', '.jsonl', '.log', '.mjs', '.txt' } |
    ForEach-Object {
      $text = Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue
      if ($text -and $text -match 'qa-live\.mjs' -and $text -match 'export default async function run') {
        "{0}  {1}b" -f $_.FullName, $_.Length
      }
    }
}
'SEARCH COMPLETE'
