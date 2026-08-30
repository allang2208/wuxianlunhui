$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Drawing

# Archive of the approved arrow exports. Does not regenerate or redesign artwork.
$cursorRepo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$variants = @(
    @{ Source = 'normal-pointer-source.png'; Asset = 'normal-pointer-cold-steel.png'; Width = 48; Height = 48; Crop = @(120,31,1035,1077); Destination = @(3,2,42,44) },
    @{ Source = 'elevated-climb-source.png'; Asset = 'elevated-climb-arrow.png'; Width = 192; Height = 256 }
)
foreach ($variant in $variants) {
    $source = [Drawing.Bitmap]::FromFile((Join-Path $PSScriptRoot $variant.Source))
    $output = [Drawing.Bitmap]::new($variant.Width, $variant.Height, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [Drawing.Graphics]::FromImage($output)
    try {
        if ($variant.ContainsKey('Crop')) {
            $crop = $variant.Crop
            $destination = $variant.Destination
            $sourceRect = [Drawing.Rectangle]::new($crop[0], $crop[1], $crop[2], $crop[3])
            $destinationRect = [Drawing.Rectangle]::new($destination[0], $destination[1], $destination[2], $destination[3])
        } else {
            # Preserve the original alpha>32 bounding-box export and integer rounding.
            $minX = $source.Width; $minY = $source.Height; $maxX = -1; $maxY = -1
            for ($y = 0; $y -lt $source.Height; $y++) {
                for ($x = 0; $x -lt $source.Width; $x++) {
                    if ($source.GetPixel($x, $y).A -le 32) { continue }
                    $minX = [Math]::Min($minX, $x); $maxX = [Math]::Max($maxX, $x)
                    $minY = [Math]::Min($minY, $y); $maxY = [Math]::Max($maxY, $y)
                }
            }
            if ($maxX -lt $minX -or $maxY -lt $minY) { throw 'No visible source alpha bounds' }
            $sourceRect = [Drawing.Rectangle]::FromLTRB($minX, $minY, $maxX + 1, $maxY + 1)
            $height = 240
            $width = [int][Math]::Round($sourceRect.Width * $height / $sourceRect.Height)
            if ($width -gt $variant.Width) {
                $width = $variant.Width
                $height = [int][Math]::Round($sourceRect.Height * $width / $sourceRect.Width)
            }
            $left = [int][Math]::Floor(($variant.Width - $width) / 2)
            $top = [int][Math]::Floor(($variant.Height - $height) / 2)
            $destinationRect = [Drawing.Rectangle]::new($left, $top, $width, $height)
            $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::HighQuality
        }
        $graphics.Clear([Drawing.Color]::Transparent)
        $graphics.CompositingMode = [Drawing.Drawing2D.CompositingMode]::SourceCopy
        $graphics.CompositingQuality = [Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.DrawImage($source, $destinationRect, $sourceRect, [Drawing.GraphicsUnit]::Pixel)
        $output.Save((Join-Path $cursorRepo ('assets/ui/cursors/' + $variant.Asset)), [Drawing.Imaging.ImageFormat]::Png)
    } finally {
        $graphics.Dispose()
        $output.Dispose()
        $source.Dispose()
    }
}
