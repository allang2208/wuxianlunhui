$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$TaskRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ConceptSourceDir = Join-Path $TaskRoot 'concept\sources'
$ConceptPreparedDir = Join-Path $TaskRoot 'concept\prepared'
$CraftSourceDir = Join-Path $TaskRoot 'craft-mods\sources'
$CraftHiresDir = Join-Path $TaskRoot 'craft-mods\icons-hires'
$CraftRuntimeDir = Join-Path $TaskRoot 'craft-mods\icons-128'

$MoonsilverNames = @(
    'moonsilver_prismatic_face',
    'moonsilver_layered_reflector',
    'moonsilver_resonant_flutes',
    'moonsilver_quick_release_boss',
    'moonsilver_dense_counter_boss',
    'moonsilver_crescent_balance_ring',
    'moonsilver_spring_palm_grip',
    'moonsilver_duelist_guard_loop',
    'moonsilver_intercept_harness'
)

$BlackironNames = @(
    'blackiron_ribbed_bastion_plate',
    'blackiron_wool_impact_liner',
    'blackiron_suspended_shock_frame',
    'blackiron_flex_hinged_rim',
    'blackiron_ram_spine',
    'blackiron_weighted_sabot',
    'blackiron_capstan_arm_brace',
    'blackiron_locking_elbow_harness',
    'blackiron_layered_bolt_catcher'
)

function Convert-ToArgbBitmap {
    param([string]$Path)
    $source = [System.Drawing.Bitmap]::FromFile($Path)
    $bitmap = New-Object System.Drawing.Bitmap($source.Width, $source.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.DrawImageUnscaled($source, 0, 0)
    $graphics.Dispose()
    $source.Dispose()
    return $bitmap
}

function Convert-ConnectedLightBackgroundToAlpha {
    param([System.Drawing.Bitmap]$Bitmap)

    $width = $Bitmap.Width
    $height = $Bitmap.Height
    $visited = New-Object 'bool[]' ($width * $height)
    $queue = New-Object 'System.Collections.Generic.Queue[int]'

    function Add-Candidate([int]$X, [int]$Y) {
        $index = $Y * $width + $X
        if ($visited[$index]) { return }
        $visited[$index] = $true
        $color = $Bitmap.GetPixel($X, $Y)
        $max = [Math]::Max($color.R, [Math]::Max($color.G, $color.B))
        $min = [Math]::Min($color.R, [Math]::Min($color.G, $color.B))
        if ($color.A -gt 0 -and $min -ge 220 -and ($max - $min) -le 18) {
            $queue.Enqueue($index)
        }
    }

    for ($x = 0; $x -lt $width; $x++) {
        Add-Candidate $x 0
        Add-Candidate $x ($height - 1)
    }
    for ($y = 1; $y -lt ($height - 1); $y++) {
        Add-Candidate 0 $y
        Add-Candidate ($width - 1) $y
    }

    while ($queue.Count -gt 0) {
        $index = $queue.Dequeue()
        $x = $index % $width
        $y = [Math]::Floor($index / $width)
        $Bitmap.SetPixel($x, $y, [System.Drawing.Color]::Transparent)
        if ($x -gt 0) { Add-Candidate ($x - 1) $y }
        if ($x + 1 -lt $width) { Add-Candidate ($x + 1) $y }
        if ($y -gt 0) { Add-Candidate $x ($y - 1) }
        if ($y + 1 -lt $height) { Add-Candidate $x ($y + 1) }
    }
}

function Get-AlphaBounds {
    param(
        [System.Drawing.Bitmap]$Bitmap,
        [int]$Threshold = 8
    )

    $minX = $Bitmap.Width
    $minY = $Bitmap.Height
    $maxX = -1
    $maxY = -1
    for ($y = 0; $y -lt $Bitmap.Height; $y++) {
        for ($x = 0; $x -lt $Bitmap.Width; $x++) {
            if ($Bitmap.GetPixel($x, $y).A -gt $Threshold) {
                if ($x -lt $minX) { $minX = $x }
                if ($x -gt $maxX) { $maxX = $x }
                if ($y -lt $minY) { $minY = $y }
                if ($y -gt $maxY) { $maxY = $y }
            }
        }
    }
    if ($maxX -lt $minX -or $maxY -lt $minY) {
        throw 'No visible alpha content found.'
    }
    return [System.Drawing.Rectangle]::new($minX, $minY, $maxX - $minX + 1, $maxY - $minY + 1)
}

function Save-NormalizedSquare {
    param(
        [System.Drawing.Bitmap]$Source,
        [string]$Destination,
        [int]$CanvasSize,
        [double]$ContentRatio = 0.9
    )

    $bounds = Get-AlphaBounds -Bitmap $Source
    $targetContent = [int][Math]::Round($CanvasSize * $ContentRatio)
    $scale = [Math]::Min($targetContent / $bounds.Width, $targetContent / $bounds.Height)
    $drawWidth = [int][Math]::Round($bounds.Width * $scale)
    $drawHeight = [int][Math]::Round($bounds.Height * $scale)
    $drawX = [int][Math]::Round(($CanvasSize - $drawWidth) / 2)
    $drawY = [int][Math]::Round(($CanvasSize - $drawHeight) / 2)

    $target = New-Object System.Drawing.Bitmap($CanvasSize, $CanvasSize, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($target)
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $sourceRect = [System.Drawing.Rectangle]::new($bounds.X, $bounds.Y, $bounds.Width, $bounds.Height)
    $destRect = [System.Drawing.Rectangle]::new($drawX, $drawY, $drawWidth, $drawHeight)
    $graphics.DrawImage($Source, $destRect, $sourceRect, [System.Drawing.GraphicsUnit]::Pixel)
    $graphics.Dispose()
    $target.Save($Destination, [System.Drawing.Imaging.ImageFormat]::Png)
    $target.Dispose()
}

function Prepare-ConceptAsset {
    param(
        [string]$SourceName,
        [string]$OutputStem,
        [bool]$ClearLightBackground
    )

    $sourcePath = Join-Path $ConceptSourceDir $SourceName
    $bitmap = Convert-ToArgbBitmap -Path $sourcePath
    if ($ClearLightBackground) {
        Convert-ConnectedLightBackgroundToAlpha -Bitmap $bitmap
    }
    Save-NormalizedSquare -Source $bitmap -Destination (Join-Path $ConceptPreparedDir ($OutputStem + '.png')) -CanvasSize 1024
    $bitmap.Dispose()
    Write-Output "prepared concept: $OutputStem"
}

function Save-ResizedSquare {
    param(
        [string]$SourcePath,
        [string]$Destination,
        [int]$Size
    )
    $source = [System.Drawing.Bitmap]::FromFile($SourcePath)
    $target = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($target)
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.DrawImage($source, 0, 0, $Size, $Size)
    $graphics.Dispose()
    $source.Dispose()
    $target.Save($Destination, [System.Drawing.Imaging.ImageFormat]::Png)
    $target.Dispose()
}

function Export-CraftAtlas {
    param(
        [string]$SourceName,
        [string[]]$Names
    )

    $sheetPath = Join-Path $CraftSourceDir $SourceName
    $sheet = Convert-ToArgbBitmap -Path $sheetPath
    Convert-ConnectedLightBackgroundToAlpha -Bitmap $sheet
    if ($sheet.Width -ne $sheet.Height -or ($sheet.Width % 3) -ne 0) {
        $sheet.Dispose()
        throw "Atlas must be square and divisible by 3: $sheetPath"
    }
    $cellSize = [int]($sheet.Width / 3)
    for ($index = 0; $index -lt 9; $index++) {
        [int]$column = $index % 3
        [int]$row = [Math]::Floor($index / 3)
        $rect = [System.Drawing.Rectangle]::new($column * $cellSize, $row * $cellSize, $cellSize, $cellSize)
        $tile = $sheet.Clone($rect, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $hiresPath = Join-Path $CraftHiresDir ($Names[$index] + '.png')
        $runtimePath = Join-Path $CraftRuntimeDir ($Names[$index] + '.png')
        $tile.Save($hiresPath, [System.Drawing.Imaging.ImageFormat]::Png)
        $tile.Dispose()
        Save-ResizedSquare -SourcePath $hiresPath -Destination $runtimePath -Size 128
    }
    $sheet.Dispose()
    Write-Output "prepared craft atlas: $SourceName"
}

Prepare-ConceptAsset -SourceName 'moonsilver-deflection-shield-front-v01.png' -OutputStem 'moonsilver-deflection-shield-front' -ClearLightBackground $true
Prepare-ConceptAsset -SourceName 'moonsilver-deflection-shield-equip-v01.png' -OutputStem 'moonsilver-deflection-shield-equip' -ClearLightBackground $true
Prepare-ConceptAsset -SourceName 'blackiron-citadel-shield-front-v01.png' -OutputStem 'blackiron-citadel-shield-front' -ClearLightBackground $false
Prepare-ConceptAsset -SourceName 'blackiron-citadel-shield-equip-v01.png' -OutputStem 'blackiron-citadel-shield-equip' -ClearLightBackground $false

Save-ResizedSquare -SourcePath (Join-Path $ConceptPreparedDir 'moonsilver-deflection-shield-front.png') -Destination (Join-Path $ConceptPreparedDir 'moonsilver-deflection-shield-icon-128.png') -Size 128
# 玩家手持时相机应看到盾牌外侧正面；背侧图只保留为握柄/承带标定参考。
Save-ResizedSquare -SourcePath (Join-Path $ConceptPreparedDir 'moonsilver-deflection-shield-front.png') -Destination (Join-Path $ConceptPreparedDir 'moonsilver-deflection-shield-front-512.png') -Size 512
Save-ResizedSquare -SourcePath (Join-Path $ConceptPreparedDir 'moonsilver-deflection-shield-equip.png') -Destination (Join-Path $ConceptPreparedDir 'moonsilver-deflection-shield-equip-512.png') -Size 512
Save-ResizedSquare -SourcePath (Join-Path $ConceptPreparedDir 'blackiron-citadel-shield-front.png') -Destination (Join-Path $ConceptPreparedDir 'blackiron-citadel-shield-icon-128.png') -Size 128
Save-ResizedSquare -SourcePath (Join-Path $ConceptPreparedDir 'blackiron-citadel-shield-front.png') -Destination (Join-Path $ConceptPreparedDir 'blackiron-citadel-shield-front-512.png') -Size 512
Save-ResizedSquare -SourcePath (Join-Path $ConceptPreparedDir 'blackiron-citadel-shield-equip.png') -Destination (Join-Path $ConceptPreparedDir 'blackiron-citadel-shield-equip-512.png') -Size 512

Export-CraftAtlas -SourceName 'moonsilver-craft-icons-sheet-v01.png' -Names $MoonsilverNames
Export-CraftAtlas -SourceName 'blackiron-craft-icons-sheet-v01.png' -Names $BlackironNames

$conceptPreview = New-Object System.Drawing.Bitmap(1024, 1024, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$conceptGraphics = [System.Drawing.Graphics]::FromImage($conceptPreview)
$conceptGraphics.Clear([System.Drawing.Color]::FromArgb(255, 24, 29, 36))
$conceptFiles = @(
    'moonsilver-deflection-shield-front.png',
    'moonsilver-deflection-shield-equip.png',
    'blackiron-citadel-shield-front.png',
    'blackiron-citadel-shield-equip.png'
)
for ($index = 0; $index -lt $conceptFiles.Count; $index++) {
    $asset = [System.Drawing.Bitmap]::FromFile((Join-Path $ConceptPreparedDir $conceptFiles[$index]))
    $column = $index % 2
    $row = [Math]::Floor($index / 2)
    $conceptGraphics.DrawImage($asset, $column * 512, $row * 512, 512, 512)
    $asset.Dispose()
}
$conceptGraphics.Dispose()
$conceptPreview.Save((Join-Path $TaskRoot 'rare-shields-concept-preview.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$conceptPreview.Dispose()

$craftPreview = New-Object System.Drawing.Bitmap(384, 768, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$craftGraphics = [System.Drawing.Graphics]::FromImage($craftPreview)
$craftGraphics.Clear([System.Drawing.Color]::FromArgb(255, 24, 29, 36))
$allNames = @($MoonsilverNames) + @($BlackironNames)
for ($index = 0; $index -lt $allNames.Count; $index++) {
    $icon = [System.Drawing.Bitmap]::FromFile((Join-Path $CraftRuntimeDir ($allNames[$index] + '.png')))
    $column = $index % 3
    $row = [Math]::Floor($index / 3)
    $craftGraphics.DrawImageUnscaled($icon, $column * 128, $row * 128)
    $icon.Dispose()
}
$craftGraphics.Dispose()
$craftPreview.Save((Join-Path $TaskRoot 'rare-shields-craft-icons-preview.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$craftPreview.Dispose()

Write-Output 'Prepared rare shield concepts and 18 craft icon candidates.'
