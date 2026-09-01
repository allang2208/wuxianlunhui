param(
    [ValidateSet('idle-v2', 'running-v2', 'running-v3', 'attacking-v2', 'attacking-v3', 'attacking-v4', 'dying-v2', 'dying-v3', 'all-v2')]
    [string]$Action = 'all-v2'
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$Python = 'C:\Users\allan\AppData\Local\Programs\Python\Python311\python.exe'
$AiAsset = Join-Path $ProjectRoot 'tools\ai-gen\ai-asset.py'
$IdleReference = Join-Path $PSScriptRoot 'references\idle-keyframe-v02-chroma.png'
$RunningReference = Join-Path $PSScriptRoot 'references\running-keyframe-v02-chroma.png'
$UprightRunningReference = Join-Path $PSScriptRoot 'references\running-keyframe-v03-upright-chroma.png'
$AttackReference = Join-Path $PSScriptRoot 'references\attacking-keyframe-v03-chroma.png'
$LowAttackReference = Join-Path $PSScriptRoot 'references\attacking-keyframe-v04-chroma.png'
$DyingReference = Join-Path $PSScriptRoot 'references\dying-keyframe-v03-chroma.png'
$PromptDir = Join-Path $PSScriptRoot 'prompts'
$VideoDir = Join-Path $PSScriptRoot 'videos'

New-Item -ItemType Directory -Force -Path $VideoDir | Out-Null

function Invoke-H3Action {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$Prompt,
        [Parameter(Mandatory = $true)][string]$FirstFrame,
        [Parameter(Mandatory = $true)][ValidateSet('loop', 'recover', 'one-way')][string]$Mode,
        [Parameter(Mandatory = $true)][string]$Version,
        [Parameter(Mandatory = $true)][int]$Seed
    )

    if (-not (Test-Path -LiteralPath $FirstFrame)) {
        throw "Missing identity-locked H3 first frame: $FirstFrame"
    }
    $Output = Join-Path $VideoDir "$Name-h3-$Version.mp4"
    $Arguments = @(
        $AiAsset, 'video', 'generate',
        '--provider', 'h3',
        '--ref', $FirstFrame,
        '--prompt', $Prompt,
        '--out', $Output,
        '--duration', '5.17',
        '--size', '1024x576',
        '--steps', '20',
        '--seed', [string]$Seed,
        '--candidates', '1',
        '--ref-size', 'max',
        '--bg-color', '#2060E0',
        '--h3-prompt-format', 'h3',
        '--h3-audio-mode', 'visual-only',
        '--h3-visual-profile', 'character-asset',
        '--timeout', '2400'
    )
    if ($Mode -eq 'loop') {
        $Arguments += '--loop'
    } else {
        $Arguments += @('--motion-mode', $Mode)
    }

    Write-Output "[champion-h3] generating $Name mode=$Mode seed=$Seed -> $Output"
    & $Python @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "H3 generation failed for $Name with exit code $LASTEXITCODE"
    }
}

if ($Action -in @('idle-v2', 'all-v2')) {
    Invoke-H3Action -Name 'idle' `
        -Prompt (Join-Path $PromptDir 'idle-h3-v02.txt') `
        -FirstFrame $IdleReference `
        -Mode 'loop' `
        -Version 'v02' `
        -Seed 901721
}

if ($Action -in @('running-v2', 'all-v2')) {
    Invoke-H3Action -Name 'running' `
        -Prompt (Join-Path $PromptDir 'running-h3-v02.txt') `
        -FirstFrame $RunningReference `
        -Mode 'loop' `
        -Version 'v02' `
        -Seed 901722
}

if ($Action -eq 'running-v3') {
    Invoke-H3Action -Name 'running' `
        -Prompt (Join-Path $PromptDir 'running-h3-v03.txt') `
        -FirstFrame $UprightRunningReference `
        -Mode 'loop' `
        -Version 'v03' `
        -Seed 901732
}

if ($Action -in @('attacking-v2', 'all-v2')) {
    Invoke-H3Action -Name 'attacking' `
        -Prompt (Join-Path $PromptDir 'attacking-h3-v02.txt') `
        -FirstFrame $IdleReference `
        -Mode 'recover' `
        -Version 'v02' `
        -Seed 901723
}

if ($Action -eq 'attacking-v3') {
    Invoke-H3Action -Name 'attacking' `
        -Prompt (Join-Path $PromptDir 'attacking-h3-v03.txt') `
        -FirstFrame $AttackReference `
        -Mode 'recover' `
        -Version 'v03' `
        -Seed 901733
}

if ($Action -eq 'attacking-v4') {
    Invoke-H3Action -Name 'attacking' `
        -Prompt (Join-Path $PromptDir 'attacking-h3-v04.txt') `
        -FirstFrame $LowAttackReference `
        -Mode 'recover' `
        -Version 'v04' `
        -Seed 901743
}

if ($Action -in @('dying-v2', 'all-v2')) {
    Invoke-H3Action -Name 'dying' `
        -Prompt (Join-Path $PromptDir 'dying-h3-v02.txt') `
        -FirstFrame $AttackReference `
        -Mode 'one-way' `
        -Version 'v02' `
        -Seed 901724
}

if ($Action -eq 'dying-v3') {
    Invoke-H3Action -Name 'dying' `
        -Prompt (Join-Path $PromptDir 'dying-h3-v03.txt') `
        -FirstFrame $DyingReference `
        -Mode 'one-way' `
        -Version 'v03' `
        -Seed 901734
}
