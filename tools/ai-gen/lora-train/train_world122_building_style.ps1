$ProgressPreference = "SilentlyContinue"
$ErrorActionPreference = "Stop"

$python = "D:\开发文件\lora-train\venv\Scripts\python.exe"
$workdir = "D:\开发文件\lora-train\ai-toolkit"
$config = "D:\lora-train-src\klein-world122-building-style-v1.yaml"
$log = "D:\开发文件\lora-train\world122-building-style-train.log"
$done = "D:\开发文件\lora-train\world122-building-style-train.done"

Set-Location $workdir
try {
    # AI-Toolkit/Torch emits non-fatal CUDA capability notices on stderr.
    # Let the native process finish and decide success solely from its exit code.
    $ErrorActionPreference = "Continue"
    & $python -u run.py $config *> $log
    $trainExit = $LASTEXITCODE
    "TRAIN_EXIT=$trainExit" | Out-File -FilePath $done -Encoding ascii
    if ($trainExit -ne 0) { exit $trainExit }
} catch {
    $_ | Out-File -FilePath $log -Encoding utf8
    "TRAIN_EXIT=1" | Out-File -FilePath $done -Encoding ascii
    throw
}
