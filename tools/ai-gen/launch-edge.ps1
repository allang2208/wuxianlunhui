$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$ud = Join-Path $env:TEMP 'edge-cdp-9224'
Start-Process -FilePath $edge -ArgumentList @('--headless=new','--remote-debugging-port=9224',"--user-data-dir=$ud",'--no-first-run','--disable-gpu','--window-size=1400,900','http://localhost:5174') -WindowStyle Hidden
