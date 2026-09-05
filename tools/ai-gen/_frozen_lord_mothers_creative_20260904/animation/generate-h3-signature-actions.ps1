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
$actionReferenceDir = Join-Path $root 'action-references'
$locomotionReferenceDir = Join-Path $root 'references'
$videoDir = Join-Path $root 'videos'
New-Item -ItemType Directory -Force -Path $videoDir | Out-Null

$jobs = @(
    @{ Name = '01-snow-sepulcher-carrier-plow'; Prompt = '01-snow-sepulcher-carrier-plow-h3-v01.txt'; Ref = (Join-Path $actionReferenceDir '01-snow-sepulcher-carrier-plow-prepare-1024x576.png'); Seed = 9042101; Mode = 'recover' },
    @{ Name = '02-aurora-fate-weaver-triangle'; Prompt = '02-aurora-fate-weaver-triangle-h3-v01.txt'; Ref = (Join-Path $actionReferenceDir '02-aurora-fate-weaver-triangle-prepare-1024x576.png'); Seed = 9042201; Mode = 'recover' },
    @{ Name = '03-white-silence-bell-hart-double-toll'; Prompt = '03-white-silence-bell-hart-double-toll-h3-v01.txt'; Ref = (Join-Path $actionReferenceDir '03-white-silence-bell-hart-double-toll-prepare-1024x576.png'); Seed = 9042301; Mode = 'recover' },
    @{ Name = '05-frozen-sun-core-relic-cold-idle'; Prompt = '05-frozen-sun-core-relic-cold-idle-h3-v01.txt'; Ref = (Join-Path $locomotionReferenceDir '05-frozen-sun-core-relic-cold-move-1024x576.png'); Seed = 9042501; Mode = 'loop' }
)

foreach ($job in $jobs) {
    $promptPath = Join-Path $promptDir $job.Prompt
    $outputPath = Join-Path $videoDir ("{0}-h3-v01.mp4" -f $job.Name)
    Write-Output "[$(Get-Date -Format s)] START $($job.Name)"
    $arguments = @(
        $aiAsset,
        'video', 'generate',
        '--provider', 'h3',
        '--ref', $job.Ref,
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
