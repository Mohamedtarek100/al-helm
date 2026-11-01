# Read-only verification of the deployed admin function's CORS behaviour.
# Uses only the public anon/publishable key; prints status codes and headers.
$ErrorActionPreference = 'Continue'
$base = 'https://warepmhybetvjzgvpuqf.supabase.co'
$key = ((Get-Content 'd:\EL 7lm\.env.local' | Where-Object { $_ -match '^VITE_SUPABASE_ANON_KEY=' }) -replace '^VITE_SUPABASE_ANON_KEY=', '').Trim()

function Probe($label, $uri, $method, $headers, $body) {
  try {
    $r = Invoke-WebRequest -Uri $uri -Method $method -Headers $headers -Body $body -UseBasicParsing -TimeoutSec 30
    "{0,-46} {1}  ACAO={2}" -f $label, [int]$r.StatusCode, $r.Headers['Access-Control-Allow-Origin']
  }
  catch {
    $status = [int]$_.Exception.Response.StatusCode
    $acao = $_.Exception.Response.Headers['Access-Control-Allow-Origin']
    "{0,-46} {1}  ACAO={2}" -f $label, $status, $acao
  }
}

$corsHeaders = @{ Origin = 'https://mohamedtarek100.github.io' }

# 1. Preflight (no Authorization header, exactly like a browser).
Probe 'OPTIONS /admin/gate'              "$base/functions/v1/admin/gate"      'OPTIONS' $corsHeaders $null
Probe 'OPTIONS /admin/heartbeat'         "$base/functions/v1/admin/heartbeat" 'OPTIONS' $corsHeaders $null

# 2. Authenticated POST without a token must still be denied (and carry CORS).
Probe 'POST /admin/gate (no token)'      "$base/functions/v1/admin/gate"      'POST' @{ apikey = $key; 'Content-Type' = 'application/json' } '{"action":"gate"}'
