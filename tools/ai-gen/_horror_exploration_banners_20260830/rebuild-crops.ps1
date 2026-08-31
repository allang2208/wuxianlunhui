# Rebuild only this batch from its archived originals. No generation or game execution.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$manifestPath = Join-Path $PSScriptRoot 'manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$sourceDir = Join-Path $PSScriptRoot 'source'
[void][IO.Directory]::CreateDirectory($sourceDir)
$runtimeTotal = 0L
$sourceTotal = 0L

foreach ($asset in $manifest.assets) {
    $rawPath = Join-Path $sourceDir $asset.filename
    if (-not (Test-Path -LiteralPath $rawPath)) {
        [IO.File]::Copy($asset.source, $rawPath, $false)
    }
    $raw = [Drawing.Bitmap]::new($rawPath)
    try {
        # 16:9 viewport with a 40vh banner => 40:9. Keep the largest native-pixel rectangle.
        $unit = [int][Math]::Floor([Math]::Min($raw.Width / 40.0, $raw.Height / 9.0))
        if ($unit -lt 1) { throw "Source too small: $rawPath" }
        $width = 40 * $unit
        $height = 9 * $unit
        $left = [int][Math]::Floor(($raw.Width - $width) / 2.0)
        $top = [int][Math]::Floor(($raw.Height - $height) / 2.0)
        $rect = [Drawing.Rectangle]::new($left, $top, $width, $height)
        $cropped = $raw.Clone($rect, $raw.PixelFormat)
        $runtimePath = Join-Path $projectRoot $asset.path
        [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($runtimePath))
        try { $cropped.Save($runtimePath, [Drawing.Imaging.ImageFormat]::Png) }
        finally { $cropped.Dispose() }

        $rawBytes = (Get-Item -LiteralPath $rawPath).Length
        $runtimeBytes = (Get-Item -LiteralPath $runtimePath).Length
        $asset | Add-Member -NotePropertyName rawPath -NotePropertyValue ('tools/ai-gen/_horror_exploration_banners_20260830/source/' + $asset.filename) -Force
        $asset | Add-Member -NotePropertyName sourceWidth -NotePropertyValue $raw.Width -Force
        $asset | Add-Member -NotePropertyName sourceHeight -NotePropertyValue $raw.Height -Force
        $asset | Add-Member -NotePropertyName sourceBytes -NotePropertyValue $rawBytes -Force
        $asset | Add-Member -NotePropertyName crop -NotePropertyValue ([ordered]@{
            left = $left; top = $top; width = $width; height = $height
            alignment = 'center'; aspectRatio = '40:9'; resampling = 'none'
        }) -Force
        $asset.width = $width
        $asset.height = $height
        $asset.bytes = $runtimeBytes
        $asset.review = 'Offline crop preview only; game/runtime not tested.'
        $runtimeTotal += $runtimeBytes
        $sourceTotal += $rawBytes
        Write-Output ("{0} {1}x{2} -> {3}x{4}; crop [{5},{6},{3},{4}]" -f $asset.number, $raw.Width, $raw.Height, $width, $height, $left, $top)
    }
    finally { $raw.Dispose() }
}
$manifest.pixelEdits = 'Deterministic centered native-pixel crop to 40:9; no redraw, stretching, resampling or recoloring. Originals archived in source/.'
$manifest.totalBytes = $runtimeTotal
$manifest | Add-Member -NotePropertyName sourceTotalBytes -NotePropertyValue $sourceTotal -Force
$manifest | Add-Member -NotePropertyName cropSpec -NotePropertyValue ([ordered]@{
    viewport = '16:9'; bannerHeight = '40vh'; aspectRatio = '40:9'
    alignment = 'center'; pixelScale = 1; rebuild = 'rebuild-crops.ps1'
    rounding = 'Largest whole multiple of 40 by 9; odd remainder goes to right/bottom.'
}) -Force
$manifest.integration.display = 'Native 40:9 crop; existing centered cover / .94 opacity / 40vh banner unchanged. Other viewport ratios or divider heights still crop further.'
$utf8 = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 20) + [Environment]::NewLine, $utf8)

# Offline delivery overview. Only these preview thumbnails are resized.
$preview = [Drawing.Bitmap]::new(1328, 956)
$graphics = [Drawing.Graphics]::FromImage($preview)
$font = [Drawing.Font]::new('Microsoft YaHei', 11)
$brush = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(224, 229, 232))
try {
    $graphics.Clear([Drawing.Color]::FromArgb(24, 28, 30))
    $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    for ($index = 0; $index -lt $manifest.assets.Count; $index++) {
        $asset = $manifest.assets[$index]
        $x = 16 + ($index % 2) * 656
        $y = 16 + [int][Math]::Floor($index / 2.0) * 188
        $label = '{0} {1}  |  {2} x {3}' -f $asset.number, $asset.title, $asset.width, $asset.height
        $graphics.DrawString($label, $font, $brush, [single]$x, [single]$y)
        $thumbnail = [Drawing.Bitmap]::new((Join-Path $projectRoot $asset.path))
        try { $graphics.DrawImage($thumbnail, [Drawing.Rectangle]::new($x, ($y + 28), 640, 144)) }
        finally { $thumbnail.Dispose() }
    }
    $preview.Save((Join-Path $PSScriptRoot 'crop-preview.png'), [Drawing.Imaging.ImageFormat]::Png)
}
finally {
    $brush.Dispose()
    $font.Dispose()
    $graphics.Dispose()
    $preview.Dispose()
}
Write-Output ("Runtime PNG total: {0} bytes; originals: {1} bytes" -f $runtimeTotal, $sourceTotal)
