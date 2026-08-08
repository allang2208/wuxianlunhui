$dst = Join-Path $env:TEMP "rw-rmbg-stage"
if (Test-Path $dst) { Remove-Item -LiteralPath $dst -Recurse -Force }
New-Item -ItemType Directory -Path $dst | Out-Null
$src = Join-Path $PSScriptRoot "rw-rmbg-out"
Copy-Item -Path (Join-Path $src "red_wolf_king*.png") -Destination $dst
"staged: " + (Get-ChildItem $dst).Count
