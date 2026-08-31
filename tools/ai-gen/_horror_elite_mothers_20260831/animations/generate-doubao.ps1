param([Parameter(Mandatory=$true)][int]$Index)
$ErrorActionPreference = 'Stop'
$animationRoot = $PSScriptRoot
$workspaceRoot = (Resolve-Path (Join-Path $animationRoot '../../../..')).Path
$pythonPath = (Resolve-Path (Join-Path $workspaceRoot '../ComfyUI/.venv/Scripts/python.exe')).Path
$manifestPath = Join-Path $animationRoot 'task-index.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding utf8 | ConvertFrom-Json
if ($Index -lt 0 -or $Index -ge $manifest.jobs.Count) { throw 'Job index out of range.' }
$job = $manifest.jobs[$Index]
if ($manifest.activeAsset -and $job.asset -ne $manifest.activeAsset) {
    $activeJobs = @($manifest.jobs | Where-Object { $_.asset -eq $manifest.activeAsset })
    $unfinished = @($activeJobs | Where-Object { $_.status -ne 'source_delivered_user_review_pending' })
    if ($activeJobs.Count -ne 4 -or $unfinished.Count -gt 0 -or -not $manifest.activeAssetOverviewDelivered) {
        throw 'Finish all four active-character sources and their overview before submitting the next character.'
    }
}
$reference = (Resolve-Path (Join-Path $animationRoot $job.mother)).Path
$prompt = (Resolve-Path (Join-Path $animationRoot $job.promptFile)).Path
$output = [IO.Path]::GetFullPath((Join-Path $animationRoot $job.video))
if (Test-Path -LiteralPath $output) { throw 'Video exists. No duplicate submission.' }
if ($job.status -ne 'prepared') { throw 'Job is not prepared. Inspect existing submission before any retry.' }
New-Item -ItemType Directory -Force (Split-Path -Parent $output) | Out-Null
$fillArgs = @((Join-Path $workspaceRoot 'tools/ai-gen/doubao-seedance-gen.mjs'), '--attach-only', '--new-chat', '--fill-only', '--ref', $reference, '--prompt-file', $prompt, '--out', $output, '--duration', '5', '--size', '1280x720', '--cdp-port', '9333')
if ($job.loop) { $fillArgs += '--loop' }
& node @fillArgs
if ($LASTEXITCODE -ne 0) { throw 'Preparation failed; nothing submitted by this runner.' }
$job.status = 'submission_started_result_pending'
$manifest | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $manifestPath -Encoding utf8
$genArgs = @((Join-Path $workspaceRoot 'tools/ai-gen/ai-asset.py'), 'video', 'generate', '--provider', 'doubao', '--doubao-attach-only', '--ref', $reference, '--prompt', $prompt, '--out', $output, '--duration', '5', '--size', '1280x720', '--candidates', '1', '--timeout', '1200')
if ($job.loop) { $genArgs += '--loop' }
elseif ($job.state -eq 'dying') { $genArgs += @('--motion-mode', 'one-way') }
else { $genArgs += @('--motion-mode', 'recover') }
& $pythonPath @genArgs
if ($LASTEXITCODE -ne 0) { throw 'Generation interrupted or uncertain; inspect before retry. No automatic resubmission.' }
$job.status = 'downloaded_pending_visual_review'
$manifest | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $manifestPath -Encoding utf8
& $pythonPath (Join-Path $animationRoot 'build-video-previews.py') --video $output
if ($LASTEXITCODE -ne 0) { throw 'Video exists; preview failed. Do not regenerate the source video.' }
Write-Output "Completed: $($job.asset)/$($job.state)"
