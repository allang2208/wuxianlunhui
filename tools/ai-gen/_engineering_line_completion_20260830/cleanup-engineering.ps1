$ErrorActionPreference = 'Stop'
$workspaceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$plan = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'cleanup-plan.json') -Raw | ConvertFrom-Json
$trashRoot = [IO.Path]::GetFullPath((Join-Path $workspaceRoot 'tools\.trash-engineering-20260830'))
$allowedNames = @('_hamster_catapult_animations_20260830', '_hamster_field_cannon_animations_20260830', '_hamster_howitzer_animations_20260830', '_engineering_line_completion_20260830', '_engineer_branch_20260830', '_hamster_engineering_mothers_20260830')
$checked = foreach ($entry in $plan.entries) {
    $sourcePath = [IO.Path]::GetFullPath((Join-Path $workspaceRoot $entry.path))
    $owned = $false
    foreach ($name in $allowedNames) {
        $prefix = [IO.Path]::GetFullPath((Join-Path $workspaceRoot "tools\ai-gen\$name")) + [IO.Path]::DirectorySeparatorChar
        if ($sourcePath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { $owned = $true }
    }
    if (!$owned) { throw "Outside explicitly owned cleanup scope: $sourcePath" }
    $destinationPath = [IO.Path]::GetFullPath((Join-Path $trashRoot $entry.path))
    if (!$destinationPath.StartsWith($trashRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe destination' }
    [PSCustomObject]@{Source=$sourcePath; Destination=$destinationPath}
}
$moved = 0
foreach ($item in $checked) {
    if (!(Test-Path -LiteralPath $item.Source -PathType Leaf)) { continue }
    if (Test-Path -LiteralPath $item.Destination) { throw "Destination already exists: $($item.Destination)" }
    New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($item.Destination)) | Out-Null
    Move-Item -LiteralPath $item.Source -Destination $item.Destination
    $moved++
}
Write-Output "Moved $moved owned files into recoverable ignored archive $trashRoot"
