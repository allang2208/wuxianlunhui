[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$shotRoot = Join-Path $projectRoot 'tools\verify-shots\gun-ads-runtime-20260901'
$metadata = Get-Content -LiteralPath (Join-Path $shotRoot 'runtime-metadata.json') -Raw -Encoding utf8 | ConvertFrom-Json
$crop = [System.Drawing.Rectangle]::new(100, 45, 350, 315)
$zoom = 2
$tileWidth = $crop.Width * $zoom
$tileHeight = $crop.Height * $zoom
$columns = 4
$font = [System.Drawing.Font]::new('Microsoft YaHei UI', 18, [System.Drawing.FontStyle]::Bold)
$smallFont = [System.Drawing.Font]::new('Consolas', 13, [System.Drawing.FontStyle]::Regular)
$borderPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 58, 66, 78), 3)
$labelBg = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(205, 0, 0, 0))

try {
    $groups = [ordered]@{
        rifles = @($metadata.entries | Where-Object { $_.family -eq 'rifles' -and $_.pose -eq 'right_level' })
        shotguns = @($metadata.entries | Where-Object { $_.family -eq 'shotguns' -and $_.pose -eq 'right_level' })
        machine_guns = @($metadata.entries | Where-Object { $_.family -eq 'machine_guns' -and $_.pose -eq 'right_level' })
        angles = @($metadata.entries | Where-Object { $_.pose -ne 'right_level' })
    }

    foreach ($group in $groups.GetEnumerator()) {
        $entries = @($group.Value)
        $rows = [Math]::Ceiling($entries.Count / [double]$columns)
        $sheet = [System.Drawing.Bitmap]::new($columns * $tileWidth, $rows * $tileHeight)
        $graphics = [System.Drawing.Graphics]::FromImage($sheet)
        try {
            $graphics.Clear([System.Drawing.Color]::FromArgb(255, 28, 31, 38))
            $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
            $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
            for ($index = 0; $index -lt $entries.Count; $index++) {
                $entry = $entries[$index]
                $sourcePath = Join-Path $projectRoot $entry.file
                $source = [System.Drawing.Bitmap]::new($sourcePath)
                try {
                    $destination = [System.Drawing.Rectangle]::new(
                        ($index % $columns) * $tileWidth,
                        [Math]::Floor($index / $columns) * $tileHeight,
                        $tileWidth,
                        $tileHeight)
                    $graphics.DrawImage($source, $destination, $crop, [System.Drawing.GraphicsUnit]::Pixel)
                    $graphics.DrawRectangle($borderPen, $destination.X + 1, $destination.Y + 1, $destination.Width - 3, $destination.Height - 3)
                    $graphics.FillRectangle($labelBg, $destination.X + 8, $destination.Y + 8, 425, 62)
                    $graphics.DrawString([string]$entry.name, $font, [System.Drawing.Brushes]::White, $destination.X + 16, $destination.Y + 12)
                    $detail = '{0} | frame {1} | ADS {2:N3}' -f $entry.pose, $entry.armFrame, [double]$entry.aimEase
                    $graphics.DrawString($detail, $smallFont, [System.Drawing.Brushes]::LightGray, $destination.X + 16, $destination.Y + 42)
                }
                finally { $source.Dispose() }
            }
            $output = Join-Path $shotRoot ("zoom-{0}.png" -f $group.Key)
            $sheet.Save($output, [System.Drawing.Imaging.ImageFormat]::Png)
            Write-Output $output
        }
        finally { $graphics.Dispose(); $sheet.Dispose() }
    }
}
finally {
    $font.Dispose()
    $smallFont.Dispose()
    $borderPen.Dispose()
    $labelBg.Dispose()
}
