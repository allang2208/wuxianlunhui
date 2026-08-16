# game-dev Agent 守则

## 浏览器探针 (tools/cdp-*.mjs) 使用规则

- **绝对禁止** `Get-Process -Name msedge | Stop-Process -Force` 或任何按进程名
  无差别杀 msedge 的命令——这会杀掉用户正在使用的正常浏览器, 用户已经因此受害。
- 运行探针一律使用安全入口:
  `powershell -ExecutionPolicy Bypass -File tools\cdp-run.ps1 <脚本名.mjs>`
  (该脚本只清理命令行含 `--headless` / `edge-cdp` / `remote-debugging` 的无头
  Edge, 不碰正常浏览器; 若无需清理残留, 直接 `node tools/<脚本>.mjs` 也可以)。
- 探针每次使用独立临时 profile (`Temp\edge-cdp-*`), 与用户正常浏览器互不影响,
  不要为了"保险"去杀所有 Edge 进程。
- 探针运行完必须退出并删除自己创建的 `Temp\edge-cdp-*` 临时目录; 有残留时用
  `tools\cleanup-c-drive-caches.ps1` 清理, 不要用 taskkill 全杀。
- 不要长时间挂起探针 (如无头 Edge 保活数小时); 跑完即退。
