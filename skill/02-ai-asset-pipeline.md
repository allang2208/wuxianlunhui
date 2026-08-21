> 本文件为 game-dev 技能库分卷，主索引与目录见 ../SKILL.md
> 本节：2. AI 资产与出图管线

## 2. AI 资产与出图管线

### ⭐ AI 资产统一入口：ai-asset.py（2026-08-08 定稿，开展 AI 生图/视频/抠图/怪物动画工作一律先走这里）

**任何涉及 AI 生成图片、生成视频、抠图、怪物动画精灵图、CLEAN 验证的工作，
一律从 `game-dev/tools/ai-gen/ai-asset.py` 进入**（ComfyUI venv python 运行）。
一个大类一个入口（当前：monster），固定工作流已编排好，**不要散落到各底层脚本找命令**
（底层 comfyui-gen / minimax-h3-gen / quadruped-rebuild / rmbg_cutout / pick_bg_color
是 ai-asset 的内部实现，可单独调试但日常工作从入口进）。

```bash
# 四足怪物工作流（idle → 动画视频 → sheet，全链路强制主体无色背景 + ComfyUI-RMBG 抠图）
python tools/ai-gen/ai-asset.py monster idle    --name <X> --ref <参考图> --prompt <提示词.txt> [--bg-color auto|#hex]
python tools/ai-gen/ai-asset.py monster video   --name <X> --kind run|attack --ref <idle图> [--bg-color auto|#hex]
python tools/ai-gen/ai-asset.py monster rebuild --name <X> --video <y.mp4> --kind run|attack [--bg-color 同色] [--cell 640]
python tools/ai-gen/ai-asset.py monster status  --name <X>
# 枪械武器全自动添加（add-weapon.py 编排：scaffold → gen-image → process-image → gen-video → verify）
python tools/ai-gen/ai-asset.py weapon scaffold      --spec tools/ai-gen/weapon-specs/<key>.json
python tools/ai-gen/ai-asset.py weapon gen-image     --spec <spec> [--seeds 1,2,3] [--ref-image 参考图]
python tools/ai-gen/ai-asset.py weapon process-image --spec <spec> --raw <候选图.png>
python tools/ai-gen/ai-asset.py weapon gen-video     --spec <spec>
python tools/ai-gen/ai-asset.py weapon verify        --spec <spec>
# 装备/道具/技能图标
python tools/ai-gen/ai-asset.py icon transparent --src <白底图> --dst <out.png>
python tools/ai-gen/ai-asset.py icon normalize   --src <png> --dst <out.png>
python tools/ai-gen/ai-asset.py icon pipeline    [--keys k1,k2]
python tools/ai-gen/ai-asset.py icon check
# 人形怪/工头动画（h3-loop / h3-attack 抽帧）
python tools/ai-gen/ai-asset.py humanoid loop   --video <loop.mp4> --out walking.png [--period 48,48]
python tools/ai-gen/ai-asset.py humanoid attack --video <attack.mp4> --out attack.png
# LoRA 训练（5080）
python tools/ai-gen/ai-asset.py lora prep    # 从技能图标生成训练集
python tools/ai-gen/ai-asset.py lora train --yaml <本地或远程配置.yaml>   # schtasks 启动，防断连杀进程
python tools/ai-gen/ai-asset.py lora status  # 进程/GPU/checkpoint
# 通用子命令（所有大类复用）
python tools/ai-gen/ai-asset.py cutout   --src <图> --out <alpha.png>
python tools/ai-gen/ai-asset.py bg-color --image <参考图>
python tools/ai-gen/ai-asset.py verify   --sheet <sheet.png> --cell 512|640
```

铁律（入口内置，但记在这里防绕路）：
- **背景色强制**：生成背景必须用主体没有的颜色（`--bg-color auto` 自动选，或显式
  `#hex`），抠图侧 `rebuild --bg-color` 传同色；
- **抠图强制 ComfyUI-RMBG**（BiRefNet-general，`rmbg_cutout.py` 唯一入口）；
- 所有子命令支持 `--dry-run` 先看命令；
- 产物统一落 `Y:\工作\无尽轮回\scratch\<name>_*`，`monster status` 一键查。
- 详细参数/异常处理见「四足动物（狼系）动画精灵图全管线」章节。

---
### ⭐ 识图优先入口：GLM-4.6V 识图系统（2026-08-03 构建，读图一律先走这里）

需要读取/理解任何图片（用户发图、游戏截图、贴图、UI 截图、OCR 等）时，
**优先调用已构建的 GLM-4.6V 识图系统**（deepseek-vision-skill，智谱 GLM-4.6V 接口）：

```bash
# 读本地图片（可多张）：
node "C:\Users\allan\.codex\skills\deepseek-vision-skill\scripts\describe-image.js" "路径\图片.png"
# 带具体问题：
node "...\describe-image.js" --prompt "图片里剑柄是否在手中？" "路径\图片.png"
# 恢复用户最新发送的图片（本模型收不到图时）：
node "...\describe-image.js" --latest
```

要点（实战沉淀，2026-08-03 一段攻击跟手三轮）：
- **定位坐标不可靠**：GLM-4.6V 读绝对像素坐标会跑飞（全图/网格/裁剪多格式均验证过）；
  需要精确定位时用它做定性判断（ON/OFF、方向、内容描述、OCR），坐标以贴图真值掩码为准。
- **特写图效果最好**：把目标区域裁小（~140px）、2 倍/3 倍放大、必要时加红点标记当前点，
  问"红点是否在目标上 / 偏哪个方向多少像素"，回答稳定可用。
- 接口 key/endpoint/model 在 skill 目录 `config.json`；provider 守卫要求主模型为
  deepseek-v4-flash/pro（当前 config.toml 即 flash，可直接用）。

---

### 本地 AI 出图工作流（双机 ComfyUI 优先 + 智谱 API 兜底 + GLM-4.6V 验收，2026-08-04 二轮调整）

> **标准执行入口（2026-08-04 定稿）**：`game-dev/tools/ai-gen/WORKFLOW.md`（六步全流程 + 入口矩阵 +
> 各类资产子流程 + 沉淀坑位）与 `game-dev/tools/ai-gen/prompts/`（固化提示词库，8 个模板：skill-icon / equipment-icon /
obstacle / monster-sprite / video / cover / defense-tower / transparent-subject）。
> 本节约为摘要速查，细则以 WORKFLOW.md 为准；提示词一律从 prompts/ 库取用，禁止现场自由发挥。
>
> **入口优先级（2026-08-04 二轮调整）**：双机 ComfyUI 自建生图系统（远程 5080 主力 +
> 本机 3080 Ti 兜底）→ **本地零成本**；智谱 API 降级为第三兜底。5080 主力模型
> **FLUX.2 dev fp8 + Flux.2 Depth ControlNet**（固定视角/方向出图）。

新技能贴图/图标/素材一律**优先走双机 ComfyUI**（本地零成本、不限量）：
远程 5080 主力出图（FLUX.2 dev fp8 + Depth ControlNet 锁视角/方向），本机 3080 Ti 兜底；
智谱 API 作为第三兜底（双机不可用 / 特殊场景，有免费额度）。出图后必须过 GLM-4.6V 验收再入库。

#### 生图入口（优先：双机 ComfyUI；智谱 API 第三兜底，2026-08-04 调整）
- **远程 5080 主力（默认）**：`python tools/ai-gen/comfyui-gen.py --host 192.168.3.142 --model flux2-dev-fp8 --prompt "..." --out out.png`（命令相对 game-dev/ 仓库根目录执行）
- **固定视角/方向**：`--model flux2-dev-depth --control-image <深度图> --prompt "..."`（见 WORKFLOW §1.5）

##### World-122 建筑接地角验收：只测 Alpha 最外轮廓（2026-08-21）
- **提示词、深度图和边缘图不是验收证据**：ImageGen 仍可能重建透视、改变多塔脚位置，或把“透明背景”画成不透明棋盘格；最终必须检查实际 PNG 像素。
- **唯一角度口径**：对真实 Alpha（建议 `alpha >= 128`）取最大外连通域，使用 `findContours(..., RETR_EXTERNAL)` + `approxPolyDP` 提取最下方接地折线；只测这条外轮廓的连续线段。标准 2×2 建筑的地面轴斜率为 `dy/dx = ±0.5`，即屏幕角 `±26.565°`，墙线必须垂直，所有塔脚/门槛必须位于同一地面。
- **禁止用全图 Hough 线段判合格**：砖缝、窗框、屋檐或内部墙线常恰好接近 `±26°`，会掩盖真实塔脚回边达到 `+42°/+51°` 的错误；Hough 只能辅助找候选线，不能代替 Alpha 外轮廓验收。
- **修正边界**：只有整栋建筑两组轴共享同一线性误差时才允许全局仿射；多塔脚各自漂移属于非线性透视，必须重抽、按白模表面投影，或在保持竖线垂直的前提下对实际外轮廓做分段几何映射，然后重新测量每一段。
- **入库门槛**：背景必须是真实 RGBA；主体紧裁后等比缩放；可见接地范围必须落在固定 `256×128` 地基/碰撞菱形内；未确认候选不得覆盖 `assets/terrain/`，定稿入库后删除 raw、预览、控制图和被否版本。
- **本机 3080 Ti 兜底**：`python tools/ai-gen/comfyui-gen.py --host 127.0.0.1 --model sdxl --prompt "..." --out out.png`
- 客户端：`tools/ai-gen/zhipu-gen.py`（--prompt / --prompt-file / --model / --size / --out）
- 接口：`POST https://open.bigmodel.cn/api/paas/v4/images/generations`，默认模型 **glm-image**（推荐 1280×1280）
- key：环境变量 `ZHIPU_API_KEY` → 自动读 deepseek-vision-skill 的 `config.json`（与 GLM-4.6V 共用智谱账号）
- **可用模型（2026-08-03 实测）**：`cogview-3-flash`（1024×1024，单物件图标可出）同样可用；
  `glm-4.6v` 是**识图模型不能生图**，别混用。批量多图脚本参考
  `tools/ai-gen/archive/one-off/zhipu-gen-necklaces.py`（一次性脚本已归档，仅作写法参考，
  勿当通用工具；一次提交多 prompt，逐张下载）。
- **不支持负面词参数**：避项（watermark / text / blurry 等）必须写进正向提示词
- **固定水印**：每张图右下角带"AI生成"水印；去水印需账号在智谱后台签免责声明
  （cogview-3-flash 实测同样带水印）。处理：`tools/ai-gen/zhipu-process.py` 检测右下角
  **面积最小、最靠角落**的暗色连通域为水印框（y≥78% 区域，面积 >800px 跳过防误伤主体）→
  白底覆盖 → BiRefNet 抠图丢弃。**教训：全右下象限暗像素 bbox 会把戒指底部误当水印
  覆盖出缺口（2026-08-03 星陨之戒两连坑），必须按连通域+面积过滤。**
- 障碍物统一提示词策略：`game-dev/tools/ai-gen/prompts/obstacle.md`
  （风格基准块 + 视角块 + 避项，新道具必须同一视角）；抠图走 `tools/ai-gen/prep-obstacle.py`

#### 环境（ComfyUI 双机系统，2026-08-04 二轮）
- **远程 5080 主力机（2026-08-04 沉淀）**：`192.168.3.142:8188`（RTX 5080 16GB，ComfyUI 0.30）；
  启动 `tools/ai-gen/start-comfyui-remote.bat`（`--listen 0.0.0.0`，防火墙放行 8188/专用网络；
  机器休眠会断服务，需关闭休眠）
- 已装模型（2026-08-04 实机核对）：**FLUX.2 dev fp8**（`flux2_dev_fp8mixed` +
  `mistral_3_small_flux2_fp4_mixed` + `flux2-vae`）+ **FLUX.2 Depth ControlNet**
  （`FLUX.2-dev-Fun-Controlnet-Union.safetensors`，Depth/Canny/HED/Pose 单文件多模式）+
  SDXL（`sd_xl_base_1.0`，对比/兜底）+ FLUX.2 klein 4B（`flux-2-klein-4b-fp8` +
  `qwen_3_4b`，蒸馏备用）+ MiniMax H3 视频模型
- **多模型切换客户端**：`tools/ai-gen/comfyui-gen.py`（`--model` / `--host` / `--list-models`，
  模型登记表 `tools/ai-gen/models.json`，每模型独立工作流+默认参数）
  ```bash
  python tools/ai-gen/comfyui-gen.py --host 192.168.3.142 --model flux2-dev-fp8 --prompt "..." --out out.png
  python tools/ai-gen/comfyui-gen.py --host 192.168.3.142 --model flux2-dev-depth --control-image depth.png --prompt "..." --out out.png
  python tools/ai-gen/comfyui-gen.py --host 192.168.3.142 --model flux2-dev-mesh --prompt "..." --out out.png
  python tools/ai-gen/comfyui-gen.py --host 192.168.3.142 --model sdxl --prompt "..." --out out.png
  ```
- **兼容修复已应用（2026-08-04）**：flux2fun-controlnet v1.1.0 两处补丁
  （`timestep_zero_index` / `multigpu_clones`）与 comfyui-mesh Icarus stub 补丁已在 5080
  部署（备份与修复版在 `tools/ai-gen/remote-patch/`），FLUX.2 全系列正常出图。
- **跨机 Mesh（2026-08-04 实测通过）**：FLUX.2 dev fp8 拆两卡——5080 跑前端（Icarus），
  本机 3080 Ti 跑后端 4 块（Daedalus @192.168.3.153:7777，n_blocks=4，Turbo LoRA 两端本地加载）。
  用法：`--model flux2-dev-mesh`（8 步 turbo，服务端每步约 0.8s）。前提：本机 Daedalus 已启动
  （`tools/ai-gen/start-daedalus.ps1 -SkipSmoke`）；客户端崩溃遗留会话会卡死 Daedalus，重启即可。
- **模型选择矩阵（2026-08-04 定稿）**：入库资产用 FLUX.2 Dev（mesh 在线时 8 步 turbo 提速），
  批量/探索用 Klein 4B（4 步），兜底 SDXL / 智谱 API，视频只有 MiniMax H3；
  完整矩阵（含各资产子流程的规则/参数）见 `game-dev/tools/ai-gen/WORKFLOW.md §1.6`。
- **类目路由（2026-08-05 定稿）**：中大型物件（建筑/道具/植被/家具）默认从 Blender 白模
  深度起步（`tools/ai-gen/blender-depth-render.py` + `_blockout_specs/`，锁视角/朝向/比例）；
  小型装备/图标不走白模，直接 prompts/ 统一模板 + 标准生图。细则见 WORKFLOW.md §1.5。
- 本地 3080 Ti 兜底：http://127.0.0.1:8188，启动 `start-comfyui.bat`（位于备份根目录
  `E:\无尽轮回\长期备份\2026-7-13-1\`，不在 game-dev 仓库内；同一客户端，`--host 127.0.0.1`）
- 抠图/校验：`tools/ai-gen/make-transparent-icon.py`（白底→透明 RGBA）、`tools/ai-gen/check-icon-sizes.py`（内容框测量）
- 同系列新图标模板化生成：`tools/ai-gen/gen-meteor-icon-template.py`（换参考图+提示词即可复用）
- **队列/超时/抠图坑（2026-08-11 铁匠正面版实战）**：
  - **5080 队列会被视频任务挤压**：ComfyUI 队列里有 minimax_h3 视频任务时，一张
    dev 图排队 10~20 分钟甚至更久——提交前先查 `/queue`，长任务客户端
    `--timeout 900` 也不够，**shell 调用本身的 timeout 要 ≥15 分钟**（否则 shell
    截断客户端，任务留在服务端继续跑）。
  - **客户端超时退出后图不会下载到 --out**：任务完成后 PNG 留在 ComfyUI
    output 目录——查 `/history` 拿文件名，再用
    `/view?filename=<名>&subfolder=&type=output` 手动下载（本例 comfyui_0060X）。
  - **BiRefNet 会吞"站立底座"**：铁匠脚下棕色木桩被判为背景抠掉（底部只剩脚宽
    170px vs 木桩应 ~320px）。抠图后必须**像素检查底部不透明宽度**；从 raw 用
    **背景色距离阈值**把底座单独抠回（`tools/ai-gen/restore-blacksmith-stump.py`，
    自动检测四角背景色 + 底部区域合并，max alpha）。
  - **正面人形剪影深度图**：头+鼠耳+身体+裙摆+腿+底座即可锁正面（IoU 0.82 验证）；
    锤子必须把**锤柄画到手上**（柄斜线连到腰侧手位），否则模型出"悬浮锤"
    （v1 教训）；提示词补 "hammer held firmly in her hand" 双保险。
  - **验收要合成灰底预览**（restore 脚本自带 `_preview.png`），GLM 单张逐项过；
    透明底直接看会漏底座缺失（v1 教训）。

#### 标准流程（六步）
1. **定风格**：先看项目现有同类素材（魔法技能图标=紫色六边形徽章+金描边+底部浮雕方块底座），新贴图必须同系列
   → 同系列内容框基准（2026-08-04 陨星教训）：fireball=788×939、宽高比 0.84、占比~70%、偏下构图(cy≈+29)，
   用 `tools/ai-gen/check-icon-sizes.py` 量化对齐
2. **生成**：默认 `flux2-dev-fp8`（5080）；**固定视角/方向走 `flux2-dev-depth` +
   `--control-image` 深度图**（同系列复用已定稿图深度，见 WORKFLOW §1.5）；
   白底 sticker 提示 + 强负面词（gradient/dark/frame/hexagon）；img2img 以现有同系列图为参考；
   **模板锁定 img2img**：参考图先压白底再上传（透明角直传会被合成黑底→出黑角图），
   提示词强调 same template/size/position as reference
3. **粗筛**：像素统计（opaque% 主体占比、白底比例、bbox 宽高比、中心偏移）；
   新图标入库前必须过 `tools/ai-gen/check-icon-sizes.py`，内容框与系列基准偏差 >5% 需重抽或归一
4. **视觉验收**：GLM-4.6V 定性（内容/风格/构图）+ 像素统计定量交叉，二者矛盾时以像素统计为准
5. **抠图入库**：统一走 `tools/ai-gen/make-transparent-icon.py`（角点 flood fill + 羽化 + 边缘去污染，
   1024×1024 透明底入库），入库后再跑 `tools/ai-gen/check-icon-sizes.py` 复核
6. **清理废案（强制）**：确认最终资产已被引用后，删除迭代过程中的全部废案与未调用图片——
   被否方案、v1/v2…迭代版、候选图、预览图、临时抠图一律清除，只保留最终被引用的文件，防止仓库膨胀

#### 技能贴图要点（逐步沉淀，2026-08-03 首版）
- **同系列优先**：魔法技能图标必须复刻现有"六边形徽章+浮雕底座"风格，不要自由发挥（暴风雪 v1 白底贴纸被否）
- **同系列大小统一（2026-08-04 陨星教训）**：图标观感由内容框（非透明 bbox）决定，与画布像素无关；
  系列基准=fireball 788×939/宽高比 0.84/占比~70%/偏下 cy≈+29。FLUX.2 直出窄徽章（750×951）观感偏小 →
  必须用参考图模板锁定 img2img 重抽 + check-icon-sizes.py 校验后入库
- **img2img 主体替换顽固**：低 denoise（0.55~0.65）保框架但主体不换，高 denoise（0.75+）换主体但丢底座细节
  → 两段式：先合适 denoise 出主体，再对局部区域 inpaint 补回底座
- **ComfyUI inpaint 遮罩坑**：`SetLatentNoiseMask` 的 mask 来自 `LoadImage` 的 **alpha 通道输出**（节点第 2 个输出）；
  遮罩存成无 alpha 的灰度图会被当空遮罩 → inpaint 只改 ~1% 像素。遮罩必须存 RGBA，alpha=255 为重绘区
- **白底出图**：提示含 "sticker style, isolated on plain pure white background"，负面含 gradient/dark/frame/border/hexagon；
  SDXL 对"纯白背景"遵循不稳定（可能出浅灰/渐变底）——背景色以角点像素均值判定，不要信 GLM 描述
- **透明主体走纯色底（方案一，2026-08-04）**：白色要素多的主体禁用白底（抠不净需人工介入）；
  生成加 `--transparent`（AI 选底色 `tools/ai-gen/pick_bg_color.py` + 阈值抠图
  `tools/ai-gen/transparent_cutout.py` + GrabCut/BiRefNet 兜底；背景非均匀时自动切
  GrabCut 主导——SDXL 渐变底实测 BiRefNet 残留多、GrabCut 残留清零）
- **纯色小物件**（雪球等）：直接用运行时 createCanvas 径向渐变生成纹理，不要 AI 出图再抠（白边抠不净）
- **抠图去污染**：边缘 alpha 反推前景色（decontamination），半透明边缘"灰调残留比例"应 <5%
- **废案必清**：入库后删除迭代废案/未调用图片（2026-08-03 教训：blizzard-icons v1~v6、ice-icons-v1、
  snowball 变体共 79MB 全部删除），只保留最终被引用资产
- **GLM-4.6V 边界**：定性判断（主体/构图/风格）可靠；多图一起描述会串扰、背景色判断不可靠 → 单张+具体问题，交叉像素统计

#### 技能图标重出沉淀（2026-08-06：雷暴领域/贯穿雷枪 v2 定稿）

- **正式出图必须走 FLUX.2 Dev + 控制图，klein 4B 只做初筛/草图**：8 张 klein 12 步候选全被否
  （主题细节糊）；Dev 24 步 + 控制图可出高画质。工作流"入库=Dev、探索=klein"再次验证。
- **控制图首选"原图 alpha 剪影"（hf 深度模型被墙时的零依赖替代）**：定稿图标透明底 alpha>10
  填白 + 3px 高斯羽化 → `tools/ai-gen/_depth_templates/<名>_sil.png`，锁原图构图/主体占比/位置；
  实测无需 DepthAnything 权重（hf-mirror 404、hf.co 超时）。
- **提示词三段分离**：①背景风格块 `the hexagonal badge background is <切割宝石/冰晶/晶簇>`；
  ②原风格主体块（写实体积感雷云=深紫暗部+浅蓝亮部+亮白分支闪电；水晶棱面雷枪=浅蓝白渐变+
  电光蓝+能量环），明写"占比约 2/3"；③徽章模板块（六边形+金边）。
- **"草图感"根因 = 未归一化就交付**：原始出图是白底 1024² 未裁剪，直接给人看像草图；交付前
  必须走 `tools/ai-gen/normalize-skill-icon.py`（自带白底移除）归一到系列基准
  （~790×930 / 0.85 / fill70% / cy+28）再验收。
- **验收对照原图而非只看模板**：像素统计（bbox/aspect/fill/cy）+ GLM 单张，主体色调与占比逐项
  对照原图（雷云亮部浅蓝 vs 浅紫、占比 60~70% vs 80% 都是肉眼可辨的偏差）。
- **流程纪律**：被否后先诊断"模板没锁住 vs 风格没对上 vs 没归一化"，别盲目换 seed 重跑；
  本轮三轮（klein → dev 缺风格块 → dev+剪影+归一化）才收敛。
- **并行会话注意**：`models.json` 的 LoRA 版本（klein-skillicon-v3 / klein-equipment-v1）由并行
  会话更新，本地 klein 需同步拷 v3；5080 被并行任务占用时 dev 出图 5~15min/张，
  klein 可本机 18~30s/张。

#### 武器精通图标系列 v2（2026-08-07 定稿：蓝宝石切割徽章 + 原武器主体）

- **系列基线（精通系列与魔法系列不同，先量后定）**：六把精通图标（剑/机枪/步枪/手枪/散弹枪/弓）
  统一归一化到 **825×889 / aspect≈0.93 / fill 70% / cx=0 / cy=+28**（魔法技能系列是
  ~790×930 / 0.85——两个系列基线不同，不能混用；`normalize-skill-icon.py` 默认值即精通基线）。
  验收用 `tools/ai-gen/check-icon-sizes.py`，六张必须同框。
- **深度控制图锁"武器大形"是刚需，光靠提示词会飘**：机枪 v2d 只用徽章剪影当控制图，FLUX
  把"机枪"画成了 AK 突击步枪（弯弹匣）——深度图里没有武器形状，提示词再详细也拦不住
  FLUX 对常见枪型的先验。修复：把**游戏内已定稿武器素材的 alpha 剪影直接合成进徽章剪影**
  （徽章灰 130 + 武器白 255，黑底），PKM 一次收敛。同理其余五把也应有武器剪影模板
  （`_depth_templates/sword_sil.png` 等，与徽章模板同构）。
- **合成剪影的两个坑**：①System.Drawing 的 DrawImage 合成透明 PNG 会丢 alpha，改用 PIL
  按 alpha 逐像素合成；②整张 2048² 画布直接缩到 560 宽会把武器压成 ~90px 细条，必须先
  **裁剪武器实际 bbox 再缩放**（PKM 实占 1871×328，按 640 宽缩放后 ~112px 高才可辨）。
- **宝石背景质感 = 提示词显式描述，否则出"闷蓝"**：机枪首版宝石偏深偏闷、与其他五张
  （明亮宝蓝、切面丰富、通透带内部折射）差一档。补足提示词后收敛：`vivid luminous deep
  blue sapphire, multi-faceted crystalline cut, crisp facet planes, strong specular
  highlights, inner light refraction and translucency`——宝石效果靠显式视觉词驱动，
  同款控制图+同 seed 重跑不换描述不会改善。
- **多 seed 候选 + GLM 双维度验收再定稿**：武器形体（是否 PKM、侧视朝右、无变形）与
  背景宝石（饱和/切面/通透/高光）分开打分；GLM 单张评分稳定（9~10 分可收），多图并列
  对比会串扰/超时，改用单张同题逐个打分再横向比较。用户从候选里挑 v2f2，未挑更高
  seed——**验收时给候选让用户选，别自作主张**。
- **系列统一后入库**：旧 48px 占位（pistol/machine_gun）与旧 2048² 旧风格图全部备份到
  `Y:\工作\无尽轮回\scratch\backup\` 再替换；UI 是 `<img>` + CSS 48×48 object-fit:contain
  渲染，1024² 透明底直接可用，无需改代码。

#### 视频生成（MiniMax H3，远程 5080，2026-08-04 落地）
- 模型：`fl2va`（文生/图生视频）+ `ref2va`（参考生视频）；Qwen3-VL 32B 编码器；视频+音频双 VAE——
  **音画同一轮扩散生成**（原生立体声，非后期配音），MP4 直出
- 客户端：`tools/ai-gen/minimax-h3-gen.py`（--prompt / --duration / --size / --seed / --out）
  官方 T2V 管线：UNETLoader+CLIPLoader+双VAE → MiniMaxH3ImageToVideo →
  BasicGuider + RandomNoise + KSamplerSelect(res_multistep) + BasicScheduler(simple 20步) →
  SamplerCustomAdvanced → VAEDecode+VAEDecodeAudio → CreateVideo(24fps) → SaveVideo(mp4)
- 实测：1344×768、2s（56 帧）≈ 315s（5080 int8）；时长按 17k+5 网格（24fps），
  如 2s=56 帧、5s=124 帧；生成中机器休眠会断，需关休眠
- 用法两条路：
  - 视频资源：MP4 直入项目（Phaser video key 播放）
  - 精灵序列：PyAV 抽帧 → sprite sheet（动作动画截帧路线）
- R2V 参考模式：`MiniMaxH3ReferenceToVideo`，按接入顺序用 `<Picture 1>` / `<Video 1>` / `<Audio 1>`
  标签引用，可锁角色/风格/动作/声音；ref_image_size=match 快 / max 保真（更慢）
- 提示词规范：整场描述（场景 → 分镜 → 镜头运动 → 音效）写在一个块里；
  短边 768px、尺寸 32 的倍数（H3 原生画布）

#### 素材/模型/备份归置（NAS Y:\，2026-08-04）
- Y:\ = NAS 映射盘（\\192.168.3.2 共享，SMB），素材库双机共用；目录约定：
  - `Y:\素材库\`：原始素材/参考图
  - `Y:\工作\无尽轮回\scratch\`：AI 出图/视频中间产物与候选（生成脚本默认输出地，定稿才进仓库）
  - `Y:\模型库\ComfyUI\models\`：大模型归档（双机共用；冷模型可 junction：
    `mklink /J models Y:\模型库\ComfyUI\models`，热模型留本机保证加载速度）
- **版本控制走 GitHub**（origin `allang2208/wuxianlunhui`），`tools/ai-gen/backup-to-nas.ps1`
  保留为手动可选备份，不做定时
- 原则：仓库只保留被引用资产；候选/废案/大视频一律落 Y:，E: 只放源码+入库资产

#### 多视图/多件排列硬筛（2026-08-03 沉淀：SDXL 帽子/法袍顽固出多视图）
- SDXL 对 "wizard hat" / "robe" 极易画成**多视图设计稿**（5~10 个分离主体），GLM-4.6V 描述
  "五个视角"不可轻信；**连通域计数是唯一硬证据**：`tools/ai-gen/check-components.py` 对
  BiRefNet alpha>60 做 `ndimage.label`，**components == 1 才合格**。
- 兜底流程：批量生成 4 个候选（`gen-hat-candidates.py` / `gen-robe-candidates.py`，不同 seed）→
  逐张连通域筛选单主体 → GLM-4.6V 复核构图/装饰 → 选最优。
- **提示词权重语法**：`(exactly one hat:1.5), (one hat only:1.5), (single straight front
  view:1.4), (isolated single object:1.3)` + 负面 `multiple views, turnaround, design
  sheet, blueprint, multiple hats/robes, duplicate items, clothing rack, mannequin`。
- **简笔画陷阱**：为去中间徽章写 `plain hat body, completely blank surface` 会把帽子画成
  无纹理简笔画——去徽章应写 `no large emblem, no diamond, no triangle, no crest`，
  同时保留 `velvet fabric texture, folds, rich shading` 写实质感（2026-08-03 蚀月法帽两连坑）。

#### 落地范例
- 冰锥 4 张贴图：img2img 参考 Meshy 冰锥图 → 抠图 → 随机抽取入库
- 暴风雪图标：v1 白底贴纸（否）→ v6 冰墙参考 + 局部 inpaint 补底座（定稿）
- 雪球：运行时生成纯白圆（不占贴图资源）
- 陨星坠落（2026-08-04）：FLUX.2 文生图初稿（窄 750×951，观感偏小被否）→ 火球白底参考
  模板锁定 img2img 重抽 8 候选 → 自动抠底 + 内容框校验（793×945 达标）→ 定稿替换
- 陨星图标 FLUX.2 dev 重制（2026-08-04 五轮）：dev 恢复后用 `tools/gen-meteor-dev.py`
  （一次性脚本，已删除未入库，仅留此记录；火球模板 + SplitSigmasDenoise img2img）两轮 14 候选 → GLM-4.6V 验收「流星撞击地面」→
  定稿 d0.62_s04（794×941/0.84/71.3%）→ 替换 `assets/skills/陨星坠落.png`（旧图备份
  Y:\scratch\backup）
- MiniMax H3 视频（2026-08-04）：陨星 VFX 2s 文生视频（1344×768/56帧/原生音效）
  → `assets/videos/`（远程 5080 生成，约 5 分钟）

---

### 双机开源 AI 工具实机盘点（2026-08-13：TRELLIS 2 已就绪、Hunyuan 3D 未装）
> SSH 进 5080 实机核对磁盘后的权威清单（配合 `SETUP-OVERVIEW.md` 使用）；以后查"哪台机器有什么模型"
> 一律以此节为准，先 SSH/实盘再下结论。

**拓扑（与 SETUP-OVERVIEW.md 一致）**
- 5080 主力机：RTX 5080 16GB，`192.168.3.142`，SSH 别名 `r5080`（免密，hostname=小鼠），
  ComfyUI 0.30.0 @ `D:\开发文件\ComfyUI`，端口 8188（生产中，只认真正 LISTENING 的进程）。
- 本机：RTX 3080 Ti 12GB，`192.168.3.153`，Daedalus 7777 + 本地 ComfyUI 0.30.0 @
  `E:\无尽轮回\长期备份\2026-7-13-1\ComfyUI`。
- NAS 群晖：`192.168.3.2`（Y:）备份/中转——`Y:\开发\ComfyUI`（5080 备份）、`Y:\flux2_dev`
  （dev fp8 33GB + Turbo）、`Y:\工作\无尽轮回\scratch\klein-lora-*`。
- ⚠ 查 GPU 用 `nvidia-smi`，别信 `Win32_VideoController`（本机 CIM 误报 GTX 750 Ti，nvidia-smi 才是 3080 Ti）。

**5080 主力机（模型最全）**
- custom_nodes：ComfyUI-Trellis2、comfyui-mesh（Icarus）、comfyui-flux2fun-controlnet（打过补丁）、
  ComfyUI-BiRefNet-ZHO、ComfyUI-Image-Removal、ComfyUI-Manager。
- 3D：**微软 TRELLIS 2 全套已就绪**（TRELLIS.2-4B 九个 ckpt + TRELLIS-image-large + facebook/dinov3）——
  图生 3D 直接用 5080 的 ComfyUI-Trellis2 节点，无需再装；`tools/ai-gen/trellis-gen.py` 是 API 客户端备用。
- 视频：MiniMax H3 开源权重（`minimax_h3_fl2va/ref2va_pruned_int8_convrot` 各 19.5GB + qwen3vl-32b
  nvfp4 awq 14.6GB + 音视频 VAE）。
- 2D：FLUX.2 Klein 4B fp8（3.8GB，生产主力）+ FLUX.2 Dev fp8（33GB）+ FLUX.2-dev-Fun-Controlnet-Union
  （7.7GB）+ Mistral3 Small 文本编码器（11.4GB）+ Qwen3-4B（7.5GB）+ flux2-vae。
- LoRA：Flux2TurboComfyv2 + klein 六件套（epic/equipment/skillicon v1~v3/walltex）；SDXL 底模；BiRefNet。
- 训练环境 `D:\开发文件\lora-train`：AI-Toolkit + 6 套数据集 + Klein 4B Base 7.2GB + venv cu128。

**本机（3080 Ti）**
- ComfyUI 0.30.0 @ `E:\无尽轮回\长期备份\2026-7-13-1\ComfyUI`：Klein 4B fp8 + Qwen3-4B + flux2-vae +
  klein LoRAs（epic/skillicon v2~v3）+ SDXL + 抠图三件套（BEN2/BiRefNet×2/RMBG-2.0）；
  custom_nodes：ComfyUI-Manager、comfyui-mesh（Icarus）、ComfyUI-RMBG。
- comfyui-mesh Daedalus 后端 @ `comfyui-mesh\server`（dev fp8 33GB + Turbo，端口 7777，NVENC 跨机编码）。
- 训练环境 `D:\lora-train`：AI-Toolkit + diffusers + Klein 4B Base + Qwen3-4B + venv。

**选型结论（2026-08-13）**
- **Hunyuan 3D 两台机器均未安装**；评估：TRELLIS 2 对硬表面白模起步更强且已就绪，Hunyuan 2.1 的 PBR
  优势在"先白模后贴图"流程暂不需要，且 16GB 跑其纹理生成贴线（fp8/offload 才稳）→ 暂不装。
- 运维：5080 上曾出现多个 `main.py --port 8188` 进程并存，只有真正 LISTENING 8188 的生效；重启/清理
  按 PID 核对，别全杀。

---

### 场景要素训练结论 + 墙体材质 LoRA（2026-08-07）

#### 诚实评测结论（先结论后干活）
- **端到端"训练构建场景要素"（地板/墙壁/障碍物）无意义且有害**：几何/碰撞/拼接/视角是确定性
  数据层（Blender spec + face 线 + 30° 底边 + ISO_WALL_GEO + 镜像规则），AI 几何不可靠有大量实证
  （h/v 斜向不分、白底残留、沙袋位置错误、圆角/UV 只能 Blender 修）。训练它=把唯一确定性层换掉。
- **只训练"贴图"（材质风格 LoRA）有意义**，且是 BL+贴图管线唯一值得训的部分（痛点全在材质侧：
  E/C/B/A 多轮返工、提示词 roulette、变体靠微调提示词）。

#### klein-walltex-v1（已训已部署，2026-08-07）
- 数据集：30 张 Blender 面纹理（6 级 × 5 变体，1024×656，NAS `world122\raw\tex_<G>_v1..v5`），
  平光无阴影无透视；**不能拿烘焙透视的 cover 成品/直墙入训练集**。
- 6 族独立触发词：`pale brick / sandstone / red brick / concrete steel / riveted steel / rune brick
  wall texture`；统一尾块 = TAIL（flat frontal view / regular square brick grid / no shadows）。
- 训练：klein 4B base、dim 48/alpha 24、1200 步、lr 1e-4、**resolution [1024,656]**（非方形，
  不能默认 center-crop）；实测 ~28 分钟。
- 部署：5080 `ComfyUI\models\loras\` + NAS `klein-lora-walltex-v1\` + models.json
  `flux2-klein-4b-walltex`（size 1024x656）；训练文件版本化在 `tools/ai-gen/lora-train/`。
- 验收：6 族材质 GLM 识别 + 砖格 FFT 峰 0.98~3.80（对照 dev 0.64~5.08）+ white%=0 + 变体平光；
  完整管线（生成 → 平场 → Blender 渲染 → 实机 CDP 并排对比）已验证，质感 ≥ dev 现有纹理。
- **已知坑**：klein 金属/符文自带方向光照（B 族左右亮度斜坡 ~25 点，dev 仅 ~10）→ 出图后统一
  平场校正（除以大核高斯模糊，实测压到 ~12 点）；C 族（混凝土+钢板复合）识别偏弱，补数据或单独训。
- **触发词注入机制**：AI-Toolkit 的 `trigger_word` 只注入 sample prompts
  （`inject_trigger_into_prompt(..., add_if_not_present=False)`），训练标注直接用 txt 原文 → 多触发词
  数据集的正确做法=每条标注自带触发词，yaml 的 trigger_word 只写兜底。

#### NAS-first 约定（2026-08-07 起）
- 新增输出（候选/训练产物/报告/临时文件）一律落 `Y:\工作\无尽轮回\scratch\` 对应模块目录，
  本地 scratch_tmp 只做中转不长期留存；大模型/素材库按既有 `Y:\模型库` / `Y:\素材库` 约定。

#### 白色主体的生图/抠图铁律（2026-08-07，神域返工教训）
- **白金/白底为主的装备主体（白金色金属、圣光白亮件）禁止在白底上生成**：阈值抠图会把主体亮部
  当背景啃掉，留下白边残留/亮部缺失。必须走 `comfyui-gen.py --transparent`（AI 自动选主体完全没有的
  背景色，实测选纯蓝 #0000FF），出图后按真实底色阈值抠图，再归一化。
- 同稀有度套装 = **轻甲/法袍/重甲三系**（对照 epic：星穹轻甲/苍月法袍/天罡重甲）。神话三系**三命名**：
  神域（重甲：战盔/战甲/战靴 + 首饰 6 件）+ 圣辉（轻甲：轻盔/轻甲/轻靴 3 件）+ 神谕（法袍：
  法帽/法袍/长靴 3 件）。生成时三系分别出图，不要只出一套、也不要三系共用同一前缀名。
- **JSON 中文被 GBK 管道吃成 "????"（2026-08-07 神域返工教训）**：PowerShell 管道 heredoc 喂 Python
  时 stdin 是 GBK，脚本里的中文字符串会变 "????"（本次把装备 name/iconImage 全改坏、商店显示 ???）。
  凡脚本要写中文 → 用 apply_patch 写 UTF-8 文件再跑，或全用 unicode 转义；改完必须抽查 JSON 实际
  codepoints（如 `"?" in name` 检查）。

#### CDP 残留教训（2026-08-07，C 盘爆满根因）
- headless Edge CDP 每次运行在 `%TEMP%` 建 `edge-cdp-*` profile（一个 ~600MB）；多次运行累积
  实测 111 个 47.7GB → C 盘 0GB 满。**用完即删或定期清 `%TEMP%\edge-*`**。
- **治本（2026-08-08，C 盘再次爆满后落地）**：所有 `tools/cdp-*.mjs`（30 个）在
  `fs.mkdtempSync` 后统一注册退出自动清理
  `process.on('exit', () => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} })`——
  新建 CDP 工具必须带这行；另建每日计划任务 `CleanEdgeCDP`（06:30）跑
  `tools/clean-edge-temp.ps1` 兜底（异常退出/SIGKILL/断电残留次日必清），手动清：
  `powershell -File tools/clean-edge-temp.ps1`。
- 删除 `%TEMP%\edge-*`：命令行内联 `Remove-Item -Recurse` 会被安全策略拦（blocked by policy），
  实测把删除逻辑写进 .ps1 脚本文件后 `powershell -File` 执行可正常删除；也可用
  `.NET Directory.Delete(path, true)`。正在被 Edge 占用的 profile 删不掉会自动跳过。

---

### 视频→精灵图→游戏落地全管线（2026-08-05 工头 walk 实战沉淀，100% 达标）

#### 1. 视频模型选择：H3 首帧模式（不是 ref2va）
- H3 的 `MiniMaxH3ImageToVideo` 节点（`comfy_extras.nodes_minimax_h3`）自带 `first_frame` / `last_frame`
  输入：首帧=参考图 → **像素级锁定角色**，这才是"图生视频"的正确姿势。
- **ref2va（`MiniMaxH3ReferenceToVideo`）是参考注入不是首帧**：特征能锁、画风锁不住，
  角色会"从头到尾不是原贴图那个角色"（实测踩坑，曾误判为模型缺陷）。
- 客户端：`tools/ai-gen/minimax-h3-gen.py --first-frame x.png [--last-frame x.png] --duration 5.17 ...`
  （脚本已支持；ref2va 用 `--ref-image`，首帧模式用 `--first-frame`，二者互斥）。
- 时长网格 17k+5 @24fps：2s=56 帧、5.17s=124 帧；**H3 训练区间 124~362 帧（5~15s），
  2s 在训练分布外**，循环/图生视频至少取 124 帧。
- 实测耗时（5080 int8，1344×768，20 步）：56 帧≈6min、124 帧≈17min；机器休眠会断服务。

#### 2. 视频背景色选择（关键，直接决定抠图成败）
- **背景色必须与主体色系距离最大**；选色前先对参考图做像素统计确认主体调色板
  （不要信 GLM 描述，GLM 背景色判断不可靠）。
- 工头案例：品红底失败——主体含红血污/红眼/头灯暖光/粉色过渡，品红抠图容差一松就吃掉
  同色系区域（用户反馈"部分缺失"）；**换纯白底成功**——主体是深色系（深棕/灰/黑），
  与白色色距极远。
- 规则：① 扫主体调色板，选统计上完全缺席的颜色；② 主体含大量白色的禁止白底（如雪球）；
  ③ 生成后做**孤立背景色斑检测**（连通域：不贴画布边框的孤立背景色块=角色内部真实孔洞），
  用形态学闭运算填孔（工头唯一近白点=头灯高光，约 20px，闭运算 3×3 即填掉）。
- 白底视频提示词：`flat solid pure white background identical to the first frame,
  completely uniform white, no ground, no shadow, no reflection`。

#### 3. 镜头/构图（防"超出显示区域"）
- **首帧角色高度占画布 70~75%、四周留 ≥10% 安全边距**；顶天立地（100%）时实测
  56 帧里 45 帧贴边、头脚被裁。
- 提示词：`static camera locked in place, no camera movement, no pan, no zoom,
  no push-in, no pull-out, no tilt, no rotation, the body stays perfectly centered
  in the frame and never drifts left or right, only the arms and legs move,
  the entire character with hat and bare feet always fully visible inside the frame
  with generous empty margin on all sides, nothing is cropped or touches the frame edges`。
- 验收量化：逐帧主体 bbox 贴边帧数必须 = 0；水平中心漂移初始 206px → 缩 75% + 强化
  静态镜头后 35px（可接受，拼图时逐帧居中可消）。

#### 4. 无缝循环生成（首帧=尾帧）
- `--first-frame` 与 `--last-frame` 传**同一张图**：结尾姿势/位置强制回到首帧
  （实测中心差 (0,0)px、轮廓重合 IoU 0.99、结尾 5 帧速度无突变=无橡皮筋回弹）。
- 提示词加：`at the end of the video the character naturally returns to the exact
  same pose and the exact same position as the first frame, seamless loop,
  no freeze and no slow down at the end`。
- 已知现象：模型仍会在片头/片尾各留 ~8 帧缓动（"慢起→匀速→缓回"），这是正常现象，
  靠截取算法规避（见 §5），不要因此误判视频失败。

#### 5. 循环截取算法（h3-loop-spritesheet.py，本次核心沉淀）
- **全身平均像素差 / 全身 IoU ≠ 步态相似度**：躯干占比大，这些指标到处 0.9+，
  找不到周期（实测误判过 T=113、T=112 都是错的）；**必须用腿部区域
  （身体 bbox 下 35%）IoU** 判"同相位"。
- 流程：
  1. 抠底：背景阈值 235 → 3×3 闭运算填孔 → alpha 高斯羽化（3×3, σ0.8）软边；
  2. 在匀速中段（如 steady=12,105）扫 `leg_iou(s, s+P)`，P∈[70,120]，
     取 IoU>0.80 的最强配对（工头：s=24, e=104, P=80, leg-IoU=0.952）；
  3. **循环 = [s, e-step]，必须去掉重复端点 e**：pose(e)≈pose(s)（同相位），
     留着会让接缝变成"定格"；去掉后接缝 = 一次正常步幅；
  4. 验证：接缝步幅必须落在正常步幅区间内（工头：正常 27.4~61.0，接缝 31.2）。
- 判定铁律：**接缝步幅 ≈ 正常步幅 ±50% 才合格**；偏小=接缝定格、偏大=接缝跳变，
  两者用户都能一眼看出"一段播完突兀开新段"。

#### 6. 精灵图抠图/对齐（防"扯回"）
- 抠图：白底阈值 235 → 形态学闭运算（3×3，填头灯高光等小孔）→ alpha 高斯羽化软边。
- **对齐三铁律（逐帧量化，必须零偏差）**：
  - 角色高度固定（先实测旧图标定，工头=262px）；
  - 脚底基线固定（工头 y=410，防上下跳）；
  - 水平中心固定（工头 x=256，防左右扯/滑步）。
- 尺寸/脚底/中心与旧图一致 ⇒ 碰撞体积配置（collisionWidth/Height、footOffsetY）不用动。
- 进游戏前**先扫空白帧**（格内 alpha>10 像素数 <50 视为空），禁止把空格注册进动画
  （否则周期闪没，毒液僵尸 idle 24 格仅带 0 有内容的旧教训）。

#### 7. 游戏集成（Phaser 512 切帧惯例）
- 一律 512×512 格子；工头 walk 旧规格：15 帧 8×4 网格 → 新版 20 帧 5×4 网格。
- BootScene：`load.spritesheet` 的 `endFrame = 帧数-1`；`anims.create` frames 0..N-1、
  walk 用 `repeat:-1`；frameRate 按观感调（工头 20 帧 8fps=2.5s/圈，10fps 偏快）。
- `_getTextureKey()` 必须与动画源 spritesheet 一致；换素材前先备份旧图到
  `Y:\工作\无尽轮回\scratch\backup\`（git 里也有历史版本，可放心清）。

#### 8. 验证清单（像素统计优先，GLM 辅助）
- **像素统计优先级 > GLM 描述**：GLM 会跑偏（曾说视频衣服是绿色、背景判断不可靠、
  还会输出模板化"assuming…"套话）。量化证据：直方图相关度、步幅差值、贴边帧数、
  中心漂移、对齐三铁律。
- 循环验证：首尾中心差、(腿部)同相 IoU、接缝步幅 vs 正常步幅、结尾 5 帧速度无突变。
- 抠图验证：每帧背景占比稳定、角色内部孤立背景斑（连通域）、无空格帧。
- 集成验证：`npx vite build` + `npx eslint` + 无空格帧 + GLM **单张**抽查
  （多图并排 GLM 会串扰，联系图只用于定性）。

#### 9. 本次产物与可复用命令
- 循环视频：75% 白底首帧，`--first-frame` = `--last-frame`，5.17s/124 帧，
  seed 2026080504 → `foreman_walk_loop_5s_h3_white.mp4`。
- 精灵图：`h3-loop-spritesheet.py --video <loop.mp4> --out walking.png --cols 5`
  （自动出 20 帧 5×4、2560×2048，附 GIF 预览）。
- 入库：`assets/enemies/foreman_zombie/walking.png` + BootScene endFrame 19 /
  anim 0..19 / frameRate 8；中文路径写入 Python 必须先 Copy-Item 到 `%TEMP%`。

---

### 主角一段攻击（attack_sword）关键帧→H3 两段式挥砍重生（2026-08-15 试作，已被下方 v4 取代）

手绘关键帧 A起手/B命中/C收势 → H3 首尾帧插值 AB、BC 两段视频 → 拼 12 帧 sheet。
针对旧 v2 三连反馈（双手→单手、僵硬、要前移）：新动作=上步单手反手挥砍+弓步前倾。

- **四步管线**（全部 ComfyUI venv python，产物落 `Y:\工作\无尽轮回\scratch\player_attack_sword\`）：
  1. `prep-player-attack-keyframes.py`：原图 BiRefNet 抠图→alpha 去污染→对齐→纯色底
     1024×576 关键帧（**H3 I2V 的 first/last frame 只读 RGB 不读 alpha，必须先抠再合成纯色底**；
     底色写 `keyframes/bg.txt`，本次=纯黄 #FFFF00，主体骨白/黑描边与黄色距极远）；
  2. `run-player-attack-sword.py --seeds 1,2,3,4`：AB/BC 两段 × 4 种子（每段 5.17s/124 帧 ≈7min）；
  3. `analyze-player-attack-sword.py`：PyAV 定量（漂移/贴边/背景残差/左右运动密度）+ contact sheet；
     **肉眼复看用逐帧 montage 裁主体放大**（contact 256px 格太小看不清手臂弧线）；
  4. `build-player-attack-sheet.py --ab-end 44 --bc-end 50`：抠黄（max 通道距>45 + 闭运算 + 羽化）
     → **去黄溢色**（alpha>0 且 min(R,G)-B>24 → 亮度均值，骨白 R-B≈+6~10 不误伤）
     → 视觉均匀重采样（挥砍段自动加密）→ 对齐入库规格。
- **选 seed 结论**：AB=s01、BC=s01（center_x_std 4.9/3.7、零贴边、弧线连贯；s02 腿部几乎不动、
  s04 中心漂移 21px 淘汰）。
- **活动窗口别信单一阈值**：AB 收尾静止早（窗口 [0,44] 即可，末帧必须已是 B 姿势才能接 BC），
  BC 挥砍到 ~50 后长尾静止（[0,50] 切尾防静止帧稀释采样）；用 `--ab-end/--bc-end` 手动指定，
  末帧=完全伸展 → 定格帧=攻击满弓姿势，正好做连段窗口定格。
- **对齐规格（现网 attack_sword 实测标定）**：格 512×512、4×3、12 帧；站立身高 432、
  脚底基线 y=492、帧0 格内 cx=209.5；固定缩放（AB 帧0 身高→432 全帧同比例）+ keep-dx
  保留格内前移（dx 实测 +23→-4 弧内变化）；config `frameDurations 50×12` 不动，
  **最大伸展落在 f10~f11，与 hitCheck f9 基本对齐**。
- **入库**：旧图留档 `backup/2026-08-15-player-attack-h3/`；新 sheet 直接覆盖
  `assets/player/attack_sword.png`（帧数/格规格不变，player-anim-config.json 零改动）；
  **武器轨迹 `sword.attack` 12 点按旧身体调的，需 DevTool 逐帧重对**（同 v2 换入时的遗留动作）。
- **坑**：cv2.imwrite 写中文路径静默失败（返回 False 不报错）→ `cv2.imencode` +
  `Path.write_bytes` 或 PIL 保存；analyze 脚本 `np.max(axis=2)` 对 (N,3) 边界样本炸
  AxisError → 用 `axis=-1` 兼容。

#### v4 绿幕单段直剪定稿（2026-08-16 入库，用户评审淘汰两段式后重做）

两段式失败原因：124 帧慢速源把 0.6s 攻击拉成慢动作、A 帧正面站立白烧 3 帧转身、
反手挥砍幅度小——"还不如三段突刺"。v4 回到三段同管线（绿幕 H3 单段 56 帧快节奏），
**关键教训：短平快攻击用 56 帧单段直出，不要首尾帧两段插值**。

- **首帧复用** `scratch/player_melee3/firstframe_onehand.png`（1344×768 绿幕侧视备战，
  右手胯部握姿）；提示词 `prompts/player-attack-slash-h3.txt`。
- **剑影轮盘**：挥砍提示词极易诱模型画剑——v3 实体剑+扇形残迹、s03 大斧头、s04 扇形
  拖尾、s05 大镰刀、s06 橙色弧；**s02 全程干净**、s01 仅 2 帧细残迹。对策=强化"EMPTY
  fist / no stick / nothing in or near hands" + **6 seed 轮盘挑干净的** + 细残迹可用
  `--erase 帧:x0:y0:x1:y1`（绿底矩形抹除，builder 已内置）。
- **逐帧色偏**：v4 挥砍帧骨骼泛品红（视频 VAE 色偏，montage 小图看不出，必须抽帧原图查）
  → builder 对全部不透明像素**强制亮度化**（主体纯灰度，色度即伪影；比 prep-melee3
  中性化更彻底，绿/品红边一并消）。
- **剪片**：`build-player-attack-sheet.py --video slash1_v4_s02.mp4 --bg-hex 00FF00
  --n 12 --end 24`（builder 已支持单段+绿幕模式）；窗口终点停在**顺势低位**（v24），
  不要收进恢复段——连段定格=满弓后低位，接续二段更顺。命中帧（最大伸展）落 f9 与
  hitCheck 精确对齐；前移 dx 峰值 +88（v2 才 +25）。
- **武器轨迹重对 v1（中心 origin，已被下方 v2 剑柄锚手取代）**：网格标定每帧拳头 cell 像素 +
  前臂延长线定刃向 → `offsetX/Y = 拳 + R(rot)·(0,-gripOffset40)`（同 prep-sword-attack-hand
  公式）；**display px 换算必须含 displayScale**：`(px-256)×(144×displayScale)/512`
  （attack_sword displayScale=1.0956，漏乘全弧 magnitude 小 8.7%）；**rotation 相邻帧
  差值必须 ≤180°**——`_getPerFramePrecomputed` 对原值再做最短程解卷绕（delta>π 会
  被拉回反向绕远，首发版 f0=135→f1=317 差 182° 被改走 -178°，起手 100ms 剑甩穿躯干
  =用户目击"脱手"根因；把 f0 改 140 让设计路径=最短程路径即可）；**标定验收用
  alpha 掩码逐帧贴附率**（拳头显示坐标 7×7 邻域 alpha>100 占比 >20% 判贴手，小拳头
  ±5px 目读误差即浮空——f2/f3/f11 首发全错：f2 把肘当拳、f3 点在空气、f11 拳在 (312,295)
  不在 (255,292)）；离线合成预览 = `getWeaponSize`（sword=78.75×0.63×s × 78.75×s
  display px）×(512/144) 贴 cell 验证后再写 `public/data/weapon-anim-config.json`
  （只此一份，无镜像）。
- **武器轨迹重对 v2 = 剑柄锚手定稿（anchor='grip'，dashHand 同款移植，2026-08-16）**：
  v1 数据全部验证通过用户仍报"后几帧剑柄不在手腕"——**中心 origin 是结构性缺陷**：
  旋转大步长的帧间中点握把甩离手 ~20~40 display px，改数据无解，必须换锚定模型。
  - 配置：`sword.attack.anchor = "grip"`，frames 的 `offsetX/offsetY` 直接写**拳头本地
    偏移**（`(px-256)×(144×displayScale)/512`），rotation=刃向连续链（相邻差 ≤180°，
    `_getPerFramePrecomputed` 对原值再做最短程解卷绕，delta>π 会被拉回反向绕远）；
    attack2/attack3 无 anchor 字段保持中心 origin 不动。
  - 运行时两处新代码：`WeaponTransform.getInterpolatedGripPerFramePosition`（位置同口径
    插值 + 追加 `gripX=0.5 / gripY=0.5+gripOffset/显示高`）与 `getAttackRecoverStartPosition`
    （收势起点=末帧握把+R(rot)·(0,-grip) 反推中心，同 getDashRecoverStartPosition 公式）；
    GameScene 攻击 perFrame 分支 `anchor==='grip'` 时 `setOrigin(0.5或镜像, gripY)`——
    **origin 复位链现成**：syncWeapon 普通路径每帧开头已 reset origin(0.5,0.5)，无泄漏。
  - **连段闭环测试跨锚点**：attack3 末帧（中心 origin）= attack 首帧握把反推中心；
    `scripts/test-melee-sync.mjs` 已改锚点感知比较（位置按公式换算、角度取最短弧差）。
  - **拳头标定法升级**：质心/掩码粗定 → **细网格 4× 放大逐帧目视复核**（质心在拳头与
    骨盆/腿粘连时被连通域合并拖走：f0/f11 被骨盆拖偏、f10 曾误标到大腿骨——"末端过滤"
    判据识别不了合并）；**验收 = alpha 掩码贴附率 12/12 >20%**（拳头显示坐标 7×7 邻域，
    BILINEAR 缩放到显示尺寸）。
  - DevTool 语义提示：attack 块 offset 现在是**握把点**（拳头），不再是贴图中心。
  - **刃向是「看起来脱手」的常见真凶**：一段末帧定格时剑 209° 向后下穿过腿（前臂方向推的刃向）
    被用户读成「武器没绑在手上」——垂持姿势刃向要前下 ~150°（手在髋前、剑尖朝前下方）。
    突刺伸展帧用户要「绝对水平」：attack3 f8~f11 刃向精确 90°（链差 0，无角度偏移）。
  - **实机定格复核管线（12/16 帧适配版）**：`tools/cdp-sword-hold-v4.mjs`（旧
    cdp-sword-hold-frames.mjs 的帧映射是 8 帧时代硬编码，勿直接用）——**probe 里必须走
    `setPlayerAnimation(animKey, 40000)` 再 timeScale=0 冻结**（直接 setTexture+play 会跳过
    displayScale，人物框 142.9≠真实 156.5，截图口径全错）；环境：`start-vite-dev.ps1`(5173)
    + 无头 Edge(9224) + `cdp-run.ps1` 安全入口；meta JSON 直接采样武器世界坐标/旋转/origin
    逐帧核对（握把 = player + 配置偏移 − footOffset，实测逐位一致）。
  - **尺寸口径勘误**：武器屏显高 = WEAPON_ANIM.size 126 × MELEE_SCALE **0.75** × scale
    =141.75（旧注释里的 78.75 是 0.625 时代残留）；剑柄 originY = 0.5+40/141.75 = 0.782。
  - **「帧末武器脱手」的根因 = 进度映射错配（2026-08-16 实机定位）**：旧平滑 lerp 把
    progress×(n-1) 映射到轨迹点，而精灵帧 k 覆盖 [k/n,(k+1)/n)——武器在帧窗中段就跑向
    下一点、帧窗末尾已偏 92%，攻击一段 f0 窗末实测旋转 140°→302°（身体还在备战、剑已甩
    头后）。修法=**阶梯映射**（anchor='grip' 块专属）：位置钉当前帧锚点整帧不动，旋转在
    帧窗内向下一帧 lerp（绕钉住的剑柄扫刃）——`getInterpolatedPerFramePosition` 内
    `block.anchor==='grip'` 分支；dash/旧中心块口径不动。这正是 2026-08-03「手部只有离散
    帧时武器必须阶梯映射」教训的运行时落地（当年只在生成脚本侧做）。
  - 实机验证复用 `tools/cdp-sword-hold-v4.mjs`（每帧 meta 采样武器世界坐标/旋转/origin +
    截图）；帧末时刻要单独采（探针 progress 时钟推进约 +0.004/150ms 采样延迟）。
  - **落脚点对齐重建后，握点必须按新 sheet 重新实标，禁止 bbox 原点差平移补偿**——
    2026-08-16 踩坑：bbox 原点差法在 bbox 边沿换身体部位时失真（一段 f11 差 (+18,−8)、
    用户实机目击「剑没贴在手上」）；正确做法 = 当前 sheet 上细网格重读 + 质心精修 +
    十字校验网格逐帧目视 + 贴附率复验（三段 12/12/16 全过）+ 实机探针截图抽查关键帧
    （`cdp-fist-fit-probe.mjs` 定格+带/不带武器双程截图 + 屏幕坐标换算核对）。
    另：用户客户端吃不到改动时先查 5173 在线内容（curl /data/...），确认后硬性刷新。
  - **刃向错误也会被读成「脱手」**（2026-08-17 三段案例）：握点全部贴附率过关、实机坐标
    逐位一致，用户仍报「不跟手」——实机逐帧截图才看出蓄势帧剑浮在头上方：位置对、
    **刃向没跟前臂走**（拳头回收刃向就得后指，顶点突刺刃向精确 90°）。点位重标定时
    rotation 必须按当前 sheet 的前臂方向一并重推，不能只搬位置；验证要看全部中间帧
    截图，不是只看顶点帧。
  - 探针验证的缓存坑：无头 Edge 里的游戏配置是**启动时** fetch 的，改配置后必须重启
    探针页面再采样，否则对着旧配置误判「改了没生效」（同人端刷新一个道理）。
  - **探针会假朝左**：无头 Edge 无鼠标事件，指针默认 (0,0) → 玩家朝左、武器走镜像分支，
    采样值全部带 180° 镜像（曾误判为旋转 bug 追了一小时）。探针里要么钉指针到玩家右侧，
    要么 `s._getVisualFacingRight = () => true` 临时改写（liver 系列探针已带）。
  - **细线化 T 值实测定稿 2.0**（T=1.2 用户仍嫌粗）：`thin-strokes.py` 默认已改 2.0，
    从加粗源（scratch 的 *_aligned.png）重出 attack2/attack3/recover 三张后入库。

#### 跟手失败多次复盘（2026-08-16，对照 2026-08-03 老方法找差距）

老沉淀（掩码贴附率 + GLM 只判 ON/OFF + 阶梯映射 + 实机冻结）本身没错，但它是**中心
origin + 30 点轨迹 + 8 帧动画**时代的经验；换到 12/16 点 1:1 帧图 + H3 新素材时代，
反复失败的真正原因按次序：
1. **origin 模型是结构性误差源**：中心 origin + 旋转 lerp 在旋转大步长帧间把剑柄甩离手
   20~40px——老方法默认这个模型没质疑过它；dashHand 剑柄锚手（origin=剑柄）才是结构解，
   应第一时间移植而不是先在旧模型里调数据。
2. **1:1 点帧时 progress 映射必须阶梯**：progress×(n-1) 与帧窗 [k/n,(k+1)/n) 错半帧相位，
   帧末武器已偏 92%——老阶梯教训只在生成脚本侧（30 点手写映射），运行时 lerp 的错配
   当时没暴露。**经验迁移要查公式前提，不是只看条目在不在。**
3. **对齐/重建后禁止用几何推算握点**（bbox 原点差平移在 bbox 换边沿部位时失真，实测
   差 18px）——必须在新 sheet 上重新实标。这是「用推算代替实测」的偷懒，直接违反老
   沉淀的贴图真值原则。
4. **掩码贴附率 20% 阈值只是底线不是合格线**：质心在拳头与骨盆/腿粘连时被连通域拖走
  （f0/f11/f13 各踩一次）、把肘当拳、把腿当拳、视频缩放系数算错——每个都要**细网格
   4× 放大逐帧目视复核**兜底，批量方法只配当粗筛。
5. **离线合成预览 ≠ 实机**：displayScale/footOffset/运行时二次解卷绕这些口径问题只有
   实机定格探针（cdp-sword-hold-v4 / cdp-fist-fit-probe）能抓到；交付前必须跑。
6. **「改了没生效」沟通通道**：改 JSON/贴图只在页面加载时生效——交付时主动给用户
   可验证手段（curl 线上 /data/ 配置逐字节核对 + 一个手感上不可能错过的行为标记，
   如「三段终结技无定格」），别让用户对着旧缓存验收。

#### 二段攻击（attack_sword_2）v4 上撩回斩（2026-08-16 入库，连段连贯首帧方案）

- **连段连贯 = 首帧用前段视频的末帧原生抽帧**：attack2 的 H3 首帧 = slash1_v4_s02.mp4
  第 24 帧（=一段 sheet f11 的源帧，同相机/同底色/同体格），不是重画/重合成——
  `extract f24 → firstframe_slash2_v4.png`，一段收势姿势像素级流入二段起手。
- **提示词教训（两条方向性）**：水平横挥/反手横扫在严格侧视下系统性翻车——躯干必然
  转向正面成 T-pose、且不收势（s11~s13 三连全废）；**上撩回斩（低→高对角线）天然侧视
  兼容**，s22/s24/s26 三个干净（选定 s24：顶点 50°、底盘稳、无剑影）。提示词模板
  `prompts/player-attack-slash2-h3.txt`（保留 EMPTY fist/no stick 全套防剑影条款）。
- **剪片连段口径**：`build-player-attack-sheet.py --video slash2_v4_s24.mp4 --bg-hex 00FF00
  --n 12 --end 20 --anchor-cx 276 --scale 0.7742`——`--anchor-cx` = 一段末帧格内 cx（276，
  消 1→2 接缝跳变）、`--scale` 复用一段的 0.7742（参考帧是蹲姿收势不是站姿，不能反推）；
  窗口终点停在顶点伸展后（v20），最大伸展落 sheet f10 → `attack2.hitCheck.frame=10`。
- **attack2 同切 anchor='grip'**：拳头标定注意 f6 类薄拳（点指时拳心偏下，掩码贴附率
  6% 报警→细网格复读修正 (497,150)）；刃向链 222→216→96→88→83→57→51→37→31 相邻差
  全 ≤180°。一段末帧（grip 16.9,11.4/rot 572≡212）与二段首帧（grip 25.9,8.3/rot 222）
  姿态同族，接缝自然。
- 入库：`assets/player/attack_sword_2.png` 覆盖，旧 v2 留档 `backup/2026-08-16-player-attack2-h3/`。

#### 二段 v5 沉身下劈定稿（2026-08-16；v4 上撩回斩被用户否掉）

v4 上撩回斩被否原因：向上挥向空气无目标承接、缺冲击力、动作软。v5 改**正手快劈**：
短促抬拳→爆发下劈穿躯干目标区→整个身体重量砸进（屈膝沉身），收在低位前伸全力姿势。
- **"violent/slam"措辞几乎必出月牙伪影**：s31~s36 全系列在砸下瞬间带白色月牙大剑影
  （小尺寸 montage 看不出来，必须抽原始帧放大查挥砍瞬间）。对策=**战略性跳帧**：
  `--picks` 手动取帧直接不取月牙帧（v5 s31 用 `0,4,8,11,14,15,16,17,21,22,23,24`）——
  蓄势末帧（臂高举）→ 闪切到命中帧（沉身臂前伸），**动画中割抽掉反而更有冲击**
  （日式闪帧手法）；新增 `--picks` 参数即为此；builder 撞帧掉数已修（最大空档补中，
  禁止空帧注册进动画）。
- hitCheck 跟着闪切帧走：命中帧=sheet f8（(frame-1)/(n-1) 阈值 0.727 落在 f8 显示窗），
  `attack2.hitCheck.frame=9`；blur 峰值 f8=10/6 贴闪切瞬间。
- 轨迹同 anchor='grip'；薄拳帧（点指）掩码报警后必须 8px 细网格 4× 复读（f6/f7 拳头
  真值 (195,82)/(213,80)，粗读全偏）。
- 入库：v5 sheet 覆盖 `attack_sword_2.png`；v4 上撩版留档 `backup/2026-08-16-player-attack2-h3/
  attack_sword_2_v4riser.png`（同目录还有 v2 旧版）。

#### 三段突刺（attack_sword_3）v4 后退-突刺重做（2026-08-16 入库，三段连段全切新管线）

- 首帧 = 二段视频 slash2_v5_s31 第 24 帧原生抽帧（二段 sheet f11 源帧），2→3 无缝；
  提示词 `prompts/player-attack-thrust-h3.txt`：Phase1 收拳退步 → Phase2 蹬腿爆发突刺
  → Phase3 收回直立备战（**Phase3 是为了 3→1 回一段的身体衔接**）。六连发 s41/s42/s44
  干净（s43 细线尾迹、s45 突刺帧歪头、s46 尾迹淘汰），选 **s44**（收回备战最完整）。
- 剪片：`--n 16 --end 52 --anchor-cx 318.5 --scale 0.7742`（anchor-cx=二段末帧 cx 318.5，
  沿用 4×4 16 帧规格，frameDurations/combo 配置零改动）；突刺顶点=sheet f9（v27，
  dx+104），hitCheck.frame=10 原值不动（阈值 0.6 落在 f9 显示窗 450~500ms 内）。
- attack3 同切 anchor='grip'，16 点标定；收势段拳头粘连骨盆照常细网格复读
  （f13 拳头真值 (372,260)，粗读曾幻想在 (440,258)=空白区）。
- **闭环测试改容差版**：两段均 grip 锚点后直比握把点，但三段末帧收势体格锚
  （cx≈293）与一段首帧（cx≈209）不同，连段换贴图身体本身有 26px 位移——
  `test-melee-sync.mjs` 闭环断言改 45px/35° 容差并打印实测（当前 Δpos=42.6px Δrot=13°）。
- 入库：`attack_sword_3.png` 覆盖，旧 v2 留档 `backup/2026-08-16-player-attack3-h3/`。

**三段连段 v4/v5 总览（2026-08-16 全切）**：一段斜劈（v4 s02）→ 二段沉身快劈闪切
（v5 s31）→ 三段后退爆发突刺（v4 s44）；三段的 H3 首帧链路 = 前段视频末帧原生抽帧，
轨迹全部 anchor='grip' 剑柄锚手，hitCheck 帧 9/9/10，blur 峰值贴各自挥砍瞬间。

#### 收势动画（recover）v4 重做（2026-08-16 入库，首尾帧双锁）

- **首帧 = 三段视频 thrust_v4_s44 第 52 帧**（三段 sheet f15 源帧），**尾帧 = idle.png
  绿幕合成**（内容高按视频角色 556px 缩放 ×1.166、脚底/中心对齐三段末帧）——H3 首尾帧
  双锁，收势=战备姿势松回 idle 姿势，两端分别与三段末帧/idle 无缝。提示词
  `prompts/player-recover-h3.txt`（平缓、无武器、无特效）；4 连发低伪影风险，s51 干净平顺。
- 剪片：`--n 13 --cols 5 --anchor-cx 293.5 --scale 0.7742`（anchor-cx=三段末帧 cx）；
  视觉均匀采样在动作完成后会取"动作完成点"而非视频末帧（cum 平台期 searchsorted 取首个），
  收势类动作这正好合适。
- **体格口径统一**：recover 改 512×512 格并加 `displayScale 1.0956`（与三段攻击同屏显身高，
  三段→收势无大小跳变）；旧手绘 512×516 退役。`test-melee-sync.mjs` 的"recover 无
  displayScale"守卫已按素材变迁更新（walk 仍保持无缩放）；recover 时长 13×25.4ms≈330ms
  不动，各段收势时长仍由 `meleeCombo.stageNRecoverMs` 驱动。
- 入库：`recover_sheet.png` 覆盖，旧手绘版留档 `backup/2026-08-16-player-recover-h3/`。

#### 线宽代际漂移与细线化（2026-08-16 用户反馈「线条加粗」实测定稿）

- **H3 每代际系统性加粗描边**：首帧链路（前段视频末帧→下段首帧）每过一代线宽
  +0.4px——实测躯干笔画宽 idle 2.7px / 一段 3.2px / 二段 4.0px / 三段 4.3px
  （距离变换半径均值×2 量化，工具即 `thin-strokes.py` 的统计输出）。
- **细线化工具 `tools/ai-gen/thin-strokes.py`**：距离变换层级收缩 T=1.2 + 软边带混白
  55% 抗锯齿；**只动 RGB 不动 alpha**（轮廓不变 → 剑柄锚定标定不受影响，可后处理随时
  重跑）。本次统一处理 attack_sword_2/attack_sword_3/recover_sheet 三张（一段 3.2px
  用户认可未动）。处理后肋骨/关节环/指骨细节保留，与 idle 细线风一致。
- 教训：montage 小图看不出线宽差异，**线宽要用距离变换量化**；后处理在剪片入库后做即可
  （sheet 级，不用回视频返工）。

#### 全链路落脚点对齐（2026-08-16 用户反馈「三段/idle 错位、大小不整齐」定稿）

- **屏显口径审计法**：逐帧算 屏显身高=内容高/512×(144×displayScale)、脚底偏移=(feet_y-256)
  ×K、中心偏移=(cx-256)×K（display px 相对 player 中心）——审计发现：攻击链脚底 +72.7 vs
  idle +65.0（收势→idle 脚跳 7.7px）；水平中心 idle +3.6 → attack1 f0 −14.5（idle→一段跳
  18px!）→ 1→2 跳 20.7px → recover→idle 跳 −7.3px。
- **统一口径**：四张 sheet 全部 `feet_y=467`（= idle 屏显脚底 +65.0）+ 首帧锚 cx=268
  （= idle 屏显中心 +3.6）；链式锚点：一段末=268 → 二段首=268 → 二段末保留自然前冲
  (+13.2) → 三段首=16.6 → **三段末钉回 268** → 收势 268→268 → idle 3.6，全链接缝 ≤1px。
- builder 新增 `--anchor-end-cx`（基底 lerp 到 目标−末帧自然dx，末帧精确落点、段内位移
  保留）与 `--picks`（手动取帧，战略跳过伪影帧）——注意：`--picks` 曾在并行工作中被外部
  回滚弄丢过一次，重建前 `grep picks build-player-attack-sheet.py` 先自检。
- **武器握点不平移重标**：sheet 内容放置原点变了，按新旧 sheet 每帧 bbox 原点差 Δ 平移
  补偿即可（`offset新 = ((旧偏移/K+256)+Δ−256)×K`），rotation/blur/stretch/hitCheck 不动；
  平移后贴附率复验 0 失败。
- 细线化是 RGB-only 后处理（alpha 不变），重建 sheet 后需对二/三/收势重跑
  `thin-strokes.py`。
- 已知限制：三段突刺顶点内容宽 406px + 前冲 dx，512 格放不下会 clamp（clamp=完整保留、
  顶点略左移，旧版同此行为）；要彻底解决得 640 格 + hitCheck/轨迹重建，暂不需要。
- 备份：对齐前版本在各自 backup 目录的 `*_prealign.png`。
- 入库：旧 v2 留档 `backup/2026-08-15-player-attack-h3/attack_sword.png`，两段式留档
  同目录 `attack_sword_keyframe2seg.png`；blur 峰移 f8~f10 贴挥砍段。

---

### 人形角色视频→精灵图全流程（2026-08-12 露娜 Luna 四动作 32 帧实战定稿）

适用：已有角色动作视频（walk/run/jump/spell），直接产出游戏精灵图，不再走 AI 生图。
工具：`tools/ai-gen/luna-sprite-builder.py`（BiRefNet 批量抠图 + 对齐三铁律 + 拼 sheet；
模型加载一次后 CUDA 约 0.6s/帧）。产物落 `Y:\工作\无尽轮回\scratch\luna-sheets\`。

#### 1. 素材结构分析（先分段再动手）
- 720×720 24fps；`walking and running.mp4` 常是"走路段 + 静止过渡 + 跑步段"三段：
  用**相邻帧差曲线**定位分界（露娜：walking 0-45 / 静止 48-81 / running 81-120）。
- `spelling.mp4` 可能含"施法→坐地"完整流程，只取站立施法段（露娜 0-63），坐地帧不能进施法动画。
- `jumping.mp4` 是"准备→起跳→空中→落地→静止"；空中帧离地高度用 BiRefNet alpha 实测
  （露娜 81px，占主体高 12%）。

#### 2. 动作循环检测（素材常不是无缝循环，先量化再选窗）
- **腿 IoU 会饱和**（0.85~0.99 全周期都高，分不清周期）；全身 RGB 帧差又混入整体位移。
  正确姿势：**先按 bbox 对齐（消除位移）再比腿部姿态**；或提取"腿部质心相对身体中心 /
  腿部展开度"相位特征做自相关（走路 leg_spread 周期信号比 RGB 可靠）。
- 无同相帧对时（走路/跑步段不足完整步态周期，露娜走路 0-44 内任何帧对腿差 ≥37）：
  用**视觉均匀重采样**——按帧间视觉差等距选帧压接缝，不要均匀跳帧（跳帧 = 步伐节奏卡顿）。
- running 由"起步 + 奔跑"构成：起步段（加速过程，帧差由小变大）视觉压缩 N 帧 +
  奔跑段取"对齐后腿差最小"的窗口；交付时**明确循环起始帧**（露娜：起步 10 帧 + 奔跑 22 帧，
  从帧 10 开始循环奔跑段）。

#### 3. 对齐与出格（512/640 格决策）
- 地面循环（走/跑/施法）：高度固定 + 脚底基线固定 + 水平中心固定（对齐三铁律，std≈0）。
- **跳跃必须 ground-relative**：以序列最低脚底为地面基准，空中帧保留离地高度
  （`feet_y - lift×scale`），否则空中帧被拉到地面，跳跃感消失。
- 出格量化：跳跃空中帧 `lift×scale + target_h` 超出格子必切头/切法杖
  （露娜 512 格 target_h=500 时出格 61px）——空中帧需要空间，**跳跃单独用 640 格**
  （游戏显示大小由 spriteSize 控制，与格子分辨率无关）。
- 跑步跨步帧横向贴边：target_h 放大后手臂/法杖出格，露娜实测**内容 470/512=92% 是安全值**
  （也匹配玩家 idle 92% 占格）；跨步最宽帧 651px 原始 → 470 高缩放后 430px，居中 256 不出格。

#### 4. 玩家大小匹配基准
- 玩家 `PLAYER_DEFAULTS.physics.spriteSize = 173`，玩家贴图内容占格 92~99%（接近满格）。
- 新角色精灵图内容高度按同比例定（露娜 470/512 = 92%）；游戏内显示尺寸由 spriteSize 控制。

#### 5. 验证清单
- 接缝 vs 相邻帧差：walking 接缝须落在正常步幅区间内；running 奔跑接缝 ≤ 段内 max×1.5。
- 贴边检查：每格 alpha 距边缘 6px 内像素数（横向/顶部），露娜 470 高无贴边、跳跃 top8px=0。
- 空帧检查：格内 alpha>10 像素数 <50 视为空（禁注册进动画）。
- GIF 按**游戏内播放方式**生成：running = 起步 10 帧一次 + 奔跑 22 帧循环 3 轮；
  不要全序列循环（31→0 会闪回起步帧，被误判为"循环截取错误"）。

#### 6. 坑（2026-08-12 全踩过）
- cv2/PIL 读中文路径失败 → 帧先 Copy-Item 到 `%TEMP%`（无中文），产出再 Copy-Item 回中文路径。
- 阈值 mask 粗查 bbox 会被**脚下阴影**骗到（bbox 贴底/贴边误判"角色出画布被裁"），
  必须用 BiRefNet alpha 复检（露娜跑步段左边缘 alpha=0，实际完整无裁切）。
- 阈值 mask 把背景暗角算进主体（背景角落 159-236，纯阈值抠图不可靠），统一 BiRefNet。
- 重采样选帧用"视觉距离"而非"帧号均匀"：`linspace(0,33,32)` 取整会跳帧造成卡顿，
  等视觉距离选帧（相邻 RGB 差均匀）后露娜 walking 接缝从 17.1 → 11.8（落在正常步幅区间）。

#### 7. 露娜奔跑重生成（2026-08-13，H3 图生视频 + 无漂移验证）
背景：AI 生成的 running.png 有水平漂移（质心 31px、循环回跳 25px）。改用 H3 i2v 重新生成原地奔跑：
- **参考图**：取现有 running_norm.png 最居中帧 → 合成 1024×576 纯白底，角色高 75%（432px）；
  `--first-frame`/`--last-frame` 传同一张（锁体型 + 无缝循环），`--duration 5.17`（124 帧）/16 步/1024×576。
- **防漂移提示词**：`static camera locked in place ... the body stays perfectly centered
  in the frame and never drifts left or right, only the arms and legs move ...` + 白底 + 无缝循环条款。
- **生成后验证（必须）**：① 逐帧主体质心 x 漂移（露娜 v2 全帧 22.5px=步态摆动、首尾同 511.1 对称）；
  ② 背景色伪影检测（非目标色像素数，`R>200&G<180&B>180` 应为 0）；③ 首尾帧 bbox 一致。
- **选 32 帧窗口**：腿部区域差扫描 `[s, s+31]` 接缝最小（露娜 v2：s=46，seam=3.24 << 内均 7.48）；
  原地跑无位移，连续窗口即可，无需视觉重采样。
- **成品**：512 格 8×4、内容高 461、脚底 480（与 walking/spelling 一致）；接缝质心跳变 1.8px、
  接缝帧差 10.89（低于相邻 mean 13.49）。已替换 `assets/companions/luna/running.png`（旧图备份
  `Y:\工作\无尽轮回\scratch\luna-sheets\running_old_20260813.png`）。

#### 7b. 左右脚交替筛选（2026-08-14 二轮，AI 视频老问题根治）
用户反馈 v2 仍"左右脚错误替换"：GLM 证实 v2 窗口帧 31（左腿前）→帧 0（右腿前）左右脚互换，
且帧 0/1/30/31 每帧都在换腿——**源视频步态交替节奏本身混乱**（脚部特征谷值间隔 22~32 帧波动）。
教训：**接缝帧差/质心小 ≠ 循环正确**，必须验证左右脚同相。第二轮流程：
- **多 seed 生成候选**（同一参考图/提示词，seed 换号），提示词加
  `left and right legs alternate naturally in a steady rhythm, each leg takes a full stride
  before switching to the other leg, no leg swapping, no twitching, no abrupt leg switching`。
- **自动筛选（脚部交替规整性）**：逐帧脚部特征 = 脚部区域（底部 20%）质心相对身体中心 X
  （注意 np.where 返回 (rows, cols)，质心 x 必须用 cols！），5 点平滑后找局部极值；
  谷值（脚收回）间隔的 std 衡量交替规整度。候选 2 谷值间隔 31/31/31（std=0）= 双步周期 31 帧；
  候选 1 脚部特征几乎不动（帧差 2-3）= 角色没在跑，直接淘汰。
- **循环窗口同相验证（GLM 必做）**：裁窗口后抽帧 0/15/16/31 问 GLM"每帧哪条腿在前"，
  要求帧 31 与帧 0 前腿一致（同相、无左右脚互换）。v3 帧 0/15/31=右腿前、帧 16=左腿前（交替中）✓。
- **成品 v3**：候选 2 帧 30-61 窗口，seam=1.43（远小于内均 5.73）、接缝帧差 7.38、接缝质心跳变 1.4px；
  双步周期 31 帧交替规整。已替换 running.png（v2 备份 running_v2_20260814.png）。

#### 7c. 32 帧数学约束与 24 帧定稿（2026-08-14 三轮，用户确认 24 帧）
用户仍反馈"第 16 帧左右脚互换"，且 GLM 多次判断前后矛盾（同帧组两次答不同前腿）——
**根因是跑步自然步频与 32 帧规格冲突，不是单纯 AI 质量问题**：
- **实测所有候选双步周期**：候选 2/5=31 帧、候选 6=25-26 帧（模板匹配 24）、候选 7 不规整；
  **32 帧无法被任何自然周期整除**，32 帧循环接缝必然左右脚相位错位。
- **陷阱：像素同相 ≠ 语义同相**。候选 2/5 的 32 帧窗口接缝腿差仅 1.4（侧视左右脚互换时轮廓相似），
  但语义上左右脚已换——这就是"接缝帧差小却左右脚互换"的原因。
- **语义同相验证（模板匹配，比 GLM 可靠）**：取 GLM 确认的右腿前帧/左腿前帧做腿部模板，
  每帧"右前度" = 与右模板相似度 - 与左模板相似度（cosine）；窗口首尾右前度同为显著正值
  （>+0.15）才算真同相。候选 6 帧 0/24/48/72/96 右前度 +0.16~+0.20 → 双步周期 24 帧。
- **定稿（24 帧精灵图）**：候选 6 帧 24-47（首尾右前度 +0.197/+0.165 同相），接缝帧差 10.83
  （低于内均 14.75）、质心跳变 2.3px；GLM 确认帧 23→0 均右腿前（无互换）、帧 10-13 左腿保持换腿自然。
  已替换 `assets/companions/luna/running.png`（24 帧 8×3、2048×1536；v3 备份 running_v3_20260814.png）。
- **教训**：强制帧数规格前先测步态周期——循环帧数必须是周期的整数倍，否则左右脚必然错位；
  AI 跑步视频步频在 24~31 帧区间，常用 24 帧规格恰好落在范围内，32 帧是"最差"选择。

#### 7d. 已有 AI 角色六动作精灵图重做（2026-08-16 伊莉丝 Elise 实战）

背景：素材库已有 4×8 切好的六张 4096×2048（idle 1/walk 14/run 23/attack 28/
defend 19/windmill 23 帧），只需按 SKILL 对齐三铁律重建入库，**不需要重新出图**。
成品参考 `tools/ai-gen/elise-sprite-align.py`（luna-run-align 同款口径）。

- **重建脚本铁律（踩坑实录）**：
  - 脚底定位必须用**缩放后内容高**：`dy = FEET_Y - nh`（`nh=round(h*scale)`）。
    写成 `FEET_Y - bottom*scale` 会把整帧顶到格子外 → 内容全部被裁剪到几像素
    （idle 只剩 13px 高，肉眼即"截取不全"）。
  - 水平平移 clamp 边界：`dx ∈ [2, 510-(nw-1)]`（内容左右缘落在 [2,510]）。
    写反（`[2-(nw-1), 510]`）会让宽帧右缘溢出 511 被裁。
  - alpha 阈值：度量口径 alpha>16。若用 alpha>40，attacking f5 剑尖
    （alpha 仅 16~40）会被当噪点断掉；同理 windmill 剑弧等细长部件。
  - 连通域去噪只用于确实有散布噪点的 sheet（defend f12/f13 右下角 9px 脏点，
    alpha>16 下仍是独立小域、距主体 >24px，合并规则不会误删）。
- **每 sheet 缩放口径**（512 格、脚底 480）：idle/walk/run/defend 站姿 461 高
  （露娜同款）；**attack 1.75**（源图挥剑帧宽 262，1.80 时最宽帧右缘溢出；
  剑举过头帧 f5 单独 1.441 保整把剑含剑尖到 y0）；**windmill 1.52**
  （旋转剑弧宽 319，统一缩放保证剑弧完整入格，角色偏小是源图宽弧的必然）。
- **验收量化**：成品 512 格扫描——walk/run/defend/windmill 质心 X 跨度 ≤2.3px、
  0 贴边；attack 因挥剑姿态剑尖右伸，质心跨度 ~46px 属正常，内容完整不裁切
  （裁切判据 = 帧 bbox 触格边缘，不是质心跨度）。
- **风车动画不播的排查**：先确认 `_animState==='windmill'` 且 sprite 动画键
  `companion_warrior_bruno_windmill` 已注册、`wmPlayed` 复位逻辑（idle 分支）
  正常；坏精灵图（全部缩到角落）会让动画"看起来没播"——先验图再查代码。

#### 7e. 多动作统一角色尺度：多格规格 + 渲染归一化（2026-08-17 伊莉丝 v2 定稿）

7d 的"512 格一刀切 + 每 sheet 独立缩放"有硬伤：attacking/windmill 剑弧宽（源 262/319px），
512 格装不下统一尺度 → 被迫小缩放（1.75/1.52），游戏内角色挥剑缩到走路体型 65%、风车 53%；
f5 举剑帧单独缩放（身体 245）；且 512 格下宽帧质心对齐 clamp → run 循环帧水平跳 18.8px、
defend 持盾帧右偏 13px。**结论：武器弧远超身体宽的动作，格子必须按内容选型，不能一刀切。**
另：idle 待机图后续换源为 `素材库/人物/Elise/抠图版本.png`（用户指定，1536² 透明底全身
持剑盾），同样按本节口径重建（全身内容高 461/脚底 480/质心 256/512 格）入库统一大小。

- **统一尺度铁律**：所有动作共用**同一个全局缩放 S**（伊莉丝 = 461/171，站立身体高 461 =
  露娜同款），不做每 sheet 独立缩放、不做逐帧拉高——跨动作身体大小一致，动作间切换无缩放跳变。
- **格规格按最大内容选型**：每 sheet 量出最大帧内容 w/h × S，格宽还要满足"质心对齐到格心
  不 clamp"（伊莉丝 attack 最宽帧质心在内容 34% 处 → 960 格；windmill 52% → 896 格）。
  帧格可非正方形（attack 960×1024：f5 举剑 898 高完整入格，**不再单独缩小**）。
  布局 cols/rows 按帧数自由选（attack 28 帧 5×6、windmill 23 帧 5×5），不再沿袭源图 8×4。
- **脚底统一 0.9375×格高**（512→480 / 640→600 / 1024→960）：脚底偏移只与格高相关，
  渲染侧可用单一公式归一化。
- **渲染归一化（改图必须同步改渲染，本次"大小无法统一"的渲染侧根因）**：Phaser 换纹理时
  按新帧格重算显示尺寸——只改图不改渲染，帧格一变角色就整体缩放/漂移。GameScene 每帧按
  当前帧格线性映射：`setDisplaySize(帧格W×size/512, 帧格H×size/512)` + 位置补
  `-(帧格H-512)×0.4375×size/512`（512 格 = 显示基准，全 512 格的露娜/仓鼠零影响）。
  派生公式：内容高统一 461 → 世界高 = 461×size/512 恒等；脚底世界偏移 = 0.4375×格高×size/512。
- **验收口径**：重建后逐帧扫 alpha>16——质心 X 跨度 ≤5px（clamp 归零）、0 贴边、0 裁剪、
  非空帧必须连续 0..N-1、尾格全空；GLM 单张查"六动作首帧身体大小是否一致"（多图并排会串扰，
  只做定性）；GIF 按游戏内播放口径生成（walk=起步全播+循环段、run 同、attack/windmill 单次、
  defend=enter+hold+exit）。
- **契约测试**：`scripts/test-elise-sheets.mjs` 锁格规格 + sheet 实物 IHDR×配置一致性，
  防止"改配置漏改素材"或退回小格缩水（已入 npm test）。
- **二轮修复（实机反馈，2026-08-17）**：
  - **循环闪回 = 末帧与段内某帧同相**：run 循环 [10,22] 末帧 f22 与 f11 腿部同相
    （腿部 IoU 0.565 vs 段内均值 0.252）且是周期外最深迈步帧 → 接缝同一条腿连播两次。
    修：`loopFrames [10,22]→[10,21]`（删末帧）。诊断法：腿部区域（bbox 底部 35%）IoU 比
    全身像素差灵敏——接缝帧差 42.6 看着"正常"，腿部 IoU 才暴露同相。
  - **idle 漂移 = 起步前摇帧原地重播**：walking f0/f1 是"前倾重心偏移、未迈步"的准备帧
    （GLM 确认），AI 跟随微调反复 idle↔walk → 前摇原地抖。凡"状态动画+起步前摇"结构的动作，
    起步段必须排除非步态前摇帧。
  - **最终口径（五轮，用户拍板）**：① **前摇帧直接从素材删除**（walking.png 14 帧裁成
    12 帧 4×3，不是只在配置里跳帧）；② **取消一切移动门槛**——状态是 walk 就无条件播
    行走动画，任何小范围移动都强制走 walking（静止时 AI 切 idle 分支显示待机）。
    教训：移动门槛（逐帧位移采样/isMoving+宽限）都会引入"待机姿态滑行"或"动画只播
    一两帧"的观感问题，用户最终选择"纯步态素材 + 无条件播放"——**先删素材里的非步态
    前摇帧，门槛能不加就不加**。
  - **AI 阶段字段与渲染同源（防御重复动画根因）**：AI 把防御阶段存实例字段
    `this._defendPhase`、渲染读 `member._defendPhase` → 恒 undefined → 永远按 enter 重播。
    阶段字段一律写到实体成员（与 `_animState` 同口径）；渲染侧一次性动画（repeat 0）
    只在阶段变化时 play 一次、播完停末帧，不能用 `!isPlaying` 当重播条件（播完即回放）。

#### 8. 远程 5080 H3 生成故障排查（2026-08-13 实录）
- **症状**：提交即 `SamplerCustomAdvanced` 执行失败，`NotImplementedError: No operator found for
  memory_efficient_attention_forward`，`fa3F/cutlassF-pt ... requires device with capability <(8,0)
  but your GPU has capability (12,0) (too new)`。
- **根因**：RTX 5080 是 Blackwell（sm_120），远程 xformers 2.8.3 没有为 sm_120 编译的 fmha kernel。
- **修复**：远程 ComfyUI 加 `--disable-xformers` 重启（走 PyTorch SDPA，实测 124 帧 6.2 分钟反而更快）。
  重启要点：schtasks 的 `/tr` 嵌套引号会丢参数（第一次启动成了无参进程、端口占用让 bat 失效）——
  用远程写 bat（`D:\开发文件\ComfyUI\start_h3_noxformers.bat`，GBK 编码写中文路径）再由 schtasks 运行；
  重启前必须杀干净旧 8188 进程（会出现双进程抢端口）。
- **坑**：`pick_bg_color.name_for_hex('#FFFFFF')` 原返回 "vivid magenta"（CANDIDATES 无白色，
  距离并列取第一个）→ H3 把背景生成成粉色（12 万像素/帧）→ 已修复：CANDIDATES 首位加
  `("pure white", "FFFFFF", (255,255,255))`。**显式 --bg-color 后必须核对日志注入的色名**。

---

### 四足动物（狼系）动画精灵图全管线（2026-08-07 黑狼/红狼王定稿）

适用范围：黑狼/红狼王等四足狼系怪物，H3 视频 → 精灵图 → 游戏入库。
管线段：视频生成 → 周期/窗口检测 → 抽帧 → BiRefNet 抠图 → 缩放摆放 →
去污染去白 → 定量验证 → 游戏接入。以下每条都是踩坑后定稿，换新四足动物
（虎/熊/犬等）直接照抄流程，只重测周期参数。

#### 1. 视频生成（MiniMax H3）
- 配置：1024×576 + 16 步 = 6 分钟/段（1344×768+20 步 17 分钟，快 2.6 倍）；
  H3 最短可靠 124 帧（5.17s），循环靠截取不靠续帧。
- 首帧模式：loop 视频 `--first-frame` = `--last-frame` 同图；攻击视频是
  "idle → 动作 → 回 idle" 的一次性弧线。
- 提示词铁律：
  - 攻击必须写"肢体前扑"（steps front legs forward / stretches torso /
    thrusts head），只写 lunge/open jaws 会被 H3 理解成只张嘴（v1 实锤）。
  - 撕咬力量感靠"大张嘴+头前探+快速帧节奏"，H3 不生成闭合帧，闭合靠
    抽帧选取（张→咬→张），不要指望模型咬合。
  - 参考图体型必须做壮（宽度目标 ≥150/262 高），H3 受参考图体型影响极大
    （红狼人 108→161 宽的教训）。
  - run 视频固有水平拉伸（提示词 "body stays compact" 仍 430），接受为
    奔跑姿态，不要为此重生成。
- 视频特性：狼大小漂移是生成特性（run 首帧 471→中段 631 宽）；切帧只能
  统一高度，宽度差异读作姿态（黑狼 idle 408 / walk 415 / run 458 同款）。

#### 2. 周期/窗口检测（先扫参数，别沿用工头默认）
- 周期扫描：`leg_iou(s, s+P)`，P∈[16,120]，限定匀速中段 steady(12..105)；
  **首尾高 IoU（~0.98）是 idle 重影不是周期，别信**。
- **扫描必须同时限定动作窗口**（驱动 `quadruped-rebuild.py` 实测踩坑）：先
  `detect_window` 拿到动作区间 [w0,w1]，周期候选要求 **s+2P ≤ w1**（两个采样
  周期完整落在窗口内）——否则尾段回位/idle 的 0.99 高 IoU 会把采样带偏到
  尾段，导致首尾 IoU 断链（bear_run 首轮 0.00 的根因）。
- 黑狼实测：walk P=48（s=40，iou 0.80）、run P=28（s=40，iou 0.66——
  低伏姿态腿部占比小，阈值要放宽，0.66 就是正常值）。
- 攻击窗口：mask 相对首帧 IoU 差定位（撕咬 21..43、飞扑 14..74）。

#### 3. 抽帧策略
- walk：step 3 → 16 帧（4×4）覆盖完整周期；run：**step 1 连续 28 帧**
  （=视频原帧，4×7）。快速动作帧数宁多勿少：run 14 帧 step2 腿部 IoU 0.14
  僵硬，28 帧连续 0.45+ 顺滑。
- 攻击：**保留水平位移**（以首帧 bbox 中心为参照，按 dx×scale 平移，不
  逐帧居中——否则前扑 reach 被抹掉）；`--fixed-scale 1`（首帧同比例）防
  蓄力压低帧被放大；飞扑 20 帧（4×5）、撕咬 6 帧（3×2）。
- idle 抽 1 帧静态；攻击帧 cols 不满行补透明格。

#### 4. 抠图（BiRefNet 管线，正式入库唯一路径）
- 模型：`ComfyUI/models/BiRefNet/MS-BiRefNet`，**必须用 ComfyUI venv
  python**（系统 python 无 transformers）。
- alpha = max(BiRefNet, 全身深色阈值 threshold-13=235, 腿部区域阈值 248)：
  - 235 只兜深色区，灰白压缩背景（235~248）交给 BiRefNet 判定，否则留白边；
  - **腿部区域（bbox 底部 35%）单独用 248**：run 低伏奔跑腿部运动模糊
    灰度 200~248，超 235 兜底线，BiRefNet 对模糊腿 alpha 不稳 → 硬边后
    腿型逐帧抖动（重建后腿部 IoU 0.28 vs 视频原帧 0.64）。腿部兜底后 0.45。
- 去污染（sprite-decontaminate.py）：半透反推前景色 F=(C-(1-α)·B)/α；
  亮半透（lum>150 且 alpha<250）清零；白色半透直接清零。
- 硬边：黑狼 alpha<245 全清零（semi=0，接受轻微锯齿）；红狼王留 0.5%
  浅毛软边（lum-clear 200 只清近白边，保浅色毛）。
- 边缘亮像素（lum>150 且贴透明 2px 内）压暗到 18（黑毛色）；内部白毛保留。
- 透明区 RGB 归零（trans_nonblack=0）。
- **腿部区域去残留**：bbox 底部 35% 内不透明亮像素（lum>160）→ 5×5 邻域
  毛色均值替换（清脚底贴地/运动模糊灰白；躯干白毛不受影响）。脚底残留
  alpha=255 离透明区>2px，光靠"邻接透明压暗"清不掉。
- 彻底去白（用户要无白时）：RGB min>220 近白像素替换 5×5 邻域非白毛色均值
  （白毛区变深色毛），别只清孤立点。
- 白点分类：边缘噪声（清）vs 白毛（留），按到内容边缘距离区分，勿一刀切。
- **resize 后必须逐格清理**（硬二值化 → 每格最大连通域 → 边缘压暗 →
  透明归零 → 腿部去白），否则插值会再造半透带/白圈（walk 首版 DIRTY 教训）。
  **2026-08-08 起该清理已内置 `rebuild-h3-birefnet.py --auto-clean`（默认开），
  不再需要外部手动补一步**（直接调 CLI 出 CLEAN sheet）。

#### 5. 缩放/摆放
- 高度统一：uniform-h target_h=262（黑狼/红狼王全部狼形态），宽度随姿态；
  攻击帧 fixed-scale 1（首帧同比例）防"忽大忽小"。
- 脚底基线：512 格 feet-y 410（feet fraction 0.80）；格子放大按比例
  （640 格 feet-y 513），保证与其它状态同世界高度。
- 前扑伸展帧宽超 512（545~583px）→ 格子放大 640²（红狼王撕咬同款 576²），
  BootScene frameWidth/Height 同步，canvas 按 naturalWidth/cols 自动切帧。
- 显示 151×151、内容高 262/脚底 410/居中；碰撞体积不动。

#### 6. 验证（定量铁律，GLM 辅助）
- CLEAN 判据：stray=0 / semi=0 / trans_nonblack=0 / edge_bright=0 /
  composite_residue=0（合成到 180 背景，暴露地面混合问题）。
- 动画平滑：相邻帧腿部 IoU（run≥0.4、walk≥0.5 合格；视频原帧 0.64 为上限）。
- 循环衔接：首尾帧 alpha IoU 应显著高于正常步进 IoU（黑狼 0.90~0.95 vs 0.75~0.80）。
- 朝向：新旧首帧交叉相关（flip diff 大=同向）；质量中心偏移对对称狼不可靠
  （误报过 FLIPPED）。
- 体型：各状态高度统一 ±1.5%；宽度差异读作姿态，GLM 会把低伏 run 误读为
  "最小"，以像素高度为准。
- GLM 复核构图/动作；**黑狼图集锯齿会被误读为色块，以像素为准**。

#### 7. 游戏接入
- BootScene：spritesheet frameWidth/Height = 格子尺寸（512/640），
  endFrame = 帧数-1；动画键与 `_getTextureKey()` 一致。
- animation-config frameLayouts **双份同步**（data/ + public/data/）
  cols/rows/frames 与 sheet 严格一致。
- 黑狼走 Phaser setFrame 帧索引路径（无 anims 注册）；帧率 run 40ms/帧、
  walk 120ms/帧（28×40 与原 14×80 圈时一致）。
- 多贴图混用纪律：同敌人新旧贴图画布尺寸必须统一（本项目 512²/640²），
  否则创建时一次性 displaySize 会压扁后续贴图。
- 攻击动画帧率快（撕咬 6 帧 ~500ms）强化"咬一下"节奏。

#### 8. 坑清单（技术）
- **cv2.imwrite 按 BGR 解析 RGBA 数组 → 红狼变蓝 bug**：sheet 必须
  `Image.fromarray(sheet, "RGBA").save()`（PIL），禁止 cv2.imwrite。
- 中文路径：写文件用绝对路径（cwd 飘忽静默失败）；cv2 中文路径静默失败；
  PowerShell 管道 heredoc 是 GBK 会吃中文字符串 → 用环境变量传路径。
- 游戏缓存旧图：资产确认干净仍见白底 = 浏览器缓存，硬刷新/重启 dev server。
- 数值回退用 `??` 不用 `||`（falsy-0 把显式 0 回退成默认值）。

#### 9. 工具链
- **统一入口 `tools/ai-gen/ai-asset.py`（2026-08-08 定稿：一个大类一个入口，工作一律从这进）**：
  - `monster idle --name X --ref 参考图 --prompt 提示词 [--bg-color auto|#hex]`：5080 生图候选
    → BiRefNet 抠图 → 512 归一化（自动选主体无色背景并注入提示词）；
  - `monster video --name X --kind run|attack --ref idle图 [--bg-color auto|#hex]`：5080 H3 生成动画视频；
  - `monster rebuild --name X --video y.mp4 --kind run|attack [--bg-color 同色] [--cell 640]`：
    视频 → 动画 sheet（周期/窗口检测 + BiRefNet 重建 + CLEAN 验证报告）；
  - `monster status --name X`：列出该怪物全部产物（scratch/<name>_*）；
  - 通用子命令：`cutout --src --out`（抠图）、`bg-color --image`（选背景色）、
    `verify --sheet --cell`（CLEAN 验证）。
  - 所有子命令支持 `--dry-run`（只打印将执行的命令）。底层脚本仍可单独调用，但开展工作
    一律从统一入口进，避免"散落各地没法调用"。
- 视频：`tools/ai-gen/minimax-h3-gen.py`（5080 远程，可被 ai-asset monster video 调用）。
- 重建：**`quadruped-rebuild.py`（通用一键：周期扫描/窗口检测 → 采样 →
  rebuild → auto-clean → 验证报告）**：`--video x.mp4 --kind run|attack --out y.png`
  （run 自动采 P×2 连续帧无缝循环，attack 窗口均分 20 帧；可 --cell 640 等覆盖）。
  `rebuild-h3-birefnet.py`（--frames/--frames-count/腿部兜底/内置 auto-clean）、
  `blackwolf-rebuild-from-video.py`（黑狼专用驱动）。
- 验证：`blackwolf-rebuild-verify.py`（CLEAN 五指标）、
  `blackwolf-rmbg-compare.py`（旧新对比）、`sprite-decontaminate.py`（去污）。
- 识图：`tools/glm-analyze-image.mjs`（GLM-4.6V 复核）。

---

### 黑狼动画升级（2026-08-06，H3 全动作管线落地）

#### 1. 步态周期不能沿用工头默认（关键）
- `h3-loop-spritesheet.py` 默认 `--period 70,120` 是按工头 walk（P=80）标定的；
  **黑狼 walk 实测周期 P=48（s=36,e=84）、run P=28（s=40,e=68）**，用默认周期
  直接报 "no same-phase gait pair found"。换动物必须先做腿部 IoU 周期扫描
  （`leg_iou(s, s+P)`，P∈[16,120]）定真实周期，再传 `--period P,P`。
- 首尾高 IoU 配（~0.98）是"首帧=尾帧 idle 重影"，不是步态周期，别被它骗；
  限定匀速中段（steady 12..105）再找周期。
- 步进：walk P=48 用 `--step 3` → 16 帧（4×4）；run P=28 用 `--step 2` → 14 帧（7×2）。
- **四足奔跑提帧优化（2026-08-06）**：run 14 帧（step 2）实测僵硬——
  相邻帧腿部 IoU 仅 0.140（帧间腿部跳变 = 僵硬）。优化：
  ① **提高采样密度** step 2→1（28 帧 = 视频原帧，4×7 网格），
    相邻帧腿部 IoU 0.538，平滑度 +285%；
  ② 重建走阈值 bbox + max(BiRefNet, 阈值) 腿部兜底（run 四腿运动同样会丢腿）；
  ③ 游戏帧率 80→40ms/帧（28×40=1120ms，与原 14×80 圈时一致）。
  经验：**快速动作（run）帧数宁多勿少，step 1 逼近视频原帧最顺滑**；
  慢速动作（walk）step 3 可接受。
- **飞扑同款提帧（2026-08-06）**：飞扑 11 帧 → 20 帧（prepare 4→6、charge 7→14，
  4×5 网格），相邻帧 IoU 0.418→0.553（+32%）；垂直提升抛物线按 14 帧细化
  （起跳 10 → 空中 32 → 落地 2px）；prepare 帧 200ms/帧、charge 95ms/帧。
  攻击动画提帧同样适用"密采样 + 阈值兜底"，GLM 五项全过。
- **H3 撕咬生成坑（2026-08-06）**：H3 对"咬合撕咬"不敏感，4 版提示词
  （强调 jaw snap/clamp）仍生成"张嘴吼"（嘴巴大张保持）。解决：
  **抽帧避开大张帧，选"闭嘴→小张→闭合→松开"的闭合帧序列**（v3 视频的
  f36/40/52/56/60/64），GLM 确认小幅咬合、无大张吼叫帧。
  经验：H3 生成嘴部动作节奏慢，撕咬动画靠帧选取塑造咬合感，
  游戏帧率调快（6 帧 ~500ms）强化"咬一下"节奏。
- **移动动画白底/灰边排查（2026-08-07）**：walk 旧版为 BiRefNet 纯 alpha，
  半透边缘像素高达 8 万/张（虽深色，但在浅色地面移动时显灰圈）。修复：
  用统一管线重建（阈值 bbox + max(BiRefNet,阈值) + **decontaminate 收紧
  lum>150 半透清零**），半透像素 80867→171，边缘全硬无残留；
  run 近白像素是狼真实白毛/高光（腹部/胸口），非背景残留，勿误删。
  经验：移动动画边缘残留先量化半透像素数，浅色地面会放大浅灰边缘；
  资产确认干净后仍见白底 = 游戏缓存旧图，刷新/重启 dev server。
- **抠图白点清理（2026-08-07）**：阈值兜底会把 235~248 的浅色边缘像素保留为
  白色噪点（walk 孤立白点 4235 / run 7366 / pounce 4791，99% 在内容边缘 2px 内）。
  修复：近白像素（RGB min>235 且 alpha>200）在内容边缘 2px 内一律 alpha 归零 +
  3×3 孤立白点清除 + 低 alpha 白残留清零；内部连片白毛（距离>2px）保留。
  清理后 GLM 确认：边缘无白点/白边/锯齿、白毛自然、整体干净。
  经验：白点分"边缘噪声"（清）与"白毛"（留），按到内容边缘距离区分，
  不要一刀切删全部近白像素（会毁掉腹部白毛）。
- **彻底去白（2026-08-07 用户要求）**：孤立点清理仍不够，用户要求"直接排除
  白色/类白色像素"。终极方案：**RGB min>220 的近白像素（含 alpha<200 半透白）
  一律替换为 5×5 邻域非白像素的毛色均值**（不是删 alpha，是颜色替换——
  无白点、无洞、白毛区变深色毛），半透白边缘 alpha 压到 120。
  处理后 5 张贴图残留类白像素 = 0。经验：用户要"无白"就颜色替换整片去白，
  别只清孤立点（孤立法漏掉连片浅白边缘）。
- **黑狼攻击冻结移动（2026-08-07）**：bite 攻击阶段设 `_frozenForCast=true`
  （MovementSystem 检查禁移动），pounce 沿用 prepare `_frozenForCast` +
  charge `_attackAnimTimer`——攻击期间不再边攻击边漂移。
- **撕咬攻击性重生成（2026-08-07 v5）**：提示词强化 "snaps jaws open and shut
  with strong force, teeth clashing, lower jaw closes up fast and hard with
  visible impact, aggressive and fierce, the head jerks forward slightly"。
  H3 仍不生成闭合帧（全程大张），但抽帧后节奏呈"张→咬→张"，GLM 确认
  攻击性/力量感强、无静止吼叫帧。经验：H3 撕咬要力量感靠"大张嘴+头前探+
  快速帧节奏"，闭合细节依赖帧选取。

#### 2. 攻击视频抽帧（新工具 `h3-attack-spritesheet.py`）
- 攻击视频同为首帧=尾帧=idle 的一次性弧线（idle → 攻击 → 回 idle），
  用狼 mask 相对首帧的 IoU 差定位攻击窗口（撕咬 21..43、飞扑 14..74）。
- **水平位移必须保留**：攻击帧不能像循环那样逐帧居中——否则前扑/撕咬的
  水平 reach 全被抹掉。以首帧 bbox 中心为参照，各帧按相对位移 dx×scale
  平移（飞扑 cx 从 638→737，占格内 36px）；脚底基线仍固定 410。
- 攻击帧数：撕咬 8 帧（step 3）、飞扑 11 帧（step 6）；cols 不满行补透明格。
- 黑狼步态动画走 **Phaser setFrame 帧索引路径（无 anims）**：每状态独立
  `frameLayouts`（cols/rows/frames），`_animFrame` 按状态取模，比 foreman 的
  `anims.create` 集成方式不同——`_getTextureKey` 换贴图 + `_getPhaserOptions.frame`
  切帧即可，不要套用 anims 注册（黑狼本来就不注册动画）。

#### 2.1 攻击帧必须固定缩放比例 + 防裁切（2026-08-06 撕咬反馈修复）
- **症状**：撕咬时狼被误放大、前扑帧左右被裁。根因二连：
  ① 逐帧 `scale = 262/当前高` 统一缩放到 262——蓄力压低帧（视频高 525 vs idle 556）
  被放大 6%，前扑帧高度波动导致狼忽大忽小；
  ② 前扑帧内容宽（视频 903→1024）+ 水平位移 dx → `ox+nw > 512` 直接裁剪
  （旧 sheet 多帧宽 512 贴满 cell、左右触边）。
- **修复（`h3-attack-spritesheet.py --fixed-scale 1`，默认）**：
  ① **固定缩放**：所有攻击帧用首帧（idle）同比例 `scale = 262/首帧高`——
  狼与 idle 恒等尺寸，蓄力压低/前扑伸展读作真实姿态（高 224~261 自然变化），
  不放大；② **防裁切 clamp**：`ox = clamp(ox, 0, cell-nw)` 内容优先完整，
  不再裁剪超界像素。
- **验收判据**：各帧 bbox 无 touch（x1<510）、高度含蓄力帧自然矮、
  GLM 确认"大小一致无突然放大、前扑头爪完整"。
- 撕咬 v3：帧高 224~261、宽 405~482 全完整；飞扑 v3：宽 431~504 完整。

#### 3. 黑狼攻击 = 只保留撕咬（2026-08-16 定稿；历史沿革见下）
- **当前定稿（2026-08-16）**：用户要求删除飞扑攻击及其动画，只保留撕咬一种攻击方式。
  已删：`black_wolf_pounce.png` 的 BootScene spritesheet 加载、animation-config.blackWolf
  的 sprites.pounce / attackTypes.pounce / frameLayouts.pounce、enemy-config.blackWolf
  的 pounceRange/pounceCooldown/pounceHitDistance/pounceCrippleMs/pounceMaxDist/
  pounceOvershoot（attackType "飞扑"→"撕咬"）；`BlackWolf._usesPounce=false`，
  攻击决策/贴图/网格/帧数一律走 bite（`_getTextureKey/_getFrameLayout/
  _getStateFrameCount/_drawBody` 的 pounce 分支已删）。
- **红狼王不受影响**：`RedWolfKing extends BlackWolf` 复用基类飞扑状态机
  （`_startPounce/_startCharge/_endPounce/_updatePounceCharge/_spawnSpeedLine` +
  `_pounceState` 系列字段），红狼王构造器 `_usesPounce=true` 并补齐字段声明，
  双攻击（近咬 pounceBite / 中距飞扑 pounceClaw）照旧；黑狼删掉的 pounce
  渲染分支红狼王均各自 override，互不影响。
- **历史沿革**：2026-08-06 曾按"只保留飞扑、移除撕咬"定稿（mutant-3 同构）；
  2026-08-07 加回普通撕咬做近距攻击（biteRange 150，飞扑留中距技能）；
  2026-08-16 最终定稿只保留撕咬。
- **飞扑机制（红狼王在用，黑狼已停用；与 mutant-3 同构）**：
  - `_pounceState`：idle → prepare（蓄力 1s，`_frozenForCast=true` 锁定移动、面向目标）
    → charge（锁方向 1s 直线冲刺：穿过目标 + overshoot 或最远 maxDist，
    固定速度 = 距离/1s，逐帧 `WallSystem.resolve` 撞墙）；
  - 命中：charge 每帧 `_isTargetInRange(hitTarget, pounceHitDistance)` →
    `takeDamage + applyCripple(3000)`（致残减速 debuff，非眩晕）；
    盾牌弹反 `_lastParried` 不施加致残；
  - `aiInterval = Number.MAX_SAFE_INTEGER` 关闭通用 CombatSystem 攻击，
    状态机自主触发（目标距离 ≤ pounceRange 500 且冷却 12s）；
  - `_attackAnimTimer` 在 charge 期间保持 >0，阻止 MovementSystem 覆盖朝向；
  - 冲锋速度线条 `_spawnSpeedLine`（替代残影）：沿狼身后反方向拖出短色块链，
    白芯 + 浅蓝辉光 ADD——参考 LightningBoltEffect 的圆块链风格，
    线条感强于纯粒子、柔于纯线条（折中方案），每 80ms 一条、170ms 淡出。
- **动画阶段帧区间**：pounce sheet 11 帧按阶段分区——prepare 帧 0~3（蓄力蹲）、
  charge 帧 4~10（跃起扑击）；命中即中断（只播 4~6 后回 idle，与 mutant-3 一致）。
- **配置（红狼王在用）**：`animation-config.redWolfKing.attackTypes.pounce`
  （prepareMs/chargeMs/prepareFrames）+ `enemy-config.redWolfKing` 的
  pounceRange/pounceCooldown/pounceHitDistance/pounceCrippleMs/pounceMaxDist/
  pounceOvershoot；黑狼侧 pounce 配置已全部移除。
- **飞扑动画重制（2026-08-06 v3 定稿）**：提示词强化爪子细节
  （"swing forward in a wide visible arc like a cat swiping, claws spread wide
  apart and clearly visible with sharp distinct claw tips"）后重生成，
  特写验收确认"前爪前伸 + 爪尖张开可见"（挥击弧线是 H3 侧视模型的生成极限）；
  游戏内动作时长按用户要求调到 ~3s（prepareMs 1200 + chargeMs 1800）。
- **飞扑动画重制 v4（2026-08-06 定稿）**：两阶段提示词——
  phase one 准备（"lowers its body close to the ground, belly almost touching
  the ground, stretches all four legs wide apart, muscles tensed"）、
  phase two 飞扑（"leaps through the air, opens its mouth wide in a fierce
  biting snap, swings both front paws forward in wide slashing arcs with claws
  fully extended, biting and clawing at the same time, strong exaggerated
  motion"）。GLM 五项全过：准备下压+四肢张开 / 飞扑嘴张撕咬+爪挥 /
  幅度力度更大 / 大小一致无裁切 / 连贯。准备帧高度 204~233（压低明显）。
- **BiRefNet 压低帧丢腿坑（2026-08-06 v6 定稿）**：GLM 复验发现中间帧明显偏小，
  像素统计定位根因——**BiRefNet 对四肢张开/下腹贴地的压低帧把腿部大量识别为背景**
  （f32 腿部仅保留 5%，bbox 高收缩 21%），按 BiRefNet bbox 重建 → 帧变小。
  修复：crop 用阈值 mask(248) bbox（完整狼）+ **alpha = max(BiRefNet, 阈值mask)**
  腿部兜底 + 固定 scale + 加强去污染（亮半透边缘 lum>180 清零）。
  修复后各帧高度 -1%~-4%（之前 -22%），四腿完整，白边 0.00%，GLM 六项全过。
- **飞扑垂直提升 + 速度调整 + 普通撕咬（2026-08-06）**：
  - 空中效果：精灵图层 charge 帧脚底按抛物线提升（起跳 +8px → 空中 +30px → 落地 +4px），
    游戏内无需额外偏移；准备帧脚底保持地面 410；
  - 飞扑速度 -25%：`pounceSpeed = 距离/(chargeMs/1000)`（原硬编码 /1），
    chargeMs 1333 = 原 1s 的 1.333 倍（525px/s vs 700px/s，精确 -25%）；
  - **普通攻击（近距离撕咬）**：`_biteState` 状态机——距离 ≤ biteRange 150 触发，
    6 帧 3×2 小幅前探张嘴咬（无回转、无位移），中段 200~450ms 命中一次，
    无致残/眩晕；命中距离 biteHitDistance 165 须 ≥ 触发范围（否则空挥）。
    攻击决策：近距撕咬优先，中距（150~500）飞扑技能。
- 资产：`black_wolf_idle/walk/run/bite_regular.png` 四张
  512×512、内容高 262 / 脚底 410 / 居中；显示仍 151×151（内容 ~77px，与旧图一致），
  碰撞体积（120×65 / footOffsetY 41）不用动（`black_wolf_pounce.png` 已废弃停用）。

#### 4. H3 视频抽帧必须走 BiRefNet 抠图（2026-08-06 白边教训，已重做）
- **阈值 235 + 羽化 σ0.8 必留白边**：H3 视频背景实测纯白 254~255，但狼体边缘有
  压缩光晕（235~253 灰白）与浅色毛混在一起（帧 68 有 41% 亮像素深达狼体内部），
  阈值顾此失彼：调低留灰白边、调高切浅毛。**半透明边缘像素 80% 亮度>200 即白边**
  （量化判据），修复后必须 <1%。
- **正确做法**：抽帧后逐帧过 BiRefNet（`birefnet-cutout.py`，模型
  `Y:\模型库\ComfyUI\models\BiRefNet`，junction 到 `ComfyUI\models\BiRefNet`）→
  用 BiRefNet alpha 重建 sheet → 边缘反推去污染兜底（白色半透明像素直接清零，
  灰调半透明像素反推前景色）。修复后白边 0.00~0.25%，GLM 复验浅毛高光完整。
- 工具 `h3-loop-spritesheet.py` / `h3-attack-spritesheet.py` 已加
  `--threshold`（默认 248）/ `--feather`（默认 0.3）参数，但**只用于定位/快速预览，
  正式入库一律走 BiRefNet**。
- **攻击提示词必须写"肢体前扑"**：光写 "lunges its head forward, opens jaws" 会被
  H3 理解成只张嘴（v1 实锤）。v2 改成 "drops its chest low, steps its front legs
  forward in a long stride, stretches its whole torso and shoulders toward the
  target, thrusts its head forward with jaws wide open" 后，帧宽 433→512
  （前扑拉伸 79px）、GLM 确认"身体前倾/前腿跨步/躯干前探"。攻击帧抽 10 帧
  （windup→lunge→bite→retract→return），5×2 网格。

#### 5. Phaser displaySize 只在创建时按初始纹理算（2026-08-06 idle 小图根因）
- **症状**：idle 显示小/扁。根因：`_configureEnemyBody` 只执行一次，按创建时
  纹理的帧尺寸算 displaySize；黑狼初始 `_aiState='pacing'` → 创建时用旧
  250×215 pacing 贴图 → displaySize=151×130，之后切到任何 512² 新贴图都不重算。
- **修复**：`GameScene._syncEnemyAnimation` 在 setTexture 后按当前帧尺寸重算
  `setDisplaySize`（spriteSize 语义）；同时 pacing 也统一走新 walk 贴图
  （16 帧慢速 180ms），全状态 512² 显示一致。
- **多贴图混用纪律**：同一敌人的新旧贴图画布尺寸必须统一（本项目 512²），
  否则创建时算的一次性 displaySize 会压扁后续贴图；新增贴图先查初始状态
  用的纹理尺寸。

#### 6. 防守陷阱贴图管线（2026-08-07，世界-122 地面陷阱）
- **范围**：4 类（地刺 spike / 地雷 mine / 减速带 tar / 燃烧区 burn）× F→A 六档 = 24 张，
  入库 `assets/terrain/trap_<type>_<grade>.png`；显示尺寸 70~92 × 50~68（trap-config.js）。
- **视角**：等距地面物件——30° 俯视、顶面可见、平贴地面、单件居中（与掩体 30° 底边
  斜墙同视角体系，但陷阱强调"俯视看到顶面/内部"，不是立墙）。
- **视角定稿（2026-08-07 用户三轮校正）**：陷阱视角基准 = **游戏掩体墙的 2.5D 等距
  30° 地板线**（`front face visible, top surface slightly visible and foreshortened`），
  **不是**障碍物的 2:1 diamond 俯视基准（第一轮错用），也**不是**正俯视/立式桶鼓。
  各类型差异：地刺/减速带/燃烧区天然有立面感，通用视角块即可；**地雷必须按
  "平贴地面的扁平圆盘"写**——`flat round mine lying flat on the ground, seen from a
  30-degree elevated angle, the circular top is a foreshortened ellipse (not a full
  circle), only a thin low side wall is visible below the top rim, low and flat like a
  pancake`（写"standing upright drum/side dominant"会被画成油桶，已否）。
- **提示词模板**：`tools/ai-gen/prompts/trap.md`（风格基准 + 视角块 + 类型×档位主题词 +
  负面词；材质逐档递进：F 木/铁简陋 → A 符文魔改）。
- **生成**：`tools/ai-gen/gen-trap-assets.py`（5080 `flux2-dev-fp8`，默认 24 步；
  支持 `--keys` 小批验证、`--skip-existing` 断点续传、`--timeout` 单张超时）。
  5080 空闲单张 ~56s；被并行任务占用时 10~20min/张，务必断点续传分批跑。
- **抠图铁律**：用 `make-transparent-icon.py`（flood fill，半透明残留 ~0.7%）；
  **不要用 `prep-obstacle.py`（GrabCut）抠陷阱**——白底 AI 出图的浅色主体边缘
  灰边残留 6~37% 超标（掩体深色材质不受影响，陷阱的浅木/金属/火焰必翻车）。
- **验收**：GLM 检查视角/主体/无白边；实机放 4 类 D 级陷阱截图，GLM 确认与地面
  墙壁协调、大小合适、类型可辨识。

#### 8. 掩体墙根土块（Blender 整合建模，2026-08-08 最终定稿）
- **最终方案（用户反复校正后定稿）**：**土块与墙在同一个 Blender 渲染中整合建模**
  （烘焙进墙贴图），土块沿墙底边精确贴合；独立叠加方案（sprite/贴花）已否——
  对不齐墙体、图层混乱。
- **实现**：`render-cover-real.py` 的 `build_wall` 加 `soil` 字段（墙 box 不设 hidden，
  土块一起渲染）：土埂（bankW≈w 铺满整条底边）+ 60 个碎石颗粒（sz 8-16 高低起伏、
  前后错落、bevel 2，前侧 -y + 土埂），程序化泥土材质。
  入库 `obstacle_cover_D*`（D 级 5 变体 × h/v）；GameScene 无独立土块层
  （土块随墙贴图渲染，depth = `_faceDepth` 单一图层，无图层问题）。
- **验证**：实机确认——土块贴合墙斜向底边无错位/悬浮、拼接竖缝墙身无缝、
  拼接处土块连续自然；转角图层顺序后改为 `cornerLayer: 'rightOnTop'`
  （见下方 2026-08-08 修正）。
- **坑**：独立土块 sprite（不同尺寸/位置/图层）必然对不齐墙 + 图层混乱——
  土块必须与墙同渲染烘焙，不能分开建模后游戏层叠加。
- **⚠ 拼接缝隙根因（2026-08-08 实机复现）**：`soil_margin` 默认 0.18 会撑大
    ortho 取景、让墙身贴图缩小（内容 x 215-843 vs 原版 163-856），端帽边缘偏移 →
   水平拼接处露 1-2px 暗缝。土块在墙身 box 内（`bankW`/`halfW` ≤ w）时不需要余量，
   必须设 `soil_margin: 0`——墙身恢复原版尺寸、拼接无缝。渲染后核对内容框
    x 范围（原版 163-856 基准）。
  - **⚠ 用户报“拼接还有缝”先查构建版本（2026-08-08 二次复现）**：源码贴图修好后，
    实机仍报“同一水平线拼合有明显缝隙”，排查发现用户运行的是**旧打包版
    （dist-electron-new 0.198.6，构建于修图前）**——打包版 resources/app/dist/assets
    里的贴图仍是旧内容框（163-860/无土），dev server 才是新图（163-902/带土）。
    结论：**改贴图后必须重新打包**（`npm run build:win`，产物 `dist-electron-new/无限轮回 X.Y.Z.exe`），
    并核对 win-unpacked/resources/app/dist/assets 与源图 SHA 一致；dev 侧用户硬刷新
    （Ctrl+F5）即可。验证工具：`tools/cdp-join-audit.mjs`（带坐标系校验标记 +
    精确定位接缝）+ `tools/join-sim.py`（25 组变体组合确定性模拟，0 缝隙）。
  - **⚠ 上夹角“侵入式叠合”根因（2026-08-08 诊断）**：`_buildBaseRoom` 用
    `faceLen/2`（98.17）当作 face 在边方向上的对称半跨来算首件位置
    （`t0 = -cornerExtend + faceLen/2`），但 COVER_FACE 端点在边方向上的真实投影
    不对称（v 向在 TL/RB 边：A 投影 +69.3、B 投影 −127；h 向反之）→
    转角件 face 实际越过顶点 **73.8px**（意图 cornerExtend=45px），
    两臂在角点叠合 ~147px，即用户看到的“侵入式贴合/图层错误”。
    修正：按真实投影算首/末件 t0/t_last（朝顶点端投影 127），让 face 端点正好
    越过顶点 cornerExtend；`faceLen/2` 假设仅适用于对称 face。
  - **图层顺序 A/B 实测（2026-08-08）**：上夹角 TL(v) 盖 TR(h)（当前 depthBias+0.5）
    vs TR(h) 盖 TL(v)，GLM 对比实机截图认为 **TR 盖 TL 更自然**（砖纹过渡连贯、
    尖角像单层、无明显暗缝；反之转角有暗缝/断层）。叠合区（face 交线上方）图层
    顺序肉眼可辨；下方（face 交线下）两者相同。下夹角 LB(h) 盖 RB(v) 是否也要
    反过来需同样 A/B 复核。验证：`tools/cdp-corner-audit.mjs`（改 e._faceDepth
    即切图层，每帧深度同步读它）。
  - **转角底部透底**：两面墙土带在角点下方不衔接（cap 端纹理提前透明），
    角点正下方出现竖向暗缝/亮地面透出；Blender 土埂/颗粒需覆盖到端帽外缘底角。
  - **✅ 修复实施（2026-08-08 已落地）**：`_buildBaseRoom` 改按 COVER_FACE 端点
    在边方向上的真实投影（朝顶点端 127px / 另一端 69.3px）计算首/末件位置，
    `cornerExtend: 45 → 29`——29 恰好让两臂 face 端点在角点 face 交线交点相接
    （干净斜接、不侵入），四个角全部验证 face 端点精确汇于一点
    （上 (900,1728)、左 (387,1984)、右 (1413,1984)、下 (900,2239)）。
    `cornerLayer: 'rightOnTop'` 上角 TR 盖 TL、下角 RB 盖 LB（A/B 实测右盖左更自然；
    因 face 已斜接不相交，图层偏置实际不再影响视觉）。实机全房间 GLM：四角干净、
    四边无缝。转角底部"透底"实为两墙底边下方的正常房间地板 V 区（土带延伸
    只能减少 ~9% 暴露），非缺陷，D 级贴图保持不变。
    回退：`git reset --hard 11f2d11`（优化前快照）或
    `backup/rollback-corner-20260808_105347/` 文件副本。
  - **✅ 左右下夹角"按土块判定"根因与修复（2026-08-08）**：用户反馈上夹角正常、
    左右下夹角"以地下土块进行碰撞/移动判定"。排查发现：**寻路器（PathFinder 的
    SpatialHash）只建模 WallSystem.walls/trees，有意不纳入 isoSegments**——基地掩体墙
    只注册了 `_coverSeg`（isoSegments），所以怪物寻路把墙当可通行，直线穿墙后由
    MovementSystem 的 WallSystem.resolve 挡停；在直墙段会沿墙滑，在左右下夹角
    （两墙交汇）被卡在墙根土块上抖动。修复：`src/ai/pathfinder.js` 把带
    `_cover` 标记的静态掩体墙段纳入空间哈希（type 'seg'，阻挡口径与
    `WallSystem.canMoveTo` 一致：点到线段距离 < 半径+halfThick），动态段
    （门闸/冰墙无 `_cover`）仍排除；`defense-system.js` 在搭建/拆除/摆放掩体时
    `pathFinder.invalidateCache()`。验证：右墙外→基地的路径由"直线穿墙 2 点"
    变为"绕墙走门洞 9 点"；269 项测试全绿。
  - **✅ 土块推广到 F/E/C/B/A 档（2026-08-08）**：D 级带土贴图验收通过后，用同一
  spec（`cover_integrated_spec3.json`，soil_margin:0 + soil 字段）批量渲染
  5 档 × 5 变体（tex_<grade>.png / tex_<grade>_v2..v5.png），h = fliplr(v)，
  替换 `obstacle_cover_{F,E,C,B,A}_{v,h}/_v2..v5_*` 共 50 张；内容框全部
  163-902 × 87-890（与 D 一致，soil_margin:0 保拼接无缝）。实机换档验证
  （`tools/cdp-grade-soil-check.mjs` 直接 setTexture 换档截四角）：F/A 均墙根
  带土、四角干净、四边无缝。旧贴图备份：
  `backup/cover-soil-allgrades-20260808_115237/`（50 张）。

---

### 阶段性进度总结（2026-08-04：生图标准工作流 + 提示词固化定稿）

#### 本次完成
1. **生图标准工作流定稿**：`game-dev/tools/ai-gen/WORKFLOW.md`——六步全流程
   （定风格→生成→粗筛→视觉验收→抠图入库→清理废案）+ 生成入口矩阵（智谱 API 优先 /
   ComfyUI 兜底 / 远程 5080 主力 / 本地 3080 Ti 兜底 / models.json 模型登记表）+
   各类资产子流程（技能图标 / 装备图标 / 障碍物 / 怪物 / 投射物 / 视频）+
   沉淀坑位清单 + NAS 归置原则。
2. **提示词固化**：`game-dev/tools/ai-gen/prompts/` 提示词库——
   README（拼接顺序 / 权重语法 / 智谱 vs ComfyUI 差异 / img2img 模板锁定规则）+
   8 个固化模板：skill-icon（六边形徽章系列，含 fireball 内容框基准）、
   equipment-icon（style_prefix + 负面词 + 单件强制 + 构图硬性规则）、obstacle、
   monster-sprite、video（MiniMax H3）、cover（世界-122 掩体六档）、
   defense-tower（世界-122 防御塔）、transparent-subject（透明主体纯色底）。
3. **一致性修正**：文首工作流「标准流程」命名由五步修正为六步（实际条目一直是 6 条）；
   障碍物提示词引用改指 prompts/obstacle.md（旧 obstacle-prompt-strategy.md 收敛为跳转桩）。

#### 验证
- WORKFLOW.md 引用的工具路径全部核实存在（当时位于根 `tools/`，现已整体迁入
  `game-dev/tools/ai-gen/`：comfyui-gen.py、models.json、make-transparent-icon.py、
  check-icon-sizes.py、birefnet-cutout.py、verify-eclipse-icons.py、flip-boots-right.py、
  check-components.py、minimax-h3-gen.py、start-comfyui-remote.bat 等）。
- 模板内容全部来自实战沉淀（陨星/暴风雪图标、稀有三套+首饰、沙袋/拒马、陨星 VFX 视频），非虚构。

---

### 阶段性进度总结（2026-08-04 二轮：生图入口优先级调整 + FLUX.2 dev Depth ControlNet 视角锁定）

#### 本次完成
1. **入口优先级调整**：双机 ComfyUI 优先（远程 5080 主力 + 本机 3080 Ti 兜底）→ 本地零成本；
   智谱 API 降级为第三兜底（双机不可用/特殊场景）。
2. **5080 主力模型实机核对并登记**：FLUX.2 dev fp8（`flux2_dev_fp8mixed` +
   `mistral_3_small_flux2_fp4_mixed` + `flux2-vae`）+ FLUX.2 Depth ControlNet
   （`FLUX.2-dev-Fun-Controlnet-Union`，Depth/Canny/HED/Pose 单文件多模式）已装；
   `tools/ai-gen/models.json` 登记 `flux2-dev-fp8`（24 步/CFG 3.5）+ `flux2-dev-depth`（默认强度 0.75）。
3. **客户端升级**：`tools/ai-gen/comfyui-gen.py` 新增 `--control-image` / `--strength` 与
   ControlNet 工作流分支（Flux2FunControlNetLoader/Apply），深度图锁视角/方向；
   官方 BFL JSON 结构化提示词（camera 块）作双保险。
4. **兼容修复（已应用 2026-08-04）**：flux2fun-controlnet v1.1.0 的
   `timestep_zero_index` / `multigpu_clones` 两处补丁与 comfyui-mesh Icarus stub 补丁
   已在 5080 替换并重启（原文件备份 + 修复版在 `tools/ai-gen/remote-patch/`，NAS 同步一份）；
   Mesh 跨机出图实测通过（`flux2-dev-mesh`，8 步 turbo，Turbo LoRA 两端本地加载）。
5. **文档同步**：WORKFLOW.md（入口矩阵/§1.5/第 2 步）、prompts/ 8 个模板补深度锁用法、
   SKILL.md v2.1、CHANGELOG。

#### 验证
- 远程 5080 在线（192.168.3.142，RTX 5080 16GB，ComfyUI 0.30.0），模型/节点清单实机核对
  （Flux2FunControlNetLoader/Apply 存在，ControlNet 文件在 models/controlnet）。
- `tools/ai-gen/comfyui-gen.py --list-models` 通过；`flux2-dev-mesh` 跨机实测出图成功
  （5080 Icarus + 3080 Ti Daedalus，8 步 turbo，服务端每步 decode~140ms/fwd~9ms/enc~650ms）。

---

### 树木等距素材管线（2026-08-15 两轮定稿，新树/植被素材按此开展）
> 2026-08-16：世界-122 树木资产/脚本已全删（荒漠化改仙人掌，见第 7 区）；本条目
> 保留为通用「白模深度锁视角 → 生图 → 抠图」管线参考（树不再入库，别按它补树）。

**管线（白模深度锁视角 → 生图 → 抠图入库）**
- 白模：`_blockout_specs/tree_iso2_<species>.json`（trunk 圆柱 + 树冠球/层叠圆柱，
  **elevation 30** = 防御塔/掩体同视角；billboard 资产 ≤12°）→ `blender-depth-render.py`
  出深度图（输出走 %TEMP% ASCII 路径）。
- 生图：`gen-tree-iso2-assets.py`（flux2-dev-depth @5080，24 步 cfg 3.5）。
- **画风锚定**：写实 = `photograph of a real tree` + 自然低饱和 + 树皮/枝叶细节
  （flux2 类型不吃 negative 词，全靠正向锁定；v1 卡通风被用户退回——卡通/写实分歧
  必须首轮小样验收）。5 变体用**树种区分法**（白杨/橡树/白桦/枯树/松树）——同一形态族
  （高瘦）+ 物种差异，比形状差异更自然。
- **抠图铁律**：`ai-asset.py cutout` 子命令经 rmbg_cutout CLI 只出灰度掩膜（会把掩膜当
  成品入库）；入库必须进程内 `predict_alpha` 合成 RGBA（rebuild-h3-birefnet 同款），
  且整个进程跑 ComfyUI venv python（torch + ComfyUI-RMBG）。
- 入库：`process-tree-iso2-assets.py`（紧身裁剪 + 底部树干保留检查 + 旧图备份
  `.bak-tree-*` + 同名键覆盖 + 打印 ISO_WALL_GEO 注册值）。
- **摆放缩放**：isoVisuals 件显示缩放 = `obstacleH / geo.h`（摆墙编辑器口径）；裸推 piece
  不给 scaleX 会按贴图原尺寸放大数倍（实机探针实踩）。
- 工具链：`gen-tree-iso2-assets.py` / `process-tree-iso2-assets.py` /
  `_blockout_specs/tree_iso2_*.json`；v1 等距卡通风版备份 `.bak-tree-iso1-20260815/`。

### ⭐ 地面无缝纹理统一入口：floor-asset.py（2026-08-16 定稿，泥/沙等平材质地面一律先走这里）

平材质地面（泥/沙/干土等）**禁止用「独立菱形石板 + 随机镜像」拼接**——草地砖靠草苔
盖住接缝，平材质无细节可遮，会露黑边/硬接缝/无法 8 向循环。改走**无缝连续纹理**：

```bat
python tools/ai-gen/floor-asset.py mud  --out assets/terrain/floor_mud_seamless.png  --seed 9001
python tools/ai-gen/floor-asset.py sand --out assets/terrain/floor_sand_seamless.png --seed 9101 --desat 0.5
python tools/ai-gen/floor-asset.py road-stone --out <scratch>/road_stone_seamless.png --seed 122819
```

一条命令 = `comfyui-gen`（prompts/floor-seamless-*.txt，低饱和提示词）→ `make-seamless.py`
（偏移叠融四边环绕）→ `desaturate-texture.py`（默认 mud 0.55 / sand 0.5 /
road-stone 0.48）。建筑外围道路不能直接使用方形无缝图：继续调用
`build-building-road-tiles.py <seamless.png> assets/terrain/building_road_tiles.png`，
由脚本生成4帧128×64、严格2:1的透明菱形；AI只负责材质，不负责格网轮廓。

**楼梯灰黑砖补充（2026-08-19）**：墙材/砖材输出不能只相信提示词中的seamless声明；
`make-seamless.py`后必须实际量首尾边差。若任一方向仍明显不连续，使用
`enforce-seamless-edges.py --band 128`在边缘带内融合对应像素，验收要求H/V seam均为0。
远程5080被其它会话长任务占用时，不中断对方队列；本机已有Klein 4B/Qwen/Flux2 VAE，
可在独立端口用`flux2-klein-4b-nolora`兜底，完成后只关闭本轮精确PID。

**楼梯白灰砖（2026-08-19）**：提示词`stair-brick-whitegray-seamless.txt`，
本机Klein 4B无LoRA、seed 122820、1024×1024、12步；原图均值约204，经0.95亮度校正、
`make-seamless.py`和128px周期边缘融合后，再走`enhance-stair-brick-texture.py`
（contrast 2.4 / lift 15 / periodic sharpen 0.8）强化浅砖面和深灰砖缝；最终纹理均值约204、
标准差约49、H/V seam均为0。Blender材质Value=1.10，八张成品亮度约116、
标准差12.0~15.1，避免纯白过曝与低对比糊团。

渲染侧（dungeon-floor-texture.js `bakeDungeonFloorChunk`，`profile.continuous=true`）：

1. **连续铺贴**：整张无缝纹理按**世界坐标对齐相位**重复（跨分块/跨方向天然无接缝），
   不做单砖镜像——8 向循环自动满足；
2. **30° 等距压缩**：纵向按 `textureScaleY ?? 0.5774` 压缩（SKILL 地板标准），
   否则像垂直俯视；沙地补丁内纹理同压缩；
3. **侵入式分块拼接**：`applyDungeonFloorChunked(..., pad=3)` 烘焙四周扩 3px、
   精灵原位重叠，盖住分块并排的亚像素缝隙（细线/黑边）；
4. **沙地软边补丁**：`sandPatches` 双八度值噪声不规则边界 + 宽淡入淡出
   （⚠ 补丁画布内必须**循环平铺**纹理——单张画不满会露直角直切边，2026-08-16 真机踩过）；
5. **草/植被点缀**：独立贴图（prompts/grass-tuft.txt，俯视径向对称）固定朝向 `deco`
   烘焙，不做 X/Y 翻转——草不画进砖里，8 向循环永不会把草转反。
   - 2026-08-16 v3 荒漠植物定稿（v1 糊团假绿、v2 圆团正俯视高饱和，两轮均被退回）：
     **视角铁律——点缀植物不是正俯视圆团，是"微俯 30° 侧看 + 直立株型"**
     （对齐「等距投影素材规范」：立着的垂直站、顶面走 30°；billboard 资产 ≤12°~30°，
     正俯视径向提示词必出圆团，勿用）；**画风锚 = 树木管线同款** `photograph of a real
     desert plant` + muted/desaturated（卡通/高饱和首轮必退）；世界-122 沙漠主题用
     束草/蒿灌木/龙舌兰/风滚草四物种，白底出图（避开品红底——v2 实测品红底抠图
     7~15% 像素带 R/B 溢色粉边，检测 `(r>g+25)&(b>g+10)`）→ `process-desert-plant.py`
     （BiRefNet 进程内抠图 + `--desat 0.7` 对齐低饱和 + 紧身裁剪 + 256²，ComfyUI venv
     python 运行）→ `deco_desert_1~4.png`（BootScene 注册，scene-manager deco.textures）。
     中间件在 scratch `desert_*`；v2 品红 despill 修复件留 scratch `grass_v2_*` 备用。

场景配置参考（scene-manager `_loadScene8`）：`{ tiles:['floor_mud_seamless'],
continuous:true, textureScaleY:0.5774, sandPatches:{texture:'floor_sand_seamless',
perChunk:6, size:760}, deco:{textures:['deco_grass_1','deco_grass_2'], perChunk:28, size:110} }`。

### Blender 建模渲染管线（render-factory-real.py，2026-08-16 定稿）

#### World-122 固定地基 + AI 主体管线（2026-08-20）

对必须锁定地基、接地线与二轴测轮廓、但主体细节适合生图的建筑：先用
`blender-depth-render.py`（可用 `box`、`prism`、`cone` 等白模图元）输出深度约束，再以
`comfyui-gen.py --model flux2-dev-depth --steps 48 --control-image <depth> --bg-color #00FF00`
生成**仅建筑主体**。随后依次运行 `key-world122-building-body.py`（从画布边缘抠除绿色背景）、
`mask-world122-building-body.py`（以白模轮廓裁掉模型擅自添加的地台/投影），最后用
`compose-world122-building-preview.py` 将主体与既有固定大理石地基合成审批预览。

地基永远是独立运行时图层，不能烘焙进主体 PNG；审批前拒绝含 AI 地台、地形、投影、地平线或
超出白模轮廓的候选。通过预览确认后才将透明主体导入 `assets/terrain/`。

直接渲染成品贴图（不再走「白模深度 → AI 生图」两步），适合几何明确的建筑/道具：

```bat
"E:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background --factory-startup ^
  --python tools/ai-gen/render-factory-real.py -- _blockout_specs/<name>.json assets/terrain/<name>.png [--slide 0..1]
```

- **Spec**（`_blockout_specs/<name>.json`）：`primitives` 支持 box / **prism**（三角坡屋顶），
  每件 `material`：`wall`（主贴图 tex）/ `interior`（黄→白渐变自发光，门洞灯光）/
  `window`（暖黄自发光）/ `dark`；`plates + slide` 做横向滑门（`--slide 0` 关 / `1` 开，
  滑入两侧立柱窗口）；`lighting` 覆盖环境/主光/补光/曝光（暗了调这里，别后处理）。
- **视角**：elevation 30 + `rot.z 44.8`（与掩体/工厂同口径接地，底部菱形接地线）；
  正面平视建筑（仓库/祭坛类）才用 elevation 5 + rot 0。
- **坑① AgX 洗黄**：EEVEE 默认 AgX 视图变换会把亮黄（255,200,80）压成米白——渲染器
  已固定 `view_transform = Standard`，窗户/门洞灯光才保得住黄色。
- **坑② 前突组件投影右移**：墙面 44.8° 旋转下，门/窗等 `ly≠0` 前突件世界 X 会整体偏移，
  投影偏出画面中央——按 `lx' = lx + ly·tan(44.8°)` 补偿（或直接量投影位置摆）。
- **入库显示尺寸铁律**：成品**必须先紧身裁剪到内容框**再入库——方形画布带透明边时，
  按内容宽高比设非方形显示（如 220×183）会把方形画布拉伸变形（实机实踩）。
  裁剪后内容占满画布，再按 `displayW` 固定、`displayH = W/宽高比`、
  `footOffsetY ≈ displayH/2`（内容占满画布时脚底即贴图底边）。
- **滑门动画**：16 帧 `--slide n/15` → `compose-hamster-hut-door.py` 合成 4×4 精灵表 →
  BootScene 注册 open（0→15）/close（15→0）→ 实体门状态机（opening→spawn→closing）。

**采样既有贴图（基地核心成功案例，非常精准）**：重构基地时**优先采样仓库里已有的高质量
贴图**而不是重新出图——基地核心 = 立方体 + 顶部压顶 + 扁平底座，直接贴
`scratch/world122/raw/tex_altar.png`（白底大理石 + 灰纹 + 暖色点缀，祭坛同源），
`spec.lighting` 加亮（ambient 0.66 / sun 1.45 / fill 110 / exposure 0.32）后大理石亮度 ≈183；
入库 `assets/terrain/defense_base.png`，`DefenseBase.spriteCfg = { size:220, sizeH:183, footOffsetY:92 }`。
教训：上一版「AI 直出大理石 + 祭坛式建模」用户验收不过，这版「采样祭坛贴图 + 立方体底座」
一次通过——核心视觉有现成素材时，先采样再考虑出图。

**宝箱（主神空间仓库 NPC，2026-08-16 已退回原版）**：多轮 3D 建模（立方体+拱盖、纯白
大理石贴图等）用户均不满意，**最终退回仓库 NPC 原贴图**（`warehouse.png` ==
`chest_opened.png`）与原配置（size 180 / footOffsetY 64）。保留的可复用管线沉淀：
render-factory-real.py 的 cylinder 图元（放倒半圆柱，显式实心端盖 + UV + 法线一致化）、
spec.lighting / roof / lid 材质。教训：核心视觉反复不满时，及时退回原版，管线能力保留
供后续其他道具复用，不为单个资产无限内耗。

**仓鼠兵营（2026-08-16，黑砖兵营案例）**：**世界-122 建筑一律 elevation 30 + rot.z 44.8**
（与掩体/工厂/防御塔同口径菱形接地线，勿用仓鼠小屋的 rot 0 正面版——用户验收口径）。
主体 box 260×150×90 + 坡屋顶 prism 280×170×68 + 四角细长塔台（前 36×36×175、后 36×36×190），
所有图元 rot [0,0,44.8]；前突件（门/窗/塔）按坑②补偿 `lx' = lx + ly·tan(44.8°)`
（前塔 -205.5/70.5、后塔 -18.5/153.5、门 -77.4、窗 -128.4/-24.4），保证屏幕投影对称。
**后右塔（153.5,68）投影成独立高柱已删**——44.8° 布局下该角塔在屏幕右上独立矗立，
视觉像多出来的柱子；三塔（前左/前右/后左）+ 主体更稳。
**删"脱离主体外"的塔（v5 纠错）**：用户要删的是**脱离在房屋主体外面**的塔
（前左 -205.5,-68 → 世界 (-97.9,-193.1) 悬在房前），不是屋后那根（后左 -18.5,68）。
先误删后左又被纠正恢复；最终保留 前右(70.5,-68) + 后左(-18.5,68) 两座贴主体塔，
删除 前左 + 后右(153.5,68) 两座脱离主体外的塔。
黑砖贴图走 `comfyui-gen.py --host 192.168.3.142 --model flux2-klein-4b-walltex`
（1024×656，seed 固定，暗色 36.5 / 白边 0% / 砖格 FFT 峰强），入库
`assets/terrain/hamster_barracks.png`（656×623，footOffsetY≈312）。
屋顶红瓦：`roof_tex = hamster_barracks_roof_tex.png`（同管线红瓦 prompt，seed 12202，
RGB 151/87/70 红主色）+ 屋顶 prism 材质 `roof`（墙身仍是黑砖 wall）。
**屋顶只坡面红瓦、山墙黑砖 + 瓦行平行檐口**：render-factory-real.py 的 make_prism 现在
按面分材质槽（端三角/底面=槽0 墙，坡面=槽1 屋顶）+ 新增 prism_uv（坡面 u 沿 X 瓦行
平行斜边、v=z/H 沿坡度；山墙平面映射）——`material:"roof"` 的棱柱自动走双槽+坡面 UV，
其它材质棱柱兜底复位单槽。
**山墙端面 UV 必须 u 沿 Y**（端面在 Y-Z 平面，u 沿 X=法线方向会让纹理坍缩成单列竖带
拉满三角——黑砖"错误拉伸"根因，2026-08-16 v2 修复）；红瓦贴图**按斜面长宽比重新生成**
（1280×500≈2.57:1，瓦行平行长边；旧 1024×656 平铺到 280×109 斜面会把瓦片横向拉长 1.6×）。
**斜面加厚 + 瓦行平行验证（v3/v4）**：棱柱 H 68→76（实心楔，屋顶更厚实）；
瓦行方向用**横条纹测试贴图**实证：投影后条纹角 -26° == 屋脊/斜边投影角 -26.4°
（屏幕斜率公式 Δsy=-0.5·Δy-0.866·Δz，别误用 cos30 当水平分量）→ 瓦行确实平行斜边。
**不要用"檐口圈"加厚（v4 用户纠错）**：棱柱下垫红色厚板会在斜面下方形成一圈屋檐，
用户要的是斜面本身加厚。`roof_slab` 厚斜板图元（顶/边红瓦、底黑砖，两块在屋脊相接）
已实现但易与塔台重叠、黑底可见，暂回归棱柱实心楔；要厚板造型需先调塔台布局。
投影坑：前塔尖顶（z 高于屋脊但 y 更靠前）会被屋顶前坡遮挡——2.5D 前低后高投影下，
「塔顶高于屋脊」≠「屏幕上高于屋脊」，塔台做平顶最稳。

---
