$ErrorActionPreference = 'Stop'

$taskRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $taskRoot '..\..\..\..')).Path
$source = Join-Path $taskRoot 'final\mouse-blacksmith-idle-h3-v01-rife.png'
$target = Join-Path $repoRoot 'assets\npc\mouse_blacksmith\idle.png'
$expectedHash = 'A69A118B07A3928753F7C7288C71F92032FE965BB050F587D256C588D70A1C46'

if (-not (Test-Path -LiteralPath $source)) {
    throw "Missing accepted source sheet: $source"
}

$sourceHash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
if ($sourceHash -ne $expectedHash) {
    throw "Accepted source hash mismatch: expected $expectedHash, got $sourceHash"
}

Copy-Item -LiteralPath $source -Destination $target -Force

$targetHash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
if ($targetHash -ne $expectedHash) {
    throw "Runtime sheet hash mismatch after install: expected $expectedHash, got $targetHash"
}

Write-Output "Installed mouse blacksmith idle sheet: $target"
Write-Output "SHA256=$targetHash"
