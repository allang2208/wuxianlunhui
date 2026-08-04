# 增量备份 game-dev 仓库到 NAS Y:\备份\game-dev（非镜像，不删除远端文件）
$ErrorActionPreference = "Stop"
$src = Join-Path (Split-Path $PSScriptRoot -Parent) "game-dev"
$dst = "Y:\备份\game-dev"

if (-not (Test-Path $src)) { Write-Error "source not found: $src" }
New-Item -ItemType Directory -Path $dst -Force | Out-Null

robocopy $src $dst /E /XD node_modules .git backup dist /R:2 /W:5 /NFL /NDL /NP
$code = $LASTEXITCODE
if ($code -le 7) {
    Write-Output "backup OK (robocopy exit $code), $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
} else {
    Write-Error "robocopy failed: $code"
}
