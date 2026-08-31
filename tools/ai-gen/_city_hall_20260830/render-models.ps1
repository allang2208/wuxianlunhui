$ErrorActionPreference = 'Stop'
$cityHallRoot = $PSScriptRoot
$cityHallBuilder = Join-Path (Split-Path $cityHallRoot -Parent) 'city-hall-building-blender.py'
$cityHallBlender = 'E:/Program Files/Blender Foundation/Blender 5.1/blender.exe'
foreach ($cityHallId in @('city_hall_lv1', 'city_hall_lv2', 'city_hall_lv3')) {
    $cityHallOutput = Join-Path $cityHallRoot $cityHallId
    New-Item -ItemType Directory -Force -Path $cityHallOutput | Out-Null
    $cityHallManifest = Join-Path $cityHallRoot 'manifest.json'
    $cityHallBlend = Join-Path $cityHallOutput ($cityHallId + '_model.blend')
    $cityHallPreview = Join-Path $cityHallOutput ($cityHallId + '_model_preview.png')
    $cityHallDepth = Join-Path $cityHallOutput ($cityHallId + '_depth.png')
    try {
        $ErrorActionPreference = 'Continue'
        & $cityHallBlender --background --factory-startup --python-exit-code 1 --python $cityHallBuilder -- `
            $cityHallManifest $cityHallId $cityHallBlend $cityHallPreview $cityHallDepth `
            *> (Join-Path $cityHallOutput 'render.log')
        $cityHallExitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = 'Stop'
    }
    if ($cityHallExitCode -ne 0) {
        Get-Content -LiteralPath (Join-Path $cityHallOutput 'render.log') -Tail 24
        throw "City hall model render failed: $cityHallId"
    }
    Write-Output "Rendered $cityHallId model + preview + Depth"
}
