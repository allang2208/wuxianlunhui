param()

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$taskRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = $taskRoot
for ($i = 0; $i -lt 4; $i++) { $projectRoot = Split-Path -Parent $projectRoot }

$sourceRoot = Join-Path $taskRoot 'source'
$iconSheetRoot = Join-Path $taskRoot 'icons'
$formalRoot = Join-Path $taskRoot 'formal'
$cleanRoot = Join-Path $formalRoot 'clean-1024'
$backRoot = Join-Path $formalRoot 'back-reference'
$inventoryRoot = Join-Path $formalRoot 'inventory-master'
$iconCellRoot = Join-Path $formalRoot 'icon-cells-512'
$icon128Root = Join-Path $formalRoot 'icons-128'
$checkerTool = Join-Path $projectRoot 'tools\ai-gen\_mouse_blacksmith_standing_20260829\strip-checkerboard-alpha-fill-holes.py'
$pythonExe = Join-Path (Split-Path -Parent $projectRoot) 'ComfyUI\.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonExe)) { $pythonExe = 'py' }

@($cleanRoot, $backRoot, $inventoryRoot, $iconCellRoot, $icon128Root) | ForEach-Object {
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
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
    $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
}

function Get-AlphaBounds([System.Drawing.Bitmap]$bitmap) {
    $minX = $bitmap.Width
    $minY = $bitmap.Height
    $maxX = -1
    $maxY = -1
    for ($y = 0; $y -lt $bitmap.Height; $y++) {
        for ($x = 0; $x -lt $bitmap.Width; $x++) {
            if ($bitmap.GetPixel($x, $y).A -le 8) { continue }
            if ($x -lt $minX) { $minX = $x }
            if ($y -lt $minY) { $minY = $y }
            if ($x -gt $maxX) { $maxX = $x }
            if ($y -gt $maxY) { $maxY = $y }
        }
    }
    if ($maxX -lt $minX -or $maxY -lt $minY) { throw "Image has no visible pixels." }
    return [System.Drawing.Rectangle]::new($minX, $minY, $maxX - $minX + 1, $maxY - $minY + 1)
}

function Save-NormalizedSquare([string]$sourcePath, [string]$outputPath, [int]$size, [int]$margin) {
    $source = [System.Drawing.Bitmap]::FromFile($sourcePath)
    try {
        $bounds = Get-AlphaBounds $source
        $available = $size - 2 * $margin
        $scale = [Math]::Min($available / $bounds.Width, $available / $bounds.Height)
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
            } finally { $graphics.Dispose() }
            Save-Png $output $outputPath
        } finally { $output.Dispose() }
    } finally { $source.Dispose() }
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
            } finally { $graphics.Dispose() }
            Save-Png $output $outputPath
        } finally { $output.Dispose() }
    } finally { $source.Dispose() }
}

function Remove-Checkerboard([string]$sourcePath, [string]$outputPath, [int]$size, [int]$margin) {
    & $pythonExe $checkerTool --input $sourcePath --out $outputPath --size $size --margin $margin --fill-subject-holes
    if ($LASTEXITCODE -ne 0) { throw "Checkerboard cutout failed: $sourcePath" }
}

function Export-IconSheet([string]$sheetPath, [string[]]$names) {
    if ($names.Count -ne 9) { throw 'A 3x3 sheet requires exactly nine names.' }
    $sheet = [System.Drawing.Bitmap]::FromFile($sheetPath)
    try {
        if (($sheet.Width % 3) -ne 0 -or ($sheet.Height % 3) -ne 0) {
            throw "Sheet size must be divisible by 3: $sheetPath"
        }
        $cellWidth = [int]($sheet.Width / 3)
        $cellHeight = [int]($sheet.Height / 3)
        for ($index = 0; $index -lt 9; $index++) {
            $column = $index % 3
            $row = [Math]::Floor($index / 3)
            $rect = [System.Drawing.Rectangle]::new($column * $cellWidth, $row * $cellHeight, $cellWidth, $cellHeight)
            $rawCell = $sheet.Clone($rect, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
            $rawPath = Join-Path $iconCellRoot ($names[$index] + '-raw.png')
            $cleanPath = Join-Path $iconCellRoot ($names[$index] + '.png')
            try { Save-Png $rawCell $rawPath } finally { $rawCell.Dispose() }
            Remove-Checkerboard $rawPath $cleanPath 512 30
            Save-ResizedSquare $cleanPath (Join-Path $icon128Root ($names[$index] + '.png')) 128
        }
    } finally { $sheet.Dispose() }
}

function New-ViewContactSheet() {
    $items = @(
        @{ Label = 'weapon62 guard exterior 42deg'; Path = Join-Path $cleanRoot 'heaven-pillar-returning-bulwark-guard.png' },
        @{ Label = 'weapon62 front presentation'; Path = Join-Path $cleanRoot 'heaven-pillar-returning-bulwark-equip.png' },
        @{ Label = 'weapon62 rear reference'; Path = Join-Path $backRoot 'heaven-pillar-returning-bulwark-back.png' },
        @{ Label = 'weapon63 guard exterior 42deg'; Path = Join-Path $cleanRoot 'abyss-return-star-devouring-mirror-guard.png' },
        @{ Label = 'weapon63 front presentation'; Path = Join-Path $cleanRoot 'abyss-return-star-devouring-mirror-equip.png' },
        @{ Label = 'weapon63 rear reference'; Path = Join-Path $backRoot 'abyss-return-star-devouring-mirror-back.png' }
    )
    $sheet = New-ArgbBitmap 1536 1024
    try {
        $graphics = [System.Drawing.Graphics]::FromImage($sheet)
        try {
            $graphics.Clear([System.Drawing.Color]::FromArgb(255, 20, 25, 28))
            $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
            $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $font = [System.Drawing.Font]::new('Segoe UI', 18, [System.Drawing.FontStyle]::Bold)
            $brush = [System.Drawing.Brushes]::Gainsboro
            try {
                for ($index = 0; $index -lt $items.Count; $index++) {
                    $column = $index % 3
                    $row = [Math]::Floor($index / 3)
                    $x = $column * 512
                    $y = $row * 512
                    $graphics.DrawString($items[$index].Label, $font, $brush, $x + 20, $y + 16)
                    $image = [System.Drawing.Bitmap]::FromFile($items[$index].Path)
                    try { $graphics.DrawImage($image, $x + 35, $y + 56, 442, 442) } finally { $image.Dispose() }
                }
            } finally { $font.Dispose() }
        } finally { $graphics.Dispose() }
        Save-Png $sheet (Join-Path $formalRoot 'view-contact-sheet.png')
    } finally { $sheet.Dispose() }
}

$shieldJobs = @(
    @{
        Slug = 'heaven-pillar-returning-bulwark'
        Guard = 'heaven-pillar-returning-bulwark-guard-raw.png'
        Front = 'heaven-pillar-returning-bulwark-front-raw.png'
        Back = 'heaven-pillar-returning-bulwark-back-raw.png'
        FrontHasAlpha = $true
    },
    @{
        Slug = 'abyss-return-star-devouring-mirror'
        Guard = 'abyss-return-star-devouring-mirror-guard-raw.png'
        Front = 'abyss-return-star-devouring-mirror-front-raw.png'
        Back = 'abyss-return-star-devouring-mirror-back-raw.png'
        FrontHasAlpha = $false
    }
)

foreach ($job in $shieldJobs) {
    $guardOut = Join-Path $cleanRoot ($job.Slug + '-guard.png')
    $frontOut = Join-Path $cleanRoot ($job.Slug + '-equip.png')
    $backOut = Join-Path $backRoot ($job.Slug + '-back.png')
    Remove-Checkerboard (Join-Path $sourceRoot $job.Guard) $guardOut 1024 88
    if ($job.FrontHasAlpha) {
        Save-NormalizedSquare (Join-Path $sourceRoot $job.Front) $frontOut 1024 88
    } else {
        Remove-Checkerboard (Join-Path $sourceRoot $job.Front) $frontOut 1024 88
    }
    Remove-Checkerboard (Join-Path $sourceRoot $job.Back) $backOut 1024 88
    Copy-Item -LiteralPath $guardOut -Destination (Join-Path $inventoryRoot ($job.Slug + '.png')) -Force

    $assetCopies = @(
        @{ Source = $guardOut; Destination = Join-Path $projectRoot ('assets\weapons\guards\' + $job.Slug + '-guard.png') },
        @{ Source = $frontOut; Destination = Join-Path $projectRoot ('assets\weapons\' + $job.Slug + '-equip.png') }
    )
    foreach ($copy in $assetCopies) {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $copy.Destination) | Out-Null
        Copy-Item -LiteralPath $copy.Source -Destination $copy.Destination -Force
    }
    Save-ResizedSquare $guardOut (Join-Path $projectRoot ('assets\icons\shields\' + $job.Slug + '.png')) 128
    Save-ResizedSquare $guardOut (Join-Path $projectRoot ('assets\weapons\runtime\weapons\guards\' + $job.Slug + '-guard.png')) 512
    Save-ResizedSquare $frontOut (Join-Path $projectRoot ('assets\weapons\runtime\weapons\' + $job.Slug + '-equip.png')) 512
}

$heavenIcons = @(
    'heavenpillar_layered_bulwark_plate',
    'heavenpillar_dissipation_lamella',
    'heavenpillar_fast_return_rune',
    'heavenpillar_long_return_ring',
    'heavenpillar_reverse_time_ring',
    'heavenpillar_mountain_ram_spine',
    'heavenpillar_hydraulic_breath_grip',
    'heavenpillar_marching_suspension',
    'heavenpillar_reset_winch'
)
$abyssIcons = @(
    'abyssmirror_singularity_armor_petal',
    'abyssmirror_star_devouring_membrane',
    'abyssmirror_absolute_zero_coating',
    'abyssmirror_expanded_horizon_ring',
    'abyssmirror_fast_collapse_ring',
    'abyssmirror_deep_well_reservoir',
    'abyssmirror_phase_support_strap',
    'abyssmirror_antimass_grip',
    'abyssmirror_observation_reset_ratchet'
)

Export-IconSheet (Join-Path $iconSheetRoot 'heaven-pillar-craft-icons-sheet.png') $heavenIcons
Export-IconSheet (Join-Path $iconSheetRoot 'abyss-return-craft-icons-sheet.png') $abyssIcons

foreach ($name in @($heavenIcons + $abyssIcons)) {
    $source = Join-Path $icon128Root ($name + '.png')
    foreach ($destination in @(
        (Join-Path $projectRoot ('assets\icons\craft-shields\' + $name + '.png')),
        (Join-Path $projectRoot ('assets\ui\runtime-icons\icons\craft-shields\' + $name + '.png'))
    )) {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
        Copy-Item -LiteralPath $source -Destination $destination -Force
    }
}

New-ViewContactSheet

Write-Output 'Prepared 2 mythic shield view sets and 18 craft icons.'
