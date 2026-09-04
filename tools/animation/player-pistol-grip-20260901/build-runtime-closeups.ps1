[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$shotRoot = Join-Path $projectRoot 'tools\verify-shots\pistol-grip-runtime-20260901'
$entries = @(
    [pscustomobject]@{ Label='G18'; Key='pistol' },
    [pscustomobject]@{ Label='Desert Eagle'; Key='deagle' },
    [pscustomobject]@{ Label='.357 Revolver'; Key='revolver' },
    [pscustomobject]@{ Label='P4040'; Key='p4040' },
    [pscustomobject]@{ Label='Beretta 93R'; Key='beretta93r' },
    [pscustomobject]@{ Label='M1911A1'; Key='m1911a1' },
    [pscustomobject]@{ Label='USP .45'; Key='usp45' },
    [pscustomobject]@{ Label='FN Five-seveN'; Key='fiveSeven' },
    [pscustomobject]@{ Label='Eternal Edict'; Key='eternalEdict' },
    [pscustomobject]@{ Label='Falcon Edict'; Key='falconEdict' },
    [pscustomobject]@{ Label='Crimson Crown'; Key='crimsonCrownSettlement' },
    [pscustomobject]@{ Label='Myriad Corridor'; Key='myriadCorridor' }
)

foreach ($mode in @('single', 'dual')) {
    $columns = 4
    $rows = 3
    $cellWidth = 480
    $cellHeight = 460
    $sheet = [System.Drawing.Bitmap]::new($columns * $cellWidth, $rows * $cellHeight)
    $graphics = [System.Drawing.Graphics]::FromImage($sheet)
    $graphics.Clear([System.Drawing.Color]::FromArgb(255, 31, 36, 44))
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
    $font = [System.Drawing.Font]::new('Segoe UI', 18, [System.Drawing.FontStyle]::Bold)
    $border = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 74, 84, 98), 2)
    try {
        for ($index = 0; $index -lt $entries.Count; $index++) {
            $entry = $entries[$index]
            $x = ($index % $columns) * $cellWidth
            $y = [Math]::Floor($index / $columns) * $cellHeight
            $sourcePath = Join-Path $shotRoot "$($entry.Key)_${mode}_right_level.png"
            if (-not (Test-Path -LiteralPath $sourcePath)) { throw "Missing screenshot: $sourcePath" }
            $source = [System.Drawing.Bitmap]::new($sourcePath)
            try {
                $sourceRect = [System.Drawing.Rectangle]::new(150, 35, 260, 235)
                $destRect = [System.Drawing.Rectangle]::new($x + 12, $y + 42, 456, 411)
                $graphics.DrawRectangle($border, $x + 1, $y + 1, $cellWidth - 2, $cellHeight - 2)
                $graphics.DrawString("$($entry.Label) | $mode", $font, [System.Drawing.Brushes]::White, $x + 12, $y + 8)
                $graphics.DrawImage($source, $destRect, $sourceRect, [System.Drawing.GraphicsUnit]::Pixel)
            } finally {
                $source.Dispose()
            }
        }
    } finally {
        $graphics.Dispose()
        $font.Dispose()
        $border.Dispose()
    }
    $outputPath = Join-Path $PSScriptRoot "runtime-${mode}-closeups.png"
    $sheet.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $sheet.Dispose()
    Write-Output $outputPath
}
