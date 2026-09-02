param()

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$taskRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = $taskRoot
for ($i = 0; $i -lt 4; $i++) { $projectRoot = Split-Path -Parent $projectRoot }

$formalRoot = Join-Path $taskRoot 'formal'
$sourceRoot = Join-Path $formalRoot 'sources'
$preparedRoot = Join-Path $formalRoot 'prepared'
$hiresIconRoot = Join-Path $formalRoot 'icons-hires'
$runtimeIconRoot = Join-Path $formalRoot 'icons-128'

@($preparedRoot, $hiresIconRoot, $runtimeIconRoot) | ForEach-Object {
    New-Item -ItemType Directory -Force -Path $_ | Out-Null
}

function New-ArgbBitmap([int]$width, [int]$height) {
    return [System.Drawing.Bitmap]::new(
        $width,
        $height,
        [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
    )
}

function Save-Png([System.Drawing.Bitmap]$bitmap, [string]$path) {
    $parent = Split-Path -Parent $path
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
}

function Get-AlphaBounds([System.Drawing.Bitmap]$bitmap) {
    $minX = $bitmap.Width
    $minY = $bitmap.Height
    $maxX = -1
    $maxY = -1
    for ($y = 0; $y -lt $bitmap.Height; $y++) {
        for ($x = 0; $x -lt $bitmap.Width; $x++) {
            if ($bitmap.GetPixel($x, $y).A -le 2) { continue }
            if ($x -lt $minX) { $minX = $x }
            if ($y -lt $minY) { $minY = $y }
            if ($x -gt $maxX) { $maxX = $x }
            if ($y -gt $maxY) { $maxY = $y }
        }
    }
    if ($maxX -lt $minX -or $maxY -lt $minY) {
        throw 'Image has no visible pixels.'
    }
    return [System.Drawing.Rectangle]::new($minX, $minY, $maxX - $minX + 1, $maxY - $minY + 1)
}

function Save-NormalizedSquare([string]$sourcePath, [string]$outputPath, [int]$size, [double]$contentRatio) {
    $source = [System.Drawing.Bitmap]::FromFile($sourcePath)
    try {
        $bounds = Get-AlphaBounds $source
        $targetExtent = [Math]::Round($size * $contentRatio)
        $scale = [Math]::Min($targetExtent / $bounds.Width, $targetExtent / $bounds.Height)
        $drawWidth = [Math]::Max(1, [Math]::Round($bounds.Width * $scale))
        $drawHeight = [Math]::Max(1, [Math]::Round($bounds.Height * $scale))
        $drawX = [Math]::Round(($size - $drawWidth) / 2)
        $drawY = [Math]::Round(($size - $drawHeight) / 2)
        $output = New-ArgbBitmap $size $size
        try {
            $graphics = [System.Drawing.Graphics]::FromImage($output)
            try {
                $graphics.Clear([System.Drawing.Color]::Transparent)
                $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
                $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
                $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                $dest = [System.Drawing.Rectangle]::new($drawX, $drawY, $drawWidth, $drawHeight)
                $graphics.DrawImage($source, $dest, $bounds, [System.Drawing.GraphicsUnit]::Pixel)
            } finally {
                $graphics.Dispose()
            }
            Save-Png $output $outputPath
        } finally {
            $output.Dispose()
        }
    } finally {
        $source.Dispose()
    }
}

function Save-ResizedSquare([string]$sourcePath, [string]$outputPath, [int]$size) {
    $source = [System.Drawing.Bitmap]::FromFile($sourcePath)
    try {
        $output = New-ArgbBitmap $size $size
        try {
            $graphics = [System.Drawing.Graphics]::FromImage($output)
            try {
                $graphics.Clear([System.Drawing.Color]::Transparent)
                $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
                $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
                $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                $graphics.DrawImage($source, 0, 0, $size, $size)
            } finally {
                $graphics.Dispose()
            }
            Save-Png $output $outputPath
        } finally {
            $output.Dispose()
        }
    } finally {
        $source.Dispose()
    }
}

function Export-IconSheet([string]$sourcePath, [string[]]$names) {
    if ($names.Count -ne 9) { throw 'A 3x3 sheet requires exactly nine names.' }
    $sheet = [System.Drawing.Bitmap]::FromFile($sourcePath)
    try {
        if (($sheet.Width % 3) -ne 0 -or ($sheet.Height % 3) -ne 0) {
            throw "Sheet size must be divisible by 3: $sourcePath"
        }
        $cellWidth = [int]($sheet.Width / 3)
        $cellHeight = [int]($sheet.Height / 3)
        for ($index = 0; $index -lt 9; $index++) {
            $column = $index % 3
            $row = [Math]::Floor($index / 3)
            $rect = [System.Drawing.Rectangle]::new($column * $cellWidth, $row * $cellHeight, $cellWidth, $cellHeight)
            $cell = $sheet.Clone($rect, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
            try {
                $hiresPath = Join-Path $hiresIconRoot ($names[$index] + '.png')
                Save-Png $cell $hiresPath
                Save-ResizedSquare $hiresPath (Join-Path $runtimeIconRoot ($names[$index] + '.png')) 128
            } finally {
                $cell.Dispose()
            }
        }
    } finally {
        $sheet.Dispose()
    }
}

$shields = @(
    @{
        Id = 'thorn-oath-reprisal-shield'
        Source = 'thorn-oath-reprisal-shield-front-imagegen.png'
    },
    @{
        Id = 'star-eater-arcane-mirror-shield'
        Source = 'star-eater-arcane-mirror-shield-front-imagegen.png'
    }
)

foreach ($shield in $shields) {
    $prepared = Join-Path $preparedRoot ($shield.Id + '-equip.png')
    Save-NormalizedSquare (Join-Path $sourceRoot $shield.Source) $prepared 1024 0.90
    Save-ResizedSquare $prepared (Join-Path $preparedRoot ($shield.Id + '-icon.png')) 128
    Save-ResizedSquare $prepared (Join-Path $preparedRoot ($shield.Id + '-runtime.png')) 512
}

$thornIcons = @(
    'oathforged_rebuke_plate',
    'oathforged_return_lamella',
    'oathforged_blood_debt_channels',
    'oathforged_open_thorn_rim',
    'oathforged_judgment_spine',
    'oathforged_debt_seal_weight',
    'oathforged_counterforce_grip',
    'oathforged_pivot_harness',
    'oathforged_recoil_ratchet'
)
$starIcons = @(
    'starveil_arcane_glass',
    'starveil_prism_sink_layer',
    'starveil_overload_lattice',
    'starveil_quickphase_ring',
    'starveil_resistance_etcher',
    'starveil_long_eclipse_inscription',
    'starveil_aether_cushion_grip',
    'starveil_orbit_balance_harness',
    'starveil_reflux_capacitor'
)

Export-IconSheet (Join-Path $taskRoot 'icons\thorn-oath-craft-icons-sheet.png') $thornIcons
Export-IconSheet (Join-Path $taskRoot 'icons\star-eater-craft-icons-sheet.png') $starIcons

$assetCopies = @(
    @{ Source = Join-Path $preparedRoot 'thorn-oath-reprisal-shield-equip.png'; Destination = Join-Path $projectRoot 'assets\weapons\thorn-oath-reprisal-shield-equip.png' },
    @{ Source = Join-Path $preparedRoot 'star-eater-arcane-mirror-shield-equip.png'; Destination = Join-Path $projectRoot 'assets\weapons\star-eater-arcane-mirror-shield-equip.png' },
    @{ Source = Join-Path $preparedRoot 'thorn-oath-reprisal-shield-icon.png'; Destination = Join-Path $projectRoot 'assets\icons\shields\thorn-oath-reprisal-shield.png' },
    @{ Source = Join-Path $preparedRoot 'star-eater-arcane-mirror-shield-icon.png'; Destination = Join-Path $projectRoot 'assets\icons\shields\star-eater-arcane-mirror-shield.png' },
    @{ Source = Join-Path $preparedRoot 'thorn-oath-reprisal-shield-runtime.png'; Destination = Join-Path $projectRoot 'assets\weapons\runtime\weapons\thorn-oath-reprisal-shield-equip.png' },
    @{ Source = Join-Path $preparedRoot 'star-eater-arcane-mirror-shield-runtime.png'; Destination = Join-Path $projectRoot 'assets\weapons\runtime\weapons\star-eater-arcane-mirror-shield-equip.png' }
)
foreach ($copy in $assetCopies) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $copy.Destination) | Out-Null
    Copy-Item -LiteralPath $copy.Source -Destination $copy.Destination -Force
}

foreach ($name in @($thornIcons + $starIcons)) {
    $source = Join-Path $runtimeIconRoot ($name + '.png')
    $destinations = @(
        (Join-Path $projectRoot ('assets\icons\craft-shields\' + $name + '.png')),
        (Join-Path $projectRoot ('assets\ui\runtime-icons\icons\craft-shields\' + $name + '.png'))
    )
    foreach ($destination in $destinations) {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
        Copy-Item -LiteralPath $source -Destination $destination -Force
    }
}

Write-Output 'Prepared 2 formal shields and 18 craft icons.'
