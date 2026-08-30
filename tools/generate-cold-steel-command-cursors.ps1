$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Add-Type -AssemblyName System.Drawing

$outputDir = Join-Path $PSScriptRoot '..\assets\ui\cursors'
$outputDir = [System.IO.Path]::GetFullPath($outputDir)
[System.IO.Directory]::CreateDirectory($outputDir) | Out-Null

function New-Color([string]$hex) {
    return [System.Drawing.ColorTranslator]::FromHtml($hex)
}

function New-PointArray([double[][]]$coordinates) {
    [System.Drawing.PointF[]]$points = foreach ($coordinate in $coordinates) {
        [System.Drawing.PointF]::new([single]$coordinate[0], [single]$coordinate[1])
    }
    return $points
}

function Draw-LayeredLine($graphics, [System.Drawing.PointF[]]$points, [string]$accent, [single]$outerWidth = 7, [single]$steelWidth = 4, [single]$accentWidth = 1.4) {
    $outer = [System.Drawing.Pen]::new((New-Color '#10151a'), $outerWidth)
    $steel = [System.Drawing.Pen]::new((New-Color '#aeb7bf'), $steelWidth)
    $inner = [System.Drawing.Pen]::new((New-Color $accent), $accentWidth)
    try {
        foreach ($pen in @($outer, $steel, $inner)) {
            $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
            $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
            $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Miter
            $graphics.DrawLines($pen, $points)
        }
    } finally {
        $outer.Dispose()
        $steel.Dispose()
        $inner.Dispose()
    }
}

function Draw-LayeredPolygon($graphics, [System.Drawing.PointF[]]$points, [string]$fill, [string]$accent) {
    $brush = [System.Drawing.SolidBrush]::new((New-Color $fill))
    $outer = [System.Drawing.Pen]::new((New-Color '#0b1015'), 5)
    $steel = [System.Drawing.Pen]::new((New-Color '#c1c9cf'), 2.2)
    $inner = [System.Drawing.Pen]::new((New-Color $accent), 0.9)
    try {
        $outer.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Miter
        $steel.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Miter
        $inner.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Miter
        $graphics.FillPolygon($brush, $points)
        $graphics.DrawPolygon($outer, $points)
        $graphics.DrawPolygon($steel, $points)
        $graphics.DrawPolygon($inner, $points)
    } finally {
        $brush.Dispose()
        $outer.Dispose()
        $steel.Dispose()
        $inner.Dispose()
    }
}

function Draw-LayeredEllipse($graphics, [single]$x, [single]$y, [single]$width, [single]$height, [string]$accent, [single]$outerWidth = 6, [single]$steelWidth = 3.4, [single]$accentWidth = 1.2) {
    $outer = [System.Drawing.Pen]::new((New-Color '#10151a'), $outerWidth)
    $steel = [System.Drawing.Pen]::new((New-Color '#aeb7bf'), $steelWidth)
    $inner = [System.Drawing.Pen]::new((New-Color $accent), $accentWidth)
    try {
        $graphics.DrawEllipse($outer, $x, $y, $width, $height)
        $graphics.DrawEllipse($steel, $x, $y, $width, $height)
        $graphics.DrawEllipse($inner, $x, $y, $width, $height)
    } finally {
        $outer.Dispose()
        $steel.Dispose()
        $inner.Dispose()
    }
}

function Draw-Hotspot($graphics, [single]$x, [single]$y, [string]$accent) {
    $outer = [System.Drawing.SolidBrush]::new((New-Color '#0a0f14'))
    $steel = [System.Drawing.SolidBrush]::new((New-Color '#d7dde2'))
    $inner = [System.Drawing.SolidBrush]::new((New-Color $accent))
    try {
        $graphics.FillEllipse($outer, $x - 4.5, $y - 4.5, 9, 9)
        $graphics.FillEllipse($steel, $x - 2.8, $y - 2.8, 5.6, 5.6)
        $graphics.FillEllipse($inner, $x - 1.35, $y - 1.35, 2.7, 2.7)
    } finally {
        $outer.Dispose()
        $steel.Dispose()
        $inner.Dispose()
    }
}

function Save-Cursor([string]$name, [scriptblock]$draw) {
    $bitmap = [System.Drawing.Bitmap]::new(48, 48, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        & $draw $graphics
        $path = Join-Path $outputDir $name
        $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
        Write-Output $path
    } finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

Save-Cursor 'attack-move-cold-steel.png' {
    param($g)
    $arrow = New-PointArray @(
        @(24, 4), @(39, 19), @(31, 19), @(31, 29),
        @(17, 29), @(17, 19), @(9, 19)
    )
    Draw-LayeredPolygon $g $arrow '#6f2f31' '#d95d58'
    Draw-LayeredLine $g (New-PointArray @(@(12, 38), @(35, 15))) '#e46b62' 6 3.6 1.2
    Draw-LayeredLine $g (New-PointArray @(@(11, 31), @(19, 39))) '#e46b62' 5 3 1
    Draw-Hotspot $g 24 24 '#e46b62'
}

Save-Cursor 'patrol-cold-steel.png' {
    param($g)
    Draw-LayeredLine $g (New-PointArray @(@(9, 18), @(15, 11), @(31, 11), @(38, 18))) '#d5a84d' 6 3.6 1.2
    Draw-LayeredPolygon $g (New-PointArray @(@(38, 12), @(43, 19), @(35, 21))) '#735d2d' '#e0b85c'
    Draw-LayeredLine $g (New-PointArray @(@(39, 30), @(33, 37), @(17, 37), @(10, 30))) '#d5a84d' 6 3.6 1.2
    Draw-LayeredPolygon $g (New-PointArray @(@(10, 36), @(5, 29), @(13, 27))) '#735d2d' '#e0b85c'
    Draw-Hotspot $g 24 24 '#e0b85c'
}

Save-Cursor 'rally-cold-steel.png' {
    param($g)
    Draw-LayeredLine $g (New-PointArray @(@(20, 41), @(20, 7))) '#d5a84d' 6 3.6 1.2
    Draw-LayeredPolygon $g (New-PointArray @(@(22, 8), @(41, 13), @(32, 21), @(22, 19))) '#71602f' '#e2bd62'
    Draw-LayeredPolygon $g (New-PointArray @(@(20, 36), @(27, 42), @(13, 42))) '#4d4430' '#e2bd62'
    Draw-Hotspot $g 20 41 '#e2bd62'
}

Save-Cursor 'attack-target-cold-steel.png' {
    param($g)
    Draw-LayeredEllipse $g 8 8 32 32 '#e05b58' 6 3.5 1.3
    Draw-LayeredLine $g (New-PointArray @(@(24, 3), @(24, 15))) '#e05b58' 6 3.4 1.2
    Draw-LayeredLine $g (New-PointArray @(@(24, 33), @(24, 45))) '#e05b58' 6 3.4 1.2
    Draw-LayeredLine $g (New-PointArray @(@(3, 24), @(15, 24))) '#e05b58' 6 3.4 1.2
    Draw-LayeredLine $g (New-PointArray @(@(33, 24), @(45, 24))) '#e05b58' 6 3.4 1.2
    Draw-Hotspot $g 24 24 '#ff7770'
}

Save-Cursor 'invalid-command-cold-steel.png' {
    param($g)
    Draw-LayeredEllipse $g 8 8 32 32 '#dc4f4c' 7 4 1.4
    Draw-LayeredLine $g (New-PointArray @(@(12, 36), @(36, 12))) '#dc4f4c' 8 4.8 1.6
    Draw-Hotspot $g 24 24 '#ff6d67'
}

Save-Cursor 'recycle-cold-steel.png' {
    param($g)
    $head = New-PointArray @(@(10, 12), @(29, 12), @(33, 17), @(29, 24), @(10, 24), @(7, 20), @(7, 16))
    Draw-LayeredPolygon $g $head '#6f3030' '#d85b55'
    Draw-LayeredLine $g (New-PointArray @(@(27, 22), @(40, 38))) '#c96159' 8 4.6 1.5
    Draw-LayeredLine $g (New-PointArray @(@(11, 31), @(17, 27))) '#e5b35a' 5 2.8 1
    Draw-LayeredLine $g (New-PointArray @(@(8, 25), @(14, 24))) '#e5b35a' 5 2.8 1
    Draw-Hotspot $g 24 20 '#ff7168'
}
