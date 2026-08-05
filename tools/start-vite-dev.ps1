param(
    [int]$Port = 5173
)
$root = Split-Path -Parent $PSScriptRoot
$log = Join-Path $PSScriptRoot ".vite-dev.log"
Remove-Item -LiteralPath $log, ($log + '.err') -ErrorAction SilentlyContinue
$node = 'C:\Program Files\nodejs\node.exe'
$vite = Join-Path $root 'node_modules\vite\bin\vite.js'
$p = Start-Process -FilePath $node -ArgumentList @($vite, '--port', "$Port", '--strictPort') `
    -WorkingDirectory $root -WindowStyle Hidden `
    -RedirectStandardOutput $log -RedirectStandardError ($log + '.err') -PassThru
$p.Id | Set-Content (Join-Path $PSScriptRoot '.vite.pid')
Write-Host "vite started pid=$($p.Id) port=$Port"
$ok = $false
for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Seconds 2
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:$Port/" -TimeoutSec 3 -UseBasicParsing
        if ($r.StatusCode -eq 200) { $ok = $true; break }
    } catch { }
}
Write-Host "vite ready: $ok"
