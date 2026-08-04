# ComfyUI-Mesh（Icarus + Daedalus）部署记录

## 拓扑

- **Icarus（ComfyUI 客户端节点）** → 5080 机（192.168.3.142，跑生产 ComfyUI 0.30.0）
- **Daedalus（后端服务器）** → 本机 3080 Ti（192.168.3.153，端口 7777）
- 模型：FLUX.2 Dev fp8（`flux2_dev_fp8mixed.safetensors`）两端各一份
- 官方文档：https://github.com/shootthesound/comfyui-mesh

## 本机 Daedalus（已基本完成，待模型到位）

1. 仓库已解压到 `E:\无尽轮回\长期备份\2026-7-13-1\comfyui-mesh`
2. `server\install.bat` 已打本地补丁（github.com 被墙 → 用 codeload 预置 ComfyUI 源码，
   且预置源码时也安装 ComfyUI 依赖；补丁仅本机安装用，非 wire-contract 文件）
3. venv + cu128 torch 安装中；完成后：
   - 模型文件放到 `server\` 下（如 `flux2_dev_fp8mixed.safetensors`）
   - 冒烟测试：`.venv\Scripts\python.exe smoke_test_server.py --weights flux2_dev_fp8mixed.safetensors --n-blocks 4`
   - 启动：`.venv\Scripts\python.exe -u mesh_server.py --weights flux2_dev_fp8mixed.safetensors --n-blocks 4 --port 7777 --bind 0.0.0.0 --device cuda:0 --dtype bfloat16`
4. 防火墙：入站 TCP 7777 需放行（UAC 弹窗选"是"；若失败按远程机同款 GUI 步骤，端口 7777）

注意：`run_server_flux2.bat` 里 `WEIGHTS` 写死了 `flux-2-klein-9b-fp8.safetensors`，
用 Dev 时直接走上面的 CLI 命令，或改 bat 里文件名。

## 5080 端 Icarus（给那台机器的 AI 执行）

```bat
cd /d D:\开发文件\ComfyUI\custom_nodes
git clone https://github.com/shootthesound/comfyui-mesh.git comfyui-mesh
```

若 github.com 不通，改用 codeload zip：

```bat
cd /d D:\开发文件\ComfyUI\custom_nodes
powershell -Command "Invoke-WebRequest -Uri 'https://codeload.github.com/shootthesound/comfyui-mesh/zip/refs/heads/main' -OutFile comfyui-mesh.zip -UseBasicParsing"
powershell -Command "Expand-Archive -Path comfyui-mesh.zip -DestinationPath comfyui-mesh-tmp -Force"
move comfyui-mesh-tmp\comfyui-mesh-main comfyui-mesh
rmdir comfyui-mesh-tmp
del comfyui-mesh.zip
```

然后重启 ComfyUI（关闭窗口重新运行启动脚本）。

## 联调

1. 5080 端确认节点已加载（从本机验证）：
   `http://192.168.3.142:8188/object_info/MeshSplitFlux` 有返回即 OK
2. 本机 Daedalus 启动后日志应显示 `[server] READY — listening on 0.0.0.0:7777`
3. 5080 工作流：`UNETLoader(flux2_dev_fp8mixed) → MeshSplitFlux → KSampler`
   - `n_blocks_remote=4`、`remote_host=192.168.3.153`、`remote_port=7777`
   - `codec_mode=nvenc`、`codec_qp=18`、`codec_tile_dim=8`、`forward_client_loras=ON`
4. 生成时本机日志逐 step 显示 `[server] forward 4 blocks ...`

## 坑

- 两端 ComfyUI 版本要接近（现在都是 0.30.0）
- `codec.py/protocol.py/vec_io.py/payload_ltx.py/lora_io.py/nvenc_pframe/`
  是 wire-contract，两端必须字节级一致，升级要两端同步
- `n_blocks_remote` 只能增不能减；调小需重启 ComfyUI
- 单客户端独占：另一台连入会踢掉当前客户端
- 大 LoRA（>500MB）必须两端本地加载，不要走转发（目前无 LoRA）
- Mesh 不支持 Klein 4B / SDXL / MiniMax H3，只支持 FLUX.2 Dev / Klein 9B / LTX 2.3

## 实测结果（2026-08-04，跨机出图成功）

- 拓扑：5080（Icarus 客户端，192.168.3.142）↔ 本机 3080 Ti（Daedalus，
  192.168.3.153:7777），Dev fp8（33GB）+ Turbo LoRA 两端各一份
- 工作流：`UNETLoader → MeshSplitFlux(n_blocks_remote=4) → LoraLoaderModelOnly(Turbo)
  → BasicGuider/FluxGuidance(4)/Flux2Scheduler(8步)/euler`
- 服务端每步：decode ~140ms + fwd ~9ms + enc ~660ms，8 步共约 7s 服务端耗时
  （客户端低显存模式 + VAE 解码另计，整图约 1-2 分钟）
- 图：`tmp_wall_view/mesh-dev-test_00001_.png`（5080 output 目录也有）

### 上线前必须保留的两个本地兼容补丁

1. **flux2fun-controlnet v1.1.0**（5080）：`flux_patch.py` 加
   `timestep_zero_index=None` 参数；无 ControlNet 时委托核心原版 forward；
   `nodes.py` 的 ControlNetWrapper 加 `multigpu_clones = {}`。
   文件在 `tools/remote-patch/`（含 .orig 备份），NAS 同步一份于
   `\\192.168.3.2\工作杂项\工作\无尽轮回\scratch\remote-patch\`。
2. **comfyui-mesh Icarus stub**（5080）：`mesh_node.py` 的 MeshRemoteStub
   物化可遍历的假子模块，否则 ComfyUI 0.30 低显存装载路径在
   `restore_loaded_backups` 处崩溃（`'MeshRemoteStub' object has no
   attribute 'img_attn'`）。文件同样在 remote-patch/。

### 运维要点

- 客户端（5080）崩溃遗留半截会话会把 Daedalus 卡死（socket 显示监听但
  不接受新连接，`Test-NetConnection` 表现"Waiting for response"）。
  处理：重启 Daedalus（`start-daedalus.ps1 -SkipSmoke`）。
- 本机 Daedalus 用 safetensors 绑定会崩（torch 2.11 cu128 Windows 兼容 bug），
  已用 `safetensors_raw.py` 纯字节读取绕过（server 侧本地补丁，wire 协议不变）。
- 5080 测试连通性勿看 Test-NetConnection 的 ICMP 段（入站 ICMP 默认丢弃），
  以 `TcpTestSucceeded : True` 为准；Daedalus 日志出现 client connected 即通。
