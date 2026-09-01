$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
$python = 'E:\无尽轮回\长期备份\2026-7-13-1\ComfyUI\.venv\Scripts\python.exe'
$entrypoint = Join-Path $projectRoot 'tools\ai-gen\ai-asset.py'
$taskRoot = $PSScriptRoot
$videoDir = Join-Path $taskRoot 'videos'
New-Item -ItemType Directory -Force -Path $videoDir | Out-Null

$jobs = @(
    @{ Name='oil-technician-idle'; Ref='h3-references\oil-technician-idle-h3-ref-v01.png'; Prompt='prompts\oil-technician-idle-h3-v01.txt'; Out='videos\oil-technician-idle-h3-v01.mp4'; Seed=901711; Mode='loop' },
    @{ Name='oil-technician-walking'; Ref='h3-references\oil-technician-walking-h3-ref-v01.png'; Prompt='prompts\oil-technician-walking-h3-v01.txt'; Out='videos\oil-technician-walking-h3-v01.mp4'; Seed=901712; Mode='loop' },
    @{ Name='oil-technician-maintaining'; Ref='h3-references\oil-technician-maintaining-h3-ref-v01.png'; Prompt='prompts\oil-technician-maintaining-h3-v01.txt'; Out='videos\oil-technician-maintaining-h3-v01.mp4'; Seed=901713; Mode='loop' },
    @{ Name='cannery-worker-idle'; Ref='h3-references\cannery-worker-idle-h3-ref-v01.png'; Prompt='prompts\cannery-worker-idle-h3-v01.txt'; Out='videos\cannery-worker-idle-h3-v01.mp4'; Seed=901714; Mode='loop' },
    @{ Name='cannery-worker-walking'; Ref='h3-references\cannery-worker-walking-h3-ref-v01.png'; Prompt='prompts\cannery-worker-walking-h3-v01.txt'; Out='videos\cannery-worker-walking-h3-v01.mp4'; Seed=901715; Mode='loop' },
    @{ Name='cannery-worker-inspecting'; Ref='h3-references\cannery-worker-inspecting-h3-ref-v01.png'; Prompt='prompts\cannery-worker-inspecting-h3-v01.txt'; Out='videos\cannery-worker-inspecting-h3-v01.mp4'; Seed=901716; Mode='loop' },
    @{ Name='trade-clerk-idle'; Ref='h3-references\trade-clerk-idle-h3-ref-v01.png'; Prompt='prompts\trade-clerk-idle-h3-v01.txt'; Out='videos\trade-clerk-idle-h3-v01.mp4'; Seed=901717; Mode='loop' },
    @{ Name='trade-clerk-walking'; Ref='h3-references\trade-clerk-walking-h3-ref-v01.png'; Prompt='prompts\trade-clerk-walking-h3-v01.txt'; Out='videos\trade-clerk-walking-h3-v01.mp4'; Seed=901718; Mode='loop' },
    @{ Name='trade-clerk-negotiating'; Ref='h3-references\trade-clerk-negotiating-h3-ref-v02.png'; Prompt='prompts\trade-clerk-negotiating-h3-v02.txt'; Out='videos\trade-clerk-negotiating-h3-v02.mp4'; Seed=901729; Mode='recover' }
)

$startedAt = Get-Date
foreach ($job in $jobs) {
    $output = Join-Path $taskRoot $job.Out
    if (Test-Path -LiteralPath $output) {
        Write-Output "[industrial-workers] skip existing $($job.Name): $output"
        continue
    }
    Write-Output "[industrial-workers] start $($job.Name) seed=$($job.Seed) mode=$($job.Mode)"
    $arguments = @(
        $entrypoint, 'video', 'generate',
        '--provider', 'h3',
        '--ref', (Join-Path $taskRoot $job.Ref),
        '--prompt', (Join-Path $taskRoot $job.Prompt),
        '--out', $output,
        '--duration', '5.17',
        '--size', '1024x576',
        '--steps', '20',
        '--candidates', '1',
        '--seed', [string]$job.Seed,
        '--bg-color', '#FFFFFF',
        '--timeout', '3600',
        '--h3-prompt-format', 'h3',
        '--h3-audio-mode', 'visual-only',
        '--h3-visual-profile', 'character-asset'
    )
    if ($job.Mode -eq 'loop') {
        $arguments += '--loop'
    } else {
        $arguments += @('--motion-mode', $job.Mode)
    }
    & $python @arguments
    if ($LASTEXITCODE -ne 0) {
        throw "MiniMax H3 generation failed for $($job.Name) with exit code $LASTEXITCODE"
    }
    Write-Output "[industrial-workers] completed $($job.Name)"
}

$elapsed = (Get-Date) - $startedAt
Write-Output ("[industrial-workers] all jobs completed in {0:N1} minutes" -f $elapsed.TotalMinutes)
