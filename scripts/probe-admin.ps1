# Read-only probe of the deployed admin Edge Function routing/contract.
$ErrorActionPreference = 'Stop'
$u = 'https://warepmhybetvjzgvpuqf.supabase.co'
$k = ((Get-Content .env.local | Where-Object { $_ -match '^VITE_SUPABASE_ANON_KEY=' }) -replace '^VITE_SUPABASE_ANON_KEY=', '').Trim()
# A well-formed but bogus JWT: the signature is invalid, so the function must reach its auth layer.
$bogus = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJub25lIiwicm9sZSI6ImF1dGhlbnRpY2F0ZWQiLCJleHAiOjk5OTk5OTk5OTl9.invalidsignature'
$targets = @("$u/functions/v1/admin", "$u/functions/v1/admin/gate")
foreach ($target in $targets) {
  try {
    $r = Invoke-WebRequest -Uri $target -Method POST -UseBasicParsing -TimeoutSec 25 `
      -Headers @{ 'Content-Type' = 'application/json'; apikey = $k; Authorization = "Bearer $bogus" } `
      -Body '{"action":"gate"}'
    Write-Output ("PATH=" + $target + " STATUS=" + $r.StatusCode + " BODY=" + $r.Content)
  } catch {
    $status = [int]$_.Exception.Response.StatusCode
    $body = $_.ErrorDetails.Message
    Write-Output ("PATH=" + $target + " STATUS=" + $status + " BODY=" + $body)
  }
}
