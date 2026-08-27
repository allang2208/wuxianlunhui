# 生图工作流搭建总览与运维手册（2026-08-04 收尾）

> 本文档记录**基础设施层**：拓扑、远程控制、服务启停、环境快照、数据流、许可边界。
> 生成流程见 [WORKFLOW.md](WORKFLOW.md)（权威入口）；训练见 [lora-train/](lora-train/)；提示词见 [prompts/](prompts/README.md)。

## 1. 系统拓扑

| 角色 | 机器 | IP | 关键服务/端口 |
|---|---|---|---|
| 5080 主力机 | RTX 5080 16GB | 192.168.3.142 | ComfyUI 8188、OpenSSH 22、Icarus（mesh 客户端） |
| 本机 | RTX 3080 Ti 12GB | 192.168.3.153 | Daedalus 7777（mesh 后端）、本地 ComfyUI（SDXL 兜底） |
| NAS | 群晖 | 192.168.3.2 | `Y:` 映射 `\\192.168.3.2\工作杂项` |

防火墙已放行：5080 入站 22 / 8188；本机入站 7777。

## 2. 远程控制（本次新增的核心基础设施）

### 2.1 SSH 通道（本机 → 5080，免密）

- 5080 已装 OpenSSH Server（`Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0` + `Start-Service sshd` + 开机自启）；
- 公钥在 `C:\ProgramData\ssh\administrators_authorized_keys`（icacls：SYSTEM:F + Administrators:F；管理员账户走这个文件，不走用户 .ssh）；
- 本机 `~/.ssh/config` 已有别名 `r5080`（User `可爱小鼠`）：
  ```text
  Host r5080
    HostName 192.168.3.142
    User 可爱小鼠
  ```
- 用法：`ssh r5080 "echo hi"`；`scp r5080:D:/path file`。

### 2.2 踩坑与技巧（重要）

- **scp 中文路径会坏**（用户名或路径含中文时偶发 `invalid user name`）：远程文件先拷到 ASCII 中转
  `D:\lora-train-src\`，本地用 `%TEMP%`，再 `Copy-Item` 到中文路径；
- **长/复杂命令**：本地把 PowerShell 脚本转 UTF-16 base64，远程
  `powershell -NoProfile -EncodedCommand <b64>`，彻底绕开引号与中文编码问题；
- **ssh 断连会杀会话进程树**：长任务（训练/安装/下载）用计划任务跑
  （`schtasks /create /tr "powershell -File xxx.ps1" /ru SYSTEM /f` + `/run`）；
- **日志必须 `*> file` 重定向**：`Start-Transcript` 抓不到 python/pip 等子进程输出；
- **5080 无法认证 NAS SMB**（错误 1326）：文件经本机 scp 中转，不要指望 5080 直读 NAS。

## 3. 服务启停总表

| 服务 | 启动 | 停止 |
|---|---|---|
| 5080 ComfyUI | `Start-Process <venv python> main.py --listen 0.0.0.0 --port 8188`（隐藏窗口） | `taskkill /PID <python main.py> /T /F` |
| 本机 Daedalus | `tools/ai-gen/start-daedalus.ps1 -SkipSmoke` | 结束对应 python |
| 5080 Icarus（mesh 客户端） | 与 ComfyUI 一起随 custom_nodes 加载，ComfyUI 重启即恢复 | 随 ComfyUI |

**训练前必须关 5080 ComfyUI**（训练峰值 ~15.6GB/16GB）；训练后按上表重启。

## 4. 模型与生成入口（摘要）

`models.json` 注册：`sdxl` / `flux2-klein-4b`（当前挂 `klein-skillicon-v2.safetensors` LoRA）/
`flux2-dev-fp8` / `flux2-dev-depth` / `flux2-dev-mesh`。

- **Dev fp8 / Dev Depth = 生产主力**：自由构图使用`flux2-dev-fp8`，锁视角/结构使用`flux2-dev-depth`；
- **Klein 4B / Klein LoRA / Mesh = 历史复现或对照**：只有调用者显式指定时启用，不参与默认路由；
- 历史触发词`wuxianlunhui magic skill icon`仅随对应Klein LoRA生效，默认Dev工作流不挂载该LoRA。

## 5. 训练环境快照（5080）

### 5.1 目录

| 路径 | 内容 |
|---|---|
| `D:\开发文件\lora-train\venv` | 训练 venv（Python 3.11.9） |
| `D:\开发文件\lora-train\ai-toolkit` | AI-Toolkit（ostris main） |
| `D:\开发文件\lora-train\base` | Klein 4B **Base** 权重（7.75GB，ModelScope 下载） |
| `D:\开发文件\lora-train\te\Qwen3-4B` | Qwen3 文本编码器（HF 目录格式：config + tokenizer + model.safetensors） |
| `D:\开发文件\lora-train\dataset[-v2]` | 技能图标数据集（v2 = 干净六边形） |
| `D:\开发文件\lora-train\output\klein-skillicon-v2` | LoRA 产物 |

### 5.2 版本

- torch **2.11.0+cu128** / torchvision 0.26.0+cu128 / torchaudio 2.11.0+cu128
  （必须 `--index-url https://download.pytorch.org/whl/cu128`，PyPI 默认是 CPU 版）
- transformers 5.5.3、diffusers 固定 commit `c943837`（本地 `--no-deps` 安装）
- 依赖走清华镜像 `https://pypi.tuna.tsinghua.edu.cn/simple`

### 5.3 AI-Toolkit 三处补丁（升级需复核）

1. `flux2_klein_model.py::load_te`：`low_cpu_mem_usage=True`（防 31GB 内存爆）；
2. `flux2_klein_model.py::__init__`：从 `model_kwargs` 读 `flux2_klein_te_path` / `flux2_vae_path`
   （否则去 HF 下载被墙卡死）；
3. `flux2_model.py::load_model`：`del transformer_state_dict; gc.collect()`（释放 7.75GB 原始权重）。

### 5.4 网络源可用性（2026-08-04 实测）

| 源 | 状态 |
|---|---|
| pypi.org / 清华 PyPI | ✅（清华快） |
| download.pytorch.org（cu128 索引） | ✅ |
| ModelScope | ✅（模型权重首选） |
| gh-proxy.com（GitHub 代理） | ✅（代码包首选） |
| hf-mirror.com | ⚠️ 本机可用、5080 拒绝连接 |
| huggingface.co / github.com 直连 | ❌ 被墙 |

## 6. 数据与备份

- NAS scratch：`Y:\工作\无尽轮回\scratch\`（生成产物、候选、训练暂存）
- LoRA 归档：`Y:\工作\无尽轮回\scratch\klein-lora-skillicon\`（v1/v2 均在）
- 仓库：`game-dev/`（git，本地已提交；GitHub 被墙，推送待网络恢复）
- 关键产物三处冗余：5080 磁盘 / NAS / git 仓库（文档与脚本）。

## 7. 许可与商用边界（2026-08-04 决策）

- **Klein 4B = Apache 2.0**：训练 + 推理 + 商用均无限制，作为商用骨干；
- **Dev / Klein 9B = FLUX Non-Commercial**：当前项目尺度（个人/兴趣）下使用；
  若未来正式商用上规模，需联系 BFL 购买 Platform 许可（含自托管 Dev），
  或在商用链路彻底切换为 Klein 全流程；
- 训练数据均为自有资产（已入库图标），无第三方版权问题。

## 8. 待办清单

- [ ] GitHub 恢复后推送本地提交（V0.385 起累计 4 个 commit）
- [ ] 5080 Defender 排除 `D:\开发文件\lora-train`（训练提速 ~2-3 倍）
- [ ] mesh/Icarus 重启验证（训练后未复测）
- [ ] Dev fp8 单卡出图实测（预估 40-90 秒/张）
- [ ] 新模块（怪物/背景）按 `lora-train/new-module-checklist.md` 走

## 9. 文档索引

| 文档 | 内容 |
|---|---|
| `WORKFLOW.md` | 生成流程权威入口（模型矩阵/流程/校验） |
| `prompts/` | 固化提示词模板（按资产类型） |
| `lora-train/README-klein-skillicon-lora.md` | 技能图标训练任务书 + v1/v2 实战记录 |
| `lora-train/new-module-checklist.md` | 新模块训练通用模板 |
| `comfyui-mesh-setup.md` / `install-remote-models.md` | mesh 部署 / 远程模型安装 |
| `remote-patch/` | 5080 兼容补丁（含原版备份） |
| `SKILL.md` | 摘要速查 |
