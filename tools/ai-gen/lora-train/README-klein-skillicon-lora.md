# 训练任务书：FLUX.2 Klein 4B 技能图标风格 LoRA（v1）

## 目标

用游戏已入库的"六边形徽章魔法技能图标"系列（7 张，1024² 白底）训练一个
**Klein 4B 风格 LoRA**，触发词 `wuxianlunhui magic skill icon`。
用途：新技能图标生成时保持徽章模板/金色描边/浮雕水晶底座风格一致。

**基座选型**：Klein 4B（Apache 2.0 可商用）——项目已确定商用方向，Dev/9B 非商用许可不用于生产。

## 数据集

- 已就绪：7 图 + 7 标注（AI-Toolkit/kohya 兼容平铺格式）
- 本机路径：`Y:\工作\无尽轮回\scratch\klein-lora-skillicon\dataset`
- UNC：`\\192.168.3.2\工作杂项\工作\无尽轮回\scratch\klein-lora-skillicon\dataset`
- 复制到 5080 本地磁盘（训练不经过 SMB）：
  ```bat
  robocopy "\\192.168.3.2\工作杂项\工作\无尽轮回\scratch\klein-lora-skillicon\dataset" "D:\开发文件\lora-train\dataset" /E /J /MT:16
  ```
- 标注结构：`wuxianlunhui magic skill icon, game skill icon emblem, purple hexagonal
  badge with gold trim and embossed translucent crystal block base at the bottom,
  the center shows <主题>, centered, game asset art, high detail, crisp, isolated
  on a plain pure white background`

## 基座文件（5080 已有，指向 ComfyUI models 目录）

- diffusion_models：`D:\开发文件\ComfyUI\models\diffusion_models\flux-2-klein-4b-fp8.safetensors`
- text_encoders：`D:\开发文件\ComfyUI\models\text_encoders\qwen_3_4b.safetensors`
- vae：`D:\开发文件\ComfyUI\models\vae\flux2-vae.safetensors`

## 工具与步骤

1. 安装 [AI-Toolkit（ostris）](https://github.com/ostris/ai-toolkit)（支持 FLUX.2 klein 模板）；
   或 Kohya sd-scripts（同样支持 FLUX.2）。二选一，以 AI-Toolkit 优先。
2. 用 AI-Toolkit 自带 **FLUX.2 klein 模板**新建 job（extension），只改以下参数：
   - `trigger_word: wuxianlunhui magic skill icon`
   - `dataset path: D:\开发文件\lora-train\dataset`
   - `resolution: [1024, 1024]`（若 OOM 改 [768, 768]）
   - `network dim: 32 / alpha: 16`（7 张小数据集，低秩起步）
   - `lr: 1e-4`（cosine），`batch_size: 1`
   - 步数：约 **100~150 steps**（7 图 × 15~20 epochs）
   - `train_unet: true`，`train_text_encoder: false`（qwen 编码器不动，省显存）
   - 显存优化：fp8/NF4 量化 + block swap（16GB 足够，8.4GB 即可跑 Klein 4B）
   - 输出名：`klein-skillicon-v1`
3. **训练期间建议关闭 ComfyUI**（同一张 5080，避免显存争抢）。
4. 训练完成后把产物复制到 NAS：
   ```bat
   copy "D:\开发文件\lora-train\output\klein-skillicon-v1\klein-skillicon-v1.safetensors" "\\192.168.3.2\工作杂项\工作\无尽轮回\scratch\klein-lora-skillicon\"
   ```

## 验收（本机做）

1. 本机从 NAS 取 LoRA → 复制到两端 `models\loras\`：
   - 5080：`D:\开发文件\ComfyUI\models\loras\`
   - 本机 Daedalus 目录（mesh 后端，小 LoRA 可只走客户端转发，无需两端）
2. 用 `tools/comfyui-gen.py --model flux2-klein-4b --lora klein-skillicon-v1.safetensors`
   生成 4 张新主题图标（触发词开头 + 主题块），走 GLM-4V + `check-icon-sizes.py` 验收。

## 备注

- 7 张为 v1 最小可用集；后续每入库新图标可追加进 dataset 重训（增量迭代）。
- 若 5080 训练环境装不上 AI-Toolkit，回退方案：本机 3080 Ti（12GB）也满足 Klein 4B
  训练显存（~8.4GB），可把基座文件从 5080 经 NAS 拷到本机后本机训。

## 实战记录（2026-08-04 v1 已跑通）

### 远程通道

- 5080 开 OpenSSH Server（管理员 PowerShell：`Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0` +
  `Start-Service sshd` + 防火墙放行 22），公钥放 `C:\ProgramData\ssh\administrators_authorized_keys`（icacls 授权
  SYSTEM/Administrators）。本机 `~/.ssh/config` 配别名 `r5080`（User 可爱小鼠），之后 `ssh r5080` / `scp r5080:...` 免密。

### 训练环境（5080，`D:\开发文件\lora-train\`）

- venv：`python -m venv venv`（系统 Python 3.11.9）
- **torch 必须走 PyTorch 官方源**：`pip install torch==2.11.0+cu128 torchvision==0.26.0+cu128
  torchaudio==2.11.0+cu128 --index-url https://download.pytorch.org/whl/cu128`（torch/torchvision/torchaudio 均 `--no-deps`，
  否则 PyPI 默认会给 CPU 版）。torchcodec 等依赖会偷偷把 torch 拉回 CPU 版，装完必须复验 `torch.cuda.is_available()`。
- requirements（清华镜像 `https://pypi.tuna.tsinghua.edu.cn/simple`）：transformers 5.5.3、diffusers 固定 commit
  `c943837`（GitHub 被墙，用 gh-proxy 下 zip，`pip install --no-deps` 本地装）等。
- AI-Toolkit：gh-proxy 下载 main.zip 解压到 `ai-toolkit\`。

### 模型文件

- **训练用 Base 版**（BFL 官方推荐：LoRA 在未蒸馏 Base 上训练，推理时挂蒸馏版）：
  ModelScope `black-forest-labs/FLUX.2-klein-base-4B/resolve/master/flux-2-klein-base-4b.safetensors`（7.75GB）→
  `lora-train\base\`。注意：ComfyUI 里的 `flux-2-klein-4b-fp8.safetensors` 是蒸馏版，不能直接当训练基座。
- 文本编码器：拼 HF 格式目录 `lora-train\te\Qwen3-4B\`（config.json/tokenizer 等从 hf-mirror 拉，权重用 ComfyUI 的
  `qwen_3_4b.safetensors` 复制为 `model.safetensors`）。
- VAE：直接指 ComfyUI `models\vae\flux2-vae.safetensors`。

### AI-Toolkit 关键补丁（已应用，升级需复核）

1. `flux2_klein_model.py::load_te`：`from_pretrained(...)` 加 `low_cpu_mem_usage=True`（否则 31GB 内存峰值爆）。
2. `flux2_klein_model.py::__init__`：从 `model_config.model_kwargs` 读 `flux2_klein_te_path` / `flux2_vae_path`，
   否则 yaml 里的值不生效，会去 HF 下默认 `Qwen/Qwen3-4B`（被墙 → 卡死）。
3. `flux2_model.py::load_model`：`load_state_dict(...)` 后 `del transformer_state_dict; gc.collect()`（原始 7.75GB 权重
   量化后仍被引用，不释放会吃光内存）。

### 训练命令（断连安全）

- 长任务用计划任务跑（ssh 断连会杀会话进程树）：`schtasks /create /tn KleinTrain /tr "powershell -NoProfile
  -ExecutionPolicy Bypass -File D:\lora-train-src\train_klein.ps1" /ru SYSTEM /f` + `/run`；脚本内 `& $py -u run.py
  <config.yaml> *> train_run.log`（Start-Transcript 抓不到子进程输出，必须重定向）。
- 实测：250 步 / ~16 分钟 / 每步 ~2.8s（transformer qfloat8 量化 + TE fp16，16GB 显存余 ~5GB）。

### 验收结果（v1）

- 4 张新主题（毒镖/风刃/暗影/石拳）GLM-4V 全部确认：紫色六边形徽章 + 金描边 + 水晶底座 + 白底居中 ✓。
- 生成尺寸偏小（占比 52~64% vs 基准 70%）——蒸馏 4 步推理的构图缩放漂移，属正常现象；
  入库前用 `normalize-skill-icon.py` 归一化到基准（fill≈70% / cx≈0 / cy≈+28 / aspect 0.78~0.85）。
- 部署：LoRA → 5080 `models\loras\` + NAS `scratch\klein-lora-skillicon\` + `models.json` 的
  `flux2-klein-4b.lora` 注册；ComfyUI 需重启后生效。

## v2（2026-08-04）：统一"干净六边形"风格

### 背景

v1 验收发现形态不一致：金边粗细不一、水晶底座时有时无、六边形下方突出物随机。
逐张审计训练集后定位根因——**数据集自相矛盾**：7 张图里 4 张是干净六边形、3 张带水晶底座
（大小形态各异），但 7 条标注全部写 "embossed translucent crystal block base at the bottom"。
LoRA 学到的是一套分裂风格，加强训练只会固化矛盾，改提示词也只是碰运气。

### 决策（用户确认）

系列形态统一为**火球式干净六边形徽章 + 紫色浮雕 + 均匀金边**，明确移除水晶底座。
风格块（数据集标注 / 生成提示词 / `prompts/skill-icon.md` 三处一致）：

```text
wuxianlunhui magic skill icon, game skill icon emblem, a single clean purple hexagonal
badge with embossed purple surface and uniform gold trim, the center shows <主题>,
centered, game asset art, high detail, crisp, isolated on a plain pure white background
```

### 数据集重建（dataset-v2）

- 保留 4 张本来就干净的图（00001 火球 / 00003 灼锋焰甲 / 00006 闪电 / 00007 圣光）；
- 3 张带底座的（00002 陨星 / 00004 暴风雪 / 00005 冰墙）用 v1 LoRA + 干净风格提示词
  多候选重抽（每主题 4 张），GLM-4V 逐张审计（无底座 / 主题清晰 / 金边完整）后选入：
  meteor_101 / blizzard_101 / icewall_202；
- 7 条标注全部重写为干净风格块（去掉 crystal base）。

### 重训参数（v2）

- `klein-skillicon-v2.yaml`：250 → **500 步**，save/sample 每 50 步，其余同 v1
  （dim 32/alpha 16、lr 1e-4、1024²、qfloat8 量化、TE fp16）；
- 实测步速 ~3~11s/it（Windows Defender 扫描新 safetensors 时明显变慢；
  建议给 `D:\开发文件\lora-train` 加 Defender 排除项）；
- **训练峰值显存 ~15.6GB/16GB——必须关闭 ComfyUI 再训**（空闲的 ComfyUI 也会让采样阶段 OOM）。

### 验收（v2 待跑）

4 张新主题 → GLM-4V 逐张查：干净单六边形 / 紫色浮雕 / 金边完整 / 无底座无突出 →
`normalize-skill-icon.py` 归一化 → 部署 `klein-skillicon-v2.safetensors`。
