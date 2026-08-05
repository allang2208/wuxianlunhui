$ErrorActionPreference = 'Continue'

function Get-DirSizeGB($path) {
    if (-not (Test-Path $path)) { return 0 }
    return [math]::Round(((Get-ChildItem $path -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum) / 1GB, 2)
}

$before = (Get-PSDrive C).Free
Write-Output ("清理前 C 盘剩余: {0} GB" -f [math]::Round($before / 1GB, 2))

# 1) 停止占用 Temp\edge-cdp* 的无头 Edge 调试实例（仅限 cdp 调试 profile，不动正常 Edge）
$cdpProcs = Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'edge-cdp|cdp-edge' }
$cdpProcs | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Write-Output ("已停止 CDP 调试 Edge 进程: {0}" -f $cdpProcs.Count)
Start-Sleep -Seconds 2

# 2) 删除 Temp 下全部 edge-cdp-* / cdp-edge-* 浏览器调试 profile
$tmp = Join-Path $env:LOCALAPPDATA 'Temp'
$edgeDirs = Get-ChildItem $tmp -Directory -Force -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like 'edge-cdp*' -or $_.Name -like 'cdp-edge*' }
$edgeGB = 0
foreach ($d in $edgeDirs) {
    $edgeGB += Get-DirSizeGB $d.FullName
    Remove-Item -LiteralPath $d.FullName -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Output ("已删除 edge-cdp 调试 profile: {0} 个目录, 约 {1} GB" -f $edgeDirs.Count, [math]::Round($edgeGB, 2))

# 3) 删除 CrashDumps 下的崩溃转储
$cd = Join-Path $env:LOCALAPPDATA 'CrashDumps'
$dumps = Get-ChildItem $cd -Filter '*.dmp' -File -Force -ErrorAction SilentlyContinue
$dumpGB = 0
foreach ($f in $dumps) { $dumpGB += $f.Length / 1GB; Remove-Item -LiteralPath $f.FullName -Force -ErrorAction SilentlyContinue }
Write-Output ("已删除崩溃转储: {0} 个, 约 {1} GB" -f $dumps.Count, [math]::Round($dumpGB, 2))

# 4) 清空 pip 下载缓存
$pip = Join-Path $env:LOCALAPPDATA 'pip\cache'
$pipGB = Get-DirSizeGB $pip
if (Test-Path $pip) { Remove-Item -Path (Join-Path $pip '*') -Recurse -Force -ErrorAction SilentlyContinue }
Write-Output ("已清空 pip 缓存: 约 {0} GB" -f [math]::Round($pipGB, 2))

# 5) 清空 NVIDIA DX 着色器缓存（显卡会自动重建；占用中的文件跳过）
$dx = Join-Path $env:LOCALAPPDATA 'NVIDIA\DXCache'
$gl = Join-Path $env:LOCALAPPDATA 'NVIDIA\GLCache'
$nvGB = Get-DirSizeGB $dx + (Get-DirSizeGB $gl)
foreach ($p in @($dx, $gl)) {
    if (Test-Path $p) {
        Get-ChildItem $p -File -Force -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
    }
}
Write-Output ("已清理 NVIDIA DX/GL 着色器缓存: 约 {0} GB" -f [math]::Round($nvGB, 2))

$after = (Get-PSDrive C).Free
Write-Output ("清理后 C 盘剩余: {0} GB (释放约 {1} GB)" -f [math]::Round($after / 1GB, 2), [math]::Round(($after - $before) / 1GB, 2))
