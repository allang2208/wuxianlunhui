$ErrorActionPreference = 'Stop'
$cityHallBalconyBlender = 'E:/Program Files/Blender Foundation/Blender 5.1/blender.exe'
$cityHallBalconyScript = Join-Path $PSScriptRoot 'adjust-model.py'
$cityHallBalconyLog = Join-Path $PSScriptRoot 'render.log'
try {
    $ErrorActionPreference = 'Continue'
    & $cityHallBalconyBlender --background --factory-startup --python-exit-code 1 --python $cityHallBalconyScript *> $cityHallBalconyLog
    $cityHallBalconyExit = $LASTEXITCODE
} finally {
    $ErrorActionPreference = 'Stop'
}
Get-Content -LiteralPath $cityHallBalconyLog -Tail 14
if ($cityHallBalconyExit -ne 0) { throw 'City hall balcony render failed.' }
