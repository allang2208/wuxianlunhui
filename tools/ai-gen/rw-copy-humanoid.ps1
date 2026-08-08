$dst = Join-Path $env:TEMP "rw-audit3"
if (Test-Path $dst) { Remove-Item -LiteralPath $dst -Recurse -Force }
New-Item -ItemType Directory -Path $dst | Out-Null
$srcDir = Join-Path $PSScriptRoot "..\..\assets\enemies"
Copy-Item -LiteralPath (Join-Path $srcDir "red_wolf_king_transformed_idle.png") -Destination $dst
Copy-Item -LiteralPath (Join-Path $srcDir "red_wolf_king_changed_run.png") -Destination $dst
Copy-Item -LiteralPath (Join-Path $srcDir "red_wolf_king_changed_attack.png") -Destination $dst
"prepared: " + (Get-ChildItem $dst).Count
