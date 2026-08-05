$workspace = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$nodes = Join-Path $workspace 'ComfyUI\custom_nodes'
$trash = Join-Path $workspace '.trash-comfyui-nodes'
New-Item -ItemType Directory -Force -Path $trash | Out-Null
foreach ($name in @('ComfyUI-BiRefNet-ZHO', 'ComfyUI-Image-Removal')) {
    $src = Join-Path $nodes $name
    if (Test-Path $src) {
        $dst = Join-Path $trash $name
        Move-Item -LiteralPath $src -Destination $dst -Force
        Write-Output "moved: $name -> $dst"
    } else {
        Write-Output "not found: $name"
    }
}
