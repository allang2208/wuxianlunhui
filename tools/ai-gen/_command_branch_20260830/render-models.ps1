$ErrorActionPreference = 'Stop'
$commandAssetRoot = $PSScriptRoot
$commandBuilder = Join-Path (Split-Path $commandAssetRoot -Parent) 'command-building-branch-blender.py'
$commandBlender = 'E:/Program Files/Blender Foundation/Blender 5.1/blender.exe'
foreach ($commandAssetId in @('command_post', 'military_headquarters', 'defense_ministry')) {
    $commandOutputDir = Join-Path $commandAssetRoot $commandAssetId
    New-Item -ItemType Directory -Force -Path $commandOutputDir | Out-Null
    # Factory startup isolates user add-ons/localized node names, without changing user preferences.
    & $commandBlender --background --factory-startup --python-exit-code 1 --python $commandBuilder -- `
        (Join-Path $commandAssetRoot 'manifest.json') $commandAssetId `
        (Join-Path $commandOutputDir ($commandAssetId + '_model.blend')) `
        (Join-Path $commandOutputDir ($commandAssetId + '_model_preview.png')) `
        (Join-Path $commandOutputDir ($commandAssetId + '_depth.png')) *> (Join-Path $commandOutputDir 'render.log')
    if ($LASTEXITCODE -ne 0) {
        Get-Content -LiteralPath (Join-Path $commandOutputDir 'render.log') -Tail 24
        throw "Blender render failed: $commandAssetId"
    }
    Write-Output "Rendered $commandAssetId"
}
