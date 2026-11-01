# Read-only diagnosis of the admin PostgREST queries behind metrics/history.
# Uses the linked CLI connection for SQL and the anon key for REST shape checks.
$ErrorActionPreference = 'Continue'
$base = 'https://warepmhybetvjzgvpuqf.supabase.co'
$key = ((Get-Content 'd:\EL 7lm\.env.local' | Where-Object { $_ -match '^VITE_SUPABASE_ANON_KEY=' }) -replace '^VITE_SUPABASE_ANON_KEY=', '').Trim()
$h = @{ apikey = $key }

function Rest($label, $path) {
  try {
    $r = Invoke-WebRequest -Uri "$base/rest/v1/$path" -Headers $h -UseBasicParsing -TimeoutSec 25
    "{0,-58} {1}" -f $label, [int]$r.StatusCode
  }
  catch {
    $status = [int]$_.Exception.Response.StatusCode
    $body = $_.ErrorDetails.Message
    if ($body.Length -gt 180) { $body = $body.Substring(0, 180) }
    "{0,-58} {1}  {2}" -f $label, $status, $body
  }
}

# The embedded-count embed the Edge Function uses for `history`.
Rest 'announcements?select=...,announcement_delivery(count)' 'announcements?select=id,title,audience,created_at,announcement_delivery(count)'
# The columns the Edge Function reads for metrics.
Rest 'user_activity?select=*&head' 'user_activity?select=*&limit=1'
Rest 'push_subscriptions?select=*&head' 'push_subscriptions?select=*&limit=1'
Rest 'announcements?select=*&head' 'announcements?select=*&limit=1'
