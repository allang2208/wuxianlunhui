$gameDev = Split-Path $PSScriptRoot -Parent
Start-Process -FilePath "cmd.exe" -ArgumentList '/c npx vite --port 5174 --strictPort > vite.log 2>&1' -WorkingDirectory $gameDev -WindowStyle Hidden
