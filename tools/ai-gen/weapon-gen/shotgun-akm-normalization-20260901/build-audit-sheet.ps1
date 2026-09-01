[CmdletBinding()]
param(
    [string]$OutputName = 'audit-current-grips.png'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
$configPath = Join-Path $projectRoot 'public\data\weapon-anim-config.json'
$config = Get-Content -LiteralPath $configPath -Raw -Encoding utf8 | ConvertFrom-Json

$entries = @(
    [pscustomobject]@{ Label = 'Super90'; Grip = 'weapon_super90'; Runtime = 'assets\weapons\runtime\icons\M4s90_icon.png' },
    [pscustomobject]@{ Label = 'Saiga-12K'; Grip = 'weapon_saiga12k'; Runtime = 'assets\weapons\runtime\icons\S12k-icon.png' },
    [pscustomobject]@{ Label = 'S686'; Grip = 'weapon_s686'; Runtime = 'assets\weapons\runtime\weapons\s686-equip.png' },
    [pscustomobject]@{ Label = 'M870 Breacher'; Grip = 'weapon_m870_breacher'; Runtime = 'assets\weapons\runtime\weapons\m870-breacher-equip.png' },
    [pscustomobject]@{ Label = 'KSG-12'; Grip = 'weapon_ksg12'; Runtime = 'assets\weapons\runtime\weapons\ksg12-equip.png' },
    [pscustomobject]@{ Label = 'SPAS-12'; Grip = 'weapon_spas12'; Runtime = 'assets\weapons\runtime\weapons\spas12-equip.png' },
    [pscustomobject]@{ Label = 'AA-12'; Grip = 'weapon_aa12'; Runtime = 'assets\weapons\runtime\weapons\aa12-equip.png' },
    [pscustomobject]@{ Label = 'Winchester 1887'; Grip = 'weapon_winchester1887'; Runtime = 'assets\weapons\runtime\weapons\winchester1887-equip.png' },
    [pscustomobject]@{ Label = 'Terminus Pendulum'; Grip = 'weapon_terminus_pendulum'; Runtime = 'assets\weapons\runtime\weapons\terminus-pendulum-equip.png' },
    [pscustomobject]@{ Label = 'Void Funeral Tide'; Grip = 'weapon_void_funeral_tide'; Runtime = 'assets\weapons\runtime\weapons\void-funeral-tide-equip.png' },
    [pscustomobject]@{ Label = 'Black Sun Verdict'; Grip = 'weapon_black_sun_verdict'; Runtime = 'assets\weapons\runtime\weapons\black-sun-verdict-equip.png' },
    [pscustomobject]@{ Label = 'Royal Hunt Finale'; Grip = 'weapon_royal_hunt_finale'; Runtime = 'assets\weapons\runtime\weapons\royal-hunt-finale-equip.png' }
)

$columns = 4
$rows = 3
$cellWidth = 576
$cellHeight = 620
$imageOffsetX = 32
$imageOffsetY = 48
$imageSize = 512
$sheet = [System.Drawing.Bitmap]::new($columns * $cellWidth, $rows * $cellHeight)
$graphics = [System.Drawing.Graphics]::FromImage($sheet)
$labelFont = [System.Drawing.Font]::new('Segoe UI', 18, [System.Drawing.FontStyle]::Bold)
$detailFont = [System.Drawing.Font]::new('Consolas', 13, [System.Drawing.FontStyle]::Regular)
$limePen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 94, 255, 72), 4)
$centerPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(120, 87, 185, 255), 1)
$borderPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 74, 84, 98), 2)
$labelBrush = [System.Drawing.Brushes]::White
$detailBrush = [System.Drawing.Brushes]::LightGray

try {
    $graphics.Clear([System.Drawing.Color]::FromArgb(255, 31, 36, 44))
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half

    for ($index = 0; $index -lt $entries.Count; $index++) {
        $entry = $entries[$index]
        $column = $index % $columns
        $row = [Math]::Floor($index / $columns)
        $cellX = $column * $cellWidth
        $cellY = $row * $cellHeight
        $imageX = $cellX + $imageOffsetX
        $imageY = $cellY + $imageOffsetY

        $graphics.DrawRectangle($borderPen, $cellX + 1, $cellY + 1, $cellWidth - 2, $cellHeight - 2)
        $runtimePath = Join-Path $projectRoot $entry.Runtime
        $weapon = [System.Drawing.Bitmap]::new($runtimePath)
        try {
            $graphics.DrawImage($weapon, $imageX, $imageY, $imageSize, $imageSize)
        }
        finally {
            $weapon.Dispose()
        }

        $graphics.DrawLine($centerPen, $imageX + 256, $imageY, $imageX + 256, $imageY + 512)
        $graphics.DrawLine($centerPen, $imageX, $imageY + 271.5, $imageX + 512, $imageY + 271.5)

        $grip = $config.shotgun.textureGrips.($entry.Grip)
        $gripX = $imageX + ([double]$grip.x * $imageSize)
        $gripY = $imageY + ([double]$grip.y * $imageSize)
        $graphics.DrawEllipse($limePen, [single]($gripX - 10), [single]($gripY - 10), 20, 20)
        $graphics.DrawLine($limePen, [single]($gripX - 15), [single]$gripY, [single]($gripX + 15), [single]$gripY)
        $graphics.DrawLine($limePen, [single]$gripX, [single]($gripY - 15), [single]$gripX, [single]($gripY + 15))

        $graphics.DrawString($entry.Label, $labelFont, $labelBrush, $cellX + 24, $cellY + 566)
        $graphics.DrawString(
            ('grip {0:0.000}, {1:0.000}' -f [double]$grip.x, [double]$grip.y),
            $detailFont,
            $detailBrush,
            $cellX + 300,
            $cellY + 570
        )
    }

    $outputPath = Join-Path $PSScriptRoot $OutputName
    $sheet.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Output $outputPath
}
finally {
    $limePen.Dispose()
    $centerPen.Dispose()
    $borderPen.Dispose()
    $labelFont.Dispose()
    $detailFont.Dispose()
    $graphics.Dispose()
    $sheet.Dispose()
}
