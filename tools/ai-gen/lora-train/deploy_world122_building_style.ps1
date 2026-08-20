$ErrorActionPreference = "Stop"

$done = "D:\开发文件\lora-train\world122-building-style-train.done"
$outputDir = "D:\开发文件\lora-train\output\klein-world122-building-style-v1"
$loraDir = "D:\开发文件\ComfyUI\models\loras"
$comfyStart = "D:\开发文件\ComfyUI\start_comfyui.bat"

while (-not (Test-Path $done)) {
    Start-Sleep -Seconds 30
}

if ((Get-Content -Raw $done).Trim() -ne "TRAIN_EXIT=0") {
    throw "World-122 building style LoRA training did not finish successfully."
}

$lora = Get-ChildItem $outputDir -Filter "*.safetensors" -File |
    Sort-Object LastWriteTime |
    Select-Object -Last 1
if (-not $lora) {
    throw "No LoRA safetensors artifact found in $outputDir."
}

Copy-Item -LiteralPath $lora.FullName -Destination (Join-Path $loraDir $lora.Name) -Force

$comfy = Get-CimInstance Win32_Process |
    Where-Object { $_.CommandLine -match "ComfyUI.*main\.py" }
if (-not $comfy) {
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c", $comfyStart -WindowStyle Hidden
}
