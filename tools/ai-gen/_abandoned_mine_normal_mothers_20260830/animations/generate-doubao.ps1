param(
    [int]$StartIndex = 1,
    [int]$EndIndex = 7
)

$ErrorActionPreference = 'Stop'
$animationRoot = $PSScriptRoot
$workspaceRoot = (Resolve-Path (Join-Path $animationRoot '../../../..')).Path
$pythonPath = (Resolve-Path (Join-Path $workspaceRoot '../ComfyUI/.venv/Scripts/python.exe')).Path
$assetEntry = Join-Path $workspaceRoot 'tools/ai-gen/ai-asset.py'
$doubaoEntry = Join-Path $workspaceRoot 'tools/ai-gen/doubao-seedance-gen.mjs'
$previewEntry = Join-Path $animationRoot 'build-video-previews.py'
$animationManifest = Get-Content -LiteralPath (Join-Path $animationRoot 'task-index.json') -Raw | ConvertFrom-Json

if ($StartIndex -lt 0 -or $EndIndex -ge $animationManifest.jobs.Count -or $EndIndex -lt $StartIndex) {
    throw 'Requested job range is outside the eight-action batch.'
}

for ($animationIndex = $StartIndex; $animationIndex -le $EndIndex; $animationIndex++) {
    $animationJob = $animationManifest.jobs[$animationIndex]
    $referencePath = (Resolve-Path (Join-Path $animationRoot $animationJob.mother)).Path
    $promptPath = (Resolve-Path (Join-Path $animationRoot $animationJob.promptFile)).Path
    $videoPath = [IO.Path]::GetFullPath((Join-Path $animationRoot $animationJob.video))
    if (Test-Path -LiteralPath $videoPath) {
        throw "Candidate already exists; refusing overwrite or duplicate submission: $videoPath"
    }
    Write-Output "Preparing action $($animationIndex + 1)/8: $($animationJob.asset) $($animationJob.state)"

    $fillArguments = @($doubaoEntry, '--attach-only', '--new-chat', '--fill-only',
        '--ref', $referencePath, '--prompt-file', $promptPath, '--out', $videoPath,
        '--duration', '5', '--size', '1024x576', '--cdp-port', '9333')
    if ($animationJob.loop) { $fillArguments += '--loop' }
    & node @fillArguments
    if ($LASTEXITCODE -ne 0) {
        throw "Prompt preparation failed. No further action will be submitted: $($animationJob.asset) $($animationJob.state)"
    }

    $generationArguments = @($assetEntry, 'video', 'generate', '--provider', 'doubao',
        '--doubao-attach-only', '--ref', $referencePath, '--prompt', $promptPath,
        '--out', $videoPath, '--duration', '5', '--size', '1024x576',
        '--candidates', '1', '--timeout', '1200')
    if ($animationJob.loop) {
        $generationArguments += '--loop'
    } elseif ($animationJob.state -eq 'dying') {
        $generationArguments += @('--motion-mode', 'one-way')
    } else {
        $generationArguments += @('--motion-mode', 'recover')
    }
    & $pythonPath @generationArguments
    if ($LASTEXITCODE -ne 0) {
        throw "Generation failed or status unknown. Batch stopped; inspect current task before any retry: $($animationJob.asset) $($animationJob.state)"
    }
    & $pythonPath $previewEntry --video $videoPath
    if ($LASTEXITCODE -ne 0) {
        throw "Video downloaded but preview generation failed. Do not submit the video again: $videoPath"
    }
    Write-Output "Downloaded action $($animationIndex + 1)/8: $($animationJob.asset) $($animationJob.state)"
}
