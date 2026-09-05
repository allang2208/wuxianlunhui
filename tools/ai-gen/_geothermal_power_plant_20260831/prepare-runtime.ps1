param([string]$Python = 'E:/无尽轮回/长期备份/2026-7-13-1/ComfyUI/.venv/Scripts/python.exe')
$ErrorActionPreference = 'Stop'
$geothermalProject = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$geothermalSource = 'tools/ai-gen/_geothermal_power_plant_20260831'
Push-Location -LiteralPath $geothermalProject
try {
    & $Python tools/ai-gen/key-world122-building-body.py "$geothermalSource/structure_correction_v3_12step/geothermal_power_plant/geothermal_power_plant_structure_v01_raw.png" "$geothermalSource/geothermal_power_plant_accepted_body.png" --threshold 70 --remove-enclosed-key --nearest-opaque-edge-rgb --preview "$geothermalSource/geothermal_power_plant_cutout_preview.png"
    if ($LASTEXITCODE) { throw 'Building key failed' }
    # Alpha is intentionally edited only in this bounded exterior-cleanup stage.
    & $Python tools/ai-gen/finalize-building-runtime.py "$geothermalSource/geothermal_power_plant_accepted_body.png" "$geothermalSource/geothermal_power_plant_bounded_cutout.png" --display-width 512 --nearest-opaque-edge-rgb --matte-color '#37d226' --matte-tolerance 100 --remove-matte-rect 733,525,852,603 --clear-alpha-polygon '852,526;1024,526;1024,651;964,651;852,595' --clear-alpha-polygon '0,737;61,737;456,934;964,682;1024,682;1024,1024;0,1024' --clear-alpha-rect 965,650,1024,683 --metadata "$geothermalSource/geothermal_cutout_metadata.json"
    if ($LASTEXITCODE) { throw 'Exterior cleanup failed' }
    & $Python tools/ai-gen/repair-local-green-spill.py "$geothermalSource/geothermal_power_plant_bounded_cutout.png" "$geothermalSource/geothermal_power_plant_final_cutout.png" --rect 0,0,910,623 --max-edge-distance 7
    if ($LASTEXITCODE) { throw 'Edge cleanup failed' }
    & $Python tools/ai-gen/finalize-building-runtime.py "$geothermalSource/geothermal_power_plant_final_cutout.png" assets/terrain/geothermal_power_plant.png --display-width 512 --preserve-alpha-exact --nearest-opaque-edge-rgb --metadata "$geothermalSource/geothermal_power_plant_runtime_metadata.json"
    if ($LASTEXITCODE) { throw 'Runtime export failed' }
    node tools/generate-building-preview-assets.mjs --only geothermal_power_plant
    if ($LASTEXITCODE) { throw 'Thumbnail / footprint export failed' }
    & $Python tools/ai-gen/build-lighting-maps.py geothermal_power_plant
    if ($LASTEXITCODE) { throw 'Lighting export failed' }
    Get-FileHash -LiteralPath assets/terrain/geothermal_power_plant.png -Algorithm SHA256
    Write-Output 'If the image source changed, update this building assetCutoutHash and measured visualFootprint; do not change other buildings.'
} finally {
    Pop-Location
}
