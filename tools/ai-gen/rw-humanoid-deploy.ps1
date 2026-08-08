$src = Join-Path $env:TEMP "rw-humanoid-v2"
$dst = Join-Path $PSScriptRoot "..\..\assets\enemies"
$map = @{
    "transformed_idle_v3.png" = "red_wolf_king_transformed_idle.png"
    "changed_run_v4.png"      = "red_wolf_king_changed_run.png"
    "changed_attack_v4.png"   = "red_wolf_king_changed_attack.png"
}
foreach ($k in $map.Keys) {
    $s = Join-Path $src $k
    $d = Join-Path $dst $map[$k]
    if (Test-Path $s) { Copy-Item -LiteralPath $s -Destination $d -Force; "deployed $k -> $($map[$k])" }
    else { "MISSING $k" }
}
