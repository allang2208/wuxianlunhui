$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
$python = 'E:\无尽轮回\长期备份\2026-7-13-1\ComfyUI\.venv\Scripts\python.exe'
$entrypoint = Join-Path $projectRoot 'tools\ai-gen\ai-asset.py'
$reference = Join-Path $PSScriptRoot 'h3-references\trade-clerk-negotiating-h3-ref-v02.png'
$prompt = Join-Path $PSScriptRoot 'prompts\trade-clerk-negotiating-h3-v02.txt'
$output = Join-Path $PSScriptRoot 'videos\trade-clerk-negotiating-h3-v02.mp4'

& $python $entrypoint video generate `
    --provider h3 `
    --ref $reference `
    --prompt $prompt `
    --out $output `
    --duration 5.17 `
    --size 1024x576 `
    --steps 20 `
    --candidates 1 `
    --seed 901729 `
    --bg-color '#FFFFFF' `
    --timeout 3600 `
    --h3-prompt-format h3 `
    --h3-audio-mode visual-only `
    --h3-visual-profile character-asset `
    --motion-mode recover

if ($LASTEXITCODE -ne 0) {
    throw "MiniMax H3 generation failed for trade-clerk-negotiating-v02 with exit code $LASTEXITCODE"
}
