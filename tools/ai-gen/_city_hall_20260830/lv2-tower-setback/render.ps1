$ErrorActionPreference = 'Stop'
$cityHallSetbackBlender = 'E:/Program Files/Blender Foundation/Blender 5.1/blender.exe'
$cityHallSetbackScript = Join-Path $PSScriptRoot 'adjust-model.py'
$cityHallSetbackLog = Join-Path $PSScriptRoot 'render.log'
try {
    $ErrorActionPreference = 'Continue'
    & $cityHallSetbackBlender --background --factory-startup --python-exit-code 1 --python $cityHallSetbackScript *> $cityHallSetbackLog
    $cityHallSetbackExit = $LASTEXITCODE
} finally {
    $ErrorActionPreference = 'Stop'
}
Get-Content -LiteralPath $cityHallSetbackLog -Tail 14
if ($cityHallSetbackExit -ne 0) { throw 'City hall tower-setback render failed.' }
