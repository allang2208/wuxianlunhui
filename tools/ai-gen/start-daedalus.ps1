param(
    [string]$WeightsName = 'flux2_dev_fp8mixed.safetensors',
    [string]$LoraName    = 'Flux2TurboComfyv2.safetensors',
    [double]$LoraStrength = 1.0,
    [int]$NBlocks        = 4,
    [switch]$SkipSmoke
)

$root     = Split-Path -Parent $PSScriptRoot
$server   = Join-Path $root 'comfyui-mesh\server'
$weights  = Join-Path $server $WeightsName
$venvPy   = Join-Path $server '.venv\Scripts\python.exe'

if (-not (Test-Path -LiteralPath $weights)) {
    throw "weights not found: $weights"
}

if (-not $SkipSmoke) {
    Write-Host 'running smoke test (no LoRA)...'
    & $venvPy (Join-Path $server 'smoke_test_server.py') --weights $weights --n-blocks $NBlocks
    if ($LASTEXITCODE -ne 0) {
        throw 'smoke test failed'
    }
}

Write-Host "launching Daedalus on 0.0.0.0:7777 (n_blocks=$NBlocks)..."
$out = Join-Path $server 'daedalus-out.log'
$err = Join-Path $server 'daedalus-err.log'

$meshArgs = @(
    '-u',
    (Join-Path $server 'mesh_server.py'),
    '--weights', $weights,
    '--n-blocks', "$NBlocks",
    '--port', '7777',
    '--bind', '0.0.0.0',
    '--device', 'cuda:0',
    '--dtype', 'bfloat16'
)

if ($LoraName) {
    $meshArgs += '--lora'
    $meshArgs += (Join-Path $server $LoraName)
    $meshArgs += '--lora-strength'
    $meshArgs += "$LoraStrength"
}

$p = Start-Process -FilePath $venvPy -ArgumentList $meshArgs -WorkingDirectory $server `
    -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err -PassThru

$p.Id | Set-Content (Join-Path $server 'daedalus.pid')
Write-Host "Daedalus started PID $($p.Id)"
Write-Host "logs: $out"
