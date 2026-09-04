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
    if ($maxX -lt $minX -or $maxY -lt $minY) { throw 'Image has no visible pixels.' }
    return [System.Drawing.Rectangle]::new($minX, $minY, $maxX - $minX + 1, $maxY - $minY + 1)
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

function Remove-Checkerboard([string]$sourcePath, [string]$outputPath) {
    & $pythonExe $checkerTool --input $sourcePath --out $outputPath --size 1024 --margin 88 --fill-subject-holes
    if ($LASTEXITCODE -ne 0) { throw "Checkerboard cutout failed: $sourcePath" }
}

function Export-OpaqueIconSheet([string]$sheetPath, [string[]]$names) {
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
            $rect = [System.Drawing.Rectangle]::new(
                $column * $cellWidth,
                $row * $cellHeight,
                $cellWidth,
                $cellHeight
            )
            $cell = $sheet.Clone($rect, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
            $cellPath = Join-Path $iconCellRoot ($names[$index] + '.png')
            try { Save-Png $cell $cellPath } finally { $cell.Dispose() }
            Save-ResizedSquare $cellPath (Join-Path $icon128Root ($names[$index] + '.png')) 128
        }
    } finally { $sheet.Dispose() }
}

$shieldJobs = @(
    @{
        Slug = 'reverse-fate-doomwheel-shield'
        Guard = 'reverse-fate-doomwheel-shield-guard-raw.png'
        Front = 'reverse-fate-doomwheel-shield-front-raw.png'
        Back = 'reverse-fate-doomwheel-shield-back-raw.png'
    },
    @{
        Slug = 'last-oath-sanctum-gate-shield'
        Guard = 'last-oath-sanctum-gate-shield-guard-raw.png'
        Front = 'last-oath-sanctum-gate-shield-front-raw.png'
        Back = 'last-oath-sanctum-gate-shield-back-raw.png'
    }
)

foreach ($job in $shieldJobs) {
    $guardOut = Join-Path $cleanRoot ($job.Slug + '-guard.png')
    $frontOut = Join-Path $cleanRoot ($job.Slug + '-equip.png')
    $backOut = Join-Path $backRoot ($job.Slug + '-back.png')
    Remove-Checkerboard (Join-Path $sourceRoot $job.Guard) $guardOut
    Remove-Checkerboard (Join-Path $sourceRoot $job.Front) $frontOut
    Remove-Checkerboard (Join-Path $sourceRoot $job.Back) $backOut
    Copy-Item -LiteralPath $guardOut -Destination (Join-Path $inventoryRoot ($job.Slug + '.png')) -Force

    $formalGuard = Join-Path $projectRoot ('assets\weapons\guards\' + $job.Slug + '-guard.png')
    $formalFront = Join-Path $projectRoot ('assets\weapons\' + $job.Slug + '-equip.png')
    foreach ($copy in @(
        @{ Source = $guardOut; Destination = $formalGuard },
        @{ Source = $frontOut; Destination = $formalFront }
    )) {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $copy.Destination) | Out-Null
        Copy-Item -LiteralPath $copy.Source -Destination $copy.Destination -Force
    }
    Save-ResizedSquare $guardOut (Join-Path $projectRoot ('assets\icons\shields\' + $job.Slug + '.png')) 128
    Save-ResizedSquare $guardOut (Join-Path $projectRoot ('assets\weapons\runtime\weapons\guards\' + $job.Slug + '-guard.png')) 512
    Save-ResizedSquare $frontOut (Join-Path $projectRoot ('assets\weapons\runtime\weapons\' + $job.Slug + '-equip.png')) 512
}

$doomwheelIcons = @(
    'doomwheel_temporal_bulwark_plate',
    'doomwheel_debt_absorption_membrane',
    'doomwheel_safe_release_lamella',
    'doomwheel_mercy_timing_ring',
    'doomwheel_long_grace_ring',
    'doomwheel_accelerated_repayment_ring',
    'doomwheel_hourglass_counterweight_grip',
    'doomwheel_reinforced_forearm_strap',
    'doomwheel_emergency_settlement_ratchet'
)
$oathgateIcons = @(
    'oathgate_bastion_ceramite_plate',
    'oathgate_dissipation_tile',
    'oathgate_reserve_capacitor_crystal',
    'oathgate_wide_sanctum_lens',
    'oathgate_enduring_oath_prism',
    'oathgate_high_flux_mercy_core',
    'oathgate_quick_release_latch',
    'oathgate_marching_buttress_strap',
    'oathgate_reserve_pump_grip'
)

Export-OpaqueIconSheet (Join-Path $iconSheetRoot 'reverse-fate-craft-icons-sheet.png') $doomwheelIcons
Export-OpaqueIconSheet (Join-Path $iconSheetRoot 'last-oath-craft-icons-sheet.png') $oathgateIcons

foreach ($name in @($doomwheelIcons + $oathgateIcons)) {
    $source = Join-Path $icon128Root ($name + '.png')
    foreach ($destination in @(
        (Join-Path $projectRoot ('assets\icons\craft-shields\' + $name + '.png')),
        (Join-Path $projectRoot ('assets\ui\runtime-icons\icons\craft-shields\' + $name + '.png'))
    )) {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
        Copy-Item -LiteralPath $source -Destination $destination -Force
    }
}

$contactItems = @(
    @{ Label = 'weapon64 guard exterior 42deg'; Path = Join-Path $cleanRoot 'reverse-fate-doomwheel-shield-guard.png' },
    @{ Label = 'weapon64 front presentation'; Path = Join-Path $cleanRoot 'reverse-fate-doomwheel-shield-equip.png' },
    @{ Label = 'weapon64 rear reference'; Path = Join-Path $backRoot 'reverse-fate-doomwheel-shield-back.png' },
    @{ Label = 'weapon64 inventory 128'; Path = Join-Path $projectRoot 'assets\icons\shields\reverse-fate-doomwheel-shield.png' },
    @{ Label = 'weapon65 guard exterior 42deg'; Path = Join-Path $cleanRoot 'last-oath-sanctum-gate-shield-guard.png' },
    @{ Label = 'weapon65 front presentation'; Path = Join-Path $cleanRoot 'last-oath-sanctum-gate-shield-equip.png' },
    @{ Label = 'weapon65 rear reference'; Path = Join-Path $backRoot 'last-oath-sanctum-gate-shield-back.png' },
    @{ Label = 'weapon65 inventory 128'; Path = Join-Path $projectRoot 'assets\icons\shields\last-oath-sanctum-gate-shield.png' }
)
$contact = New-ArgbBitmap 2048 1024
try {
    $graphics = [System.Drawing.Graphics]::FromImage($contact)
    try {
        $graphics.Clear([System.Drawing.Color]::FromArgb(255, 20, 25, 28))
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $font = [System.Drawing.Font]::new('Segoe UI', 16, [System.Drawing.FontStyle]::Bold)
        try {
            for ($index = 0; $index -lt $contactItems.Count; $index++) {
                $column = $index % 4
                $row = [Math]::Floor($index / 4)
                $x = $column * 512
                $y = $row * 512
                $graphics.DrawString($contactItems[$index].Label, $font, [System.Drawing.Brushes]::Gainsboro, $x + 14, $y + 14)
                $image = [System.Drawing.Bitmap]::FromFile($contactItems[$index].Path)
                try { $graphics.DrawImage($image, $x + 38, $y + 55, 436, 436) } finally { $image.Dispose() }
            }
        } finally { $font.Dispose() }
    } finally { $graphics.Dispose() }
    Save-Png $contact (Join-Path $formalRoot 'view-contact-sheet.png')
} finally { $contact.Dispose() }

$report = @()
foreach ($job in $shieldJobs) {
    $guardPath = Join-Path $cleanRoot ($job.Slug + '-guard.png')
    $image = [System.Drawing.Bitmap]::FromFile($guardPath)
    try {
        $bounds = Get-AlphaBounds $image
        $report += [pscustomobject]@{
            slug = $job.Slug
            alphaBounds = @($bounds.X, $bounds.Y, $bounds.Width, $bounds.Height)
            visibleHeightRatio = [Math]::Round($bounds.Height / 1024, 8)
        }
    } finally { $image.Dispose() }
}
$report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $formalRoot 'asset-report.json') -Encoding UTF8

Write-Output 'Prepared 2 legendary shield view sets and 18 craft icons.'
