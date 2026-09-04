[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$configPath = Join-Path $projectRoot 'public\data\weapon-anim-config.json'
$config = Get-Content -LiteralPath $configPath -Raw -Encoding utf8 | ConvertFrom-Json

$entries = @(
    [pscustomobject]@{ Label='G18'; Config='pistol'; Texture='weapon_g18'; Runtime='assets\weapons\runtime\icons\G18icon.png' },
    [pscustomobject]@{ Label='Desert Eagle'; Config='deagle'; Texture='weapon_deagle'; Runtime='assets\weapons\runtime\icons\DesertEagle_icon.png' },
    [pscustomobject]@{ Label='.357 Revolver'; Config='revolver'; Texture='weapon_revolver357'; Runtime='assets\weapons\runtime\weapons\revolver357-equip.png' },
    [pscustomobject]@{ Label='P4040'; Config='p4040'; Texture='weapon_p4040'; Runtime='assets\weapons\runtime\weapons\P4040-icon.png' },
    [pscustomobject]@{ Label='Beretta 93R'; Config='beretta93r'; Texture='weapon_beretta93r'; Runtime='assets\weapons\runtime\weapons\beretta93r.png' },
    [pscustomobject]@{ Label='M1911A1'; Config='m1911a1'; Texture='weapon_m1911a1'; Runtime='assets\weapons\runtime\weapons\m1911a1-equip.png' },
    [pscustomobject]@{ Label='USP .45'; Config='usp45'; Texture='weapon_usp45'; Runtime='assets\weapons\runtime\weapons\usp45-equip.png' },
    [pscustomobject]@{ Label='FN Five-seveN'; Config='fiveSeven'; Texture='weapon_five_seven'; Runtime='assets\weapons\runtime\weapons\five-seven-equip.png' },
    [pscustomobject]@{ Label='Eternal Edict'; Config='eternalEdict'; Texture='weapon_eternal_edict'; Runtime='assets\weapons\runtime\weapons\eternal-edict-equip.png' },
    [pscustomobject]@{ Label='Falcon Edict'; Config='falconEdict'; Texture='weapon_falcon_edict'; Runtime='assets\weapons\runtime\weapons\falcon-edict-equip.png' },
    [pscustomobject]@{ Label='Crimson Crown'; Config='crimsonCrownSettlement'; Texture='weapon_crimson_crown_settlement'; Runtime='assets\weapons\runtime\weapons\crimson-crown-settlement-equip.png' },
    [pscustomobject]@{ Label='Myriad Corridor'; Config='myriadCorridor'; Texture='weapon_myriad_corridor'; Runtime='assets\weapons\runtime\weapons\myriad-corridor-equip.png' }
)

function Get-AlphaMetrics($bitmap, $grip) {
    $minX = $bitmap.Width
    $minY = $bitmap.Height
    $maxX = -1
    $maxY = -1
    $gripX = [double]$grip.x * $bitmap.Width
    $gripY = [double]$grip.y * $bitmap.Height
    $nearest = [double]::PositiveInfinity
    $nearestX = 0
    $nearestY = 0
    for ($y = 0; $y -lt $bitmap.Height; $y++) {
        for ($x = 0; $x -lt $bitmap.Width; $x++) {
            if ($bitmap.GetPixel($x, $y).A -le 16) { continue }
            if ($x -lt $minX) { $minX = $x }
            if ($x -gt $maxX) { $maxX = $x }
            if ($y -lt $minY) { $minY = $y }
            if ($y -gt $maxY) { $maxY = $y }
            $distance = [Math]::Sqrt(($x - $gripX) * ($x - $gripX) + ($y - $gripY) * ($y - $gripY))
            if ($distance -lt $nearest) {
                $nearest = $distance
                $nearestX = $x
                $nearestY = $y
            }
        }
    }
    if ($maxX -lt $minX -or $maxY -lt $minY) { throw 'Weapon texture has no visible alpha content' }
    $width = $maxX - $minX + 1
    $height = $maxY - $minY + 1
    return [pscustomobject]@{
        x = $minX
        y = $minY
        width = $width
        height = $height
        centerX = [Math]::Round(($minX + $maxX) / 2 / $bitmap.Width, 6)
        centerY = [Math]::Round(($minY + $maxY) / 2 / $bitmap.Height, 6)
        contentWidthRatio = [Math]::Round($width / [double]$bitmap.Width, 6)
        contentHeightRatio = [Math]::Round($height / [double]$bitmap.Height, 6)
        nearestAlphaPx = [Math]::Round($nearest, 3)
        nearestAlphaPoint = [pscustomobject]@{
            x = $nearestX
            y = $nearestY
            fx = [Math]::Round($nearestX / [double]$bitmap.Width, 6)
            fy = [Math]::Round($nearestY / [double]$bitmap.Height, 6)
        }
    }
}

function Draw-Marker($graphics, $pen, $x, $y) {
    $graphics.DrawEllipse($pen, [single]($x - 10), [single]($y - 10), 20, 20)
    $graphics.DrawLine($pen, [single]($x - 15), [single]$y, [single]($x + 15), [single]$y)
    $graphics.DrawLine($pen, [single]$x, [single]($y - 15), [single]$x, [single]($y + 15))
}

$columns = 4
$rows = 3
$cellWidth = 576
$cellHeight = 620
$sheet = [System.Drawing.Bitmap]::new($columns * $cellWidth, $rows * $cellHeight)
$graphics = [System.Drawing.Graphics]::FromImage($sheet)
$graphics.Clear([System.Drawing.Color]::FromArgb(255, 31, 36, 44))
$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
$labelFont = [System.Drawing.Font]::new('Segoe UI', 17, [System.Drawing.FontStyle]::Bold)
$detailFont = [System.Drawing.Font]::new('Consolas', 12, [System.Drawing.FontStyle]::Regular)
$gripPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 94, 255, 72), 4)
$nearestPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 255, 190, 48), 3)
$bboxPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 226, 92, 255), 2)
$borderPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 74, 84, 98), 2)
$reports = [System.Collections.Generic.List[object]]::new()

try {
    for ($index = 0; $index -lt $entries.Count; $index++) {
        $entry = $entries[$index]
        $column = $index % $columns
        $row = [Math]::Floor($index / $columns)
        $cellX = $column * $cellWidth
        $cellY = $row * $cellHeight
        $imageX = $cellX + 32
        $imageY = $cellY + 48
        $graphics.DrawRectangle($borderPen, $cellX + 1, $cellY + 1, $cellWidth - 2, $cellHeight - 2)
        $weaponConfig = $config.($entry.Config)
        $grip = $weaponConfig.grip
        $scale = [double]$weaponConfig.idleScale
        $bitmap = [System.Drawing.Bitmap]::new((Join-Path $projectRoot $entry.Runtime))
        try {
            $metrics = Get-AlphaMetrics $bitmap $grip
            $graphics.DrawImage($bitmap, $imageX, $imageY, 512, 512)
            $graphics.DrawRectangle($bboxPen, $imageX + $metrics.x, $imageY + $metrics.y, $metrics.width, $metrics.height)
            Draw-Marker $graphics $gripPen ($imageX + [double]$grip.x * 512) ($imageY + [double]$grip.y * 512)
            Draw-Marker $graphics $nearestPen ($imageX + $metrics.nearestAlphaPoint.x) ($imageY + $metrics.nearestAlphaPoint.y)
            $effectiveWidth = [Math]::Round($metrics.contentWidthRatio * 126.0 * $scale, 3)
            $effectiveHeight = [Math]::Round($metrics.contentHeightRatio * 126.0 * $scale, 3)
            $graphics.DrawString($entry.Label, $labelFont, [System.Drawing.Brushes]::White, $cellX + 12, $cellY + 10)
            $graphics.DrawString(
                "grip=$([double]$grip.x),$([double]$grip.y) alpha=$($metrics.nearestAlphaPx)px size=${effectiveWidth}x${effectiveHeight}",
                $detailFont,
                [System.Drawing.Brushes]::White,
                $cellX + 12,
                $cellY + 570
            )
            $reports.Add([pscustomobject]@{
                label = $entry.Label
                config = $entry.Config
                texture = $entry.Texture
                runtime = $entry.Runtime
                grip = [pscustomobject]@{ x = [double]$grip.x; y = [double]$grip.y }
                idleScale = $scale
                alpha = $metrics
                effectiveWorldWidth = $effectiveWidth
                effectiveWorldHeight = $effectiveHeight
            })
        } finally {
            $bitmap.Dispose()
        }
    }
} finally {
    $graphics.Dispose()
    $labelFont.Dispose()
    $detailFont.Dispose()
    $gripPen.Dispose()
    $nearestPen.Dispose()
    $bboxPen.Dispose()
    $borderPen.Dispose()
}

$sheetPath = Join-Path $PSScriptRoot 'pistol-grip-alpha-audit.png'
$sheet.Save($sheetPath, [System.Drawing.Imaging.ImageFormat]::Png)
$sheet.Dispose()
$reportPath = Join-Path $PSScriptRoot 'pistol-grip-alpha-audit.json'
[pscustomobject]@{
    reference = 'Desert Eagle is the accepted runtime placement and scale baseline.'
    markerLegend = [pscustomobject]@{ green = 'configured grip'; orange = 'nearest opaque pixel'; magenta = 'alpha bounds' }
    entries = $reports
} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding utf8
Write-Output $sheetPath
Write-Output $reportPath
