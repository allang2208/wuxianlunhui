param(
    [string]$Target = $env:TEMP
)

# 只清理 %TEMP% 下的 edge-* CDP 残留目录（明确前缀，逐条验证后删除）
$resolvedTarget = [System.IO.Path]::GetFullPath($Target)
$tempFull = [System.IO.Path]::GetFullPath($env:TEMP)
if (-not $resolvedTarget.StartsWith($tempFull, [System.StringComparison]::OrdinalIgnoreCase)) {
    Write-Error "refusing: target outside %TEMP% -> $resolvedTarget"
    exit 1
}

$list = @(Get-ChildItem -LiteralPath $resolvedTarget -Directory -Filter 'edge-*' -Force -ErrorAction SilentlyContinue)
$totalMB = 0
foreach ($t in $list) {
    $s = (Get-ChildItem -LiteralPath $t.FullName -Recurse -File -Force -ErrorAction SilentlyContinue |
        Measure-Object -Property Length -Sum).Sum
    $totalMB += ($s / 1MB)
}
Write-Output ("edge-* dirs: " + $list.Count + "  size: " + [math]::Round($totalMB / 1024, 1) + " GB")

$deleted = 0
foreach ($t in $list) {
    Remove-Item -LiteralPath $t.FullName -Recurse -Force -ErrorAction SilentlyContinue
    if (-not (Test-Path -LiteralPath $t.FullName)) { $deleted++ }
}
Write-Output ("deleted: " + $deleted)
$left = @(Get-ChildItem -LiteralPath $resolvedTarget -Directory -Filter 'edge-*' -Force -ErrorAction SilentlyContinue)
Write-Output ("remaining edge-*: " + $left.Count)
