[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$config = Get-Content -LiteralPath (Join-Path $projectRoot 'public\data\weapon-anim-config.json') -Raw -Encoding utf8 | ConvertFrom-Json
$playerConfig = Get-Content -LiteralPath (Join-Path $projectRoot 'public\data\player-anim-config.json') -Raw -Encoding utf8 | ConvertFrom-Json
$aimConfig = $playerConfig.gun_idle.twist.aimFrames

# Corrected full-ADS geometry: the AKM remains the authored arm baseline, while
# each other long gun may extend the runtime support layer to its own fore-end.
$aimFrameSheet = [System.Drawing.Bitmap]::new((Join-Path $projectRoot ([string]$aimConfig.src)))
$firingHandSheet = [System.Drawing.Bitmap]::new((Join-Path $projectRoot ([string]$aimConfig.firingHandSrc)))
$supportFrameSheet = [System.Drawing.Bitmap]::new((Join-Path $projectRoot ([string]$aimConfig.supportSrc)))
$shotgunSupportFrameSheet = [System.Drawing.Bitmap]::new((Join-Path $projectRoot ([string]$aimConfig.supportVariants.shotgun)))
$aimFrameIndex = [int]$aimConfig.frameCount - 1
$rearConfig = $aimConfig.hands[$aimFrameIndex]
$supportConfig = $aimConfig.supportHands[$aimFrameIndex]
$aimRearHand = [System.Drawing.PointF]::new([single]$rearConfig.x, [single]$rearConfig.y)
$aimSupportHand = [System.Drawing.PointF]::new([single]$supportConfig.x, [single]$supportConfig.y)
$supportWorldX = ($aimSupportHand.X - $aimRearHand.X) * (144.0 / 512.0)
$supportWorldY = ($aimSupportHand.Y - $aimRearHand.Y) * (144.0 / 516.0)

$families = [ordered]@{
    rifles = @(
        [pscustomobject]@{ Label='AKM'; Config='akm'; Texture='weapon_akm'; Runtime='assets\weapons\runtime\weapons\akm-equip.png' },
        [pscustomobject]@{ Label='STG-44'; Config='stg44'; Texture='weapon_stg44'; Runtime='assets\weapons\runtime\weapons\stg44-equip.png' },
        [pscustomobject]@{ Label='M416'; Config='m416'; Texture='weapon_m416'; Runtime='assets\weapons\runtime\weapons\m416-equip.png' },
        [pscustomobject]@{ Label='QBZ-95'; Config='qbz95'; Texture='weapon_qbz95'; Runtime='assets\weapons\runtime\weapons\qbz95-equip.png' },
        [pscustomobject]@{ Label='Frontier Rifle'; Config='frontier_rifle'; Texture='weapon_frontier_rifle'; Runtime='assets\weapons\runtime\weapons\frontier-rifle-equip.png' },
        [pscustomobject]@{ Label='Vengeance Rifle'; Config='vengeance_rifle'; Texture='weapon_vengeance_rifle'; Runtime='assets\weapons\runtime\weapons\vengeance-rifle-equip.png' },
        [pscustomobject]@{ Label='Astral Tide Rifle'; Config='astral_tide_rifle'; Texture='weapon_astral_tide_rifle'; Runtime='assets\weapons\runtime\weapons\astral-tide-rifle-equip.png' },
        [pscustomobject]@{ Label='Zero Point Rifle'; Config='zero_point_rifle'; Texture='weapon_zero_point_rifle'; Runtime='assets\weapons\runtime\weapons\zero-point-arbitrator-equip.png' },
        [pscustomobject]@{ Label='Corona Cadence'; Config='corona_cadence_rifle'; Texture='weapon_corona_cadence_rifle'; Runtime='assets\weapons\runtime\weapons\corona-cadence-rifle-equip.png' },
        [pscustomobject]@{ Label='Terminal Echo'; Config='terminal_echo_rifle'; Texture='weapon_terminal_echo_rifle'; Runtime='assets\weapons\runtime\weapons\terminal-echo-rifle-equip.png' },
        [pscustomobject]@{ Label='QBZ-191'; Config='qbz191'; Texture='weapon_qbz191'; Runtime='assets\weapons\runtime\icons\191icon.png' }
    )
    shotguns = @(
        [pscustomobject]@{ Label='Super90'; Config='shotgun'; Texture='weapon_super90'; Runtime='assets\weapons\runtime\icons\M4s90_icon.png' },
        [pscustomobject]@{ Label='Saiga-12K'; Config='shotgun'; Texture='weapon_saiga12k'; Runtime='assets\weapons\runtime\icons\S12k-icon.png' },
        [pscustomobject]@{ Label='S686'; Config='shotgun'; Texture='weapon_s686'; Runtime='assets\weapons\runtime\weapons\s686-equip.png' },
        [pscustomobject]@{ Label='M870 Breacher'; Config='shotgun'; Texture='weapon_m870_breacher'; Runtime='assets\weapons\runtime\weapons\m870-breacher-equip.png' },
        [pscustomobject]@{ Label='KSG-12'; Config='shotgun'; Texture='weapon_ksg12'; Runtime='assets\weapons\runtime\weapons\ksg12-equip.png' },
        [pscustomobject]@{ Label='SPAS-12'; Config='shotgun'; Texture='weapon_spas12'; Runtime='assets\weapons\runtime\weapons\spas12-equip.png' },
        [pscustomobject]@{ Label='AA-12'; Config='shotgun'; Texture='weapon_aa12'; Runtime='assets\weapons\runtime\weapons\aa12-equip.png' },
        [pscustomobject]@{ Label='Winchester 1887'; Config='shotgun'; Texture='weapon_winchester1887'; Runtime='assets\weapons\runtime\weapons\winchester1887-equip.png' },
        [pscustomobject]@{ Label='Terminus Pendulum'; Config='shotgun'; Texture='weapon_terminus_pendulum'; Runtime='assets\weapons\runtime\weapons\terminus-pendulum-equip.png' },
        [pscustomobject]@{ Label='Void Funeral Tide'; Config='shotgun'; Texture='weapon_void_funeral_tide'; Runtime='assets\weapons\runtime\weapons\void-funeral-tide-equip.png' },
        [pscustomobject]@{ Label='Black Sun Verdict'; Config='shotgun'; Texture='weapon_black_sun_verdict'; Runtime='assets\weapons\runtime\weapons\black-sun-verdict-equip.png' },
        [pscustomobject]@{ Label='Royal Hunt Finale'; Config='shotgun'; Texture='weapon_royal_hunt_finale'; Runtime='assets\weapons\runtime\weapons\royal-hunt-finale-equip.png' }
    )
    machine_guns = @(
        [pscustomobject]@{ Label='PKM'; Config='pkm'; Texture='weapon_pkm'; Runtime='assets\weapons\runtime\icons\pkm_side_clean.png' },
        [pscustomobject]@{ Label='RPD'; Config='rpd'; Texture='weapon_rpd'; Runtime='assets\weapons\runtime\weapons\rpd-equip.png' },
        [pscustomobject]@{ Label='M249'; Config='m249'; Texture='weapon_m249'; Runtime='assets\weapons\runtime\weapons\m249-equip.png' },
        [pscustomobject]@{ Label='Ultimax 100'; Config='ultimax100'; Texture='weapon_ultimax100'; Runtime='assets\weapons\runtime\weapons\ultimax100-equip.png' },
        [pscustomobject]@{ Label='MG42'; Config='mg42'; Texture='weapon_mg42'; Runtime='assets\weapons\runtime\weapons\mg42-equip.png' },
        [pscustomobject]@{ Label='Fusion Core LMG'; Config='fusion_core_lmg'; Texture='weapon_fusion_core_lmg'; Runtime='assets\weapons\runtime\weapons\fusion-core-lmg-equip.png' },
        [pscustomobject]@{ Label='Singularity Loom'; Config='singularity_loom_lmg'; Texture='weapon_singularity_loom_lmg'; Runtime='assets\weapons\runtime\weapons\singularity-loom-lmg-equip.png' },
        [pscustomobject]@{ Label='Celestial Cartographer'; Config='celestial_cartographer_lmg'; Texture='weapon_celestial_cartographer_lmg'; Runtime='assets\weapons\runtime\weapons\celestial-cartographer-lmg-equip.png' },
        [pscustomobject]@{ Label='Grave Covenant'; Config='grave_covenant_cantor_lmg'; Texture='weapon_grave_covenant_cantor_lmg'; Runtime='assets\weapons\runtime\weapons\grave-covenant-cantor-lmg-equip.png' },
        [pscustomobject]@{ Label='QJB-201'; Config='qjb201'; Texture='weapon_qjb201'; Runtime='assets\weapons\runtime\icons\201-icon.png' },
        [pscustomobject]@{ Label='Energy LMG'; Config='energy_lmg'; Texture='weapon_energy_lmg'; Runtime='assets\weapons\runtime\icons\devotion-icon.png' }
    )
}

function Get-RearGrip($entry) {
    $weapon = $config.($entry.Config)
    $textureGripsProperty = $weapon.PSObject.Properties['textureGrips']
    if ($textureGripsProperty -and $textureGripsProperty.Value.PSObject.Properties[$entry.Texture]) {
        return $textureGripsProperty.Value.($entry.Texture)
    }
    return $weapon.grip
}

function Get-SupportGrip($entry) {
    $weapon = $config.($entry.Config)
    $textureSupportProperty = $weapon.PSObject.Properties['textureSupportGrips']
    if ($textureSupportProperty -and $textureSupportProperty.Value.PSObject.Properties[$entry.Texture]) {
        return $textureSupportProperty.Value.($entry.Texture)
    }
    $supportProperty = $weapon.PSObject.Properties['supportGrip']
    if ($supportProperty) { return $supportProperty.Value }
    throw "Missing support grip for $($entry.Config)/$($entry.Texture)"
}

function Get-AimScale($entry) {
    $weapon = $config.($entry.Config)
    if ($weapon.PSObject.Properties['idleScale']) {
        return [double]$weapon.idleScale
    }
    return 1.0
}

function Draw-Marker($graphics, $pen, $x, $y) {
    $graphics.DrawEllipse($pen, [single]($x - 10), [single]($y - 10), 20, 20)
    $graphics.DrawLine($pen, [single]($x - 15), [single]$y, [single]($x + 15), [single]$y)
    $graphics.DrawLine($pen, [single]$x, [single]($y - 15), [single]$x, [single]($y + 15))
}

function Draw-AimFrame($graphics, $x, $y, $familyName) {
    $destination = [System.Drawing.Rectangle]::new($x, $y, 512, 516)
    $source = [System.Drawing.Rectangle]::new($aimFrameIndex * 512, 0, 512, 516)
    $graphics.DrawImage($aimFrameSheet, $destination, $source, [System.Drawing.GraphicsUnit]::Pixel)
    $supportSource = if ($familyName -eq 'shotguns') { $shotgunSupportFrameSheet } else { $supportFrameSheet }
    $graphics.DrawImage($supportSource, $destination, $source, [System.Drawing.GraphicsUnit]::Pixel)
}

function Draw-FiringHand($graphics, $x, $y) {
    $handWidth = [int]$aimConfig.firingHandFrameWidth
    $handHeight = [int]$aimConfig.firingHandFrameHeight
    $anchorX = [double]$aimConfig.firingHandAnchor.x
    $anchorY = [double]$aimConfig.firingHandAnchor.y
    $destination = [System.Drawing.RectangleF]::new(
        [single]($x - $anchorX),
        [single]($y - $anchorY),
        [single]$handWidth,
        [single]$handHeight)
    $source = [System.Drawing.Rectangle]::new($aimFrameIndex * $handWidth, 0, $handWidth, $handHeight)
    $graphics.DrawImage($firingHandSheet, $destination, $source, [System.Drawing.GraphicsUnit]::Pixel)
}

function Get-AlphaMetrics($bitmap, $rear, $support, $aimScale) {
    $minX = $bitmap.Width
    $minY = $bitmap.Height
    $maxX = -1
    $maxY = -1
    $rearPxX = [double]$rear.x * $bitmap.Width
    $rearPxY = [double]$rear.y * $bitmap.Height
    $supportPxX = [double]$support.x * $bitmap.Width
    $supportPxY = [double]$support.y * $bitmap.Height
    $rearNearest = [double]::PositiveInfinity
    $supportNearest = [double]::PositiveInfinity
    $rearNearestX = 0
    $rearNearestY = 0
    $supportNearestX = 0
    $supportNearestY = 0
    # Candidate contact: keep the authored longitudinal fore-end choice, but seek
    # an actual opaque underside near the receiver/handguard height instead of an
    # empty point below the gun. The result is evidence only; config application
    # remains explicit per texture.
    $supportCandidate = [double]::PositiveInfinity
    $supportCandidateX = 0
    $supportCandidateY = 0
    $supportCandidateTargetY = $rearPxY - 0.045 * $bitmap.Height
    $supportUndersideX = 0
    $supportUndersideY = -1
    $supportUndersideDx = [double]::PositiveInfinity
    for ($py = 0; $py -lt $bitmap.Height; $py++) {
        for ($px = 0; $px -lt $bitmap.Width; $px++) {
            if ($bitmap.GetPixel($px, $py).A -le 16) { continue }
            if ($px -lt $minX) { $minX = $px }
            if ($px -gt $maxX) { $maxX = $px }
            if ($py -lt $minY) { $minY = $py }
            if ($py -gt $maxY) { $maxY = $py }
            $rearDistance = [Math]::Sqrt(($px - $rearPxX) * ($px - $rearPxX) + ($py - $rearPxY) * ($py - $rearPxY))
            if ($rearDistance -lt $rearNearest) {
                $rearNearest = $rearDistance
                $rearNearestX = $px
                $rearNearestY = $py
            }
            $supportDistance = [Math]::Sqrt(($px - $supportPxX) * ($px - $supportPxX) + ($py - $supportPxY) * ($py - $supportPxY))
            if ($supportDistance -lt $supportNearest) {
                $supportNearest = $supportDistance
                $supportNearestX = $px
                $supportNearestY = $py
            }
            if ($px -ge $supportPxX - 0.12 * $bitmap.Width -and
                $px -le $supportPxX + 0.12 * $bitmap.Width -and
                $py -ge $rearPxY - 0.14 * $bitmap.Height -and
                $py -le $rearPxY + 0.005 * $bitmap.Height) {
                $candidateDistance = [Math]::Sqrt(
                    ($px - $supportPxX) * ($px - $supportPxX) +
                    ($py - $supportCandidateTargetY) * ($py - $supportCandidateTargetY))
                if ($candidateDistance -lt $supportCandidate) {
                    $supportCandidate = $candidateDistance
                    $supportCandidateX = $px
                    $supportCandidateY = $py
                }
            }
            if ([Math]::Abs($px - $supportPxX) -le 6 -and
                $py -ge $rearPxY - 0.14 * $bitmap.Height -and
                $py -le $rearPxY + 0.005 * $bitmap.Height) {
                $undersideDx = [Math]::Abs($px - $supportPxX)
                if ($py -gt $supportUndersideY -or
                    ($py -eq $supportUndersideY -and $undersideDx -lt $supportUndersideDx)) {
                    $supportUndersideX = $px
                    $supportUndersideY = $py
                    $supportUndersideDx = $undersideDx
                }
            }
        }
    }
    if ($maxX -lt $minX -or $maxY -lt $minY) { throw 'Weapon texture has no visible alpha content' }
    $contentWidth = $maxX - $minX + 1
    $contentHeight = $maxY - $minY + 1
    return [pscustomobject]@{
        x = $minX
        y = $minY
        width = $contentWidth
        height = $contentHeight
        contentWidthRatio = [Math]::Round($contentWidth / [double]$bitmap.Width, 6)
        contentHeightRatio = [Math]::Round($contentHeight / [double]$bitmap.Height, 6)
        effectiveWorldWidth = [Math]::Round(($contentWidth / [double]$bitmap.Width) * 126.0 * $aimScale, 3)
        effectiveWorldHeight = [Math]::Round(($contentHeight / [double]$bitmap.Height) * 126.0 * $aimScale, 3)
        rearNearestAlphaPx = [Math]::Round($rearNearest, 3)
        supportNearestAlphaPx = [Math]::Round($supportNearest, 3)
        rearNearestAlphaPoint = [pscustomobject]@{
            x = $rearNearestX
            y = $rearNearestY
            fx = [Math]::Round($rearNearestX / [double]$bitmap.Width, 6)
            fy = [Math]::Round($rearNearestY / [double]$bitmap.Height, 6)
        }
        supportNearestAlphaPoint = [pscustomobject]@{
            x = $supportNearestX
            y = $supportNearestY
            fx = [Math]::Round($supportNearestX / [double]$bitmap.Width, 6)
            fy = [Math]::Round($supportNearestY / [double]$bitmap.Height, 6)
        }
        supportContactCandidate = [pscustomobject]@{
            x = $supportCandidateX
            y = $supportCandidateY
            fx = [Math]::Round($supportCandidateX / [double]$bitmap.Width, 6)
            fy = [Math]::Round($supportCandidateY / [double]$bitmap.Height, 6)
            searchDistancePx = [Math]::Round($supportCandidate, 3)
        }
        supportUndersideCandidate = [pscustomobject]@{
            x = $supportUndersideX
            y = $supportUndersideY
            fx = [Math]::Round($supportUndersideX / [double]$bitmap.Width, 6)
            fy = [Math]::Round($supportUndersideY / [double]$bitmap.Height, 6)
        }
    }
}

$manifestEntries = [System.Collections.Generic.List[object]]::new()

foreach ($family in $families.GetEnumerator()) {
    $entries = @($family.Value)
    $columns = 4
    $rows = [Math]::Ceiling($entries.Count / $columns)
    $cellWidth = 576
    $cellHeight = 620
    $sheet = [System.Drawing.Bitmap]::new($columns * $cellWidth, $rows * $cellHeight)
    $composite = [System.Drawing.Bitmap]::new($columns * $cellWidth, $rows * $cellHeight)
    $contactCellWidth = 444
    $contactCellHeight = 250
    $contact = [System.Drawing.Bitmap]::new($columns * $contactCellWidth, $rows * $contactCellHeight)
    $graphics = [System.Drawing.Graphics]::FromImage($sheet)
    $compositeGraphics = [System.Drawing.Graphics]::FromImage($composite)
    $contactGraphics = [System.Drawing.Graphics]::FromImage($contact)
    $labelFont = [System.Drawing.Font]::new('Segoe UI', 17, [System.Drawing.FontStyle]::Bold)
    $detailFont = [System.Drawing.Font]::new('Consolas', 12, [System.Drawing.FontStyle]::Regular)
    $rearPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 94, 255, 72), 4)
    $supportPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 255, 166, 48), 4)
    $borderPen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(255, 74, 84, 98), 2)
    try {
        $graphics.Clear([System.Drawing.Color]::FromArgb(255, 31, 36, 44))
        $compositeGraphics.Clear([System.Drawing.Color]::FromArgb(255, 214, 214, 214))
        $contactGraphics.Clear([System.Drawing.Color]::FromArgb(255, 214, 214, 214))
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
        $compositeGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $contactGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
        # Set-StrictMode treats variables first introduced inside the nested
        # weapon try block as unbound on some Windows PowerShell 5.1 builds.
        $closeLeft = 0; $closeTop = 0; $contactScale = 1.5
        $contactRearX = 0; $contactRearY = 0; $contactPoseX = 0; $contactPoseY = 0
        $contactDestination = $null; $contactSource = $null; $contactSupportSource = $null
        $contactGunWidth = 0; $contactGunHeight = 0; $contactGunX = 0; $contactGunY = 0
        $contactHandWidth = 0; $contactHandHeight = 0; $contactHandX = 0; $contactHandY = 0
        $contactHandSource = $null
        for ($index = 0; $index -lt $entries.Count; $index++) {
            $entry = $entries[$index]
            $column = $index % $columns
            $row = [Math]::Floor($index / $columns)
            $cellX = $column * $cellWidth
            $cellY = $row * $cellHeight
            $closeLeft = $column * $contactCellWidth
            $closeTop = $row * $contactCellHeight
            $imageX = $cellX + 32
            $imageY = $cellY + 48
            $graphics.DrawRectangle($borderPen, $cellX + 1, $cellY + 1, $cellWidth - 2, $cellHeight - 2)
            $compositeGraphics.DrawRectangle($borderPen, $cellX + 1, $cellY + 1, $cellWidth - 2, $cellHeight - 2)
            $weaponConfig = $config.($entry.Config)
            $weapon = [System.Drawing.Bitmap]::new((Join-Path $projectRoot $entry.Runtime))
            try {
                $graphics.DrawImage($weapon, $imageX, $imageY, 512, 512)
                $rear = Get-RearGrip $entry
                $support = Get-SupportGrip $entry
                $aimScale = Get-AimScale $entry
                $supportX = [double]$support.x
                $supportY = [double]$support.y
                $alphaMetrics = Get-AlphaMetrics $weapon $rear $support $aimScale
                $visibleWorldX = ($supportX - [double]$rear.x) * 126.0 * $aimScale
                $visibleWorldY = ($supportY - [double]$rear.y) * 126.0 * $aimScale
                if ([double]$alphaMetrics.rearNearestAlphaPx -gt 6.0) {
                    throw "Rear grip is not attached to opaque art: $($entry.Texture) distance=$($alphaMetrics.rearNearestAlphaPx)px"
                }
                if ([double]$alphaMetrics.supportNearestAlphaPx -gt 2.0) {
                    throw "Support grip is not attached to opaque art: $($entry.Texture) distance=$($alphaMetrics.supportNearestAlphaPx)px"
                }
                Draw-Marker $graphics $rearPen ($imageX + [double]$rear.x * 512) ($imageY + [double]$rear.y * 512)
                Draw-Marker $graphics $supportPen ($imageX + $supportX * 512) ($imageY + $supportY * 512)

                $poseX = $cellX + 32
                $poseY = $cellY + 25
                $gunWidth = 126.0 * $aimScale * (512.0 / 144.0)
                $gunHeight = 126.0 * $aimScale * (516.0 / 144.0)
                $gunX = $poseX + $aimRearHand.X - [double]$rear.x * $gunWidth
                $gunY = $poseY + $aimRearHand.Y - [double]$rear.y * $gunHeight
                # 游戏内武器层在手臂条之上；离线合成保持相同遮挡顺序。
                Draw-AimFrame $compositeGraphics $poseX $poseY $family.Key
                $compositeGraphics.DrawImage(
                    $weapon,
                    [System.Drawing.RectangleF]::new([single]$gunX, [single]$gunY, [single]$gunWidth, [single]$gunHeight))
                # 后手抓握层位于武器前景，锚点与 rearGrip 完全重合；枪柄从掌指留白中穿过。
                Draw-FiringHand $compositeGraphics ($poseX + $aimRearHand.X) ($poseY + $aimRearHand.Y)
                Draw-Marker $compositeGraphics $rearPen ($poseX + $aimRearHand.X) ($poseY + $aimRearHand.Y)
                $runtimeSupportX = $poseX + $aimRearHand.X + $visibleWorldX / (144.0 / 512.0)
                $runtimeSupportY = $poseY + $aimRearHand.Y + $visibleWorldY / (144.0 / 516.0)
                Draw-Marker $compositeGraphics $supportPen $runtimeSupportX $runtimeSupportY

                # 不带标记的 1.5×向右接触特写：同一画面同时保留后手包握和前手托举，
                # 便于逐枪检查手掌轮廓是否真的落在后握把/护木，而不只验证坐标公式。
                $contactScale = 1.5
                $contactRearX = $closeLeft + 105.0
                $contactRearY = $closeTop + 105.0
                $contactPoseX = $contactRearX - $aimRearHand.X * $contactScale
                $contactPoseY = $contactRearY - $aimRearHand.Y * $contactScale
                $contactGraphics.SetClip([System.Drawing.Rectangle]::new($closeLeft, $closeTop, $contactCellWidth, $contactCellHeight))
                $contactDestination = [System.Drawing.RectangleF]::new(
                    [single]$contactPoseX, [single]$contactPoseY,
                    [single](512.0 * $contactScale), [single](516.0 * $contactScale))
                $contactSource = [System.Drawing.Rectangle]::new($aimFrameIndex * 512, 0, 512, 516)
                $contactGraphics.DrawImage($aimFrameSheet, $contactDestination, $contactSource, [System.Drawing.GraphicsUnit]::Pixel)
                $contactSupportSource = if ($family.Key -eq 'shotguns') { $shotgunSupportFrameSheet } else { $supportFrameSheet }
                $contactGraphics.DrawImage($contactSupportSource, $contactDestination, $contactSource, [System.Drawing.GraphicsUnit]::Pixel)
                $contactGunWidth = $gunWidth * $contactScale
                $contactGunHeight = $gunHeight * $contactScale
                $contactGunX = $contactRearX - [double]$rear.x * $contactGunWidth
                $contactGunY = $contactRearY - [double]$rear.y * $contactGunHeight
                $contactGraphics.DrawImage(
                    $weapon,
                    [System.Drawing.RectangleF]::new(
                        [single]$contactGunX, [single]$contactGunY,
                        [single]$contactGunWidth, [single]$contactGunHeight))
                $contactHandWidth = [double]$aimConfig.firingHandFrameWidth * $contactScale
                $contactHandHeight = [double]$aimConfig.firingHandFrameHeight * $contactScale
                $contactHandX = $contactRearX - [double]$aimConfig.firingHandAnchor.x * $contactScale
                $contactHandY = $contactRearY - [double]$aimConfig.firingHandAnchor.y * $contactScale
                $contactHandSource = [System.Drawing.Rectangle]::new(
                    $aimFrameIndex * [int]$aimConfig.firingHandFrameWidth,
                    0,
                    [int]$aimConfig.firingHandFrameWidth,
                    [int]$aimConfig.firingHandFrameHeight)
                $contactGraphics.DrawImage(
                    $firingHandSheet,
                    [System.Drawing.RectangleF]::new(
                        [single]$contactHandX, [single]$contactHandY,
                        [single]$contactHandWidth, [single]$contactHandHeight),
                    $contactHandSource,
                    [System.Drawing.GraphicsUnit]::Pixel)
                $contactGraphics.ResetClip()
                $contactGraphics.DrawRectangle($borderPen, $closeLeft + 1, $closeTop + 1, $contactCellWidth - 2, $contactCellHeight - 2)
                $contactGraphics.DrawString($entry.Label, $labelFont, [System.Drawing.Brushes]::Black, $closeLeft + 12, $closeTop + 214)

                $manifestEntries.Add([pscustomobject]@{
                    family = $family.Key
                    config = $entry.Config
                    texture = $entry.Texture
                    idleScale = $aimScale
                    rearGrip = [pscustomobject]@{ x = [double]$rear.x; y = [double]$rear.y }
                    supportGrip = [pscustomobject]@{ x = $supportX; y = $supportY }
                    alpha = $alphaMetrics
                    visibleWorldDx = [Math]::Round($visibleWorldX, 3)
                    visibleWorldDy = [Math]::Round($visibleWorldY, 3)
                    rearAlphaContactPx = [double]$alphaMetrics.rearNearestAlphaPx
                    supportAlphaContactPx = [double]$alphaMetrics.supportNearestAlphaPx
                })
            }
            finally { $weapon.Dispose() }

            $graphics.DrawString($entry.Label, $labelFont, [System.Drawing.Brushes]::White, $cellX + 22, $cellY + 566)
            $graphics.DrawString(
                ('rear {0:0.000},{1:0.000}  support {2:0.000},{3:0.000}' -f [double]$rear.x,[double]$rear.y,$supportX,$supportY),
                $detailFont, [System.Drawing.Brushes]::LightGray, $cellX + 215, $cellY + 570)
            $compositeGraphics.DrawString($entry.Label, $labelFont, [System.Drawing.Brushes]::Black, $cellX + 22, $cellY + 566)
            $compositeGraphics.DrawString('green=rear hand  orange=support hand', $detailFont, [System.Drawing.Brushes]::DimGray, $cellX + 215, $cellY + 570)
        }
        $output = Join-Path $PSScriptRoot ("corrected-support-grips-{0}.png" -f $family.Key)
        $sheet.Save($output, [System.Drawing.Imaging.ImageFormat]::Png)
        Write-Output $output
        $compositeOutput = Join-Path $PSScriptRoot ("corrected-aim-composite-{0}.png" -f $family.Key)
        $composite.Save($compositeOutput, [System.Drawing.Imaging.ImageFormat]::Png)
        Write-Output $compositeOutput
        $contactOutput = Join-Path $PSScriptRoot ("right-grip-contact-closeups-{0}.png" -f $family.Key)
        $contact.Save($contactOutput, [System.Drawing.Imaging.ImageFormat]::Png)
        Write-Output $contactOutput
    }
    finally {
        $rearPen.Dispose(); $supportPen.Dispose(); $borderPen.Dispose()
        $labelFont.Dispose(); $detailFont.Dispose(); $graphics.Dispose(); $compositeGraphics.Dispose(); $contactGraphics.Dispose(); $sheet.Dispose(); $composite.Dispose(); $contact.Dispose()
    }
}

[pscustomobject]@{
    referenceFrame = 'gun_aim_arm_frames:13 + gun_aim_firing_hand_frames:13'
    rearHand = [pscustomobject]@{ x = $aimRearHand.X; y = $aimRearHand.Y }
    supportHand = [pscustomobject]@{ x = $aimSupportHand.X; y = $aimSupportHand.Y }
    supportWorldDelta = [pscustomobject]@{ x = $supportWorldX; y = $supportWorldY }
    invariant = 'rear grip and support grip must both contact opaque weapon art; rendered rear grip drives the firing hand'
    entries = $manifestEntries
} | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'corrected-support-grip-audit.json') -Encoding utf8

$aimFrameSheet.Dispose()
$firingHandSheet.Dispose()
$supportFrameSheet.Dispose()
$shotgunSupportFrameSheet.Dispose()
