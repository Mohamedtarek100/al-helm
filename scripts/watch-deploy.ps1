# Read-only: poll the public site until the deployed bundle changes from the stale one.
$stale = 'index-C4xra4si.js'
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Seconds 30
  try {
    $html = (Invoke-WebRequest 'https://mohamedtarek100.github.io/al-helm-app/' -UseBasicParsing -TimeoutSec 15).Content
    $bundle = [regex]::Match($html, 'assets/(index-[^"]+\.js)').Groups[1].Value
    $stamp = Get-Date -Format 'HH:mm:ss'
    "$stamp  deployed=$bundle" | Out-File -FilePath "$PSScriptRoot\..\deployed.log" -Append -Encoding utf8
    if ($bundle -and $bundle -ne $stale) {
      "DEPLOYED: $bundle" | Out-File -FilePath "$PSScriptRoot\..\deployed.log" -Append -Encoding utf8
      break
    }
  }
  catch {
    "$(Get-Date -Format 'HH:mm:ss')  fetch error" | Out-File -FilePath "$PSScriptRoot\..\deployed.log" -Append -Encoding utf8
  }
}
