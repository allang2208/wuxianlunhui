param(
    [ValidateRange(32, 512)]
    [int]$Size = 128,
    [switch]$Prune
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $PSScriptRoot
$assetRoot = Join-Path $projectRoot 'assets'
$runtimeRoot = Join-Path $assetRoot 'ui\runtime-icons'
$assetRootPrefix = $assetRoot.TrimEnd('\') + '\'

$sourcePathSet = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)

foreach ($configPath in @('data\craft-config.json', 'data\building-upgrades.json')) {
    # Extract only the icon fields covered by the runtime project-icon contract.
    # This also avoids deep ConvertFrom-Json traversal differences between PS 5.1 and PS 7.
    $configText = Get-Content (Join-Path $projectRoot $configPath) -Raw -Encoding UTF8
    $iconMatches = [regex]::Matches(
        $configText,
        '"(?:icon|iconImage)"\s*:\s*"(assets/[^"]+)"'
    )
    foreach ($iconMatch in $iconMatches) {
        [void]$sourcePathSet.Add($iconMatch.Groups[1].Value.Replace('/', '\'))
    }
}

# Per-instance expansion cards may be declared directly in a panel instead of JSON.
# Discover all building-upgrade image literals so future cards do not require another
# manually maintained list in this generator.
$sourceRoot = Join-Path $projectRoot 'src'
foreach ($sourceFile in Get-ChildItem -LiteralPath $sourceRoot -Recurse -File -Filter '*.js') {
    $sourceText = Get-Content -LiteralPath $sourceFile.FullName -Raw -Encoding UTF8
    $directMatches = [regex]::Matches(
        $sourceText,
        '[''"](assets/ui/building-upgrades/[^''"]+\.(?:png|webp))[''"]',
        [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
    )
    foreach ($directMatch in $directMatches) {
        [void]$sourcePathSet.Add($directMatch.Groups[1].Value.Replace('/', '\'))
    }
}

Write-Output "Discovered $($sourcePathSet.Count) project icon references."

$sourceFiles = @(
    $sourcePathSet |
        ForEach-Object { Get-Item -LiteralPath (Join-Path $projectRoot $_) } |
        Sort-Object FullName -Unique
)

$written = 0
foreach ($sourceFile in $sourceFiles) {
    if (-not $sourceFile.FullName.StartsWith($assetRootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Project icon source is outside the asset root: $($sourceFile.FullName)"
    }
    $relativePath = $sourceFile.FullName.Substring($assetRootPrefix.Length)
    $targetPath = Join-Path $runtimeRoot $relativePath
    $targetDirectory = Split-Path -Parent $targetPath
    New-Item -ItemType Directory -Force -Path $targetDirectory | Out-Null

    $source = [System.Drawing.Image]::FromFile($sourceFile.FullName)
    try {
        $scale = [Math]::Min($Size / $source.Width, $Size / $source.Height)
        $width = [Math]::Max(1, [int][Math]::Round($source.Width * $scale))
        $height = [Math]::Max(1, [int][Math]::Round($source.Height * $scale))
        $left = [int][Math]::Floor(($Size - $width) / 2)
        $top = [int][Math]::Floor(($Size - $height) / 2)

        $bitmap = New-Object System.Drawing.Bitmap(
            $Size,
            $Size,
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
                $destination = New-Object System.Drawing.Rectangle($left, $top, $width, $height)
                $graphics.DrawImage(
                    $source,
                    $destination,
                    0,
                    0,
                    $source.Width,
                    $source.Height,
                    [System.Drawing.GraphicsUnit]::Pixel
                )
            } finally {
                $graphics.Dispose()
            }
            $bitmap.Save($targetPath, [System.Drawing.Imaging.ImageFormat]::Png)
        } finally {
            $bitmap.Dispose()
        }
    } finally {
        $source.Dispose()
    }
    $written++
}

Write-Output "Generated $written runtime project icons at ${Size}x${Size}."

if ($Prune -and (Test-Path -LiteralPath $runtimeRoot)) {
    $expectedTargets = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($sourceFile in $sourceFiles) {
        $relativePath = $sourceFile.FullName.Substring($assetRootPrefix.Length)
        [void]$expectedTargets.Add((Join-Path $runtimeRoot $relativePath))
    }
    $removed = 0
    foreach ($runtimeFile in Get-ChildItem -LiteralPath $runtimeRoot -Recurse -File) {
        if ($expectedTargets.Contains($runtimeFile.FullName)) { continue }
        Remove-Item -LiteralPath $runtimeFile.FullName
        $removed++
    }
    Write-Output "Pruned $removed unreferenced runtime project icons."
}
