$gd = Split-Path -Parent $PSScriptRoot
$workspace = Split-Path -Parent $gd
$src = Join-Path $workspace 'tools\verify-shots\layer-audit'
$dst = Join-Path $gd 'tools\verify-shots\layer-audit'
if (Test-Path $src) {
    New-Item -ItemType Directory -Force -Path $dst | Out-Null
    Get-ChildItem $src | Move-Item -Destination $dst -Force
    Remove-Item -LiteralPath (Join-Path $workspace 'tools') -Recurse -Force -ErrorAction SilentlyContinue
}
Get-ChildItem $dst | Select-Object Name, Length
