param(
    [Parameter(Mandatory = $true)]
    [string]$BucklerSheet,

    [Parameter(Mandatory = $true)]
    [string]$OakSheet
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$TaskRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$SourceDir = Join-Path $TaskRoot 'sources'
$HiresDir = Join-Path $TaskRoot 'icons-hires'
$RuntimeDir = Join-Path $TaskRoot 'icons-128'

$BucklerNames = @(
    'forged_tempered_arc_plate',
    'forged_layered_impact_face',
    'forged_shock_spokes',
    'forged_flared_deflection_boss',
    'forged_solid_impact_boss',
    'forged_offset_counterweight',
    'forged_cork_palm_grip',
    'forged_hooked_guard_strap',
    'forged_angled_catch_strap'
)

$OakNames = @(
    'oak_cross_laminated_core',
    'oak_thick_rawhide_facing',
    'oak_felt_shock_liner',
    'oak_curled_spring_rim',
    'oak_reinforced_striking_rim',
    'oak_balanced_steel_foot',
    'oak_linen_arm_pad',
    'oak_cross_elbow_brace',
    'oak_layered_catch_strap'
)

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
        if ($min -ge 220 -and ($max - $min) -le 18) {
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

function Save-ResizedPng {
    param(
        [System.Drawing.Bitmap]$Source,
        [string]$Destination,
        [int]$Size
    )

    $target = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($target)
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.DrawImage($Source, 0, 0, $Size, $Size)
    $graphics.Dispose()
    $target.Save($Destination, [System.Drawing.Imaging.ImageFormat]::Png)
    $target.Dispose()
}

function Export-Atlas {
    param(
        [string]$SheetPath,
        [string]$SourceName,
        [string[]]$Names
    )

    Copy-Item -LiteralPath $SheetPath -Destination (Join-Path $SourceDir $SourceName) -Force

    $source = [System.Drawing.Bitmap]::FromFile($SheetPath)
    if ($source.Width -ne $source.Height -or ($source.Width % 3) -ne 0) {
        $source.Dispose()
        throw "Atlas must be a square with dimensions divisible by 3: $SheetPath"
    }

    $sheet = New-Object System.Drawing.Bitmap($source.Width, $source.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $sheetGraphics = [System.Drawing.Graphics]::FromImage($sheet)
    $sheetGraphics.DrawImageUnscaled($source, 0, 0)
    $sheetGraphics.Dispose()
    $source.Dispose()
    Convert-ConnectedLightBackgroundToAlpha $sheet

    $cellSize = [int]($sheet.Width / 3)
    for ($index = 0; $index -lt 9; $index++) {
        [int]$column = $index % 3
        [int]$row = [Math]::Floor($index / 3)
        $sourceRect = [System.Drawing.Rectangle]::new(
            [int]($column * $cellSize),
            [int]($row * $cellSize),
            $cellSize,
            $cellSize
        )
        $tile = $sheet.Clone($sourceRect, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $hiresPath = Join-Path $HiresDir ($Names[$index] + '.png')
        $runtimePath = Join-Path $RuntimeDir ($Names[$index] + '.png')
        $tile.Save($hiresPath, [System.Drawing.Imaging.ImageFormat]::Png)
        Save-ResizedPng -Source $tile -Destination $runtimePath -Size 128
        $tile.Dispose()
    }
    $sheet.Dispose()
}

Export-Atlas -SheetPath $BucklerSheet -SourceName 'forged-duelist-buckler-craft-icons-sheet-v01.png' -Names $BucklerNames
Export-Atlas -SheetPath $OakSheet -SourceName 'oak-garrison-shield-craft-icons-sheet-v01.png' -Names $OakNames

$preview = New-Object System.Drawing.Bitmap(384, 768, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$previewGraphics = [System.Drawing.Graphics]::FromImage($preview)
$previewGraphics.Clear([System.Drawing.Color]::FromArgb(255, 24, 29, 36))
$allNames = @($BucklerNames) + @($OakNames)
for ($index = 0; $index -lt $allNames.Count; $index++) {
    $iconPath = Join-Path $RuntimeDir ($allNames[$index] + '.png')
    $icon = [System.Drawing.Bitmap]::FromFile($iconPath)
    [int]$column = $index % 3
    [int]$row = [Math]::Floor($index / 3)
    $previewGraphics.DrawImageUnscaled($icon, [int]($column * 128), [int]($row * 128))
    $icon.Dispose()
}
$previewGraphics.Dispose()
$preview.Save((Join-Path $TaskRoot 'shield-craft-icons-preview.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$preview.Dispose()

Write-Output "Exported 18 shield craft icons to $TaskRoot"
