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
    @{ Name = 'idle'; Prompt = 'idle-h3-v01.txt'; Ref = 'rot-tide-toad-general-safe-white-1024x576.png'; Seed = 829101; Mode = 'loop' },
    @{ Name = 'moving'; Prompt = 'moving-h3-v01.txt'; Ref = 'rot-tide-toad-general-safe-white-1024x576.png'; Seed = 829102; Mode = 'loop' },
    @{ Name = 'attacking'; Prompt = 'attacking-h3-v01.txt'; Ref = 'rot-tide-toad-attack-safe-white-1024x576.png'; Seed = 829103; Mode = 'recover' },
    @{ Name = 'dying'; Prompt = 'dying-h3-v01.txt'; Ref = 'rot-tide-toad-general-safe-white-1024x576.png'; Seed = 829104; Mode = 'one-way' }
)

foreach ($job in $jobs) {
    $promptPath = Join-Path $promptDir $job.Prompt
    $referencePath = Join-Path $referenceDir $job.Ref
    $outputPath = Join-Path $videoDir ("rot-tide-toad-{0}-h3-v01.mp4" -f $job.Name)
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
