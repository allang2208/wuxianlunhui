$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
$builder = Join-Path $taskRoot 'interplane-research-hub-blender.py'
$manifest = Join-Path $taskRoot 'manifest.json'
$output = Join-Path $taskRoot 'model_v2'
$blender = 'E:/Program Files/Blender Foundation/Blender 5.1/blender.exe'

New-Item -ItemType Directory -Force -Path $output | Out-Null
$blend = Join-Path $output 'interplane_research_hub_model.blend'
$preview = Join-Path $output 'interplane_research_hub_model_preview.png'
$depth = Join-Path $output 'interplane_research_hub_depth.png'
$bodyDepth = Join-Path $output 'interplane_research_hub_body_depth.png'
$log = Join-Path $output 'render.log'

try {
    $ErrorActionPreference = 'Continue'
    & $blender --background --factory-startup --python-exit-code 1 --python $builder -- `
        $manifest interplane_research_hub $blend $preview $depth $bodyDepth `
        *> $log
    $renderExitCode = $LASTEXITCODE
} finally {
    $ErrorActionPreference = 'Stop'
}

if ($renderExitCode -ne 0) {
    Get-Content -LiteralPath $log -Tail 40
    throw "Interplane research hub model render failed"
}

Get-Content -LiteralPath $log -Tail 16
Write-Output 'Rendered interplane_research_hub editable model, approval preview, full Depth and Body Depth.'
