[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
$assetRoot = Join-Path $projectRoot 'assets'
$runtimeRoot = Join-Path $assetRoot 'weapons\runtime'
$backupRoot = Join-Path $PSScriptRoot 'source-originals'
$manifestPath = Join-Path $PSScriptRoot 'manifest.json'

$alphaThreshold = 60
$targetCanvasSize = 2048
$targetContentWidth = 1872
$targetCenterX = 1024.0
$targetCenterY = 1112.5
$sourcePadding = 4
$runtimeSize = 512

$entries = @(
    [pscustomobject]@{ TextureKey = 'weapon_super90'; Source = 'assets\icons\M4s90_icon.png'; Normalize = $false },
    [pscustomobject]@{ TextureKey = 'weapon_saiga12k'; Source = 'assets\icons\S12k-icon.png'; Normalize = $true },
    [pscustomobject]@{ TextureKey = 'weapon_s686'; Source = 'assets\weapons\s686-equip.png'; Normalize = $true },
    [pscustomobject]@{ TextureKey = 'weapon_m870_breacher'; Source = 'assets\weapons\m870-breacher-equip.png'; Normalize = $true },
    [pscustomobject]@{ TextureKey = 'weapon_ksg12'; Source = 'assets\weapons\ksg12-equip.png'; Normalize = $true },
    [pscustomobject]@{ TextureKey = 'weapon_spas12'; Source = 'assets\weapons\spas12-equip.png'; Normalize = $true },
    [pscustomobject]@{ TextureKey = 'weapon_aa12'; Source = 'assets\weapons\aa12-equip.png'; Normalize = $true },
    [pscustomobject]@{ TextureKey = 'weapon_winchester1887'; Source = 'assets\weapons\winchester1887-equip.png'; Normalize = $true },
    [pscustomobject]@{ TextureKey = 'weapon_terminus_pendulum'; Source = 'assets\weapons\terminus-pendulum-equip.png'; Normalize = $true },
    [pscustomobject]@{ TextureKey = 'weapon_void_funeral_tide'; Source = 'assets\weapons\void-funeral-tide-equip.png'; Normalize = $true },
    [pscustomobject]@{ TextureKey = 'weapon_black_sun_verdict'; Source = 'assets\weapons\black-sun-verdict-equip.png'; Normalize = $true },
    [pscustomobject]@{ TextureKey = 'weapon_royal_hunt_finale'; Source = 'assets\weapons\royal-hunt-finale-equip.png'; Normalize = $true }
)

function Get-AlphaBounds {
    param(
        [Parameter(Mandatory = $true)]
        [System.Drawing.Bitmap]$Bitmap,
        [Parameter(Mandatory = $true)]
        [int]$Threshold
    )

    $converted = [System.Drawing.Bitmap]::new(
        $Bitmap.Width,
        $Bitmap.Height,
        [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
    )
    $graphics = [System.Drawing.Graphics]::FromImage($converted)
    try {
        $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
        $graphics.DrawImageUnscaled($Bitmap, 0, 0)
    }
    finally {
        $graphics.Dispose()
    }

    $rect = [System.Drawing.Rectangle]::new(0, 0, $converted.Width, $converted.Height)
    $bitmapData = $converted.LockBits(
        $rect,
        [System.Drawing.Imaging.ImageLockMode]::ReadOnly,
        [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
    )
    try {
        $stride = [Math]::Abs($bitmapData.Stride)
        $bytes = [byte[]]::new($stride * $converted.Height)
        [System.Runtime.InteropServices.Marshal]::Copy($bitmapData.Scan0, $bytes, 0, $bytes.Length)

        $minX = $converted.Width
        $minY = $converted.Height
        $maxX = -1
        $maxY = -1
        $opaquePixels = 0L

        for ($y = 0; $y -lt $converted.Height; $y++) {
            $rowOffset = $y * $stride
            for ($x = 0; $x -lt $converted.Width; $x++) {
                $alpha = $bytes[$rowOffset + ($x * 4) + 3]
                if ($alpha -le $Threshold) { continue }
                if ($x -lt $minX) { $minX = $x }
                if ($x -gt $maxX) { $maxX = $x }
                if ($y -lt $minY) { $minY = $y }
                if ($y -gt $maxY) { $maxY = $y }
                $opaquePixels++
            }
        }

        if ($maxX -lt $minX -or $maxY -lt $minY) {
            throw "No pixels above alpha threshold $Threshold."
        }

        return [pscustomobject]@{
            X = $minX
            Y = $minY
            Width = $maxX - $minX + 1
            Height = $maxY - $minY + 1
            CenterX = ($minX + $maxX + 1) / 2.0
            CenterY = ($minY + $maxY + 1) / 2.0
            OpaquePixels = $opaquePixels
        }
    }
    finally {
        $converted.UnlockBits($bitmapData)
        $converted.Dispose()
    }
}

function Get-ImageMetrics {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $bitmap = [System.Drawing.Bitmap]::new($Path)
    try {
        $bounds = Get-AlphaBounds -Bitmap $bitmap -Threshold $alphaThreshold
        return [ordered]@{
            width = $bitmap.Width
            height = $bitmap.Height
            alphaThreshold = $alphaThreshold
            bounds = [ordered]@{
                x = $bounds.X
                y = $bounds.Y
                width = $bounds.Width
                height = $bounds.Height
                centerX = [Math]::Round($bounds.CenterX / $bitmap.Width, 6)
                centerY = [Math]::Round($bounds.CenterY / $bitmap.Height, 6)
                widthRatio = [Math]::Round($bounds.Width / $bitmap.Width, 6)
            }
            sha256 = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    }
    finally {
        $bitmap.Dispose()
    }
}

function Save-NormalizedImage {
    param(
        [Parameter(Mandatory = $true)]
        [string]$InputPath,
        [Parameter(Mandatory = $true)]
        [string]$OutputPath
    )

    $loadedSource = [System.Drawing.Bitmap]::new($InputPath)
    try {
        $source = [System.Drawing.Bitmap]::new($loadedSource)
    }
    finally {
        $loadedSource.Dispose()
    }
    try {
        $bounds = Get-AlphaBounds -Bitmap $source -Threshold $alphaThreshold
        $cropX = [Math]::Max(0, $bounds.X - $sourcePadding)
        $cropY = [Math]::Max(0, $bounds.Y - $sourcePadding)
        $cropRight = [Math]::Min($source.Width, $bounds.X + $bounds.Width + $sourcePadding)
        $cropBottom = [Math]::Min($source.Height, $bounds.Y + $bounds.Height + $sourcePadding)
        $cropWidth = $cropRight - $cropX
        $cropHeight = $cropBottom - $cropY
        $scale = $targetContentWidth / [double]$bounds.Width

        $destinationX = $targetCenterX - (($bounds.CenterX - $cropX) * $scale)
        $destinationY = $targetCenterY - (($bounds.CenterY - $cropY) * $scale)
        $destinationWidth = $cropWidth * $scale
        $destinationHeight = $cropHeight * $scale

        $output = [System.Drawing.Bitmap]::new(
            $targetCanvasSize,
            $targetCanvasSize,
            [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
        )
        try {
            $output.SetResolution(96, 96)
            $graphics = [System.Drawing.Graphics]::FromImage($output)
            try {
                $graphics.Clear([System.Drawing.Color]::Transparent)
                $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
                $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
                $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
                $destinationRect = [System.Drawing.Rectangle]::new(
                    [int][Math]::Round($destinationX),
                    [int][Math]::Round($destinationY),
                    [int][Math]::Round($destinationWidth),
                    [int][Math]::Round($destinationHeight)
                )
                $graphics.DrawImage(
                    $source,
                    $destinationRect,
                    $cropX,
                    $cropY,
                    $cropWidth,
                    $cropHeight,
                    [System.Drawing.GraphicsUnit]::Pixel
                )
            }
            finally {
                $graphics.Dispose()
            }

            $temporaryPath = "$OutputPath.normalized.png"
            if ([System.IO.File]::Exists($temporaryPath)) {
                [System.IO.File]::Delete($temporaryPath)
            }
            $output.Save($temporaryPath, [System.Drawing.Imaging.ImageFormat]::Png)
            $outputAlreadyMatches = [System.IO.File]::Exists($OutputPath) -and
                ((Get-FileHash -LiteralPath $temporaryPath -Algorithm SHA256).Hash -eq
                 (Get-FileHash -LiteralPath $OutputPath -Algorithm SHA256).Hash)
            if (-not $outputAlreadyMatches) {
                [System.IO.File]::Copy($temporaryPath, $OutputPath, $true)
            }
            [System.IO.File]::Delete($temporaryPath)
        }
        finally {
            $output.Dispose()
        }
    }
    finally {
        $source.Dispose()
    }
}

function Save-RuntimeImage {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SourcePath,
        [Parameter(Mandatory = $true)]
        [string]$TargetPath
    )

    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $TargetPath) | Out-Null
    $source = [System.Drawing.Bitmap]::new($SourcePath)
    try {
        $output = [System.Drawing.Bitmap]::new(
            $runtimeSize,
            $runtimeSize,
            [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
        )
        try {
            $output.SetResolution(96, 96)
            $graphics = [System.Drawing.Graphics]::FromImage($output)
            try {
                $graphics.Clear([System.Drawing.Color]::Transparent)
                $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
                $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
                $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
                $graphics.DrawImage(
                    $source,
                    [System.Drawing.Rectangle]::new(0, 0, $runtimeSize, $runtimeSize),
                    0,
                    0,
                    $source.Width,
                    $source.Height,
                    [System.Drawing.GraphicsUnit]::Pixel
                )
            }
            finally {
                $graphics.Dispose()
            }

            $temporaryPath = "$TargetPath.runtime.png"
            if ([System.IO.File]::Exists($temporaryPath)) {
                [System.IO.File]::Delete($temporaryPath)
            }
            $output.Save($temporaryPath, [System.Drawing.Imaging.ImageFormat]::Png)
            $runtimeAlreadyMatches = [System.IO.File]::Exists($TargetPath) -and
                ((Get-FileHash -LiteralPath $temporaryPath -Algorithm SHA256).Hash -eq
                 (Get-FileHash -LiteralPath $TargetPath -Algorithm SHA256).Hash)
            if (-not $runtimeAlreadyMatches) {
                [System.IO.File]::Copy($temporaryPath, $TargetPath, $true)
            }
            [System.IO.File]::Delete($temporaryPath)
        }
        finally {
            $output.Dispose()
        }
    }
    finally {
        $source.Dispose()
    }
}

New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
$manifestEntries = @()

foreach ($entry in $entries) {
    $sourcePath = Join-Path $projectRoot $entry.Source
    if (-not (Test-Path -LiteralPath $sourcePath)) {
        throw "Missing shotgun source: $($entry.Source)"
    }

    $backupPath = Join-Path $backupRoot ([System.IO.Path]::GetFileName($sourcePath))
    if ($entry.Normalize -and -not (Test-Path -LiteralPath $backupPath)) {
        Copy-Item -LiteralPath $sourcePath -Destination $backupPath
    }

    $originalPath = if ($entry.Normalize) { $backupPath } else { $sourcePath }
    $originalMetrics = Get-ImageMetrics -Path $originalPath

    if ($entry.Normalize) {
        Save-NormalizedImage -InputPath $backupPath -OutputPath $sourcePath
    }

    $normalizedMetrics = Get-ImageMetrics -Path $sourcePath
    $assetRelative = $sourcePath.Substring($assetRoot.Length).TrimStart('\')
    $runtimePath = Join-Path $runtimeRoot $assetRelative
    Save-RuntimeImage -SourcePath $sourcePath -TargetPath $runtimePath
    $runtimeMetrics = Get-ImageMetrics -Path $runtimePath

    $manifestEntries += [ordered]@{
        textureKey = $entry.TextureKey
        source = $entry.Source.Replace('\', '/')
        normalized = [bool]$entry.Normalize
        backup = if ($entry.Normalize) { $backupPath.Substring($projectRoot.Length + 1).Replace('\', '/') } else { $null }
        original = $originalMetrics
        output = $normalizedMetrics
        runtime = [ordered]@{
            path = $runtimePath.Substring($projectRoot.Length + 1).Replace('\', '/')
            metrics = $runtimeMetrics
        }
    }
}

$manifest = [ordered]@{
    task = 'shotgun-akm-normalization-20260901'
    generatedAt = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ssK')
    reference = [ordered]@{
        textureKey = 'weapon_super90'
        source = 'assets/icons/M4s90_icon.png'
        canvas = @($targetCanvasSize, $targetCanvasSize)
        alphaThreshold = $alphaThreshold
        contentWidth = $targetContentWidth
        contentCenter = @($targetCenterX, $targetCenterY)
    }
    method = 'Preserve aspect ratio; map the alpha>60 content width and center to the accepted Super90 square-canvas reference; retain a four-pixel source fringe for antialiasing.'
    entries = $manifestEntries
}

$manifest | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $manifestPath -Encoding utf8
Write-Output "Normalized 11 shotgun sources and generated 12 scoped runtime textures."
Write-Output "Manifest: $manifestPath"
