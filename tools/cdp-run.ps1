#!/usr/bin/env pwsh
# 安全运行 cdp 探针的入口脚本 (2026-08-16)
# 用法:  powershell -ExecutionPolicy Bypass -File tools\cdp-run.ps1 cdp-node-dump.mjs
#
# 作用:
#   1) 只清理"无头/CDP 调试"用的 Edge 进程 (命令行含 --headless / edge-cdp /
#      remote-debugging), 绝不碰用户正常打开的浏览器;
#   2) 运行指定的探针脚本。
#
# 背景: 不要再用 `Get-Process -Name msedge | Stop-Process -Force` 这类无差别
# 杀进程命令, 它会连用户正在使用的正常 Edge 一起杀掉 (见 AGENTS.md)。

param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$Probe
)

$ErrorActionPreference = 'Continue'

# 1) 仅停止无头 / CDP 调试 Edge
$cdpEdges = Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match '--headless|edge-cdp|remote-debugging' }
$count = @($cdpEdges).Count
$cdpEdges | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}
Write-Host "[cdp-run] 已清理无头/CDP Edge 进程: $count"

if ($count -gt 0) {
    Start-Sleep -Seconds 2
}

# 2) 运行探针
$probePath = if ([System.IO.Path]::IsPathRooted($Probe)) {
    $Probe
} else {
    Join-Path $PSScriptRoot $Probe
}

if (-not (Test-Path -LiteralPath $probePath)) {
    Write-Error "[cdp-run] 找不到探针脚本: $probePath"
    exit 1
}

Write-Host "[cdp-run] 运行: node $probePath"
node $probePath
exit $LASTEXITCODE
