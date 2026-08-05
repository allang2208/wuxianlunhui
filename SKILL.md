# Sprite Pipeline 技能文档

## 版本: 2.1

## ⭐ 识图优先入口：GLM-4.6V 识图系统（2026-08-03 构建，读图一律先走这里）

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

## 本地 AI 出图工作流（双机 ComfyUI 优先 + 智谱 API 兜底 + GLM-4.6V 验收，2026-08-04 二轮调整）

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

### 生图入口（优先：双机 ComfyUI；智谱 API 第三兜底，2026-08-04 调整）
- **远程 5080 主力（默认）**：`python tools/ai-gen/comfyui-gen.py --host 192.168.3.142 --model flux2-dev-fp8 --prompt "..." --out out.png`（命令相对 game-dev/ 仓库根目录执行）
- **固定视角/方向**：`--model flux2-dev-depth --control-image <深度图> --prompt "..."`（见 WORKFLOW §1.5）
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

### 环境（ComfyUI 双机系统，2026-08-04 二轮）
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

### 标准流程（六步）
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

### 技能贴图要点（逐步沉淀，2026-08-03 首版）
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

### 视频生成（MiniMax H3，远程 5080，2026-08-04 落地）
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

### 素材/模型/备份归置（NAS Y:\，2026-08-04）
- Y:\ = NAS 映射盘（\\192.168.3.2 共享，SMB），素材库双机共用；目录约定：
  - `Y:\素材库\`：原始素材/参考图
  - `Y:\工作\无尽轮回\scratch\`：AI 出图/视频中间产物与候选（生成脚本默认输出地，定稿才进仓库）
  - `Y:\模型库\ComfyUI\models\`：大模型归档（双机共用；冷模型可 junction：
    `mklink /J models Y:\模型库\ComfyUI\models`，热模型留本机保证加载速度）
- **版本控制走 GitHub**（origin `allang2208/wuxianlunhui`），`tools/ai-gen/backup-to-nas.ps1`
  保留为手动可选备份，不做定时
- 原则：仓库只保留被引用资产；候选/废案/大视频一律落 Y:，E: 只放源码+入库资产

### 多视图/多件排列硬筛（2026-08-03 沉淀：SDXL 帽子/法袍顽固出多视图）
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

### 落地范例
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

## 世界-122 防守地图（雏形，2026-08-04）

主神空间传送门 →「世界-122」（scene8，原沼泽地改名）。防守玩法第一版，纯代码零新素材。

### 基地区域（scene-manager `_loadScene8`）
- 沙袋矩形围栏（1508/2588 × 1780/2820）：北/南边横向沙袋、西/东边旋转 90° 沙袋，
  两端延伸封死四角；**南侧留真实缺口当门口（≈352px）——不要摆门件**：门贴图
  （hub_gate/swamp_gate）可通行门洞只占贴图跨度 8%~21%，按门口尺寸摆会堵死入口。
- 沼泽柴墙三瓦片后墙（完整落在基地北侧，30° 地板线）+ 拒马门口内侧路障。

### 刷怪波次（`src/world/defense-system.js`）
- 边界 8 个刷怪点；`MONSTER_POOL` 按「类型 × 权重」加权随机生成，**只生成可移动怪物**
  （站桩：矿洞/墓碑/煮锅/集合体排除）；波次随用时成长（HP +16%/波、攻击 +8%/波、
  数量递增、间隔缩短有下限、场上存活上限 40）。
- 怪物标记 `_preferDefenseTargets = true` → 只锁定基地/防御塔（`PerceptionSystem._isValidTarget`
  与 `Enemy._findNearestPlayer` 已加守卫），不追玩家；基地核心被摧毁 → 防守失败、停波次。

### 防御塔（DefenseTower，复用 Combatant）
- 独立装备栏：背包内**远程武器、手枪除外**（bow/pkm/akm/qbz191/qjb201/shotgun/energy_lmg）；
  弹道/开火特效直接复用 `Combatant.fireProjectile` + `EffectFactory` 枪口火焰/弹壳 +
  `GameScene.playMuzzleFire`（不需要新素材）。
- 每发伤害 = 武器基准 × 玩家六维加成 × (1 + 0.22×(等级−1))；升级=金币（120×1.55^(L−1)，
  满级 10），同时提升耐久；点塔弹出面板（装载/卸下/升级），卸下归还背包。
- 塔渲染走 `_syncNeutralEntities`（spriteCfg 贴图复用：石柱/祭坛，`sizeH` 支持等比非方形）；
  深度按脚底 Y 参与墙体排序。**2026-08-04 生图入库**：防御塔专用贴图
  `obstacle_defense_tower.png`（基座 + 上方机械臂空置武器挂载点），塔 spriteCfg 已切换。

### 掩体（DefenseCover，可被攻击的防御墙段，2026-08-04）
- **生图**：dev+mesh 批量（`tools/ai-gen/gen-world122-assets.py` + `prompts/cover.md`），
  F→A 六档 × 水平摆(_h)/垂直摆(_v) 共 12 张；视觉基准=游戏墙体 30° 底边。
- **斜向坑**：FLUX.2 不区分 h/v 斜向（全部产出 "/"）→ 处理脚本将 _h 组水平镜像归一为 "\"
  （`tools/ai-gen/process-world122-assets.py`）；入库 `assets/terrain/obstacle_cover_<grade>_<orient>.png`。
- **数值**：hp = F400/E700/D1100/C1600/B2200/A3000，**def/mdef 均为 0**（怪物全额伤害）；
  `_isDefenseStructure=true` 供怪物锁定攻击、`immovable=true` 不可击退/位移、
  `_noShadow=true` 无脚底阴影；碰撞 footprint 见 `COVER_FOOT`（198×133、thick=26）。
- **摆放**：基地菱形房预置（见下节「路线 B 最终管线」）；玩家 B 面板自行加建。

### 掩体最终管线（路线 B）与基地菱形房 v2（2026-08-05 定稿）
- **素材**：Blender 完整 box 230×52×150 绕 Z 44.8°（中段底边斜率 −0.4976）+
  AI 材质纹理（36 步、bump 0.25、无阴影），透明背景零抠图；入库 1024×1024，
  显示 260×260（aspect 1.0），`h = flip(v)`。
- **几何统一**（`COVER_FACE`，6 级完全相同）：v: A(−88,−21)→B(88,−109)；
  h 镜像 A(−88,−109)→B(88,−21)。face 线 = 墙段接底线，**拼接/碰撞一律用 face**；
  完整 box 实心端帽（端面宽 ≈52），深度锚点 = max(face 端点 y)+12。
- **自然贴图重做（2026-08-05）**：旧材质“生硬、塑料感”→ 提示词强化手凿/风化/
  碎裂不规则边缘（`gen-cover-textures.py` THEME+TAIL），36 步批量重出 6 级纹理
  → Blender 重渲染 → `prep-cover-render.py` 复标（几何不变，face 端点微调 −25/−112→−21/−109，
  全部一致）→ 备份 `.bak.natural` 后替换 assets（v 原样、h=flip(v)）。
- **方格砖墙改版（2026-08-05 同日，用户指定“参考原来的直墙”）**：掩体材质从乱石堆
  统一改为**规整方格砖墙**（横竖对齐砖块网格 + 均匀细砖缝，视觉对齐 wall_straight），
  6 级按主题区分（F 旧灰砖 / E 砖+沙袋 / D 标准暖灰红砖 / C 混凝土砖+钢板角件 /
  B 深色砖+铆接钢板 / A 暗色魔纹砖）；提示词以 `regular square brick grid pattern,
  rectangular bricks aligned in neat rows` 为骨架，仍带碎裂边缘/磨损，保持无阴影平光；
  旧自然版备份 `.bak.brick`。校验：FFT 砖缝周期性（新 D 39px/46px 峰值强于直墙基线）
  + GLM 局部放大确认网格 + `audit-perspective` MIRROR 对。
- **Windows 中文路径坑（2026-08-05）**：Blender 的 `bpy.data.images.load` 不支持
  非 ASCII 路径（项目/NAS 路径含中文 → "No such file or directory"）；SPEC/纹理/输出
  先复制到 `%TEMP%/world122-cover`（ASCII）渲染完再拷回（`render-cover-batch.py` 已内置）。
- **拼接规则**：相邻件 face 沿走向重叠 `SNAP_OVERLAP=40`px（≥ 端帽宽，只叠不缺），
  即沿墙步长 = faceLen(196.33) − 40 ≈ 156.33px；镜像后吸附方向判定
  `dir = dot>=0 ? -1 : 1`（左/右外接都向既有件重叠）。
- **菱形房 v2 算法**（`_buildBaseRoom`，与建筑面板吸附同源）：每边 n 件均布，
  覆盖 [−cornerExtend, len+cornerExtend]（cornerExtend=45，转角由相邻两边端帽互叠），
  n = ceil((len+2·cornerExtend−faceLen)/step)+1；openEdge 边中点的开放带内的件
  face 命中即跳过 → 天然形成居中门洞（本房 RB 边 ≈270px，门柱底边与墙线共线，
  无需旧版 doorAlignY 精调，置 0）。
- **校验**：`tools/render-defense-room.py`（FACE_OVERLAY=1 画 face 线做像素连续性校验）
  + `tools/cdp-defense-audit.mjs`（实机截图 + 深度/遮挡审计）；渲染与精灵映射同源
  （display 260×260、中心 (x, y−sizeH/2)、底边中心 (x,y)）。

### 防御塔贴图视觉基准（2026-08-04 二轮核验定稿）
- **建筑/道具一律正面平视 billboard + 平底**（祭坛/仓库/沙袋/拒马基准）；墙体才是 30° 斜底边
  （墙段专用）。塔/建筑贴图**禁止 45° 等距俯视（可见顶面）**——首版 A 图因此返工。
- **机械臂武器挂载点必须空**：主体写 `empty circular flange socket with no gun`，负面词补
  `gun barrel, cannon, rifle, machine gun, weapon attached`——首版臂尖带枪管状突起被否。
- 提示词模板见 `prompts/defense-tower.md`；产物 `assets/terrain/obstacle_defense_tower.png`
  （正面平视、基座台阶+上方机械臂空法兰挂载座）。
- **工具位置**：生图/抠图工具统一在 `game-dev/tools/ai-gen/`（版本化），
  批量入口 `gen-world122-assets.py`、后处理 `process-world122-assets.py`。

### 防御塔机械臂 360° 旋转 + 武器挂载（2026-08-04 实现）
- **拆臂**：行剖面定位塔顶臂区 → 独立臂贴图（枢轴=塔顶中心、臂尖=挂载点、自然角
  =atan2(臂尖−枢轴)）；基座抹臂区。几何统一存 `DEFENSE_TOWER_VISUAL`（defense-system.js）。
- **渲染**：GameScene `_syncDefenseTowers` 三层——基座静态；臂 `rotation = aimAngle − 自然角`
  绕枢轴 360°；武器锚臂尖、`rotation = aimAngle`。
- **武器朝向铁律（玩家同口径）**：`rotation = 瞄准角`；朝左（|角|>90°）用 **flipY** 防倒置
  （禁 flipX+π——方向对但贴图倒，实机截图"枪口与臂不一致"根因）；按高度等比 setScale。
- **塔 AI**：`aimAngle` 最短弧平滑（有目标 9 rad/s、回位 4 rad/s）；枪口=臂尖世界坐标
  （弹道与视觉同源）；无武器时臂空转。
- **实机验证工具**：`tools/cdp-defense-tower.mjs`（无头 Edge+CDP，截图 + 控制台错误采集）；
  Edge profile 必须放 vite 监听目录外（防 EBUSY）。

### 新障碍物碰撞体 + 图层（2026-08-04 定稿）
- 掩体/塔入库后必须补 `ISO_WALL_GEO` 注册：`category:'obstacle'` + `editor` 显示名
  （摆墙编辑器障碍物类自动上架）；foot=底部 15% 带实测（矩形 footprint 碰撞）；
  obstacleH=默认显示高度（掩体 260 宽等比、塔 262）；depth 走 obstacleDepthOf 自动。
- 纯视觉层（防御塔机械臂）**不注册碰撞**——注册会让旋转臂带静止碰撞、挡弹道。

### 世界-122 建筑面板（B 键，2026-08-04 实现）
- **入口**：仅 scene8（世界-122）B 键开关；复用摆墙面板 CSS（wall-editor-panel）；
  面板打开时置 `Game._buildMode`（input.js 鼠标/按键交给编辑器，与摆墙同守卫）。
- **物品**：`BUILD_ITEMS`（防御塔 300 金 + 每级掩体**仅一个条目** `cover_<g>_v`，
  名称 `掩体·<g>级`，不再分水平/垂直；F 键镜像即得水平 "\" 向——贴图/碰撞/face 线
  全部跟随镜像，2026-08-05 简化）；
  点选 → 鼠标幽灵预览 → 左键放置扣金币（GoldManager）→ 生成真实实体
  （DefenseTower 入 towers 数组；DefenseCover 带 HP/可被攻击）。
- **变换约束**：不能缩放；只能镜像调方向（F/按钮）——塔=基座 flipX，掩体=实体 `_facingLeft`。
- **校验**：地图边界 + `WallSystem.canMoveTo` + 与已有建筑距离 ≥70px；右键/Esc 取消。
- **CDP 验证铁律**：动态 import 必须用 performance 资源表里带 `?t=` 的真实 URL
  （否则拿到重复模块实例，singleton 不同步）；先等页面稳定再点官方开始按钮。

### 世界-122 布局与刷怪（2026-08-05 定稿）
- 基地核心在**左端**（900,2048），玩家出生在其左 140px（760,2048）；
  **scene8 不再生成返回主神空间传送门**（portal_return 已删，玩家用菜单离场）。
- 基地菱形房由 `DefenseSystem.setup → _buildBaseRoom()` 预置（2026-08-05 v2，
  可被攻击掩体墙，def/mdef=0）：外接 1024×512（rx512/ry256，墙底边斜率 0.5）；
  **每边 4 件 D 级掩体**，face 线相邻重叠 40px、边链两端各越顶点 45px 让转角端帽叠盖；
  RB 边中点留居中门洞（沿边 ≈270px）。布局参数在 `DEFENSE_CONFIG.room`。
- 玩家仍可用 B 面板加建防线（防御塔 + 六档掩体，只能镜像不能缩放）。
- 刷怪点全在**右端尽头**（x≈3936/3736 两列 7 点），怪物自右向左进攻。
- 刷怪节奏：常规流 = 普通怪池加权（zombie/miner/fat/dog/wolf/spitter/flySwarm）；
  **30s 精英**（lantern/oreSpider/wizard/knight/maggot/mutant3，HP×1.4）、
  **90s 领主**（foreman/shounao/flyHand/witch，HP×2.8），在普通流之上额外生成；
  精英/领主生成有飘字+音效提示；等级成长沿用波次 HP/攻击倍率。

### ControlNet 深度锁视角（2026-08-04 实测定稿）
- **入口**：`flux2-dev-depth` + `--control-image <深度图>`（单卡 5080，不依赖 mesh）。
- **铁律：FLUX.2 非 mesh 路径必须用引导采样**（FluxGuidance+BasicGuider+
  SamplerCustomAdvanced+RandomNoise）；旧 SamplerCustom+cfg 出**全黑图**
  （2026-08-04 已修进 comfyui-gen.py）。
- **LoRA 归属**：Klein 训练的 LoRA（3072 维）只能挂 `flux2-klein-4b`；挂 dev/depth
  （6144 维）会 `double_blocks.*.txt_attn.proj` 形状不匹配报错。
- **深度模板**：手绘剪影（`_depth_templates/`）即可稳定锁"正面 billboard、平底、居中"；
  实测 10 组件 9/10 视角稳定；**宽扁平地类（农田）需模板加前景高度**，否则会被读成俯视。
- **复用**：`gen-depth-test-assets.py`（批量）+ `make-depth-templates.py`（模板生成）
  + `depth-extract.py`（从参考图提真深度，HF 下载可能超时，剪影优先）。

### 朝向（水平/垂直）经验（2026-08-04 定稿）
- ControlNet 深度**锁视角/剪影大形可靠，锁细节朝向不可靠**：枯树/战旗等带非对称细节的
  模板，h/v 生成结果仍同向（镜像相似度 Δ≈0），模型默认朝向覆盖模板细微差异。
  ⚠ **2026-08-05 白模实测部分推翻**：该结论基于 2D 手绘剪影模板；改用 Blender 3D 白模
  深度（`blender-depth-render.py` + `_blockout_specs/tree_dead.json`）后，枯树主干+
  右侧主枝的非对称朝向被忠实锁定（`scratch\test_tree_dead_01.png`）。原因推测：真实 3D
  深度的前后遮挡/亮度台阶比 2D 剪影的形状差异信号强得多。细微朝向仍建议镜像兜底，
  但主枝级朝向可用白模锁定。
- 可靠双方向做法：**入库后水平镜像**（掩体 `_h/_v` 同款）或运行时 `flipX`；
  不要在模板里赌细微非对称。
- **2026-08-04 首轮 18 组件 × 2 批量因"风格/角度不一"被用户删除**（仓库/NAS/注册全清）。
  重做采用"锚点派生"路线：先定一张满意视角/朝向的图 → 同族 img2img 低 denoise
  从锚点生成（构图/姿势继承）；攒够系列后训风格 LoRA，摆脱逐张参考。

### 视角标准基准（2026-08-04 全量审计定稿）

> 审计方法：GLM-4.6V 只用于"正面 vs 俯视 vs 侧视"粗分类；**30° 斜底边必须以
> 代码几何（ISO_WALL_GEO base/face 斜率）或像素斜率为准**——GLM 读斜边不可靠。

| 形态族 | 标准 | 标准件（可当锚点/参照） | 判定要点 |
|---|---|---|---|
| 墙段/掩体 | **30° 斜底边**（\\ 或 /） | wall_straight、swamp_wall_straight、12 张掩体 | 底边斜率 0.49~0.57（ISO_WALL_GEO） |
| 道具/障碍物 | **正面平视 billboard、平底、居中** | sandbag、barrel、pot、pillar、barricade | GLM 正面 + 像素平底 |
| 建筑/塔 | **正面平视 billboard、平底** | npc_altar、npc_warehouse、防御塔 | GLM 正面 + 像素平底 |
| 角色/怪物 | 侧视 billboard 精灵 | 现有敌人贴图 | 侧视全身体 |
| 地板 | 30° 等距菱形 | hub_brick、swampbrick | 地板线 30° |

- **问题件记录**：obstacle_woodpile（GLM 非单件居中，待复查/重做）；
  旧塔 45° 等距版已重做；宽扁道具（农田类）深度模板易出俯视，需前景立墙高度。
- 新素材入库前：先判形态族 → 对照对应标准件 → GLM 粗分类 + 像素/几何校验。

### 后续打磨方向（未做）
- 波次/Boss 波/经济平衡数值；塔血量被摧毁后重建/出售；怪物分路（多入口）与减速/范围塔；
  塔面板换弹/弹药显示；防守胜利结算（撑过 N 波）；**防御塔机械臂上的武器贴图挂载渲染**
  （需标定臂尖挂载点 + GameScene 塔武器 sprite 叠加）；D 级石垒底边不规则，后续可精修。

## 阶段性进度总结（2026-08-04：生图标准工作流 + 提示词固化定稿）

### 本次完成
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

### 验证
- WORKFLOW.md 引用的工具路径全部核实存在（当时位于根 `tools/`，现已整体迁入
  `game-dev/tools/ai-gen/`：comfyui-gen.py、models.json、make-transparent-icon.py、
  check-icon-sizes.py、birefnet-cutout.py、verify-eclipse-icons.py、flip-boots-right.py、
  check-components.py、minimax-h3-gen.py、start-comfyui-remote.bat 等）。
- 模板内容全部来自实战沉淀（陨星/暴风雪图标、稀有三套+首饰、沙袋/拒马、陨星 VFX 视频），非虚构。

## 阶段性进度总结（2026-08-04 二轮：生图入口优先级调整 + FLUX.2 dev Depth ControlNet 视角锁定）

### 本次完成
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

### 验证
- 远程 5080 在线（192.168.3.142，RTX 5080 16GB，ComfyUI 0.30.0），模型/节点清单实机核对
  （Flux2FunControlNetLoader/Apply 存在，ControlNet 文件在 models/controlnet）。
- `tools/ai-gen/comfyui-gen.py --list-models` 通过；`flux2-dev-mesh` 跨机实测出图成功
  （5080 Icarus + 3080 Ti Daedalus，8 步 turbo，服务端每步 decode~140ms/fwd~9ms/enc~650ms）。

## 阶段性进度总结（2026-08-03：怪物寻路全面审计 + 性能优化落地）

### 背景（全量审计实测，2026-08-03）
冷路径 findPath ≈ 10ms（`_buildGrid` 占 92%）；刷怪瞬间 15 只怪同帧冷寻路可达 50~115ms
主线程卡顿；不可达目标每 500ms 卡住重算重复付冷 A*（20ms/次）；冰墙生成/破碎误调
`invalidateCache()`（冰墙只改 isoSegments，A* 网格有意不建模——纯开销零收益）；
墙体碰撞对全部墙/线段/树线性扫描。

### 本次完成
1. **静态格子记忆化**：`_getCellData` 合并 blocked+moveCost 单趟查询，按 `(格子坐标, 半径)`
   跨寻路复用；`_buildGrid` 原点对齐 gridSize 倍数 → 15 怪同帧批量 106ms→~10ms。
2. **每帧寻路预算**：`PATH_DEFERRED` 哨兵 + `beginFrame()` 帧预算（3ms），超预算保留旧路径
   下帧重试，杜绝同帧多怪冷寻路叠加。
3. **不可达负缓存**（500ms TTL）+ **出口路径短缓存**：重复失败 20ms→0.01ms。
4. **首寻路错峰**：PathManager 创建后 0~250ms 随机延迟，刷怪同帧错开。
5. **墙体碰撞空间网格**：walls/isoSegments/trees 经代理自动标脏 + 128px 惰性网格，
   resolve 提速 ~11×（20 怪 × 3 resolve/帧 1.40ms→0.12ms）。
6. **分离/侧翼空间分区**：`_computeSeparation`/`_computeFlankOffset` 改
   `SpatialPartitionSystem.queryRadius`，替代每怪每帧遍历全部实体。
7. **冰墙缓存失效删除**：`ice-wall-system` 不再调 `invalidateCache()`（约束已写死）。
8. **P3 收尾**：`setPath` 防御性拷贝（修共享缓存数组别名）、`_setCache` LRU、
   console.warn 1s 节流、删除死代码 `isReachableByRegion`。

### 验证
- eslint 0 error / `vite build` ✓ / `npm test` 全绿（新增 collision-grid 差分 12 + 寻路基准 27）。
- 回归防线已入 `npm test`：`tools/pathfinding-bench.mjs`（合成战斗房基准+宽松阈值）、
  `scripts/test-collision-grid.mjs`（线性 vs 网格差分：12 场景×250 查询 + 变更追踪 + 空场景）。

### 关键改动文件
`src/ai/pathfinder.js`、`src/ai/path-manager.js`、`src/systems/movement-system.js`、
`src/world/wall-system.js`、`src/entities/components/ice-wall-system.js`、`src/game.js`、
`scripts/test-collision-grid.mjs`、`tools/pathfinding-bench.mjs`、`tools/pathfinding-hooks.mjs`、
`package.json`。

### 后续方向（已评估，暂缓）
- `findPathToExit` 的 RegionIndex 按房间 bounds 限定（当前全墙 bounds，负缓存+预算已兜底）。
- 冷路径首建 ~10ms 的"按障碍物栅格化"优化（预算下单帧一次，收益边际）。
- 跨房间怪物追踪（门闸软成本进寻路等）——需设计确认，非实现项。

---

## 阶段性进度总结（2026-08-03：距离音效/游戏菜单/冰墙与魔法改造修复/全量审计）

### 本次完成
1. **位置音效（距离衰减）**：SoundManager 通用能力——`setLoopPosition(id,x,y,opts)` 挂声源坐标 + 衰减参数（base/max/nearDist/farDist/maxDist），`computeDistanceVolume` 双段线性曲线（≤nearDist 恒 max → farDist 处 base → maxDist 处 0，超出静音），`playFileAt` 一次性位置音效，`distanceGain` 倍率；主循环 `SoundManager.update()` 每帧统一刷新。蝇群已接入（loopMaxDist 2000）。音量持久化 localStorage（150ms 防抖落盘）。
2. **游戏内菜单（左上角 ☰ 菜单）**：`GameMenu` 覆盖层三入口（返回游戏/设置/退出游戏）；**暂停三冻结 = `Game._paused`（旧逻辑循环）+ `PhaserGame.game.pause()`（渲染/动画）+ `TimerManager.pause()`（JS 定时器：波次/冷却/计时）**——三者缺一就不是真暂停。设置页：音量（master）/背景音量（music 声道，实时联动地牢 BGM）/全屏切换（打包版按钮）。退出走 `window.electronAPI.exitApp()`。ESC 开/关统一走 input.js MENU 键链。
3. **Electron ESC/全屏理顺**：主进程 `globalShortcut('Escape')` 不再退全屏/退游戏，改为转发 `esc-pressed` 给渲染进程（失焦不转发）→ input.js `handleKey('Escape')` 完整 MENU 链；全屏切换移入设置按钮（`toggle-fullscreen` IPC + `fullscreen-changed` 推送 + `get-fullscreen` 主动查询防竞态）。preload 事件监听接线不再是死代码。
4. **冰墙修复**：新增 `IceWallSystem.breakdown()`（splice 全部 isoSegments + 清 `_walls/_pendingSpawns` + 失效寻路缓存）——**动态障碍物必须挂三钩子：战斗房 `cleanupRoom` / `SceneManager.switchScene` / 出征前（depart 绕开 switchScene 直清实体）**，否则地牢 map 模式冻结计时导致墙体跨房残留/待生成幽灵碰撞。链式 MP 门禁、寒冷光环整组节拍（同目标每秒只叠一次）、破土粒子一次性 burstParticles。
5. **魔法改造修复（bolt/闪电/圣光/冰墙/冰锥/火球统一）**：**链式强化 MP 门禁口径 = 先按当前 `_chainSpellStacks` 算含减免 MP 成本做门禁（只读不消费），通过后才 `consumeChainSpellBonus` + 扣蓝**——失败施法不丢层数；消费了层数必须吃到 `damageMul`。火球 `onImpact` 加 `if (!spike.flyActive) return`（同帧多目标重叠只爆一次；冰锥不加，保住准穿透）。`addChainSpellStack` 在 statusImmune 期间直接 return。
6. **热路径性能**：`skill.getEffect(level)` 按等级缓存（移速每帧/施法飞行期每帧不再重复公式 parse）；StatusBar 渲染 100ms 节流。
7. **审计**：全量排查（新怪受控检查补齐站桩三怪 + 6 怪 fear 中断、僵尸巫师眩晕中断、公式求值器一元负号/前导小数/多参 Math 白名单、事件监听全配对、pathfinder 设计确认、Electron 错误兜底 + 崩溃重载）。

### 沉淀约定（防再犯）
- **craft-config 新武器改造配置必须 `options` 嵌套**：`weapon20 = { slots:[...], options:{ slotId:[配件...] } }`——配平列表放顶层会导致 `config.options` 为 undefined、点击无反应，且 **test-craft-sync 只校验效果键与 registry 三角，校验不到嵌套层级**，此类结构错误靠人工审计。新武器上线时验证：改造弹窗能点、能装备、重置布局有默认槽位（craft-default-slots.js 同步补键）。
- **自定义怪受控检查清单**：覆盖 `update()` 的怪（含站桩怪）都必须有 stun/frozen/fear 检查——站桩怪（煮锅/墓碑/矿洞）也要在站桩钉死后拦生成/投掷；基类的检查只到得了 `super.update` 之后，状态机在 super 之前的怪（僵尸巫师）必须在顶部拦截。
- **pathfinder 有意不含 isoSegments**：动态碰撞段（门闸/冰墙）由 MovementSystem.resolve 实际挡停（撞墙即停），寻路只建模静态 walls/trees——不要"顺手"把 isoSegments 纳入寻路，会削弱临时障碍阻挡设计。
- **渲染进程错误兜底已内置**：`window.onerror`/`unhandledrejection` 控制台 + 左下角错误条；Electron 主进程 `render-process-gone`/`did-fail-load` 崩溃重载。

## 阶段性进度总结（2026-07-28：近战连段体系 + 攻击范围重构 + 挥砍特效 + 贴图标准化）

### 本次完成（V0.291~V0.302）
1. **近战连段体系**：一段（attack_sword 8帧）→ 定格 0.5s（连段窗口）→ 二段（attack_sword_2 30帧/1.5s）→ recover 收势（13帧/0.33s）→ idle。攻击期输入全锁（移动/闪避/新攻击/切武器/冲刺/特殊攻击）；移动立即取消定格/收势。
2. **朝向硬绑定（结构级）**：近战武器朝向一律 = `playerSprite.flipX`（身体是唯一权威）——攻击逐帧/定格/收势滑行/idle/副手全部直接读身体 flipX，独立朝向判定已删除。教训：setPlayerAnimation 曾用 _facingDir（45° 边界）与武器的 ±0.05 滞回（87° 边界）冲突；`_attackHoldFacingRight` 捕获在连段时泄漏（二段沿用一段朝向）——双重教训后统一为身体 flipX 单源。
3. **攻击范围重构（配置驱动）**：`sword.attack.hitCheck { frame:22, shape:'rect', knockback:50 }`（一段矩形：宽恒定、长=武器 attack.range、第 22 帧判定）/`sword.attack2.hitCheck { frame:15, shape:'sector', arcDeg:120, knockback:75, damageMul:1.5 }`（二段扇形：footprint 相交、击退 75px、伤害×1.5、第 15 帧判定）。攻击方向固定玩家左右两侧（鼠标只选左右）。
4. **挥砍特效 A+B**：perFrame 帧字段 `blurX/blurY`（**V0.307 起改为残影实现**——高斯滤镜对细长武器是"摊薄消失"，实机像素级取证峰值帧剑身近乎不可见，已废弃；现由 GameScene 沿轨迹回放 3 道历史姿态残影，blurX/blurY 驱动残影长度/浓度）+ `stretchX/stretchY`（拉伸）；面板四输入可调，播种=帧间位移推导。面板预览 canvas filter 近似。
5. **贴图标准化管线**：武器贴图统一"内容宽比 + 中心分数"归一（AKM 基准 0.915/(0.500,0.543)，PKM 0.907/(0.496,0.543)）——AKM/201/Super90 已重制替换，枪口 muzzle 配置对齐；归一后尺寸=显示缩放×内容占比，"和 AKM 一样大"即同分母同占比。
6. **冲刺攻击动画**：`dash_attack` 17 帧 sheet（素材 attack-2.png 归一），trigger 时播放（timeScale 拉伸到技能 totalMs）；位移窗口帧驱动（前 12 帧位移、13~17 静止，`effect.moveFrames` 可覆盖）。
7. **其他**：挥砍音效起手播放（块配置 sound 字段）；弹壳落地留存 3s；子弹胶囊化（短粗椭圆+提亮）；双持副手开火位 offhandOffsetY 配置；右键瞄准打断奔跑（与开火同口径）；`spriteOffsetX/Y` 贴图独立偏移（只动贴图不动手臂/弹道）；人物+武器整体 +20%（spriteSize 144 / WEAPON_ANIM.size 126，碰撞与偏移不变）。

### 关键改动文件
- `src/combat/attack.js`（checkStageHit/扇形/击退/固定左右）、`src/entities/player/weapon-anim.js`（连段/音效/hitCheck 触发）、`src/phaser/scenes/GameScene.js`（朝向绑定/收势滑行/模糊滤镜/spriteOffset/深度帧）
- `src/entities/components/dash-system.js`（冲刺动画+位移帧窗口）、`src/combat/projectile.js`（胶囊弹）、`src/phaser/scenes/BootScene.js`（胶囊贴图）
- `src/ui/dev-tool.js` + `panels/dev-tools.js`（模糊拉伸输入/固定点/attack2 页/直写保存/zoom 坐标）
- `public/data/weapon-anim-config.json`（hitCheck/特效帧字段/击退/offhand/spriteOffset）、`data|public/data/player-anim-config.json`（attack_sword_2/recover/dash_attack）

### 验证状态
- lint 0 error、vite build、test-collider、test-craft-sync 持续全过
- 实机已确认：朝向绑定（facelog 取证）、攻击范围帧判定；挥砍模糊 V0.307 改残影后实机截图确认（此前"fxlog 取证"只证明滤镜激活，未验证观感——高斯方案已废弃）
- 未提交批次：V0.291~V0.302 全部在本提交

### 后续计划
- **即梦 API 接入**（⚠ 截至 2026-08-04 未实施的计划，`tools/jimeng-gen.py` 尚不存在，勿当已有能力；用户已确认排期）：火山引擎视觉服务（jimeng_t2i_v40）文生图脚本 `tools/jimeng-gen.py`——提示词用本文件工作流标准模板；密钥由用户自建 `tools/.secrets/jimeng.json`（不入库、需加 .gitignore），不贴对话。接入后 AI 出图→标准化管线→入库全自动化；视频生成接口（动作动画截帧路线）作为二期。

---

## 阶段性进度总结（2026-07-28：经验系统重构一期——pacing 闭环 + 压级衰减）

### 本次完成（方案经用户验收；二轮：pacingRuns 2.5→5.0 经验效率减半）
1. **pacing 闭环公式**（`src/config/exp-system.js` 唯一口径，配置 `combat-formulas.json enemy.expValue`）：每场产出预算 = 升级曲线段成本 ÷ pacingRuns(**5.0**，2026-07-28 二轮用户拍板减半，同级地牢 4~6 场升一段），按地牢加权击杀（普通×1/精英×2/领主×4/首领×10，由 dungeon-config 机械解析）分摊——**毕业场数是构造出来的**；全清≈4 场、80%≈5 场、直奔 Boss≈8.9 场，探索与升级速度自然挂钩。实测 base：F 25.3 / E 103.8 / D 120.5 / C 144.5。**注意：加权击杀 W 已把"高级地牢房间/战斗更多"摊薄进单价**（F 档 W≈121 / E≈163 / D≈260 / C≈316），单怪经验 F→C 仅 ×5.7，不会随段预算 ×14 膨胀。
2. **压级衰减兜底**：`diff = 玩家等级 − 怪物有效等级`，≤5 级不衰减，超出每级 −15%，rank 下限 普通1%/精英3%/领主5%/首领10%——速刷低级本练级经济死亡，回刷材料不受阻。
3. **怪物有效等级锚定**：`L_m = anchors[grade] + (配置等级 − 3)`（F3/E13/D28/C43/B58/A73），保留种间相对差异；当前仅用于经验/衰减语义。**属性成长（HP/六维按 ΔL 缩放）列入二期，必须实机逐档校验后实装。**
3.5. **越级加成与可视化（2026-07-28 续）**：等级差倍率双向化 `getExpLevelMultiplier`——越级 5 级+每级 +10% 封顶 1.5×（`underdog` 配置块）；经验飘字按 tag 变色（衰减灰/越级绿，`gainExp(amount, tag)`）；出征规则栏衰减档标红；通关结算面板（`_showVictory`：击杀统计/经验合计/探索完成度/距下一级，全清 +10% 奖励，数据源 `src/world/dungeon-run-stats.js`）。
3.6. **属性成长+祭品加持（2026-07-28 二期落地）**：`monsterGrowth`——ΔL=有效等级−配置等级，**直改派生属性**（六维 str 系数仅 0.05，按六维成长攻击不涨；hp 0.10/首领 0.05、atk/matk 0.08、def/mdef 0.04 每级）；`empower`+`src/config/dungeon-empower.js`——出征面板 3 格加持槽（祭品堆叠计强度，普通1~传说6 上限 12，depart 消耗/关闭退还），怪物有效等级 +4S、经验×(1+0.08S)、金币×(1+0.15S)、掉率+1.5pp×S、S≥6 封顶+1，衰减按强化后等级（高等级回刷低级本闭环）；出征左栏只读显示强度/等级区间/属性倍率/奖励倍率/经验效率。
3.7. **清剿奖+连战+节点预览（2026-07-28 三轮）**：`roomBonus.share=0.3`——预算 70% 击杀分摊/30% 按战斗节点开门清算（两池闭环）；`combatStreak`——连战 3 场起 ×1.15 每场 +5% 封顶 ×1.5，empty 不计不断、事件节点清零（`_settleCombatRoom` 统一结算，顶部提示+紫色"（连战）"飘字）；地图悬停节点显示预估经验（`getRoomExpEstimate`，含下一战连战倍率预览与"将中断连战"提示）。**注意：精英战 1 波 6 怪击杀经验低于普通战 3 波 15 怪（补偿=必掉祭品+宝箱房），预览如实显示。**
4. **接入点**：`enemy.getExpValue(playerLevel)` 委托 exp-system；`damageable-entity` 击杀结算传玩家等级；`DungeonMapSystem.init/shutdown` 注入/清空当前地牢类型（setCurrentDungeonType）；`player/base.js getExpForLevel` 与 exp-system `computeMaxExp` 同源；主神空间回退 F 档。
5. **出征界面**：规则栏每档地牢显示推荐等级段（与 bands 配置同源），dungeonList 加 recLevel 元数据。
6. **教训**：加权击杀解析时 nodeCount 必须先减岔路预算再算网格战斗节点（nodeCount 口径含岔路，直接乘战斗比例会把岔路节点两边重复计入，W 偏高 30%+ 稀释经验）。

### 验证
- `npm test` 四连全过：test-regressions 扩容至 63 断言（闭环不变量/衰减边界/锚定单调/主神空间回退），lint 0 error，vite build ✅。

---

## 阶段性进度总结（2026-07-28：Boss 场地门闸化 + 防再犯单测 + 武器工作流定稿）

### 本次完成（自主任务三件，均不依赖素材）
1. **Boss 场地门闸化**：Boss 房复用 CombatRoomSystem 门闸机制（`_diamond` 上下文借用）——`_setupGate` 入场关门困场、击败后 `openGate()`、门外白区离场判定与 `_leaveBossViaPortal` 接通；门闸 placeAt 失败时回退出口传送门（菱形中心）。`BossRewardSystem.cleanup` 补 cleanupGate + rebuildIsoCollision（防幽灵墙段）。SKILL.md「待接入」清单已销项。
2. **防再犯单测 `scripts/test-regressions.mjs`（30 断言）**：入侵追击状态机（真实源码注入桩执行）、弹药 Infinity→null 回退、双份 JSON 一致、宝箱奖励 F~A 全档、装备音效路径存在。已挂 `npm test`（collider/craft-sync/config-integrity/regressions 四连）。
3. **武器添加标准工作流定稿**：六段式写入本文件（ROADMAP 任务 2 销项）。

### 教训沉淀（2026-07-28 全面排查，写死防再犯）
1. **Phaser 4 事件顺序**：UpdateList(动画) 挂 PRE_UPDATE、TweenManager 挂 UPDATE——同帧内 animationcomplete 早于 Tween onComplete。跨系统时序依赖（如动画回调读 Tween 写的字段）必须**预写**，不能等 onComplete。
2. **JSON 克隆陷阱**：`Infinity`/`undefined` 经 JSON round-trip 变 `null`——实例克隆链（商店/掉落/存档）上的数值配置禁止依赖 Infinity 原值，消费端必须 `== null` 回退（getAmmoConfig 模式）。
3. **共享数组恢复必须原地替换**：读档/恢复 `xxx = data.arr` 换新数组会让 init 时注入的引用全部失效；一律 `length=0 + push(...)`。
4. **实体进 Game.entities 必须登记清理路径**：战斗生成物要么 key 入 `_combatMonsterKeys`，要么前缀入 `removeEntitiesByPrefix` 兜底——两者都没有就是泄漏。
5. **死亡序列总时长 ≤ `_deathRemoveDelay`**（默认 3000ms）：`_preserveCorpse` 的自定义长序列必须显式覆盖该延迟，否则 game.js 到点直接 delete 实体、贴图永久残留。
6. **UI overlay/标记位必须有 shutdown 复位路径**：全屏确认框 + 布尔标记的组合，死亡/异常退出不清理就是下局软锁（宝箱离场确认框教训）。
7. **面板 DOM 改动找 `src/ui/panels/dev-tools.js`**；`once('animationcomplete')` 被打断不触发会残留——完成回调必须可移除（off 句柄）或校验动画 key。

---

## 阶段性进度总结（2026-07-27：攻击力公式体系统一——单一公式源）

### 核心规则（防再犯）
1. **唯一实战公式**：`src/config/attack-formula.js` 的 `computeWeaponAttack`（经 `Player.getCurrentWeaponAtk`）——战斗/面板/强化预测全部同链，**禁止**新建第二套武器伤害公式；`weapon-damage-formulas.js`（硬编码死代码）已删除。
2. **唯一全量数据源**：`EquipDataManager`（src/ui/equip-data-manager.js）——新武器在这里配 `attackFormula` 即全链路生效；实例缺字段经 `completeWeaponFields`（main.js 启动合并 / shop-system 商品列表共用）或 `getAttackFormula` 的 EDM 查找层自动补全，不要在新数据源里复制字段清单。
3. **getAttackFormula 三级回退**：item.attackFormula → EDM 查找（weaponId/name，含嵌套下钻）→ stats"物理攻击"正则兜底（base 取下限，可能偏离设计值，仅兜底）。
4. **展示公式唯一实现**：`buildFormulaDisplay`（数值版）/ `buildEnhancedFormulaDisplay`（符号版），图鉴/强化面板/tooltip 全部委托。
5. **强化链**：只影响攻击（公式派生）与盾防（base+perEnhance×级）；射速/弹夹/换弹无强化公式；enhanceFlat=0 是合法设计（沙鹰/能量LMG）。
6. **教训**：`equip-tooltip-manager` 曾调用不存在的方法 `getItemByName`（实际 `getEquipByName`）导致图鉴合并静默失效——调用对象方法前先确认存在；商店/掉落/存档多源物品必须过统一补全层。

---

## 阶段性进度总结（2026-07-27：腰射⇄瞄准 aimFrames 帧动画重做落地 + 实机达标）

### 本次完成：AI 视频驱动 14 帧抬枪动画（V0.251 失败复盘后重做，V0.253~263 实机调优达标）
1. **机制**：`twist.aimFrames { src, frameCount:14, transitionMs:250, hands[14], liftAdjustX, liftAdjustY }`（gun_idle，全体双手枪械共享）——长按右键 `_aimEase` 0→1 **线性**推进（指数趋近回程拖 1s 尾巴变形，已废弃），手臂条按帧播放（腰前(366,210)→肩高(338,110)），锚点 = 肩 + R(世界瞄准角−帧自然角)×(帧手−肩) + (liftAdjustX 翻转镜像, liftAdjustY) 按 ease 与旧链 blend。
2. **三根因教训（写死防再犯）**：①aimEase 推进条件**不得**引用表现配置（`twist.aimFrames || twist.aimLift` 任一存在即推进——V0.251 因推进条件引用被删的 aimLift 导致 ease 恒 0"无动画"）；②帧分支**只在 `_aimEase>0` 接管**，ease=0 必须逐像素等价旧路径（V0.251 无条件接管 + pivot 低 39px 导致 idle 错乱）；③视频提取**禁用模板减法**（`tools/aim-frames-extract.py`：色度键控+模板互相关配准+三路并集分离；旧脚本卷积核翻转 bug 使配准全顶裁剪边界）。
3. **渲染/素材坑**：`textures.addCanvas` 的镜像 sheet 需手动 `tex.add(i,0,x,y,w,h)` 补帧才能 setFrame；canvas mirror 烘焙 translate 的 Y 分量必须为 0（误写 i*fw → 帧 1~13 全画出画布外，朝左瞄准手臂消失）；提取后逐帧扫"邻帧独有连通域"（帧 11 曾泄漏 446px 头部碎片，清理已固化进脚本幂等）。
4. **双手枪冲刺开火（V0.262/263）**：开火=非奔跑——`_twoHandedGunFiring` 从 `_isSprinting` 与烟尘门排除（腿回 walklegs、武器回 walking 位、不出烟尘）；**注意第二道闸**：枪开火 `weaponAnim.state='attacking'` 会触发 `_updatePlayerAnimation` 的"攻击不覆盖"early-return 冻结腿层——已加枪械放行（近战守卫不变；枪攻击动画在武器层，playerSprite 只载腿/躯干）。
5. **武器位置基准（AKM 标准，六双手枪械已逐字段同步）**：holdOffsetX −64 / holdOffsetY −4（top/idle/walk 全状态块）、grip (0.29,0.54)、idleScale/idleRotation 统一；**合理保留的 per-weapon 差异**：muzzle（按各自贴图枪管实测）、recoilAmount/timingMul/renderParams（手感参数）。手枪类基准=沙漠之鹰（另一族，不混）。
6. **回退路径**：删配置里 aimFrames 节即自动回 Tier1 aimLift 抬升（配置保留休眠）；完整回退点 `backup/2026-07-27-aimanim/`（纯 aimLift）与 `backup/2026-07-27-aimanim-v2/`（重做前快照）。

---

## 阶段性进度总结（2026-07-26 深夜：手枪姿态系 + 跑步系 + 瞄准死区）

### 本次完成：三姿态体系 / 跑步腿层与体感 / 瞄准死区可调锥（实机达标）
1. **三姿态自动切换**：`gun_idle`（长枪低持）/ `gun_idle_pistol`（单持前伸）/ `gun_idle_dual`（双持双臂前伸）——`_resolveGunPose()` 按主/副手武器类型解析，移动中换武器也能正确重建分层（姿态键变化即 setPlayerAnimation 修复）。用户 AI 出图（纯黑底）→ 阈值抠图+暗邻域轮廓还原 → 477/492 基准化+髋部对齐 217 → 裁躯干/手臂条 → 描边膨胀加粗统一旧骷髅线条。
2. **跑步腿层**：`gun_run_legs`（running.png 裁下半身+top2 连通域+逐帧对齐 217/492+出帧钳制）；走/跑自动切换（原生帧率，弃 timeScale hack）。
3. **体感系统**：`bodyBobY`（走/跑逐帧头顶 Y 起伏）+ `bodyBobX`（逐帧髋 X 前后摆，bobXScale 默认 0.5；run/walk 全覆盖）——数据驱动自原动画，isPlaying 防御 stop() 残留。
4. **瞄准死区+可调锥（枪械近战弱设定落地）**：`aimDeadZone`(160px) + `aimDeadZoneCone`(20°)——死区内以进入时自由角为基准仅 ±cone 可调；姿态/贴图/锚点/**弹道**四通道统一 `_effectiveAim`，贴身扫射沿基准散开，近战武器获得空间。
5. **副手同口径**：`_computeGunAnchor` 提取主副手共用；副手补 grip 轴心（flipY 补偿）；`WEAPON_TRANSFORM_CONFIG.pistol.offBase` 改 (-23,19) 锚定双持低手位。
6. **后坐上身**：`twist.recoilTorsoScale`(默认 0.3) 开火时 recoil 反向作用于腰轴。
7. **微调配置族**：`torsoShiftX/Y`（躯干整体微调，翻转镜像）；手枪类贴图 idleScale 0.6 + holdOffset 多轮微调（面板→助手合并流）。

### 关键改动文件
- `src/phaser/scenes/GameScene.js`（_resolveGunPose/_syncGunTwist/_syncGunArm/_computeGunAnchor/死区逻辑）
- `src/phaser/scenes/BootScene.js`（walkLegs/runLegs 循环加载注册 + torso/arm 镜像烘焙）
- `src/entities/player/subsystems.js`（弹道死区改写）、`src/combat/weapon-transform.js`（pistol offBase）
- `assets/player/gun_idle_pistol*.png`、`gun_idle_dual*.png`、`gun_run_legs.png`
- `data/player-anim-config.json`（双份）、`public/data/weapon-anim-config.json`

### 验证状态
- `npm run lint` ✅（0 error）、`npx vite build` ✅、`test-collider` ✅、`test-craft-sync` ✅
- 实机用户确认：双持/双手武器贴图动画"接近预期标准"

---

## 阶段性进度总结（2026-07-26 晚间：持枪瞄准体系全套落地）

### 本次完成：姿态层 + 分层扭转 + 手臂条 + 锚定体系（ROADMAP 任务1 主体收官）
1. **姿态层**：`gun_idle` 低持姿态（素材库 shooting/2.png 重管线）；`player-anim-config.json` 驱动，`isGunWeapon && 站立` 自动切换。
2. **上半身分层扭转（360° 瞄准）**：`twist { legsSrc, torsoSrc, pivotX, pivotY, maxAngle, angleScale, walkLegs, arm, torsoShiftY }`——腿层站死、躯干绕腰轴 ±40°、左瞄 canvas 烘焙 `_torso_flip` 镜像贴图（不用 flipX）；走腿 sheet 按 idle 基准（髋 217/脚 492）逐帧烘焙对齐，walking=idle 天然一致。
3. **手臂条层（单骨伪 IK）**：双臂整体一条（躯干原位抹臂），`_syncGunArm` 每帧 `rotation = atan2(枪握把 − 肩) − 自然角`；锚点连续化模型——钳制内腰轴轨道、超出角以肩为支点旋转钳制点（圆过钳制点，边界零跳变）。
4. **锚定体系**：`grip {x,y}` 握把旋转轴心（滑手修复，flipY 时 gcy 取反保持左右镜像）；扭转激活时锚点在躯干空间计算（禁 localToWorld 公转=双重旋转）；攻击/奔跑等未配置状态回退=全局 holdOffset（AKM 全局对齐防跳变）。
5. **双手枪开火禁跑**：`isGunWeapon && isTwoHanded && leftDown` → sprint 解除退回 walking（PKM 系保留 50% 减速语义）。
6. **尺寸基准统一**：新姿态一律内容高 477/脚底 y=492（剑基准）；枪姿态系列绕髋点 ×1.084 放大并逐帧处理多帧 sheet。
7. **面板**：WEAPON_MAP 与 `getWeaponTextureLoadList()` 同源；image 型姿态预览；持枪移动分层合成预览；枪械握把锚点绘制；walk 保存写状态子块；逐帧导出 `weapon-frames/latest.js` 交接流首航。
8. **排障沉淀**：play() 前必须 setTexture 同源；`anims.stop()` 后 currentAnim 引用不清空（判断动画状态必须并查 isPlaying）；`getAmmoConfig` 消费端回退（无法开枪排查手册）。

### 关键改动文件
- `src/phaser/scenes/GameScene.js`（setPlayerAnimation/_syncGunTwist/_syncGunArm/syncWeapon 锚点链）
- `src/phaser/scenes/BootScene.js`（配置驱动加载 + 镜像烘焙）、`src/config/player-anim.js`（新增）
- `src/entities/player/weapon-anim.js`（tweenDuration 贴图同步）、`src/entities/player/update.js`（双手枪禁跑）、`src/entities/player/subsystems.js`（弹药回退）
- `src/ui/dev-tool.js`、`src/ui/panels/dev-tools.js`、`vite.config.js`、`electron/main.js`、`electron/preload.js`
- `assets/player/gun_idle*.png`、`data/player-anim-config.json`（双份）、`public/data/weapon-anim-config.json`

### 验证状态
- `npm run lint` ✅（0 error）、`npx vite build` ✅、`test-collider` ✅、`test-craft-sync` ✅
- 实机用户确认：idle/walking/360° 瞄准/左右镜像/开火/禁跑/尺寸统一 全部通过（"完全成功"）

---

## 阶段性进度总结（2026-07-26 玩家动画体系）

### 本次完成：玩家动画配置化 + 开发面板姿态层 + 攻击时长同步（ROADMAP 任务1 方向1/2/3）
1. **配置表 `data/player-anim-config.json`**（双份 public/）+ `src/config/player-anim.js`：纹理键约定 `player_<动画键>`；BootScene 加载/注册、GameScene `setPlayerAnimation` 全走配置表。**新增玩家姿态 = 素材入库 + JSON 加条目**（type=image 单帧 / sheet 配 frames 区间+frameRate+repeat），运行时与开发面板自动生效，无需改代码。
2. **攻击时长同步（根因修复）**：关键帧/默认 Tween 路径 900ms vs 贴图 667ms 各播各的——`setPlayerAnimation(key, targetDurationMs)` 用 `anims.timeScale` 对齐，回 idle/循环动画归 1；`_playSwordAttackTween` 只主手触发贴图动画。
3. **开发面板**：角色帧加载改读配置表（`PANEL_ANIM_TO_CONFIG` 映射 running→run/attack→attack_sword），帧裁剪支持 `firstFrame` 偏移；播放帧率读配置 frameRate + 面板 `#devToolFps` 可覆盖。
4. **挂载点+关键帧系统删除（同日二轮）**：handAnchors/gripOffset 与 keyframes 生产配置零使用、单点锚无法帧间跟手（perFrame 已全覆盖）——dev-tool.js -755 行、weapon-transform.js -147 行、weapon-anim.js/GameScene.js/panels/dev-tools.js/dev-tool-panel.html 同步清理。最终模型：**攻击=perFrame 逐帧（无配置走默认三段 Tween 链），静态姿态=每状态 holdOffset**。
5. **待办**：拉弓/持枪/受击/死亡姿态素材由用户备料，到位后 JSON 加条目即可。

### 关键改动文件
- `src/config/player-anim.js`（新增）、`data/player-anim-config.json`（双份）
- `src/phaser/scenes/BootScene.js`、`src/phaser/scenes/GameScene.js`、`src/entities/player/weapon-anim.js`、`src/ui/dev-tool.js`

### 验证状态
- `npm run lint` ✅（0 error）
- `npx vite build` ✅
- `node scripts/test-collider.mjs` / `test-craft-sync.mjs` ✅

---

## 玩家角色动画标准工作流（射击/近战新动作一律按此开展，2026-07-26 定稿）

### 0. 设计原则（先读，违反必返工）
- **分层不烘焙**：武器/装备永远不画进身体帧。AI 只出"空手持握状"的身体动作，武器用程序贴图叠加（枪械 360° 程序旋转已实现）；**不让 AI 画枪，也就永远不用抠枪**。
- **帧数克制**：AI 帧间必抖，帧数越少越稳；对齐前先提高 alpha 阈值区分本体与残影。
- **平面内动作**：侧视朝右、无镜头运动；不做转身/透视缩放/遮挡穿越（AI 一致性崩塌区）。360° 全身瞄准动画是伪需求，禁止走这条路。
- **换装 = 整套皮肤换纹理键**（一套铠甲一整套角色变体），不做单件叠加纸娃娃（无骨骼系统必错位）；头盔/背包/披风类低贴合挂件可单独锚点叠加。

### 1. 姿态规划（立项先定清单与帧数）
- **优先级**：gun_idle/gun_fire（枪械主力，最急）→ hurt → death → bow_draw/bow_release → reload → 新近战攻击动作。
- **帧数规格表**：

| 姿态 | 帧数 | repeat | 备注 |
|---|---|---|---|
| idle / gun_idle | 1~4 | -1 循环 | 呼吸即可 |
| walk / run | 沿用现有 | -1 循环 | 不重做 |
| attack_sword（已验证） | 8 | 0 | 标杆规格 |
| gun_fire | 2~4 | 0 | 含后坐上跳 |
| hurt | 2~3 | 0 | 受击反馈 |
| death | 6~10 | 0 | 末帧定格 |
| reload / bow_draw | 6~8 | 0 | |

### 2. AI 素材生成规范
- 固定一张角色基准图；**所有动作从同一首帧 img2video 出发**，保证跨动作一致性。
- 侧视朝右、全身入画、脚底贴底边、画布对齐 512×516、透明/纯色底。
- 提示词写"**无武器、空手呈握持/挥击状**"；干净输出三件套：透明底、无白色描边/辅助线、无水印。
- 同一套动作**一批出齐**，不分开生成（分开必出规格差）。

### 3. 素材管线（入库前必过）
- 切帧 + 抠图（边界泛洪 / alpha 阈值清零）。
- 标准化：内容高度统一、底部对齐（`tools/sprite-normalizer.py` 或既有切帧脚本；帧尺寸严格 = 帧宽×列×行，不足补透明行）。**尺寸基准（2026-07-26 定稿）：以剑姿态为准——内容高 477px、脚底基线 y=492（512×516 画布）；新姿态一律缩放到该基准**（枪姿态系列已按此放大 1.084，绕髋点缩放 + 逐帧独立处理多帧 sheet）。
- 复制进 `assets/player/` 或 `assets/character/`（原则 9），命名 `player_<动作>.png`。

### 4. 配置接入（唯一真相源，`data/` ↔ `public/data/` 双份同步）
`data/player-anim-config.json` 加条目：
```json
"gun_fire": {
  "type": "sheet", "src": "assets/player/gun_fire.png",
  "frameWidth": 512, "frameHeight": 516, "cols": 8, "rows": 1,
  "frameCount": 4, "frames": [0, 3], "frameRate": 12, "repeat": 0
}
```
- `repeat`：-1 循环（idle/walk）/ 0 播放一次（attack/hurt/death/gun_fire）。
- `frameDurations`（可选，ms/帧数组，2026-07-27 新增）：逐帧时长覆盖均匀帧率——如攻击末帧定格更久（`"frameDurations": [83,83,83,83,83,83,83,300]`）。总时长=各帧之和，武器轨迹 Tween 经 `animDef.duration` 自动同步，武器 30 点轨迹无需联动改；调节奏只报比例即可（助手换算成 ms 写双份 JSON）。
- `frameWeights`（可选，占比数组，推荐）：按权重分配**原总时长**——总时长锁定（帧数/帧率），只改各帧占比（如 `"frameWeights": [1,1,1,1,1,1,1,3]` 末帧占 3/10），武器轨迹/命中时序零影响。调节奏优先用它；frameDurations 仅用于需要改变总时长的场景。**开发面板预览已同源（2026-07-27）：面板自动读取 weights/durations 并按累计时长窗口定位角色帧，调节奏只改配置即可，无需手动同步面板**；面板 fps 输入框手动输入时仍按均匀帧率预览（调试覆盖语义保留）。**时长陷阱（2026-07-27）**：Phaser `Animation.duration` 只按 frameRate 派生、无视逐帧时长——凡取动画时长必须 `getPlayerAnimDurationMs` 优先（它认识 weights/durations 求和），否则贴图与武器轨迹/命中 Tween 脱节（"慢半拍"根因）。
- 纹理键自动 = `player_<键名>`；BootScene 加载注册、开发面板预览**全部自动生效，无需改代码**。
- **面板登记（2026-08-02 补充）**：新增姿态**不是完全自动**——除 JSON 加条目外，还必须在开发面板登记三处：`src/ui/panels/dev-tools.js` 的 `animOptions`（下拉显示名）+ `src/ui/dev-tool.js` 的 `ANIM_NAME`（状态名）与 `PANEL_ANIM_TO_CONFIG`（面板键→配置键映射）；新增武器同理登记 `weaponOptions` + `WEAPON_MAP`（贴图路径读 `weapon-texture-map.js` 加载清单同源）。漏登记 = 面板看不到该姿态/武器（V0.375 施法动画首漏，已补）。

### 5. 运行时姿态切换
- **近战攻击（模板已内置）**：`_playSwordAttackTween` → `setPlayerAnimation('attack_sword', tweenDuration)`（timeScale 贴图-Tween 时长同步）；repeat 0 动作播完自动回 idle（配置表通用处理）。
- **持枪姿态（已实现，2026-07-26）**：`GameScene._updatePlayerAnimation`——当前武器为枪械（`isGunWeapon`）且站立时姿态键切 `gun_idle`，移动沿用 walk/run；配置缺失自动回退 idle。首版 `gun_idle` 为低持/腰射单帧（素材库 shooting/2.png 抠底标准化，`tools/archive/prep-gun-idle.py`）；斜上/斜下角度分区姿态与 `gun_fire` 待素材。
- **近距角度平滑（2026-07-27，取代瞄准死区/可调锥）**：死区已废除（冻结手感差）。`twist.aimSmoothRadius`（默认 160 世界 px，0=全距离精准零平滑）+ `aimSmoothTau`（默认 120ms）——任何距离用真实瞄准方向（弹道零误差）；准心进半径后对瞄准角做短弧 EMA，tau×(1−dist/R)（边缘零延迟→中心最强，dt 归一化帧率无关）。姿态/贴图/锚点/**弹道**统一走 `_effectiveAim`（`_frozenAimActive` 标记沿用=平滑激活）。"枪械近战弱"改为用 tau 体现（加大 tau 如 250 更"肉"）。
- **手臂条层（单骨伪 IK，2026-07-26）**：`twist.arm { src, pivotX, pivotY(肩关节), handX, handY }`——双臂整体一条刚体贴图（躯干原位抹臂），`_syncGunArm` 每帧 `rotation = atan2(枪握把 − 肩) − 自然角` 追随握把，肩随躯干扭转绕腰轴旋转，翻转用 `_arm_flip` 烘焙镜像；深度在躯干与枪之间。**纯只读增量层，不改锚点/扭转逻辑**；躯干钳制之外的角度由它补齐（正上/正下不错位）。
- **上半身分层扭转（360° 瞄准定稿，2026-07-26）**：姿态条目配 `twist: { legsSrc, torsoSrc, pivotX, pivotY, maxAngle, angleScale, walkLegs? }`——素材在同一 512×516 画布上按髋关节节线裁腿层/躯干层（轴心=髋关节间脊柱末端）；BootScene 自动加载 `player_<key>_legs/_torso`（及 `_walklegs` 走腿 sheet）；`GameScene._syncGunTwist` 每帧：躯干层原点=轴心、贴腰轴世界点、按瞄准角（面向系相对角，±0.05 翻转死区）×angleScale 钳制 ±maxAngle 旋转、左瞄换 canvas 烘焙的 `_torso_flip` 镜像贴图+镜像原点（不用 flipX）、腿层翻转覆盖；`syncWeapon` 枪锚点绕同一腰轴旋转（手转枪跟），枪旋转仍精确 atan2。**裁腰预览先用 PIL rotate(center=pivot) 离线验证接缝再上引擎**。持枪移动：`_updatePlayerAnimation` 检测 twist.walkLegs 时腿层播走腿动画、躯干保持（冲刺 timeScale 1.5）。**铁律：play() 前必须 setTexture 同源**（扭转腿层残留会卡动画第一帧，"上半身消失+腿不动"根因）；**`anims.stop()` 后 `currentAnim` 引用不清空**——凡按 currentAnim 做状态判断的（如逐帧跟随），必须同时校验 `isPlaying`（"idle 错位"根因）。**走腿裁片流程（定稿）**：躯干裁线取骨盆完整位（295）让大腿顶藏进骨盆下叠合；walk sheet 按节线裁出后做连通域分析**只保留最大的 2 个组件（两条腿）**——脚底对齐/时序过滤会误伤腿顶，禁用；与腿同连通域的手部残片只能人工逐帧修。**走腿与 idle 对齐（2026-07-26 定稿）**：按 idle 基准（髋 X=217 / 脚底 Y=500）逐帧平移烘焙 sheet——walking 与 idle 天然一致，不要用逐帧髋部跟随机制（已废弃移除，`anims.stop()` 后 `currentAnim` 引用不清空的陷阱也随之失效）。`twist.torsoShiftY`（世界 px）为躯干整体下移微调，统一加在腰轴世界 Y（躯干/肩/枪锚点随动）。
- 新姿态切换一律按武器类型/状态从配置表查键，**禁止新增硬编码分支**。

### 6. 武器贴合调参（左下开发面板）
- **攻击类动作**：面板切"攻击" → 拖帧滑块逐帧摆武器 → 💾保存（写 `attack.frames` perFrame）；▶播放 + `#devToolFps` 输入框预览时长同步观感。新近战动作同一流程。**拆帧无配置时自动播种 30 帧同一基线位置（2026-07-27）**，进入攻击页即可开调；右上角重置键 = 一键把当前动画恢复初始状态（attack=全帧回种子基线，其他=恢复已保存配置；种子只改内存，💾保存才落盘）。
- **朝向翻转（2026-07-27 终极绑定）**：**近战武器朝向一律 = `playerSprite.flipX`**（身体是唯一权威，V0.296 起）——攻击逐帧/定格/收势滑行/idle/walk/副手全部直接读身体 flipX，禁止任何独立的武器朝向判定/捕获；身体 flipX 由 `GameScene._getVisualFacingRight`（|cos(rotation)|>0.05 滞回，存 `player._facingRightVisual`）驱动，攻击/定格/收势期间身体冻结故武器自然冻结。枪械走 twist 面向（±0.05 同源语义）。**近战朝左贴图用 flipX**（关系式 M∘Rot(R)=Rot(−R)∘M；旋转码 π−idleRot 恰等于 −R_r 正确镜像角，补 flipX 构成垂直轴完整镜像——与攻击 perFrame 分支"旋转取反+flipX"同惯例）；位置镜像由 localToWorld 完成。

- **挥砍特效 A+B（2026-07-27 落地，2026-07-29 改残影实现）**：perFrame 帧数据可加 `blurX/blurY` 与 `stretchX/stretchY`（乘 displaySize）——插值/面板输入/保存直写全链路支持；播种用帧间位移推导（峰值帧最强，端点为零）。**游戏内运动模糊 = 残影（afterimage）**：`GameScene._syncWeaponGhosts` 沿 perFrame 轨迹回放 3 道历史姿态武器副本（透明度 0.34/0.23/0.11 递减，步长 0.035~0.085 进度随强度伸缩，强度=max(blurX,blurY) 归一到峰值 12，<1.5 不出残影）——攻击/冲刺两分支共用，攻击结束/弓分支/Tween 分支/地图模式各兜底隐藏。**旧高斯滤镜方案已废弃**：`filters.internal.addBlur` 链路实测"激活但观感失败"——高斯模糊对 3px 宽细剑是能量摊薄，峰值帧剑身近乎消失（CDP 像素级对比取证），且面板大尺寸慢放预览放大了"生效"的错觉。面板预览模糊仍是 canvas filter 近似。
- **📍固定点工具（2026-07-27）**：武器参数区下方按钮——点击进入放置模式后点画布武器即标记（存武器局部坐标，逆变换：平移→反向旋转→÷缩放），红点刚性跟随武器跨帧显示（校准握把/刃尖用）；有标记时点按钮=清除。**面板 DOM 改动注意**：真实面板 DOM 由 `src/ui/panels/dev-tools.js` 程序化构建，`ui/components/dev-tool-panel.html` 是无引用的死文件，勿改。**攻击输入全锁**：`weaponAnim.isAttacking` 期间移动/闪避/新攻击/切武器/冲刺/右键特殊攻击/风车/推击全部无效（注意：闪避不再能取消攻击）。
- **近战连段与收势（2026-07-27）**：perFrame 攻击 Tween 结束时记 `_lastMeleeAttackEnd` 并设 `_attackHoldUntil`（=连段窗口 1000ms）——窗口内定格末帧等待连段（stage 1↔2，`attack_sword`/`attack_sword_2`，武器轨迹按 `_meleeComboStage` 选 attack/attack2 块）；窗口内再攻击派生下一段；无输入则播 `recover` 收势动画回 idle；移动立即取消定格/收势。攻击期输入全锁（见 📍固定点工具条目）。新段（如三段突刺）：加 `attack_sword_3` 姿态+weapon-anim 轮换数组扩展+attack3 轨迹块。

- **逐帧导出交接（2026-07-27 改为直写）**：💾保存 = 内存生效 + **直接合并进 `public/data/weapon-anim-config.json`**（保留 attack 下 trail 等字段，写前滚动备份 `weapon-frames/weapon-anim-config.backup.json`）+ 覆盖写 `weapon-frames/latest.js`（仅记录/回滚参考）+ 剪贴板。**保存即永久生效，无需通知助手合并**；Vite 走 `/__save-weapon-frames` 中间件（改中间件需重启 dev server），Electron 走 `save-weapon-frames` IPC。需回滚时用 backup.json 还原或叫助手处理。**多段轨迹（2026-07-27）**：`attack`/`attack2` 块各存一段轨迹，面板切对应动画页调整即按块保存；运行时连段按 `_meleeComboStage` 选块；`WeaponTransform.getInterpolatedPerFramePosition(..., cfgKey)` 支持选块。
- **静态姿态**（gun_idle 等）：面板拖武器到手上 → 💾保存（每状态 `holdOffsetX/Y + idleRotation/idleScale`）。
- **枪械握把轴心（2026-07-26）**：`WeaponAnimConfig[wt].grip {x, y}`（贴图内握把点 0~1 分数，缺省中心）——游戏内/面板统一以握把为旋转轴与锚点（360 瞄准不滑手）；扭转激活时锚点在躯干空间计算（禁止 localToWorld 按 player.rotation 公转，否则与扭转轨道叠加成双重旋转）。

### 7. 验证
- JSON 双份一致；lint / vite build / test-collider。
- **实机清单**：姿态切换（站立/移动/攻击）、左右镜像 flipX、贴图与武器轨迹时长同步、repeat 0 播完回 idle、面板预览与游戏一致、**主神空间+地牢双场景**（原则 10 全场景生效）。

---

## 装备/道具图标统一处理工作流（2026-08-02 定稿：装备图标放大 + 视觉居中沉淀）

新增装备/道具图标（`iconImage` 类贴图）一律按此处理，保证与武器图标观感一致。

### 1. 判定标准（先量化，别靠肉眼）
- UI 图标显示尺寸由 CSS 固定（`object-fit: contain` 的 44px 等盒子），**PNG 画布像素大小不影响观感**——决定观感的是「内容占画布比例」和「内容是否视觉居中」。
- 与武器图标对齐的实测基准：武器内容包围盒占画布 **86%~98%**（最长边）；装备此前只有 12%~60%，且 **alpha 加权质量中心**偏离画布中心最高 ±400px（壁垒重盔 x=-393、魔力腰带 x=-374、壁垒重靴 x=+279）。
- 量化方法（pngjs 扫 alpha>8）：内容包围盒宽高占比 + 质心偏移。目标：**最长边 ≈90%、质心偏移 = (0,0)**。

### 1.5 抠图（AI 生图一律先抠底，2026-08-03 定稿：本地 BiRefNet 透明抠图）
- **首选：BiRefNet 透明抠图**（`tools/ai-gen/birefnet-cutout.py` 独立脚本 + `tools/ai-gen/birefnet-icon-pipeline.py` 全管线：
  生图 → BiRefNet 透明 PNG → 归一化）。模型权重走 ModelScope 镜像
  `modelscope/BiRefNet`（`model.safetensors`，transformers remote-code 格式，目录
  `ComfyUI/models/BiRefNet/MS-BiRefNet/`），HuggingFace 直连超时、hf-mirror 403，勿再试。
  运行环境用 ComfyUI venv（已装 timm/opencv-headless/transformers）。
- **为什么不用颜色阈值抠图**：SDXL 的"pure white background"实际是浅灰渐变 + 暗角
  （角部像素 140~200 灰），且主体贴边时边界采样会把主体误判为背景（2026-08-03 实测：
  分块背景模型把贴边的镇岳重甲抠成 42×59 碎片；固定近白阈值则整图残留灰底）。
  BiRefNet 是显著性分割模型，不吃背景色假设，边缘毛刺/半透明也稳。
- **生图提示词仍必须写"主体完全在画面内、四周留白"**，否则细长物品（腰带等）延伸到
  画面外被裁切，即使 BiRefNet 也只能抠出残缺主体（2026-08-03 不息腰带两连坑：
  金属徽章误生成、皮带横穿出界被裁；改为"盘绕成圈、完整居中"后通过）。
- 抠图完成后必须验证：`tools/ai-gen/edge-check-*.py` 扫 alpha∈(10,245) 的边缘像素，
  **白色占比应为 0%**（>0.5% 即白边残留，需重抠或重生成）；另跑
  `tools/ai-gen/verify-eclipse-icons.py` 确认 1536² / 内容 90% / 纵横比 ∈[0.72,1.4] / 居中。

### 1.6 装备构图硬性规则（2026-08-03 定稿，AI 提示词必须遵守）
- **靴子/鞋类只生成一只、朝右**：提示词写 `a single right-facing boot, one boot only facing
  right, no pair`；SDXL 常无视 "right-facing" 仍生成朝左，兜底方案是出图后
  `tools/ai-gen/flip-boots-right.py` 水平镜像（单只靴子镜像无左右脚问题）。
  判定用 GLM-4.6V 逐张问"鞋头指向左还是右"。
- **盔甲类要写全下半身**：仅写 "chest piece" 会得到只有胸口的残件，必须写
  `full torso armor from shoulders down to hips, abdominal plates, waist belt,
  faulds (segmented skirt armor), tassets`，并让 GLM 确认"是否有下半身/裙甲"。
- **禁止多余装饰元素**：蚀月套曾反复出现"圆环/光环/圆形徽章"（法帽后方、法袍胸口、
  长靴上方）——negative 必须加 `circular halo, circular frame, circular emblem,
  circular ornament, floating circle, glowing circle behind object,
  ring-shaped decoration around the object, ornamental circle, magic circle`
  （注意不要用裸词 `ring`，会误伤戒指类装备）。

### 2. 处理步骤（一段式 pngjs 脚本）
1. 画布规格：**1536×1536 透明底**（与现有装备图标一致；画布尺寸本身不重要，改动不影响代码）。
2. 裁剪：内容包围盒（alpha>8）。
3. **纵横比归一化（2026-08-02 增补，解决"扁平/细长条看起来小"）**：内容纵横比限制在 **[0.72, 1.4]**——宽扁条（>1.4）沿长轴裁剪到 1.4、细长条（<0.72）沿长轴裁剪到 0.72，裁剪窗口**以视觉重心（质心）为中心**（保住主体/扣件/坠子，裁掉细长尾/链端）；方形图标框（object-fit contain）里所有图标可见尺寸趋于一致。
4. 放大：双线性缩放到最长边 = 画布×0.90（对齐武器 86%~95%）。
5. 居中：**内容包围盒平移到画布中心**（与武器图标同口径——轮廓居中即可；图形本体固有重心偏移属素材构图，不为它缩图/裁切）。
6. 合成回透明画布，覆盖写原文件。

### 3. 验证清单
- 最长边占比 = 0.90；纵横比 ∈ [0.72, 1.4]；包围盒中心偏移 ≤1px；尺寸仍 1536×1536；dev server 加载 200 image/png。
- dev server 加载 200 image/png；商店/装备栏/图鉴实机目检与武器同档。

### 4. 关键点/坑
- **不要按 alpha 加权质心居中**（2026-08-02 实测教训）：魔力腰带/壁垒重盔等素材固有构图偏重，质心居中会把它推到画布一侧甚至被迫缩图（0.60~0.75），观感反而更差——**统一按内容包围盒居中 + 0.90 硬性大小**，与武器图标一致。
- 大小硬性 0.90：最长边 = 画布×0.90，不缩图、不裁切。
- 只统一最长边不够：宽扁条（魔力腰带 2.34:1）在方形图标框里仍只有其他腰带的一半高——**必须做纵横比归一化**（上限 1.4），否则"大小一致"只停留在文件层、观感仍不一致（2026-08-02 实测教训）。
- 图标全链路共用 `iconImage` 字段（装备栏 `slotImage || iconImage`、掉落、图鉴、商店）——改贴图即全局生效，无需改代码。
- 源文件此前保留在 `E:\无尽轮回\游戏\素材库\装备`（原始大图；⚠ 该路径已废弃，
  素材库现约定为 NAS `Y:\素材库\`）；游戏内使用 `assets/icons/equipment/` 的处理后副本；脚本按本流程用 pngjs 现写（临时脚本不入库）。

---

## 装备/首饰添加标准工作流（2026-08-03 定稿，稀有套装入库首航）

新防具/首饰（非武器）一律按此开展。与武器工作流同规格：**equipment.json 双份是唯一数据源**，
图标/掉落/图鉴/商店全链路共用 `iconImage` 字段，改数据即全局生效。

### 1. 数据（data/equipment.json + public/data/equipment.json 双份）
防具条目结构：
```json
{ "name", "type", "icon", "category": "armor", "rarity": "rare", "level": 10,
  "equipSlot": "helmet|armor|boots", "armorSet": "flowing|eclipse|zhenyue",
  "armorSetSlot": "helmet|armor|boots",
  "defense": { "base": 8, "perEnhance": 2 },
  "bonusStats": { "wis": 2 }, "bonusPerEnhance": { "wis": 1.5 },
  "stats": [{ "name": "物理防御", "value": "+8", "pos": true }],
  "desc", "iconImage": "assets/icons/equipment/xxx.png" }
```
首饰条目：`category: "accessory"`、无 defense/armorSet，`bonusStats/bonusPerEnhance`
为六维或 atk/matk/crit/maxHp/maxMp/maxStamina（tooltip 的 attrNames 决定显示名）。
新增条目脚本：`tools/ai-gen/add-eclipse-set-to-equipment.py`（幂等，双份同步，改完跑
`tools/verify-set-shop.mjs` 确认双份一致 + 图标文件存在 + 商店目录齐全——⚠ 该校验脚本已丢失、待重建）。

### 2. 套装键（base.js 三件套判定）
- `calculateCombatStats` 中 `setCount` 按 helmet/armor/boots 同 `armorSet` 计数，
  新键照抄 light/robe/heavy 分支（移速乘子 / `_cooldownReduction` / `_magicDamageBonus`）。
- 稀有三套定稿：`flowing`（移速+15%、体力恢复+12%）、`eclipse`（冷却-18%、魔伤+25%）、
  `zhenyue`（40% 格挡 85%、移速-12%）。
- 体力恢复加成：`updateMaxStats` 里 `_staminaRegenMul` 乘 1.12（装备/祭品倍率之后）。
- 格挡类套装键：`damageable-entity.js` takeDamage 分支按 `_armorSetActive` 区分
  壁垒（30%×80%）与镇岳（40%×85%），统一 `blockCfg { chance, remain }` 结构。

### 3. tooltip（equip-tooltip-manager.js）
`setNames` / `setBonuses` 两个 map 同步补新套装键（防具/首饰分支按 category 命中）。

### 4. 商店（shop-system.js SHOP_CATALOGS.blacksmith）
- blacksmith 目录 = ItemDatabase 装备 id 字符串数组，运行时懒解析（`_equipFromDatabase`），
  缺 price 按稀有度标准价兜底（rare=400）。新装备加 id 即上架，无需完整商品对象。
- 掉落：`chest-room-system.js _equipmentPool()` 自动含全部 armor/accessory（ItemDatabase 数据源），
  新增装备零登记自动进精英宝箱房掉落池。

### 5. 验证四件套
- `tools/verify-set-shop.mjs`（双份一致/图标存在/商店目录/套装件数=3；⚠ 脚本已丢失、待重建，重建前以 JSON 双份比对 + 实机目检代替）
- JSON 双份一致（test-regressions 会拦）；`npm run lint`；`npx vite build`；
  `node scripts/test-config-integrity.mjs`；实机：商店购买 → 装备三件 → 面板套装生效
  （移速/冷却/魔伤/格挡）→ tooltip 套装文案。

### 6. 本次教训（2026-08-03 蚀月/流云/镇岳套首航）
- 数值取整：稀有 = 优质 ×1.25 后**向上取整**（12.5→13），成长保留 0.5 步进；
  属性点取整（1.25→2），保证"不低于 25%"。
- 细长物品（法袍/项链）纵横比裁剪后 alpha 边缘收缩会让 ar 略低于 0.72（0.685），
  强裁会砍下摆——保留原状并在交付说明，不做无谓二次裁剪。
- 用户视角的"没调整/超出边界"常是**新图标与原图撞设计**（心形吊坠撞车）或水印误伤，
  用 GLM 对比新旧图 + 像素边界量化（`tools/check-margins.py`）定位，别只看单文件。

---

## 阶段性进度总结（2026-07-26 续）

### 本次完成：门外白区边缘体系 + 沼泽装饰 + 死亡序列修复
1. **门外白区边缘**：多轮迭代——规则圆弧（太规则）→ 噪声海岸线（阈值/半平面 bug 两连）→ **EQ 柱状图**定稿（柱条沿外法线、柱高=随机游走+尖峰、内部平整实心、柱间细缝、门侧 ±45° 保护、长边扇区限定）。**教训：白区只在进房时烘焙一次，改代码必须重进战斗房验证**。
2. **X 光透视全局停用**：`GameScene._xrayEnabled = false` 开关，代码保留可恢复。
3. **沼泽装饰道具**：4 件素材（柴堆/草茎/树桩/苔石）重管线抠图（泛洪+腐蚀 2px+漂白压暗）；`_spawnFloorDeco` 按晶格 30% 随机摆放（origin 底边贴地、y 排序、cleanup 统一销毁）；配置 `floor.deco`——**注意 `setDungeonFloorProfile` 必须显式透传新字段**（deco 被丢导致不生效的教训）。
4. **矿石蜘蛛死亡序列修复**：game.js 尸体识别只看 `_deathAnimTimer/_corpseTimer/_fadeTimer`（硬约定），自定义字段名导致死亡后 update 被跳过——已对齐标准字段，临终下砸+dying+定格+淡出全部生效。
5. **地砖**：AI 新砖（45°菱形纵向压缩掰 30°）入库试用 `swampbrick_new1`，旧 3 张备份 `swampbrick_old/`；**不同宽度砖不可混铺（网格步进错位）**。

### 关键改动文件
- `src/world/combat-room-system.js`（白区烘焙/装饰生成）、`src/effects/gate-light.js`
- `src/world/dungeon-floor-texture.js`（deco 透传）、`src/entities/enemy-types/ore-spider.js`
- `src/phaser/scenes/GameScene.js`（X 光开关）、`assets/terrain/swamp_*`

### 验证状态
- `npm run lint` ✅（0 error）
- `npx vite build` ✅
- `node scripts/test-collider.mjs` / `test-craft-sync.mjs` ✅

---

## 阶段性进度总结（2026-07-26）

### 本次完成：沼泽地牢墙体全套落地 + 宝箱房体系 + 系列修复
1. **墙样式表 `ISO_WALL_STYLES`**（`{straight, gate, chestPrefab, gateSound, corners?}`，key=dungeonType）：沼泽柴墙/藤门素材管线全套（泛洪抠图+水印 inpaint+腐蚀 2px 去颜色污染+两端锥形裁切；门视频 16 帧反转+连通域过滤）；`buildIsoDiamondWalls`/WallGate/门音效/宝箱房预制/夹角预制全走样式。新地牢换墙四步法已文档化。
2. **夹角**：运行时支持预制夹角（`_placeCornerPrefab`：共享端点锚定顶点、深度按房间规则重算 min/max+编辑器内部顺序保留）；最终四角全部用用户手摆纯直墙预制。
3. **一房一门**：`_setupGate` 优先替换样式门件（装饰门→功能门），无门件回退最近直墙件（跳过 `_corner`）；门闸缩放统一为墙件同尺度（`ISO_WALL_HEIGHT/wallH + slopeFixOf`，修大小墙衔接）。
4. **宝箱房**：按预制原样放置（x/y/scale/flip/depth 仅平移，**不重算**——此前重算图层+门墙缩放归一是"预制图层混乱+缺口"根因）；门墙碰撞从件变换推导；宝箱贴图换 D.png/D-打开.png 静态双图；墙脚阴影（离屏实色+blur 羽化，alpha 0.55）；门纳入 X 光 occluders。
5. **地板**：`overlapX/overlapY` 叠合机制（自然材质必配）；地砖默认随机选图+随机镜像（立约无需声明）；brick-4 泥水砖已剔除。
6. **拼接**：`edgeFill` 废弃均匀拉伸，回定长定高瓦片+overshoot 由转角臂+5 偏置盖住（转角臂统一 +5 已入规则）。
7. **门外白区**：远两角从锐角→圆角路径→最终**分形噪声海岸线淡出**（96/28px 双层值噪声调制保留阈值，每次生成不同）。
8. **关键修复**：`rebuildIsoCollision` 保留 `_gate`/`_chestGate` 门线段（门洞可穿根因）；宝箱房刷怪回退点不再落中心排除区；AttackRangeEffect 警示圈 depth y-998 + 保活重置 life。
9. **诊断日志**：`[DungeonFloor]` 地砖池、`[XRay] 宝箱房门` occluder 注册（排查"修改未应用"类问题先查它）。

### 关键改动文件
- `src/world/wall-system.js`、`src/world/wall-gate.js`、`src/world/chest-room-system.js`、`src/world/combat-room-system.js`
- `src/world/dungeon-floor-texture.js`、`src/world/dungeon-map-system.js`、`src/world/zombie-dungeon.js`
- `src/phaser/scenes/BootScene.js`、`src/phaser/scenes/GameScene.js`、`src/ui/wall-editor.js`
- `assets/terrain/swamp_*`（柴墙/藤门/地砖）、`assets/sounds/environment/swamp_gate.mp3`

### 验证状态
- `npm run lint` ✅（0 error）
- `npx vite build` ✅
- `node scripts/test-collider.mjs` / `test-craft-sync.mjs` ✅

---

## 阶段性进度总结（2026-07-25）

### 本次完成：矿石蜘蛛（精英）+ 沼泽地-高级地牢 + 近战口径统一 + 系列修复
1. **近战命中口径统一**：`_shared/enemy-utils.js` 新增 `inMeleeRange`（与 CombatSystem 触发同语义圆形边缘距离）；矿工/工头/提灯/盾卫/突击/手脑近战命中从 GroundEllipse（垂直半射程）切换；技能 range 读取约定 `skill.range ?? this.attackDistance ?? 默认值`。带地面椭圆圈视觉的范围技能（砸地冲击波/嚎叫/燃烧区）保留椭圆。
2. **新怪物矿石蜘蛛（oreSpider，精英/僵尸）**：投掷晶石（600px 触发、28 帧第 21 帧发射、1s 抛物线+360°/s 旋转、落地红圈警示+100px 物理×1.25+烟尘）；起跳下砸（18 帧第 10 帧阶梯判定 200×2/350×1 不叠加+红圈提示+命中眩晕 2s）；临终一砸（attacking-2 播 14 帧含判定→dying 12 帧→定格 1s→淡出）。精英战抽中它时其余普通怪固定矿工僵尸。
3. **新地牢沼泽地-高级（swamp，C 级）**：55~60 房间、起始 4 路线、怪物/事件/Boss 全用僵尸体系（`_isZombieFamily`+事件 family 映射+'swampDungeon' 配置块）、地板 swampbrick_1/2/3 随机拼接。
4. **系列修复**：玩家流血不扣血（基类 _updateBleed 扣 this.hp 而玩家真实 HP 是 data.hp；玩家专属流血/中毒块+无敌闸门）；无敌开关全场景生效；`colliderOffsetY` 必须写 render 块（核心规则 6）；AttackRangeEffect 警示圈 depth 统一 y-998（实体之下）且保活必须重置 `life`（不是 maxLife）；AI 素材对齐前先提高 alpha 阈值区分本体与残影。
5. **工头鞭子特效重写**：扫掠扇面+柄粗梢细+末梢爆点，220ms，每次鞭击一条。

### 关键改动文件
- `src/entities/enemy-types/ore-spider.js`（新增）、`_shared/enemy-utils.js`
- `src/entities/damageable-entity.js`（状态免疫 statusImmune）
- `src/entities/player/update.js`、`src/entities/player/subsystems.js`
- `src/effects/attack-range-effect.js`
- `data/enemy-config.json`、`data/dungeon-config.json`
- `src/config/dungeon-config.js`、`src/world/dungeon-map-system.js`、`src/world/dungeon-event-system.js`、`src/world/zombie-dungeon.js`
- `src/phaser/scenes/BootScene.js`、`src/game.js`

### 验证状态
- `npm run lint` ✅（0 error）
- `npx vite build` ✅
- `node scripts/test-collider.mjs` / `test-craft-sync.mjs` ✅

---

## 阶段性进度总结（2026-07-13 晚间收尾）

### 本次完成：胖子僵尸、按场次 Buff/Debuff、地牢流程与受击粒子修复

#### 一、胖子僵尸（Fat Zombie）完整机制
1. **贴图放大 25%**：`data/enemy-config.json` 中 `fatZombie.render.spriteSize` 150（120→150），碰撞体积保持 90×120。
2. **尸体腐蚀领域**：死亡后进入 corpse 阶段，继续执行 `_updateAura`；腐蚀区域改为 100×25 并向下偏移 70px，与尸体贴图对齐。
3. **攻击/命中**：`attackRange` 100，`dynamicRange` 120，解决胖子攻击频繁落空问题。

#### 二、战斗系统收尾
1. **远程物理减伤**：`src/entities/damageable-entity.js` 对 `!isMelee && physical` 类型伤害也应用远程减伤。
2. **按场次 buff/debuff 状态栏**：`src/ui/status-bar.js` 支持 `battleRemaining`；统一消耗所有非永久 buff。
3. **僵尸巫师 AI**：`src/entities/enemy-types/zombie-wizard.js` 冰锥/火球入口增加 `castRange` 检查，未进入射程时先普攻/召唤。

#### 三、地牢流程与资源配置
1. **empty 节点通行**：统一在 `_leaveCombatViaPortal` 中标记节点完成，移除普通分支提前置空。
2. **精灵图偏移配置**：`scripts/generate-sprite-offsets.js` 扩展为所有敌人动画表生成 `data/sprite-offsets.json`。
3. **图鉴 idle 放大截取**：使用 `idleSheetColumns` 计算背景尺寸，修正第一帧显示过小。

#### 四、主神空间测试
1. 生成原设定数值的胖子僵尸。
2. 左下角新增“无敌”切换按钮；`SceneManager._mainHubInvincible` 控制玩家是否受伤（2026-07-25 起全场景生效，含地牢；流血/中毒 dot 同样被闸门拦截不扣血）。

#### 五、僵尸受击绿色粒子修复
1. **统一触发**：在 `src/entities/damageable-entity.js` `takeDamage()` 扣血后统一调用 `triggerZombieHitParticles`，移除各技能系统的重复触发。
2. **Phaser 4 粒子坐标陷阱**：
   - `this.add.particles(x, y, texture, config)` 把发射器放在 `(x,y)`，但 `explode(count, x, y)` 的参数是相对于发射器的**本地坐标**。
   - 错误写法会让粒子世界坐标变成 `(2x, 2y)`，从而飞出视野。
   - 正确写法：`this.add.particles(0, 0, texture, config)` + `particles.explode(count, worldX, worldY)`。
3. **必须加入 UpdateList**：`this.add.particles()` 默认不会把发射器加入 Scene 的 UpdateList，需要手动调用 `particles.addToUpdateList()`，否则粒子只会静止一帧，不会运动/死亡。
4. 修复后手动调用 `scene.playZombieHitParticles(worldX, worldY, angle)` 可看到绿色粒子爆发。

### 关键改动文件
- `src/phaser/scenes/GameScene.js`
- `src/entities/damageable-entity.js`
- `src/entities/enemy-types/fat-zombie.js`
- `src/entities/enemy-types/zombie-wizard.js`
- `src/ui/status-bar.js`
- `src/world/dungeon-map-system.js`
- `src/world/scene-manager.js`
- `scripts/generate-sprite-offsets.js`
- `data/enemy-config.json`
- `data/sprite-offsets.json`

### 验证状态
- `npm run lint` ✅
- `npx vite build` ✅

---

## 伪 3D 碰撞重构记录（进行中）

### Phase 0：统一 Collider 数据层 ✅
1. 新增 `src/physics/collider.js`：
   - 地面 footprint 为圆形（`groundRadius`）。
   - 垂直体积为胶囊体（`height` + `radius`）。
   - 默认高度推导：`config.height > render.spriteSize > collisionHeight > radius*2`。
2. 新增 `src/physics/collision-3d.js`：
   - 3D 线段到胶囊体距离（用于投射物/近战）。
   - 线段到线段最短距离、球体相交等辅助函数。
3. 新增 `src/physics/spatial-grid.js`：2D 空间网格 broadphase。
4. `Entity` 基类接入 `collider`、新增 `groundRadius` / `bodyHeight` 统一入口，不改动现有属性。
5. Player 与 Enemy 在碰撞字段最终确定后调用 `rebuildCollider()`。
6. 新增 `scripts/test-collider.mjs` 跑通推导、3D 命中、空间网格测试。

### Phase 1：地面碰撞统一为圆形 footprint ✅
1. `game.js::resolveCollisions()` 从“矩形/六边形/圆形多套分离”简化为统一的圆-圆分离，使用 `groundRadius`。
2. `MovementSystem`、玩家移动、敌人 AI、冲刺、击退、`PathManager`、`DynamicObstacleMap` 全部改用 `groundRadius`。
3. `WallSystem` 的树木新增 `height` 字段，为未来飞行单位做准备。
4. 玩家 footprint 按方案 A 改为圆形，半径保持 30（与原 `collisionRadius` 一致）。

### Phase 2：投射物判定 3D 化 + 空间网格 broadphase ✅
1. `src/combat/projectile.js` 重写命中判定：
   - 投射物增加 `z` / `prevZ`，轨迹视为 3D 线段。
   - 使用 `segmentIntersectsCapsule` 与目标 Collider 胶囊体做精确检测。
   - 移除旧的 2D 矩形扩张 / 圆心距离判定。
2. Broadphase：
   - 复用现有 `SpatialPartitionSystem.queryRadius`。
   - 以投射物本帧路径中点为中心，查询半径 = `stepLen + 160`，只检测附近实体。
   - SpatialPartitionSystem 不可用时回退到全量遍历。
3. 自然支持高低差：地面投射物 z=0，飞行单位 z>0 时自动打不到；未来抛物线/对空投射物只需设置 z。

### 后续 Phase 状态（2026-07-17 核实，均已完成）
- Phase 3：近战 / 技能 AOE 3D 化 ✅（变更记录 v2.0）
- Phase 4：场景贴图 Y 深度排序 ✅（变更记录 v2.1）
- Phase 5：清理旧命中系统与可视化对齐 ✅（变更记录 v2.2）
- 详见下方"变更记录" v2.0–v2.4

### 补充：投射物躯干矩形判定（方案 B，2026-07-17）✅

**问题**：投射物命中只看脚下 footprint 椭圆（+ 3D 世界胶囊），玩家与目标同一水平轴时，瞄准贴图身体（躯干/头部）子弹会穿过——子弹在地面平面飞行，贴图躯干在"身后"的屏幕行。

**方案**：新增屏幕空间**躯干矩形**判定，仅投射物使用；近战判定（attack.js / skill-shapes.js）不变。

**共享模块 `src/physics/torso-hitbox.js`（唯一推导口径，禁止重复编码）**：
- `getTorsoRect(entity)`：取 `config.render.projectileHitbox`（width/height/offsetX/bottom，锚定 collider 脚底中心）；缺省 = `collisionWidth × 身高`（新怪物零配置自动获得）。
- `segmentHitsTorso(entity, x1, y1, x2, y2, expand)`：枪械投射物扫掠线段判定。
- `pointHitsTorso(entity, px, py, expand)`：技能投射物逐帧点判定，FLYING 免疫（与 GroundCircle 语义对齐）。

**判定并集**：
- 枪械投射物（projectile.js）：footprint 椭圆 ∪ 躯干矩形 ∪ 身体圆柱；飞行目标仍只查 3D 胶囊。
- 技能投射物飞行命中：冰锥(r=12)/火球(r=20)/符文剑(r=15) = GroundCircle ∪ 躯干矩形；火球爆炸 AOE 维持 GroundCircle 不动。

**逐怪数值**：7 只精灵图怪物按首帧内容边界实测（`scripts/archive/measure-projectile-hitbox.py`，内容宽高 × spriteSize/帧宽）写入 `enemy-config.json` 的 `render.projectileHitbox`。

**调试可视化**：左下"范围"按钮显示**绿色躯干矩形**（GameScene._syncCollisionRadii，与判定同一推导）。

**单测**：`scripts/test-collider.mjs` 22 个躯干矩形用例（含推导/点判定/缺省/FLYING 免疫）。

---

## 技术回顾与清理（2026-07-13）

### 审查范围
对 2026-07-11 至 2026-07-13 的提交进行了渲染、碰撞/AI、地牢流程三个方向的并行审查，重点排查并行系统、冗余代码和潜在 bug。

### 发现并修复的高优先级问题

#### 1. 渲染层：地图模式下 Phaser 对象残留
- **问题**：`GameScene.update()` 的地图模式分支只隐藏了玩家/武器/特效/地形/HUD，遗漏了敌人精灵组、中立实体（NPC/训练靶/传送门标签）和其他施法者特效（僵尸巫师的冰锥/火球）。
- **修复**：在该分支追加隐藏 `this.enemies`、`this._neutralSprites`、`this._magicSprites`；非地图模式恢复显示。
- **优化**：新增 `_mapModeActive` 缓存，避免每帧重复调用 `setBackgroundColor`。

#### 2. 双重碰撞系统：玩家 Phaser collider 与 WallSystem
- **问题**：`setupColliders()` 始终添加 `playerSprite-vs-walls` 的 Phaser collider，但默认模式下 `body.moves=false`，由 `WallSystem.resolve` 处理；若误开 `_useVelocityDrive` 会产生双重阻挡/抖动。
- **修复**：仅在 `_useVelocityDrive === true` 时启用该 collider；`body.moves` 初始值与 `_useVelocityDrive` 同步。

#### 3. 动态障碍图：每帧多次刷新
- **问题**：`PathFinder.findPath()` 每次调用都执行 `dynamicObstacleMap.update()`，每个敌人寻路都会触发一次（内部有 250ms 节流，但仍属多余）。
- **修复**：将刷新移到 `MovementSystem.update()`，每帧最多一次；`PathFinder` 不再主动刷新。

#### 4. Mutant-3 连击突进无限累加
- **问题**：五连击每次命中都向 `_comboLungeDx/Dy` 累加，目标后退时单次连击总突进可能远超预期。
- **修复**：增加单次连击总突进上限 80px，命中时按剩余预算计算本次突进距离。

#### 5. 投射物：阵营检查顺序与 piercing 语义
- **问题**：友军免疫判断在 `hitTargets.has(entity)` 之后，逻辑顺序不当；`piercing < 0` 使 `piercing=1` 需要再命中一次才消失。
- **修复**：将阵营检查提到最早 continue 条件；piercing 判定改为 `<= 0`。

#### 6. 地牢流程 bug
- **empty 节点截断路线**：点击 empty 节点后未更新 `currentNodeId`，导致无法继续向后续节点前进。已改为更新当前节点并揭示邻居。
- **奖励节点卡死**：`_enterReward` 回调未标记节点完成/胜利，玩家领取奖励后卡住。已改为标记 `empty` 并调用 `_showVictory()`。
- **女神祝福不消耗**：`_cleanupCombat()` 是 dead code，正常离开战斗的 `_leaveCombatViaPortal` / `_leaveBossViaPortal` 未调用 `onCombatComplete`。已提取 `_consumeCombatBuffs()` 并在三条离开路径调用。

#### 7. 战斗房配置：`minWallDistance` 未读取
- **问题**：`data/dungeon-config.json` 中的 `spawn.minWallDistance` 未被 `createCombatRoomConfig()` 读取，怪物生成时失效。
- **修复**：在默认配置中增加 `minWallDistance: 0`，并从 JSON 读取覆盖。

### 冗余清理

#### 1. 移除废弃的默认地牢分支
- `DungeonMapSystem.generateMap()` 中 `dungeonType` 分支已废弃（`expedition-system.js` 写死为 `'zombie'`）。
- 删除 `_generateDefaultMap()` 方法、`DungeonMapGenerator` 导入，并将 `generateMap()` 简化为直接调用 `_generateZombieMap()`。

#### 2. 移除僵尸地牢中的占位/死代码
- 删除 `ZombieDungeonEvent` 占位类及其默认导出。
- 删除 `DungeonMapSystem` 中的 `_enterShop()`（无 `shop` 节点调用）、`_enterLegacyEvent()`、`_showEventUI()`、`_showEntryConfirm()` 等死代码。
- 移除不再使用的 `UIState`、`ShopSystem` 导入。

#### 3. 归档一次性脚本
- 将 `scripts/` 下的迁移/重构一次性脚本移入 `scripts/archive/`，保留可复用脚本（`backup.js`、`bump-version.js`、`copy-assets.js`、`diagnose-coordinates.js`、`fps-test-tool.js`）在根目录。

### 关键改动文件
- `src/phaser/scenes/GameScene.js`
- `src/combat/projectile.js`
- `src/entities/enemy-types/mutant-3.js`
- `src/ai/pathfinder.js`
- `src/systems/movement-system.js`
- `src/world/combat-room-system.js`
- `src/world/dungeon-map-system.js`
- `src/world/zombie-dungeon.js`
- `scripts/archive/`（新增归档目录）

### 验证状态
- `npm run lint` ✅
- `npx vite build` ✅

### 已完成的后续优化（2026-07-13 续）

#### 1. 投射物 swept 检测
- 在 `projectile.js` 中改为 `_isHittingEntity(entity, prevX, prevY)`：
  - 矩形目标：将碰撞体按投射物 `size` 扩张后，检测线段是否穿过扩张矩形边或端点是否在内。
  - 圆形/其他目标：计算前一点到当前点线段到圆心最近距离，并与扩张半径比较。
- 新增 `_segmentsIntersect` 和 `_segmentPointDistance` 辅助函数。

#### 2. `_tryUnstuck` 瞬移距离缩短
- `MovementSystem._tryUnstuck` 的瞬移距离从固定 `30px` 改为 `Math.max(r * 1.5, 12)`，降低越过薄墙风险。

#### 3. `RegionIndex` 8 方向 Flood Fill
- `region-index.js` 的 Flood Fill 方向从 4 方向扩展为 8 方向，与 `PathFinder` 移动方向一致。

#### 4. `PathFinder` 网格对象池
- 在 `PathFinder` 构造函数中预分配 64×64 的格子对象池。
- `_buildGrid` 在尺寸不超过池大小时复用对象，避免每帧为每个寻路敌人创建大量临时对象。

#### 5. `NPCDialogue` 私有字段访问
- 在 `npc-dialogue.js` 增加公开方法 `isActive()`。
- `ZombieDungeonShop.isClosed()` 改用 `NPCDialogue.isActive()`。

#### 6. 地形纹理同步时机
- `GameScene.update()` 中移除每帧 `_syncTerrain()` 调用。
- `GameScene` 新增公开 `syncTerrain()` 方法，在 `create()` 中调用一次。
- `scene-manager.js` 各 `_loadSceneX()` 设置 `Renderer.terrainTexture` 后调用 `syncTerrain()`。
- `combat-room-system.js` 生成战斗房地板后调用 `syncTerrain()`。

### 新增地牢随机事件（待审核后接入）
- 新增 `src/world/dungeon-event-definitions.js`，定义 10 个互不重复的地牢随机事件。
- 每个事件至少 2 个选择分支，使用力量/敏捷/体质/智力/精神/幸运进行检定。
- 通用处理器 `handleNewDungeonEvent` 支持属性检定、金币/药水/材料/特殊道具、伤害/恢复、战斗、揭示节点、临时 Buff 等结果。
- 接入方式：在 `dungeon-event-system.js` 的 `eventWeights` 注册权重，并在 `handleChoice` 中增加 default 分支调用 `handleNewDungeonEvent`。

### 仍待后续跟进
- 新事件的临时 Buff 需要在 `DungeonBuffSystem.getAtkBonusPercent` 或战斗系统中纳入加成计算。
- 新事件接入后需实机测试检定概率与奖励平衡。

---

## 阶段性进度总结（2026-07-13 续）

### 本次完成：僵尸地牢地板/路线地图修复 + 精英判定/投射物/怪物机制收尾

#### 一、僵尸地牢地板与背景
1. **blackbrick 地板**：`CombatRoomSystem._generateTerrain()` 改为纯黑背景 + `blackbrick.png` 平铺地板（256×256 repeat），并在地板四周叠加 64px 黑→透明渐变，实现与纯黑背景的自然过渡。
2. **贴图加载**：`BootScene.js` 已加载 `assets/terrain/blackbrick.png`；`GameScene._syncTerrain()` 直接使用 `Renderer.terrainTexture` 覆盖地形。
3. **相机背景**：`GameScene` 在非地图模式保持 `setBackgroundColor('#000000')`，确保战斗/主场景外区域纯黑。

#### 二、路线选择地图可见性修复
1. **问题**：设置纯黑相机背景后，路线选择地图被 Phaser Canvas 黑色背景遮挡。
2. **修复**：在 `GameScene.update()` 的地图模式分支中，将相机背景设为透明 `rgba(0,0,0,0)`，露出下方 `Renderer.canvas` 绘制的路线地图；战斗/非地图模式恢复纯黑。

#### 三、起点路线数量修复
1. **问题**：僵尸地牢起点只出现 2 条路线（第 1 列节点随机生成 2~4 个）。
2. **修复**：`ZombieDungeonMapGenerator.generate()` 在节点数调整完成后，强制第 1 列包含所有行（`rows=4`），配合 `_buildEdges` 中“起点连接第 1 列所有节点”的逻辑，确保起点始终 4 条分支。

#### 四、怪物与战斗机制收尾
1. **Mutant-3 五连击突进**：判定距离放宽到 350，突进改为插帧平滑移动（500 px/s，每段最多 35px），带 `WallSystem.resolve` 撞墙校验，不再瞬移。
2. **毒液僵尸投射物**：从头部射出，延迟到攻击动画第 12 帧发射；投射物碰撞与贴图大小统一为配置 `attack.width` 的 3 倍；`projectile.js` 对矩形碰撞体使用 AABB 相交判定。
3. **NPC 立绘**：统一使用固定 `bottom` 像素定位，调整工具仅保留水平拖动；`npc-portrait-tool.js` 默认参数使用 `bottom`。
4. **精英判定唯一来源**：以 `data/enemy-config.json` 的 `rank` 为唯一来源；`ZombieDungeonCombat` 怪物池按 `rank` 动态构建；`Enemy` 实例继承 `rank`/`type`/`category`。
5. **主神空间清理**：移除主神空间的突变体-3 和毒液僵尸测试生成。
6. **毒液僵尸 walking 贴图替换**，并新增独立 `spitter-zombie.js` 类管理延迟吐息。

### 关键改动文件
- `src/world/combat-room-system.js`
- `src/world/zombie-dungeon.js`
- `src/phaser/scenes/GameScene.js`
- `src/phaser/scenes/BootScene.js`
- `src/entities/enemy-types/mutant-3.js`
- `src/entities/enemy-types/spitter-zombie.js`
- `src/entities/enemy.js`
- `src/combat/projectile.js`
- `src/ui/npc-portrait-tool.js`
- `src/game.js`
- `data/enemy-config.json`
- `assets/terrain/blackbrick.png`（新增）
- `assets/enemies/spitter_zombie/walking.png`（新增/替换）

### 验证状态
- `npm run lint` ✅
- `npx vite build` ✅

---

## 阶段性进度总结（2026-07-13）

### 本次完成：AI 寻路优化 + 僵尸犬修复 + 图鉴修复 + 地牢事件与怪物碰撞优化

#### 一、AI 寻路与怪物拥堵优化
1. **路径跟随期间启用分离力**：`_followPath()` 调用增强版 `_computeSeparation()`，拥挤时允许偏离路径点绕过同伴。
2. **分离力增强**：半径改为 `collisionRadius * 1.8`（24~80），检查数量从 5 提升到 12，加入距离衰减与随机抖动。
3. **攻击范围渐进减速**：`dist <= attackRange * 0.9` 才开始减速，`dist <= attackRange * 0.5` 完全停车，前排不再一进入范围就堵死道路。
4. **CombatSystem 攻击缓冲**：攻击判定距离放宽到 `attackRange * 1.15`。
5. **缩短近战 AI 决策间隔**：普通/次级近战怪 `aiInterval` 从 2000ms 降到 800~1200ms。
6. **侧翼包抄**：`_computeMoveDirection` 中当目标周围 ≥2 个同伴时，向人数更少的一侧偏移 45°~75°，选择 persisted in `_flankSide`。
7. **卡住 reposition**：寻路失败时设置 600ms 临时侧向 `_tacticalTarget`，而不是随机乱转。
8. **动态障碍图**：新增 `src/ai/dynamic-obstacle-map.js`，每 250ms 采样敌人位置，密集区域（≥3 敌人）在 A* 中增加 3.5x 移动成本，让后续怪物主动绕行。
9. **寻路缓存适配动态障碍**：起点/终点附近有动态障碍时跳过缓存，避免使用过期低成本路径。
10. **BFS 预检收紧**：`isReachable()` 步数耗尽后返回 `false`，避免对不可达目标执行昂贵 A*。
11. **性能保护**：侧翼统计每 200ms 缓存一次，使用平方距离避免每帧开方，并限制最多遍历 80 个实体；动态障碍图每 250ms 重建一次，cell 自动衰减清理。

#### 二、僵尸犬攻击动画修复与参数调整
1. **攻击动画不显示修复**：`ZombieDogEnemy` 之前继承 `CircleEnemy`，攻击时 `_attackTimer` 永远不会被设置，导致 `_animState` 无法进入 `attack`。已新增 `_attackDuration = 600` 并覆盖 `triggerWeaponAnim()` 设置 `_attackTimer`；`update()` 中递减 `_attackTimer`。
2. **参数调整**：`aiInterval` 和 `attack.cooldown` 均改为 1500ms（攻击间隔 1.5s）；`speed` 从 168.75 提升到 219.375（+30%）。

#### 三、图鉴模块修复
1. **根因**：`src/items/item-database.js` 静态导入了 `CodexManager`，而 `codex-manager.js` 又静态导入 `ItemDatabase`，形成循环依赖，导致 `ItemDatabase` 在图鉴初始化时为 `undefined`。
2. **修复**：移除 `item-database.js` 的静态导入，改为 `addItem()` 中动态导入刷新；同时初始化 `currentEquipCategory: "all"`，避免装备页默认空白。

#### 四、交互开发工具坐标工具修复
1. **现象**：点击「📐 坐标工具」按钮后，遮罩层/面板无法显示，框选矩形不出现，坐标值不更新，无法记录。
2. **根因**：`coordOverlay` 与 `coordPanel` 被创建在 `uiLayer` 内部，而 `uiLayer` 设置了 `pointer-events: none`；坐标工具代码仅依赖内联 `style.display` 切换显示，未使用 CSS 的 `.active` 类，也未将层提升到 `document.body`，导致事件可能被父层截断或层级受限于 `uiLayer`。
3. **修复**：
   - `_startCoordTool()` 启动时把 `coordOverlay` / `coordPanel` 移动到 `document.body`，脱离 `uiLayer` 的 `pointer-events: none`。
   - 同时添加 `.active` 类并设置 `style.display`，与 CSS 规则保持一致。
   - 启动前调用旧的 `_coordToolCleanup()`，防止重复绑定事件。
   - `mouseup` 事件绑定到 `window`，避免拖出窗口后释放导致框选丢失。
   - 增加 `overlay` / `panel` 缺失的防御性检查，并在控制台输出调试日志。
4. **二次修复（Infinity/NaN）**：
   - 根因：非地牢地图模式下 `Renderer` 会把原始 `gameCanvas` 设为 `display: none`，`getBoundingClientRect()` 返回宽高为 0，导致 `gameCanvas.width / 0 = Infinity`，所有坐标计算变成 `Infinity/NaN`。
   - 修复：`getGameScale()` 中仅当 `canvasRect.width/height > 0` 且计算结果有限时才使用缩放，否则回退到 `scaleX/Y = 1`（即 CSS 像素）。
   - 最终输出统一经过 `safe()` 函数处理，防止任何异常值写入面板。

#### 五、地牢随机事件对话框落地坐标
1. **需求**：将地牢随机事件对话框/选择框/结果框按坐标工具测得的位置摆放：`left: 151px; bottom: 88px; width: 1567px; height: 243px`。
2. **实现**：
   - `DungeonEventSystem._showEventUI()` 与 `_showResultUI()` 的事件面板改为固定定位在上述坐标，不再居中显示。
   - 面板内部改为左右分栏：左侧占满剩余宽度展示标题与剧情描述，右侧固定 420px 放置选择按钮/继续按钮。
   - 全屏遮罩改为半透明暗色（`rgba(0,0,0,0.45)`），保留点击拦截但不遮挡游戏画面。
3. **剧情与判定数值完善**：
   - 5 个事件（女神像、陷阱、补给堆、宝箱、恶魔雕像）的剧情描述扩展为更具氛围的长文本。
   - 陷阱/补给堆选择按钮新增「描述 + 检定属性 + 当前属性值 + 成功率」的副标题。
   - 判定基础成功率调整：解除陷阱 25%（敏）、强行跨越 30%（体）、仔细搜寻 40%（精）、探查四周 35%（敏）。
   - `data/dungeon-config.json` 与 `src/world/dungeon-event-system.js` 默认配置保持一致。

#### 六、地牢事件 UI/流程修复
1. **事件结果不再创建浮动文字**：`_showResultUI()` 中移除 `FloatingTextEffect`，避免事件结束后残留黄/红文字。
2. **事件遮罩改为不透明纯黑**：`_showEventUI()` 与 `_showResultUI()` 的全屏遮罩从 `rgba(0,0,0,0.45)` 改为 `rgba(0,0,0,1)`。
3. **浮动文字主动清理**：`EffectManager.clearFloatingTexts()` 会遍历并销毁 Phaser 文本对象；`DungeonMapSystem._returnToMap()` 调用该方法，确保返回地图时无残留。
4. **事件节点状态流转**：事件结束后节点变为 `empty`；陷阱节点仅在成功解除（`result.success === true`）后才变 `empty`，失败保留可再次尝试。

#### 七、怪物寻路/碰撞优化
1. **分离力修复**：`_computeSeparation` 改为优先使用传入的 `entities` 参数（修复忽略参数的 bug），并回退到 `Game.entities`。
2. **分离力增强**：从加权平均改为反平方累加，近距离排斥更强；贴身战斗时自动降低分离权重，限制最大分离力避免过度漂移。
3. **敌人墙壁碰撞单一权威**：`GameScene.setupColliders()` 移除 `enemies-vs-walls` 的 Phaser collider，保留 `player-vs-walls`，让 `WallSystem.resolve()` 成为敌人碰撞唯一权威，解决贴墙/墙角怪物被 Phaser 物理钉死的问题。
4. **墙壁解析脱困 fallback**：`WallSystem.resolve()` 在标准滑动与步长回退均失败后，尝试沿移动方向切线方向侧向滑动。
5. **卡死恢复**：`MovementSystem._tryUnstuck(enemy)` 在敌人尝试移动但连续 30 帧位移 < 0.5px 时，沿 8 个方向寻找合法位置小幅瞬移；静止或目标在攻击范围内时不触发。
6. **安全生成边距**：`CombatRoomSystem.spawnMonsters()` 生成怪物后，若其碰撞半径位置被墙/障碍阻挡，则调用 `WallSystem.findSafeSpawn()` 沿螺旋外推重新定位。
7. **RegionIndex 树木半径对齐**：`region-index.js` 中树木阻挡半径与 `WallSystem` 一致，使用 `t.collisionRadius || t.radius * 0.6`。

#### 八、僵尸犬奔跑贴图再次修复
1. **补齐 idle 动画**：`BootScene.js` 为 `enemy_zombie_dog_idle` 创建单帧循环动画 `zombie_dog_idle`，避免 idle 状态时调用 `sprite.anims.stop()` 中断动画系统。
2. **动画同步增加 isPlaying 检查**：`GameScene._syncEnemyAnimation()` 在 `current.key !== animKey` 之外增加 `!sprite.anims.isPlaying`，动画意外停止时自动重新播放；找不到动画时不再强制 stop。
3. **相对阈值与滞后**：`ZombieDogEnemy.update()` 将 `run/walk/idle` 阈值从固定 `1.2/0.1` 改为基于 `maxSpeed` 的比例（run≈30%、walk≈5%），并加入滞后区间与 80ms 最小保持时间，防止在攻击范围边缘因摩擦反复切换动画状态导致奔跑贴图“卡住”。

#### 九、战斗完成顶部提示栏
1. **复用场景切换提示样式**：`SceneManager` 新增 `showTopNotification(text, options)`，与 `_showSceneLabel()` 使用相同的 DOM/CSS/动画（`top:210px` 居中、`#d4c5a9`、`48px`、字重 700、`sceneLabelFade` 3 秒淡出）。
2. **战斗完成触发提示**：`DungeonMapSystem.updateCombat()` 在战斗完成并生成出口传送门后，调用 `SceneManager.showTopNotification('已完成战斗，寻找传送门离开')`。

### 关键改动文件
- `src/systems/movement-system.js`
- `src/systems/combat-system.js`
- `src/ai/dynamic-obstacle-map.js`（新增）
- `src/ai/pathfinder.js`
- `src/ai/region-index.js`
- `src/entities/enemy-types.js`
- `src/effects/effect-manager.js`
- `src/items/item-database.js`
- `src/phaser/scenes/BootScene.js`
- `src/phaser/scenes/GameScene.js`
- `src/ui/codex-manager.js`
- `src/ui/dev-tool.js`
- `src/world/combat-room-system.js`
- `src/world/dungeon-event-system.js`
- `src/world/dungeon-map-system.js`
- `src/world/scene-manager.js`
- `src/world/wall-system.js`
- `data/enemy-config.json`
- `data/dungeon-config.json`

### 验证状态
- `npx eslint src --max-warnings=0` ✅
- `npx vite build` ✅

---


## 阶段性进度总结（2026-07-12）

### 本次完成
1. **怪物贴图兜底与碰撞扩大**：敌人无 Phaser Sprite 时自动创建 `enemy_circle` 占位；`getOrCreateEnemySprite` 默认纹理改为 `enemy_circle` 并加入缺失回退；敌人碰撞半径在 `_configureEnemyBody` 中扩大一倍。
2. **毒液僵尸投射物调整**：速度从 `1080` → `540` → `270`，纹理改为绿色实心圆，显示尺寸缩小 30%（`this.size * 1.4`）。
3. **地牢全图索敌**：`zombie-dungeon.js` 工厂给所有地牢僵尸覆盖 `aggroRange: 9999`、`alertRange: 9999`、`loseTimeout: 999999`。
4. **战后传送门名称去重**：`_syncEntityHud` 识别 `entity.noNameLabel`，避免 `CombatExitPortal` 被重复画名字。
5. **僵尸犬精灵图动画**：从外部素材库统一为 512×512 帧，输出 `zombie_dog_idle/walk/run/attack.png`；`BootScene` 加载并注册动画；新增 `ZombieDogEnemy` 类；`GameScene` 新增 `_syncEnemyAnimation` 同步纹理/翻转/动画状态。
6. **主神空间测试用怪清理**：删除原来的 5 只测试圆形敌人，改为生成一只僵尸犬；每次回到主神空间自动清理怪物并重新生成。
7. **Bug 修复（武器变圆）**：`_syncEnemyAnimation` 被错误对所有 `_phaserSprite` 实体执行，导致中立实体贴图被强制改为 `enemy_circle`。已限定为 `entity._faction === 'enemy'`。

### 关键改动文件
- `src/phaser/scenes/GameScene.js`
- `src/phaser/scenes/BootScene.js`
- `src/entities/enemy-types.js`
- `src/world/zombie-dungeon.js`
- `src/world/scene-manager.js`
- `src/game.js`
- `src/combat/projectile.js`
- `data/enemy-config.json`

### 验证状态
- `npx eslint src --max-warnings=0` ✅
- `npx vite build` ✅

## 阶段性进度总结（2026-07-11）

### 本次完成
1. **NPC 对话与交互修复**：修复 Phaser viewport 与鼠标坐标换算不一致，NPC 点击正常进入对话。
2. **掉落物拾取**：左键/Z 键拾取后正确销毁 Phaser Sprite 并从实体列表删除，无视觉残留。
3. **玩家与武器显示**：玩家贴图与逻辑位置同步偏差 0.00；武器 Sprite 每帧同步位置/旋转/贴图；根据 `_facingDir` 自动翻转并加入 80ms idle 缓冲避免动画抖动。
4. **HUD 布局还原**：恢复 DOM HUD（顶部栏、底部 HP/体力、武器信息、操作提示、小地图），Phaser 仅保留经验条、Buff/Debuff、屏幕特效。
5. **NPC 名字去重**：`_syncEntityHud` 跳过自带标签的 NPC/训练靶/掉落物。
6. **移动卡顿/瞬移修复（核心）**：敌人 A* 寻路对远距离目标会生成巨大网格，单次 `findPath` 可达 150ms+，跑动越久触发越多导致卡顿。已在 `PathFinder` 限制 `maxSearchRange=800px`，并在 `MovementSystem` 中目标距离超过 800px 时跳过寻路、直接直线移动。

### 关键改动文件
- `src/ai/pathfinder.js`
- `src/systems/movement-system.js`
- `src/phaser/scenes/GameScene.js`
- `src/game.js`
- `src/utils/perf-monitor.js`（临时调试计时器，可后续清理）

### 验证状态
- `npx eslint src --max-warnings=0` ✅
- `npx vite build` ✅
- 实机测试：持续跑动不再卡顿

---

## 核心规则

1. **Phaser `spritesheet` 加载时必须带 `endFrame`** — 防御性配置，防止图片高度差1像素导致帧数错误
2. **所有精灵图在入代码前必须跑标准化脚本** — 统一内容大小和中心位置，避免代码手动调 spriteSize
3. **精灵图尺寸必须严格是 `frameSize × cols × rows`** — 不足时脚本自动填充透明行
4. **敌人动画同步必须限定 `_faction === 'enemy'`** — `_syncEnemyAnimation` 这类按实体刷新的逻辑只能作用于敌人，否则会把中立实体/掉落物/特效 Sprite 的纹理错误覆盖为 `enemy_circle`
5. **外部素材导入前先检查实际帧布局** — 如僵尸犬 4096×4096 合并图是 8×8 的 512×512 网格，但有效帧可能只有一行；导入前用脚本/工具确认非空帧数，避免加载空白帧
6. **敌人的 `colliderOffsetY/X` 必须写在 `render` 块内** — `enemy.js` 基类只读 `config.render.colliderOffsetY`，写在配置顶层是死配置不生效（工头/矿洞/手脑/骑士都踩过，2026-07-25 工头修复后实机验证生效）；NPC 类相反，读顶层（npc.js:48）

---

## 流水线流程（以后每个新角色/怪物都走这套）

### 步骤1: 制作原始精灵图

在 Aseprite / Photoshop 中制作，帧大小固定（如 250×215）。

不要求内容精确对齐，因为步骤3会处理。

### 步骤2: 运行标准化脚本

```bash
cd tools
python sprite-normalizer.py \
  --input ../assets/enemies/raw/black_wolf.png ../assets/enemies/raw/black_wolf_attack.png \
  --output ../assets/enemies/ \
  --frame-width 250 --frame-height 215 \
  --cols 4 --rows 2
```

脚本行为：
- 分析每个精灵图的所有帧内容边界
- 取所有输入中的**最大内容宽高**作为目标
- 缩放每帧内容（保持比例，fit 模式）
- 平移使内容中心对齐到帧中心
- 输出到 `--output` 目录

只输出报告不生成文件：
```bash
python sprite-normalizer.py --report ...
```

### 步骤3: BootScene 加载

```javascript
this.load.spritesheet('enemy_black_wolf', 'assets/enemies/black_wolf.png', {
    frameWidth: 250, frameHeight: 215, endFrame: 7
});
```

**必须带 `endFrame`**，Phaserv4 即使图片高度差1像素也能正确加载。

### 步骤4: 怪物代码无需手动调 spriteSize

标准化后所有精灵图内容大小一致，代码中统一 spriteSize，无需条件判断：

```javascript
_getPhaserOptions() {
    return {
        spriteSize: 216,  // 统一值，不再根据状态变化
        frame: this._animFrame,
        flipX: this._facing === 'left',
        // ...
    };
}
```

---

## 遭遇导演（2026-07-28 移除：零调用的预留抽象）

`encounter-director.js` 的 `start/registerKind/encounter-table.json` 自 2026-07-21 引入起**始终零调用**（地牢遭遇由 DungeonConfig.getZombieEncounterConfig 承担且工作良好），已删除；唯一有消费方的构成解析（角色键数组→工厂数组）已内联进 `agent-invasion-system.js`（ROLE_FACTORIES + resolveComposition）。**教训：预留抽象如果没有第二个真实消费方，先不要建；需要时按 GroundZone/combat-fx 的"先有 3 处重复再抽"模式来。**

---

## 面板生命周期框架（2026-07-21 新增，新面板优先复用）

新增抽屉式面板时**优先复用** `src/ui/panels/base-panel.js`（BasePanel），不要重写 open/close/toggle/遮罩关闭：
- `new BasePanel({ id, className, stateKey })`：懒构建单例 DOM（首次 open 创建），open/close/toggle 统一走 UIState + active 类（抽屉动画由 CSS className 自带）；
- 只需实现 `buildContent(el)`（填充 HTML/绑事件，只调一次）与可选 `onOpen()/onClose()` 钩子；遮罩层点击关闭框架自带（各自判断 isOpen，多面板共存）；
- 对象字面量系统同样适用（参考 `warehouse-system.js` 的 `_getPanel()` 懒创建模式 + `get _isOpen()` 代理）。

已迁移范例：`warehouse-system.js`（仓库面板）。

### 步骤4: 声道与 BGM（2026-07-21 新增）
- **声道**：`playFile(path, volume, channel)` 第三参为声道（`sfx` 战斗音效默认 / `ui` 界面 / `music` 音乐），声道音量配置在 `data/audio-config.json` 的 `channels`（独立于 masterVolume 的二级调节）；运行时可 `SoundManager.setChannelVolume(channel, v)`。
- **BGM**：`data/audio-config.json` 的 `bgm` 映射场景 → 音轨（`null` = 无 BGM），切场景自动播放/停止（SceneManager 已接入 `playBgmForScene`）；音轨用 `playLoop` 循环，交叉淡入 `bgmCrossfadeSec`。新 BGM 素材放入 `assets/sounds/music/` 并填配置即可。

---

## 怪物共享基础件（2026-07-21 新增，新怪物优先复用）

新增怪物时**优先复用** `src/entities/enemy-types/_shared/` 下的共享模块，不要在类内重复实现：
- `enemy-utils.js`：`hostilesOf`（敌对目标枚举）、`isTargetMeleeStyle`（近战/远程风格判定）、`playSoundFrom`（按 sounds 配置播音）、`isFacingLeftFrom`（朝向判定）、`inMeleeRange`（近战命中统一口径：圆形边缘距离 ≤ range，与 CombatSystem 触发同语义；范围技能带地面椭圆圈视觉的仍用 GroundEllipse）；近战技能 range 读取约定 `skill.range ?? this.attackDistance ?? 默认值`（字段收敛，2026-07-25）；
- `enemy-gun.js`：`setupGun`（枪械装配：装备实例/攻击绑定/伤害/击退/AI 散布/弹匣）、`tryEnemyFireGun`（开火一体化：枪口偏移/墙体回退/瞄准目标矩形上方区域/临时移位出膛/枪口火焰+开火火光+弹壳，支持防御姿态枪口下移）；
- `monster-anim.js`：`twoStageWalkKey`（移动动画首段→循环段切换）、`frameHitElapsed`/`ratioHitElapsed`（命中帧→触发时间换算）。

已迁移范例：`time-agent-assault.js`（双形态+枪械+投掷+斧砍）、`time-agent-shield.js`（远程+盾击+防御弹反）。

---

## 火焰/油脂区域特效工作流（2026-07-23 新增；2026-07-28 共享件 combat-fx.js 落地）

**共享件（2026-07-28，新特效优先调用，勿再逐字拷贝）**：`src/effects/combat-fx.js`——
- `launchArcProjectile({textureKey,size,sx,sy,tx,ty,arcHeight,duration,spin,depth,onImpact})` 抛物线投射物（scene 守卫内建，返回 `{sprite,tween,cancel()}`，cancel 供 `_destroyCustomEffects` 防尸体落地结算）；预判/枪口偏移留在调用方。
- `createGroundWarning(x,y,r)` / `keepWarningAlive(warn)` / `destroyWarning(warn)` 红椭圆警示三件套（创建/保活/显式销毁口诀收口）。
- `fireGroundShockwave({x,y,maxRadius,strokeColor,fillColor,flicker,groundLayer,...})` 冲击波扩散圈（闪烁版/纯描边版）。
- `fireRadialLines({x,y,count,innerFrom,innerTo,outerFrom,outerTo,...})` 放射冲击线。
- `burstParticles({texture,x,y,count,config,destroyAfterMs,jitter,depth})` 一次性粒子爆发（(0,0) 陷阱收口；impact_dot 懒生成兜底内建）。
- `fireRadialBurst({x,y,count,color,duration,perspective,...})` 随机放射爆裂线（符文剑命中爆裂共享化；perspective 控制正圆/透视椭圆）。
已迁移：集合体/矿石蜘蛛/提灯/突击特工/手脑/蝇手/胖子僵尸（净删 306 行）。`_hostiles` 重复实现已全部换 `hostilesOf`（amalgam/shounao/fly-hand 遗留 3 处已迁）。火球/冰锥爆炸与飞行尾迹已粒子化（2026-07-28 二轮）：火球爆炸=冲击波圈+ADD 火焰爆发+烟尘余韵，冰锥碎裂=冰屑（重力）+小冰环。符文长剑右键特殊攻击已迁入（三轮）：命中爆裂 RuneSwordExplodeEffect → fireRadialBurst（旧类已删），飞剑补蓝色能量尾迹。

## 持续区域特效基类 GroundZone（2026-07-28，毒雾/酸液新区域一律按此开展）

`src/effects/ground-zone.js`（自提灯燃烧区抽出的模板）：三层分离（底面 NORMAL 贴花 growMs 扩散+呼吸 / 反光 ADD 描边错相位呼吸 / 区域粒子簇 (0,0) 陷阱收口）+ 生命周期（timer/tickTimer/oilFrac/flameTimer）自管。**伤害逻辑由调用方 onTick(zone, entities) 回调提供**（读自己的 matk/公式，基类不管数值）；底面/反光/粒子参数全可配（毒雾=绿 tint、酸液=黄绿即可复用）。调用方持有 zones 数组：update 中 `if (!zone.update(dt, entities)) splice`，`_destroyCustomEffects` 中 `zone.destroy()`。已迁移：提灯燃烧区（-152 行）。

## 法系投射物技能系统（2026-07-28，火球/冰锥合并）

`src/entities/components/bolt-skill-system.js` 基类（凝聚悬浮→发射→直线飞行预判/撞墙/命中统一流程），差异全部 kind 配置驱动：fields（状态字段名，GameScene/快捷栏按现有字段读取不可改）/ makeProjectiles / anim / trail / onImpact / onMaxRange。`fireball-system.js`/`ice-spike-system.js` 降为 ~120 行 kind 封装（-516 行）。**注意：命中循环不 break——冰锥同帧多目标结算是原版行为（准穿透），新 kind 的 onImpact 自行处置投射物 active。**新法系技能 = 写一份 kind 配置即可。

**适用场景**：地面燃烧区、油池+火焰、毒雾、酸液等地表区域特效。**范例**：`lantern-miner-zombie.js` 的提灯攻击（矿灯抛物线 → 落地油脂扩散 → 火焰成簇喷发 → 周期性魔法伤害）。

### 1. 核心构成（三层分离）

| 层 | 实现 | 关键参数 | 备注 |
|---|---|---|---|
| **油脂底面** | `scene.add.graphics()` 填充椭圆 | `oilCfg.color/alpha`、`growMs` | NORMAL 混合；`setDepth(y - 1000)` 压在所有实体之下；从落地点按 `growMs` 扩散到满半径 |
| **反光/高光** | `graphics` 描边椭圆 | `glossCfg.color/alpha` | `setBlendMode('ADD')`；`setDepth(y - 999)`；与油脂呼吸错相位，表现湿润反光 |
| **火焰粒子** | `scene.add.particles(0,0,'impact_dot', {...})` | `flameMorphMs`、`flameBurstCount`、`flamePoints` | ADD 发光混合；`scale: {start:3.3,end:0.3}` 由大到小，`alpha: {start:0.85,end:0}` 淡出；tint 随机白/黄/橙 |

### 2. 火焰喷发要点（避坑）

- **发射器放 (0,0)**：`add.particles(0, 0, texture, config)` 后再 `explode(count, worldX, worldY)`，**不要** `setPosition(x,y)` 后再 explode——Phaser 4 会把 explode 的坐标当本地坐标，导致双倍偏移飞出屏幕（SKILL.md 已有记录）。
- **加入 UpdateList**：`particles.addToUpdateList()`，否则粒子静止一帧不运动。
- **成簇喷发**：按 `flameMorphMs`（如 70ms）每 tick 在油脂区内随机取 `flamePoints` 个点，每点生成一个一次性发射器，`explode(1, jx, jy)` 时在喷发点周围 ±40px 随机偏移，形成不规则火团。
- **一次性发射器**：`emitting: false` + `explode(...)` 喷发，用 `scene.time.delayedCall` 延迟销毁，避免累积到 `_burnZones.flames` 导致内存泄漏。

### 3. 燃烧区生命周期

- **存储**：`this._burnZones.push({ x, y, timer, tickTimer, flameTimer, flames: [], oilGfx, glossGfx })`。
- **每帧更新**：`_updateBurnZones(dt, entities)` 中推进 `timer`（存活时长）、`tickTimer`（伤害周期）、`oilFrac`（扩散进度）、`flameTimer`（火焰喷发周期）。
- **伤害判定**：`GroundEllipse` 圆形椭圆（radius × radius×PERSPECTIVE_SCALE_Y），按 `tickMs` 对 `hostilesOf` 造成 `matk × damageMul` 魔法伤害。
- **清理**：`_destroyBurnZone(zone)` 统一 killTweensOf / stop / destroy 所有 graphics 与粒子发射器；实体销毁/移除时通过 `_destroyCustomEffects()` 统一入口（`game.js removeEntity` 会调用）。

### 4. 抛物线投射物（矿灯/闪光弹等）

- **预判落点**：`AimHelper.lead` 按飞行时间内的目标移动预判。
- **路径**：`x = sx + (tx - sx) * p`；`y = sy + (ty - sy) * p - arcH * 4 * p * (1 - p)`（标准抛物线）。
- **旋转**：`sprite.rotation = p * Math.PI * 3 * (flyDuration / 1500)` 控制落地前旋转圈数。
- **落地**：`onComplete` 销毁投射物 sprite 并调用 `_lanternImpact(tx, ty)` 生成燃烧区。

### 5. 复用清单

新增地表区域特效时优先复制以下模式，不要重写：
- 油脂扩散：`oilFrac` + `setScale` 同步缩放 graphics
- 呼吸反光：Tween `alpha` yoyo + ADD 混合
- 火焰成簇：一次性 `add.particles` + `explode` + `delayedCall` 销毁
- 伤害周期：`tickMs` + `GroundEllipse.intersectsEntity`

---

## 技能添加标准工作流（2026-08-02 定稿，闪电技能首航）

新增技能一律按此开展（闪电：锁定+传导+伤害+击退+眩晕+修炼+音效+图标+面板全链路验证）。

### 0. 形态选型（先定形态，再动手）

| 形态 | 复用模板 | 适用场景 |
|---|---|---|
| 弹道投射物 | `bolt-skill-system.js` kind 配置 | 火球/冰锥：凝聚→发射→飞行→命中 |
| 地面区域 | `GroundZone` 基类 | 毒雾/酸液/燃烧区 |
| 锁定/传导 | `LightningStrikeSystem` + `LightningBoltEffect` | 闪电：点选最近敌人→立即命中→连锁 |
| 移动雷云（跟身持续） | `StormDomainSystem` + `StormCloudFx` | 雷暴领域：头顶雷云跟随自己周期落雷+传导 |
| 电磁炮直线光束 | `ThunderLanceSystem` + `spawnRailgunBeam` | 贯穿雷枪：长按蓄力→沿鼠标方向笔直贯穿全部敌人（感电增伤+击退）→终点电爆 |
| 其他自管 | 独立 system 组件 | 风车/推击等 |

### 1. 数据（data/skills.json + public/data/skills.json 双份同步）

- `id/name/icon/iconImage/description/maxLevel/tags`（tags 含 魔法+主动 → 技能面板筛选/可拖快捷栏）。
- `effectFormula`：数值一律公式（含 `level`）或常量；每 5 级成长节点用 `Math.floor((level - 1) / 5)` 模式（冰锥数量/闪电传导同款）。
- `expFormula`：`100 + (level - 1) * 100`（与其他技能一致）；`expRewards`：`{ hit, kill, multiHit, multiKill }`（multiHit=单次命中≥2 目标、multiKill=单次击杀≥2 目标；**经验函数须按整次施法累计命中/击杀数统计**，冰锥为此改为 _end 统一结算）。
- **魔法类技能必须配置 `mpCost`（魔法消耗）**——遗漏/为 0 时助手必须主动提醒用户补上（2026-08-02 闪电曾漏配，用户明确要求此后工作流强制检查）；施法端 `trigger()` 统一做耗蓝校验（`mp` 不足 → 浮动提示「魔法不足」，不进入结算、不消耗冷却）。
- `sounds`：`{ hit: '路径' }` 或 `{ cast: [p1, p2] }`（数组=同时播放，闪电首例）。
- **双份必须字节一致**（test-regressions 断言，npm test 会查）。

### 2. 系统组件（src/entities/components/xxx-system.js）

- `trigger()`：冷却检查 → 耗蓝 → 目标/方向判定 → 失败提示（`SceneManager.showTopNotification`）→ 结算（`takeDamage` + `applyKnockback(angle,px)` + `applyStun(ms)`）→ 特效 → 经验。
- `update(dt)`：冷却递减（ms）。
- **玩家接线四件套**：① `player/index.js` import + `this.xxxSystem = new XxxSystem(this)` + `_xxxCooldown = 0` 字段；② `subsystems.js` update 段 `this.xxxSystem.update(dt)`；③ `subsystems.js` 死亡复位段清 `_xxxCooldown`；④ `subsystems.js` `_initSkills` 加 `if (!skills.xxx)` 兜底（JSON 加载失败/旧缓存仍可用）。
- **数值兜底收敛（配置唯一真相，2026-08-05 全魔法系统落地）**：系统顶部定义 `XXX_DEFAULTS` 常量
  （值与 skills.json 同字段缺省兜底一致），`trigger()` 里 `const effect = { ...XXX_DEFAULTS, ...baseEffect, mpCost }`
  合并——skills.json effectFormula 是唯一真源，业务代码**禁止散落 `effect.cooldown || 25` 之类魔法数字**；
  伤害公式内 `?? 0` 防御读取可保留（合并后不会触发）。已覆盖：贯穿雷枪/雷暴领域/闪电锁定/暴风雪/陨星/
  圣光/冰墙/灼锋焰甲/无人机/冰锥/火球（投射物走 `kind.defaults` 并入 `BoltSkillSystem._getEffect`）。
- 怪物复用（可选）：参考 `zombie-wizard.js` 的 IceSpikeSystem/FireballSystem（构造 + update + AI 决策触发）；
  **瞄准类技能 `trigger` 必须可传参 `trigger(optAimX, optAimY)`**——玩家用鼠标（内部读 Renderer.screenToWorld），
  怪物传面向方向（缺省回退自身前方 100px，贯穿雷枪已按此实现）；蓄力光球类特效玩家锚定施法手，
  怪物同样生成但先用默认锚点（`_defaultChargeAnchor` 身体中线上方）占位，待怪物绑定点做好再替换。

### 3. 快捷栏（quick-bar.js）

- 触发分支：`else if (skillId === 'xxx') { player.xxxSystem.trigger(); }`。
- 冷却同步：`updateCooldowns` 读 `Game.player._xxxCooldown` → `this.cooldowns['xxx']`（转圈显示）。
- **自目标技能（可对自己释放）**：skills.json 标 `selfCast: true`（圣光首例）；`input.js` keydown 传 `e.altKey` → `QuickBar.useSlot(code, altKey)` → 对应系统实现 `triggerSelf()` 直接对自己释放（跳过瞄准/距离/视线三重判定，耗蓝/音效/冷却/经验照常）。

### 4. 技能栏/面板（skill-manager.js）

- `skillList` 三处数组加 `player.skills.xxx`（武器分支列表各加一遍）。
- **技能栏默认排序（2026-08-02 定稿）**：精通类 → 被动类 → 主动类 → 魔法类（`_getSkillCategoryPriority`：精通按名称含「精通」识别、其余按 tags 的 passive/active/magic 归类；新技能 tags 决定归类，精通命名必须含「精通」）。
- 详情面板三区（照火球/冰锥格式）：🧮 伤害公式（基础/魔攻加成=魔法攻击×系数/智力加成/当前总伤害）+ 技能效果（effect 全部字段）+ **下一级全项预览**（nextEffect）。
- 升级方式说明（经验来源三条口径）+ 升级飘字 `effectText` 分支。
- 经验函数 `addXxxExp(player, hitCount, killCount, multiHit)`——hit/kill/multiHit 各自独立累加。

### 5. 特效（src/effects/）

- 优先复用 `combat-fx` 共享件（burstParticles / fireGroundShockwave / 抛物线投射物）。
- 锁定/传导类连接特效直接套用 **`LightningBoltEffect` 模板**（见下节，换 colors/widthScale 即可）。
- 自管特效类：`EffectManager.add()` 驱动 `update(dt)`，`window.__phaserScene` + `worldEffectsGroup` 建 graphics，`active=false` 自动清理。
- **色块/粒子风格优先**（impact_dot + ADD + 多层 tint / fillCircle 色块链）——避免线条感。
- 禁止 per-object filters（数量多即卡）；深度=实体 depth+2 或地面 y-998 口径；位置/观感类必须 CDP 实机验证。

### 6. 图标与音效（可选但推荐）

- 图标（本地 ComfyUI 出图，2026-08-03 起）：先读文首「本地 AI 出图工作流」——用本地 ComfyUI 生成
  （同系列风格参照现有技能图标），过 GLM-4.6V 验收 + 像素统计后抠图入库 `assets/skills/xxx.png`
  （1024×1024 透明底，与火球同规格），`iconImage` 指向。技能贴图要点见文首「技能贴图要点」清单。
- 清理（2026-08-03 起强制）：确认 iconImage/贴图引用后，删除生成过程全部废案与未调用图片
  （迭代版本/候选图/预览图），只保留最终被引用资产，避免仓库膨胀。
- 音效：素材复制 `assets/sounds/skills/xxx.mp3`，skills.json `sounds` 配置，系统内 `SoundManager.playFile` 播放。

### 7. 验证

- lint / npm test（含双份 JSON 断言）/ vite build / node --check。
- **核对清单**：魔法类技能 `mpCost` 已配置（>0）；双份 JSON 字节一致；技能面板数值与 effectFormula 同源。
- 数值逐级核验：按 L1/5/6/10/11/16/20 手算伤害/传导/眩晕/击退成长。
- 开发面板「技能」页签 + 控制台 `await setSkillLevel('xxx', L)` 快速测各等级。
- 实机：释放 / 锁定 / 范围外失败提示 / 冷却转圈 / 怪物受击表现（击退/眩晕/死亡）。

### 8. 坑（闪电首航沉淀）

- 形态别硬套：锁定型别塞 BoltSkillSystem（那是弹道基类）。
- 特效需求先对齐：定格 vs 持续闪烁 vs 色块/线条，先问清再做（闪电经历 3 轮返工）。
- 冷却字段名 `_xxxCooldown`（ms）必须与 quick-bar 同步口径一致。
- 经验"命中/击杀/多目标命中/多目标击杀"四条口径各自独立累加，别合并；单次施法多目标奖励必须在施法端按整次累计（火球/闪电天然按次，冰锥需改 _end 统一结算）。
- **魔法类技能漏配 mpCost 是高频遗漏**——数据配置完先核对，漏了提醒用户。
- 直接改等级测主动技能 OK；被动技能不触发属性回算（需重新装备/升级触发）。

---

## 锁定/传导类技能特效模板（2026-08-02，LightningBoltEffect 首航）

`src/effects/lightning-bolt.js` 的 `LightningBoltEffect` 是锁定/传导类（瞬发连接型）技能的标准化特效，同类型直接复用：

```js
EffectManager.add(new LightningBoltEffect(source, target, {
    durationMs: 500,          // 定格显示时长
    fadeMs: 250,              // 淡出时长
    segments: 10,             // 锯齿段数
    jitter: 0.12,             // 锯齿幅度（距离比例）
    widthScale: 1,            // 整体粗细倍率
    colors: {                 // 换配色（如红色闪电/金色锁链）只改这里
        glowOuter: 0x6a4bff,  // 外层辉光（ADD）
        glowInner: 0xa98fff,
        core: 0xdcd6ff,       // 内芯色块（NORMAL）
        white: 0xffffff,      // 白芯
    },
}));
```

**实现要点（改模板前先读）**：
- 中点位移 → 每段中点细分 → Chaikin 切角平滑 → 按 4px 步长重采样成连续色块链（细端圆块仍相连）。
- 每点半径烘焙 0.75~1.25 随机因子（创建时固定）；释放后不再重生成（定格）；末 fadeMs 线性淡出。
- 深度 = 两端实体精灵 depth 较大者 + 1；目标死亡后终点冻结残留。
- 不挂 per-object filters（数量多即卡）——色块堆叠自带辉光观感。
- 离屏预览：`tools/sim-lightning-preview.mjs`（同算法渲染 PNG，调参不入游戏）。

---

## 魔法施法动作标准（2026-08-02 定稿：前摇/第 N 帧释放/倒放后摇/跨步）

魔法类主动技能释放统一走施法动作（空手施法 cast / 法杖施法 staff_cast），规则：

### 1. 素材与动画注册
- 素材规格：4096×2048，**8 列×4 行 512×512 格**（"4×8 切割"= 4 行×8 列），帧连续（空手 12 帧=0~11、法杖 9 帧=0~8）；**入库前用 pngjs 扫格确认帧序与空白格**（法杖施法首次扫描误判为 4×8 导致错排，已修正）。
- `player-anim-config.json`（双份）条目：`frameCount/frames/frameRate` + **`releaseFrame`（第几帧释放）/`forwardMs`（前摇）/`recoverMs`（后摇）**——全部配置驱动，代码零魔法数。

### 2. 武器→施法动画选择
- 武器数据（EDM）`castAnimKey: 'staff_cast'` 指定施法动画键；未配置回退 `cast`（GameScene `startPlayerCast` 读取，无硬编码武器类型判断）。

### 3. 释放流程（GameScene.startPlayerCast）
- 前摇播 forwardMs（默认 500ms）；`animationupdate` 到 `releaseFrame` 帧触发 `onRelease`（魔法实际结算，只一次）；**定时兜底**：事件未触发时按 `(releaseFrame/totalFrames)×forwardMs+40ms` 强制释放。
- 前摇播完自动 `playReverse` recoverMs（默认 250ms）倒放回 idle；含超时兜底收尾。
- **输入全锁**：前摇+后摇期间 update.js 施法分支 early-return（不可移动/攻击/技能/开枪）+ quick-bar 拦截；**后摇阶段空格翻滚可打断**（`_interruptCastRecover` → cancelPlayerCast + triggerDodge）。
- **施法跨步**：前摇沿起手朝向推进 `+30px`（`_castStepMax`，记录起手原点），后摇向原点线性归位（每帧 WallSystem.resolve 防穿墙；被墙钳制也不会回退过头）；打断/死亡清理原点。

### 4. 接入点
- 系统 trigger 通过 `_startPlayerCast(doRelease)` 包装（第 N 帧才结算）：冰锥/火球**一段不播、二段发射时播**；闪电/圣光（含 Alt 自释放）起手即播。
- 玩家接线：index.js 施法字段、subsystems.js 兜底/死亡复位/`_updateCastStep`、update.js 施法分支、quick-bar 拦截。

### 5. 坑（必看）
- **`GameScene._updatePlayerAnimation` 每帧状态机会覆盖施法动画** → 释放帧永远到不了、魔法不释放（闪电/圣光曾双双失效）。必须加施法守卫（`_castState !== 'idle'` 时 return）+ 卡死自愈（施法状态但动画未在播 → `_endPlayerCast`）。
- 施法期间隐藏/保留武器：按用户口径**武器保持在 idle 右手持握位置**（不隐藏）。
- 自目标技能：skills.json `selfCast: true` + 系统 `triggerSelf()` + Alt+快捷键（input.js 传 altKey → useSlot(code, altKey)）。

---

## 等距投影素材规范（所有场景素材必须遵守）

**视觉对齐基准 = 地板线 30°（tan30°≈0.5774）**。实测：地牢 blackbrick 29.7°（1.755:1）、主神空间 hub_brick 30.7°（1.687:1），全部地板都在 30° 附近——场景素材的视觉角度一律对齐 30°。
**注意区分**：引擎碰撞投影 `PERSPECTIVE_SCALE_Y = 0.5`（26.57°）只用于 footprint 椭圆/阴影/分离判定，**不可见，不参与视觉对齐**——2026-07-24 曾错误地按 26.57° 出墙体贴图，导致墙与地板线不齐，已纠正为 30° + 编辑器角度补偿（`slopeFixOf`）。
**引擎不是近大远小的透视投影**：角色/怪物/地板全图恒定大小，远近只靠 Y 压缩 + Y 排序遮挡表达——场景素材禁止按远近缩放。

**一句话规则：地上的线走 30°，立着的东西垂直站、顶面走 30°，贴地影子画 2:1 椭圆（椭圆跟随碰撞投影 0.5）。**

| 物件类型 | 规则 | 例子 |
|---|---|---|
| 沿地面延伸的"线" | 与地板线平行（±30°，斜率 0.5774） | 墙、栅栏、地板纹路、道路、河流、桌台长边 |
| 站立物件 | 立面垂直（billboard）；俯视可见的**顶面**边缘走 ±30° | 柱子、柜子、箱子、树、门、墙柱/端头 |
| 贴地影子/占位 | 2:1 压扁椭圆（跟碰撞投影 0.5，不与地板线对齐也看不出） | 落地阴影、篝火/锅/石块底面 |
| 角色/怪物/NPC | 侧视 billboard，与投影角度无关 | 维持现有精灵图流程 |

### 出图提示词要点
- 写"**底边与水平线呈 30 度夹角**"（对齐地板线）；不要再写 26.5 度/2:1
- 垫图：把 wall-直墙.png 和一块地板砖存为固定参考图，每批素材垫图生成
- 同一套素材（如直墙+四转角+墙柱）必须**一批出齐**，分开生成必出规格差（砖块大小不一）
- 干净输出：透明底、无白色描边/辅助线、无"由 AI 生成"水印

---

## 地牢场景构建标准工作流（2026-07-25 定稿，全套实战经验）

本节是**经过验证的完整流程**——新地牢场景一律按此开展，含菱形地块、墙体、夹角、地板-墙连接、门口、透视遮挡全套。

### 一、菱形房间模板
1. **尺寸**：固定档位（2026-07-25 起不再随机）：普通 1024 / 精英 1792 / Boss 2048，地牢级 `combatRoom` 子配置可覆盖（如高级 bossSize=1024）→ `rx = 1.2S`、`ry = rx × 0.5774`（30°），边距 M=260（≥墙贴图高度 217 + 缓冲，否则上夹角被世界顶裁掉），菱形在世界正中央，区外全黑
2. **地板烘焙** `applyDiamondFloor(worldW, worldH, cx, cy, rx, ry)`（dungeon-floor-texture.js）：纯黑底 → 等距平铺按菱形路径裁剪 → **墙脚接触阴影（统一标准，2026-07-25 升级）**：沿菱形边缘向内 64px 真渐变黑带（逐笔 alpha 0.40×(1-i/64) 递减描边叠加，墙根 ≈40% 黑 → 0）——**所有墙壁-地板衔接处一律用此处理**。旧版是 16 笔等 alpha(0.12) 平刷（整带仅 ≈15% 平黑），亮地砖上几乎不可见（中级/初级"没有阴影"的根因：blackbrick-7/8 亮度 ≈50 是高级砖 ≈25 的两倍）
3. **地板配置分级**：`setDungeonFloorProfile` 按地牢类型设置（高级 blackbrick_7/8、初级/中级各自 tiles）；需要地砖的场景（如门外白区）读 `getDungeonFloorProfile()` 跟随当前地牢

### 二、墙体构建 `WallSystem.buildIsoDiamondWalls(cx, cy, rx, ry)`
1. 四顶点转角**点对点**（两臂各一件直墙）+ 四边**定长瓦片续接**（`faceLen` 固定，不足靠叠合，**绝不压扁**——压扁会让小房间边墙比夹角矮一截）
2. 深度规则：**后墙（室内侧朝镜头）depth = min 底边 y，前墙（室外侧朝镜头）depth = max 底边 y**；转角臂统一 **+5 偏置**（顶点侧盖住续接件，预制转角同款规则；+260 曾误挡顶点下方高个实体已废弃，+5 为安全值不得加大）
3. 碰撞：`rebuildIsoCollision()` → `isoSegments` 线段模型（点-线段距离场，移动/滑动用）+ 36×20 阶梯矩形（寻路/小地图用）；滑动走**沿墙切向分量**（速度不超意图，杜绝贴墙加速滑行；旧"切向传送脱困"块是加速根因，已删）
4. 玩家入场：随机顶点内法线方向（off = offsetFromEdge + 60）；怪物：对角顶点附近拒绝采样（菱形内缩不等式 `|dx|/(rx-i) + |dy|/(ry-i) <= 1`）；出口：门闸（见四）

### 三、夹角构建（上/下/左/右）
1. **原则：夹角不出 AI 素材，基底直墙拼装**——顶点处两臂各一件（按走向选 flipX：右下 "\" 不翻转、左下 "/" 翻转），续接件 8px 叠合（只叠不缺）
2. 透视深度：**整体 下>左>右>上**；夹角内**朝下的臂（更靠近镜头）depth 更大**
3. 生成脚本 `tools/gen-corner-prefabs.mjs`（从基准件读缩放保持全套一致）→ 写入 wall-prefabs.json
4. **废弃方案记录（别再走）**：顶点后冲过冲（错位）、墙柱/补丁填充（不成熟）、AI 转角贴图（规格不齐）

### 四、门口（门闸）系统
1. **素材管线** `tools/door-video-frames.py`：视频按可用时长均匀取 16 帧 → 边界洪水抠图（白底/棋盘底）+ 水印区抹除 + **门洞封闭区二次抠图**（栏杆包围的亮区洪水填充进不去，阈值去底）→ 16 帧统一包围盒对齐 → 打包 spritesheet；首帧=关闭、末帧=打开。**显示比例对整体缩放是不变量**（640/2048 截帧拼接表现相同，不要追求大规格）
2. **几何注册** `ISO_WALL_GEO.gate`：base（底边线，**只拟合两侧墙身，避开门洞区**——门框架会拉偏拟合线）、gateX（门洞 x 范围）、frames
3. **门闸实体**（wall-gate.js）：状态机 open/closed/opening/closing（**动画用 Phaser tween 计数器驱动，禁止手动逐帧 tick**——手动驱动链路易断，动画卡死）；碰撞 = **门两侧墙体线段常开 + 门洞线段按状态启停**；**原位替换**（继承被替换件 span 与 depth，不做任何接缝特权/过门退层——这些方案全部试过并废弃）；悬停金色轮廓（全 16 帧拱门区剪影×shadowBlur 烘焙，**本体 destination-out 抹除只留外发光**，跟随当前帧）；**斜接遮盖位继承（2026-07-25）：转角两臂同 depth，默认构建里后建的臂盖住先建臂的端边——门闸替换先建臂（下夹角 bL/上夹角 tL，平局按数组顺序必中先建臂）时必须 depth-0.1 退到兄弟臂下面，否则门闸贴图的裁切边暴露在斜接缝上。依据：用户手工预设（门墙 depth 最低、右臂最高）严丝合缝，几何与代码生成完全一致，差的就是这层顺序**；`_setupGate` 仍需先 `_syncWallsToPhaser()` 后 `placeAt`（防门闸被整批重建的墙件压住）
4. **门外独立地块**：入场即生成（战斗完成不等）；位置 = 门洞中心沿外法线出界 + 边距（**不做晶格吸附**，防拽回主场景）；烘焙 = 当前地牢地砖 → **裁掉菱形内部分**（destination-out 菱形路径，不重叠）→ 远角径向圆滑淡出 → 25% 延伸；轮廓环绕光晕只留外侧（朝门一侧渐隐擦除）；图层归地形层（-999）
5. **回城触发**：玩家在白区内**且已走出菱形边界**（点-in-菱形 false）→ `_leaveCombatViaPortal()`；出口传送门已删

### 五、透视遮挡（X 光圆圈）
1. 判定（几何法，不用包围盒）：墙件 depth > 实体 depth 且**脚底在墙面底边线之后 + 身体进入墙面覆盖带（覆盖量 > 身体 15%）**；遮挡物 = iso 墙件 + 门闸统一列表
2. 三层：地板透视洞（动态 CanvasTexture 抠烘焙地板、径向渐隐）→ 圆环（中间透明、边缘黑→透明渐变）→ 实体克隆（玩家含武器/副手/盾牌）
3. **接缝防半遮**：触发后按圆覆盖范围内所有墙件（全包围盒）的最高 depth 绘制
4. 禁用 Phaser 4 蒙版（BitmapMask 已删除，Filter 通道太贵）

### 六、备份与恢复
战斗房/Boss 房进入前必须备份 `WallSystem.walls + isoVisuals`，离开时恢复（否则战斗房的墙残留到主神空间）
- **离开清理还必须含 X 光透视对象**（2026-07-25）：X 光圈/克隆/地板洞是独立 sprite 不属于任何显示组，地图模式分支跳过 `_syncXRayCircles` 导致战斗残留透视定格在地图界面（"透视到地图里的金币"根因）——`cleanupGate`/`BossRewardSystem.cleanup` 统一调 `GameScene._purgeXRayCircles()`，地图模式分支每帧兜底隐藏

### 七、战斗房尺寸（2026-07-25 起，固定档位，不再随机）
- 全局（`data/dungeon-config.json` → `combatRoom`）：**普通 1024 / 精英 1792 / Boss 2048**
- **地牢级覆盖**：地牢配置块内加 `combatRoom` 子对象即可（如 `zombieDungeon.combatRoom.bossSize=1024`＝僵尸地牢高级 Boss 房 1024）；`DungeonConfig.getCombatRoomConfig(dungeonType)` 三级合并（DEFAULTS←全局←地牢级）
- 调用点：精英/普通由 `_enterCombat` 按 `node.isElite` 传 `options.roomSize`；波次 Boss（初/中级 `bossEncounter`）由 `_enterBossCombat` 传 bossSize；集合体 Boss（高级）由 `enterBossBattle(player, cb, dungeonType)` 第三参透传到 boss-reward 的 `arena.size` getter
- 入侵战场地尺寸独立（`AgentInvasionSystem.getArenaSize()`），不受此规则影响

### 八、宝箱房系统（2026-07-25，精英战斗专属，`src/world/chest-room-system.js`）
1. **生成**：精英节点入场（`_enterZombieCombat`/非僵尸 `_enterCombat` 的 `node.isElite` 分支）→ 按墙壁预制「宝箱房」（门墙×1+直墙×3，data/wall-prefabs.json）在场地中央拼小菱形房——**几何中心=全部件 face 线段端点外接框中心**（与编辑器 cx/cy 无关）；直墙推 isoVisuals（深度上臂 min/下臂 max 重算，预制存的是编辑器世界值不可直接沿用）；房内区域注册刷怪排除区（`spawnMonsters` 菱形拒绝采样 + 排除区判定）
2. **门墙独立控制**：不进 isoVisuals——复刻 wall-gate placeAt 映射放 wall_gate 帧0（关门），碰撞=两侧常开+门洞启停；`onCombatComplete` 且未超时 → tween 播 0→15 帧开门 + 门洞碰撞移除
3. **等级宝箱**：宝箱等级=地牢 grade（E/D/C/B/A，贴图 `chest_<grade>`，**素材库缺 A.png 暂用 B 兜底**）；奖励表=`combat-formulas.json universalEventRewards.treasureChest[grade]`（50% 金币 / 25% 材料组（强化石1+改造券1+粉尘） / 25% 宝箱怪位——**宝箱怪位当前按金币兜底**，要真宝箱怪再接）经 `BossRewardSystem.rewardNode.giveReward` 发放
4. **60s 倒计时**：Phaser text（**改色用 setBackgroundColor/setColor，禁用 setStyle——会整体覆盖丢失字号字体**）；白底黑字黑框（矩形垫底），≤10s 红底黑字；超时→宝箱 1s 淡出、房门不再开
5. **开箱**：玩家靠近 60px → chest_open 精灵图（559×602×16，tools/chest-video-frames.py 从 宝箱打开-1.mp4 切帧+抠图，管线同门闸）1.5s 播完 + chest_open.mp3 音效
6. **离场守卫**：`hasUnopenedLoot()` 时走出大门白区 → 弹确认框（是=正常离场 / 否=退回场内 160px+1s 冷却防连发）
7. **已删旧制**：击杀精英刷 DungeonChest 靠近自开流程（dungeon-chest.js 已删）、`eliteChestReward` 配置（出征面板文案改读 treasureChest 表）；**F 级地牢岔路战斗固定普通**（zombie-dungeon.js 岔路 eliteChance 按 grade 判定，F=0）
8. **清理**：`CombatRoomSystem.cleanupGate` 统一调 `ChestRoomSystem.cleanup()`（门墙/宝箱/倒计时销毁 + 门洞碰撞段移除；直墙件随 `_restoreSceneState` 自动还原）
9. **门墙深度（2026-07-30 修复）**：`_placeGate` 深度 = **max(min(底边 y) − 显示墙高, gA 上端邻墙深度 + 0.1)**，不沿用预制保存值——宝箱房是低矮装饰围墙，实体应恒画在墙上；预制值（≈min 底边+5）下门墙贴图比直墙高，门区实体（脚线 3950~4101）会进入门框覆盖带被盖住（"门墙左侧挡实体、右边正常"根因：右侧直墙贴图矮够不着实体）。**邻墙搜索容差必须 40px**（预制手摆端点有 ~25px 间隙，2px 精确共享取不到 → 上墙裁切边压门墙的第二轮 bug）；只拉 gA 上端邻墙，gB 右侧"右件盖门墙"手调规则不动。X 光 occluders 在门打开后必须剔除门洞段（`cg.open ? [] : [cg.gateSeg]`），否则开门后门洞仍当墙透视
10. **尸体清理（2026-07-30）**：`cleanupRoom`（离场拆房）**不跳过存活尸体**——地牢 map 状态实体更新暂停（game.js 地图分支早退），尸体计时器冻结，保留的尸体贴图会被带进下一场战斗房；`isPreservedCorpse` 跳过只用于 `cleanupMonstersOnly`（波次间同房保留，腐蚀光环继续生效）

---

## 墙体添加标准工作流（独立流程，新墙类素材/墙件一律按此开展）

### 一、素材管线（贴图进项目前必过）
1. **抠图**：纯色/棋盘底用**边界洪水填充**（不误伤主体砖缝亮灰）；水印/描边用 alpha 阈值清零或定点抹除
2. **几何锚点实测**（写入 `ISO_WALL_GEO`，贴图像素空间）：
   - `base`：底边线两端点（全跨度，含端帽）；`face`：正面墙底边跨度（不含端帽，**拼接/碰撞一律用 face**）
   - `vertex`（转角接合点）、`tipX`（臂尖）、`wallH`（底边→顶沿墙高）、`slope`（底边固有斜率）
   - 实测方法：alpha 包围盒 + 列剖面底边/顶边拟合（**拟合区避开特征区**——门洞、拱门会拉偏拟合线）
   - **`editor`：摆墙面板显示名**——带此字段的条目自动出现在摆墙编辑器「标准组件 · 墙壁」栏与图层命名表（wall-editor.js 从 ISO_WALL_GEO 动态生成，新墙/门组件加此字段即自动入面板，无需改编辑器代码）
3. **角度标准**：显示斜率对齐地板线 30°（`FLOOR_SLOPE=0.5774`），角度补偿 `slopeFixOf(geo)` = FLOOR_SLOPE / geo.slope
4. **高度归一化（谨慎）**：仅当贴图顶/底边不平行且需要与直墙对齐时用（`wall-height-normalize.py`，按列绕底边缩放）；**带拱门/突起特征的贴图用 k≥1 变体**（只拉不压，特征区不压缩，参考 `tools/gate-top-warp.py`；"拼接叠合遮盖顶部分歧"方案已被用户否决，禁止再用）

### 二、拼接规则（血泪教训浓缩）
1. 底边精确映射：独立 sx/sy 把 face 映射到目标线段（base 永远贴合，顶部分歧用叠合吸收）
2. **叠合 8px，只叠不缺**：精确对顶必露缝（锚点拟合公差 ±6px）
3. **瓦片定长定高，不足靠叠合，绝不压扁**（小房间边墙矮一截的根因）
4. 长边覆盖：接缝阵列（编辑器标记A→生成/铺满）
5. 同水平对齐：同一条边上的件必须同 scale（拼接吸附继承 A 的 scale/flip）

### 三、夹角拼接
1. 基底两件点对点（见地牢工作流三）；顶点缝隙接受或用编辑器微调，**不做填充**
2. 深度：整体 下>左>右>上；夹角内朝下的臂在上层

### 四、图层规则
1. 后墙 min、前墙 max（单 depth 斜墙必有误差区，规则只决定误差放哪侧）
2. 转角与续接件的接缝：顶点侧盖住下侧（预制转角 +5 偏置即可，**不要加大偏置**——会误挡高个实体）
3. 特征件（门闸等）：**原位替换**，不做特权
4. 实体排序：实体 depth = 脚底 y + 10；判定遮挡看脚底与墙底边关系，不看包围盒
5. **遮挡透视（新墙类必做项）**：X 光透视由 `ISO_WALL_GEO` 驱动——geo 注册（base/face/wallH 实测准确）后 isoVisuals 墙件自动纳入 occluders；门闸由 `WallGate`（placeAt 锁定样式几何）与宝箱房门（GameScene occluders 显式纳入）覆盖。**验证必做**：玩家/怪物站到墙后应出现透视圆圈+贴图克隆；门贴图必须是 spritesheet 且 `geo.frames` 正确

### 五、关键陷阱（每条都踩过）
- **flipX 是 quad 不动、内容镜像**：锚点公式 `x0 = A.x - (w - p0.x)*sx`（flip 时 p0→A、p1→B）；写 flip 公式先数值自检
- **显示比例不变量**：基线映射下，任何整体/非均匀缩放都改变不了显示比例（砖块大小只能出图时统一）
- **单 depth 斜墙排序冲突**：接缝两侧的覆盖需求相反时，只能选一侧规则或接受局部误差，别堆特权代码（会乱）
- **过门退层/接缝特权/全局转角偏置**全部试过并废弃——原位替换最稳
- **缺纹理绿框**：Phaser 缺纹理渲染绿色占位框——动态纹理必须先创建再使用
- **逐帧动画用引擎 tween，不要手动 tick**：门闸曾因依赖 `CombatRoomSystem.update(dt)` 逐帧驱动，链路一断动画卡死（战斗后不开门）；改为 `scene.tweens.addCounter` 驱动帧号，脱离手动链路
- **转角斜接遮盖位继承**：转角两臂同 depth，默认后建臂盖住先建臂端边——门闸原位替换先建臂时必须 depth-0.1 继承其下位（否则贴图裁切边暴露在斜接缝，"两墙之间有偏差"根因）；同理 `_setupGate` 先 `_syncWallsToPhaser()` 后 `placeAt` 防整批重建压住门闸。**排障方法论的反面教材：此 bug 连修三轮未中，最终靠"用户手工摆一个严丝合缝的对照组存为预设 → 数值对比 JSON"一次定位——抽象描述定位不了视觉问题时，让用户/自己造对照组做数值 diff 最快**
- **ItemDatabase.items 是 {id: itemData}，itemData 不带 id 字段**（id 只在键上，`get()` 才注入 `_id`）——`Object.values(items)` 后读 `item.id` 恒为 undefined。奖励界面"三选一点击无反应"根因：`_giveRandomWeapon` 用 values+item.id → `createInstance(undefined)` 返回 null → `addToInventory` 读 `maxStack` 抛 TypeError → `_selected` 已置位面板卡死。教训：**遍历 items 一律走 Object.keys 回查**；发奖类入口加 `if (!item) return` 守卫 + try/catch 兜底（单项失败不阻塞面板关闭）
- **续接瓦片规则（2026-07-26 定论，取代"均匀拉伸"）**：`edgeFill` 用**定长定高瓦片**（scale 固定、8px 叠合、尾端超出由下一顶点转角臂 +5 偏置盖住）。两条历史教训：①`d < len+8` 定长循环在 `len ≈ faceLen` 时会多一块近整瓦重复件（"下夹角多一堵墙"）——现由转角臂 +5 偏置盖住 overshoot 解决；②均匀拉伸（0.7~1.4）让拉伸件与定尺转角件一大一小、中间突出（僵尸砖纹不可感知故未暴露，沼泽柴墙材质随机格外显眼）——故废弃拉伸，统一定长
- **门闸候选排除近顶点件（2026-07-30 定论，取代"替换转角臂+摘重复件"）**：`_setupGate` 回退选择跳过任一底边端点距菱形顶点 <0.8×瓦长的直墙件（转角臂+其 overshoot 重复瓦片）。原因链：①重复件碰撞横穿门洞（V0.325 已修，靠 `removeSpanCoveringPieces`）；②但 S≥1792 房间的重复瓦片有百像素**有效覆盖**（唯一桥接段），摘除必留断口（精英房下夹角左侧空隙根因）；③重复件覆盖结构与档位强相关（S=1024 重复 97%、S=1792 有效覆盖 126px、S=2048 重复 97%），没有通用的"替换转角臂"安全解。**门闸只替换常规续接瓦片（两端 8px 叠合）是唯一全档位安全解**；`removeSpanCoveringPieces` 保留作兜底。回归 `scripts/test-gate-corner.mjs`（门洞畅通+边断口 ≤10px 双断言）。排障工具：`tools/render-gate-corner.py` 离线渲染对照
- **重复件撞门闸（2026-07-29，①的碰撞层尾巴）**：尾端 overshoot 瓦片可与转角臂**近整瓦重复**（S=1024 重复 462/476px），视觉被盖住但碰撞段一直在——`_setupGate` 把转角臂替换成门闸时（程序化转角臂无 `_corner`，是合法候选）重复件碰撞段+贴图横穿门洞（"下夹角门又多一堵墙、无法离场"根因）。修复：`_setupGate` 摘除被替换件后调 `WallSystem.removeSpanCoveringPieces([a,b])`（共线 + 投影重合>50% 一并摘除；门闸世界跨度==瓦片定长不留缺口；正常接缝叠合 8px≈2% 误摘不了邻件），placeAt 失败回滚连同重复件恢复。回归 `scripts/test-gate-corner.mjs`（挂 npm test）。**教训：冗余重复件"视觉盖住"不等于无害，凡有原位替换机制的地方都要清理碰撞层重复**
- **门闸锚点沿边回退 8px（2026-07-29 续）**：摘除重复件后暴露两个接缝问题——替换转角臂时门与邻瓦只剩 ~1px 对顶（露缝）；替换重复件时门右端距顶点空 7px。修复：`_setupGate` 传给 `placeAt` 的 A 沿边回退 8px（瓦片叠合同口径）。**排障方法：离线渲染对照（`tools/render-gate-corner.py`，与 JS 同数学逐件合成贴图）——比抽象推几何快，改完即出图验证**
- **部署验证三件套**：逻辑模拟跑通但游戏不生效时——版本徽章标构建号（确认跑的是哪份代码）、关键路径 console.log（确认判定是否触发）、node 模拟全流程（确认逻辑无误）；三管齐下直接区分"部署问题/判定问题/逻辑问题"

---

## 墙壁系统（2026-07-24 重构：可视化编辑器 + 预制组合）

**核心思路**：墙壁/场景布置不再靠代码盲推贴图几何——通用件模型 + 游戏内可视化编辑器（所见即所得），摆好的布局存为**预制组合**，场景按预制渲染；后续地牢随机生成预制房间 + 镜像翻转复用同一格式。

### 通用件模型（wall-system.js）
- 件结构：`{ tex, x, y, scaleX, scaleY, flipX, flipY, depth }`（origin 固定 0.5,0.5），存 `WallSystem.isoVisuals`，`_placeIsoPiece` 直接渲染并回写 `p._sprite`
- 碰撞自动生成：`rebuildIsoCollision()` 按件底边线段（`texPointToWorld` 应用 scale/flip 变换）每 30px 一块 36×20 阶梯矩形（`_iso` 标记，混 `WallSystem.walls`，寻路/小地图自动兼容）；编辑后重建即可
- 贴图几何锚点 `ISO_WALL_GEO`（base 全跨度/**face 正面墙跨度(不含端帽)**/vertex/tipX/wallH，贴图像素空间）仅供：默认布局生成 + 碰撞底边提取；**拼接吸附与碰撞一律用 face**（端帽互相重叠藏进相邻件体内，接缝呈壁柱观感）

### 常见陷阱：flipX 镜像锚点（本次大错乱根因）
- Phaser flipX 是 **quad 不动、贴图内容镜像**（翻转 UV，不改顶点）：origin(0,0) 时贴图点 p.x 落在 `x0 + (w - p.x) * sx`
- 错误写法 `x0 = A.x - (w - p1.x)*sx` 会让 flip 瓦片整体偏移一个瓦宽（游戏内"断断续续"的直接原因）
- 正确：`x0 = A.x - (w - p0.x)*sx; y0 = A.y - p0.y*sy`（flip 时 p0→A、p1→B）；**凡写 flip 锚点公式，先用单件底边线段数值自检再上图**

### 素材管线（tools/wall-asset-prep.py）
- 源图：`素材库/场景/地形/僵尸地牢/` wall-2.png + wall-转角上/下/左/右.png
- 处理：alpha<80 清零（去 faint 描边/AI 水印）+ 内容包围盒裁剪 + 最长边 1600 压缩（optimize）；**不做列裁剪**（主体保持原样，端帽/渐隐尾保留，用户手动拼合）
- **高度归一化（tools/wall-height-normalize.py）**：AI 素材常带轻微真透视（顶/底边不平行），按列绕底边纵向缩放使顶边∥底边——否则拼接"底部对齐顶部矮一截"。新直墙/转角一律先过这道
- 产物：`assets/terrain/wall_diag.png` + `wall_corner_top/bottom/left/right.png` + `wall_straight.png`（新直墙，已归一化）；`tools/wall-room-sim.py` 为拼装模拟器（与 JS 同数学，改布局先跑它）

### 墙壁编辑器（src/ui/wall-editor.js，HUD 左下「摆墙」按钮）
- **面板两栏**：标准组件（环境组件按 family 分组，墙壁为第一个 family `wall`，缩略图拖入场景按默认大小放置，拖放中滚轮缩放、Ctrl+滚轮水平镜像）；预制组件（已存预设方案，放置/删除）
- **框选模式**：「框选」按钮开启后长按拖出选框，选中范围内环境组件；选中件黑白交替闪烁（250ms tint 交替）
- **图层面板**（编辑器左侧，仿 Photoshop）：场景件按 depth 降序列出（自动命名 直墙 1/直墙 2…），点击=单选同步画布，拖拽条目=重排图层（depth 取新邻居中值局部调整，顶层盖底层）
- **角度补偿**：新件放置默认带 `slopeFixOf`（贴图固有斜率→显示斜率对齐地板线 30°，纵向微拉）；「对齐地板角」按钮一键补偿选中件
- **拼接吸附**：点选 A → Shift 加选 B → 一键：B 继承 A 缩放/翻转（同缩放=同墙高）+ B 底边起点(face)吸附到 A 底边终点并沿走向回退 `SNAP_OVERLAP=8`px（接缝只叠不缺，锚点拟合公差兜底）；Shift+点击=加选
- **整组操作**：拖任一选中件=整组平移；滚轮=绕组中心统一缩放（位置同步）；Ctrl+滚轮=绕组中心水平镜像；Q/E=深度（Shift±10）；Del=删除选中；命名「存为预设」
- 编辑模式置 `Game._wallEditMode`：input.js 拦截攻击/按键（编辑器捕获监听先处理）
- **常见陷阱：项目 Phaser 配置 `input: { mouse: false, keyboard: false }`（防拦截 DOM Input 系统）——`scene.input.on('pointer*')` 永远不会触发！指针交互一律走 DOM window 事件 + `_clientToWorld`（canvas rect + camera.getWorldPoint）换算**
- 预制件带 `family` 字段与组中心 `cx/cy`；场景生成器扩展新环境组件时：STD_COMPONENTS 加条目 + 新 family 即可
- 面板：预制下拉（加载/镜像/删除）、命名存为预制、恢复默认菱形
- 镜像：绕件组包围盒中心 X 取反 + flipX 翻转（`_mirrorPieces`）

### 预制组合库（src/world/wall-prefabs.js → data/wall-prefabs.json）
- 结构：`{ "<key>": { name, pieces: [...] } }`；BootScene.create 预载（fetch /data/，即 public/data 副本）
- 保存：Electron 走通用 `save-json`/`load-json` IPC（限 data/ 目录，dev 写 public/data）；**Vite 开发服务器走 `vite.config.js` 的 `__save-json` 中间件（POST，直写 public/data + data/ 双份，刷新即生效）**；纯浏览器无中间件时回退下载
- 主神空间测试房：代码默认菱形房间已移除，用户用编辑器自摆；`_setupMainHubTerrain` 仅在预制 `hub_diamond` 存在时按预制渲染；编辑器「恢复默认菱形」按钮仍可生成代码默认布局作起点
- **注意**：wall-prefabs.json 也是 data/ ↔ public/data/ 双份，中间件/IPC 保存只写 public/data（dev 运行时读这份）；提交/打包前记得同步回 data/（中间件已双写）

### 夹角生成（2026-07-24 定论：一图基底流——夹角不出 AI 素材，基底直墙拼装）
- **工作流定论：生图 AI 只出一张直墙基底，其余全部程序化完成**（夹角=基底拼装、吸附/叠合=编辑器、角度/等高=管线归一化）
- 四个夹角 = 基底直墙（wall_straight）2~4 件拼成：顶点处两臂各一件（按方向选 flipX）+ 每臂续接件（`SNAP_OVERLAP` 叠合）
- 透视规则：整体深度 下>左>右>上；夹角内**朝下的臂（更靠近镜头）depth 更大**（顶点在上层）
- 顶点缝隙：点对点相接接受微小缝隙（过冲方案、墙柱填充方案均已废弃——错位/不成熟），介意时在编辑器里单件微调
- 生成脚本：`tools/gen-corner-prefabs.mjs`（从既有上夹角读缩放保持全套一致）→ 写入 wall-prefabs.json；用户「上夹角」为手工拼装基准件
- 需要新夹角规格时改脚本顶点/臂长重跑即可，不要再走 AI 出图

### 墙壁与实体透视关系（2026-07-24）
- **墙件 depth 规则**：后墙（室内一侧朝镜头，如上夹角两臂、左右夹角的上臂）depth = **min 底边 y**——室内实体（footY 沿墙处处更大）永远绘制在墙前，修复"右臂错误遮挡人物"；前墙（室外一侧朝镜头，如下夹角两臂、左右夹角的下臂）depth = **max 底边 y**——正确遮挡室内。单 depth 对角墙必有误差区，规则只决定误差放哪侧
- **X 光圆圈**（GameScene `_syncXRayCircles`，每帧）：墙件 depth > 实体 depth 且**几何遮挡判定**（脚底在墙面底边线之后且身体进入墙面覆盖带，覆盖量 > 身体 15% 才算被遮挡——不用包围盒，斜墙 AABB 一半是空的必提前触发）→ 三层：①**地板透视洞**（动态 CanvasTexture，每帧从烘焙地板 `Renderer.terrainTexture` 抠实体为中心 192×192 区域，径向 destination-in 渐隐，盖在墙上相当于挖洞）②**圆环**（中间全透明、边缘黑→透明渐变）③实体贴图克隆（alpha 0.9，**玩家含武器/副手/盾牌克隆**）；**接缝防半遮：触发后按圆覆盖范围内所有墙件（全包围盒）的最高 depth 绘制**；脱离遮挡自动隐藏，实体移除自动销毁纹理与贴图；地图模式不启用。**注意：Phaser 4 已删除 BitmapMask（createBitmapMask 不存在），WebGL 下蒙版只有 Filter 通道（per-object render pass，贵）——遮挡透视走"抠地板盖墙+圆环+贴图克隆"轻量方案，不用蒙版**

### iso 墙碰撞：线段模型（2026-07-24，修贴墙加速滑行）
- `WallSystem.isoSegments`：`rebuildIsoCollision()` 按件底边生成 `{x1,y1,x2,y2,halfThick:10}` 线段；`canMoveTo` 用点-线段距离场，`blocked` 用线段相交
- `resolve` 滑动顺序：直达 → **沿最近阻挡墙段的切向分量滑动**（速度不超移动意图，杜绝"贴墙突然加速"）→ 轴分解滑动 → 步长回退；旧"切向滑动脱困"块已删除（它是加速根因：每帧侧向传送一个半径）
- 阶梯矩形（36×20/30px）保留给寻路/小地图/静态物理体，不再作为移动滑动依据

### 门闸系统（2026-07-24，战斗房带门直墙）

**地牢墙样式表（2026-07-25 新增）**：`ISO_WALL_STYLES`（wall-system.js，key=dungeonType）——每条 `{ straight, gate, chestPrefab, gateSound, corners? }`：straight/gate 为 ISO_WALL_GEO 键；chestPrefab 为该地牢精英宝箱房预制名（缺省「宝箱房」）；gateSound 为门闸开关音效；**corners（可选）= `{ top, bottom, left, right }` 四顶点夹角预制名（摆墙编辑器手拼），登记后菱形房间四角用预制构建（跨件共享端点=顶点锚定，深度整体平移保留预制内图层，两臂最远端接 edgeFill），缺失/无效逐个回退程序化转角臂**。`WallSystem.setWallStyle(dungeonType)` 由 DungeonMapSystem 入场设置/离场复位；`buildIsoDiamondWalls`/`WallGate.placeAt`/门闸音效/`combat-room._setupGate`/宝箱房预制选择全部走样式（直墙贴图/门闸贴图/门洞 gateX/预制/音效自动跟随）。**新地牢换墙 = ①素材管线出 `xxx_wall_straight.png` + `xxx_gate.png` ②ISO_WALL_GEO 加 `xxx_straight`/`xxx_gate`（配 editor 显示名自动进摆墙面板）③ISO_WALL_STYLES 登记 ④BootScene 加载**。宝箱房（chest-room-system）也已跟随：直墙件按样式几何把预制 face 线段重铺、门墙件识别样式门贴图、门闸几何/帧数随样式。
- **素材管线**：`tools/door-video-frames.py`——视频 0~4.05s 均匀 16 帧 → 边界洪水抠图（白底/棋盘底）+ 豆包水印区抹除（原图右下角 600:720,675:720）+ **门洞封闭区二次抠图**（栏杆包围的亮区洪水填充进不去：x[295,405]y[200,510] 亮度>180 去底；拱门内浅灰地面楔形区 y[240,510] 亮度>120 去底，让游戏地板透出）→ 16 帧统一包围盒对齐 → 4×4 打包 `wall_gate.png`；首帧=关闭、末帧=打开
- **墙顶对齐 warp（2026-07-25，`tools/gate-top-warp.py`）**：源视频带透视，门闸贴图墙顶线**不平行底边**（左区斜率 0.40/右区 0.71 vs 底边 0.5037）且墙高比（254~267/317.3）低于直墙（691/757=0.9128）——拼接处墙顶落差实测 26px(左缝)/17px(顶点)，即用户报的"下夹角错位"根因。修法：逐列竖向 warp（锚定底边，墙区拉伸到 290 tex px = 0.9128×317.3；**拱门区 raw<1 保持 k=1 不压缩**；拟合墙顶时**剔除拱门曲线污染区** x∈[250,430]，只拟合纯墙身 [20,230]/[430,620]）。**两个顺序陷阱：① 必须先在扩帧画布（595+shift46=641）就位再 warp——在原帧内 warp 左端新墙顶为负坐标会被帧顶裁掉，事后 shift 无法挽回；② 不要用"封顶在原帧内"的 cap——那会把拉伸钳回 1 使 warp 失效**（两版错误脚本都已废弃，以现脚本为准）。帧高 595→641，ISO_WALL_GEO.gate 与 BootScene frameHeight 同步更新。修复后接缝落差 <3px
- **几何**：`ISO_WALL_GEO.gate`（base 底边线 / gateX 门洞 x 范围 / frames:16 / wallH:290）；BootScene spritesheet 加载（带 endFrame）
- **门闸实体**（`src/world/wall-gate.js`）：状态机 open/closed/opening/closing（自管帧计时 900ms，不用 Phaser anims）；**碰撞 = 门两侧墙体线段常开 + 门洞线段按状态启停**（closed/closing 挡、open/opening 通，isoSegments `_gate` 标记）；depth = `_homeDepth`（继承被替换件的 min/max 规则，过门时脚底越线才临时退后）；悬停金色轮廓（全 16 帧门洞区剪影×shadowBlur 烘焙，**本体 destination-out 抹除只留外发光**，跟随当前帧）；已接入 X 光遮挡列表（GameScene occluders）
- **门闸缩放规则（2026-07-26）**：`placeAt` 用**墙件同一显示尺度**（`ISO_WALL_HEIGHT / wallH` + `slopeFixOf`，底边起点锚定 A），门高与邻墙一致（大小墙衔接）；门宽与被替换件的差距靠叠合吸收。僵尸素材恰好自洽（此尺度 == 旧线段跨度反推值），行为不变；**不要回到线段反推缩放**（门高会与邻墙错位）
- **一房一门规则（2026-07-26）**：`buildIsoDiamondWalls` 每房随机选一个 `gateCorner`，其余角的门件改铺直墙；`_setupGate` **优先替换样式门贴图件**（转角装饰门→功能门），无门件才回退最近的直墙件（跳过 `_corner` 转角件）——一间房天然只有一扇门
- **预制夹角件深度规则（2026-07-26）**：`_placeCornerPrefab` 的深度**必须按房间规则重算**（top=min / bottom=max / 左右按臂上下，+转角偏置），编辑器的绝对深度只保留内部相对顺序（0.1/级）——直接平移编辑器深度会让前墙件深度低于实体（下夹角实体画在墙上的根因）
- **战斗房接入**（combat-room-system）：入场 `_setupGate` 替换距玩家最近的直墙件并播关门动画；`update(dt)` 驱动帧推进+悬停（dungeon-map-system.updateCombat 每帧调用）；`cleanupGate` 随 cleanupRoom 销毁
- **战斗完成**：`openGate()` 播开门动画 → 完成后门外白区（门外法线走出菱形后**吸附房内同一地板晶格**（整块砖含上角都在界外，防重叠；远角径向 destination-out 圆滑淡出）+ 微光描边，`isPlayerInGateZone` 检测玩家进入 → `_leaveCombatViaPortal` 与传送门同效）+ `GateLight.spawn` 仅门外地块光斑（大泛光+亮核，呼吸；入门光束已移除）
- **传送门已删**：dungeon-map-system 两处 `spawnExitPortal()`（普通节点/精英宝箱后）改 `openGate()`；Boss 场地（集合体）传送门流程不变
- **教训**：门闸替换整墙时不能只注册门洞碰撞——门两侧墙体线段必须常开，否则墙身可穿

- **单帧装饰门碰撞（2026-07-29，openDoor）**：非 16 帧门闸的单帧门贴图（拱门永久开放）在 geo 加 `openDoor: true` + `gateX`，`_pieceBaseSegments` 自动把碰撞拆成门洞两侧墙身两段（门洞可通行）——功能门闸（WallGate）与装饰门件（如沼泽转角门）不受影响（它们无 openDoor，仍整段实心）。**教训：装饰件可视化≠碰撞，门类件必须显式声明门洞碰撞语义**

### 待接入（下一阶段）
- 地牢随机生成：从预制库抽房间布局放置 + `_mirrorPieces` 镜像
- ~~主神空间边界墙仍是旧硬拉伸视觉~~（2026-07-29 已完成：主神空间菱形化，见下节）
- ~~Boss 场地门闸化~~（2026-07-28 已完成：Boss 房复用 CombatRoomSystem 门闸机制，传送门仅作 placeAt 失败兜底）

### 主神空间状态缓存（2026-07-30 补齐）
- **机制**：`SceneManager._saveMainSceneState()`（保存 `_mainEntities/_mainPlayerPos/_mainTrees/_mainEffects/_mainCamera`）→ `_loadMainScene` 恢复实体与玩家位置；无缓存时走兜底=只剩光杆玩家。
- **保存时机（三个，缺一不可）**：①`switchScene` 离开 main 时；②**出征 `depart()` 清实体前**——depart 绕开 switchScene 直接 `Game.entities.clear()`，不保存则任何地牢返回路径都拿到空缓存（"放弃返回后主神空间什么都没有"根因，2026-07-30 修复）；③`Game.init` 初始生成完毕后（安全网）。
- **教训：场景切换的旁路（bypass switchScene 直接改 currentScene/清实体的路径）必须逐个核对状态保存**——depart() 设 `SceneManager.currentScene='scene7'` 跳过了整个 switchScene 生命周期（保存/清理/进度条），是隐性旁路的典型。

### NPC 立绘调整工具（2026-07-30 重构）
- **交互**：点击「调整立绘」后直接拖对话左侧立绘（X/Y 自由拖动）；面板只负责缩放/旋转/镜像/重置/保存。
- **持久化**：`data/npc-portrait-params.json`（保存管道=Electron `save-json` IPC → Vite `__save-json` 双写 → 下载兜底，与 wall-prefabs 同规格）；参数模型 `{x,y,scale,rotation,flipX}`（旧 offsetX/bottom 自动迁移；锚 bottom 按 NPC 默认恢复，不入库）。**rel 必须带 `data/` 前缀**（vite 中间件强制校验，否则必落下载兜底）。
- **关键细节**：拖动期禁用立绘 `transition: transform 0.3s`（否则拖拽滞后）；立绘 mousedown 必须 stopPropagation（对话框 clickOutside 关闭/画布抢事件）；`WeaponAnimConfig` 解析一律 `animConfigKey || weaponType`（R93 副手误吃 G18 pistol 配置翻转的根因——weaponType 是同族共享，animConfigKey 才是按枪配置键）；**weaponType 分支名单随 animConfigKey 解析同步补齐**（weapon-transform getWeaponSize/getAttackAnimOffset/锚点表——R93 漏补导致错误放大+手臂错位）。

### 障碍物体系（2026-07-30 新增）
- **素材管线**：AI 道具图（透明底带噪点）→ 最大连通域 + 包围盒 → `assets/terrain/obstacle_*.png`；geo 注册 `ISO_WALL_GEO` 加 `category:'obstacle'` + `foot:{w,d}`（底部 15% 高度区实测 footprint 宽，深≈宽×0.35）。
- **碰撞**：`_addPieceCollision` 障碍物走**矩形 footprint 墙**（锚底边中心、随缩放；`_obstacle` 标记）；`_pieceBaseSegments` 返回空（不进 iso 线段模型）。
- **编辑器**：摆墙面板分类页签（墙类/门类/障碍物类，geo 带 editor 自动归类：category→障碍物、gateX→门、其余→墙）；障碍物放置不做 30° 角度补偿（billboard）；Shift+滚轮=旋转（仅障碍物，`rotation` 字段经 `_placeIsoPiece`/`_applyToSprite` 应用）。
- **障碍物编辑器**：仅单选一个障碍物时显示（墙壁编辑器下方）；重置=初始变换；保存=全部障碍物写 `data/obstacle-layout.json`（_persistJson 三管道），`_setupMainHubTerrain` 按布局重建（含首启竞速兜底）。
- **固定 NPC（祭坛/仓库）**：不再用 obstacle 静态墙——`collisionShape:'rect'` 矩形 footprint + `resolveCollisions` 圆-矩形精确分离分支（逆透视压缩判定；圆心在矩形内沿长轴推出）。

### 主神空间菱形化（2026-07-29 落地，复用地牢标准工作流；**同日已按用户要求回退**，保留条目作参考）
- **回退说明（V0.326）**：菱形世界（5436×3359/双材质地板/代码建墙）用户实机不满意，scene-manager/dungeon-floor-texture git 回退、game-config 手改回退（**npcs.altar 祭坛贴图配置保留**）；`inner` 双材质与 roomSize 机制随之移除。大理石墙/门改为**编辑器组件**路径：新透明底素材（墙.png/门.png）过 `tools/prep-hub-wall-gate.py`（透明底无需 GrabCut：最大连通域+腐蚀1px+几何实测；门洞 gateX 按"列最低不透明 y 高于底边线 60px 的连续区间"实测）→ `ISO_WALL_GEO.hub_straight/hub_gate`（editor 字段自动进摆墙面板）+ `ISO_WALL_STYLES.mainHub.gate='hub_gate'`。
- **尺寸**：S=2048（`mainHub.roomSize`）→ rx=2457.6/ry=1419.0，边距 M=260，世界 5436×3359，origin=(2718,1679)；`_setupMainHubTerrain` 与地牢同路径：`applyDiamondFloor` + `setWallStyle('mainHub')` + `buildIsoDiamondWalls`；边界矩形墙降为 `noVisual` 隐形兜底；hub_diamond 预制分支已删。
- **地板双材质**：`profile.inner = { size, tiles }`（dungeon-floor-texture）——外圈大理石 + 中心 1024 档内圈木地板；`setDungeonFloorProfile` 新字段必须显式透传（deco 教训同款）。
- **墙样式**：`ISO_WALL_GEO.hub_straight`（slope 0.5049 / wallH 703.9）+ `ISO_WALL_STYLES.mainHub`（无 corners/gate → 全直墙无门）；从地牢返回时样式被复位，统一入口每次重设 mainHub 再建墙。
- **坐标迁移**：portals/testArea 等绝对坐标项必须随世界尺寸手迁（本次 (3478,2363)→(3918,1949)）；相对 origin 的（NPC/武器排/掉落）自动跟随。
- **祭坛贴图 NPC**：仿仓库宝箱模板（sprite.idleKey 静态图 + obstacle 底座 + clickArea + noSeparation/noShadow），注意 `game.js` 创建 NPC 时这些字段要逐个透传（祭坛此前只传基础字段=实心圆的根因）。

### 白底 AI 素材抠图（2026-07-29，大理石墙血泪经验）
即梦白底图（含烘焙进 RGB 的假透明棋盘底纹）抠图三坑，正解 = **GrabCut + 盖板几何重建**（`tools/prep-hub-assets.py`）：
1. **固定亮度阈值洪水**吃墙顶亮面（顶沿 230→208 软渐变无暗缝可挡）。
2. **浮动容差洪水**（邻像素比较）从抗锯齿软边漏进墙内，墙内平滑区一旦进入全淹。
3. **Canny 路障**：低阈值被背景噪点触发碎网；必须**先高斯模糊**再 Canny——即便如此软轮廓仍漏。
4. **正解**：sure_bg=边界连通高亮区（>235）+ sure_fg=暗核（<205 最大连通域腐蚀）→ GrabCut 仲裁亮盖板归属；残留盖板坑用**几何重建**填（墙带顶边必为与底边平行的直线：窗格最小顶沿拟合截距、强制斜率=底边、分位数防噪）→ 封闭内洞边界洪水反填。
5. **分位数取偏低**（30）：拟合线宁低勿高——偏高会把棋盘底纹条带填进 alpha。
6. 换素材时优先要**深色底**图源，白底/棋盘底天然难抠。

### 僵尸地牢菱形房间（2026-07-24 落地）
- **尺寸规则**：原正方形 S（1024~2048 随机、Boss 1024）→ rx=1.2S、ry=rx×0.5774（30°）；**边距 M=260（≥墙贴图高度 190×角度补偿≈217 + 缓冲，否则上夹角被世界顶裁掉）**，菱形在世界正中央，区外全黑
- **地板**：`applyDiamondFloor(worldW, worldH, cx, cy, rx, ry)`（dungeon-floor-texture.js）——黑砖等距平铺按菱形裁剪，区外全黑，边缘黑渐变
- **墙壁**：`WallSystem.buildIsoDiamondWalls(cx, cy, rx, ry)`——基底直墙斜铺：四顶点转角点对点（上=后墙 min、下=前墙 max、左/右=上臂 min 下臂 max；**转角臂统一 +5 深度偏置**——顶点侧盖住续接件，预制转角同款规则；纹理随机的墙若让续接件盖住转角臂，贴图切边会暴露在接缝上（2026-07-25 沼泽柴墙左夹角接缝教训））+ 四边续接（**瓦片定长定高、不足靠叠合，绝不压扁**——否则小房间边墙比夹角矮一截），`rebuildIsoCollision()` 出阶梯碰撞
- **生成点**：玩家从随机顶点的内法线方向入场（off=offsetFromEdge+60）；怪物在对角顶点附近拒绝采样（菱形内缩不等式 `|dx|/(rx-i)+|dy|/(ry-i)<=1`）；出口传送门仍居中
- **Boss 场地**：boss-reward-system `_setupArena` 同款菱形；玩家下顶点方向、集合体上顶点方向
- **备份/恢复**：combat-room 与 boss-reward 均备份恢复 `WallSystem.isoVisuals`（否则战斗房墙残留主神空间）

---

---

## 怪物 HUD 锚点工作流（2026-07-21 新增；2026-07-23 起为**新怪物必做项**）

**默认规则**：新增怪物的名字/血条锚定**圆柱体（胶囊）碰撞体积最上方**（胶囊顶 = footprint Y − `collider.height`），不再按贴图顶部定位。**自 2026-07-23 起，新增怪物必须设置 `"capsuleHudAnchor": true`（已补齐：poisonMaggot/minerZombie/lanternMinerZombie/foremanZombie）。**
**三套碰撞体积注意区分**：footprint 椭圆（地面分离/范围判定）、绿色矩形（`collisionWidth×collisionHeight`，近战判定）、圆柱体胶囊（`collider.height`，来自 `config.height` 或 `render.spriteSize`，投射物判定）。HUD 锚点用的是**圆柱体胶囊**，不是绿色矩形。
**启用方式**：`enemy-config.json` 该怪物 `render` 块加 `"capsuleHudAnchor": true`（GameScene 按此开关选择锚点；未配置的旧怪物保持贴图顶部锚点不动）。
**配套校准**：`render.collisionHeight` 只影响绿色矩形（近战判定），不影响 HUD 锚点；`render.hudOffsetY` 语义不变（在锚点基础上的额外偏移，默认为 0 即可）。
**常见陷阱：`colliderOffsetY/X` 必须写在 `render` 块内**——`enemy.js` 基类只读 `config.render.colliderOffsetY`；写在配置顶层是死配置不生效（2026-07-25 工头顶层 -75 一直未生效的根因；手脑/骑士也曾踩过，见 enemy.js:168 注释）。NPC 类相反，读顶层（npc.js:48）。

---

## NPC 添加标准工作流（2026-07-22 新增，新 NPC 一律按此开展）

### 1. 素材（原则 9）
复制到 `assets/npc/<npc英文名>/`（如 `assets/npc/mouse_king/idle.png`、`walking.png`）；**先目检帧布局**（行列网格、有效帧数、内容边界），再配 `frameWidth/Height/endFrame`。

### 2. 配置（data/game-config.json `npcs.<key>`，唯一真相源）
- `sprite`（可选，缺省保持纯色圆占位）：`{ idleKey, walkKey, size, footOffsetY, walkFps }`
  - `idleKey/walkKey`：BootScene 注册的动画键；`size`：显示边长（方形帧）；`footOffsetY`：逻辑脚底到贴图中心偏移（内容底边贴地校准）；`walkFps`：行走帧率
- `wander`（可选，缺省不动）：`{ radius, speed, idleMs, moveMinMs, moveMaxMs }`——以生成点为中心 radius 内随机选点移动，每次移动后停留 idleMs，移动时长 moveMinMs~moveMaxMs 随机
- `noSeparation`（可选）：固定不动，实体分离由对方承担全部位移
- `obstacle`（可选，**家具型静态 NPC 推荐**）：`{ width, height, offsetY, wallHeight? }`——底座矩形障碍。在 `_setupMainHubTerrain` 与边界墙同入口注册为 WallSystem 静态墙（`noVisual` 跳过墙面视觉），实体 `collisionRadius` 只留小半径（~20），阻挡交给矩形。**不要给家具型 NPC 套大圆 footprint**：圆 X/Y 对称，调大无法靠近、调小贴图错误遮挡；矩形底座宽=贴图底座、深=底座厚度，靠近/绕行/遮挡三者都自然

### 3. BootScene 加载与动画注册
`spritesheet` 加载（**必须带 endFrame**），`anims.create` idle 单帧循环 + walk 循环（frameRate 读 sprite.walkFps）。

### 4. 实体与渲染（已通用，无需改代码）
- `npc.js`：构造函数接收 `config.sprite`（→ `spriteCfg`）与 `config.wander`（→ `wanderCfg`）；游走由 `NPC._updateWander` 驱动（WallSystem.resolve 撞墙校验、`_pickWanderTarget` 可达性重试），`isMoving`/`_facingLeft` 供动画与翻转
- `GameScene._syncNeutralEntities`：检测 `e.spriteCfg` 自动创建贴图 Sprite（idle/walk 切换、flipX、名字标签贴图顶部）；无配置回退 `neutral_circle` 纯色圆
- 生成处（如 `game.js spawnNPC`）把 `shopCfg.sprite / shopCfg.wander` 透传进 NPC config

### 5. 验证
lint / vite build / test-collider / test-config-integrity；实机验证 idle/walk 切换、朝向翻转、游走范围与停留节奏、名字标签位置。

---

## 音效导入工作流（2026-07-17 新增，参照集合体落地；2026-07-21 目录规范更新）

### 目录规范（2026-07-21）
所有音效**按实体类别建子目录，禁止堆在 assets/sounds/ 根目录**：
```
assets/sounds/enemies/<怪物英文名>/   # 怪物音效（如 amalgam/time_agent/time_agent_shield）
assets/sounds/weapons/                # 枪械开火/换弹/过热等武器音效
assets/sounds/bow/                    # 弓箭音效
assets/sounds/shield/                 # 盾牌格挡/受击音效
assets/sounds/ui/                     # 金币/升级/出售/击倒等系统音效
```
2026-07-21 已完成存量迁移（根目录音效全部入子目录，引用同步更新）。新增音效一律入对应子目录，路径写进配置（enemy-config.json sounds / weapon-fx-config.js 等），不在代码里写死。

### 步骤1: 素材复制建档（规则 4）
按类别在项目下建子文件夹，把用户提供的音频复制进去：
```
assets/sounds/enemies/<怪物英文名>/   # 如 assets/sounds/enemies/amalgam/idle.mp3
```

### 步骤2: enemy-config.json 配置 sounds 映射（规则 1，不硬编码）
```json
"sounds": {
  "idle":   "assets/sounds/enemies/amalgam/idle.mp3",
  "throw":  "assets/sounds/enemies/amalgam/idle.mp3",
  "impact": "assets/sounds/enemies/amalgam/hitting.mp3",
  "slamHit":"assets/sounds/enemies/amalgam/hitting.mp3",
  "death":  "assets/sounds/enemies/amalgam/dying.mp3",
  "idleInterval": 3000
}
```
键名按怪物类内事件自定义（idle/throw/impact/slamHit/death/...）；`idleInterval` 为待机环境音间隔（ms）。

### 步骤3: 怪物类内按事件播放
`SoundManager.playFile(path)` 直接播放文件，无需 BootScene 预加载。统一在类内写一个小助手：

```javascript
_playSound(key) {
    const path = this.config?.sounds?.[key];
    if (path && SoundManager && typeof SoundManager.playFile === 'function') {
        SoundManager.playFile(path);
    }
}
```

事件触发点（集合体范例）：
- idle 待机：`update()` 中计时器到点播放（间隔读 `sounds.idleInterval`）
- 投掷出手（fireFrame）：`_playSound('throw')`
- 投射物落地：`_playSound('impact')`
- 砸地命中帧（hitFrames）：`_playSound('slamHit')`
- 死亡：`onDeath()` 中 `_playSound('death')`

### 步骤4: 距离衰减（可选，位置音效，2026-08-03）
需要"声源离玩家越近越大声、超出最大距离无声"的音效，走 SoundManager 位置音效能力（音量逐帧由主循环统一刷新，调用方不自己算距离）：

- **循环音轨**：播放后每帧把声源坐标与衰减参数挂上——
  ```javascript
  SoundManager.setLoopPosition(id, x, y, {
      base: s.loopVolumeBase ?? 0.5,     // 远端音量
      max: s.loopVolumeMax ?? 1.5,       // 近端音量（可 >100%）
      nearDist: s.loopNearDist ?? 150,   // 满音量距离
      farDist: s.loopFarDist ?? 600,     // base 音量距离
      maxDist: s.loopMaxDist ?? 2000,    // 静音距离，超出后音量 0
  });
  ```
  曲线：d≤nearDist 恒 max → farDist 处 base → maxDist 处 0（双段线性连续）。
- **一次性音效**：`SoundManager.playFileAt(path, x, y, volume, channel, { nearDist, maxDist })`——按播放瞬间距离衰减，超出 maxDist 不播。
- **配置键**：enemy-config.json `sounds` 块用 `loopVolumeBase/loopVolumeMax/loopNearDist/loopFarDist/loopMaxDist`（蝇群范式，值全部进配置不硬编码）；音量刷新由 `game.js update()` 顶部 `SoundManager.update(dt)` 统一完成。
- **注意**：无玩家（或玩家 inactive）时保持当前音量不变；死亡/场景切换清理走既有 `_destroyCustomEffects` / `stopAllLoops`，位置音效无需额外清理。

---

## 常见问题

### 精灵图加载时报 "has no frame X"

原因：图片高度不是 `frameHeight` 的整数倍，Phaser 只识别了整数行数。  
解决：
1. 短期：在 `load.spritesheet` 中加 `endFrame: N`
2. 长期：运行 `sprite-normalizer.py` 自动填充到正确尺寸

### 切换动画时贴图忽大忽小

原因：不同精灵图的内容大小/中心位置不一致，Phaser 按整帧缩放导致内容大小差异。  
解决：运行 `sprite-normalizer.py` 统一所有精灵图的内容大小和中心位置。

---

## 工具文件

- `tools/sprite-normalizer.py` — 精灵图标准化脚本
- `tools/sprite-meta.json` — 脚本输出元数据（记录目标参数）

---

## 怪物 AI 状态机（BlackWolf 示例）

### 设计原则
- **不硬编码**：AI 参数从 `enemy-config.json` 或构造函数 `config.ai` 读取
- **外部系统驱动**：BlackWolf 的 `update()` 只设置目标属性（`target`、`_tacticalTarget`、`_lastKnownTargetPos`），`MovementSystem` 和 `CombatSystem` 在后续帧执行移动/攻击
- **状态机模式**：`pacing` → `chasing` → `lost` → `pacing`

### 状态定义

| 状态 | 速度 | 目标 | 行为 |
|------|------|------|------|
| `pacing` | `maxSpeed * 0.5` | `_tacticalTarget`（200px 内随机点） | 在踱步中心半径 200px 内慢速漫游 |
| `chasing` | `maxSpeed` | `target`（最近玩家） | 向玩家奔跑，进入攻击范围时触发攻击 |
| `lost` | 无（计时中） | 保留 `target` | 目标跑出 800px 后持续 2s 计时，超时回 pacing |

### 参数配置（enemy-config.json）

```json
{
  "blackWolf": {
    "speed": 93.6,
    "dashDistance": 200,
    "ai": {
      "aggroRange": 800,
      "pacingRange": 200,
      "loseTimeout": 2000
    }
  }
}
```

### 代码实现要点

```javascript
// 1. update() 中扫描 + 执行 AI
this._aiScanTimer += dt;
if (this._aiScanTimer >= this._aiScanInterval) {
    this._aiScanTimer = 0;
    this._updateAIState(dt, entities);  // 状态切换
}
this._executeAI(dt, entities);  // 设置 target / _tacticalTarget / maxSpeed

// 2. pacing 状态：设置 _tacticalTarget，让 MovementSystem 读取
this._tacticalTarget = this._pacingTarget;
this.maxSpeed = this._baseSpeed * 0.5;

// 3. chasing 状态：设置 target，让 CombatSystem 读取
this.target = nearestPlayer;
this.maxSpeed = this._baseSpeed;
this._tacticalTarget = null;
```

---

## 状态效果系统（DamageableEntity 统一驱动）

### 设计原则
- **单一来源**：所有伤害型状态效果（中毒、流血、魔法易伤、无人机易伤）的 `_update*` 方法**只存在于 DamageableEntity 基类**
- **子类不重复**：`enemy.js` 和 `combat-system.js` 不再包含 `_updatePoison`/`_updateBleed` 等方法
- **统一入口**：`DamageableEntity.update(dt)` 调用 `updateStatusEffects(dt)` + 4 个 `_update*` 方法

### 属性初始化链
```
Combatant 构造函数 → DamageableEntity 构造函数
  _poisonStacks, _poisonTimer, _poisonTickTimer, _poisonEffectId
  _bleedStacks, _bleedTimer, _bleedTickTimer, _bleedEffectId
  _magicVulnerabilityStacks, _magicVulnerabilityTimer
  _droneVulnerabilityStacks, _droneVulnerabilityTimer

Enemy 构造函数只保留特有属性：
  this._poisonEffect = new PoisonEffect();  // 粒子效果（基类没有）
```

### 为什么之前重复？
`enemy.js` 和 `combat-system.js` 各自维护了一套 `_updatePoison`/`_updateBleed`/`_updateMagicVulnerability`/`_updateDroneVulnerability`。
这意味着：当 `CombatSystem.update()` 和 `Enemy.update()` 都被调用时，**状态效果每帧被更新两次**，导致中毒/流血伤害翻倍。

### 重构后调用链
```
Enemy.update() → DamageableEntity.update() → updateStatusEffects() + _updatePoison() + ...
CombatSystem.update() → 不再调用状态效果更新（只负责战斗：眩晕、攻击、武器动画）
```

---

## Dash 偏移计算（_getDashOffset 统一接口）

### 问题
`GameScene.js` 的 `_syncBodiesToPhysics` 中有一段 12 行的 switch 逻辑，用于根据 `_dashAngle` 或 `_dashStartFacing` 计算冲刺偏移量。这段逻辑在 `enemy-types.js`（BlackWolf）中也存在。

### 解决
在 `Enemy` 基类定义 `_getDashOffset()` 方法：
```javascript
_getDashOffset() {
    if (this._attackDashOffset <= 0) return { x: 0, y: 0 };
    if (this._dashAngle !== undefined) {
        return {
            x: Math.cos(this._dashAngle) * this._attackDashOffset,
            y: Math.sin(this._dashAngle) * this._attackDashOffset
        };
    }
    switch (this._dashStartFacing || this._facing) {
        case 'right': return { x: this._attackDashOffset, y: 0 };
        case 'left':  return { x: -this._attackDashOffset, y: 0 };
        case 'down':  return { x: 0, y: this._attackDashOffset };
        case 'up':    return { x: 0, y: -this._attackDashOffset };
        default:      return { x: 0, y: 0 };
    }
}
```

`GameScene.js` 和 `enemy-types.js` 统一调用 `entity._getDashOffset()`，不再重复 switch 逻辑。

---

## 树木碰撞体优化（大怪物卡树问题）

### 问题
黑狼碰撞体积 38 虽然不大，但在树木（视觉半径 25，碰撞半径 25）间移动时仍会被卡住。因为 `canMoveTo` 判定的是 `tree.radius + entity.radius < distance`，视觉半径和碰撞半径未分离。

### 解决
1. **视觉半径和碰撞半径分离**：每棵树的 `collisionRadius = radius × 0.6`（主神空间树木从 25 降到 15）
2. **滑动回退**：`WallSystem.resolve()` 在标准 X/Y 轴滑动都失败后，尝试按 75%/50%/25% 步长找到可移动的最远位置，避免完全卡住

### 新增属性
```javascript
addTree(x, y, radius, ...) {
    const collisionRadius = radius * 0.6;  // 碰撞半径仅为视觉的60%
    // ...
}
```

所有使用 `t.radius` 的位置（`canMoveTo`、`blocked`、Phaser 同步）统一使用 `t.collisionRadius || t.radius * 0.6`。

---

## 普通攻击一段跟手 + 方向性运动模糊（2026-08-03 落地；08-03 二轮复核修正，30 帧全贴手）

### 跟手：sword.attack 30 点轨迹改为跟随挥剑手
- **挥剑手 = 远侧手**（attack_sword 动画里唯一做大回环的手）：f0~f2 高举头后
  → f3 头顶最高 → f4~f6 挥到前方 → f7 下劈到位（命中帧在 f7，frame 22）。
- 生成脚本 `tools/prep-sword-attack-hand.py`：从 attack_sword.png 8 帧读拳头中心，
  换算 local（`(px-256)×144/516`），30 点插值后只替换 offsetX/offsetY
  （rotation/scale/blur/stretch 保留手动调参）。
- 当前轨迹（握把，即减去剑柄补偿后的手位）：f0 `(25.6,-25.4)` → f8 `(-24.8,-78.5)`
  （蓄力顶）→ f16 `(15.1,-79.1)`（前举）→ f22+ `(87.0,2.7)`（下劈到前伸手收势）。
- **f7/定格必须用「前伸手」**（2026-08-03 实机反馈"最后一帧+定格武器在后方、与手不相交"）：
  f7 全身实测手向前伸（x400-464），拳头中心 **f7=(425,278)→local (47.1,6.1)**，
  不是后手 x275（之前误读后手导致武器落在身后）。生成脚本 HAND_PX f7 已改。
- **HAND_PX 最终值（2026-08-03 三轮复核，贴图真值掩码为准）**：
  f0(213,116) f1(205,116) f2(192,116) f3(150,110) f4(282,115) f5(310,116) f6(330,120) f7(425,278)。
  依据：以贴图 alpha 掩码（BILINEAR 缩放到显示尺寸）判定锚点是否在角色像素上——
  GLM 初版 f0-f3=(196/185/150/128,118/118/115/116) 全部浮空（0~4%，即"前 10 帧脱手"根因）；
  原手调 f0-f3 半贴（27~37%）；复核手臂带顶端后定版（37~100% 全贴）。
- **30 帧阶梯映射（2026-08-03 三轮，关键修复）**：生成脚本从"帧间平滑插值"改为
  **阶梯映射**——手部只有 8 个定格姿势，精灵帧 f 覆盖 p∈[f/10,(f+1)/10)（f7 覆盖 [0.7,1]），
  每帧直接用当前精灵帧锚点。平滑插值会让握把在帧间漂移（f3→f4 跨度 154px 时 cfg11 脱手 122px）。
- **实机复核（冻结逐帧）**：`tools/cdp-sword-hold-frames.mjs` 手动定格 8 帧
  （play+timeScale=0 冻结帧 + 占位 tween 保 attacking 状态机 + 40s 进度时钟反推），
  现支持 30 帧全量定格（进度 i/29，精灵帧按权重同步）；对 30 帧握把落点做贴图真值掩码采样，
  **30/30 全部落在角色像素上（37%~100%）**；GLM-4.6V 逐帧特写复核 30/30 ON-HAND。
- **握把（剑柄）贴手（2026-08-03 修订）**：perFrame 偏移是**贴图中心**，而剑柄在贴图中心下方
  ——中心贴手 = 剑柄悬在手下。修正：按每帧旋转角反推中心 `offsetX = 手X + G·sin(rot)`、
  `offsetY = 手Y − G·cos(rot)`，使剑柄落点=手。
  **G（柄质心距中心）实测**：锈剑 39.2 / 骑士 41.6 / EX 36.1 / 夜火 44.1 display px，
  取 **40**（旧值 55 偏大→握把落柄下端，实机"还有错位"；40 版视觉模型 8 帧判"更准"）。

### 经验教训（2026-08-03 一段攻击跟手三轮复盘，可迁移）
1. **手部只有离散帧时，武器 perFrame 必须"阶梯映射"，不能帧间平滑插值**：
   30 个武器点 ≠ 手部 8 帧姿势。插值会让握把在精灵帧没动时自己漂移
   （f3→f4 手位跨度 154px，cfg11 曾脱手 122px）。正确做法：按帧权重
   `f = p≥0.7 ? 7 : min(6, int(p*10))` 取当前精灵帧锚点，旋转照常插值。
2. **锚点是否"贴手"用贴图真值掩码验证，勿用场景截图暗像素**：
   将精灵帧 alpha 用 BILINEAR 缩放到显示尺寸（`frame.resize((w,h), BILINEAR)`，
   `alpha>100` 为角色像素），握把落点采 7×7 邻域贴附率，>20% 视为贴手。
   场景截图的暗像素会被背景阴影/杂物误报（曾把 12 帧悬空误判为全贴手）。
3. **GLM-4.6V 的边界**：读绝对坐标不可靠（全图/网格/裁剪多格式都会跑飞）；
   但"红点是否在手"的 ON/OFF 判断在 140px 握把特写（2 倍放大 + 红点标记）上稳定。
   定位用掩码，复核用 GLM，二者交叉。
4. **改 JSON 配置后必须刷新页面**：ESM 静态 import 缓存旧配置，游戏启动时读一次，
   不刷新页面则"改完没生效"（曾导致对着旧配置调参的误判）。
5. **冻结抓取管线（tools/cdp-sword-hold-frames.mjs）**：
   `play + anims.timeScale=0` 冻结精灵帧（满足 GameScene 卡死守卫的 isPlaying 条件），
   `_activeAttackTweens` 塞 60s 占位 tween 保 attacking 状态机，`_playerAttackDuration=40000`
   + 反推 `_playerAttackStartTime` 接管进度。坑：`weaponAnim.timer>5000` 卡死保护会重置状态，
   需每帧清零；`tweens.timeScale` 曾被探针改慢导致攻击 tween 3 秒后才 complete 干扰定格。
6. **手部分层（handLayer）同步只在"显示期"做帧跟随，且 setFrame 前必须校验目标帧存在**
   （2026-08-03 普通攻击/收势告警刷屏复盘）：`_syncPlayerHandLayer` 曾每帧
   `hand.setFrame(身体帧号)`——手层隐藏期（recover/attack/idle）纹理可能只含 `__BASE`
   （如 `player_idle`），或 WebGL context lost 后手层贴图帧被清空，导致 Phaser
   "Texture has no frame" 告警刷屏（GameScene.js:1060 / phaser.esm.js:229893）。
   修复：`if (!hand.visible) return;` + 帧名在 `tex.getFrameNames()` 内才 setFrame。
   教训：跨动画复用 sprite 做帧同步时，"帧存在性"和"显示期"两个前提必须显式守卫，
   否则任何纹理状态异常都会变成每帧告警。

### 方向性运动模糊（替换各向同性高斯，修"摊薄消失"）
- **根因**：刀身在贴图内沿纵向（逐行质心 x 恒定已验证），旧版 Blur 滤镜 x=y=1 各向同性，
  模糊沿刀身摊薄 → 3px 细剑峰值帧"近乎消失"（SKILL 旧记录因此一度改残影，残影又停用）。
- **升级**：`_applyWeaponBlur` 固定 `f.x=1, f.y=0.08`——只沿**垂直刀身（贴图横向）**拉丝，
  刀身保持清晰、拖影沿挥砍方向；强度仍由 max(blurX,blurY) 驱动（峰值帧最浓）。
  Phaser 4 `filters.internal.addBlur`，`strength = max×1.6`。
- **验证**：CDP 实机采样（`tools/cdp-sword-attack-check.mjs`）确认 blur 峰值帧
  x=1/y=0.08/strength≈14；视觉模型粗验收"剑贴手 + 横向拉丝 + 刀身不糊"。
- 残影（`_syncWeaponGhosts`）为死代码，勿再启用。

## 二段攻击（attack_sword_2）双手横挥优化（2026-08-03）

- **动画**：30 帧（50ms/帧），"单手切双手 → 向前横向挥砍"；命中帧 15（sector 扇形）。
- **代码**：`syncWeapon` 近战分支按 `player.n === 2` 读 `attack2` 轨迹块；
  **已移除旧 `weaponUnder` 逻辑**（原 18~24 帧把武器压到人物下方 depth -0.01——
  双手横挥时剑在身前却被身体遮挡 = "涂层遮盖"根因），武器恒在人物前方（+2）。
- **横向挥砍（透视）修正**：F14~F25 剑保持在**胸口高度**（Y ≈ -2~15）且**近水平**
  （rotation 95~120，不再 45~85 上劈姿态），避免剑身盖脸；握把（剑柄）绑定**前伸手**
  （近侧手 ~local (52,-6)，握把校正 G=40 同攻击一段）。F0~F13 蓄力、F26~F29 收势保留。
- **验证**：lint/build/npm test 全绿；预览 `attack2_FINAL.png`（绿圈=握把）。
- **二段收势 0.3s（2026-08-03 用户指定）**：恢复动画共用 `recover`（13 帧×25.4ms=330ms）；
  GameScene 恢复触发处按 `_meleeComboStage === 2` 传 `setPlayerAnimation('recover', 300)`，
  武器滑回 `recDur` 同步 300ms（一段保持自然 330ms）。实机 timeScale=1.1007 ✓。
- **二段末帧定格 0.2s（2026-08-03 用户指定）**：`weapon-anim.js` 定格/连段窗口按段区分——
  二段 `_attackHoldUntil = 攻击结束 + 200ms`（连段回一段的窗口同步 200ms），一段保持 500ms。
  实机采样：一段 holdMs=500、二段 holdMs=200 ✓。

## 冲刺攻击（dash_attack）跟手优化（2026-08-03）

- **动画**：dash_attack 17 帧（24fps），"从后往前 180° 大回砍"；配置 sword.dash 30 点。
- **2026-08-03 修正：握把校正已回退**——dash 原始 30 点位置（用户实机验证"大体正确"）保持不变；
  全量握把校正（G=40）会把剑从正确位置移开（实机"贴图与手错位"），dash 不再套用。
  冲刺攻击触发：`dashSystem.trigger`（奔跑 333ms 后），武器/位移由 `_syncSpecialWeaponAnim` dash 分支驱动。
- **高斯模糊**：冲刺分支复用 `_applyWeaponBlur` 方向性模糊（x=1/y=0.08，刀身不摊薄）；
  实机峰值 strength≈18.5。此改进保留（代码级，与位置无关）。

## 武器动画调试基准（2026-07-26 定稿）

**两大基准武器**：手枪类 = **沙漠之鹰（deagle）**、双手枪械类 = **AKM**。所有贴图位置/动画调整先以这两把为基底标准，验证后同步到同类武器：
- **手枪类（单手持枪）**：pistol（G18）、deagle（沙鹰）、p4040——贴图位置/旋转/缩放/grip/muzzle/bobWeaponScale/dualOffsetX 以沙鹰实测值为模板同步。
- **双手枪械类（步枪/机枪）**：akm、pkm、qbz191、qjb201、shotgun、energy_lmg——以 AKM 实测值为模板同步。
- **贴图尺寸布局基准（2026-07-26 定稿）**：新武器贴图入库一律按类归一——步枪类：内容宽 0.915 / 中心 (0.500, 0.543) / 画布 2048²（AKM 布局）；手枪类：内容宽 0.862 / 中心 (0.487, 0.524) / 画布 2048²（沙鹰布局）。归一后必须重测 muzzle 分数坐标写入配置。
- 调参入口：`public/data/weapon-anim-config.json`（仅此单份）；开发面板调试→💾→助手合并的流程不变。
- **基准统一（2026-08-02 修复，防再犯）**：
  - **武器尺寸基准 = `WEAPON_ANIM.size`（126）**，禁止硬编码 105（2026-07-28 105→126 后 dev-tool 曾残留 7 处 105，导致面板预览小 30.6%、反复保存把 idleScale 越缩越小）。dev-tool 一律引用 `WEAPON_ANIM.size`。
  - **面板武器键 ≠ 配置键**：dev-tool `WEAPON_MAP` 的键只是选择器（super90/saiga12k 都映射 `configKey: 'shotgun'`；staff→sword；其余同名），传给 `WeaponTransform` / 读 `WeaponAnimConfig` 必须走 `_configKeyOf(type)`（游戏侧 `wt = animConfigKey || weaponType`）。**漏映射 = 回退到 sword 配置，散弹枪等面板调整全部无效**。
  - **面板姿态键 ≠ 游戏读取键**：持枪待机（gun_idle/gun_idle_pistol/gun_idle_dual）与施法（cast/staff_cast）在游戏里武器按 `animState='idle'` 读取（`cfg.idle` 子块优先），面板预览/保存必须走 `_stateKeyOf(anim)` 映射到 idle，否则保存写顶层而游戏读 idle 子块 → 不生效。
- **保存落盘**：Electron 走 `saveWeaponConfig` IPC；纯浏览器 dev 走 vite `/__save-weapon-config` 中间件（`_persistWeaponConfig` fetch 回退，防"只复制剪贴板刷新丢失"）。

## 行走逐帧武器轨迹（walkFrames，2026-08-02）

让剑类武器握把在 walking 时跟随右手摆动：`WeaponAnimConfig[wt].walkFrames`（`type:'perFrame'`，帧数与 walk 动画帧区间一一对应，如 sword 21 帧）。
- **生成**：`tools/` 像素分析脚本从 `assets/character/walk.png` 提取每帧右手（列直方图定位右侧手部凸起 → 质心），按显示缩放（长边 144/516）换算 local offset；以现有 walk holdOffset 实际位置为基准对齐（平均手位 + 恒定 shift 保持原位附近）；`rotation` = 最终旋转角（baseRotation + idleRotation，sword=90°+20°=110°），`scale` = walk idleScale。
- **游戏侧**：`GameScene.syncWeapon` walk 状态读 `walkFrames`，按 `playerSprite.anims.getProgress()` 插值；朝向同攻击分支（位置镜像 + 旋转取反 + flipX）。
- **面板**：`_perFrameCfgKey('walk')`→`walkFrames`，存在配置时 walk 页即逐帧编辑；保存白名单含 walkFrames。
- 新近战武器要加：复制 sword.walkFrames 结构，用同款脚本重测该武器贴图的手位/握把偏移。

## 手部分层（handLayer，2026-08-02）

让 walk 等循环姿态的手部贴图叠在武器之上（视觉"手握剑"）：
- `player-anim-config.json` 姿态条目加 `handLayer: { body, hand }`（两张同网格 sheet：身体层挖手 / 手层只留手）；合成严格无损（逐像素 alpha+颜色等于原图）。
- BootScene 自动加载 body/hand 贴图并注册 `player_<key>_body` 动画；GameScene 创建 `playerHandSprite` 每帧跟随身体（位置/flipX/帧号），深度 = 身体 + 3（武器 +2），攻击/施法等一次性动作自动隐藏手层。
- dev-tool 面板 walk 预览同分层（身体 → 武器 → 手）。
- **生成方法（2026-08-02 实测定稿，踩过坑）**：
  1. **先确认哪只手**：角色侧视朝右时，画面右侧 = 近镜头手（持剑手通常在这侧），画面左侧 = 另一只手。**先用 ASCII 渲染完整帧确认角色朝向和手在画面的左右侧，再定检测方向**——本作最终需求是"另一只手"（画面左侧 x≈175~259），不要默认截"最右凸起"。
  2. **检测带必须收紧为手臂/手高度带 y∈[180,280]**：不要用 y∈[160,330]——帧 4~9 手收进身体后"最右凸起"会退化到大腿，质心抓到腿、矩形把腿部像素切进 hand 层（实机表现"截到腿"）。
  3. **拳头矩形半宽 34/半高 38，y 上限硬性 clamp ≤300**（大腿从 y≈300 开始）；腿区（y>300）逐帧断言必须全 0。
  4. **合成无损验证**：逐像素 body+hand 的 alpha/颜色 = 原图（0 不匹配），每帧 bbox 必须在目标手区域。
  5. **恢复方法**：删掉 `handLayer` 配置即回退原贴图（代码已判空兼容），无需改代码。
- **坑：改播放键会断武器轨迹**——walk 播 body 动画后，`syncWeapon` walkFrames 分支判断 `curAnim.key === playerTextureKey('walk')` 匹配不上（实际 key 是 `player_walk_body`），walkProgress 恒 0 → 武器卡第一帧。凡按动画 key 做分支判断处都要兼容 `player_<key>_body`。
- 新姿态要加手层：复制 walk 的脚本流程（确认左右手 → 收紧检测带 → 拳头矩形 clamp → 合成验证），配置加 handLayer 即可。

### 法杖施法手层（staff_cast，2026-08-03 落地）

施法动画（staff_cast 9 帧）同机制：手层独立 → 法杖握把绑定手部 → 共同运动。
- **素材**：`assets/player/staff_cast_body.png`（挖手身体层）+ `staff_cast_hand.png`（只手层），生成脚本
  `tools/prep-staff-cast-hand.py`（逐帧拳头窗口 + 无损合成验证）。
- **配置**：`player-anim-config.json`（双份）staff_cast 条目加 `handLayer { body, hand }`；
  `weapon-anim-config.json` sword 块 `staffCastFrames`。
- **代码**：`startPlayerCast` / `setPlayerAnimation` 一次性动作分支支持 handLayer——播
  `player_<key>_body` 动画 + 显示手 sprite（帧/位置/翻转由 `_syncPlayerHandLayer` 每帧跟随）；
  `_updatePlayerAnimation` 施法守卫兼容 body key（`cur !== player_<key>_body` 才算施法中断）。
- **实机验证**：CDP 工具 `tools/cdp-staff-cast-verify.mjs` / `cdp-staff-walk-check.mjs`
  （装备学徒长杖→采样 idle/施法逐帧武器/手 sprite + 截图）；lint/build/npm test 全绿。

### 法杖施法最终方案（2026-08-03 用户验收通过）

**idle 绑左手（参考行走位置）+ 施法 f0→f8 设计插值轨迹（全程不换手、无跳变）：**
- `staffIdle`：左手拳位置——holdOffsetX **−84.7** → local (−11.4, 0.6)，与行走同侧（行走 X −12~−34）。
  **⚠ 反推公式**：`getWeaponLocalOffset` 的 afterX = `WEAPON_ANIM.size(126)×0.75×0.85 = 80.325`
  （不是 66.94）——按 66.94 反推 holdOffsetX 会整体偏右 ~13px（本次踩坑）。
- `staffCastFrames`：**设计插值**，不逐帧抠手：
  - f0 = idle (−11.4, 0.6, rotation **105**) —— idle↔f0 零跳变；
  - f8 = 前伸手举杖 (45.6, −43.9, rotation **20**，用户拍板)；
  - f1~f7 逐帧线性插值位置与角度（105°→20°）——法杖从左手腰侧平滑扫到右手举杖位。
- **为什么握把终点是「前伸手」**：施法手势是双手抬起后右手前推发力（f5~f8 右手从腰侧 x325
  前伸到 x418、上抬到 y100）；杆身 rotation 110°→20°（竖举指向右上，横杖不像举杖）。
  竖杖跟前伸手全帧 0 盖脸；跟远侧手（贴下巴的手）时 f3~f8 杆身直穿头部（盖脸 500px+），不可用。
- **坑（本次沉淀）**：
  1. 拳头中心用**手层内容质心**（像素级可复现），不用左边缘+半宽估算（会偏到手臂）。
  2. 抬举帧拳头比腰侧帧大得多（x≈231~300, y94~112），窗口右缘止于近侧手 x300 前，避免裁进另一只手。
  3. **GLM-4.6V（deepseek-vision-skill）定位手不可靠**：坐标误差 50~150px、同图两次回答矛盾，
     只配做粗验收（"法杖是否握在手里"），像素级修正一律用像素分析。
- **GLM-4.6V（deepseek-vision-skill）定位手不可靠**（2026-08-03 实测）：对 1024² 图坐标误差
  50~150px，同图两次回答互相矛盾，不能用于像素级修正；只适合粗粒度验收（"法杖是否握在手里"，
  实机截图判定通过）。精确定位仍用手层内容质心（像素级，可复现）。

## 复用武器动画独立调参（staff 法杖，2026-08-02 实测定稿）

新武器复用剑配置（`animConfigKey: 'sword'`）时，游戏侧 `wt='sword'` 全走剑数据——要独立握持/轨迹必须**在 sword 块下加独立子块 + 按武器类型分支**，不能直接改 `sword.idle/walk`（会连带影响剑）：
- **walk 逐帧**：`sword.staffWalkFrames`（`type:'perFrame'`，21 帧与 walk 动画对应）；`GameScene.syncWeapon` 按 `currentItem.weaponType === 'staff'` 读 `staffWalkFrames`，dev-tool 面板 `_perFrameCfgKey('walk')` 对 staff 返回 `staffWalkFrames`。
- **idle/walk/running 静态**：`sword.staffIdle { holdOffsetX/Y, idleRotation, idleScale }`；`syncWeapon` 对 staff 传 overrides 覆盖，面板 `_staffStateOverrides()` 三处调用点统一。
- **中段握持 = 贴图中心直接对准手**：法杖中段≈贴图中心，walkFrames/heldOffset 的 local 位置应**直接用手部轨迹**（`(手像素−贴图中心)×显示缩放`），不要从剑轨迹平移（剑柄在贴图中心下方 55px，平移法杖会整体错位）。
- **换手正确姿势：镜像已验证贴手的手轨迹，不要重新检测另一只手**：
  - 直接检测"另一只手"会因检测带/部位不同抓到手臂-胳膊不同段（实机表现"从手-手臂-胳膊垂直移动"，完全违和）；
  - 正确做法：把已贴手的轨迹**水平镜像**（`offsetX` 取反、`offsetY` 保持稳定 2~3.8）——保持"Y 稳定、X 水平摆动"的贴手特性，只是换到另一侧。
- **手位检测必须定位拳头（手臂末端），不是整条手臂质心**：idle 用整臂质心会偏上（法杖浮在手上面）；拳头 = 手臂最下端加宽块（如 idle y≈265~295 区域），idle 拳头 local=(-11.4,5.2) 与 walk 左侧手轨迹一致。
- **枪口点自动烘焙（2026-07-26 定稿，优先于手工配置）**：BootScene 对每把武器贴图扫描"最大连通体（8 邻域、4x 降采样）最右端内容点"（含 1px 细枪管尖）写入 `window.__weaponMuzzlePoints`；`_getMuzzleWorldPosition` 优先级 `muzzle.manual` > 自动烘焙 > 配置 muzzle > 右缘中心。子弹/枪口火焰统一从贴图最前端出生。**教训：别拿"右缘估计"当枪口——Super90 手工估点 (0.96,0.35) 把 1px 发丝杂线当枪管，自动烘焙的 (0.908,0.526) 才是真管口（放大裁切证实）。**
- 玩家碰撞基准（2026-07-26）：`PLAYER_DEFAULTS.physics`——受击矩形 40×60 + colliderOffset (-5,-5)（左拉 10、上移 5）；胶囊体随 collider 偏移。

---

## 武器添加标准工作流（2026-07-28 定稿，新武器一律按此开展）

与怪物/地牢/墙体工作流同规格。核心：**EquipDataManager 是唯一全量数据源，其余各点按需登记，验证四件套收尾**。

### 1. 素材管线（贴图/音效进项目前必过）
- **贴图归一**：新武器贴图一律按类归一（SKILL.md「武器动画调试基准」）——步枪类：内容宽 0.915 / 中心 (0.500, 0.543) / 画布 2048²（AKM 布局）；手枪类：内容宽 0.862 / 中心 (0.487, 0.524) / 画布 2048²（沙鹰布局）。归一后**枪口点无需手配**（BootScene 自动烘焙，见第 4 节）。
- **音效**：入 `assets/sounds/weapons/` 子目录（目录规范），路径写进配置，不在代码写死。

### 2. 纹理注册（src/config/weapon-texture-map.js）
- `getWeaponTextureLoadList()` 加 `{ key: 'weapon_<weaponType>', path }`（BootScene 自动加载）。
- 仅当纹理键不能由 `weapon_<weaponType>` 推导时（如按 weaponId 特供贴图），在 `getWeaponTextureKey` 的 `specialMap` 加 weaponId → 键映射。
- **WEAPON_MAP 与加载列表同源**；开发面板的姿态预览自动生效。

### 3. 数据配置（EquipDataManager 唯一全量数据源 + equipment.json 模板）
- `src/ui/equip-data-manager.js` 加武器条目（参考 G18_PISTOL_ITEM / AKM_ITEM 同族复制）：
  - 标识：`weaponId`（weaponN 顺延）、`weaponType`（同族复用，新族=新键）、`animConfigKey`/`attackKey`/`offhandAttackKey`（可双持手枪）、`canvasImageProp`（**每把枪独立**，复用别人的会双持互盖——P4040 教训）。
  - 战斗：`attack { range, knockback, attackInterval, projectileSpeed, damageType }`、`fireMode`（semiAuto/fullAuto）、`ammoConfig { max, reloadTime }`、`spreadParams`/过热（heatParams）按族。
  - 公式：`attackFormula { base, enhanceFlat, attrs: [{ key, base, perEnhance }] }`——**唯一实战公式源**（computeWeaponAttack 全链路自动生效，图鉴/强化/tooltip 委托展示）；enhanceFlat=0 合法（沙鹰/能量LMG）。
  - 贴图字段：`iconImage/dropImage/equipImage/slotImage`、`weaponAsset.image`。
- `data/equipment.json`（**双份同步 public/**）加商店/掉落模板条目——字段从 EDM 条目复制（main.js 启动合并 + `completeWeaponFields` 消费端回退会补全实例缺字段，但**模板里写错的值不会被纠正**，只补 undefined）。
- 稀有度/定价/掉落池按既有档位（参考同级武器）。

### 4. 弹药与攻击对象（双写点）
- `src/config/gun-ammo.js` `GUN_AMMO_CAP` 加 `weaponN: { max, reloadTime }`——**与 EDM ammoConfig 双写**（消费端 `getAmmoConfig` 三级回退兜底；`max: Infinity` 合法，JSON 克隆变 null 时有回退）。
- `attackKey` 取 `WEAPON_ATTACK_CONFIG`（src/config/weapon-attack-config.js）已有键；新射击手感（冷却/弹速/弹体）= 该文件加条目，`attacks[attackKey]` 自动创建（player/index.js 遍历注册，无需改玩家代码）。
- **枪口点**：BootScene 自动烘焙贴图最右端内容点，无需手配；个别烘焙偏差用 `muzzle.manual` 覆盖（Super90 教训：别拿右缘估计当枪口）。

### 5. 动画与贴合调参（左下开发面板）
- `public/data/weapon-anim-config.json`（仅此单份）：以同族基准武器（手枪=沙鹰 / 双手枪=AKM）为模板加 `weaponType` 条目（top/idle/walk 状态块 holdOffset、grip、idleScale/idleRotation）。
- 面板拖武器贴合手部 → 💾保存（直写 public/data + 备份）；静态姿态=每状态 holdOffset，攻击=perFrame 逐帧（新近战动作走玩家动画工作流）。
- 双手枪械注意冲刺开火=强制 walking（内置）；`isTwoHanded: true` 别漏。

### 6. 改造/附魔/图鉴/验证
- **改造**：`data/craft-config.json` 加 `weaponN` 槽位条目（配件槽 x/y/lineTarget，参考沙鹰）；`ItemDatabase.getByWeaponId` 懒索引反查，**新武器免登记**。不配 craft 条目 = 该武器不可改造（UI 明示，合法设计）。
- **改造新效果键要过三处**（2026-07-30 Beretta 93R 落地）：①`craft-effect-registry.js` 注册（test-craft-sync 三角校验会拦未注册键）；②消费端代码（散布在 update.js 主副手+tooltip、fireMode 在 update.js 触发器+gun-ammo getFireMode）；③craft-config 写 effects。已有键覆盖绝大多数需求（shotSpreadDelta/recoilRecoveryDelta/rangeDelta/knockbackDelta/magazineDelta/reloadTimeDelta/moveSpeedPercent/damagePercent/piercingBonus/attackIntervalDelta/spreadStartDelta/redDotScope）；**模式切换类新键**：`burstMode`（N 连发，60ms 间隔排队，末发恢复标准冷却，**主副手各自独立队列**）、`fireModeOverride`（覆盖射击模式，全自动板机）、`spreadParamsOverride`（散布模板整体覆盖）。
- **附魔/强化**：通用链路，零登记（强化只影响攻击公式派生与盾防）。
- **图鉴**：ItemDatabase 自动收录，公式展示委托 buildFormulaDisplay，无需改代码。
- **验证**：JSON 双份一致（`npm test` 的 test-regressions 双份一致性+音效路径存在性检查会拦）；`npm run lint`、`npx vite build`、`node scripts/test-collider.mjs`、`node scripts/test-craft-sync.mjs`（动了 craft 配置时）；实机清单：装备/开火/换弹/双持（手枪族）/瞄准姿态/强化+1 攻击变化/图鉴公式展示。

---

## 常见陷阱：功能失效优先查数据/配置完整性（弹药初始化同款两连）

### 模式
"系统逻辑完好的功能失效"——控制台诊断先沿数据链查状态，别先改逻辑：
- v2.7 弹反失效：装备条目缺 `weaponType: 'shield'` + `defense` 块，`checkEquipped()` 恒 false。
- 2026-07-26 AKM 无法开枪：实例缺 `ammoConfig`（equipment.json 该条目本就无此键，靠 main.js 启动合并补齐，但该实例走了未合并的获取旁路），`_initAmmoForSlot` 无回退 → `_hasAmmo` 恒 false。

### 修复原则
启动时合并（main.js → ItemDatabase）只覆盖一条获取路径；**消费端回退才是全路径兜底**——`_initAmmoForSlot` 已改用 `getAmmoConfig(item)`（`item.ammoConfig || GUN_AMMO_CAP[weaponId]`，与 combatant/图鉴/tooltip 同口径）。新枪械：EquipDataManager 配 `ammoConfig` + `GUN_AMMO_CAP` 加 weaponId 条目，双写。

---

## 枪械无法开火排查手册（开枪链路全断点地图，2026-07-26 定稿）

开不了火的原因太多太散，一律按本手册走：**先跑诊断脚本定位断点段，再按段查已知案例**，不要凭直觉改代码。

### 一、开火链路四段（断点必在其中一段）

```
① 输入闸门（player/update.js 各武器分支）
   hasAmmo && !isReloading && weaponSwitchCooldown<=0 && fireTrigger
   && attacks[attackKey].canUse() && stamina>=COST
   → 设置 rangedFireData + triggerWeaponAnim()
② 状态机（weapon-anim.js updateWeaponAnim）
   triggerWeaponAnim → state='swing' → swing 分支调 _fireRanged('main')
   （卡死保护：非 idle 超 5s 强制回 idle）
③ 发射（subsystems.js _fireRanged）
   消耗弹药 → 枪口坐标 → ProjectileFactory.create + 枪口火光 + 弹壳 + 音效
④ 枪口定位（_getMuzzleWorldPosition）
   读 scene.weaponSprite 的 x/y/rotation/displayWidth，
   sprite 不可见则回退脚底相对算法（子弹从脚射出的根因区）
```

### 二、断点案例索引（历史上全部"无法开火"根因）

| 断点段 | 案例 | 根因 | 修复 |
|---|---|---|---|
| ② | v1.9 远程无法开枪 | `triggerAttackAnimation` 未调 `_fireRanged` | 补调用 |
| ① | v1.11 全枪械无法开火 | equipment.json 缺 `ammoConfig/fireMode/attackFormula/attackKey` | main.js 启动合并 EquipDataManager 字段 |
| ④ | v2.8 地牢子弹从脚射出 | 地图模式 `weaponSprite.setActive(false)` 后未恢复，枪口回退脚底算法 | 非地图模式统一 `setActive(true)`（共享链路） |
| ① | 2026-07-26 AKM 无法开枪 | 实例经未合并旁路获得、缺 `ammoConfig`，`_initAmmoForSlot` 无回退 → 弹药状态 null | 改用 `getAmmoConfig(item)` 按 weaponId 回退 |
| ④ | v2.7 遗留：复活后子弹不从枪口射出 | 未复现，待场景线索 | — |

### 三、①号段六闸门逐项排查（最常见断点区）

- `_hasAmmo(slot)` false：弹药状态 null（缺 ammoConfig，见上表）或打空中（`current<=0`）。
- `_isReloading(slot)` 卡 true：换弹计时器卡死会精确导致"无法开枪"，第二嫌疑位。
- `weaponSwitchCooldown > 0`：切枪冷却未走完。
- `fireTrigger`：半自动读 `leftPressed`、全自动读 `leftDown`，别混。
- `attacks[attackKey].canUse()` false：冷却卡住；`attackKey` 缺字段时有 `|| 'pistol'` 兜底。
- `stamina < CONFIG.STAMINA_RANGED_COST`：体力不足静默拦截。
- 近战专属输入锁：`weaponAnim.state === 'attacking'` 时忽略左键（只影响近战，不误伤枪）。

### 四、即用诊断脚本（控制台两段式）

**第 1 段·状态快照**（哪个 null/false 哪个就是断点）：
```js
(() => {
  const p = Game.player, slot = p.weaponMode, item = p.equipments[slot];
  console.log('①武器:', item?.name, '| type:', item?.weaponType, '| attackKey:', item?.attackKey, '| fireMode:', item?.fireMode);
  console.log('②弹药:', JSON.stringify(p._getAmmoState?.(slot)), '| 换弹中:', p._isReloading?.(slot));
  console.log('③状态机:', JSON.stringify(p.weaponAnim), '| rangedFired:', p.rangedFired);
  console.log('④切换CD:', p.weaponSwitchCooldown, '| 体力:', p.data?.stamina);
  const k = item?.attackKey || 'pistol';
  console.log('⑤攻击对象:', k, !!p.attacks[k], '| canUse:', p.attacks[k]?.canUse?.());
})();
```

**第 2 段·强制触发**（绕过①直接打②③，区分"输入条件拦截"还是"链路断"）：
```js
const p = Game.player;
p.rangedFireData = { targetX: p.x + 300, targetY: p.y, entities: [...Game.entities.values()], mainSlot: p.weaponMode, fireMainHand: true };
p.triggerWeaponAnim();
setTimeout(() => console.log('触发后:', JSON.stringify(p.weaponAnim), '| rangedFired:', p.rangedFired), 600);
```
判读：`rangedFired: true` = 链路完好、断点在①六闸门；`false` 或报错 = 断点在②③，看控制台红错。

### 五、修复原则
- 断点修在**共享链路**上（原则10），主神空间/地牢全场景生效，禁止单场景补丁。
- 数据缺失用**消费端回退**兜底（见上节），不依赖启动合并单点。
- ④枪口问题先查 `weaponSprite.visible/texture` 与地图模式 active 恢复。

---

## 常见陷阱：anim.timer === 0（死代码）

### 问题
`enemy.js` 和 `combat-system.js` 的 swing 阶段都有：
```javascript
if (anim.timer === 0 && this._pendingThrust) this._pendingThrust.active = true;
```

这条代码**永远不会触发**：`anim.timer += dt` 后 `dt > 0`，`anim.timer` 不可能为 0。

### 正确做法
`ThrustAttack.execute()` 在创建 `_pendingThrust` 时已经设置 `active = true`：`triggerWeaponAnim()` 没有覆盖 `_pendingThrust`，所以 `active` 始终保持 `true`，无需重新设置。

直接删除这条死代码即可。

---

## 常见陷阱：const 重复声明

### 问题
`shield-system.js` 的 `onDamageTaken` 方法中：
```javascript
const defense = shieldData.defense;  // 行53
// ... 弹反逻辑 ...
const defense = shieldData.defense;  // 行81 ← 重复声明！
```

在块级作用域中（`if` 块内部是 `const` 的作用域），同一个函数中两次 `const defense` 会导致语法错误。

### 解决
弹反逻辑中直接使用行53声明的 `defense` 变量，不再重复声明。或者在弹反块内部改声明为 `const defense = shieldData?.defense || {}`（如果外层 `defense` 不在作用域内）。

---

## 智能寻路系统（参考《环世界》PathManager）

### 设计目标
- **主动预规划**：看到目标时立即计算路径，而不是等卡住才反应
- **定期路径检查**：每 1.5-2.5 秒扫描路径节点，检测新障碍物
- **局部修复**：路径被阻挡时，在障碍物附近搜索替代路线，不重新计算整条路径
- **地形权重**：树木附近增加移动成本，让单位自然绕行

### 架构

```
Enemy
  └── _pathManager: PathManager 实例
        ├── path: {x,y}[]          // 当前路径
        ├── pathIdx: number        // 当前索引
        ├── checkInterval: 1500-2500ms  // 检查间隔（随机，避免同时检查）
        ├── checkTimer: number     // 计时器
        └── isValid: boolean       // 路径是否有效

PathManager
  ├── setPath(path)              // 设置新路径
  ├── update(dt, pathPlanner)   // 每帧：检查有效性
  ├── _checkValidity()         // 扫描路径节点，检测障碍物
  ├── _repairPath(blockedIdx)  // 局部修复（核心）
  ├── getCurrentWaypoint()     // 获取当前目标路径点
  ├── advanceWaypoint()        // 前进到下一个路径点
  └── forceRecalc()            // 强制重算路径

PathPlanner（增强的 PathFinder）
  ├── _getMoveCost(x, y, radius)   // 地形权重计算
  ├── isReachable()               // 区域连通性检查（Flood Fill）
  ├── _pathCache: Map             // 全局路径缓存（3秒有效期）
  └── findPath()                  // A* + 权重 + 缓存
```

### 局部修复算法（核心）

当 PathManager 检测到路径上的节点 `i` 被阻挡时：

1. **策略1：小范围局部搜索**
   - 取 `path[i-2]` 作为修复起点，`path[i+2]` 作为修复终点
   - 在起点和终点之间用 `findPath` 搜索替代路径（搜索范围自然受限）
   - 如果找到：拼接路径 = 前半段 + 替代段 + 后半段
   - 调整 `pathIdx`：如果当前索引在修复范围内，回退到修复起点

2. **策略2：从阻挡点到终点重新计算**
   - 如果策略1失败，从 `path[i-2]` 重新计算到终点的完整路径
   - 拼接：前半段 + 新路径（去掉起点）

3. **策略3：完全失败**
   - 连续 3 次修复失败，清除路径，让 MovementSystem 触发随机逃逸

### 地形权重

在 `PathFinder._buildGrid` 中，每个格子计算 `moveCost`：
- 普通地面：`1.0`
- 树木附近（碰撞半径 × 1.5 范围内）：`+0.5`（总计 1.5）
- 其他单位附近（碰撞半径 × 2.5 范围内）：`+0.3`（总计 1.3）

A* 中移动成本 = `baseMoveCost * terrainCost * gridSize`
- 直线：`1.0 * terrainCost * 40`
- 对角线：`1.414 * terrainCost * 40`

### 区域连通性检查

在 `findPath` 之前，先用 `isReachable` 做 Flood Fill：
- 从起点向 8 方向扩展，检查是否可达目标附近
- 如果不可达，直接返回 `null`，避免昂贵的 A* 计算
- 限制最大步数，防止 Flood Fill 无限扩散

### 路径缓存

- 全局缓存：`Map<key, {path, timestamp}>`
- 缓存 key：`量化起点 + 量化终点 + 碰撞半径`
- 量化：坐标取 `floor(x / gridSize) * gridSize`
- 有效期：3 秒
- 最大容量：50 条路径
- 墙壁变化时调用 `invalidateCache()` 清空缓存

### 使用方式

```javascript
// 1. 在 MovementSystem.update 中主动预规划
if (enemy._pathManager && dist > attackRange * 1.5) {
    if (!enemy._pathManager.hasValidPath()) {
        enemy._pathManager.forceRecalc(pathFinder, targetX, targetY);
    }
}

// 2. 每帧更新 PathManager（检查有效性 + 局部修复）
if (enemy._pathManager) {
    enemy._pathManager.update(dt, pathFinder);
}

// 3. 沿路径移动
if (enemy._pathManager.hasValidPath()) {
    const wp = enemy._pathManager.getCurrentWaypoint();
    // ... 向 wp 移动 ...
    if (距离 < 5) enemy._pathManager.advanceWaypoint();
}

// 4. 卡住时 fallback
if (enemy._pathManager) {
    enemy._pathManager.forceRecalc(pathFinder, targetX, targetY);
}
```

### 与旧系统的兼容性

- `enemy._path` 和 `enemy._pathIdx` 仍然保留，作为 fallback
- MovementSystem 优先使用 `enemy._pathManager`，没有 PathManager 时使用旧路径
- Enemy 的 `_updateMovement`（fallback 模式）也兼容 PathManager

### 为什么之前被动寻路不好？

旧系统只在卡住（500ms 移动 < 3px）时才触发寻路：
- 单位先撞墙 → 被卡住 → 检测卡住 → 计算路径 → 开始移动
- 这导致单位在撞墙后有明显的"停顿"感

新系统：
- 单位看到目标 → 立即计算路径 → 沿路径移动 → 遇到障碍物时 PathManager 自动修复
- 单位更流畅，不会明显撞墙

---

## 寻路性能优化（2026-08-03 落地，改寻路代码前必读）

2026-07-13 全量审计实测：冷路径 findPath ≈ 10ms（`_buildGrid` 占 92%），
刷怪瞬间 15 只怪同帧冷寻路可达 50~115ms 主线程卡顿。以下机制已内嵌，**改动时必须保持**：

1. **静态格子记忆化（`_getCellData`）**：blocked 与 moveCost 合并为单趟空间哈希查询，
   结果按 `(格子坐标, 半径)` 缓存（**半径必须参与 key**：阻挡判定随半径线性膨胀，跨半径
   复用会读到错误结果；同型怪同半径天然共享）。`_buildGrid` 网格原点对齐到 gridSize 倍数
   （格子中心稳定为 k×40+20），使同一几何下同半径怪物共享同一份成本网格——15 怪同帧批量
   从 106ms → ~10ms。动态障碍成本（250ms 更新）不进 memo，每格实时叠加。
2. **每帧寻路预算**：`PathFinder.beginFrame()` 由 `MovementSystem.beginFrame()` 在
   game.js 主循环每帧调用一次；`frameBudgetMs` 耗尽后 `findPath`/`findPathToExit` 返回
   `PATH_DEFERRED` 哨兵，PathManager 保留旧路径、下帧重试。**禁止**把超预算当"不可达"处理。
3. **不可达负缓存**：A* 失败结果按 500ms 短 TTL 入 `_pathCache`，卡住重算循环不再每 500ms
   付一次冷 A*（20ms → 0.01ms）。`findPathToExit` 另有独立 500ms 出口缓存 + 预算门禁。
4. **首寻路错峰**：PathManager 创建后 `_firstRecalcAt = now + rand×250ms`，刷怪同帧错开。
5. **防御性拷贝**：`setPath` 在副本上对齐首点，不再原地改 `path[0]`——路径缓存数组为多怪
   共享对象，原地改写是别名 bug。
6. **缓存 LRU + 告警节流**：`_setCache` 满容量先清过期再淘汰最旧；A*/forceRecalc 失败告警
   1s 节流，避免卡住循环刷屏。

**2026-08-03 剩余清单已清（改代码前必读）**：
1. **冰墙不得调 `pathFinder.invalidateCache()`**：冰墙只往 `WallSystem.isoSegments` 推段，
   而 A* 网格只建模 walls/trees（isoSegments 有意排除）——清缓存是纯开销零收益，已删除
   （ice-wall-system 头部有注释）。几何类失效只发生在真正改 walls/trees 的地方
   （清房/场景切换/Boss 奖励恢复等）。
2. **WallSystem 碰撞空间网格**：walls/isoSegments/trees 经访问器暴露惰性代理，任何
   push/splice/下标赋值自动标脏；`canMoveTo/blocked/_nearestBlockingSeg/resolve` 走 128px
   网格近邻查询（谓词与线性版逐行一致，`_collisionAccel=false` 可回退线性）。
   实测 resolve 提速 ~11×。**禁止**直接用 `WallSystem.walls = [...]` 之外的原地下标改
   几何坐标（长度指纹只能兜底长度变化）；`scripts/test-collision-grid.mjs` 差分测试已入
   `npm test`，改这三处函数必须保持差分全绿。
3. **分离/侧翼近邻查询**：`MovementSystem._computeSeparation/_computeFlankOffset` 改用
   `SpatialPartitionSystem.queryRadius`（game.js 每帧重建），无分区时回退全量遍历。
4. `isReachableByRegion` 死代码已删除（BFS 预检 0.14ms 足够，勿重新引入）。

**回归防线**：`tools/pathfinding-bench.mjs`（寻路性能基准）+ `scripts/test-collision-grid.mjs`
（墙体网格差分）均已入 `npm test`。

---

## 常见陷阱：isReachable 步数限制导致路径计算失败

### 问题
`PathFinder.isReachable()` 使用 Flood Fill 检查区域连通性，但步数限制太死：

```javascript
// 错误：步数 = ceil(maxDist / step) + 5
// 目标距离 383px，gridSize=40，步数 = ceil(383/40)+5 = 15
// 15 步 BFS 根本到不了目标，直接返回 false，A* 根本没跑
const maxSteps = Math.ceil(maxDist / step) + 5;
```

这导致黑狼被卡在树木边缘（距离=53，总阻挡=53）时，路径计算完全失败，单位没有路径，只能直线移动 → 撞墙卡住。

### 修复
```javascript
// 正确：步数 = ceil(maxDist / step) * 3 + 20
// 383px 距离 → 49 步，BFS 能正常探索到目标
const maxSteps = Math.ceil(maxDist / step) * 3 + 20;

// 步数用完也不返回 false，让 A* 继续尝试（A* 有 maxIterations 超时保护）
return true;
```

### 诊断方法
```javascript
// 检查单位附近障碍物
WallSystem.trees.forEach(t => {
    const d = Math.hypot(t.x - wolf.x, t.y - wolf.y);
    const treeR = t.collisionRadius || t.radius * 0.6;
    const inTree = d < treeR + wolf.collisionRadius;
    console.log(`树: 距离=${d}, 在树内=${inTree}`);
});

// 检查四周可移动方向
const dirs = [{x:10,y:0}, {x:-10,y:0}, {x:0,y:10}, {x:0,y:-10}];
dirs.forEach((p, i) => {
    console.log(`方向${i}: 可移动=${WallSystem.canMoveTo(wolf.x+p.x, wolf.y+p.y, wolf.collisionRadius)}`);
});
```

---

## 常见陷阱：四方向 facing 但仅有两方向精灵图时的翻转逻辑

### 问题
怪物只有侧面精灵图（原始面向右），但 facing 逻辑按移动方向分 4 方向（right/left/up/down）。当目标在左上方或左下方时：
- `|vy| > |vx|`，`_facing` 被设为 `up` 或 `down`
- `flipX` 逻辑只处理 `left`/`right`，`up`/`down` 不翻转
- 结果：sprite 始终面向右，但单位实际在向左移动 → 视觉方向与运动方向相反

### 基础修复（v1.6）
`up`/`down` 时，根据 `vx` 符号判断水平运动方向来决定是否翻转：

```javascript
// _getPhaserOptions（Phaser 渲染）
if (this._facing === 'left') {
    flipX = true;
} else if (this._facing === 'right') {
    flipX = false;
} else {
    // up/down：没有上下精灵图，根据 vx 判断水平方向
    flipX = this.vx < 0;
}

// _drawBody（Canvas 渲染）
const shouldFlip = this._facing === 'left' ||
    ((this._facing === 'up' || this._facing === 'down') && this.vx < 0);
if (shouldFlip) ctx.scale(-1, 1);
```

### 优化修复（v1.7）
基础修复有两个问题：
1. **攻击期间**：`_facing` 锁定为 `_dashStartFacing`，但 `up`/`down` 时的 flip 仍依赖 `vx`（攻击前的速度），而非实际冲刺方向 `_dashAngle`
2. **纯垂直移动/idle**：`vx = 0` 时 `flipX = false`，狼永远朝右，无法保持之前的水平朝向

**优化方案**：
- 新增 `_lastHorizontalFacing` 属性，在每次 `_facing` 更新为 `left`/`right` 时保存
- `up`/`down` 时的 flip 优先级：攻击期间用 `_dashAngle` → 移动期间用 `vx` → 静止/纯垂直用 `_lastHorizontalFacing`

```javascript
// 构造函数初始化
this._lastHorizontalFacing = 'right';

// update() 中保存水平朝向
if (this._facing === 'left' || this._facing === 'right') {
    this._lastHorizontalFacing = this._facing;
}

// _getPhaserOptions / _drawBody 中的 flip 逻辑
if (this._facing === 'left') {
    flipX = true;
} else if (this._facing === 'right') {
    flipX = false;
} else {
    // up/down：没有上下精灵图
    if (this._attackTimer > 0 && this._dashAngle !== undefined) {
        // 攻击期间使用冲刺方向决定水平朝向
        flipX = Math.cos(this._dashAngle) < 0;
    } else if (Math.abs(this.vx) > 0.1) {
        flipX = this.vx < 0;
    } else {
        // 纯垂直移动/idle：保持上次水平朝向
        flipX = this._lastHorizontalFacing === 'left';
    }
}
```

---

## 交互式开发工具（DevTool）与攻击动画插帧系统

> 阅读 `src/ui/dev-tool.js`、`src/combat/weapon-transform.js`、`src/entities/player/weapon-anim.js`、`src/items/weapon-anim-config.js`、`src/phaser/scenes/GameScene.js` 后的结构梳理。
> **2026-07-26 简化定稿**：挂载点系统（handAnchors/gripOffset）与关键帧系统（keyframes）已删除——生产配置零使用，且单点锚无法帧间跟手（逐帧已全覆盖）。现只保留两条路径：攻击=逐帧 perFrame，静态姿态=每状态 holdOffset。

### 一、DevTool 整体结构

`src/ui/dev-tool.js` 是一个基于 Canvas 2D 的独立调试面板，与 Phaser 游戏循环解耦，用于武器/动画参数的可视化与持久化。

**核心状态：**
```js
state: { anim, weaponType, frameIndex, playProgress, isPlaying }
weaponParams: { offsetX, offsetY, rotation, scale }
```

**两大子系统：**
1. **武器定位面板**：调整 `offsetX/Y`、`rotation`、`scale`，实时预览武器相对角色的位置（传统 holdOffset 模式）。
2. **逐帧编辑（perFrame）**：`attack.type === 'perFrame'` 时 weaponParams 直接对应当前帧，滑块/播放逐帧调武器姿态。
3. **动画/贴图/AI 调试面板**：加载四方向精灵图、逐帧播放、调试敌人贴图与 AI。

**关键方法：**
- `_loadCharacterFrames()`：按 `data/player-anim-config.json`（PLAYER_ANIMS）加载角色精灵图，`PANEL_ANIM_TO_CONFIG` 映射面板键→配置键。
- `_getPerFrameTransform()`：按进度插值逐帧配置。
- `_buildPreviewOverrides()`：把面板中的调整打包成 `WeaponTransform` 可消费的参数。
- `_save()`：写回 `WeaponAnimConfig`，并通过 `window.electronAPI.saveWeaponConfig` 持久化到 `public/data/weapon-anim-config.json`。
- `_draw()`：用 `WeaponTransform` 在 Canvas 上绘制角色、武器与轨迹。
- 播放帧率：读配置 `frameRate`，面板 `#devToolFps` 输入框可手动覆盖（`_getPreviewFps`）。

### 二、攻击动画插帧（唯一路径：逐帧 perFrame）

- **配置位置**：`WeaponAnimConfig[weaponType].attack.frames`（`attack.type === 'perFrame'`）。
- **结构**：`{ offsetX, offsetY, rotation, scale }` 数组，每帧对应攻击动画的一帧。
- **插值**：按 `playProgress` 在相邻两帧之间做线性插值。
  - `weapon-transform.js`：`getInterpolatedPerFramePosition()` 用 `_lerpPerFrame1D/2D` 插值。
  - `weapon-anim.js`：检测到 perFrame 后，Tween 只驱动 progress；武器 Sprite 的位置/旋转/缩放由 `GameScene.syncWeapon()` 按当前动画帧同步，Tween 只负责命中判定窗口与状态重置。
- **无 perFrame 配置的近战武器**：走 `_playSwordAttackTween` 默认三段 Tween 链（windup 200ms / swing 300ms / recover 400ms）。
- **贴图同步**：`setPlayerAnimation('attack_sword', tweenDuration)` 用 `anims.timeScale` 把玩家攻击贴图对齐 Tween 总时长（2026-07-26 修复 900ms Tween vs 667ms 贴图各播各的问题）。

### 三、坐标变换链

```
dev-tool 调整参数
    ↓
保存为 WeaponAnimConfig[weapon].attack.frames（perFrame）/ [state].holdOffset（静态姿态）
    ↓
WeaponTransform.getInterpolatedPerFramePosition() / getWeaponLocalOffset()
    ↓
GameScene.syncWeapon() / weapon-anim.js Tween
    ↓
Phaser Sprite.x / y / rotation / scale
```

**镜像处理：**
- 玩家朝左时，`facingRight = false`。
- `WeaponTransform` 内部把本地 X 坐标取反，并把旋转角度处理为 `Math.PI - rotation`。
- **不**对武器 Sprite 直接使用 `setFlipX`，避免旋转中心错乱。

### 四、玩家攻击动画驱动流程

1. 输入触发：`triggerWeaponAnim('main')`。
2. 状态机进入 `swing`。
3. 剑类武器调用 `_playSwordAttackTween()`：
   - 若 `attack.type === 'perFrame'`：Tween 驱动 progress，`syncWeapon()` 逐帧同步。
   - 否则走默认 windup/swing/recover 路径。
4. `onStart` 激活 `_pendingThrust`，在攻击前 500ms 内做命中判定。
5. `onComplete` 结束攻击状态、给经验、武器回到 idle 位置。

### 五、与怪物攻击动画的对比

- **玩家**：由 `weapon-anim.js` Tween + `WeaponAnimConfig` 精确控制武器 Sprite 的位移/旋转/缩放。
- **怪物（如 ZombieDogEnemy）**：仅覆盖 `triggerWeaponAnim()` 设置 `_attackTimer`，用 `_animState = 'attack'` 驱动纹理/帧切换；攻击判定由 `ThrustAttack` 的矩形/动态距离判定处理，**没有**类似玩家的武器 Sprite 插帧系统。

### 六、后续扩展方向

如需为怪物引入攻击动画插帧（例如让 ZombieDog 的爪击也使用逐帧动画）：
1. 在 `enemy-config.json` / `enemy-types.js` 中为怪物增加攻击动画资源引用。
2. 在 `WeaponAnimConfig` 中新增怪物武器/爪击配置，或复用 `perFrame` 结构。
3. 在 `_syncEnemyAnimation()` 中根据 `_animState === 'attack'` 播放对应 spritesheet。
4. 让 `ZombieDogEnemy.triggerWeaponAnim()` 不只是一个 timer，而是真正驱动一帧一帧的动画 progress。

---

## 变更记录

- v1.16 (2026-08-03) — 生图改为智谱 API 优先
  - ⚠ 已被 2026-08-04 二轮推翻：双机 ComfyUI 优先（远程 5080 主力 + 本机 3080 Ti 兜底）、
    智谱 API 降级为第三兜底；以下条目保留作历史记录
  - 本地 AI 出图工作流新增「生图入口（优先：智谱 API）」：`tools/ai-gen/zhipu-gen.py`，
    默认模型 glm-image（1280×1280），不支持负面词参数（避项写进正向提示词），
    右下角固定"AI生成"水印（去水印需智谱后台签免责声明，抠图时水印在白边可随背景丢弃）
  - 障碍物统一提示词策略沉淀为 `tools/ai-gen/obstacle-prompt-strategy.md`；
    抠图管线 `tools/ai-gen/prep-obstacle.py`（GrabCut + 背景过滤 + 最大连通域 + 边缘去污染 + footprint 实测）
  - ComfyUI 降级为兜底（离线 / 免费额度耗尽时）

- v1.15 (2026-08-03) — 废案清理 + 工作流补规则
  - 删除暴风雪/冰锥迭代全部废案与未调用图片（blizzard-icons v1~v6、ice-icons-v1、snowball 变体、
    blizzard_snowball.png，共 79MB），只保留最终被引用资产（blizzard_icon.png、ice_spike_icon_01~04.png）
  - 技能添加标准工作流 + 本地出图工作流新增「入库后清理废案」强制规则（六步流程 + 贴图要点清单）

- v1.14 (2026-08-03) — 暴风雪技能全链路 + 本地 AI 出图工作流沉淀
  - 新技能「暴风雪」（高级冰魔法，需法杖）：地面区域 DoT（每 0.5 秒一跳，L20 持续 10s / 范围 360×224 / 冷却 35s），
    每跳叠 1 层寒冷（3.5%/层），冰墙+暴风雪组合叠 20 层触发冻结（冻结=定身+冰块视觉+物理伤害+50%）
  - 特效：乌云（柔边色块+粒子烟雾，随区域半径缩放、恒置顶）+ 雪球/冰锥从云中砸落（密度/速度/落点椭圆内随机/
    落地冰屑迸溅）+ 底部雪花/云雾/风线，全部配置化（skills.json 调范围/持续，构造 options 调观感）
  - 图标：本地 ComfyUI 生成（六边形徽章同系列，两段式 img2img+inpaint 定稿）+ GLM-4.6V 验收；
    冰锥投射物 4 张 AI 贴图随机抽取
  - 开发工具：技能页签「技能无CD无消耗」开关（含法杖门槛绕过）；详情面板魔法分类（冰/火/电/光）与
    等级（初/中/高）词条着色；暴风雪修炼方式（4 条经验途径）说明补全
  - 寒冷系统：冻结阈值参数化（默认 20 保留，冰墙/暴风雪组合触发）；寒冷反馈统一显示总层数（寒冷 xN）
  - 沉淀：本地 AI 出图工作流 + 技能贴图要点 + ComfyUI inpaint 遮罩坑（见文首）
  - **文件**：src/effects/blizzard-zone.js、src/entities/components/blizzard-system.js、src/config/dev-cheats.js、
    src/entities/damageable-entity.js、ice-wall-system.js、bolt/holy-light/lightning-strike-system.js、
    src/ui/skill-manager.js、quick-bar.js、panels/dev-tools.js、subsystems.js、player/index.js、
    BootScene.js、GameScene.js、magic-categories.js、data|public/data/skills.json、
    assets/skills/blizzard_icon.png、assets/skills/ice_spike_icon_01~04.png、tools/ai-gen/（出图管线脚本）

- v1.13 (2026-08-03) — 怪物寻路全面审计 + 性能优化落地（详见文首阶段总结）
  - 静态格子记忆化 / 每帧寻路预算（PATH_DEFERRED）/ 不可达负缓存 / 首寻路错峰
  - 墙体碰撞空间网格（resolve ×11）/ 分离侧翼空间分区 / 冰墙缓存失效删除
  - 回归防线：pathfinding-bench.mjs + test-collision-grid.mjs 入 npm test
  - **文件**：src/ai/pathfinder.js、src/ai/path-manager.js、src/systems/movement-system.js、
    src/world/wall-system.js、src/entities/components/ice-wall-system.js、src/game.js

- v1.9 (2026-07-07) — 攻击系统修复（Phaser 4 Tween API 兼容性）
  - 修复 `scene.tweens.createTimeline()` 在 Phaser 4 中不存在的问题，改用 `scene.tweens.chain()` 链式 Tween
  - 添加 `initWeaponAnim()` 调用初始化 `_activeAttackTweens` 数组，修复 `Cannot read properties of undefined (reading 'push')` 错误
  - 延长近战攻击判定时间从 200ms 到 500ms，覆盖 windup + swing 完整阶段
  - 修复 Tween 回调 `this` 绑定问题，使用 `self` 变量替代箭头函数中的 `this`
  - 远程武器在 `triggerAttackAnimation` 中调用 `_fireRanged()` 发射子弹，修复远程攻击无法开枪问题
  - 近战和远程攻击现在都能正常工作

- v1.12 (2026-07-11) — 地牢地图居中显示修复：
  - **问题**：`_centerRouteMap`、`_generateDefaultMap`、`_generateZombieMap` 使用硬编码 `TARGET_AREA = { left: 260, top: 94, width: 1425, height: 724 }`，导致地图位置固定，不随窗口大小变化
  - **修复**：改用 `window.innerWidth` 和 `window.innerHeight` 动态计算地图显示区域，水平垂直均居中显示，留出 `marginX=280`/`marginY=120` 边距给侧边栏
  - **注意**：`CONFIG.VIEW_WIDTH/HEIGHT` 保持固定 1920x1080（用户要求固定像素），但地图居中使用实际窗口尺寸
  - **文件**：`src/world/dungeon-map-system.js`

- v1.11 (2026-07-10) — 修复所有枪械无法开火的问题：
  - **根因**：`data/equipment.json` 中 PKM/AKM/QBZ191/QJB201/Super90/SAIGA-12K 等武器缺少 `ammoConfig`、`fireMode`、`attackFormula`、`attackKey` 等关键字段
  - **修复**：在 `main.js` 中添加 `EquipDataManager` 到 `ItemDatabase` 的字段合并逻辑，确保所有武器配置完整
  - **同步**：更新 `public/data/equipment.json` 到最新版本（Vite 开发服务器优先从 `public/` 提供静态文件）
  - **验证**：所有枪械（手枪、步枪、机枪、霰弹枪）均可正常开火，弹药系统工作正常

- v1.10 (2026-07-10) — 武器位置固定与镜像系统：
  - **需求**：近战武器（剑/弓）在 running 动画时固定位置，不随鼠标旋转；朝左时自动镜像
  - **实现**：
    - `WeaponTransform.getWeaponWorldPosition()`：running 的近战武器使用固定 rotation（0），其他情况使用 `player.rotation`
    - `WeaponTransform.localToWorld()`：running 的近战武器朝左时镜像位置（`x = player.x - (x - player.x)`）
    - `WeaponTransform.getWeaponRotation()`：running 的近战武器朝左时调转 idleRotation（`Math.PI - idleRot`），远程武器使用 `player.rotation`
  - **关键**：`setFlipX` 不适用于武器 Sprite，因为位置已经镜像，贴图翻转会导致双重翻转。改用旋转镜像（`Math.PI - idleRot`）来调转方向
  - **远程武器还原**：枪械类使用 `player.rotation` 计算旋转，保持跟随鼠标方向，不受镜像影响

- v1.8 (2026-07-06) — 红狼王变身机制：
  - **触发条件**：HP < 50%（配置 `transform.hpThreshold: 0.5`）
  - **变身动画**：`redwolfchange.png` 16帧（4×4），3秒内播放完毕（`transform.duration: 3000ms`）
  - **变身期间**：无法移动（`vx=vy=0`）、无法攻击（`triggerWeaponAnim` 直接返回）
  - **变身后效果**：HP 完全恢复（`transform.hpRecover: 1`），攻击力翻倍（`transform.damageMultiplier: 2`）
  - **变身后精灵图**：待机 `redwolfidle.png`（4帧）、奔跑 `2026-07-05-22_57_41.png`（16帧）
  - **实现位置**：`enemy-types.js` RedWolfKing 类新增 `_isTransforming`/`_isTransformed`/`_transformTriggered` 状态，`_getTextureKey`/`_drawBody`/`_getPhaserOptions` 支持变身状态，`_updateAIState` 变身期间不执行，`_executeAI` 变身期间不执行
  - **配置位置**：`enemy-config.json` `redWolfKing.transform` 对象
  - **资源加载**：`BootScene.js` 新增 `enemy_red_wolf_king_change`、`enemy_red_wolf_king_changed_run`、`enemy_red_wolf_king_changed_idle` 三个 spritesheet
  
- v1.7 (2026-07-06) — 优化精灵图朝向翻转：
  - 新增 `_lastHorizontalFacing` 保存机制，解决纯垂直移动/idle时狼永远朝右的问题
  - 攻击期间 `up`/`down` 状态的 flip 改用 `_dashAngle` 而非 `vx`，确保冲刺方向与视觉一致
  - 同步应用到 BlackWolf 和 RedWolfKing
  
- v1.6 (2026-07-06) — 修复黑狼 facing 翻转：四方向 facing 但仅有两方向精灵图时，`up`/`down` 状态下根据 `vx` 符号判断水平方向，确保 sprite 翻转与运动方向一致。修改 `enemy-types.js` 的 `_getPhaserOptions`（flipX）和 `_drawBody`（ctx.scale）

- v1.5 (2026-07-05) — 智能寻路系统（参考《环世界》）：预规划 + 定期路径检查 + 局部修复
  - 新建 `src/ai/path-manager.js`：路径缓存 + 每 1.5-2.5 秒有效性检查 + 局部修复（障碍物附近搜索替代路线）
  - 增强 `src/ai/pathfinder.js`：地形权重（树木 1.5x，拥挤 1.3x）、区域连通性检查（Flood Fill）、全局路径缓存
  - **修复**：`isReachable` Flood Fill 步数限制过死（`ceil(maxDist/step)+5` → `ceil(maxDist/step)*3+20`），导致路径计算完全失败，单位卡在树木边缘无法移动
  - 修改 `src/systems/movement-system.js`：主动预规划（有目标无路径时立即计算）+ PathManager 集成
  - 修改 `src/entities/enemy.js`：fallback `_updateMovement` 兼容 PathManager

- v1.4 (2026-07-05) — 硬编码清理：状态效果统一化、树木碰撞体优化、dash 偏移统一
  - DamageableEntity 基类新增 `_updatePoison`/`_updateBleed`/`_updateMagicVulnerability`/`_updateDroneVulnerability`，4种状态效果统一在基类 `update()` 中驱动
  - Enemy 构造函数删除 15 行冗余属性初始化（已在 Combatant 中初始化）
  - `combat-system.js` 删除 85 行重复状态效果代码 + 1 处死代码 `anim.timer === 0`
  - GameScene.js dash 偏移逻辑统一：使用 `entity._getDashOffset()` 替代 inline switch 逻辑
  - wall-system.js 树木碰撞体优化：视觉半径和碰撞半径分离（collisionRadius = radius × 0.6），resolve() 添加逐步缩减步长回退
  - shield-system.js 修复 `const defense` 重复声明语法错误
  - 黑狼碰撞体积从 88 缩小到 38

- v1.3 (2026-07-05) — 增加 Sprite Pipeline 标准化流程，新增 `sprite-normalizer.py` 工具
- v1.2 (2026-07-05) — 怪物渲染模板系统，提取 `Enemy.render()` 通用模板 + 7个钩子方法
- v1.1 (2026-07-04) — 怪物统一配置（enemy-config.json），删除双系统

- v2.0 (2026-07-13) — 3D 碰撞/命中体系 Phase 3：近战与技能 AOE 3D 化
  - 统一技能命中形状：`src/physics/skill-shapes.js` 新增 `GroundCircle` / `GroundRect` / `VerticalSector` / `VerticalRect` / `Sphere`
  - 所有形状通过 `entity.collider` 做 3D（Z 轴高度 + footprint 半径）检测，地面 AOЕ 不再命中飞行单位
  - `SlashAttack` 扇形改为 `VerticalSector`，`ThrustAttack` 矩形改为 `VerticalRect`（支持后摆 backExtension）
  - 技能系统全部迁移：
    - 旋风 `whirlwind-system.js` → `GroundCircle`
    - 火球爆炸/直接命中 `fireball-system.js` → `GroundCircle`
    - 推击 `push-strike-system.js` → `VerticalSector`
    - 夜与火之光束 `special-attack-system.js` → `VerticalRect`
    - 冰锥 `ice-spike-system.js` → `GroundCircle`
    - 无人机 `drone-system.js` → `GroundCircle`
    - 符文剑 `rune-sword-system.js` → `GroundCircle`
    - 冲刺攻击-扇形/突刺 `dash-system.js` → `VerticalSector` / `VerticalRect`
    - 胖子僵尸腐蚀光环 `fat-zombie.js` → `GroundRect`
  - 近战判定复用 `SpatialPartitionSystem.queryRadius` 做 broadphase
  - 验证：`npm run lint`、`npx vite build`、`node scripts/test-collider.mjs` 全部通过

- v2.1 (2026-07-13) — 3D 碰撞/命中体系 Phase 4：动态实体 Y-sort 深度排序
  - 在 `GameScene.update` 中 `_syncBodiesToPhysics()` 后新增 `_updateDynamicDepths()`，每帧统一刷新玩家/敌人/武器/特效深度
  - 玩家与敌人 Sprite 深度基于脚底 Y（`y + displayHeight/2 + bias`），与环境墙壁/树木（`w.y + w.h`、`t.sortY`）使用同一坐标空间
  - 尸体使用较低 bias（+2），存活实体 +10，保持尸体被站立角色遮挡的透视关系
  - 手持武器、盾牌、副手武器跟随玩家深度 + 小偏移，保证武器始终与角色正确分层
  - 防御光环位于玩家深度下方；符文剑/冰锥/火球/飞行投射物/无人机等技能特效按自身 `y + 15` 排序
  - 其他施法者（敌人巫师）的 `_magicSprites` 也纳入同一排序
  - 受击绿色粒子深度改为 `y + 1000`，继续高于普通实体
  - 移除 `GameScene` 中所有硬编码的 `setDepth(50/100/148/149/150/155/160/165)`，避免与动态排序冲突
  - 验证：`npm run lint`、`npx vite build` 通过

- v2.2 (2026-07-13) — 3D 碰撞/命中体系 Phase 5：清理旧命中系统与可视化对齐
  - 删除 legacy `src/components/hitbox.js`（`HexHitbox`）和 `src/combat/hit-detector.js`（`HitDetector`）
  - `src/entities/entity.js` 移除 `hitbox` 字段、`initHitbox` 方法、`getCollisionShape` 六边形分支
  - `src/entities/player/update.js` 移除每帧同步 `hitbox` 的代码
  - `src/utils/collision-helpers.js` 精简为仅保留 `distanceToEntityShape`，内部改用统一 `Collider.groundRadius`
  - `src/entities/enemy-types/mutant-3.js` 攻击范围判定改用 `target.groundRadius`，移除旧矩形/圆形分支
  - `src/effects/attack-range-effect.js` 新增 `backExtension` 参数，支持绘制带后摆的定向矩形
  - `src/entities/components/dash-system.js` 冲刺-突刺范围提示从扇形改为矩形（`triangle` + `backExtension`），与 `VerticalRect` 命中形状一致
  - 验证：`npm run lint`、`npx vite build`、`node scripts/test-collider.mjs` 全部通过

- v2.3 (2026-07-13) — 全 Phase 0-5 回顾检查与 bug 修复
  - **严重问题修复：**
    1. `src/entities/components/rune-sword-system.js`：命中条件被逻辑取反（`!intersectsEntity`），导致符文剑命中范围外目标、范围内目标反而无伤。已修正为 `intersectsEntity` 命中。
    2. `src/systems/spatial-partition-system.js`：
       - `queryRadius` 等返回内部复用数组，并发查询会篡改遍历结果；现每次返回 `.slice(0)` 副本。
       - `maxQueryResults: 64` 在密集场景会静默截断命中目标；已提升至 `2048`。
    3. `src/entities/drop-item.js`：掉落物未排除在实体碰撞分离外，会挤开玩家/敌人；已设置 `this.noCollision = true`。
    4. `src/entities/damageable-entity.js`：子类在 `super()` 后才设置 `size/collisionRadius`，导致 `Collider` 仍是默认半径；已在构造函数末尾调用 `this.rebuildCollider()`。
    5. `src/phaser/scenes/GameScene.js::_configureEnemyBody`：曾把敌人 `collisionWidth/Height` 覆盖为 `spriteSize`（`size*4`），导致 footprint 被放大数倍；现优先保留配置/选项中的 gameplay 尺寸，fallback 使用 `collisionRadius/size` 推导。
  - **深度排序统一：**
    - `src/phaser/scenes/GameScene.js::_syncNeutralEntities` 不再硬编码 `e.y`，改由 `_updateDynamicDepths()` 统一按脚底 Y + 10 排序。
    - `src/combat/projectile.js` 投射物深度从 `this.y` 改为 `this.y + 12`。
    - `src/entities/drop-item.js`、`src/entities/dungeon-chest.js` 掉落物/宝箱深度改为 `y + 5/+6`。
    - `src/phaser/scenes/GameScene.js::_syncCollisionRadii` 调试可视化改为统一画 `groundRadius` 圆，移除矩形分支。
  - **其他修正：**
    - `src/entities/components/special-attack-system.js`：移除 `update()` 中每帧创建范围提示的代码，避免夜与火之剑持续期间堆积特效。
    - `src/combat/attack.js`：`SlashAttack` / `ThrustAttack` 非法角度检查移到消耗体力/CD 之前，避免无意义消耗。
    - `src/entities/components/dash-system.js`：修复变量遮蔽、移除冗余 `hitIndex === 0` 判断。
    - `src/entities/enemy-types/mutant-3.js`：`_spawnBloodMist` 临时精灵深度改为 `y + 10`。
    - `src/physics/index.js`：移除未使用的 `SpatialGrid` 导出（文件保留供测试直接引用）。
  - **验证：** `npm run lint`、`npx vite build`、`node scripts/test-collider.mjs` 全部通过。

- v2.4 (2026-07-13) — 可移动实体脚底阴影
  - `GameScene` 新增 `entity_shadow` 纹理与 `_shadowSprites` 映射表
  - 新增 `_syncEntityShadows()`，每帧为玩家、敌人、中立实体在脚下生成黑色圆影
  - 阴影半径匹配统一 `Collider.groundRadius`，深度低于实体（`entityDepth - 1`），透明度 0.35
  - 地图模式下自动隐藏所有阴影
  - 阴影随实体移除自动销毁，避免内存泄漏
  - 验证：`npm run lint`、`npx vite build` 通过

- v2.5 (2026-07-17) — 普通僵尸精灵图接入 + 攻击线性突进
  - `assets/enemies/zombie/`：idle 1 帧 / walking 15 帧 / attacking 15 帧，8×4 网格 512×512，素材经 `scripts/archive/prepare-zombie-sprites.py` 统一内容高度（~440px）并对齐底部，与既有僵尸素材比例一致
  - 新建 `src/entities/enemy-types/zombie.js`：`Zombie` 类仿 fat-zombie 模式，攻击动画 1s、间隔 2s（attack.cooldown 2000）、判定距离 100px（attackDistance），显式 `animKey: enemy_zombie_${state}`
  - `enemy.js` 基类新增**配置驱动线性突进**（`attack.lungeDistance`，僵尸配 100）：`triggerWeaponAnim` 锁定突进方向，`_updateLunge` 按攻击计时线性推进，增量式位移 + 每帧 `WallSystem.resolve` 撞墙校验；任何怪物配置后全场景生效
  - 地牢 `createBasicZombie` 从 `CircleEnemy` 圆形占位改用 `Zombie` 类；主神空间 `spawnMainZombie()` 生成测试僵尸
  - 验证：lint / build / test-collider 全部通过
- v2.6 (2026-07-17) — 投射物躯干矩形判定（方案 B）
  - 新建 `src/physics/torso-hitbox.js` 共享模块（详见上方"补充：投射物躯干矩形判定"小节）
  - `projectile.js`：地面目标命中 = footprint 椭圆 ∪ 躯干矩形 ∪ 身体圆柱
  - 冰锥/火球/符文剑飞行命中接入；爆炸 AOE 与近战判定不变
  - 7 只精灵图怪物写入实测 `render.projectileHitbox`；GameScene 绿色调试矩形
  - 验证：22 个躯干单测全过、lint / build 通过

- v2.7 (2026-07-17) — 战斗/视觉六项调整 + 弹反修复 + 掉落物更新
  - **近战判定地面化**：`skill-shapes.js` 新增 `GroundSector` / `GroundDirectedRect`（只看 footprint、不查 Z、飞行免疫）；`attack.js` 斩击/突刺判定原点归回攻击者脚底（移除 footOffsetY 上移），范围可视化同步；推击/夜与火/冲刺/mutant-3 未动
  - **枪械精准对准**：`syncWeapon` 远程武器贴图旋转改为 `atan2(鼠标世界 − 武器位置)`（主手+副手），消除"脚底→鼠标"枢轴视差导致的固定角度偏移；弹道原本即朝准心，改后贴图=弹道=准心三者一致
  - **玩家 footprint 缩小 25%**：`player-defaults.js` collisionRadius 30→22.5；`Entity.groundRadius` 注释为阴影/footprint/分离/命中判定唯一来源（强绑定，阴影随动缩小）
  - **胖子僵尸攻击位移取消**：`_updateLeanOffset` 攻击分支归 0，攻击时阴影/footprint 不再前移（walk 前倾保留）
  - **僵尸受击粒子**：锚点从脚底改为贴图中心（y − footOffsetY），保留朝源侧偏
  - **枪械蛋壳**：从武器贴图中心弹出，向上抛起后受重力（1000）落至脚下；`shell-casing.js` 新增可选 groundY 参数
  - **地牢刷怪特效**：`playDungeonSpawnParticles`——纯黑、更慢、1.5s、数量+30%，NORMAL 混合（黑色在 ADD 下不可见）；`combat-room-system.spawnMonsters` 逐怪脚下触发
  - **删除金属/奔跑僵尸**：enemy-config 删 armoredZombie/runnerZombie/fastZombie，zombie-dungeon 工厂+映射级联清理，图鉴自动同步
  - **弹反修复（数据缺陷）**：根因非碰撞系统——`旧木盾`装备条目缺 `weaponType: 'shield'` + 整个 `defense` 块，`checkEquipped()` 永远 false 致盾系统不激活；已补全（数值与小圆盾一致，弹反属性未改），双份 equipment.json 同步。**教训**：系统逻辑完好的"功能失效"优先查数据/配置完整性
  - **掉落物**：贴图×1.5（48/悬停60）保持浮动，装备文字固定不浮动；悬停拾取 35→52、Z 键范围 75→112、pickupRange 30→45 匹配
  - **遗留未决**：复活后子弹不从枪口射出——两条死亡路径实测枪口均完好，未复现，待具体场景线索
  - 验证：35 个单测全过（含 13 个地面形状用例）、lint / build 通过

- v2.8 (2026-07-17) — 配置链路修复/实体生命周期/事件背景图/技能经验（五轮合并）
  - **战斗与判定**
    - 近战普攻输入锁：攻击动画未播完（`weaponAnim.state === 'attacking'`）忽略左键，不重播动画、不产生新判定（`player/update.js`；三条近战 Tween 路径均以 attacking 贯穿全程）
    - 胖子僵尸 `attackDistance: 100` 真正生效：`enemy.js` 构造函数补 `attackDistance` 映射——此前 config→实例断链，所有敌人 attackDistance 均为死配置，CombatSystem 实际按 attackRange×1.15 触发
    - footprint 配置优先：`GameScene._configureEnemyBody` 不再无条件用矩形推导覆盖 `collisionRadius`（仅未配置时回退）；毒液 45→7.07（面积-50% 落地）、巫师 45→20、普通僵尸 25→15、突变体3 45→20；spitter/wizard 的 `_getPhaserOptions` 硬编码 30×90 改读 `config.render`
    - HP 调整：僵尸犬 100/僵尸 120/毒液 120/巫师 600（enemy-config.json 单源，地牢工厂/图鉴自动同步）
  - **实体生命周期（重要模式）**
    - `Game.removeEntity(key)`：删除实体前必销毁 `_phaserSprite`/`_phaserLabel`——统一入口，所有清理循环（combat-room/dungeon-map/boss-reward）走这里，杜绝孤儿贴图残留
    - `Game.isPreservedCorpse(e)`：存活尸体（`_preserveCorpse` 且计时器未走完）在波次/房间清理中**跳过删除**——胖子僵尸尸体保留在地面持续腐蚀，只会因持续时间到而消失（7.5s 自毁贴图、8s 扫描移除）
    - **教训**：实体删除 = 贴图销毁 + 尸体豁免，二者都必须经统一入口；贴图孤儿化是"贴图残留"类 bug 的统一根因
  - **场景共享状态陷阱（地牢枪口不同步根因）**
    - 地图模式 `weaponSprite.setActive(false)` 后全代码无任何恢复 → `_getMuzzleWorldPosition` 的 active 守卫失败 → 回退脚底相对算法（主神空间不进地图模式故正常）
    - 修复：非地图模式分支统一 `setActive(true)`（与 playerSprite 同模式）+ 守卫放宽不查 active；**教训**：修改必须落在共享链路上全场景生效（工作规则 原则10/规则5）
  - **地牢视觉**
    - 地板：blackbrick 三张 512×512 覆盖替换（旧 256 图删除）；切割 32×32 小砖（候选池 768）、8 随机朝向（4 旋转×翻转）、均匀概率、相邻不同块、圆角 4px、四边内缩 1px 留 2px 纯黑缝隙、外圈 64px 黑渐变不变
    - 事件背景图：15 事件（10 新 + 5 旧）全覆盖，`assets/scenes/dungeon-events/` 英文命名，`EVENT_BG_IMAGES` 配置映射；`cover` 等比铺满、bottom:0 固定像素；事件/结果面板 `left/right/bottom/height` 固定像素全宽拉伸（2K 不再半宽）；选择副标题简化为 `检定X-成功率Y%`
  - **技能经验修复（两个断点，均沿数据链排查）**
    - 断点1：`DataLoader.buildSkillFromJSON` 漏拷 `expRewards` → 全技能经验恒 0
    - 断点2：运行时 `fetch('/data/skills.json')` 实际由 Vite 提供 `public/data/skills.json`（过期副本：11 技能、无 expRewards、缺 6 技能）→ 已双份同步；**教训**：skills.json 与 equipment.json 同为 `data/ ↔ public/data/` 双份副本，改数据必须双同步（规则2 钩稽链路）
  - **玩家数值**：升级经验 `globalMultiplier` 2→4（翻倍，combat-formulas.json）；升级回满 HP/MP（gainExp 循环内）
  - 验证：lint / build / test-collider 全部通过

- v2.9 (2026-07-17) — 集合体首领/僵尸地牢-初级/三系统审查修复（多轮合并）
  - **集合体（amalgamZombie，boss rank 首领）**
    - 素材 `assets/enemies/amalgam/`（`scripts/archive/prepare-amalgam-sprites.py` 统一内容 480px、底部对齐 496）；新类 `src/entities/enemy-types/amalgam-zombie.js`：站桩 Boss，投掷（落点红色椭圆警示+范围伤害+生成胖子僵尸）、砸地（分圈结算 100/200/500px×1.2/0.7/0.2，取最小圈不叠加）、15s 召唤 2 僵尸、melting 死亡
    - **站桩锁死五通道**：speed 0 显式生效、`noSeparation`（resolveCollisions 中对方承担全部位移）、`applyKnockback` 空覆盖、`_tryUnstuck` 跳过 speed 0 单位、出生点锚点钉死
    - **falsy-0 根因（重要教训）**：移动代码 `maxSpeed || speed || 100` 把显式 0 误回退 100 → 全库改 `??`（空值合并）。**数值回退必须用 ?? 不用 ||**
    - BOSS 战重构：集合体替代大块头（删 BigBoss ~530 行）；arena 1024（玩家下方中心上移 300/boss 上方中心镜像）；地板抽共享模块 `dungeon-floor-texture.js`；BOSS 场地尺寸改读 `combatRoom.bossSize` 配置
    - 主神空间 `spawnMainAmalgam` 测试生成；召唤/投掷生成工厂注入（避免实体层反向依赖 world 层）
  - **僵尸地牢-初级（第二个地牢）**
    - 配置驱动：`data/dungeon-config.json` 新增 `dungeonList`（出征展示元数据）+ `zombieDungeonBeginner`（22 节点/最短 7/起始 3 分支/mainRowMinCombat 3/战斗 40%/精英 0%/bossEncounter 精英遭遇独立副本）
    - 生成器按类型读配置；`mainRowMinCombat` 主通道随机 N 列强制战斗（缺省=全部，向后兼容）；**修正：第 1 列强制全行移到节点数调整之前，且调整候选排除第 1 列**（否则总数超区间/分支数不恒定）
    - `_enterBoss` 对 zombieBeginner 走 `_enterBossCombat`（bossEncounter+普通波次流程，完成→奖励节点→胜利）；`_isZombieFamily()` 共享僵尸战斗体系；出征界面选项/信息面板改由 dungeonList 驱动
  - **地牢审查修复**
    - Boss 完成回调被 cleanup 清空（先取回调再 cleanup）；Boss 战死亡 active 卡死（shutdown 强制 BossRewardSystem.cleanup + cleanupRoom）；宝箱材料 `rewards || items || []` 键兼容；召唤泄漏按 key 前缀兜底（`Game.removeEntitiesByPrefix`，zombieDog_/amalgam_）
    - 中优先级：reward 状态拦截实体更新、波次暂停顺延、商店轮询句柄清理、`_returnToMap` active 守卫、`_checkBossDefeated` 不再把 null 当战胜、补给堆药水=瓶数×单瓶恢复量（POTION_HEAL/MP 导出）、事件结果按钮 300ms 延迟激活防双击穿透、负金币扣除钳制持有量
    - 低优先级：工厂 fallback HP 同步/召唤工厂注入、BOSS 清理恢复地形/树木/世界尺寸+syncTerrain、BOSS 墙 height 60、退出按钮绘制/热区统一、`_entityHudTexts` role 字段、`_onEnemySpawn` rebuildCollider 守卫、iconMap 补 materials、isActive 复位、`_calculateSpawnArea` margin 生效
  - **附魔/改造/强化审查修复**
    - 附魔：`EnchantSystem.init()` 接入 main.js（拖拽放回生效）；魔法粉尘名称统一（MagicDustItem.name=魔法粉尘，匹配点引用模板名）；沉重减速 `_applyEnchantAttackInterval` 统一钩子（空手恢复全部基础冷却，装备/卸下/写回全路径）
    - 改造：穿甲 `armorPenetrationPercent` 补收集写入（生产端断链修复）；G18 weapon9 配置复制移到 weapon10 完整赋值之后；`_getCraftConfig` 无配置返回 null（不再回退 PKM，UI 显示"该武器不可改造"）；同 id 配件不再白扣 4 券；拖入装备栏立即 `_initAmmoForSlot`；registry 补 staminaCostDelta/skillStaminaCostDelta/dashDoubleHit；tooltip 弹夹 magazineOverride 优先
    - 强化：删除改写 `item.stats` 的平方级污染块（无 formula 武器回退读 stats 作 base 曾实战虚高）；强化石先扣金币后消耗；**数值决策**：getAttackFormula 回退 `enhanceFlat: 1`（无 formula 武器强化+1/级）、`expValue` 增 `eliteMultiplier: 2 / bossMultiplier: 10`（boss 经验配置化）、盾牌 `defense.base + perEnhance × 强化等级` 计入玩家 def（防具强化真生效）
  - **事件背景图**：15 张 3072×2048 → 1920×1280 瘦身（93MB→45MB），cover 铺满
  - 验证：lint / build / test-collider 全部通过

- v3.0 (2026-07-17) — 集合体打磨/判定根因系列/召唤物体系（多轮合并）
  - **判定与碰撞根因系列（重要教训沉淀）**
    - `Enemy._updateMovement` 的 `maxSpeed || speed || 100` 把显式 0 误回退 100 → **数值回退必须用 `??` 不用 `||`**（全库 9 处已改）
    - 警示圈/特效残留统一根因：`active=false` 只是逻辑标记，**Phaser graphics 必须显式 destroy**（EffectManager 移除后不会再触发延迟销毁）
    - `resolveCollisions` 曾用实体坐标+世界圆 → 与 footprint 椭圆（colliderOffset 偏移 + Y 透视压缩）错位；**分离判定统一取 collider.x/y + 逆透视变换**（与投射物 footprint 判定同口径），位移量变换回世界空间
    - tint 是乘法：绿色纹理 × 彩色 tint 必偏色 → **自定义色一律用白色纹理**（`impact_dot`）
  - **集合体（amalgamZombie）持续打磨**
    - 判定圆 120→240→**270**、`colliderOffsetY` -50→**-100**（配置驱动，阴影/命中/分离同源）
    - 世界内血条两次下移（topY+188）、名字/数值/标签错开、后删 `Lv.X · 首领` 标签；新增 **BOSS 专属 DOM 血条**（顶部状态栏下方 20px，玩家命中才显示，5s 无命中/Boss 死亡自动隐藏，damageable-entity 在 `rank==='boss' && source._faction==='player'` 触发）
    - 投掷警示圈立即销毁、落点深黄大粒子（0xb8860b）、`AimHelper.lead` 预判拦截点（与僵尸巫师/毒液僵尸同实现）
    - 砸地：CD 到点即放（根因：footprint 扩大后玩家进不了 250 触发范围）、区域 200/400/800 ×1.2/0.7/0.2、范围提示为逐帧红色椭圆冲击波（8px 加粗+正弦闪烁、2:1 透视、600ms 扩散、死亡/战斗结束 `_destroyCustomEffects` 统一清理）
    - 召唤：CD 15s、召唤点地牢刷怪同款黑粒子；站桩/位移免疫五通道（speed 0、每帧归零、applyKnockback 空覆盖、noSeparation、锚点钉死）
    - `parryImmune: true` 弹反免疫（通用机制：配置加标即免眩晕/击退/打断，玩家侧收益不变）；受击粒子配置化 `hitParticleColor`（白纹理+黄 tint）
    - 音效：`sounds` 配置块（idle/throw/impact/slamHit/death/idleInterval）+ `_playSound(key)` 助手 + SKILL.md 音效导入工作流
  - **眩晕双星特效**：`GameScene._syncStunEffects`——眩晕实体头顶两颗四角星旋转（透视压缩+浮动），醒后/实体失效自动销毁，地图模式清理
  - **召唤物统一 `_summoned` 标签（一劳永逸）**：集合体召唤/投掷生成、巫师召唤犬打标；金币+经验（onDeath）、暴击/武器精通/无人机经验（takeDamage 三分支）、7 处技能击杀计数（attack/whirlwind/ice-spike/dash/push-strike/fireball）全部加 `!entity._summoned` 闸门；**未来召唤方打标即被全部闸门拦截，无需改判定**
  - **调试工具**：左下新增「秒杀」按钮（`Game._oneHitKill`，takeDamage 中玩家伤害提到致死量，正常结算）
  - 验证：lint / build / test-collider 全部通过

- v3.1 (2026-07-17) — 遗留 bug 与技术债务分批清理（19 项）
  - **投射物命中快照**：`Projectile._effectSnapshot` 在 `ProjectileFactory.create` 统一快照发射武器的 `_enchantEffects/_craftEffects`，命中按快照判定（切枪不再改弹道效果）；非工厂创建的投射物回退原逻辑
  - **攻击冷却基准固化**：`Attack.baseMaxCooldown` 构造时固化，`_applyEnchantAttackInterval` 改读创建基准并废弃 `_baseCooldowns` 缓存（修复 ramp/改造运行时值被当基准缓存的污染）
  - **附魔界面拖出即刷新**：附魔槽从装备槽拖出武器补 `_applySkillOverrides(equipments[weaponMode])` + `_syncWeaponVisual`
  - **次级格挡**补 `isMelee` 判定；**冲刺体力**删 `staminaCostDelta` 双用；**基类换弹**读 state 存值（计入改造）
  - **registry tooltip**：`getCraftEffectDisplay(name, value, allEffects)` 透传聚合效果；`magicVulnerabilityOnHit` 显示真实层数；`magicVulnerabilityStacks` 显示 `易伤层数×N`
  - **ItemDatabase.getByWeaponId**：懒索引反查替代 craft-system 硬编码 weaponIdMap（load/addItem 自动失效重建，新武器免登记）
  - **地牢 buff 状态键唯一化**：`addStatusEffect` 键 `'buff'` → `goddessBless`/`demonPrayer`/`buffCfg.id`，消耗/清理按同键移除（多 buff 不再互删图标）；`_cleanupEventUI` 先销毁事件打字机再移除 DOM
  - **强化配置化**：`data/game-config.json` 新增 `enhance` 节（maxLevel/baseCost/costGrowth），`enhance-system.js` 经 `_getEnhanceConfig()` 读取（`??` 回退）
  - **材料按 id 匹配**：强化石 `enhancement_stone`/改造券 `reforge_ticket` 模板与地牢事件奖励创建点补 `id`，消耗匹配 id 优先、无 id 旧实例名称兜底
  - **死代码批删**（grep 确认零调用）：`_combatCompleted`、`ZOMBIE_DUNGEON_CONFIG` 三残留字段、`consumeGoddessBless`、`getGradeCost`、Player 空 `_onHitEntity` 覆盖（敌人版是活的，damage-pipeline 调用保留）、`_ticketCost`/`_modifications`/`getWeaponEffects`、registry 五函数、codex `_craftEffects` 死分支、spitter 敌人端 `_craftEffects` 残留
  - 验证：每阶段 lint / build / test-collider / test-craft-sync 全部通过

- v3.2 (2026-07-18) — 改造系统深化：registry 驱动聚合 + craft-system 拆分
  - **三角机制重构（registry 驱动聚合）**：`src/ui/craft/craft-effects.js` 的 `aggregateCraftEffects` 按 registry `applyMode` 聚合（flag=OR / override=后选覆盖 / add·multiply=求和），替代 44 行人工收集；**新增改造效果工作流变为：① craft-config.json 加 effects ② craft-effect-registry.js 注册条目（applyMode+display）③ 消费端读 `_craftEffects.X`——聚合无需再动**
  - **拆分**：`craft/weapon-image.js`（resolveWeaponImageSrc 回退链）；craft-system.js 891→741 行，仅作 UI 控制器，外部 API 不变
  - **test-craft-sync.mjs 适配**：收集腿改结构断言（聚合≡注册），新增 registry 条目结构校验（applyMode 合法+display 存在）
  - 验证：lint / build / test-collider / test-craft-sync / 聚合语义抽样 全部通过

- v3.3 (2026-07-18) — 新怪物：铠甲骑士（精英）
  - **配置驱动全部数值**：`enemy-config.json` armoredKnight——HP 800、speed 同僵尸、六维=突变体-3×1.15、`attackSkills`（combo/charge/block 三技能帧判定/冷却/距离/倍率全集中）；family 骑士（不进僵尸地牢池）
  - **技能机制**：二连击（帧 12/25 判定）、持盾冲锋（900px/s 追踪、命中×2+击退+眩晕、冲锋期间 `_parryImmune`、目标弹反成功只击退）、举盾格挡（玩家攻击临近触发、2s 内 takeDamage 覆写全部按弹反、近战攻击者被眩晕击退；`shieldSystem._lastParried` 代理接入 DamagePipeline）
  - **工作流复用**：素材先复制 `assets/enemies/armored_knight/`（8×4 512×512 切帧）→ 配置 → BootScene 精灵图+动画注册 → enemy-types.js 导出 → game.js 主神空间测试生成（永久警戒）
  - 验证：lint / build / test-collider / test-craft-sync 全部通过

- v3.4 (2026-07-18) — 稀有度扩展/物品栏优化/祭品体系/仓库系统（多轮合并）
  - **稀有度+神话/传说**：`config/rarity.js` 单一来源（RARITY_LABELS/RARITY_COLORS/RARITY_ORDER/getRarityLabel），5 处重复 rarityLabelMap 收编；神话橙/传说红色条
  - **物品栏优化 D2-D5**：消耗品 `useEffect` 数据驱动（config/consumable.js 统一结算）；快捷栏绑定 instanceId（`_findAssignedItem` 实例优先+同名回退）；强化栏单击误删修复、背包格子级三套消耗公式统一；**equip-manager.js 拆分 1604→686 行**（`ui/equip/drag-drop-manager.js` 工厂注入防循环 + `ui/equip/slot-renderer.js` 纯渲染）
  - **祭品体系**：`config/tribute-effects.js` 数据驱动引擎（**最终乘算** Π(1+p/100)，应用点：面板/金币/双恢复）；20 个农产品祭品（普通5/优质5/稀有4 正负效果，史诗3/神话2/传说1 纯增益）；精英必掉+普通 5% 掉落（`tributes.dropTables` 配置）；三特效：蟠桃原地复活(30%,一次)、雪莲经验+25%、人参击杀回蓝 5%（仿大理石计时器），特效上 buff 栏（syncTributeBuffs/地牢结束清理）
  - **仓库系统**：小鼠大王旁仓库 NPC（实心圆，`npcType 'warehouse'` 点击直开）；`ui/warehouse-system.js` 面板（改造栏同款滑入动画，20 格×2 页）；双击/右键双向存取（equip-manager 委托 warehouse 分支）；tooltip wh-cell 感知；**材料全局调用**（强化石/改造券/粉尘 背包+仓库合计计数、先背包后仓库扣减）；附魔栏卷轴列表（背包+仓库双击放入，`_equipScrollFromSource` 通用化）
  - **仓库增强**：同品堆叠存取（maxStack 预判，溢出占新格）；一键全部存入/取出同类（满仓中断）；满仓走 `SceneManager.showTopNotification`（场景提示语同款）；整理排序子菜单（稀有度/价值/种类三模式，种类自定义顺序）
  - **暴击排查结论**：公式饿死（crit=2+luck vs critRes=con），非代码 bug，数值待拍板
  - **复盘修复**：仓库克隆保留 weaponAsset、蟠桃复活比例读配置、ESC 关仓库、仓库来源卷轴取出后刷新
  - 验证：lint / build / test-collider / test-craft-sync 全部通过

## 祭品添加标准工作流（新增祭品一律按此开展）

### 1. 数据结构（data/equipment.json，双份同步 public/）
祭品物品：`{ name, type: '祭品', icon, category: 'tribute', rarity, level, stack, price, effects: {...}, stats: [{name, value}], desc, special?: {...} }`
- `effects` 为固定百分比数值（负数为减益），引擎最终乘算 `Π(1+p/100)`；`stats` 仅用于面板显示；`special` 为特效参数块（非百分比语义）。
- 不写贴图时用 emoji 图标。

### 2. 效果键（config/tribute-effects.js 聚合）
- 面板向：atkPercent/matkPercent/defPercent/mdefPercent/moveSpeedPercent/critPercent（calculateCombatStats 末尾乘算）
- 经济向：goldPercent/expPercent/dropChancePercent
- 恢复向：hpRegenPercent/mpRegenPercent/staminaRegenPercent（倍率）
- 怪物向：monsterDamageTakenPercent（承伤）/monsterAtkDownPercent（攻击削减）/monsterMoveSlowPercent（移速削减）
- 比例向（**耦合规则**）：combatChanceDelta（百分点，战斗↑事件↓或反向，**战斗+随机事件恒=100%，一个调整同步影响另一个**）/eliteChanceDelta（精英概率百分点）
- 特效键：revivePercent（蟠桃复活）/killMpHealPercent（人参回蓝）/expPercent（雪莲经验）

### 3. 数值带（按属性稀缺度）
| 类别 | 普通 | 优质 | 稀有 | 史诗 | 神话 | 传说 |
|---|---|---|---|---|---|---|
| 标准带（攻防/金币/体力/事件比/怪物向） | 1~2 | 3~4 | 5~6 | 7~8 | 9~10 | 11~15 |
| 珍贵带（移速/暴击/怪物减速） | 1 | 2 | 3 | 4 | 5 | 7 |
| 廉价带（生命/魔法恢复） | 4 | 8 | 12 | 18 | 22 | 30 |
- 普通/优质/稀有 = 1 增益 + 1 减益（按物品特性）；史诗及以上 = 纯增益；负效果取对应带低档。
- 神话/传说必须带特效词条（item.special + SPECIAL_BUFFS 图标）。

### 4. 特效模式（参考实现）
- surviveCapPercent：单次伤害上限（玩家 takeDamage 拦截）
- moonshadowDuration/moonshadowDamagePercent：进战斗无敌+精英/Boss 增伤（战斗入口 _triggerMoonshadow）
- oreUpgrade：拾取祭品品质+1，传说额外给一件（tryPickupItem 转换）
- revivePercent：死亡 3s 原地复活一次
- killMpHealPercent：击杀后 1s 回蓝（计时器+buff）
- 特效参数放 item.special，不上 effects 聚合；buff 栏走 syncTributeBuffs/clearTributeBuffs。

### 5. 掉率表（combat-formulas.json tributes.dropTables）
elite（必掉）/normal（5%）两表按稀有度权重；新增等级自动按 RARITY_ORDER 参与。

### 6. 验证
JSON 双份一致；lint / vite build / test-collider / test-craft-sync；CHANGELOG 记录。

- v3.5 (2026-07-18) — 20 矿石祭品/怪物向效果/比例耦合/三新特效
  - 引擎扩展：怪物向三键（承伤/攻击削减/移速削减）、比例耦合键（combatChanceDelta 战斗事件恒 100% 同步）、eliteChanceDelta、dropChancePercent、staminaRegenPercent
  - 20 矿石祭品（数值带按稀缺度三档：珍贵/标准/廉价）；磁铁矿战斗+6pp事件-6pp、星光蓝宝事件+8pp战斗-8pp（耦合实现）
  - 三新特效：金刚石「金刚不坏」（单次伤害≤15%最大生命）、月光石「月影」（入战无敌 15s+精英/Boss 物魔伤+5%）、贤者之石「点石成金」（拾取祭品品质+1，传说额外给一件随机传说）
  - 祭品添加标准工作流归档（本节）

- v3.6 (2026-07-19) — 祭坛/合成/旧祭品迁移/定价
  - 祭坛 NPC（小鼠大王下方实心圆）：献祭出征/祭品合成/退出三选项；合成 2 低→1 高随机池，传说祭品重随一件；不同稀有度拒绝（提示栏）；一键放入按稀有度筛选（仅背包，不调仓库）；奇数合成剩「最后添加/名称序最后」一件；合成槽 20、堆叠整组拖放
  - 三旧祭品（麦穗/石头/大理石）迁移数据驱动 effects，删除全部按名硬编码；初始背包映射走 ItemDatabase；祭品 maxStack 999、出征栏同名限制；全祭品按稀有度统一定价 100/200/400/800/1600/3200

- v3.7 (2026-07-19) — 附魔等级体系替换为稀有度体系
  - enchant-config.js 卷轴 `grade` 字段用 common~legendary（原 F/E/D 等字母级废弃）；显示一律 RARITY_LABELS；魔法粉尘消耗/分解产出随稀有度档调整

- v3.8 (2026-07-19) — 地牢难度分级（FEDCBA）
  - `data/dungeon-config.json` dungeonList 每地牢 `grade` 字段（zombie=D「☠ 僵尸地牢高级」、zombieBeginner=F「☠ 僵尸地牢-初级」；内部键不动，仅显示名）
  - 祭品掉落按难度分表：combat-formulas.json `tributes.dropTables` 以 F~A 为键，每级 `maxRarity` 封顶（F≤稀有、E≤史诗、D+≤传说）+ elite/boss（必掉）/normal（几率掉，F 2% 起每级 +0.5%）三张权重表；`rollTributeDrop(rank, dungeonType)` 查表
  - 骑士冲锋期间 `noCollision` 无视实体碰撞（可穿人不可穿墙），结束由分离系统墙解析挤出，防卡死/瞬移

- v3.9 (2026-07-19) — 随机事件分级体系
  - 事件两段判定（dungeon-event-system rollEventType）：先 30% 通用 / 70% 限定，再组内按权重抽
  - 限定池：`RESTRICTED_EVENT_META`（dungeon-event-definitions.js）每事件 `{ grade, scope }`——scope=地牢大类（现全部 zombie），grade=事件等级，仅出现「地牢等级 ±1」内的事件
  - 通用事件（女神像/恶魔雕像/宝箱/陷阱/补给堆）奖励分级：`combat-formulas.json universalEventRewards` 按地牢 grade 覆盖（祝福场次/粉尘/金币/恢复量等），陷阱/补给属性检定成功率每级 -2pp 下调（下限沿用 minSuccessRate）；宝箱 D 级起 10% 祭品彩蛋走 rollTributeDrop
  - 改名「僵尸地牢」→「僵尸地牢高级」全界面同步

- v4.0 (2026-07-19) — 出征等级门槛
  - 进对应等级地牢至少放入一件对应稀有度祭品：F↔普通、E↔优质、D↔稀有、C↔史诗、B↔神话、A↔传说（GRADE_ORDER 与 RARITY_ORDER 同序一一对应）
  - `expedition-system.js` depart() 前置 `_getRequiredRarity()` 判定，缺则提示「请根据提示放入对应等级祭品」拦截
  - 出征界面左侧固定说明面板 `.expedition-rule-panel`（fixed left:8px top:20vh，pointer-events:none）：F~A 对照表（RARITY_COLORS 上色）+ 当前选中地牢要求实时刷新
  - **样式坑**：根 `game-style.css` 才是 index.html 加载的全局样式表；`src/ui/` 下新建 css 无任何引用会成为孤儿文件，全局样式一律追加到根 game-style.css
  - 修复 `getTributeHpRegenFlat` 缺失导出（引用先于实现，vite build 报 Missing export——引用配置函数前先确认导出存在）

## 怪物 HUD（名字/血条）定位规则

- **统一规则**：怪物名字与血条位于**贴图上方 30px 区域**（血条 `healthBar.offsetY` 默认 -30，名字在其上方紧贴）。不要再放更高。
- **透明上沿校准**：AI 生成精灵图常有大片透明上沿，`topY` 按 displayHeight 算会远高于视觉头顶——在 enemy-config `render.hudOffsetY`（正数下移，如骑士 75）整体校准名字+血条，不要改通用代码。
- **渲染来源**：新怪配置走 `entity.config.render`，老怪走 `_animCfg.render`（GameScene `_syncEntityHud` 已做双源回退）。
- **非方形帧显示**：渲染层 `setDisplaySize` 按帧宽高比等比缩放（spriteSize=最长边），方形帧行为不变；素材帧尺寸不统一（如手脑 walk 512×1024 与其余 512×512）时无需特殊处理。

- v4.1 (2026-07-20) — 手脑裁剪修复/骑士HUD下移/仓库整体修复/出征界面调整
  - 手脑素材真实网格：idle/slam/howl 8×4（帧512×512）、walk 8×2（帧512×1024）——勿信口述"4×8"，**拿到精灵图先目检行列布局再配 frameWidth/Height**
  - 仓库：金币/消耗品无法存入+满仓误报根因=金币无 maxStack 字段（_maxStackOf 回退 gold 99999）+不可堆叠物品空间语义修正（整件1格与 stack 数无关）；overlay 点击一并关闭（warehouse 自挂监听避免循环 import）；NPC走远链补关闭；格子改一行2格×56px 对齐背包
  - 出征界面 open() 改自动关闭背包（原为主动打开）；说明弹窗重定位 left:4px bottom:2px 187×945 拉伸

## 常见陷阱：Phaser 4 的 FX API 不是 postFX

- Phaser 3.60 的 `sprite.postFX.addGlow(...)` 在 **Phaser 4 已移除**——`sprite.postFX` 为 undefined，静默失败不报错。
- Phaser 4 正确用法：`sprite.enableFilters().filters.internal.addGlow(color, outerStrength, innerStrength, scale, knockout, quality, distance)`（Camera 上为 `camera.filters.internal/external`）。
- addGlow 参数顺序与 v3 不同（第 4 位是 scale，第 5 位才是 knockout），迁移时逐位核对。
- knockout=true 会把贴图本体完全隐藏只留光晕（"only the glow is drawn, not the texture itself"）——要"贴图正常+轮廓外光晕"必须用 knockout=false，光晕会自然从贴图边缘向外渐变。
- 粒子发射器重力：v3 `emitter.setGravity(x, y)` 在 Phaser 4 改名为 `setParticleGravity(x, y)`，旧名调用报 "is not a function"。

## 常见陷阱：Phaser 4 filters 是 per-object 渲染通道（数量多即卡）

- `enableFilters().filters` 每个 GameObject 一个独立 render-to-texture + shader pass——满地掉落物时几十/上百个额外通道，帧率雪崩。**实体特效一律不用 filters**。
- 替代：离屏 canvas 烘培纹理（`ctx.shadowBlur` 多次叠画出外发光渐变，`textures.addImage` 缓存复用），渲染零开销。
- 光晕宽度要按显示尺寸比例烘培：原图 512px 显示 48px 时，10px 光晕需按 ≈20% 画布比例烘，否则被缩放稀释到不可见。

## 地牢添加标准工作流（新增地牢一律按此开展）

### 1. 展示元数据（data/dungeon-config.json `dungeonList`）
新增条目：`{ name, nodeCount, battleRatio, level, reward, grade }`——`grade`（F~A）驱动：事件池 ±1 匹配、通用事件奖励档、祭品掉落表（maxRarity/权重）、出征祭品门槛（对应稀有度）。出征界面选择器/说明栏全部自动读取，无需改 UI。

### 2. 地牢配置块（同文件，如 `zombieDungeonMid`）
- `nodeCount.min/max`：房间数
- `shortestCombatPath`：到达 Boss 的最少战斗场数
- `typeRatios.combat/event`：战斗/随机事件比例（合计 1；祭品耦合键 combatChanceDelta 会同步调整两边）
- `eliteCombatChance`：战斗事件中精英战斗概率
- `encounters.normal/elite`：波次、每波数量、monsterComposition/tierWeights（池见第 4 节）
- `grid.rows/startRows`：行数与起始路线（startRows 长度=起始路线数）
- `bossEncounter`（可选）：独立 Boss 遭遇。存在则 `_enterBoss` 自动走普通战斗流程副本（不再按地牢名硬编码分支）；`monsterComposition` 支持 `{ lord: N }`（lord 池=rank 领主，跨 family）；缺省走 BossRewardSystem 专属 Boss（集合体）
- `eliteChestReward`（可选）：精英宝箱奖励
- `floor`（可选）：`{ tiles: [贴图键...], glow: false, overlapX, overlapY }`——地砖**每格随机选图 + 随机 X/Y 镜像（4 种朝向）**，平铺层统一行为，无需声明（2026-07-25 确认：以后地砖默认都带随机翻转）；**自然材质（草地等）必配 overlapX/overlapY（如 6/3）**：平铺步进内缩让相邻砖叠合几 px（只叠不缺），盖住锯齿边缘缝隙与半透明暗边——亮色材质缝隙明显，黑砖类可不加

### 3. 登记映射（src/config/dungeon-config.js `_keyFor`）
地牢 type → 配置块键。**这是唯一的代码硬编码点**（工作流保留）。

### 4. 怪物池（src/world/zombie-dungeon.js `monsterPool`）
normal/elite/lord 三个 getter，按 family+rank 从 enemy-config.json 筛；新怪物需先注册 `ZOMBIE_FACTORY_MAP` + create 工厂。事件/奖励对应关系由 grade 驱动（见 dungeon-event-definitions.js RESTRICTED_EVENT_META 的 scope/grade）。

### 5. 验证
JSON 校验；lint / vite build / test-collider / test-craft-sync；`node scripts/generate-dungeons-table.mjs` 刷新 dungeons-table.md；CHANGELOG 记录。

## Buff/Debuff 添加标准工作流（新状态效果一律按此开展）

**内置机制：状态免疫（statusImmune，2026-07-25）**：`applyStatusImmune(duration)` 授予后，`addStatusEffect` 与全部 apply*（眩晕/恐惧/激励/中毒/流血/致残/束缚/双易伤）统一拦截其他任何 buff/debuff（免疫本身除外）；永久免疫传 `Number.MAX_SAFE_INTEGER`。范例：`mine-cave.js` 矿洞常驻免疫。

### 1. 注册显示配置（src/entities/damageable-entity.js `STATUS_CONFIG`）
`type: { icon, name, color }`——逻辑层 `statusEffects` 数组（{type, duration, remaining, stacks}）与 UI 显示共用。

### 2. 应用入口（基类方法，如 `applyFear(duration, source)`）
- `addStatusEffect(type, duration, { stacks })`：同类型**持续时间孰长刷新**（内置 Math.max）；`stacks` 显式传入用于叠层语义（层数逻辑在 apply 方法内计算）。
- 来源实体记录到 `this._<effect>Source`（需要参照点的效果，如恐惧逃离）。
- **左上角状态栏（玩家 UI）仅当 `this._faction === 'player'` 时调 `StatusBar.addEffect`**——怪物中的效果不进玩家状态栏。
- 浮动文字（EffectManager FloatingTextEffect）。

### 3. 行为生效点（三层各就位，缺一不可）
- **玩家**：`player/update.js` 状态分支（参照 stun/fear 模式：输入处理、强制行为、防御取消、`_updateSubsystems`、墙壁解析后 return）。
- **怪物移动**：`systems/movement-system.js` update 前段加分支（死亡/眩晕/束缚/施法/恐惧序列），返回前设 vx/vy + WallSystem.resolve——**MovementSystem 每帧重算 vx/vy，任何移动类效果必须在这里接管，不能只改实体自身 update**。
- **怪物行为中断**：`enemy.js` 基类 update 加 return（技能/攻击决策中断）；自定义怪物类（armored-knight/shounao/fly-swarm 等覆盖了基类 update 的）**各自补同款检查**——基类的检查到不了它们。

### 4. 数值语义
- 持续时间：ms；叠层：stacks 字段（上限在 apply 方法内 clamp）。
- 效果数值放配置（如 howl.fearMs），不硬编码在逻辑里。
- 辅助计算放基类方法（如 `getFearSpeedMul()`），玩家/怪物/系统共用。

### 5. 验证
lint / vite build / test-collider / test-craft-sync；实机验证：状态栏图标、持续时间刷新、叠层、到期消失、死亡/场景切换清理。

### 6. 宝箱岔路分支（zombie-dungeon.js `_addChestBranches`）
- **规则**：从中间列节点向上/下缘伸出链式支路（双向边可往返）；每条 2~3 节点；**有且只有一个战斗节点（首个，精英概率固定 50%）**；尽头固定宝箱事件（event + `node.eventType: 'treasureChest'`，复用节点事件类型记录机制）。
- **条数**：`chestBranches.count` 配置驱动；缺省按地牢 grade 自动计算（F=2、每级 +2，dungeon-config.js `getZombieDungeonConfig`）。
- **独立性**：岔路节点带 `isBranch` 标记，不参与全局精英率标记（`!node.isBranch` 排除）；岔路事件节点走正常事件池；宝箱节点经 node.eventType 强制为 treasureChest。

## 图层/背景随分辨率适配工作流（"cover 铺满 + bottom 锚定"）

适用：背景图、栏位面板、立绘等需要随分辨率自动调整且不产生黑边/漂移的图层。
- **cover 铺满**：`scale = max(viewW/imgW, viewH/imgH)`——图片始终覆盖视口，无黑边（超出部分裁切）。
- **bottom 锚定**：`y = viewH - imgH*scale`（图片底部贴视口底部）、`x = (viewW - imgW*scale)/2`（水平居中）——位置固定不随分辨率漂移，底部内容始终可见。
- **坐标区域**：用游戏内开发工具的坐标工具在目标分辨率（如 2560×1440）下实测 `left/bottom/width/height`，`bottom/left` 用固定像素，`width/height` 按视口比例等比适配。
- **禁用做法**：`window.innerWidth/Height` 动态居中（分辨率变化时位置漂移）、固定像素画布（高分屏大量黑边）。
- **拖动/缩放钳制区域必须与初始定位区域一致**（共用同一区域计算函数），否则能拖出定位区导致"看似没调整"。

## 阶段性进度总结（2026-08-03：火系高级魔法「陨星坠落」落地）

### 本次完成
1. **陨星坠落（meteor，火系高级魔法，需法杖）**：鼠标指向处落点 → 陨石直接加速坠落（坠落本身即预告，
   2026-08-03 调整：删除地面警示红圈）→
   大范围爆炸（半径 140+5L px，中心全额→边缘 50% 距离衰减）+ **眩晕 2s**（替换原击退）+ 叠 3 层灼伤 →
   留下熔岩区域（3~6s，每 0.5s 一跳灼烧伤害 + 叠 1 层灼伤；地面燃烧改为**火炬式**——
   参考障碍物火炬的连续发射器（impact_dot + 三色 ADD 上飘），每次施法随机散布 54 个（×3）、
   粒子放大 25%，铺满整个影响区域）。
2. **实现形态**：`MeteorSystem`（暴风雪同套门禁：法杖门槛/施法距离/MP 含链式减免/施法动画第 8 帧释放/
   链式强化/檀木加速/冷却）+ `MeteorStrike` 三阶段特效（坠落/爆炸/熔岩），
   熔岩 = 纯火炬火焰（无油面/反光地面）：随机散布燃烧发射器（椭圆内均匀随机 54 个 ×1.25 放大、自销毁），
   落地火花 `jitter=0` 精确对准落地点（粒子靠速度随机散射，不再整体平移）；
   新增**火焰椭圆边**（标准椭圆 + 5 层软光晕：宽淡外圈 → 窄亮焰心，无硬线条感；无呼吸/无绕圈），
   从落地点一个点**恒定 0.5s** 外扩到最大影响边缘，**扩散到后立即消失**（不再随熔岩持续）
   深度 y-998 位于火炬火焰（y-996）之下；**熔岩燃烧结束（自然到期）即销毁**
   （自然结束路径必须显式 destroy，否则残影泄漏）；复用 `fireGroundShockwave`、`burstParticles`、`Camera.triggerShake`。
3. **接线**：magic-categories（fire+meteor、tier 3）、skills.json 双份、player/index + subsystems 更新与死亡清理、
   quick-bar 触发与冷却同步、skill-manager 四分支（经验/网格/详情/经验说明）。
4. **图标（2026-08-03 二版重做）**：初版与火球同质（都是橙红火团）被否；二版强调**暗色岩石核心 +
   熔岩裂纹 + 长拖尾**（负面词排除 fireball/flame sphere），GLM-4.6V 验收"不是纯火球、是带岩石核心的流星"，
   角点背景抠图 + 去污染入库 1024×1024 透明底。

### 性能实测（熔岩 54 发射器，cdp-meteor-perf.mjs）
- 基线（无特效）：Phaser 场景帧 0.45ms / 逻辑帧 p50 0.8ms。
- 熔岩阶段：场景帧 0.74ms（**增量 +0.29ms/帧**，约 1.8% 帧预算）、逻辑帧无感知增量；
  54 个连续发射器 + ~460 并发粒子 + GPU 填充对 3080 Ti 均无压力 → **不会造成卡顿**。
- 低端机预案：发射器 54→27 且每点 2 粒（对象减半、视觉近似）即可再省一半。

### 陨星音效序列（素材库 技能音效/陨星 三件）
- 落地瞬间：`落地.mp3`（无论是否命中都播）；
- 落地后 0.2s：`燃烧1.mp3`；
- 落地后 2s 起：`燃烧2.mp3`，随后**每 0.7s 重叠循环**播放（不等上一条播完），熔岩结束即停。
- 实现：MeteorStrike 帧驱动计时（`_lavaElapsed`），随游戏暂停自然停；命中音效由特效层统一管理，
  不再走 skills.json `sounds.hit`（字段保留指向落地文件作文档）。

### 陨星数值（V1.1：MP 线性 100→150、爆炸眩晕 2s）
| 字段 | Lv1 | Lv5 | Lv10 | Lv15 | Lv20 |
|---|---|---|---|---|---|
| 冷却 | 32s | 32s | 31s | 30s | 28s |
| MP（线性） | 100 | 110 | 123 | 136 | 150 |
| 射程 | 650px | 650 | 650 | 650 | 650 |
| 爆炸半径 | 145px | 165 | 190 | 215 | 240 |
| 爆炸眩晕 | 2s | 2s | 2s | 2s | 2s |
| 熔岩半径 | 124px | 140 | 160 | 180 | 200 |
| 熔岩持续 | 3s | 3s | 4s | 5s | 6s |
| 爆炸·基础 | 132 | 180 | 240 | 300 | 360 |
| 爆炸·魔攻/智力系数 | 2.6 / 2.85 | 4.2 / 4.65 | 6.2 / 6.9 | 8.2 / 9.15 | 10.2 / 11.4 |
| 熔岩·每跳基础 | 11 | 23 | 38 | 53 | 68 |
| 熔岩·系数 | 0.28 | 0.40 | 0.55 | 0.70 | 0.85 |
| 灼伤层数（爆炸） | 3 | 3 | 3 | 3 | 3 |
| 震屏 | 14 | 14 | 14 | 14 | 14 |

### 沉淀约定（img2img 换系别主体的坑）
- **换系别主体不要用异系参考**：用暴风雪（冰蓝）图标做参考，无论 denoise 多高、是否中央遮罩 inpaint，
  主体都会被回染成蓝色晶体——"主体替换顽固" + "色调偏置"双重作祟；改用同系火球参考（fireball_icon）后一次通过。
  做同系列图标时，img2img 参考应从**同色调系**里选。
- **两段式确认**：先"高 denoise 换主体"，若底座/框架丢了再"中央遮罩 inpaint 补回"——比反过来（先保框架再换主体）
  更容易收敛，因为主体替换是主要难点。
- **地面燃烧铺满用"火炬式发射器"**：障碍物火炬是 `frequency` 连续发射器
  （speedY 上飘 −50~−110、tint [白,橙,黄]、ADD）。铺满影响区域用**椭圆内均匀随机散布**
  （`rr=sqrt(random)` + 角度，y 压缩 0.5 贴合透视）而非网格——每次施法散布都不同、无呆板感；
  数量/放大直接乘系数（如 54 个 ×1.25）。粒子按区域时长 `delayedCall` 自销毁，强制清理走 destroy。

## 阶段性进度总结（2026-08-03：火系初级 Buff 型技能「灼锋焰甲」落地）

### 本次完成
1. **灼锋焰甲（flameArmor，火系初级魔法，Buff 型新形态）**：施放给自己上 Buff（持续 12→30s，冷却 60s，MP 40→80 随级增长）：
   - 命中附伤：除魔法技能外的任何攻击命中附带魔法伤害 + 四散红色火花粒子；
   - 灼烧光环：每 0.5s 对半径 130+5L px 内敌方造成魔法伤害（同样迸发火花）；
   - 武器火焰（**2026-08-03 实机+GLM-4.6V 验收定稿**）：运行时读武器贴图像素定位剑身区间，火焰整段覆盖剑身
     （密集采样 + 三层光带）、排除剑柄/把手、左右对称、无漂浮；脚底火焰环旋转。
2. **实现形态**：`FlameArmorSystem`（MP 门禁含改造减免/冷却改造/状态效果 + StatusBar 图标/
   到期 `_onFlameArmorEnd` 钩子统一结算经验）+ `FlameArmorFx`（EffectManager 常驻特效）：
   武器火焰**运行时读武器贴图像素定位剑身区间**（长轴不透明宽度突变处=护手/柄起点，按纹理键缓存），
   仅沿剑身每 ~10px 密集采样（每点 2 粒）+ 沿剑身呼吸火焰光带（外橙红/内亮黄/焰心三层线）实现整段覆盖，
   排除剑柄/把手；脚底 footprint 外沿旋转火焰环（椭圆描边呼吸 + 沿环扫过高亮弧 + 6 火点公转火星，
   单发射器多点 explode 控制粒子量）。
   伤害挂钩零侵入：在 `DamagePipeline.applyHit` 加一行，凡物理攻击命中即附伤，魔法技能天然排除。
3. **接线**：skills.json 双份、magic-categories（fire+flameArmor、tier 1）、damageable-entity 状态注册与到期钩子、
   status-bar 配置、player/subsystems（更新/死亡清理/到期钩子）、quick-bar、skill-manager 五分支。
4. **图标**：直接使用用户素材库 `灼锋焰甲/1.png`（1024 透明底，六边形徽章+紫金+火焰剑盾），GLM-4.6V 验收通过，无需再生成。

### 沉淀约定（Buff 型技能模板）
- **挂伤害用 DamagePipeline 而非攻击代码**：近战/远程/冲刺/风车/推击等物理攻击全部汇聚在 `applyHit`，
  在其中按 `damageType !== 'magic'` 挂钩即可实现"除魔法技能外所有攻击附伤"，天然排除火球/陨星等魔法技能；
  逐攻击类去改必遗漏。
- **状态到期钩子**：玩家专有 buff 走 `addStatusEffect` + `updateStatusEffects` 的 `_onXxxEnd` 钩子
  （类型注册在 damageable-entity.js，方法定义在 subsystems mixin），到期统一结算经验与回收特效；
  死亡/场景切换走系统自己的 `clearBuff`（不结算经验，与暴风雪/陨星同口径）。
- **持续跟随特效**：Buff 类粒子特效做成 EffectManager 常驻 effect（active 标志 + update 内自检 buff 是否仍在，
  过期 destroy 自动回收），不要挂 GameScene 每帧显式清理；常驻火焰粒子 tint 以红/黄为主
  （纯白在 ADD 混合下盖掉色相，观感会"约等于纯白"）。
- **"附着在武器上"要读武器精灵/贴图，不要用玩家朝向估算**：武器姿态由 GameScene 的 weaponSprite 每帧
  （rotation + flipX + displayWidth/Height）决定；竖版贴图（剑/杖）剑身沿 local Y、尖端在贴图顶部，
  横版（枪械）沿 local X、视觉尖端方向 = flipX ? -1 : +1。剑柄/护手排除靠贴图像素分析
  （宽度突变阈值 55% 最大宽），全覆盖靠密集采样 + 沿剑身光带，粒子深度要高于武器（player.y+30）
  否则被剑身遮挡看起来"错位"。

### 灼锋焰甲数值（V1.1 定稿：持续 12→30s / 冷却 60s / MP 随级）
| 字段 | Lv1 | Lv5 | Lv10 | Lv15 | Lv20 |
|---|---|---|---|---|---|
| 冷却 | 60s | 60s | 60s | 60s | 60s |
| 持续 | 12s | 15s | 20s | 25s | 30s |
| 持续/冷却 | 20% | 25% | 33% | 42% | 50% |
| MP | 40 | 48 | 58 | 69 | 80 |
| 命中附伤基础 | 12.5 | 22.5 | 35 | 47.5 | 60 |
| 命中附伤 魔攻/智力系数 | 0.41 | 0.65 | 0.95 | 1.25 | 1.55 |
| 光环每跳基础 | 7 | 15 | 25 | 35 | 45 |
| 光环 魔攻/智力系数 | 0.15 | 0.27 | 0.42 | 0.57 | 0.72 |
| 光环半径 | 136px | 160px | 190px | 220px | 250px |
| 光环每跳间隔 | 0.5s | 0.5s | 0.5s | 0.5s | 0.5s |
| 经验：命中/击杀 | 1 / 8 | — | — | — | — |
| 经验：多命中/多击杀 | 5 / 10 | — | — | — | — |
| 升级经验公式 | 100+(L−1)×100（1→20 累计 21000） | | | | |
| 附伤/光环对枪械 | **生效**（投射物命中走 DamagePipeline，每发子弹命中附伤+火花） | | | | |

## 阶段性进度总结（2026-08-05：电系中高级技能 + 感电叠层机制落地）

### 本次完成
1. **电系专属状态「感电」（electrified，新 Buff/Debuff）**：每层使目标受到的电系伤害 +3%；**叠满 5 层自动触发「过载」**——眩晕 1.2s + 对周围 150px 每个敌方单位传导一次电击（`20 + matk×1.2 + int×1.2`）并清空全部层数。与冰系 chill→冻结平行，电系性格 = 伤害放大 + 连锁爆发。
   - 实现全流程：`damageable-entity.js` STATUS_CONFIG + `applyElectrified(stacks, duration, source)`（免疫拦截→叠层→满层过载→StatusBar→飘字）+ `_updateElectrified` 到期清空；`status-bar.js` 条目（desc 悬停）；伤害结算段新增 **`damageType='electric'` 子类型**（按魔法伤害口径结算 mdef/魔力易伤/法袍加成/暴击符文），并乘 `(1 + 0.03×层数)`；`docs/buff-reference.md` 登记。
2. **闪电（初级）调整**：不再造成击退（移除 `applyKnockback` 结算与面板行）；命中叠加 1 层感电（4s），融入电系叠层闭环。
3. **雷暴领域（stormDomain，电·中级，tier 2 需法杖）**：移动雷云跟身炮台——头顶雷云（`storm-cloud-fx.js` v2：参照暴风雪乌云——运行时柔边贴图 + **深蓝黑/靛蓝/电光蓝四层色块**云团 + 云内电弧锯齿 + 蓝色云雾/电花/坠落电弧粒子，深度恒为 1<<28；**不画云底圆环描边**）跟随自己，持续 10→13s（L1 起 10s），每 0.9s 对雷云范围内（220+8L px）最近敌人落雷：主目标全额 + 邻近传导（每 8 级 +1 目标、每跳衰减 30%）+ 250ms 打断眩晕 + 感电 1 层。CD 30s / MP 80→120。落雷数随持续增长（L1≈11 → L20≈14）。
4. **贯穿雷枪（thunderLance，电·高级，tier 3 需法杖）**：**长按快捷键蓄力**（input.js `_chargeKeyHeldCode` 长按检测 + quick-bar `thunderLanceKeyDown/KeyUp`，参照无人机长按模式；**按键松开安全网**：系统记录绑定键 `setHoldKey`（keydown 时 Input.keys 已含该键标记 `_holdKeyPressed`），update 每帧检测键已松开但 release 未被调用（首次进入绑定未就绪走 useSlot 等路径）→ 自动 release，杜绝蓄力到满；鼠标点击二段式不启用安全网。施法姿势释放帧定格且不可移动——`startPlayerCast` 新增 `holdAtRelease`，`resumePlayerCastHold` 收尾回 idle；**蓄力期间瞄准随鼠标实时变化**，最终释放方向以松开/满蓄时鼠标为准，鼠标转到背后时翻转玩家贴图朝向（flipX）；**伤害随蓄力比例**：蓄力 0.5~2.5s → 20%~100%（满蓄 ×chargeBonusMul 1.3），**不足 0.5s 释放失败：不进入冷却（清 CD）+ 返还 MP**；**手部蓄力汇聚光球** `charge-orb-fx.js`：粒子向手握点汇聚 + 光球随进度放大，成功爆散/取消淡出；**手部锚点 = 施法武器握把（weaponSprite，法杖中段=前伸手，CDP 实机确认暂停帧手位）优先 + 手层内容质心回退**，每帧取（不锁定，翻转朝向时跟随镜像）；眩晕/冻结/死亡自动取消；目标地点无提示特效）→ 沿鼠标方向射出**电磁炮直线光束**（`spawnRailgunBeam`：白蓝三层辉光直线 + 4 个加速环从后往前扫过 + **附着电流=色块圆点链**（见特效沉淀⑨），非蛇形闪电；widthScale 4.0，残留 373ms）——**锥形判定贯穿路径上所有敌人**（视线可达、按距离排序），命中目标**沿光束方向击退 50→150px 随等级**，**感电层数越高伤害越高（每层 +10%）**，命中叠 2 层感电；射程尽头/撞墙处电爆（冲击波+放射线+粒子，无天顶光柱/无感电地面蓝圈）。CD 32→28s / MP 120→155，射程 915→1200px（随等级）。
   - **2026-08-05 特效沉淀**：① `LightningBoltEffect` 新增 `uniform` 等宽模式（关闭施法端粗→目标端细，半径恒定 + 整体偏细）——感电过载电弧已切细等宽（`widthScale: 0.45`）；② 雷暴领域云删除云底蓝色椭圆描边，只保留云团/电弧/粒子；③ 天顶闪电光柱抽为共享件 **`spawnLightningColumn`（combat-fx.js ⑧）**——白蓝梯形闪电柱一闪而逝（贯穿雷枪已不再使用：施法者/终点光柱均取消）；④ 电磁炮直线光束抽为共享件 **`spawnRailgunBeam`（combat-fx.js ⑨）**——笔直三层辉光直线 + 4 加速环，widthScale 4.0；⑤ **蓄力定格模板**：`startPlayerCast({ holdAtRelease })` 第 releaseFrame 帧触发 onRelease 后**先完成前摇跨步站稳（+30px）**，再冻结动画（timeScale 0）保持 casting 输入锁定，`resumePlayerCastHold()` 恢复播完前摇→倒放后摇回 idle，取消走 `cancelPlayerCast`；⑥ **蓄力汇聚光球模板**：`ChargeOrbFx`（charge-orb-fx.js）——锚点取施法武器握把/手层质心（见正文），粒子从手周围椭圆环四面八方生成、寿命=到达时间（视觉"收进"光球），`finish()` 爆散 / `cancel()` 淡出；⑦ **电流去线条化模板（光柱附着电流）**：参考 `LightningBoltEffect` 的"色块圆点链"避免线条感——沿光柱**平行方向**生成短折线，重采样成小圆点色块链（辉光 ADD + 白芯），**首尾用 sin 权重不规则淡出**（两端熄灭、中间亮，每点叠加随机断续），半径随光柱弱缩放（√widthScale），90ms 分段伪随机跳变闪烁——任何"光束/电流"类特效都按此做，禁止纯线条 stroke。
   - **2026-08-05 重设计说明**：原「雷神审判」为定点蓄力连环 AOE，与暴风雪（定点持续）/陨星（定点爆发）设计重叠，已整体替换为「贯穿雷枪」（蓄力贯穿型，追踪/直线操作）；旧组件 thunder-judgment-system.js 与图标 雷神审判.png 已删除。
5. **接线**：skills.json 双份（25 技能）、magic-categories（electric 三技能 + tier 2/3）、玩家四件套（index.js 导入/字段/实例化，subsystems.js update + 死亡复位 `clearCloud`/`clearStorm` + `_initSkills` 兜底）、quick-bar（触发分支 + 冷却同步 + `_getTotalCooldown` 名单）、skill-manager（三处 skillList + effectText + 经验函数 + 详情面板 + 经验说明）。
6. **图标（2026-08-05 LoRA + 不规则切割 + HSV 明度柔光定稿）**：`assets/skills/雷暴领域.png` / `贯穿雷枪.png`
   提示词：**irregular low-poly faceted surface with facets of uneven sizes and shapes, not a uniform
   grid + soft diffuse glossy sheen + no harsh contrast + translucent like crystal glass**，
   12 步重出（雷暴 seed 111111 / 雷枪 seed 151515，不规则切割 + 水晶通透 + 深紫高饱和）。
   **反光后处理必须用 HSV 只压明度（V）对比、完整保留色相（H）/饱和度（S）**——第一版 RGB 向中值压缩
   导致饱和度下降、蒙雾感（用户反馈"色彩失真蒙雾"）；HSV 版 S 中值完全保留（雷暴 158 / 雷枪 135），
   V 标准差 -41%（雷暴 43.8→25.7、雷枪 46.8→27.7），GLM 复验
   **柔和漫反射 + 饱和纯正无蒙雾 + 不规则切割 + 水晶通透全项通过**。归一后同系列规格
   （雷暴 786×932 / 0.84 / fill 69.9% / cy+28，aspect 与 fireball 一致；贯穿 800×918 / 0.87 / 70.0% / cy+28），
   废案与 .bak 已清。
   - **教训沉淀**：技能图标正式出图必须走 `flux2-klein-4b` + klein-skillicon-v2 LoRA（触发词开头）；
     **steps ≥12**；切割写 irregular / uneven sizes / not a uniform grid；Klein+LoRA 对"不规则切割"
     稳定绑定强对比高光（提示词/cfg/步数压不住）→ 入库前做**HSV 明度柔化**：`convert('HSV')` 后
     只把紫面（b>r>g）的 V 向中值压缩（strength≈0.55，-40% 明度差），H/S 不动——
     **禁止 RGB 向中值压缩**（会掉饱和出雾感）；主体写 translucent like crystal glass；
     电系主题不写 dark/gray 云；归一后复核 aspect >5% 换 seed；多 seed 抽选 + GLM 逐项验收。
### 沉淀约定（电系叠层模板）
- **感电消费点 = takeDamage 伤害结算段**：新增 `damageType='electric'` 与 magic 同口径结算（mdef/魔力易伤/法袍秘法/暴击符文都认），再乘感电系数——不要在各技能系统里手乘，避免遗漏。
- **叠层转质变阈值 5 层**：`applyElectrified` 内部达到即触发过载并清空（重复施放可再次叠层），与 chill 20→冻结同模式；数值走参数不硬编码（stacks/duration 由 skills.json effectFormula 传入）。
- **移动雷云形态**：跟身持续类技能 = 系统组件自管计时 + EffectManager 常驻特效（`StormCloudFx`，active 自检 buff 是否仍在），死亡/场景切换走 `clearCloud` 不结算经验（与灼锋焰甲同口径）。
- **蓄力连环形态**：`createGroundWarning` 保活续命（每帧 `keepWarningAlive`），结束时必须 `destroyWarning` 显式销毁；阶段状态机放系统 `update(dt)` 里推进（warning → storming → final → end）。
- **优先目标**：落雷优先感电层数最高者（并列取最近），让「先叠层再引爆」的连招有明确收益。
- **fallback 收敛 + 怪物复用（2026-08-05 收尾沉淀）**：① 所有魔法系统数值缺省统一收敛到顶部
  `XXX_DEFAULTS` + `{ ...DEFAULTS, ...baseEffect }` 合并，skills.json 为唯一真源，禁止业务代码散落
  `|| 默认值`（详见「技能添加标准工作流」§2）；② 贯穿雷枪瞄准参数化 `trigger(optAimX, optAimY)`——
  玩家=鼠标、怪物=面向方向（缺省自身前方 100px）；③ 怪物也生成蓄力光球，锚点暂用
  `_defaultChargeAnchor()`（身体中线上方）占位，怪物绑定点做好后替换该锚点即可。
### 电系数值（V1.1 定稿：2026-08-05 精调——雷暴领域持续/传导成长、贯穿雷枪蓄力收益上调）
| 雷暴领域 | Lv1 | Lv5 | Lv10 | Lv15 | Lv20 |
|---|---|---|---|---|---|
| 冷却 / MP | 30s / 80 | 30 / 88 | 30 / 99 | 30 / 109 | 30 / 120 |
| 持续 | 10s | 10s | 11s | 12s | 13s |
| 雷云半径 | 228px | 260 | 300 | 340 | 380 |
| 每雷·基础 / 魔攻系数 | 29 / 0.50 | 45 / 0.70 | 65 / 0.95 | 85 / 1.20 | 105 / 1.45 |
| 传导目标（额外） | 1 | 1 | 2 | 2 | 3 |

| 贯穿雷枪（电磁炮） | Lv1 | Lv5 | Lv10 | Lv15 | Lv20 |
|---|---|---|---|---|---|
| 冷却 / MP | 32s / 120 | 32 / 127 | 31 / 136 | 30 / 145 | 28 / 155 |
| 蓄力 | 2.5s（贯穿伤害 ×1.3） | 2.5s | 2.5s | 2.5s | 2.5s |
| 贯穿射程 | 915px | 975 | 1050 | 1125 | 1200 |
| 贯穿·基础 | 124 | 180 | 250 | 320 | 390 |
| 贯穿·魔攻/智力系数 | 2.06 / 2.30 | 3.1 / 3.5 | 4.4 / 5.0 | 5.7 / 6.5 | 7.0 / 8.0 |
| 感电增伤 | 每层 +10% | 每层 +10% | 每层 +10% | 每层 +10% | 每层 +10% |
