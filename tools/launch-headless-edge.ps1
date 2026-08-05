$ErrorActionPreference = 'Stop'
$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
# profile 放项目根之外（vite watcher 只监听 game-dev，放里面会被 Edge 锁 Cookies 触发 EBUSY 崩溃）
$workspaceRoot = (Get-Location).Path
$profile = Join-Path $workspaceRoot '.edge-cdp-profile'
New-Item -ItemType Directory -Path $profile | Out-Null
$args = @(
  '--headless=new',
  '--disable-gpu',
  '--remote-debugging-port=9224',
  '--window-size=1920,1080',
  '--no-first-run',
  '--no-default-browser-check',
  "--user-data-dir=$profile",
  'http://localhost:5173/'
)
$p = Start-Process -FilePath $edge -ArgumentList $args -WindowStyle Hidden -PassThru
Start-Sleep -Seconds 8
Write-Output "pid=$($p.Id) exited=$($p.HasExited)"
try {
    $list = Invoke-RestMethod -Uri 'http://127.0.0.1:9224/json/list' -TimeoutSec 3
    $list | Where-Object { $_.type -eq 'page' } | Select-Object id, url, title
} catch {
    Write-Output "CDP not ready: $($_.Exception.Message)"
}
