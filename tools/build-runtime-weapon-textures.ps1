param(
    [ValidateRange(128, 1024)]
    [int]$MaxSize = 512,
    [switch]$Prune
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $PSScriptRoot
$assetRoot = Join-Path $projectRoot 'assets'
$runtimeRoot = Join-Path $assetRoot 'weapons\runtime'
$assetRootPrefix = $assetRoot.TrimEnd('\') + '\'
$mapPath = Join-Path $projectRoot 'src\config\weapon-texture-map.js'
$mapText = Get-Content -LiteralPath $mapPath -Raw -Encoding UTF8
$entryMatches = [regex]::Matches(
    $mapText,
    "\{\s*key:\s*'([^']+)'\s*,\s*path:\s*'(assets/[^']+)'\s*\}"
)

if ($entryMatches.Count -eq 0) {
    throw 'No weapon texture source entries were found in weapon-texture-map.js'
}

$expectedTargets = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
$written = 0
$decodedBytes = 0L
foreach ($entryMatch in $entryMatches) {
    $key = $entryMatch.Groups[1].Value
    $sourceRelative = $entryMatch.Groups[2].Value.Replace('/', '\')
    $sourcePath = Join-Path $projectRoot $sourceRelative
    $sourceFile = Get-Item -LiteralPath $sourcePath
    if (-not $sourceFile.FullName.StartsWith($assetRootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Weapon texture source is outside the asset root: $($sourceFile.FullName)"
    }

    $assetRelative = $sourceFile.FullName.Substring($assetRootPrefix.Length)
    $targetPath = Join-Path $runtimeRoot $assetRelative
    [void]$expectedTargets.Add($targetPath)
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $targetPath) | Out-Null

    $source = [System.Drawing.Image]::FromFile($sourceFile.FullName)
    try {
        $scale = [Math]::Min(1.0, $MaxSize / [Math]::Max($source.Width, $source.Height))
        $width = [Math]::Max(1, [int][Math]::Round($source.Width * $scale))
        $height = [Math]::Max(1, [int][Math]::Round($source.Height * $scale))
        $bitmap = New-Object System.Drawing.Bitmap(
            $width,
            $height,
            [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
        )
        try {
            $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
            try {
                $graphics.Clear([System.Drawing.Color]::Transparent)
                $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
                $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
                $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
                $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                $graphics.DrawImage($source, 0, 0, $width, $height)
            } finally {
                $graphics.Dispose()
            }
            $bitmap.Save($targetPath, [System.Drawing.Imaging.ImageFormat]::Png)
        } finally {
            $bitmap.Dispose()
        }
        $decodedBytes += [int64]$width * $height * 4
    } finally {
        $source.Dispose()
    }
    $written++
    Write-Verbose "$key -> $targetPath"
}

if ($Prune -and (Test-Path -LiteralPath $runtimeRoot)) {
    $removed = 0
    foreach ($runtimeFile in Get-ChildItem -LiteralPath $runtimeRoot -Recurse -File) {
        if ($expectedTargets.Contains($runtimeFile.FullName)) { continue }
        Remove-Item -LiteralPath $runtimeFile.FullName
        $removed++
    }
    Write-Output "Pruned $removed unreferenced runtime weapon textures."
}

Write-Output "Generated $written runtime weapon textures (max ${MaxSize}px, theoretical RGBA $([Math]::Round($decodedBytes / 1MB, 2)) MiB)."
