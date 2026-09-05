param(
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$gameDev = (Resolve-Path (Join-Path $root '..\..\..\..')).Path
$workspaceParent = Split-Path $gameDev -Parent
$py = Join-Path $workspaceParent 'ComfyUI\.venv\Scripts\python.exe'
$aiAsset = Join-Path $gameDev 'tools\ai-gen\ai-asset.py'
$promptDir = Join-Path $root 'prompts'
$referenceDir = Join-Path $root 'action-references'
$videoDir = Join-Path $root 'videos'
New-Item -ItemType Directory -Force -Path $videoDir | Out-Null

$jobs = @(
    @{ Name = '01-snow-sepulcher-carrier-plow-windup-h3-v02'; Prompt = '01-snow-sepulcher-carrier-plow-windup-h3-v02.txt'; Ref = '01-snow-sepulcher-carrier-plow-windup-v02-1024x576.png'; Seed = 9042102; Mode = 'recover' },
    @{ Name = '02-aurora-fate-weaver-body-cast-h3-v02'; Prompt = '02-aurora-fate-weaver-body-cast-h3-v02.txt'; Ref = '02-aurora-fate-weaver-body-cast-v02-1024x576.png'; Seed = 9042202; Mode = 'recover' },
    @{ Name = '05-frozen-sun-core-relic-cold-idle-h3-v02'; Prompt = '05-frozen-sun-core-relic-cold-idle-h3-v02.txt'; Ref = '05-frozen-sun-core-relic-cold-idle-v02-1024x576.png'; Seed = 9042502; Mode = 'loop' }
)

foreach ($job in $jobs) {
    $promptPath = Join-Path $promptDir $job.Prompt
    $referencePath = Join-Path $referenceDir $job.Ref
    $outputPath = Join-Path $videoDir ("{0}.mp4" -f $job.Name)
    Write-Output "[$(Get-Date -Format s)] START $($job.Name)"
    $arguments = @(
        $aiAsset,
        'video', 'generate',
        '--provider', 'h3',
        '--ref', $referencePath,
        '--prompt', $promptPath,
        '--out', $outputPath,
        '--duration', '5.17',
        '--size', '1024x576',
        '--steps', '20',
        '--seed', [string]$job.Seed,
        '--bg-color', '#FFFFFF',
        '--timeout', '2400',
        '--candidates', '1',
        '--h3-audio-mode', 'visual-only',
        '--h3-visual-profile', 'character-asset'
    )
    if ($job.Mode -eq 'loop') {
        $arguments += '--loop'
    } else {
        $arguments += @('--motion-mode', $job.Mode)
    }
    if ($DryRun) {
        $arguments += '--dry-run'
    }
    & $py @arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$($job.Name) failed with exit code $LASTEXITCODE"
    }
    Write-Output "[$(Get-Date -Format s)] DONE $($job.Name) -> $outputPath"
}
