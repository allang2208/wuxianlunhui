param(
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$gameDev = (Resolve-Path (Join-Path $root '..\..\..')).Path
$workspaceParent = Split-Path $gameDev -Parent
$py = Join-Path $workspaceParent 'ComfyUI\.venv\Scripts\python.exe'
$aiAsset = Join-Path $gameDev 'tools\ai-gen\ai-asset.py'
$promptDir = Join-Path $root 'prompts'
$referenceDir = Join-Path $root 'references'
$videoDir = Join-Path $root 'videos'
New-Item -ItemType Directory -Force -Path $videoDir | Out-Null

$jobs = @(
    @{ Name = 'idle'; Prompt = 'idle-v01.txt'; Ref = 'red-wolf-normal-cyan.png'; Seed = 827501; Loop = $true },
    @{ Name = 'running'; Prompt = 'running-v01.txt'; Ref = 'red-wolf-forward-cyan.png'; Seed = 827502; Loop = $true },
    @{ Name = 'attack-bite'; Prompt = 'attack-bite-v01.txt'; Ref = 'red-wolf-forward-cyan.png'; Seed = 827503; Loop = $true },
    @{ Name = 'pounce'; Prompt = 'pounce-v01.txt'; Ref = 'red-wolf-pounce-cyan.png'; Seed = 827504; Loop = $true },
    @{ Name = 'howl'; Prompt = 'howl-v01.txt'; Ref = 'red-wolf-normal-cyan.png'; Seed = 827505; Loop = $true },
    @{ Name = 'dying'; Prompt = 'dying-v01.txt'; Ref = 'red-wolf-normal-cyan.png'; Seed = 827506; Loop = $false }
)

foreach ($job in $jobs) {
    $promptPath = Join-Path $promptDir $job.Prompt
    $referencePath = Join-Path $referenceDir $job.Ref
    $outputPath = Join-Path $videoDir ("red-wolf-{0}-h3-v01.mp4" -f $job.Name)
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
        '--steps', '16',
        '--seed', [string]$job.Seed,
        '--bg-color', '#00D9FF',
        '--timeout', '2400'
    )
    if ($job.Loop) {
        $arguments += '--loop'
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
