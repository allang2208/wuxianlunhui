$ErrorActionPreference = 'Stop'
$geothermalRevision = $PSScriptRoot
$geothermalBuilder = Join-Path (Split-Path (Split-Path $geothermalRevision -Parent) -Parent) 'geothermal-power-plant-blender.py'
$geothermalBlender = 'E:/Program Files/Blender Foundation/Blender 5.1/blender.exe'
$geothermalManifest = Join-Path $geothermalRevision 'manifest.json'
$geothermalModel = Join-Path $geothermalRevision 'geothermal_power_plant_model.blend'
$geothermalPreview = Join-Path $geothermalRevision 'geothermal_power_plant_model_preview.png'
$geothermalDepth = Join-Path $geothermalRevision 'geothermal_power_plant_depth.png'
$geothermalBodyDepth = Join-Path $geothermalRevision 'geothermal_power_plant_body_depth.png'

& $geothermalBlender --background --factory-startup --python-exit-code 1 --python $geothermalBuilder -- `
    $geothermalManifest geothermal_power_plant $geothermalModel $geothermalPreview $geothermalDepth
if ($LASTEXITCODE -ne 0) { throw 'Geothermal corrected model generation failed.' }

& $geothermalBlender --background --factory-startup --python-exit-code 1 --python $geothermalBuilder -- `
    $geothermalManifest geothermal_power_plant $geothermalModel $geothermalPreview $geothermalDepth `
    $geothermalBodyDepth --body-only
if ($LASTEXITCODE -ne 0) { throw 'Geothermal corrected Body Depth generation failed.' }
