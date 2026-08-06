$ProgressPreference = "SilentlyContinue"
$ErrorActionPreference = "Continue"
$py = "D:\开发文件\lora-train\venv\Scripts\python.exe"
Set-Location "D:\开发文件\lora-train\ai-toolkit"
& $py -u run.py "D:\开发文件\lora-train\klein-skillicon-v3.yaml" *> "D:\开发文件\lora-train\train_run.log"
"TRAIN_EXIT=$LASTEXITCODE" | Out-File -FilePath "D:\开发文件\lora-train\train.done" -Encoding ascii
