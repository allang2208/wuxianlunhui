$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$sourceRoot = 'C:\Users\allan\.codex\generated_images\01a03cbc-b711-7dc2-879e-83a11d28e863'
$targetRoot = 'E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\icons\craft-cold-steel'

$icons = [ordered]@{
    'exec-dc070bc4-8a2d-4cba-bec9-3960b93037d1.png' = 'stamped_receiver_tuning.png'
    'exec-560fdc1a-1508-417d-a19c-e13a9aad9113.png' = 'walnut_fixed_stock.png'
    'exec-d50b7f99-37d3-4798-9258-f3de7138a789.png' = 'kurz_792_heavy.png'
    'exec-84cd0284-a916-4a73-b840-1302f21f4f92.png' = 'qbz191_freefloat_handguard.png'
    'exec-df8f61b8-f295-41bc-87e9-c4c583e4fe69.png' = 'qbz191_high_speed_trigger.png'
    'exec-52d10e25-2c5a-4d2b-ba07-c884adabc70b.png' = 'dbp191_high_velocity.png'
    'exec-86f01c13-5cda-4d3e-a28a-f4c8ef766321.png' = 'qbz95_gas_tuning.png'
    'exec-3f8a8d49-9336-48d1-8582-eebb4c1fddfa.png' = 'qbz95_grip_insert.png'
    'exec-ac0d64ab-32a5-4e7c-83ae-94a4419eafd3.png' = 'qbz95_rubber_buttpad.png'
    'exec-9296d990-aa69-4635-8cae-052f2d70632a.png' = 'dbp87_balanced_round.png'
}

New-Item -ItemType Directory -Force -Path $targetRoot | Out-Null

foreach ($entry in $icons.GetEnumerator()) {
    $source = Join-Path $sourceRoot $entry.Key
    $target = Join-Path $targetRoot $entry.Value
    if (-not (Test-Path -LiteralPath $source)) {
        throw "Missing generated icon: $source"
    }

    $inputImage = [System.Drawing.Image]::FromFile($source)
    try {
        $outputImage = New-Object System.Drawing.Bitmap 209, 209, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        try {
            $graphics = [System.Drawing.Graphics]::FromImage($outputImage)
            try {
                $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
                $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
                $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
                $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                $graphics.DrawImage($inputImage, 0, 0, 209, 209)
            }
            finally {
                $graphics.Dispose()
            }
            $outputImage.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
        }
        finally {
            $outputImage.Dispose()
        }
    }
    finally {
        $inputImage.Dispose()
    }
}

Write-Output "Finalized $($icons.Count) rifle modification icons into $targetRoot"
