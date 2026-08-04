# 生图标准工作流（2026-08-04 定稿，二轮更新）

> **唯一权威入口**。新技能贴图/图标、障碍物、装备/首饰图标、怪物/角色素材、投射物、视频一律按本文档执行；
> 提示词一律从 [`prompts/`](prompts/README.md) 取用**固化模板**，禁止现场自由发挥。
> SKILL.md 文首「本地 AI 出图工作流」为本节的摘要速查，本文档为准。
>
> **入口优先级（2026-08-04 二轮调整）**：双机 ComfyUI 自建生图系统（远程 5080 主力 +
> 本机 3080 Ti 兜底）→ **本地零成本**；智谱 API 降级为第三兜底（双机都不可用/特殊场景）。

## 0. 工作根目录约定

- 本文档位于 `game-dev/tools/ai-gen/`（随仓库版本化）；命令相对**工作区根目录**执行：
  `E:\无尽轮回\长期备份\2026-7-13-1`
- 根目录 `tools/` = 生图/抠图/校验工具（ComfyUI 多模型客户端、models.json、BiRefNet 等）；
  `game-dev/` = 版本仓库（源码 + 入库资产 + 本工作流与提示词库）
- 所有脚本在根目录下以 `python tools/xxx.py ...` 调用；ComfyUI 启动脚本见下表。

## 1. 生成入口矩阵（先选入口，再选模型）

| 场景 | 入口 | 命令 |
|---|---|---|
| **远程主力机（默认）** | 远程 5080 | `python tools/comfyui-gen.py --host 192.168.3.142 --model flux2-dev-fp8 --prompt "..." --out out.png` |
| 远程·固定视角/方向 | 远程 5080 + Depth ControlNet | `python tools/comfyui-gen.py --host 192.168.3.142 --model flux2-dev-depth --control-image depth.png --prompt "..." --out out.png` |
| 跨机双卡·最高质量提速（Daedalus 在线） | 5080 Icarus + 本机 3080 Ti Daedalus | `python tools/comfyui-gen.py --host 192.168.3.142 --model flux2-dev-mesh --prompt "..." --out out.png`（8 步 turbo；Daedalus 需先启动，见 §1.6） |
| 本地兜底 | 本机 3080 Ti | `python tools/comfyui-gen.py --host 127.0.0.1 --model sdxl --prompt "..." --out out.png`（已装 sdxl；FLUX.2 dev 建议 5080） |
| 透明主体素材 | 远程 5080（SDXL 兜底） | `python tools/comfyui-gen.py --host 192.168.3.142 --model flux2-dev-depth --control-image depth.png --transparent --prompt "..." --out out.png`（AI 选纯色底 + 自动抠图，见 §3.7） |
| 兜底·智谱 API | 智谱 | `python tools/ai-gen/zhipu-gen.py --prompt-file prompt.txt --model glm-image --size 1280x1280 --out ...`（双机不可用/免费额度场景） |
| 同系列模板锁定重抽 | img2img | `python tools/gen-meteor-icon-template.py`（换参考图 + 提示词即可复用） |
| 批量多图 | 智谱/ComfyUI | 参考 `tools/zhipu-gen-necklaces.py`（多 prompt 逐张下载）、`tools/gen-eclipse-set.py`（批量入队轮询） |

- 模型登记表：`tools/models.json`（`python tools/comfyui-gen.py --list-models` 查看）。
  当前：`flux2-dev-fp8`（**5080 主力**，20~30 步/CFG≈3.5）+ `flux2-dev-depth`（同模型 +
  Fun-Controlnet-Union 深度控制）+ `flux2-dev-mesh`（**跨机双卡**，8 步 turbo + Turbo LoRA 两端本地加载）+
  `sdxl`（checkpoint，通用）+ `flux2-klein-4b`（FLUX.2 蒸馏，4 步备用）。
- **5080 已装模型（2026-08-04 实机核对）**：diffusion `flux2_dev_fp8mixed.safetensors`、
  文本编码器 `mistral_3_small_flux2_fp4_mixed.safetensors`、VAE `flux2-vae.safetensors`、
  ControlNet `FLUX.2-dev-Fun-Controlnet-Union.safetensors`（Depth/Canny/Pose 等单文件多模式）。
- 智谱 API 注意事项：**不支持负面词参数**（避项写进正向提示词）；出图固定带右下角
  "AI生成"水印（`tools/zhipu-process.py` 按连通域+面积过滤去水印，见 §4.5）。
- 远程 5080 开机方式：`tools/start-comfyui-remote.bat`（`--listen 0.0.0.0`，防火墙放行
  8188/专用网络；**机器休眠会断服务，需关休眠**）。本地启动 `start-comfyui.bat`。

### 1.5 FLUX.2 dev + Depth ControlNet（固定视角/方向，5080 主力）

**能力**：FLUX.2 dev fp8 出图质量/细节强于 klein，配合 `FLUX.2-dev-Fun-Controlnet-Union`
（alibaba-pai，Depth/Canny/HED/Pose 单文件多模式 ControlNet）用**深度图锁定构图视角与方向**，
提示词只负责主体/材质/风格——解决同系列"每次视角都不一样"的痛点。

**命令**（`--model flux2-dev-depth` + `--control-image` 必传）：

```bash
python tools/comfyui-gen.py --host 192.168.3.142 --model flux2-dev-depth \
  --control-image tools/_depth_template.png \
  --prompt "a magic skill icon, purple hexagonal badge with gold trim, embossed crystal base, centered on white background, high detail" \
  --out Y:\工作\无尽轮回\scratch\badge_v2.png
```

**深度图来源（按优先级）**：
1. 同系列已定稿图标 → DepthAnything V2 / MiDaS 提取深度图（锁住同视角构图，主体换新）；
2. 手绘剪影/白模/占位图（摆好视角与位置）→ 深度图 → 主体由模型重绘；
3. 目标视角的真实照片/3D 渲染图 → 深度图（等距/侧视等）。
- 深度图预处理建议装 `comfyui_controlnet_aux`（DepthAnything V2/MiDaS）到 5080 或本机，
  在工作流内一条龙；未装时先在外部生成深度图 PNG，再经 `--control-image` 传入。

**参数**：
- ControlNet 强度 0.6~0.8（models.json 默认 0.75）；强度过高主体变形，过低视角锁不住。
- 步数 20~30、CFG 2.5~4.0（推荐 3.5）；Euler。
- FLUX.2 支持 **JSON 结构化提示词**（BFL 官方）：`camera: {angle, lens, distance,
  depth_of_field}` 块可额外固定视角/镜头（docs.bfl.ai JSON Structured Prompting），
  与深度图双保险。

**环境依赖（已修复 2026-08-04）**：远程 5080 的 `comfyui-flux2fun-controlnet`（v1.1.0）
两处兼容补丁（`timestep_zero_index` / `multigpu_clones`）与 comfyui-mesh Icarus stub 补丁
均已部署并重启（备份 + 修复版在 `tools/remote-patch/`），`flux2-dev-fp8` / `flux2-dev-depth` /
`flux2-dev-mesh` 全部可用。

### 1.6 模型选择矩阵（内容 → 首选模型 → 规则，2026-08-04 定稿）

**决策总纲**：入库资产 = 质量优先（Dev）；批量/探索 = 速度优先（Klein 4B）；
兜底 = SDXL / 智谱；视频 = 只有 MiniMax H3。Mesh 仅在 Daedalus 在线时启用，
用于加速 Dev（8 步 turbo）或双卡精修（20 步无 turbo）。

| 内容/项目 | 首选模型 | 备选 | 规则与参数 |
|---|---|---|---|
| 技能图标·正式入库（六边形徽章系列） | FLUX.2 Dev（mesh 8 步 turbo 或单卡 24 步） | Klein 4B 初筛 → Dev 精修 | 模板锁定 img2img（同色调系参考）；内容框对标 fireball 基准；抠图 1024² 入库 |
| 技能图标·候选/批量探索 | Klein 4B（4 步） | 智谱 glm-image | 粗筛后仅精品送 Dev 精修 |
| 装备/首饰图标 | FLUX.2 Dev（单卡） | SDXL（风格已调流程可保留） | style_prefix 单件强制语法；1536² 归一化 + verify-eclipse-icons 复核 |
| 障碍物/道具（同视角块） | FLUX.2 Dev + Depth ControlNet | Klein 4B | 深度图锁视角（§1.5）；同一视角块统一提示词；prep-obstacle 抠图 |
| 怪物/角色贴图 | FLUX.2 Dev（mesh 加速） | — | 统一基准图 + 同色调系 img2img；sprite-normalizer 规格校验；动作帧走 img2video |
| 投射物贴图 | FLUX.2 Dev（img2img 参考既有） | Klein 4B | 抠图入库；**纯色小物件（雪球等）禁止 AI**，运行时 createCanvas |
| 透明主体 PNG（图标/装备/怪物/道具） | FLUX.2 Dev + `--transparent` | SDXL | AI 选纯色底 + 阈值抠图 + BiRefNet；**白主体禁白底**（§3.7） |
| 背景/场景大图 | FLUX.2 Dev（单卡 20~30 步，1536²+） | — | 大图优先单卡避免 mesh 低显存开销；批量草稿可 mesh |
| 视频/动画 | MiniMax H3（唯一） | — | `tools/minimax-h3-gen.py`；MP4 入 assets/videos 或抽帧转 sprite sheet |
| 兜底链（双机不可用） | 智谱 API glm-image | — | 不支持负面词（写进正向）；去水印走 zhipu-process.py |

**mesh 开关规则**：
- 启用：Daedalus 在线（本机 `tools/start-daedalus.ps1 -SkipSmoke`，n_blocks=4，
  Turbo LoRA 两端本地加载）+ 需要提速/双卡。
- 关闭：Daedalus 未启动时 mesh 工作流会失败——回退 `flux2-dev-fp8`（单卡）或
  `flux2-dev-depth`（锁视角）。
- 质量档：8 步 turbo（默认，快）vs 20 步无 turbo（精修，慢）——正式精修建议 20 步。
- 提速替代（待实测）：单卡 Dev + Depth ControlNet + Turbo LoRA（8 步，不加 mesh）——
  若深度控制不变形，可作"锁视角 + 快"选项，届时注册 `flux2-dev-depth-turbo`。

**机器分布规则**：5080 主力（Dev / Depth / Klein / MiniMax）；mesh 后端 = 本机
3080 Ti（Daedalus）；本机单卡兜底 = SDXL；智谱 API 第三兜底。

## 2. 六步标准流程（所有资产通用）

### 第 1 步：定风格

- 先看项目现有同类素材，锁定**系列基准**：风格块 + 内容框（bbox）宽/高、宽高比、占比、中心偏移。
- 用 `python tools/check-icon-sizes.py` 量化现有同系列图，记录基准后再生成。
- 已固化的系列基准（新同类必须对齐，偏差 >5% 重抽或归一）：

| 系列 | 基准 | 基准来源 |
|---|---|---|
| 魔法技能图标（六边形徽章） | fireball：bbox 788×939 / 宽高比 0.84 / 占比 ~70% / cy≈+29（偏下） | 陨星坠落实战 |
| 装备/首饰图标 | 最长边占画布 0.90、纵横比 ∈[0.72,1.4]、包围盒居中 | 装备/道具图标统一处理工作流 |
| 玩家/怪物精灵 | 内容高 477px、脚底基线 y=492（512×516 画布） | 玩家角色动画标准工作流 |

### 第 2 步：生成

- 提示词从 `prompts/` 库取用：主题块 + 材质细节块 + 视角块 + 风格基准块 + 负面词块（拼接顺序固定）。
- **固定视角/方向（默认路径）**：FLUX.2 dev + Depth ControlNet（`flux2-dev-depth`，
  深度图经 `--control-image` 传入），同系列直接复用已定稿图的深度；视角/方向由深度图锁定，
  提示词不用反复强调视角。
- **跨机双卡（Daedalus 在线时）**：`flux2-dev-mesh`（8 步 turbo + Turbo LoRA 两端本地加载，
  服务端每步约 0.8s）；自由提示词的提速/批量用；锁视角流程仍走 depth（mesh 不支持 ControlNet，§1.6）。
- **模板锁定 img2img（同系列图标必用）**：参考图先压白底再上传
  （透明角直传会被合成黑底 → 出黑角图）；提示词强调 `same template/size/position as reference`。
- 候选批量：不同 seed × 多档 denoise（如 0.62/0.68/0.74/0.80），产出 4~8 张候选后统一粗筛。
- 生成默认输出到 `Y:\工作\无尽轮回\scratch\`（脚本默认），定稿才进仓库。

### 第 3 步：粗筛（像素统计，先量化）

- 指标：opaque% 主体占比、白底/背景比例、bbox 宽高比、中心偏移、连通域数量。
- **连通域计数是唯一硬证据**（多视图/多件排列）：`python tools/check-components.py`
  对 BiRefNet alpha>60 做 `ndimage.label`，**components == 1 才合格**（GLM-4V 说"五个视角"不可轻信）。
- 内容框与系列基准偏差 >5% → 重抽或归一化，不直接入库。

### 第 4 步：视觉验收（GLM-4V 定性 × 像素统计定量）

```bash
node "C:\Users\allan\.codex\skills\deepseek-vision-skill\scripts\describe-image.js" --prompt "画面主体是什么？构图/风格是否符合要求？" "候选图.png"
```

- **单张 + 具体问题**，多图一起描述会串扰；背景色判断不可靠（以角点像素均值为准）。
- 定位类问题（鞋头朝向、握把位置）用**特写裁剪图**（目标区裁小、2~3 倍放大）问，回答稳定可用。
- 像素统计与 GLM 描述矛盾时，**以像素统计为准**。

### 第 5 步：抠图入库

- 白底简单主体：`python tools/make-transparent-icon.py <src.png> <dst.png>`
  （角点 flood fill + 最大连通域 + 羽化 + 边缘去污染）。
- 透明主体默认（方案一）：生成时加 `--transparent` 一键完成「AI 选纯色底 → 出图 →
  阈值抠图 → BiRefNet 精修」（`tools/pick_bg_color.py` + `tools/transparent_cutout.py`），
  纯色底由 AI 决定，不再手写白底；产物 `out.png`（RGBA）+ `out_raw.png`（原图）。
- 复杂背景/贴边主体（装备类）：**BiRefNet 优先**
  （`tools/birefnet-cutout.py` / `tools/birefnet-icon-pipeline.py`，模型权重走 ModelScope 镜像，
  运行环境用 ComfyUI venv）。纯色阈值抠图会把贴边主体/浅灰渐变抠残，禁止用于装备。
- 入库规格：技能图标 1024×1024 透明底；装备图标 1536×1536 透明底 + 归一化
  （最长边 0.90 / 纵横比 [0.72,1.4] / 包围盒居中，脚本 `tools/verify-eclipse-icons.py` 复核）。
- 边缘白边硬筛：alpha∈(10,245) 边缘像素白色占比应为 0%（>0.5% 重抠或重生成，
  参考 `tools/edge-check-eclipse.py`）。

### 第 6 步：清理废案（强制）

- 确认最终资产已被引用后，删除迭代过程中全部废案与未调用图片——被否方案、v1/v2…迭代版、
  候选图、预览图、临时抠图一律清除（2026-08-03 教训：blizzard-icons v1~v6、ice-icons-v1、
  snowball 变体共 79MB 全部删除），只保留最终被引用的文件。
- 候选/中间产物落 `Y:\工作\无尽轮回\scratch\`，仓库只保留被引用资产。

## 3. 各类资产子流程

### 3.1 技能图标（六边形徽章系列）

提示词模板：`prompts/skill-icon.md`；流程：模板锁定 img2img（火球白底参考）→ 候选批量 →
内容框校验（对标 fireball 基准）→ 抠图 1024² → 入库 `assets/skills/`。

### 3.2 装备/首饰图标

提示词模板：`prompts/equipment-icon.md`；流程：FLUX.2 Dev 文生图（首选；风格已调流程可保留
SDXL 的 style_prefix + 单件强制语法）→ BiRefNet 抠图 → 1536² 归一化（0.90 / [0.72,1.4] / 居中）→
`tools/verify-eclipse-icons.py` 复核 → 入库 `assets/icons/equipment/`（或 `assets/skills/` 对应引用路径）。

### 3.3 障碍物/道具

提示词模板：`prompts/obstacle.md`；抠图走 `tools/ai-gen/prep-obstacle.py`；
入库 `assets/terrain/obstacle_*.png` + `ISO_WALL_GEO` 注册。新道具必须同一视角块。

### 3.4 怪物/角色贴图

提示词模板：`prompts/monster-sprite.md`；统一基准图 + 同首帧 img2video 保证跨动作一致；
入库前过 `tools/sprite-normalizer.py`（内容高 477px、脚底基线 y=492、帧尺寸严格）。

### 3.5 投射物贴图

- 优先 img2img 参考既有投射物图（如 Meshy 冰锥）→ 抠图 → 随机抽取入库（冰锥 4 张范例）。
- 纯色小物件（雪球等）直接运行时 `createCanvas` 生成纹理，不要 AI 出图再抠。

### 3.6 视频（MiniMax H3）

提示词模板：`prompts/video.md`；客户端 `python tools/minimax-h3-gen.py`；
输出 MP4 直入 `assets/videos/` 或 PyAV 抽帧转 sprite sheet（动作动画截帧路线）。

### 3.7 透明主体（需要透明 PNG 的图标/装备/怪物/道具）

提示词模板：`prompts/transparent-subject.md`；入口加 `--transparent`：
`tools/comfyui-gen.py --transparent`（AI 选色 `tools/pick_bg_color.py` 写入提示词 →
出图后 `tools/transparent_cutout.py` 阈值抠图 + BiRefNet 精修；检测到背景非均匀时
自动切 BiRefNet 主导）。产物 `out.png`（RGBA）+ `out_raw.png`（原图）。
**白色要素多的主体（白衣/白甲/银饰）禁用白底**——白底抠不净需人工介入，纯色底阈值一刀切。

## 4. 沉淀的坑（防再犯）

1. **同系列优先**：魔法技能图标必须复刻"六边形徽章+浮雕底座"（暴风雪 v1 白底贴纸被否）。
2. **观感由内容框决定**：图标观感 = bbox/宽高比/占比/偏移，与画布像素无关（陨星 FLUX.2 直出窄徽章被否）。
3. **img2img 主体替换顽固**：低 denoise(0.55~0.65) 保框架不换主体，高 denoise(0.75+) 换主体丢底座 →
   两段式：先合适 denoise 出主体，再局部 inpaint 补底座。
4. **换系列主体不要用异系参考**：用暴风雪（冰蓝）参考永远被回染成蓝色晶体的色相偏置，要用同色系参考。
5. **ComfyUI inpaint 遮罩**：`SetLatentNoiseMask` 的 mask 来自 `LoadImage` 的 **alpha 通道输出**
   （节点第 2 个输出）；遮罩存成无 alpha 灰度图会被当空遮罩 → 只改 ~1% 像素。必须存 RGBA。
6. **智谱水印**：去水印按"右下角 y≥78% 区域、面积最小、最靠角落的暗色连通域"定位；
   全右下象限 bbox 会把戒指底部误当水印覆盖出缺口（星陨之戒两连坑）。
7. **简笔画陷阱**：去徽章写 `no large emblem, no diamond, no triangle, no crest` 而非
   `plain blank surface`，同时保留 `velvet fabric texture, folds, rich shading` 写实质感。
8. **纯白背景遵循不稳**：SDXL 可能出浅灰/渐变底，背景色以角点像素均值判定，不要信 GLM 描述。
9. **废案必清**：见第 6 步；入库后必须删除迭代废案，防止仓库膨胀。
10. **白色要素多禁用白底**：白/银主体白底必然抠不净 → 走 `--transparent` 纯色底方案一
    （AI 选底色 + 阈值抠图 + BiRefNet 精修；SDXL 不按 hex 渲染出渐变底时，抠图器自动切
    BiRefNet 主导，无需人工介入）。
11. **Mesh 跨机运维**：Daedalus 需先启动（`tools/start-daedalus.ps1 -SkipSmoke`）；客户端崩溃
    遗留半截会话会把 Daedalus 卡死（socket 显示监听但拒绝新连接）→ 重启 Daedalus 即可；
    n_blocks_remote 只能增不能减（调小要重启 ComfyUI）；单客户端独占；
    wire-contract 文件（codec/protocol/vec_io/lora_io）两端必须字节级一致；
    本机 safetensors 绑定崩溃已用 `safetensors_raw.py` 绕过，升级需复核补丁。
12. **Mesh 不支持 ControlNet**：官方源码/issue 均无支持，架构上 Daedalus 后端收不到
    ControlNet 条件——锁视角流程必须走单卡 `flux2-dev-depth`，mesh 只跑自由提示词。
13. **测试视频/候选不提交仓库**：`assets/videos/` 已入 .gitignore；测试视频统一放
    `Y:\工作\无尽轮回\scratch\videos\`，仓库只保留被引用的最终资产。

## 5. 归置原则（NAS Y:\）

- `Y:\素材库\`：原始素材/参考图
- `Y:\工作\无尽轮回\scratch\`：AI 出图/视频中间产物与候选（生成脚本默认输出地，定稿才进仓库）
- `Y:\模型库\ComfyUI\models\`：大模型归档（双机共用；冷模型 junction，热模型留本机）
- 仓库只保留被引用资产；候选/废案/大视频一律落 Y:，E: 只放源码 + 入库资产。
- 版本控制走 GitHub（origin `allang2208/wuxianlunhui`）；`tools/backup-to-nas.ps1` 为手动可选备份。
