$ErrorActionPreference = "Stop"
$targets = Get-CimInstance Win32_Process | Where-Object {
    $_.Name -match "python" -and $_.CommandLine -match "ComfyUI[\\/]main\.py"
}
if ($targets) {
    $targets | ForEach-Object {
        Write-Output ("Stopping PID {0}: {1}" -f $_.ProcessId, ($_.CommandLine -split ' ')[0])
        Stop-Process -Id $_.ProcessId -Force
    }
} else {
    Write-Output "No running ComfyUI process found."
}
