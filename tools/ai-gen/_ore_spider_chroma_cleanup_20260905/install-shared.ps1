$ErrorActionPreference = 'Stop'

$taskRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $taskRoot '..\..\..')).Path
$assetRoot = (Resolve-Path -LiteralPath (Join-Path $repoRoot 'assets\enemies\ore_spider')).Path
$candidateRoot = (Resolve-Path -LiteralPath (Join-Path $taskRoot 'candidate')).Path
$manifestPath = Join-Path $taskRoot 'repair-manifest.json'
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
$targets = @{
    walking = 'walking.png'
    attacking = 'attacking.png'
}

foreach ($action in $targets.Keys) {
    $filename = $targets[$action]
    $target = (Resolve-Path -LiteralPath (Join-Path $assetRoot $filename)).Path
    $candidate = (Resolve-Path -LiteralPath (Join-Path $candidateRoot $filename)).Path
    if (-not $target.StartsWith($assetRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Target escaped Ore Spider asset directory: $target"
    }
    if (-not $candidate.StartsWith($candidateRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Candidate escaped task directory: $candidate"
    }
    $entry = $manifest.states.$action
    $targetHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $target).Hash.ToLowerInvariant()
    $candidateHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $candidate).Hash.ToLowerInvariant()
    if ($targetHash -ne $entry.beforeSha256) {
        throw "$filename changed after candidate preparation; refusing to overwrite parallel work"
    }
    if ($candidateHash -ne $entry.candidateSha256) {
        throw "$filename candidate hash no longer matches repair-manifest.json"
    }
}

$installed = @{}
foreach ($action in $targets.Keys) {
    $filename = $targets[$action]
    $target = (Resolve-Path -LiteralPath (Join-Path $assetRoot $filename)).Path
    $candidate = (Resolve-Path -LiteralPath (Join-Path $candidateRoot $filename)).Path
    $bytes = [System.IO.File]::ReadAllBytes($candidate)
    $share = [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete
    $stream = [System.IO.File]::Open(
        $target,
        [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::ReadWrite,
        $share
    )
    try {
        $stream.SetLength(0)
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush($true)
    } finally {
        $stream.Dispose()
    }
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $target).Hash.ToLowerInvariant()
    if ($actual -ne $manifest.states.$action.candidateSha256) {
        throw "Post-write hash mismatch for $filename"
    }
    $installed[$action] = $actual
    Write-Output "installed $action`: $target"
}

$manifest | Add-Member -NotePropertyName installed -NotePropertyValue $true -Force
$manifest | Add-Member -NotePropertyName installedSha256 -NotePropertyValue ([pscustomobject]$installed) -Force
$json = $manifest | ConvertTo-Json -Depth 12
[System.IO.File]::WriteAllText($manifestPath, $json + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
