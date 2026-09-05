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
$referenceDir = Join-Path $root 'references'
$videoDir = Join-Path $root 'videos'
New-Item -ItemType Directory -Force -Path $videoDir | Out-Null

$jobs = @(
    @{ Name = '01-snow-sepulcher-carrier-advance'; Prompt = '01-snow-sepulcher-carrier-advance-h3-v01.txt'; Ref = '01-snow-sepulcher-carrier-locomotion-1024x576.png'; Seed = 9041101 },
    @{ Name = '02-aurora-fate-weaver-seek-band'; Prompt = '02-aurora-fate-weaver-seek-band-h3-v01.txt'; Ref = '02-aurora-fate-weaver-locomotion-1024x576.png'; Seed = 9041201 },
    @{ Name = '03-white-silence-bell-hart-stride'; Prompt = '03-white-silence-bell-hart-stride-h3-v01.txt'; Ref = '03-white-silence-bell-hart-locomotion-1024x576.png'; Seed = 9041301 },
    @{ Name = '04-permafrost-chasm-maw-crawl'; Prompt = '04-permafrost-chasm-maw-crawl-h3-v01.txt'; Ref = '04-permafrost-chasm-maw-locomotion-1024x576.png'; Seed = 9041401 },
    @{ Name = '05-frozen-sun-core-relic-cold-move'; Prompt = '05-frozen-sun-core-relic-cold-move-h3-v01.txt'; Ref = '05-frozen-sun-core-relic-cold-move-1024x576.png'; Seed = 9041501 }
)

foreach ($job in $jobs) {
    $promptPath = Join-Path $promptDir $job.Prompt
    $referencePath = Join-Path $referenceDir $job.Ref
    $outputPath = Join-Path $videoDir ("{0}-h3-v01.mp4" -f $job.Name)
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
        '--h3-visual-profile', 'character-asset',
        '--loop'
    )
    if ($DryRun) {
        $arguments += '--dry-run'
    }
    & $py @arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$($job.Name) failed with exit code $LASTEXITCODE"
    }
    Write-Output "[$(Get-Date -Format s)] DONE $($job.Name) -> $outputPath"
}
