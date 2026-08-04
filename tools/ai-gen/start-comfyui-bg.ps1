$ErrorActionPreference = "Stop"
$ToolsDir = $PSScriptRoot
$ComfyRoot = Join-Path (Split-Path $ToolsDir -Parent) "ComfyUI"
$py = Join-Path $ComfyRoot ".venv\Scripts\python.exe"
$main = Join-Path $ComfyRoot "main.py"
$log = Join-Path $ComfyRoot "comfyui.log"

$cmdLine = '"cmd.exe" /d /s /c ""{0}" "{1}" --port 8188 --disable-auto-launch > "{2}" 2>&1"' -f $py, $main, $log
$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmdLine }
if ($r.ReturnValue -eq 0) {
    Write-Output "ComfyUI started, PID $($r.ProcessId), log: $log"
} else {
    Write-Output "Failed to start, return $($r.ReturnValue)"
    exit 1
}
