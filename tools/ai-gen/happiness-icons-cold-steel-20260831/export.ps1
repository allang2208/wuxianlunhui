# Export only the seven approved happiness icons; source PNGs remain unchanged.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$outputDirectory = Join-Path $projectRoot 'assets\ui\happiness'
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$iconNames = @('happiness', 'food', 'housing', 'housing-quality', 'entertainment', 'commerce', 'safety')
$size = 128

foreach ($name in $iconNames) {
    $source = [System.Drawing.Image]::FromFile((Join-Path $PSScriptRoot ($name + '.png')))
    try {
        $scale = [Math]::Min($size / $source.Width, $size / $source.Height)
        $width = [Math]::Max(1, [int][Math]::Round($source.Width * $scale))
        $height = [Math]::Max(1, [int][Math]::Round($source.Height * $scale))
        $left = [int][Math]::Floor(($size - $width) / 2)
        $top = [int][Math]::Floor(($size - $height) / 2)
        $bitmap = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        try {
            $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
            try {
                $graphics.Clear([System.Drawing.Color]::Transparent)
                $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
                $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
                $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                $destination = New-Object System.Drawing.Rectangle($left, $top, $width, $height)
                $graphics.DrawImage($source, $destination, 0, 0, $source.Width, $source.Height, [System.Drawing.GraphicsUnit]::Pixel)
            } finally {
                $graphics.Dispose()
            }
            $bitmap.Save((Join-Path $outputDirectory ($name + '.png')), [System.Drawing.Imaging.ImageFormat]::Png)
        } finally {
            $bitmap.Dispose()
        }
    } finally {
        $source.Dispose()
    }
}
Write-Output "Exported $($iconNames.Count) happiness icons to assets/ui/happiness at ${size}px."
