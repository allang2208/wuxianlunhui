$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$ud = Join-Path $env:TEMP ('edge-cdp-fa-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $ud | Out-Null
Start-Process -FilePath $edge -ArgumentList @('--headless=new', '--remote-debugging-port=9224', "--user-data-dir=$ud", '--no-first-run', '--disable-gpu', '--window-size=1400,900', 'http://localhost:5173') -WindowStyle Hidden
Write-Output "launched with ud=$ud"
