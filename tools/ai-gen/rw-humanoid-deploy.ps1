$src = Join-Path $env:TEMP "rw-rmbg-stage"
$dst = Join-Path $PSScriptRoot "..\..\assets\enemies"
Copy-Item -Path (Join-Path $src "red_wolf_king*.png") -Destination $dst -Force
"deployed: " + (Get-ChildItem $src -Filter "red_wolf_king*.png").Count
