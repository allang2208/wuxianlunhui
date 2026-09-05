$ErrorActionPreference = 'Stop'
# 定稿源只重建V2，避免根目录旧入口重新生成已淘汰的V1二进制。
& (Join-Path $PSScriptRoot 'model_correction_v2/render-model.ps1')
