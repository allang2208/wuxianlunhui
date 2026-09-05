# 生图标准工作流（2026-08-04 定稿，二轮更新）

> 本文维护生成后端、默认参数和操作命令；任务阶段见 [任务工作流](../../skill/00-workflows.md)，角色规格见16，动画几何/时钟见16b。提示词从 `prompts/` 对应模板起步，只补任务特有约束；用户明确指定优先。文内测试命令不构成测试授权。
>
> **提示词最小化（2026-08-27）**：固化公共模板只注入一次，单个资产只补充模板没有覆盖的新信息。相同主体、结构、材质、视角或禁止项不得用同义词跨多个块反复堆叠；Depth、参考图或遮罩已经提供的控制不再长篇复述。提交前删除所有不增加新约束的句子，并与同类已接受提示词比较；明显更长或重复时必须先压缩。提示词越长不代表控制越强，优先级稀释和风格漂移属于提示词失格。
>
> **入口优先级（2026-08-04 二轮调整）**：双机 ComfyUI 自建生图系统（远程 5080 主力 +
> 本机 3080 Ti 兜底）→ **本地零成本**；智谱 API 降级为第三兜底（双机都不可用/特殊场景）；
> ithinkai 中转站 gpt-image-2 为云端第四途径（按 token 计费、无水印）。

## 0. 工作根目录约定

- 本文档位于 `game-dev/tools/ai-gen/`（随仓库版本化）；命令相对 **game-dev/ 仓库根目录**执行：
  `E:\无尽轮回\长期备份\2026-7-13-1\game-dev`
- `game-dev/tools/ai-gen/` = 生图/抠图/校验工具（ComfyUI 多模型客户端、models.json、BiRefNet 等）；
  `game-dev/tools/` 根 = 游戏侧工具（sprite-normalizer、cdp-* 实机验证等），勿与生图工具混用；
  一次性批量脚本（gen-blizzard-icon-v5.py、zhipu-gen-necklaces.py 等）已归档
  `tools/ai-gen/archive/one-off/`，勿当通用工具使用
- 所有生图脚本以 `python tools/ai-gen/xxx.py ...` 调用；ComfyUI 启动脚本见下表。

## 1. 生成入口矩阵（先选入口，再选模型）

| 场景 | 入口 | 命令 |
|---|---|---|
| **远程主力机（默认）** | 远程 5080 | `python tools/ai-gen/comfyui-gen.py --host 192.168.3.142 --model flux2-dev-fp8 --prompt "..." --out out.png` |
| 远程·固定视角/方向/结构 | 远程 5080 + Depth ControlNet | `python tools/ai-gen/comfyui-gen.py --host 192.168.3.142 --model flux2-dev-depth --control-image depth.png --prompt "..." --out out.png` |
| 本地兜底 | 本机 3080 Ti | `python tools/ai-gen/comfyui-gen.py --host 127.0.0.1 --model sdxl --prompt "..." --out out.png` |
| **地面无缝纹理（泥/沙）** | floor-asset.py（comfyui-gen → make-seamless → desaturate） | `python tools/ai-gen/floor-asset.py mud --out assets/terrain/floor_mud_seamless.png --seed 9001` |
| 透明主体素材 | 远程 5080（SDXL 兜底） | `python tools/ai-gen/comfyui-gen.py --host 192.168.3.142 --model flux2-dev-depth --control-image depth.png --transparent --prompt "..." --out out.png`（AI 选纯色底 + 自动抠图，见 §3.7） |
| 兜底·智谱 API | 智谱 | `python tools/ai-gen/zhipu-gen.py --prompt-file prompt.txt --model glm-image --size 1280x1280 --out ...`（双机不可用/免费额度场景） |
| 兜底·ithinkai 中转站 | gpt-image-2 | `python tools/ai-gen/gptimage2-gen.py --prompt "..." --out out.png`（OpenAI 格式 API，按 token 计费、无水印；key 不落仓库，见下注） |
| 同系列模板锁定重抽 | img2img | `python tools/ai-gen/gen-meteor-icon-template.py`（换参考图 + 提示词即可复用） |
| 批量多图 | 智谱/ComfyUI | 参考 `tools/ai-gen/archive/one-off/` 下归档的一次性批量脚本（如 zhipu-gen-necklaces.py 多 prompt 逐张下载、gen-eclipse-set.py 批量入队轮询），仅作写法参考 |

- 模型登记表：`tools/ai-gen/models.json`（`python tools/ai-gen/comfyui-gen.py --list-models` 查看）。
  当前统一默认：自由FLUX生图=`flux2-dev-fp8`，固定视角/结构=`flux2-dev-depth`；建筑工作流和其他FLUX生图入口一律按这两个Dev配置路由。Klein、Klein专用LoRA和Mesh只保留为历史复现或人工明确指定的对照入口，不得由通用工作流自动选择。
  视频模型（MiniMax H3）不走 models.json——`tools/ai-gen/minimax-h3-gen.py` 独立硬编码工作流。
- **`--negative` 仅对 SDXL（checkpoint）生效**：flux2/klein/mesh 的 BasicGuider 只接 positive，
  传负面词会打印"不支持负面词已忽略"警告并丢弃——负面约束（watermark/blurry 等）必须写进正向提示词。
- **5080 已装模型（2026-08-04 实机核对）**：diffusion `flux2_dev_fp8mixed.safetensors`、
  文本编码器 `mistral_3_small_flux2_fp4_mixed.safetensors`、VAE `flux2-vae.safetensors`、
  ControlNet `FLUX.2-dev-Fun-Controlnet-Union.safetensors`（Depth/Canny/Pose 等单文件多模式）。
- 智谱 API 注意事项：**不支持负面词参数**（避项写进正向提示词）；出图固定带右下角
  "AI生成"水印（`tools/ai-gen/zhipu-process.py` 按连通域+面积过滤去水印，见 §4.5）。
- ithinkai 中转站注意事项（2026-08-21 实测）：Base URL `https://token.ithinkai.cn/v1`，
  模型广场当前仅 `gpt-image-2`；按 token 计费（单张约 400 tokens）；key 走环境变量
  `ITHINKAI_API_KEY` 或 `%USERPROFILE%\.ithinkai\config.json`；返回图片 URL（webstatic
  CDN，可能有时效），脚本收到后立即下载落盘（不传 --out 默认落
  `Y:\工作\无尽轮回\scratch\gptimage2_<时间戳>.png`，与 comfyui-gen 同约定）；**CDN 拒绝 urllib 默认 UA**（脚本已伪装
  浏览器）；curl 直传中文 prompt 会乱码错图，脚本 UTF-8 提交中文正常，仍建议英文提示词。
- 远程 5080 开机方式：`tools/ai-gen/start-comfyui-remote.bat`（`--listen 0.0.0.0`，防火墙放行
  8188/专用网络；**机器休眠会断服务，需关休眠**）。本地启动 `start-comfyui.bat`
  （位于备份根目录 `E:\无尽轮回\长期备份\2026-7-13-1\`，不在 game-dev 仓库内）。

### 1.5 FLUX.2 Dev + Depth ControlNet（固定视角/方向/结构，默认）

**能力**：FLUX.2 Dev配合`FLUX.2-dev-Fun-Controlnet-Union`（Depth/Canny/HED/Pose单文件多模式ControlNet）用深度图锁定构图、视角、方向和主体结构。固定视角、方向和建筑结构时默认主模型为Dev Depth。

**命令**（`--model flux2-dev-depth` + `--control-image` 必传）：

```bash
python tools/ai-gen/comfyui-gen.py --host 192.168.3.142 --model flux2-dev-depth \
  --control-image tools/ai-gen/_depth_templates/depth_box.png \
  --prompt "a magic skill icon, purple hexagonal badge with gold trim, embossed crystal base, centered on white background, high detail" \
  --out Y:\工作\无尽轮回\scratch\badge_v2.png
```

**深度图来源（按优先级）**：
1. 同系列已定稿图标 → DepthAnything V2 / MiDaS 提取深度图（锁住同视角构图，主体换新）；
2. 手绘剪影/白模/占位图（摆好视角与位置）→ 深度图 → 主体由模型重绘；
3. 目标视角的真实照片/3D 渲染图 → 深度图（等距/侧视等）。
- 深度图预处理建议装 `comfyui_controlnet_aux`（DepthAnything V2/MiDaS）到 5080 或本机，
  在工作流内一条龙；未装时先在外部生成深度图 PNG，再经 `--control-image` 传入。

**3D 白模深度图（`blender-depth-render.py`，2026-08-05 新增）**：上面来源 2 的"白模"路线
已有 Blender 管线，比手绘剪影模板（`make-depth-templates.py`）几何/朝向更精确，适合
防御塔、掩体这类有明确结构关系的资产；手绘模板仍适合快速试探构图。

> **类目路由（2026-08-05 定稿）**：**中大型物件**（建筑/道具/植被/家具）默认从白模
> 深度起步——视角/朝向/比例/遮挡是主要矛盾，白模一次锁死（枯树主枝朝向、防御塔 45°
> 等距均已实测根治）；**小型装备/图标**（细节即本体，白模提供不了信息）不走白模，
> 直接按 prompts/ 统一提示词模板 + 标准生图（模板锁定 img2img / Klein LoRA）。
> 白模只管大形，细节交给扩散模型 + 提示词，不要在白模里堆细结构。
```bash
"E:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background --factory-startup \
  --python tools/ai-gen/blender-depth-render.py -- spec.json out.png [--mirror]
```
- spec 示例：`tools/ai-gen/_blockout_specs/defense_tower.json`（基座+探出机械臂）、
  `cover_wall.json`（低矮宽扁墙段）；图元 box/cylinder/cone/sphere，字段与单位语义见
  脚本 docstring（x=右、y=纵深远离相机为正、z=上，pos=图元中心）。
- 输出与手绘模板同约定：1024² 灰度、黑=远/背景、白=近、居中、底边 y≈880、正面视角；
  相机俯仰默认 30°（spec 顶层 `elevation` 覆盖，billboard 资产建议 ≤12°），`--mirror`
  出 `_v` 水平镜像。成品示例 `_depth_templates/blender_defense_tower_h.png` 等。

**参数**：
- 通用 `flux2-dev-depth` 配置读取 `models.json`：24步、CFG 3.5、Euler/simple、ControlNet强度0.75；资产专用入口可由正式manifest覆盖。
- World-122正式建筑不采用本节通用步数：必须走§1.5.1的12步结构粗筛/48步低重绘精修及对应Depth 0.78/0.75合同。
- FLUX.2 支持 **JSON 结构化提示词**（BFL 官方）：`camera: {angle, lens, distance,
  depth_of_field}` 块可额外固定视角/镜头（docs.bfl.ai JSON Structured Prompting），
  与深度图双保险。

**环境依赖（已修复 2026-08-04）**：远程 5080 的 `comfyui-flux2fun-controlnet`（v1.1.0）
两处兼容补丁（`timestep_zero_index` / `multigpu_clones`）与 comfyui-mesh Icarus stub 补丁
均已部署并重启（备份 + 修复版在 `tools/ai-gen/remote-patch/`），`flux2-dev-fp8` / `flux2-dev-depth` /
`flux2-dev-mesh` 全部可用。

### 1.5.1 World-122 建筑两阶段工作流（结构粗筛 → 细节精修）

建筑不再用一次 48 步同时赌结构和细节。正式候选只有一个执行入口：
`generate-world122-building-candidates.py`。该入口固定读取
`prompts/world122-building-style.md`（`world122-building-v5`）作为12步和48步共享的不可变画风块；
单栋建筑只在 manifest 中描述结构、功能细节和局部配色，不能覆盖共同的材质尺度、光照、边缘处理或渲染语言。
禁止为正式建筑直接手写 `comfyui-gen.py` 命令；通用客户端只作为该入口的内部后端或明确标记的实验工具。
生成脚本会同时校验版本号与模板路径：正式候选只接受 `world122-building-v5` 与
`prompts/world122-building-style.md`。旧 `world122-building-v1/v2/v4`、天气塔实验用
`world122-building-runtime-settlement-v2` 仅允许作为旧候选元数据中的历史版本标记；旧模板文件和任何建筑私有画风模板不能继续提交正式候选。
V5 统一简洁低饱和的游戏向PBR、连续大材质面、稀疏中尺度磨损和柔和左上顶侧光，不强制半木石、哥特、现代、工业或未来建筑语法；主体语法、层数、轮廓和组件位置完全服从白模与资产级 manifest。公共合同不再同时描述所有地台子类，生成时只注入当前资产实际选择的 `foundationStyle`。

**建筑提示词精简门禁**：公共 `world122-building-v5` 必须完整且只注入一次；`primaryRequest` 用一句话说明建筑身份，`structureRequest` 只列白模中需要计数或防误解的独有体块，`detailRequest` 只写48步需要增强的表面差异，`negativeRequest` 只补公共/类别合同尚未覆盖的高风险误生成项。一个事实只能出现在最合适的一个块中，禁止把“无塔、对称、低饱和”等要求在阶段合同、类别合同和资产合同中逐层改写重复；正向提示不得堆砌希望排除的建筑名词，优先写目标拓扑。生成前逐句检查：不能说明其新增了哪条控制的句子必须删除；生成后的总提示词若明显长于同类已接受版本，或同一关键词组跨多个块重复，停止提交并先压缩。12步 raw 若仍出现高饱和、亮金描边、密集微噪点、霓虹/泛光或不符合公共PBR语言的强风格漂移，整张淘汰，不得用48步补救。

标准流程拆成两段，并始终保持主体逻辑占格与运行时道路铺地分离；已建模的视觉地台属于主体贴图，不改变碰撞、寻路或 `visualFootprint`：

1. **结构粗筛（12 步，默认每批 3 张）**：Blender 白模深度图锁定体块、视角和年代化地台；由同一深度图派生边缘图，用于检查屋脊、塔楼接缝和遮挡边界。多层建筑必须把每层承重壳拆成可计数对象，在白模中锁死层数、逐层宽深和上下对齐；若设计要求三层对接，就不允许一层缩进或上层漂移。敞开的门扇、暖暗门洞、无文字功能招牌和视觉地台属于轮廓/识别结构，必须建模并进入 Body Depth，不能只写进提示词。远端插件确认支持 Hook 链后可加 `--edge-control` 启用第二路 ControlNet；当前默认只提交深度控制，避免旧版 `HooksContainer` 链式报错。提示词只描述白模已经表达的主体和结构边界；只有用户明确要求或已标记实验时才用 `--variants` 覆盖默认数量。
2. **人工选结构**：只看视角、底边、主体居中、明确的楼层数量/对齐、塔楼数量、敞门/招牌位置、屋顶连续性和墙体是否完整。优先选择带纯绿背景的 `_raw.png` 作为精修初始图；透明 PNG 必须先压回纯绿底，避免透明区在 ComfyUI 中变黑。
3. **细节精修（48 步，默认每批 2 张，低重绘）**：选中的结构图作为 `--init-image`，默认 denoise=0.30，并继续使用同一深度控制和同一 `foundationStyle`。远端插件兼容时可额外启用边缘控制。提示词只增强白模已经锁定的表面与功能细节，不准改变主体轮廓、楼层、塔楼数量、组件位置、地台边界或接地线。
4. **局部返修**：仅在结构已合格、局部仍有洞口或错误组件时使用 mask；白色区域重绘，黑色区域保留。局部返修属于显式非标准实验，不替代结构粗筛，也不能晋级为新的全图画风入口。

研究院结构粗筛：

```bash
python tools/ai-gen/generate-world122-building-candidates.py \
  --stage structure --only research_institute \
  --out Y:/工作/无尽轮回/scratch/world122-buildings
```

选择一张结构合格的纯绿底原图后进行 48 步精修：

```bash
python tools/ai-gen/generate-world122-building-candidates.py \
  --stage refine --only research_institute \
  --init-image Y:/工作/无尽轮回/scratch/world122-buildings/research_institute/research_institute_structure_v03_raw.png \
  --out Y:/工作/无尽轮回/scratch/world122-buildings
```

通用客户端支持重复 ControlNet、img2img 和局部 mask，但下列命令只用于已经通过结构与画风验收后的局部修复，不得替代正式建筑候选入口：

```bash
python tools/ai-gen/comfyui-gen.py --host 192.168.3.142 --model flux2-dev-depth \
  --control-image depth.png --control-image edge.png \
  --control-strength 0.75 --control-strength 0.38 \
  --init-image selected-green.png --mask-image local-fix-mask.png --denoise 0.40 \
  --prompt-file refine-prompt.txt --out refined.png
```

默认参数在 `world122-building-candidate-manifest.json`：`flux2-dev-depth`、1024²、CFG 3.5、Euler/simple；结构阶段 12 步/3 张、Depth 0.78；精修阶段 48 步/2 张、denoise 0.30、Depth 0.75；边缘约束登记为0.38但默认关闭。公共画风合同为 `world122-building-v5`：以简洁低饱和游戏向PBR为主，大块连续材质面先于纹理，只允许稀疏中尺度磨损，并采用柔和顶侧光；实际石质或混凝土地台只由当前资产的 `foundationStyle` 注入。脚本会把画风版本、模板、模型、`foundationStyle`和全部生成参数写入每张 raw 对应的 `_generation.json`。改变步数或 denoise 必须显式增加 `--allow-nonstandard`，并会在元数据中留下非标准记录；非标准实验不得和正式候选混放或直接入库。结构不完整时先改白模体块，不能靠提高精修步数修复缺墙、断塔或错误屋顶。

消耗资源后开启全位面增效的功能建筑，入库不仅是贴图替换：业务状态机必须保存物流阶段、当前位置、目标仓库、携带资源、服务剩余时间和批次数，派生道路路线只在运行时重算；增效只能进入明确白名单的最终产出乘算，市场压力、价格、输入成本、处理速度和概率系统默认排除。前台与后台位面必须使用同一模块数值、同一批次消耗和同一服务有效时长口径，后台按实际生效时长加权且不得改变输入批次数。

1×1 的自然结构仍使用满画布 Blender Body Depth 和同一标准生成参数，以保留足够结构细节；在 manifest 中登记 `assetClass: "natural_structure"`、`footprintCells: 1`、`generationFootprintCells: 2`，候选后处理才围绕接地点等比缩放 0.5，并以单格菱形预览。结构验收始终查看纯绿底 raw：额外洞口、门窗、塔楼或房屋即淘汰，不能依赖 Depth 遮罩把错误藏掉。

洞内暗部、晶体或光效与绿幕色系重叠时，生成仍使用锁定的 `Body Depth`，最终裁切通过 `postprocessDepthImage` 使用不含地台、但含洞内建模件的 Cutout Depth。抠图保留隐藏 RGB，只恢复 Cutout/Body Depth 差集，并清理恢复区外的绿主导像素；细轨、细杆允许在 anchor 与 mask 两步使用同一 `maskEdgePad` 抵消扩散图与白模的轻微轮廓偏差。不得把整张 Cutout Depth 强制恢复为不透明。

**地台强制路由**：新建或重做的中型功能建筑必须在 Blender 阶段把完整低矮地台作为主体结构的一部分，并纳入 preview、Body Depth、12步和48步；地台必须完全收在建筑的2×2/3×3或资产已登记的可视占格内，外缘统一斜切以适配等距网格，同规格资产可无缝组合。非现代建筑统一使用“2.5D等距游戏资产毛石地台 / 中世纪题材不规则毛石干垒基底”：不规则毛石切型、随机磨损与倒角、天然填缝、风化毛石手工拼贴做旧，和主体规整石材形成层次。现代建筑统一使用“2.5D等距游戏资产清水混凝土地台”：现代城市型保留模板拼缝、细微气孔、平整收光、轻微雨蚀和局部返碱；工业/末世型增加边角磕碰、浅裂、浮尘污渍；近未来型使用预制拼缝、克制金属包边、预埋管线槽和非镜面的轻抛光。候选后处理默认保留已建模地台，不再自动执行伪地台删除；仅自然结构、贴地矿床、便携道具、开放牧场复合物等显式`foundationStyle:none`的非建筑例外禁止生成地台。该地台仍是纯视觉主体的一部分，不改变逻辑占格、碰撞、寻路或`visualFootprint`。

### 1.6 模型选择矩阵（内容 → 首选模型 → 规则，2026-08-27 定稿）

**决策总纲**：凡使用 FLUX，默认主模型统一为FLUX.2 Dev。自由构图使用
`flux2-dev-fp8`；固定视角、方向或结构使用 `flux2-dev-depth`。Klein、Klein专用LoRA和Mesh
不参与自动路由，仅保留为人工明确指定的历史复现或对照实验选项。非FLUX兜底仍为
SDXL / 智谱；视频仍使用MiniMax H3。

| 内容/项目 | 首选模型 | 备选 | 规则与参数 |
|---|---|---|---|
| 技能图标·正式入库（六边形徽章系列） | FLUX.2 Dev（模板锁定 img2img） | 智谱 glm-image | 同色调系参考；内容框对标 fireball 基准；抠图 1024² 入库 |
| 技能图标·候选/批量探索 | FLUX.2 Dev | 智谱 glm-image | 同一模型完成探索与精修，靠参考图、denoise、步数区分阶段 |
| 装备/首饰图标 | FLUX.2 Dev | SDXL（风格已调流程可保留） | style_prefix 单件强制语法；1536² 归一化 + verify-eclipse-icons 复核 |
| 障碍物/道具（同视角块） | FLUX.2 Dev + Depth ControlNet | FLUX.2 Dev无控制 | 深度图锁视角（§1.5）；同一视角块统一提示词；prep-obstacle 抠图 |
| 怪物/角色贴图 | FLUX.2 Dev | — | 统一基准图 + 同色调系 img2img；sprite-normalizer 规格校验；动作帧走 img2video |
| 投射物贴图 | FLUX.2 Dev（img2img参考既有） | — | 抠图入库；**纯色小物件（雪球等）禁止 AI**，运行时 createCanvas |
| 透明主体 PNG（图标/装备/怪物/道具） | FLUX.2 Dev + `--transparent` | SDXL | AI 选纯色底 + 阈值抠图 + BiRefNet；**白主体禁白底**（§3.7） |
| 背景/场景大图 | FLUX.2 Dev（按目标尺寸与步数生成） | — | 大图提高尺寸与步数；候选仍使用同一默认主模型 |
| 视频/动画 | MiniMax H3（唯一） | — | `tools/ai-gen/minimax-h3-gen.py`；MP4 入 assets/videos 或抽帧转 sprite sheet |
| 兜底链（双机不可用） | 智谱 API glm-image | — | 不支持负面词（写进正向）；去水印走 zhipu-process.py |

**显式旧模型规则**：Klein、Klein Depth、Klein专用LoRA或Mesh只在调用者明确写出相应
`--model`时运行，不得因“正式入库”“高质量”“批量”“Daedalus在线”等条件自动切换。
锁视角的默认回退始终是`flux2-dev-depth`，自由构图的默认回退始终是`flux2-dev-fp8`。

**机器分布规则**：5080主力运行Dev / Dev Depth / MiniMax；本机单卡兜底为SDXL；
智谱 API 为第三兜底。Daedalus 仅服务人工指定的旧 Mesh 对照实验。

## 2. 六步标准流程（所有资产通用）

### 第 1 步：定风格

- 先看项目现有同类素材，锁定**系列基准**：风格块 + 内容框（bbox）宽/高、宽高比、占比、中心偏移。
- 用 `python tools/ai-gen/check-icon-sizes.py` 量化现有同系列图，记录基准后再生成。
- 已固化的系列基准（新同类必须对齐，偏差 >5% 重抽或归一）：

| 系列 | 基准 | 基准来源 |
|---|---|---|
| 魔法技能图标（六边形徽章） | fireball：bbox 788×939 / 宽高比 0.84 / 占比 ~70% / cy≈+29（偏下） | 陨星坠落实战 |
| 装备/首饰图标 | 最长边占画布 0.90、纵横比 ∈[0.72,1.4]、包围盒居中 | 装备/道具图标统一处理工作流 |
| 玩家/怪物精灵 | 内容高 477px、脚底基线 y=492（512×516 画布） | 玩家角色动画标准工作流 |

### 第 2 步：生成

- 提示词从 `prompts/` 库取用：主题块 + 材质细节块 + 视角块 + 风格基准块 + 负面词块（拼接顺序固定）。
- **固定视角/方向（默认路径）**：FLUX.2 Dev + Depth ControlNet（`flux2-dev-depth`，
  深度图经 `--control-image` 传入），同系列直接复用已定稿图的深度；视角/方向由深度图锁定，
  提示词不用反复强调视角。
- **旧模型对照（仅显式指定）**：Klein / Klein Depth / Mesh 不参与默认流程；Mesh 不支持
  ControlNet，不能替代 Dev Depth 的锁视角路径（§1.6）。
- **模板锁定 img2img（同系列图标必用）**：参考图先压白底再上传
  （透明角直传会被合成黑底 → 出黑角图）；提示词强调 `same template/size/position as reference`。
- 候选批量：不同 seed × 多档 denoise（如 0.62/0.68/0.74/0.80），产出 4~8 张候选后统一粗筛。
- 生成默认输出到 `Y:\工作\无尽轮回\scratch\`（脚本默认），定稿才进仓库。

### 第 3 步：按问题筛选

尺寸、Alpha、边缘用对应像素数据判断；主体身份、姿态、结构和循环用直接视觉判断。连通域数量只辅助定位分离碎片，不能作为所有资产必须等于1的门槛，也不能证明单主体/单视图。系列尺寸偏差先按当前用途与基准解释，不机械重抽。

### 第 4 步：视觉确认

优先使用当前模型直接读图能力；需要细节时看局部。外部识图仅在能力缺失或任务需要交叉判断且目的地已授权时使用。像素统计与视觉各回答对应问题，冲突时定位原因，不一律以某方覆盖另一方。

### 第 5 步：抠图入库

- 白底简单主体：`python tools/ai-gen/make-transparent-icon.py <src.png> <dst.png>`
  （角点 flood fill + 最大连通域 + 羽化 + 边缘去污染）。
- 透明主体默认（方案一）：生成时加 `--transparent` 一键完成「AI 选纯色底 → 出图 →
  阈值抠图 → GrabCut/BiRefNet 兜底」（`tools/ai-gen/pick_bg_color.py` + `tools/ai-gen/transparent_cutout.py`），
  纯色底由 AI 决定，不再手写白底；产物 `out.png`（RGBA）+ `out_raw.png`（原图）。
- 复杂背景/贴边主体（装备类）：**BiRefNet 优先**
  （`tools/ai-gen/birefnet-cutout.py` / `tools/ai-gen/birefnet-icon-pipeline.py`，模型权重走 ModelScope 镜像，
  运行环境用 ComfyUI venv）。纯色阈值抠图会把贴边主体/浅灰渐变抠残，禁止用于装备。
- 入库规格：技能图标 1024×1024 透明底；装备图标 1536×1536 透明底 + 归一化
  （最长边 0.90 / 纵横比 [0.72,1.4] / 包围盒居中，脚本 `tools/ai-gen/verify-eclipse-icons.py` 复核）。
- 边缘白边硬筛：alpha∈(10,245) 边缘像素白色占比应为 0%（>0.5% 重抠或重生成，
  参考 `tools/ai-gen/edge-check-eclipse.py`）。

### 第 6 步：来源归档

保留获准来源、直接编辑祖先、必要模型/脚本/参数、正式产物和最终预览；规则统一见 [任务工作流](../../skill/00-workflows.md)。仅清理本任务明确可再生中间物与获准废案，不按运行时引用删除生产来源。候选目录按当前任务实际可用路径选择，不假定NAS始终在线。

## 3. 各类资产子流程

### 3.1 技能图标（六边形徽章系列）

提示词模板：`prompts/skill-icon.md`；流程：模板锁定 img2img（火球白底参考）→ 候选批量 →
内容框校验（对标 fireball 基准）→ 抠图 1024² → 入库 `assets/skills/`。

### 3.2 装备/首饰图标

提示词模板：`prompts/equipment-icon.md`；流程：FLUX.2 Dev文生图（默认；风格已调流程可保留
SDXL 的 style_prefix + 单件强制语法）→ BiRefNet 抠图 → 1536² 归一化（0.90 / [0.72,1.4] / 居中）→
`tools/ai-gen/verify-eclipse-icons.py` 复核 → 入库 `assets/icons/equipment/`（或 `assets/skills/` 对应引用路径）。

### 3.3 障碍物/道具

提示词模板：`prompts/obstacle.md`；抠图走 `tools/ai-gen/prep-obstacle.py`；
入库 `assets/terrain/obstacle_*.png` + `ISO_WALL_GEO` 注册。新道具必须同一视角块。

#### 3.3.1 掩体（世界-122 防守地图，可被攻击的防御墙段）

提示词模板：`prompts/cover.md`；模型：FLUX.2 Dev（`flux2-dev-fp8`，批量脚本
`tools/ai-gen/gen-world122-assets.py`）。F→A 六档材质递进（木栅→沙袋→石垒→砖混→钢甲→符文钢），
每档**水平摆/垂直摆两组贴图**（30° 底边斜向互为镜像）；生命值配置
`{F:400, E:700, D:1100, C:1600, B:2200, A:3000}`，**def/mdef 均为 0**（怪物可攻击）。
抠图入库 `assets/terrain/obstacle_cover_<grade>_h.png`/`_v.png` + `ISO_WALL_GEO` 注册
（foot/obstacleH），实体侧提供可受击结构（hp/maxHp + noDefense）。

#### 3.3.2 防御塔（世界-122）

提示词模板：`prompts/defense-tower.md`；模型：FLUX.2 Dev + Depth ControlNet。塔身=下方基座 +
上方探出的机械臂（空置武器挂载点，供武器贴图挂载）；写实风格、六档共用同一视觉语言。
抠图入库后 DefenseTower.spriteCfg 指向，footOffsetY 按内容底边校准。

### 3.3.3 能源水晶 v3（世界-122，12 形态随机 + 30° 接地线）

提示词模板：`prompts/energy-crystal-v3.md`；生成调度：`tools/ai-gen/gen-energy-node-v3.py`。
流程：脚本程序化绘制 12 张深度控制图（每张一种独立形态，底座统一 30° 菱形土堆接地）
→ `flux2-dev-depth --transparent`逐张出图（normal + depleted各12）→ `--install`入库
`assets/terrain/energy_node_v3_<n>.png` / `energy_node_depleted_v3_<n>.png`。

快速验证：`python tools/ai-gen/gen-energy-node-v3.py --limit 1 --depth-only`（只看深度图），
或 `--limit 1 --no-refine`（跳过抠图精修，先验证 5080 出图链路）。
程序化兜底预览：`tools/ai-gen/preview-energy-node-v3.html`（Vite 启动后浏览器打开，
直接复用运行时绘制函数）。

- 视觉基准：材质参考 `assets/icons/craft/frozen_crystal.png` 与
  `jade_spirit_crystal.png`；接地线参考 `assets/terrain/obstacle_cover_*_h/v.png`
  底边 30° 规则（禁止平底直切）。
- 随机性：12 形态在 `src/world/energy-node-textures.js` 与生成器脚本中一一对应；
  运行时另有洗牌袋 + 随机镜像，避免地图 11 个节点同形。
- AI 成品缺失时游戏自动回退运行时程序化 v3（同名 `energy_node_gen_*` 纹理），
  不阻塞场景运行。

### 3.4 怪物/角色贴图

提示词起点 `prompts/monster-sprite.md`；用途、主体比例、裁框、预算查 [16](../../skill/16-character-sprite-production.md)，方向、根点、按需RIFE及事件映射查 [16b](../../skill/16b-animation-alignment-and-timing.md)。不要对所有角色硬套477px主体/492px脚线等旧样本参数；使用当前类别基准与获准动作。

### 3.5 投射物贴图

- 优先 img2img 参考既有投射物图（如 Meshy 冰锥）→ 抠图 → 随机抽取入库（冰锥 4 张范例）。
- 纯色小物件（雪球等）直接运行时 `createCanvas` 生成纹理，不要 AI 出图再抠。

### 3.6 视频（MiniMax H3 / 本地豆包 Seedance）

**提交前必做，不分模型**：先读 `skill/16b-animation-alignment-and-timing.md` 第1.1节，查看已认可同类单位的实际动作帧，记录相机、头/胸/胯/脚方向、步轴与根点策略。身份母图和方向参考分开；展示母图方向不符时先制作同角色动作关键帧，核对通过才提交H3/豆包视频。用户已确认方向或同意继续时由助手核对并记录，不重复索要相同许可。生成后先检查原视频方向，再抠图/RIFE；不把武器朝右当作身体朝右。

提示词模板：H3/VFX 用 `prompts/video.md`，豆包人物动作使用
`prompts/doubao-character-action-standard.md`；客户端 `python tools/ai-gen/minimax-h3-gen.py`；
输出 MP4 直入 `assets/videos/` 或 PyAV 抽帧转 sprite sheet（动作动画截帧路线）。
主角攻击动画走关键帧→H3 两段式管线：`prep-player-attack-keyframes.py` →
`run-player-attack-sword.py` → `analyze-player-attack-sword.py` →
`build-player-attack-sheet.py`（详见 SKILL.md「主角一段攻击关键帧→H3 两段式挥砍重生」）。

H3 正式动作默认使用 5.17 秒/124 帧、1024×576、20 步和1个候选；每个结果自动生成24点`_contact.png`并写
`.mp4.json`，记录模型、seed、提示词全文与哈希、参考素材哈希和采样参数。不满意时更换seed重抽；只有用户明确要求比较时才用
`--candidates N`，多候选会复用同一次参考上传并输出`_c01..cNN.mp4`。待机/奔跑由动作类型自动走 `loop` 并锁同图尾帧；
攻击/嚎叫走 `recover`，死亡/坍塌走 `one-way`，不再为了方便统一强锁回首姿。通用入口可显式使用
`--motion-mode recover|one-way`；只有真正循环的动作才加 `--loop`。

H3 默认以 `--h3-prompt-format h3` 把资产级原文封装成官方字段结构：Base模式严格使用
`integrated_multimodal_description / overall_soundscape / non_diegetic_music`三段，Ref2VA严格使用
`subject_definitions / summary / retention_analysis / detailed_description / overall_soundscape / non_diegetic_music`六段。
原文仍须遵循
`prompts/minimax-h3-action-template.txt`：用可观察的时间路径描述起势、峰值和恢复/最终态，减少同义否定词堆叠；原文超过2200字符
或出现超过14个否定条款时客户端会告警。`--h3-prompt-format raw` 仅用于复现旧母版。困难动作可改用
`--reference-mode reference --ref-video <motion.mp4>`，此时参考图只负责身份，参考视频只负责动作；`--ref-size max` 为正式默认，
`match` 只用于明确的速度实验。Reference 模式不能与像素级首尾帧锁同时使用。怪物/人形精灵入口自动使用
`--h3-audio-mode visual-only`和`--h3-visual-profile character-asset`：不靠堆叠否定词，额外锁定材质纹理、轮廓、
刚性装备拓扑、面部标记以及毛发/布料的跨帧细节；通用VFX入口默认使用`general`并保留提示词中的音效要求。

```powershell
python tools/ai-gen/ai-asset.py video generate --provider h3 `
  --ref Y:\素材库\first-frame.png --prompt tools\ai-gen\prompts\my-action.txt `
  --motion-mode recover --candidates 1 --steps 20 `
  --duration 5.17 --size 1024x576 `
  --out Y:\工作\无尽轮回\scratch\h3_action.mp4
```

视频候选**默认先走本地豆包免费额度**；只有当页面明确显示当日额度耗尽、会员/权限阻断，或用户明确指定 H3、任务有豆包无法满足的特殊质量需求时，才追加 `--provider h3` 切远程 5080。豆包当前默认 `Seedance 2.0 Mini`，模型名称、倍率和免费状态以每次提交前页面实际显示为准：

```powershell
python tools/ai-gen/ai-asset.py video generate --provider doubao `
  --ref Y:\素材库\first-frame.png --prompt tools\ai-gen\prompts\video.md `
  --duration 5 --size 1024x576 --candidates 1 `
  --out Y:\工作\无尽轮回\scratch\seedance_candidate.mp4
```

首次运行前完整退出普通启动的豆包一次；脚本会用 loopback CDP 启动客户端，绝不自动杀进程；成功下载后关闭自己启动的客户端与调试端口。
多候选输出为 `_c01/_c02/...`，并各带 `.mp4.json` 来源记录。豆包端无像素级尾帧锁，循环动作
仍须走原有抽帧、首尾缝、透明和 GIF 预览验收。额度不足、账号认证或一般风控提示出现即停止，不自动重投；确认免费额度不可用后才考虑 H3，不得仅凭旧的每日条数估算提前绕过豆包；
若明确反馈“肖像保护/暂不支持真实人脸参考”，则按 `prompts/doubao-character-action-standard.md` 的肖像降级规则处理：
删除提示词中的角色名和身份专名，统一改称“参考图中的原创游戏角色”、明确不涉及真人肖像，仅允许再提交一次；
仍被拦截时停止图生视频，改走无专名文生视频或更换明显非真人风格的参考图。
豆包在后台完成时可能不会主动刷新“你的视频生成好了”，不能只靠当前页提示文本或 `--inspect` 的未滚动状态判断未完成。等待超时或用户确认已生成后，先前置查看最新完成卡：运行
`--attach-only --scroll-latest --play-latest --completed-offset 0 --inspect`，确认完成卡属于当前对话且已出现可见、非缓存、`readyState>=1` 的播放器；再单独运行
`--attach-only --download-latest --out <目标.mp4>`。恢复后必须把文件哈希与本任务旧候选及同目录视频逐一比对；命中旧哈希时判为缓存误取，重新激活完成卡后恢复，不得重提。以上恢复入口都不上传、不提交、不消耗新额度。
`--scroll-latest` 或 `--play-latest` 会先通过 CDP `Page.bringToFront` 激活当前对话页；只有页面 `visibility=visible` 后出现的完成卡和可见播放器才可作为后台恢复依据。不要把“CDP可连接”误当作页面已经前置。
如果单次视频明显超过通常生成时间，或等待脚本已经超时但完成卡仍未出现，不能继续静默等待：先按上一段前置当前对话并检查最新卡；确认目标任务仍在生成后，通过当前已登录豆包会话的程序化入口主动发送准确文本`汇报进度`。每个超时检查阶段最多发送一次，收到状态回复或进入下一检查窗口后再前置查看，禁止连续刷问。该问询只用于查询已经提交的任务，不得重新上传参考图、重填视频提示词、点击生成提交、改变参数或消耗新额度；禁止用仿人工点击代替程序化入口。若脚本尚无可确认不会触发视频提交的安全问询入口，先补该入口再发送，不得把视频编辑器的提交按钮当作进度问询。

豆包人物动作提交与入库硬门槛（伊莉丝奔跑实测）：

- 提交前必须先用 `--fill-only` 演练。自动化使用真实键盘输入写入提示词，并从编辑器逐字回读；
  字符数/哈希不一致时禁止提交。MP4 provenance JSON 同步记录 `promptChars` 与 `promptSha256`。
- “绝对无阴影/纯白底”提示对 Seedance Mini **不可靠**：即使纯白无影首帧和双最高优先级提示均正确，
  模型仍可能重画浅灰底与长接触阴影。不得直接阈值抠底，统一以 BiRefNet 最大主体连通域清除背景、
  阴影和豆包角标；提示词是减轻污染，不是验收证据。
- 方向锁定必须同时使用接近目标侧向的动作关键帧和结构化方向约束（鼻尖/胸腔/骨盆/膝盖/脚尖沿水平轴）。
  若参考帧仍为三分之四视角，文字只能减小偏差，不能保证变成严格正侧面；入库前必须人工查看联系图/GIF。
- 动作参考帧可用 `prepare-video-character-reference.py` 从候选视频抽帧、BiRefNet 抠图后重铺纯白底；
  循环候选用 `character-run-video-rebuild.py --start S --endpoint E --stem <动作名>`，其中 E 是与 S 同相的重复端点，
  成品只保留 `[S,E)`。Idle 等慢动作可显式加 `--step 2` 降为源帧率的一半，脚本会同步写入成品帧率，
  不允许改用逐帧不等比拉伸来压缩贴图。固定位置 Idle 使用 `--horizontal-anchor lower-body`，排除长剑、
  盾牌和披风对水平中心的干扰，并在缩放落位后做整数像素二次纠偏；报告必须满足 0 空帧、0 贴边、
  脚线固定、`lowerBodyOffsetSpan == 0px`、
  接缝步幅比 `0.5~1.5`。

### 3.7 透明主体（需要透明 PNG 的图标/装备/怪物/道具）

提示词模板：`prompts/transparent-subject.md`；入口加 `--transparent`：
`tools/ai-gen/comfyui-gen.py --transparent`（AI 选色 `tools/ai-gen/pick_bg_color.py` 写入提示词 →
出图后 `tools/ai-gen/transparent_cutout.py` 阈值抠图；检测到背景非均匀时自动切
**GrabCut 主导**（`tools/ai-gen/grabcut-alpha.py`，边框+中心 GMM 建模，实测残留清零，
失败回退 BiRefNet）。产物 `out.png`（RGBA）+ `out_raw.png`（原图）。
**白色要素多的主体（白衣/白甲/银饰）禁用白底**——白底抠不净需人工介入，纯色底阈值一刀切。

### 3.8 改造图标（craft mod icons，法杖/枪械/剑类，2026-08-05 实测定稿）

**目标**：craft-config.json 里每把武器的改造选项从 emoji 换成 `assets/icons/craft/<key>.png`。
已跑通 95 张（法杖 20 + 枪械 53 + 剑类 22），53+22 张经历三轮抽验修复。

- **共享映射（先做）**：选项 id → 唯一组件 key。同名同 id 全武器共用一张；
  同名不同 id 合并（`shotgun_suppressor`→`suppressor`、`light_extended_mag`→`light_extended`、
  `light_pommel`→`light_blade_body`）；跨类复用已有图（剑类 `eagle_eye_rune` 用法杖那张）。
  用脚本扫描 data/craft-config.json 生成 key 清单并校验覆盖（防漏/防孤儿）。
- **提示词模板**：`prompts/equipment-icon.md` 风格 + `(exactly one <key>:1.5)` +
  `(isolated single object:1.3)` + 固定负面 `no second object, no detached pieces,
  no whole weapon`；长条件（枪管/剑身/消音器/瞄具）加 `completely inside the frame with
  generous white margins`。黑色金属件直接白底出图（对比好，BiRefNet 抠得净）。
- **批量生成**：
  `python tools/ai-gen/comfyui-gen.py --host 192.168.3.142 --model flux2-dev-fp8
  --prompt-file <Y:\...\prompts\gun\key.txt> --seed <递增> --out <Y:\...\raw\key.png>`
  4 并发；客户端超时（420s）后图仍会落盘 → 调度脚本按"文件存在且 >10KB"判成功并自动重试。
  调度器参考 `tools/ai-gen/_gun_gen.js` / `_sword_gen.js`。
- **抠图+硬筛**：BiRefNet（ComfyUI venv python + `birefnet-cutout.py`，folder 模式默认
  `_cutout` 后缀，`--suffix ""` 会被 shell 吞 → 生成后批量改名）；再用 alpha>60 连通域
  `components==1` 硬筛（等价 `check-components.py` 的"禁止多余元素"规则）+ 边缘半透白
  <0.5% → `tools/ai-gen/_gun_filter.py`。
- **验收（GLM-4.6V）**：**单张 + 具体问题**（多图一起传会串扰/错位）；"长短/圆平头"等
  定量几何以 alpha bbox 实测为准，GLM 只信定性。易错形态与修法见 §4 第 10~15 条。
- **入库**：`assets/icons/craft/<key>.png`；craft-config.json **data+public 双份同步**
  （`JSON.stringify(cfg, null, 2) + '\n'`），脚本校验双份字节一致 + 引用文件全存在；
  UI 渲染走 `craft-system.js` 的 `renderCraftIcon()`（`assets/` 前缀渲染 `<img>`）。
  收尾：`npm run lint` / `npm test` / `vite build`。

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
10. **多室制退器/收束器被画成鸟笼开长槽**：sub 必须写 `separate rows of small round vent
    ports / mostly smooth tube with knurled band and small holes, no long slots`。
11. **扳机类（auto/burst/competition/lightweight）易带出整枪，轻量扳机甚至画成刀**：写
    `standalone trigger part only, no receiver, no grip, no gun, no blade, no sharp edge`；
    burst 用 `small box-shaped module with rotary selector dial` 更稳。
12. **无护手必被画护手**：sub 强调 `absolutely no crossguard, no quillon, no disc guard,
    no hand protection anywhere`，验收时专门问 NO-GUARD/HAS-GUARD。
13. **短管/近战短管易画成长管**：sub 加 `very short stubby, much shorter than a full
    barrel`；用 alpha bbox 长边量化对比 long_barrel 校准。
14. **锤击点弹头/弧形扳机**：平头弹写 `wide flat meplat like a wadcutter, no round nose`；
    弧形扳机写 `short curved finger lever with a mounting hole, no blade, no point`。
15. **Y: 中文路径坑**：Node fs 在 NAS 中文路径下 mkdir 会 ENOENT 乱码 → 提示词用
    PowerShell 写/复制；Python 读 Y: 中文路径 OK，但更稳的是 Y: → `%TEMP%` 本地中转再跑
    抠图/筛选（`_gun_filter.py` 同理）。
16. **小件占幅过低**（扳机等 cov≈3%）：对 alpha bbox crop 后回填 1024 画布（长边约 430px，
    ~42% 画布），与同批图标观感对齐。
10. **白色要素多禁用白底**：白/银主体白底必然抠不净 → 走 `--transparent` 纯色底方案一
    （AI 选底色 + 阈值抠图 + GrabCut/BiRefNet 兜底；SDXL 不按 hex 渲染出渐变底时，
    抠图器自动切 GrabCut 主导——BiRefNet 会把渐变底残留成主体，GrabCut 残留清零，
    无需人工介入）。
11. **Mesh 跨机运维**：Daedalus 需先启动（`tools/ai-gen/start-daedalus.ps1 -SkipSmoke`）；客户端崩溃
    遗留半截会话会把 Daedalus 卡死（socket 显示监听但拒绝新连接）→ 重启 Daedalus 即可；
    n_blocks_remote 只能增不能减（调小要重启 ComfyUI）；单客户端独占；
    wire-contract 文件（codec/protocol/vec_io/lora_io）两端必须字节级一致；
    本机 safetensors 绑定崩溃已用 `safetensors_raw.py` 绕过，升级需复核补丁。
12. **Mesh 不支持 ControlNet**：官方源码/issue 均无支持，架构上 Daedalus 后端收不到
    ControlNet条件——锁视角默认必须走`flux2-dev-depth`；Mesh只保留为人工指定的旧对照实验。
13. **测试视频/候选不提交仓库**：`assets/videos/` 已入 .gitignore；测试视频统一放
    `Y:\工作\无尽轮回\scratch\videos\`，仓库只保留被引用的最终资产。

## 5. 归置原则（NAS Y:\）

- `Y:\素材库\`：原始素材/参考图
- `Y:\工作\无尽轮回\scratch\`：AI 出图/视频中间产物与候选（生成脚本默认输出地，定稿才进仓库）
- `Y:\模型库\ComfyUI\models\`：大模型归档（双机共用；冷模型 junction，热模型留本机）
- 仓库只保留被引用资产；候选/废案/大视频一律落 Y:，E: 只放源码 + 入库资产。
- 版本控制走 GitHub（origin `allang2208/wuxianlunhui`）；`tools/ai-gen/backup-to-nas.ps1` 为手动可选备份。

## 掩体 h/v 朝向经验（2026-08-05 实测固化）

- FLUX.2（dev/klein）对"水平摆/垂直摆"提示词不区分方向，raw 一律产出 "/" 向；
  独立生成 h/v 两张必撞方向（世界-122 的 B/D 掩体即因此报废，已改为镜像修复）。
- **一图两向**：每级只生成一张 raw（"/"），`_h`=镜像（"\"），`_v`=原样；
  镜像后跑 `audit-perspective.py` 确认 pair=MIRROR 再入库。
- 无光源/无阴影规则见 `prompt_principles.py` 与 `check-prompts.py`（防回潮扫描）。
- 新增掩体纹理优先 img2img 锚点派生（待 comfyui-gen 支持 `--ref-image`）。
