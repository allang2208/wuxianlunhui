$dst = Join-Path $env:TEMP "rw-humanoid-v2"
$backDir = Join-Path $PSScriptRoot "..\..\assets\enemies"
Copy-Item -Path (Join-Path $dst "red_wolf_king*.png") -Destination $backDir -Force
"copied back: " + (Get-ChildItem $dst).Count
