# 新 LoRA 模块训练模板（Klein 4B 通用）

> 适用：技能图标 / 装备图标 / 怪物贴图 / 背景风格等任意新模块。
> 母版：`klein-skillicon-v2.yaml`（5080: `D:\开发文件\lora-train\`），本文件是执行清单。

## 0. 模块决策表（开工前先填完）

| 项目 | 填写 | 说明 |
|---|---|---|
| 模块名（= 配置 name / 输出名） | `klein-<资产类型>-v1` | 如 `klein-monster-v1` |
| 触发词 | `wuxianlunhui <asset> style` | 与数据集标注一致 |
| 类型 | 风格类 / 角色类 / 物件 / 背景 | 决定张数与步数 |
| 数据集张数 | 5-15 / 15-30 / 10-20 / 10-20 | 见 §1 表格 |
| 训练步数 | 500 / 800 / 1000+ | 见 §2 表格 |
| 验收基准 | 工具名 + 基准值 | 见 §5 |

## 1. 数据集准备

目录（NAS，训练前 scp 到 5080）：
`Y:\工作\无尽轮回\scratch\klein-lora-<module>\dataset`

- 文件：`00001.png` + `00001.txt`（平铺序号，同 AI-Toolkit 格式）
- 尺寸：1024×1024，统一背景（技能图标白底；怪物/物件可统一灰底或白底）
- 标注结构：
  ```
  <trigger word>, game asset art, <style block>, the center shows <主题>,
  centered, high detail, crisp, isolated on a plain uniform background
  ```

### 参考图数量（按类型）

| 类型 | 张数 | 内容要求 |
|---|---|---|
| 风格类（图标/UI） | 5-15 | 内容多样、风格严格一致 |
| 角色/怪物（固定形象） | 15-30 | 多角度/姿势/表情 |
| 物件/道具 | 10-20 | 多角度、统一背景 |
| 背景/场景风格 | 10-20 | 艺术方向一致、场景内容多样 |

### 一致性审计（最重要，先做再训）

```powershell
node "C:\Users\allan\.codex\skills\deepseek-vision-skill\scripts\describe-image.js" `
  --prompt "审计：1)风格元素是否一致？2)构图/占比是否统一？3)有无与风格块矛盾的细节？" 00001.png
```

- 逐张审计 + 像素统计（`check-icon-sizes.py` 的 measure 逻辑）；
- **发现风格矛盾必须先修数据集再训**（v1 教训：7 张里 3 张带水晶底座导致 LoRA 输出分裂）；
- 需要重抽的图用 `comfyui-gen.py --model flux2-klein-4b` 多候选 + 审计挑选。

## 2. 训练配置

复制母版 yaml 并只改 4 处：

```yaml
name: "klein-<module>-v1"
trigger_word: "wuxianlunhui <asset> style"
datasets:
  - folder_path: "D:/开发文件/lora-train/dataset-<module>"
train:
  steps: 500   # 按类型调整
```

### 参数速查（已验证）

| 参数 | 值 | 说明 |
|---|---|---|
| network | lora, dim 32 / alpha 16 | 小数据集低秩足够 |
| lr | 1e-4 | cosine |
| resolution | [1024,1024] | OOM 才降 768 |
| dtype | bf16；quantize qfloat8；te fp16 | 16GB 显存配置 |
| train_unet | true / TE false | qwen 编码器不动 |
| 步数 | 风格 500 / 角色 800-1000 / 大集 1500+ | 每张约 50-80 epochs |

## 3. 训练执行（5080 远程）

```powershell
# 1) 拷贝数据集（本机 → 5080，走 ASCII 中转避免中文路径问题）
scp -r "$env:TEMP\ds-<module>" r5080:D:/lora-train-src/
# 2) 在 5080 组装 dataset-<module>（ssh r5080 后执行 Move-Item）
# 3) 写 yaml 到 D:\开发文件\lora-train\klein-<module>-v1.yaml
# 4) 改 D:\lora-train-src\train_klein.ps1 里的 config 路径
# 5) 关闭 ComfyUI（训练峰值 ~15.6GB/16GB，必须关）
schtasks /run /tn KleinTrain
# 6) 盯日志
Get-Content D:\开发文件\lora-train\train_run.log -Tail 20   # 经 ssh r5080
```

预计耗时：500 步 ~50-80 分钟（Defender 排除后 ~40-50 分钟）。

## 4. 部署

```powershell
# 5080：产物拷到 ComfyUI loras + NAS 备份
Copy-Item "D:\开发文件\lora-train\output\klein-<module>-v1\klein-<module>-v1.safetensors" `
  "D:\开发文件\ComfyUI\models\loras\" -Force
# 重启 ComfyUI（模型列表刷新）
# models.json：给 flux2-klein-4b 改 lora 字段，或新增独立条目（如 flux2-klein-4b-monster）
```

## 5. 验收

1. 生成 4-6 张**训练集外新主题**（不同 seed）；
2. GLM-4.6V 逐张审计（按模块类型写检查项，如图标：干净单六边形/金边完整/无多余突出物）；
3. 尺寸/构图校验 + 归一化：
   - 技能图标：`normalize-skill-icon.py`（fill 70% / cy +29）+ `check-icon-sizes.py`
   - 怪物贴图：`sprite-normalizer.py`（内容高 477px / 脚底 y=492）
   - 装备图标：`verify-eclipse-icons.py`（最长边 0.90 / 比例 [0.72,1.4]）
4. 不合格：先查提示词，再查数据集，最后才加步数重训。

## 6. 坑位清单（全部踩过）

- **数据集自相矛盾 = 最大坑**：标注与图片不符 → LoRA 分裂。审计先行。
- **PyPI 默认 torch 是 CPU 版**：必须 `--index-url https://download.pytorch.org/whl/cu128`；装完复验 `torch.cuda.is_available()`。
- **GitHub / HuggingFace 被墙**：代码走 gh-proxy，权重走 ModelScope，TE 必须本地路径（yaml `model_kwargs` 已打通）。
- **ai-toolkit 三处补丁**（升级后需复核）：`low_cpu_mem_usage=True`、`del transformer_state_dict`、`model_kwargs` 读取。
- **16GB 显存必须关 ComfyUI 再训**；空闲挂机也要留意采样峰值。
- **训练被 Defender 拖慢**：给 `D:\开发文件\lora-train` 加排除项（MsMpEng 实测拖慢 2-3 倍）。
- **schtasks 跑长任务**：ssh 断连会杀进程树；日志用 `*> file` 重定向（Start-Transcript 抓不到子进程）。
