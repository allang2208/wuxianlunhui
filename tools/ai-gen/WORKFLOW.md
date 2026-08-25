# 生图标准工作流（2026-08-04 定稿，二轮更新）

> **唯一权威入口**。新技能贴图/图标、障碍物、装备/首饰图标、怪物/角色素材、投射物、视频一律按本文档执行；
> 提示词一律从 [`prompts/`](prompts/README.md) 取用**固化模板**，禁止现场自由发挥。
> SKILL.md 文首「本地 AI 出图工作流」为本节的摘要速查，本文档为准。
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
| 远程·固定视角/方向 | 远程 5080 + Depth ControlNet | `python tools/ai-gen/comfyui-gen.py --host 192.168.3.142 --model flux2-dev-depth --control-image depth.png --prompt "..." --out out.png` |
| 跨机双卡·最高质量提速（Daedalus 在线） | 5080 Icarus + 本机 3080 Ti Daedalus | `python tools/ai-gen/comfyui-gen.py --host 192.168.3.142 --model flux2-dev-mesh --prompt "..." --out out.png`（8 步 turbo；Daedalus 需先启动，见 §1.6） |
| 本地兜底 | 本机 3080 Ti | `python tools/ai-gen/comfyui-gen.py --host 127.0.0.1 --model sdxl --prompt "..." --out out.png`（已装 sdxl；FLUX.2 dev 建议 5080） |
| **地面无缝纹理（泥/沙）** | floor-asset.py（comfyui-gen → make-seamless → desaturate） | `python tools/ai-gen/floor-asset.py mud --out assets/terrain/floor_mud_seamless.png --seed 9001` |
| 透明主体素材 | 远程 5080（SDXL 兜底） | `python tools/ai-gen/comfyui-gen.py --host 192.168.3.142 --model flux2-dev-depth --control-image depth.png --transparent --prompt "..." --out out.png`（AI 选纯色底 + 自动抠图，见 §3.7） |
| 兜底·智谱 API | 智谱 | `python tools/ai-gen/zhipu-gen.py --prompt-file prompt.txt --model glm-image --size 1280x1280 --out ...`（双机不可用/免费额度场景） |
| 兜底·ithinkai 中转站 | gpt-image-2 | `python tools/ai-gen/gptimage2-gen.py --prompt "..." --out out.png`（OpenAI 格式 API，按 token 计费、无水印；key 不落仓库，见下注） |
| 同系列模板锁定重抽 | img2img | `python tools/ai-gen/gen-meteor-icon-template.py`（换参考图 + 提示词即可复用） |
| 批量多图 | 智谱/ComfyUI | 参考 `tools/ai-gen/archive/one-off/` 下归档的一次性批量脚本（如 zhipu-gen-necklaces.py 多 prompt 逐张下载、gen-eclipse-set.py 批量入队轮询），仅作写法参考 |

- 模型登记表：`tools/ai-gen/models.json`（`python tools/ai-gen/comfyui-gen.py --list-models` 查看）。
  当前：`flux2-dev-fp8`（**5080 主力**，20~30 步/CFG≈3.5）+ `flux2-dev-depth`（同模型 +
  Fun-Controlnet-Union 深度控制）+ `flux2-dev-mesh`（**跨机双卡**，8 步 turbo + Turbo LoRA 两端本地加载）+
  `sdxl`（checkpoint，通用）+ `flux2-klein-4b`（FLUX.2 蒸馏，4 步备用）。
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

### 1.5 FLUX.2 dev + Depth ControlNet（固定视角/方向，5080 主力）

**能力**：FLUX.2 dev fp8 出图质量/细节强于 klein，配合 `FLUX.2-dev-Fun-Controlnet-Union`
（alibaba-pai，Depth/Canny/HED/Pose 单文件多模式 ControlNet）用**深度图锁定构图视角与方向**，
提示词只负责主体/材质/风格——解决同系列"每次视角都不一样"的痛点。

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
- ControlNet 强度 0.6~0.8（models.json 默认 0.75）；强度过高主体变形，过低视角锁不住。
- 步数 20~30、CFG 2.5~4.0（推荐 3.5）；Euler。
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
`prompts/world122-building-style.md`（`world122-building-v2`）作为12步和48步共享的不可变画风块；
单栋建筑只在 manifest 中描述结构、功能细节和局部配色，不能覆盖共同的材质尺度、光照、边缘处理或渲染语言。
禁止为正式建筑直接手写 `comfyui-gen.py` 命令；通用客户端只作为该入口的内部后端或明确标记的实验工具。
生成脚本会同时校验版本号与模板路径：正式候选只接受 `world122-building-v2` 与
`prompts/world122-building-style.md`。旧 `world122-building-v1`、天气塔实验用
`world122-building-runtime-settlement-v2` 仅允许作为旧候选元数据中的历史版本标记；旧模板文件和任何建筑私有画风模板不得保留，不能继续提交正式候选。
V2 强制所有新建筑主体使用中世纪欧洲半木石结构并融合克制的哥特细节（尖拱、彩色玻璃、立面雕花边饰），
材质统一为游戏向PBR的风化石材、磨损木构与自然氧化黄铜，照明统一为柔和左上顶侧光和受控明暗。
标准流程拆成两段，并始终保持主体与运行时道路铺地分离：

1. **结构粗筛（12 步，默认每批 5 张）**：Blender 白模深度图锁定体块和视角；由同一深度图派生边缘图，用于检查屋脊、塔楼接缝和遮挡边界。远端插件确认支持 Hook 链后可加 `--edge-control` 启用第二路 ControlNet；当前默认只提交深度控制，避免旧版 `HooksContainer` 链式报错。提示词只描述主体、塔楼数量和封闭墙体，不生成望远镜、书架等小件；确有需要时仍可用 `--variants` 显式覆盖数量。
2. **人工选结构**：只看视角、底边、主体居中、塔楼数量、屋顶连续性和墙体是否完整。优先选择带纯绿背景的 `_raw.png` 作为精修初始图；透明 PNG 必须先压回纯绿底，避免透明区在 ComfyUI 中变黑。
3. **细节精修（48 步，低重绘）**：选中的结构图作为 `--init-image`，默认 denoise=0.30，并继续使用同一深度控制。远端插件兼容时可额外启用边缘控制。提示词只添加石材、瓦片、窗户、望远镜、星象仪和书架等细节，不准改变主体轮廓、塔楼数量和底边。
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
  --variants 3 --out Y:/工作/无尽轮回/scratch/world122-buildings
```

通用客户端支持重复 ControlNet、img2img 和局部 mask，但下列命令只用于已经通过结构与画风验收后的局部修复，不得替代正式建筑候选入口：

```bash
python tools/ai-gen/comfyui-gen.py --host 192.168.3.142 --model flux2-dev-depth \
  --control-image depth.png --control-image edge.png \
  --control-strength 0.75 --control-strength 0.38 \
  --init-image selected-green.png --mask-image local-fix-mask.png --denoise 0.40 \
  --prompt-file refine-prompt.txt --out refined.png
```

默认参数在 `world122-building-candidate-manifest.json`：`flux2-dev-depth`、1024²、CFG 3.5、Euler/simple；结构阶段 12 步/5 张、Depth 0.78；精修阶段 48 步/3 张、denoise 0.30、Depth 0.75；边缘约束登记为0.38但默认关闭。脚本会把画风版本、模板、模型和全部生成参数写入每张 raw 对应的 `_generation.json`。改变步数或 denoise 必须显式增加 `--allow-nonstandard`，并会在元数据中留下非标准记录；非标准实验不得和正式候选混放或直接入库。结构不完整时先改白模体块，不能靠提高精修步数修复缺墙、断塔或错误屋顶。

**接地视觉规则**：新建筑在 Blender 阶段必须设计附着于主体墙脚的接地过渡，例如一层低矮勒脚石、门槛、扶壁脚块或极少量贴墙碎石；这些小件与主体相交且随 Body Depth 生成，不得扩展成覆盖完整2×2的独立地台。既有主体不重生成时，可以先另做同相机、真透明的建筑专属接地覆盖层候选；用户确认后把覆盖层裁成与正式主体相同画布，提升到 `assets/terrain/building-contact/`，并通过 `producer-buildings.json.groundContact` 配置接入。运行时必须使用 `rearFx` 作为主体下层、保持在道路填充上方，并同步建造幽灵、镜像、战争迷雾、地图模式、压平视图和销毁；不得参与主体alpha拟合、遮挡AABB、占格、碰撞、寻路或主体footprint，也不得重新启用已经取消的通用独立地基。

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
| 视频/动画 | MiniMax H3（唯一） | — | `tools/ai-gen/minimax-h3-gen.py`；MP4 入 assets/videos 或抽帧转 sprite sheet |
| 兜底链（双机不可用） | 智谱 API glm-image | — | 不支持负面词（写进正向）；去水印走 zhipu-process.py |

**mesh 开关规则**：
- 启用：Daedalus 在线（本机 `tools/ai-gen/start-daedalus.ps1 -SkipSmoke`，n_blocks=4，
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
- 用 `python tools/ai-gen/check-icon-sizes.py` 量化现有同系列图，记录基准后再生成。
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
- **连通域计数是唯一硬证据**（多视图/多件排列）：`python tools/ai-gen/check-components.py`
  对 BiRefNet alpha>60 做 `ndimage.label`，**components == 1 才合格**（GLM-4.6V 说"五个视角"不可轻信）。
- 内容框与系列基准偏差 >5% → 重抽或归一化，不直接入库。

### 第 4 步：视觉验收（GLM-4.6V 定性 × 像素统计定量）

```bash
node "C:\Users\allan\.codex\skills\deepseek-vision-skill\scripts\describe-image.js" --prompt "画面主体是什么？构图/风格是否符合要求？" "候选图.png"
```

- **单张 + 具体问题**，多图一起描述会串扰；背景色判断不可靠（以角点像素均值为准）。
- 定位类问题（鞋头朝向、握把位置）用**特写裁剪图**（目标区裁小、2~3 倍放大）问，回答稳定可用。
- 像素统计与 GLM 描述矛盾时，**以像素统计为准**。

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
`tools/ai-gen/verify-eclipse-icons.py` 复核 → 入库 `assets/icons/equipment/`（或 `assets/skills/` 对应引用路径）。

### 3.3 障碍物/道具

提示词模板：`prompts/obstacle.md`；抠图走 `tools/ai-gen/prep-obstacle.py`；
入库 `assets/terrain/obstacle_*.png` + `ISO_WALL_GEO` 注册。新道具必须同一视角块。

#### 3.3.1 掩体（世界-122 防守地图，可被攻击的防御墙段）

提示词模板：`prompts/cover.md`；模型：FLUX.2 dev + mesh（`flux2-dev-mesh`，批量脚本
`tools/ai-gen/gen-world122-assets.py`）。F→A 六档材质递进（木栅→沙袋→石垒→砖混→钢甲→符文钢），
每档**水平摆/垂直摆两组贴图**（30° 底边斜向互为镜像）；生命值配置
`{F:400, E:700, D:1100, C:1600, B:2200, A:3000}`，**def/mdef 均为 0**（怪物可攻击）。
抠图入库 `assets/terrain/obstacle_cover_<grade>_h.png`/`_v.png` + `ISO_WALL_GEO` 注册
（foot/obstacleH），实体侧提供可受击结构（hp/maxHp + noDefense）。

#### 3.3.2 防御塔（世界-122）

提示词模板：`prompts/defense-tower.md`；模型：FLUX.2 dev + mesh。塔身=下方基座 +
上方探出的机械臂（空置武器挂载点，供武器贴图挂载）；写实风格、六档共用同一视觉语言。
抠图入库后 DefenseTower.spriteCfg 指向，footOffsetY 按内容底边校准。

### 3.3.3 能源水晶 v3（世界-122，12 形态随机 + 30° 接地线）

提示词模板：`prompts/energy-crystal-v3.md`；生成调度：`tools/ai-gen/gen-energy-node-v3.py`。
流程：脚本程序化绘制 12 张深度控制图（每张一种独立形态，底座统一 30° 菱形土堆接地）
→ `flux2-dev-depth --transparent` 逐张出图（normal + depleted 各 12）→ `--install` 入库
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

提示词模板：`prompts/monster-sprite.md`；统一基准图 + 同首帧 img2video 保证跨动作一致；
入库前过 `tools/sprite-normalizer.py`（内容高 477px、脚底基线 y=492、帧尺寸严格）。
所有怪物/友军角色逐帧表在关键姿态验收后，还必须过
`tools/ai-gen/rife-spritesheet-interpolate.py` 的 2× RIFE 门禁：循环含尾首缝、一次性动作禁回绕，
帧率同步×2保持墙钟不变；报告须满足无空帧、透明区 RGB 为零、偶数位关键帧保真且
`visibleDarkOutlierFrames={}`。长武器只决定格宽，不参与主体缩放；具体映射见
`skill/02-ai-asset-pipeline.md`“新增怪物/友军正式动画强制门禁”。

### 3.5 投射物贴图

- 优先 img2img 参考既有投射物图（如 Meshy 冰锥）→ 抠图 → 随机抽取入库（冰锥 4 张范例）。
- 纯色小物件（雪球等）直接运行时 `createCanvas` 生成纹理，不要 AI 出图再抠。

### 3.6 视频（MiniMax H3 / 本地豆包 Seedance）

提示词模板：H3/VFX 用 `prompts/video.md`，豆包人物动作使用
`prompts/doubao-character-action-standard.md`；客户端 `python tools/ai-gen/minimax-h3-gen.py`；
输出 MP4 直入 `assets/videos/` 或 PyAV 抽帧转 sprite sheet（动作动画截帧路线）。
主角攻击动画走关键帧→H3 两段式管线：`prep-player-attack-keyframes.py` →
`run-player-attack-sword.py` → `analyze-player-attack-sword.py` →
`build-player-attack-sheet.py`（详见 SKILL.md「主角一段攻击关键帧→H3 两段式挥砍重生」）。

快速免费候选可走本地豆包客户端（默认 `Seedance 2.0 Mini`）：

```powershell
python tools/ai-gen/ai-asset.py video generate --provider doubao `
  --ref Y:\素材库\first-frame.png --prompt tools\ai-gen\prompts\video.md `
  --duration 5 --size 1024x576 --candidates 3 `
  --out Y:\工作\无尽轮回\scratch\seedance_candidate.mp4
```

首次运行前完整退出普通启动的豆包一次；脚本会用 loopback CDP 启动客户端，绝不自动杀进程；成功下载后关闭自己启动的客户端与调试端口。
多候选输出为 `_c01/_c02/...`，并各带 `.mp4.json` 来源记录。豆包端无像素级尾帧锁，循环动作
仍须走原有抽帧、首尾缝、透明和 GIF 预览验收。额度不足、账号认证或一般风控提示出现即停止，不自动重投；
若明确反馈“肖像保护/暂不支持真实人脸参考”，则按 `prompts/doubao-character-action-standard.md` 的肖像降级规则处理：
删除提示词中的角色名和身份专名，统一改称“参考图中的原创游戏角色”、明确不涉及真人肖像，仅允许再提交一次；
仍被拦截时停止图生视频，改走无专名文生视频或更换明显非真人风格的参考图。
若页面已显示“你的视频生成好了”但自动等待超时，先用 `--inspect` 只读确认当前会话，再运行
`--attach-only --download-latest --out <目标.mp4>` 恢复最后一个可播放结果；该恢复入口不上传、不提交、不消耗新额度。

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
    ControlNet 条件——锁视角流程必须走单卡 `flux2-dev-depth`，mesh 只跑自由提示词。
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
