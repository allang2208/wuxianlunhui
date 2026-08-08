$srcDir = Join-Path $PSScriptRoot "..\..\assets\enemies"
$dst = Join-Path $env:TEMP "rw-audit"
if (Test-Path $dst) { Remove-Item -LiteralPath $dst -Recurse -Force }
New-Item -ItemType Directory -Path $dst | Out-Null
Copy-Item -Path (Join-Path $srcDir "red_wolf_king*.png") -Destination $dst
"prepared: " + (Get-ChildItem $dst).Count
