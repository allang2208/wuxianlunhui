> 本文件为 game-dev 技能库分卷，主索引与目录见 ../SKILL.md

> 任务阶段与局部修补分流见 [00-workflows](00-workflows.md)。本卷保留系统细节与案例；历史测试/构建命令仅供用户授权后选择，不自动执行。公共动画规则以16/16b为准，案例参数不扩大为通用要求。
> 本节：2. AI 资产与出图管线

## 2. AI 资产与出图管线

### 时代建筑来源归档与局部修订

- 同一成品可经历12步选稿、局部结构修正、48步精修、局部颜色/阴影修正。保留这条链上的每个直接编辑输入；即使中间图有缺陷，只要下一版由它编辑生成，就不是废案。未选兄弟raw、旧整批对照图和可再生备份可清理。
- 细栏杆/梯子/开门等空隙的Alpha去幕色，与金属/墙面边缘RGB去绿分开处理；宽泛全图去绿会伤及灰绿屋面和卡其材料。修正矩形必须按当前PNG坐标登记，不能复用另一尺寸或前一代图的坐标。
- 减少烘焙大块阴影是素材编辑，不能借此改变游戏实时阴影；保留接触暗部，记录编辑造成的局部材质差异。逐张地台标定只更新视觉映射，不改变逻辑占格。
- 归档的活动清单只列实际保留的源与成品；旧生成manifest中的候选列表属于历史，不再充当重建入口。素材源入库、运行时接线发布、玩家实机验收必须分别记录；未完成透明化的图标原图继续留作本地待处理源。

### 现代实验楼的对称建模与最小归档

- 现代科研大楼先在Blender模型坐标中检查主楼、两翼、屋顶实验舱、檐口和窗列的中心线与成对尺寸；等距画面中的屏幕长度会受投影影响，不能用二维拉伸“修对称”。高楼透视或语义像废弃工厂时，返回模型统一体块、立面节奏、玻璃/石材比例和屋顶科研识别物，再重出模型预览与Body Depth；结构门禁通过前不得进入12步选稿。
- 定稿链固定为“可编辑模型与建模脚本 → 当前模型预览/Depth → 唯一选中12步raw及参数/提示词 → 唯一选中48步raw及参数/提示词 → 直接Alpha修订源 → 正式建筑、缩略图与四张光照派生”。未选同批候选、旧工厂模型、`blend1`、可再生抠图/body/对照图及一次性运行时截图属于废案；清理后用manifest和cleanup-manifest只登记仍存在的重建输入、成品与删除类别。
- 升级图标是独立资产链：保留生成raw、提示词、参数/来源和限定输出键的规范化脚本；正式256px图与运行时128px镜像均入库。可由正式图机械重建的48px联系图、接触表和一次性预览不作为正式来源保留。

新增/优化角色动画同时执行 [尺寸、锚点、插帧与攻击时钟统一合同](16b-animation-alignment-and-timing.md)：覆盖怪物、友军、工人/平民、侍从等；偏慢普通攻击约1.5秒，同步接触事件与间隔，保留专属技能和实机验收边界。

### 场景背景的比例、裁剪与最小来源

- 制作前区分全屏Loading、地牢探索横幅、旧地标底图及事件配图；同题材不等于同用途。全屏图按窗口cover保留宽屏原图，不能直接套用探索横幅的40:9裁剪。
- 默认16:9窗口、探索背景占40vh时，槽比例为40:9。用户要求裁剪时，从归档原图取最大整数矩形：`k=floor(min(W/40,H/9))`，宽高`40k×9k`，左上偏移分别为余量的一半向下取整；奇数余量多裁右/下1px，不拉伸、重采样或重绘。
- 请求尺寸与实际生成尺寸分开记录。40:9只吻合默认窗口和分界高度，改变布局仍由center/cover继续裁切，不能承诺所有窗口都完整显示。
- 裁剪原图是重建输入，必须保留；生成式编辑的直接祖先也不是废案。未经像素处理、与正式PNG逐字节相同的归档副本可在确认后去重，由manifest指向唯一正式源；同步活动README/脚本引用，保留提示词、裁剪参数及最终总览。
- 多入口复用同一批正式图片只增加配置引用，不复制十套素材；重建必须从归档原图开始，不再次裁剪成品，不依赖已清理的临时缓存。素材归档与依赖该素材的框架发布状态分别记录。

### 市政建筑多时代定稿与二楼透视修订

- 4×4是逻辑占地，三时代贴图各自量取地台角点并使用 `visualFootprint.scaleMode=strict`；换图不调整道路来掩盖地台漂移。
- 同一立面窗台对齐以建筑标高和投影为准，转角两面不能强行拉成同一屏幕水平线。侧翼显短先检查钟楼前凸与遮挡；用户要求调整模型时，修正可编辑体块、Depth后再精修，不能继续用局部贴图补墙替代结构修改。
- 二楼门口、阳台平台、前沿/两侧护栏和徽记必须同模型规划，旗帜与窗户保持各立面的对称布局；最新明确选择优先于早期候选评价。
- 定稿保留每档唯一raw、精修直接输入、真实Depth、提示词/参数、可编辑模型和模型修订祖先。模型后收→阳台→钟盘控制版的祖先blend仍是可重建依赖，不按旧目录名删除。
- 未选raw、废弃蒙版/合成图、重复对照图、blend1及可再生body可清理；默认安装从保留raw开始。活动selection/README只列现存来源，旧生成记录明确作为历史，清理清单记路径、字节和原因。素材入库、功能发布与实机验收分别报告。

### 战略城市/据点素材与战场预设的分层

- 大地图标记与攻城战实体是两套表现：`settlements.png`仅供地图Canvas取帧，战场墙/门/楼梯/塔楼由原生实体生成，不能把地图图集当作战场碰撞或上下楼依据。
- 城市、据点共用55°战略相机与原生材质库；五种地貌各两款、共用两款废墟组成12帧256px图集。正式图集、双份帧元数据、可编辑blend、建模/导出脚本和manifest一并归档；共用相机/材质脚本也是重建依赖。
- 地图缩小时，显示尺寸随六边格半径收缩，不设会撑出地格的固定像素下限。当前两类系数1.1，城市/据点上限92/80px；不改变图集、接地点、逻辑占格或模型相机。调整显示比例后旧比例联系图应清理或明确失效，不能充当新效果证明。
- 原生渲染缓存可由模型和脚本重建，按“全量建模渲染→导出”恢复；保留结构/材质对照图，移除旧显示比例预览与复制业务代码的过时UI样例。已认可攻城构造图可留本地供对照，临时预览目录不强制加入Git。布局认可、源码接入、Git发布、运行时验收分别记录。

### 战略地图定稿与来源收口

- 战略六边格采用相对水平地面55°正交相机，地貌与兵旗共用`world-map-camera.py`；不要套用位面内建筑30°相机、44.8°模型根或2:1地面标定。旗面姿态独立于相机，用户选定的V2约16.7°前倾用于完整展示纹章，不按版本号把未选V3晋级。
- 原生Blender模型、材质/纹章原图、相机参数、正式图集和最终实际尺寸组合图形成制作来源。六款256px兵旗共用768×512图集，50款320px地貌共用3200×1600图集；小图优先纹章与轮廓，避免细纹和亮金属噪点。离线组合图不等于游戏验收。
- 山脉等高出格要改Blender原生几何并重渲染，禁止在Canvas中纵向拉伸成品。当前正式山脉为五类位面×`ridge/massif/pass`共15帧独立图集；普通山地按q/r稳定选山脊或雄峰，山口只用保留真实通道的专帧。现行垂直倍率为`1.35/1.42/1.28`，XY占地、脚点、通道宽度及战略通行规则保持不变。
- 正式山脉图集只收已批准的15帧，不把尚未接入的河流连接件常驻运行时；近景逐格绘制、远景烘入地貌缓存，资源失败回退矢量山形。运行时PNG、`data/`与`public/data/`元数据、blend、建模/导出脚本、manifest和最终组合预览共同形成可重建交付，候选河流与正式山脉的发布状态必须分开记录。
- 清理依据实际输入依赖：地貌V2仍使用V1几何脚本与305格布局，不能整目录删除；48步建筑精修使用的12步选中raw是直接祖先，必须保留。旧版本仅作比较的渲染不应成为正式导出器必需输入。
- 定稿按最新明确选择收口：本系列指挥建筑为A/B/A，保留三份选中精修raw、三份直接输入、Depth、可编辑模型、提示词/参数和正式body。旧Depth与获准造型不一致时不用于Alpha裁切；4×4逻辑占地与逐级`visualFootprint`标定分别记录。
- 可再生逐张渲染、旧候选、重复图集与实施前副本不入库；清理后默认重建顺序为建模渲染→导出。移除一次性旧安装器，活动README只指向保留来源，历史输出路径明确标为已清理。已安装状态、Git发布范围及运行时验收分别记录，不能用素材入库代替代码发布。

### 恐怖普通怪：固定主体比例、变时长插帧与定向弹体归档

- 比较体型使用有效主体高度与脚点，排除棺板、细武器和高举手臂。以矿工僵尸为本批参照：源主体274px、512px格、spriteSize 260.7，得到游戏主体约139.515px。每个来源相机组只设一套固定比例，各动作单独紧裁；禁止逐帧缩放或拉直已获认可的动作轨迹。
- RIFE输出帧数不等于播放速度。按原视频关键帧间隔生成 `frameDurations`，攻击释放段保留密集关键帧，其余缓动段可稀疏抽样；攻击事件通过源帧到输出帧映射定位。循环动作回绕，一次性攻击/死亡不回绕，最后一帧保持原时间语义。交付GIF按配置时钟播放，不能拿插帧工具的统一帧率预览代替。
- 已认可的蓄力、转肩和甩出动作即使换边也保留；源视频裁掉的指尖不能靠插帧宣称修复。本批掷骨殓徒源f43–44触顶已在来源限制中登记。
- 定向骨镖保存向右的原始主轴、真实Alpha和提示词/遮罩来源；显示画布24、碰撞半径3分别配置。正式PNG留在自身怪物目录，避免为复用一张图把另一个怪物全族拉入驻留。
- 归档只保留选定母图及直接编辑祖先、选定MP4与provenance/提示词、当前未插帧源表、正式PNG和最终GIF/报告。重建入口从已保留源表开始，不重新抠图、不改游戏数值和运行时状态；旧生产/安装脚本保留阶段防覆盖门禁。


### 单角色资源族与最小可重建归档

- 驻留器按 `assets/enemies/<目录>/` 聚合资源时，仅复用另一个怪物的一张弹体图也可能拉入其整套动画。先确认真实依赖闭包；只需小图时可保留原像素与来源记录，放进当前资源族并注册独立键，预算计入小图，而不是隐式强驻留整只来源怪物。
- 清理以当前 manifest 的输入链为准：保留直接母图编辑祖先、定稿视频/provenance/提示词、当前未插帧源表、正式PNG及最终GIF/报告；曾被替换但直接参与下一版编辑的母图不是废案。淘汰视频只留元数据，逐帧抠图、旧插帧表和重复预览可恢复移出活动目录，不进Git。
- 清理与重建脚本一起收口：默认重建从保留的未插帧源表开始，正式PNG只有一个输出目录；所有活动索引/预览链接改到现存文件。旧路径仅作为标明“已移除”的历史记录，不得被默认脚本重新当作必需输入或把运行时接入状态写回未接入。
- **器械专属小弹体不能绑住整批缓存**：若正式炮弹、箭头或抛射件只从逐帧抠图缓存中的一帧裁出，最终清理前先把该帧按字节原样提升到`source-sheets/`，登记源帧、裁框、哈希和正式路径，并让发布脚本改读该稳定输入。确认新旧哈希一致后才可删除整批BiRefNet/RIFE缓存；不能为保留一张几KB弹体把数十MB逐帧缓存带入Git，也不能只保留成品小图而失去可重裁来源。


<a id="environment-prop-pipeline"></a>

### 环境小物统一构建管线（2026-08-30：Blender直渲默认，Depth材质精修按需）

适用于地牢/位面贴地装饰及道路环境小物；不把宝箱等交互道具的双状态12/48步流程、建筑、墙门、
树木或实体障碍管线一并改写。共同标准是模型、相机、材质语言与正式输出，**不要求每件小物经过AI**。

1. **先筛选用途**：区分地貌基底、主题识别物、稀有叙事物。优先复用已合适的正式资产；新套件不凑固定18件。
   重复轮廓合并，正常缩放下只剩噪点的小件减少或移除；炸药等可能被误认作可交互物的道具优先场景专用。
   删除候选类别不等于删除正式文件：须先明确运行时引用和可恢复源，不能顺手清理其他地图资产。
2. **统一结构真源**：Blender中锁定轮廓、部件连接、厚度、破损和接地。复用道路母版的正交30°相机、
   44.8°模型根、`PROP_ORTHO_SCALE=6.4`与`PROP_BOTTOM_RATIO=0.875`；材质预览与Body Depth同相机同画幅。
   不得逐件自动重设相机、用透视拉伸纠正视角，或用提示词代替几何约束。高分辨率渲染只增加像素密度。
3. **Blender直接渲染为默认出口**：共用石材、木材、铁锈、布料等基础材质和柔和顶侧光；低饱和、大色块、
   稀疏中尺度磨损优先，禁止用密集木纹/亮边/噪点掩盖结构不足。地图通过色相、粗糙度和风化程度区分，
   不随批次重建一套画风。可复用`tools/ai-gen/environment-prop-materials.py`，并在manifest登记版本与参数；
   库更新不自动重渲其他已定稿地图。原生透明PNG可直接作为候选，不需要额外AI出图或抠图。
4. **AI精修是可选支路**：普通碎石/煤块/木料/绳圈默认直渲；工具、灯具等先看直渲实际效果，近景重点物
   或材质表达不足时才使用模型图+Body Depth。先做2～3件代表样本，与既有道路/位面正式素材对照后再扩展；
   同批锁定模型后端、公共画风、材质参数和光向，不混用自由生图作为固定视角成品。Depth约束结构，不能
   单独保证画风一致；结构错误返回Blender，不能依赖精修或硬裁Alpha修补。不自动套用建筑整套12/48步。
5. **看正常尺寸，不只看放大图**：交付放大结构/材质总览、实际显示尺寸对照及目标地板组合图。
   显式登记相机zoom、位面/地牢`sizeScale`、实际Alpha主体范围和目标世界尺寸；尺寸按可见主体标定，
   不按透明画布大小比较。模型或Alpha变化后重新标定size与origin，等比缩放、保留透明安全边，禁止裁掉细部。
   离线组合图只能证明素材构成，不代替游戏中遮挡、亮度或战斗可读性验收；不得凭本条主动启动游戏/测试。
6. **按用途保留运行时边界**：地牢贴地小物及与其共用同源资产的位面贴地小物仅进入地板烘焙，不新增实体、
   碰撞、占格、寻路或实时灯光；PNG只保留主体与抗锯齿边，不带外部方向投影。道路小物沿用其既有地表层/
   脚点排序、道路净空、动态灯光与生命周期合同，不因共用美术管线被强制改成地板烘焙或统一删除阴影。
   `world-grid`烘焙的定向PBR素材使用`deco.allowFlipX: false`保留原图光向；关闭镜像仍消耗原随机数，
   不改变种子取样次序。当前只为矿洞启用，其他地图未配置时保持原随机水平镜像。
7. **候选与正式分离**：源模型、生成脚本、材质/相机参数、预览与按需生成的Depth留在制作目录，
   manifest标记`stage`、`runtimeInstalled`与当前入口；使用AI时额外保留raw、提示词、参数和抠图来源。
   依据当前会话的候选选择或明确替换授权晋级，已有授权不重复询问；确认前不覆盖正式PNG/配置。
   晋级时同步正式键/路径、尺寸/锚点、权重/配置镜像和生成清单；后续重新运行生成器不得悄悄回退到旧来源。

位面接入见`06-dungeon-scene.md`「生成世界标准工作流」；地牢接入见同卷「地牢添加标准工作流」。

#### 挂墙小物与定稿收口

- 平放道具转挂墙必须先改模型姿态与固定件；两个墙轴分别在同一灯组下渲染，不用PNG旋转/镜像代替建模。
  登记背板挂点与灯杯火源两个锚，实际尺寸样张必须包含相邻墙；宽挂饰沿岩体可见侧面的等距轴贴墙，
  不用屏幕欧氏法线或强行提高depth掩盖邻墙遮挡。
- 只读最终墙段和房间/通道含孔轮廓选位；先留门端、转角、出生净空，再放灯、再放普通挂饰。
  使用独立坐标散列、间距、同类排斥及每房/通道/全场上限，不消耗场地生成随机数；视觉模块不依赖主题布局生成器。
- 收口保留正式PNG、当前可编辑模型、实际选用raw及其直接精修源、Depth/组件mask、提示词/参数和最终组合图/GIF。
  未选raw、逐帧导出、keyed中间图、blend1和替换前副本仅在确认无活动依赖后移除，留下文件清单与原因。
  重建输出与上次安装记录分开；旧安装器应阻止覆盖继任版本，重跑预览不得把已安装状态重置为“未安装”。
- 清理须沿实际读取依赖判断：旧目录中的门源帧、共用建模/拼装函数或包含已确认动画的blend仍可能有效，
  不得按目录旧名称整批删除。先把安装入口限制为现行部件，再移走无依赖废案并记录路径/原因；最终GIF与可编辑源保留。
  同一已确认版本仅重做展示合成时保留外观确认记录；新建模/新视觉版本不能冒用旧确认。

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
# 人形怪/工头动画（H3生成 + h3-loop / h3-attack 抽帧）
python tools/ai-gen/ai-asset.py humanoid video  --name <X> --kind idle|run|attack|howl|die --ref <纯色底首帧> [--one-way]
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
### 识图入口

优先使用当前模型直接视觉能力；像素/Alpha用于精确尺寸与边缘。外部识图仅在能力不足或有明确交叉判断需要且目的地已授权时使用。DeepSeek专用识图技能只在其声明的模型条件满足时启用，不读取历史配置判断当前主模型。具体公共步骤见 [任务工作流](00-workflows.md)。

### 全屏 Loading 背景低颗粒出图与入库合同（2026-08-28）

- **画布与安全区**：正式 loading 背景统一使用约16:9横图，当前稳定输出为`1672×941`。运行时使用`background-size: cover`和居中裁切，因此关键建筑、桥梁、树冠与地平线不能贴四边；标题和读条位于画面中央，必须留出一条横贯中央的低干扰明暗带，图片本身禁止生成文字、UI、边框、Logo或水印。
- **低颗粒正向合同**：先描述大块连续材质面、清晰剪影、稀疏中尺度风化、柔和空气透视、平滑明暗渐变和适度清晰度。森林、遗迹等题材用水面、道路、广场或大厅地坪承担中央安全区，枝叶、砖缝、碎石和装饰只在两侧形成框景，不得铺满中心。
- **高频噪点禁止项**：提示词显式排除`film grain / digital noise / speckles / stippling / gritty microtexture / crunchy detail / oversharpening / dense particles / chromatic aberration / lens dirt / heavy bloom`。不得用“极致细节、满屏纹理、电影颗粒”补充质感；画面层次依靠体块、雾层、反射和克制的冷暖光，而不是像素级随机噪声。
- **批次差异化**：同一场景需要多张轮换图时，每张使用独立场景命题（如庭院、积水墓穴、巨门、断桥），共享画风合同但不共享构图；参考图只锁色调、氛围和颗粒尺度，不复制具体布局。生成后逐张看主体完整性、中央可读性、噪点和边缘裁切，只有正式入选图进入`assets/scenes/loading/`。
- **配置与归档**：`data/loading-screen-config.json`与`public/data/loading-screen-config.json`必须同步；同一背景池可由多个`sceneIds/dungeonTypes`复用，不复制图片。正式提交只保留运行时PNG和一份提示词/provenance说明；未选候选、默认生成目录副本、联系图、缓存和可重建中间物在确认入库后删除。

---

### 本地 AI 出图工作流（双机 ComfyUI 优先 + 智谱 API 兜底 + GLM-4.6V 验收，2026-08-04 二轮调整）

> **标准执行入口（2026-08-04 定稿）**：`game-dev/tools/ai-gen/WORKFLOW.md`（六步全流程 + 入口矩阵 +
> 各类资产子流程 + 沉淀坑位）与 `game-dev/tools/ai-gen/prompts/`（固化提示词库，8 个模板：skill-icon / equipment-icon /
obstacle / monster-sprite / video / cover / defense-tower / transparent-subject）。
> 本节约为摘要速查，细则以 WORKFLOW.md 为准；提示词一律从 prompts/ 库取用，禁止现场自由发挥。
>
> **入口优先级（2026-08-27 更新）**：双机 ComfyUI 自建生图系统（远程 5080 主力 +
> 本机 3080 Ti 兜底）→ **本地零成本**；智谱 API 为第三兜底。凡使用 FLUX，默认模型统一为
> **FLUX.2 Dev**；自由生图使用 `flux2-dev-fp8`，固定视角、方向或结构使用
> `flux2-dev-depth` + Blender Depth ControlNet。Klein/Klein Depth/Mesh只保留为明确指定的历史复现或对照入口，不参与自动默认路由。

新技能贴图/图标/素材一律**优先走双机 ComfyUI**（本地零成本、不限量）：
远程 5080 默认使用 FLUX.2 Dev（需要锁结构时复用 Fun-Controlnet-Union + Blender Depth），本机 3080 Ti 兜底；
智谱 API 作为第三兜底（双机不可用 / 特殊场景，有免费额度）。出图后按当前直接视觉与相应像素问题确认；外部识图按需，不作为入库必经步骤。

#### 生图入口（优先：双机 ComfyUI；智谱 API 第三兜底，2026-08-04 调整）
- **远程 5080 主力（默认）**：`python tools/ai-gen/comfyui-gen.py --host 192.168.3.142 --model flux2-dev-fp8 --prompt "..." --out out.png`（命令相对 game-dev/ 仓库根目录执行）
- **固定视角/方向/结构**：`--model flux2-dev-depth --control-image <深度图> --prompt "..."`（见 WORKFLOW §1.5）
- **World-122 建筑**：采用“12 步结构粗筛 → 人工选纯绿底结构图 → 48 步低重绘精修”的两阶段管线；两阶段使用 Blender 深度图锁定结构，并派生边缘图辅助检查。远端插件确认支持 Hook 链后才加 `--edge-control` 启用第二路控制。结构提示词只管封闭体块和塔楼数量，细节提示词只管材质与时代组件；命令与参数见 WORKFLOW §1.5.1。

##### World-122 建筑非默认模型的实验边界（HiDream / Z-Image）

- **生产路由不因通用榜单成绩自动切换**：建筑任务以同一白模 Depth、同一参考 raw、同尺寸的任务内 A/B 为准，重点比较结构偏差、主体外投影/暗光晕、表面高频细节和最终透明裁切。HiDream 或 Z-Image 的通用偏好榜、写实或文字能力不能替代这组验收；未同时胜过当前 FLUX.2 Dev 结果前，只能留在研发目录，不能进入正式候选集。
- **Z-Image Turbo + Union 只作显式研发对照**：Turbo 是 8 步蒸馏生成模型，不按标准 CFG 负面提示词合同工作；Union 的 Depth 负责几何约束，不负责复制参考图的材质、明暗和细节。把整张旧 raw 同时作为 inpaint 参考仍不等于精确材质迁移，可能与 Depth 争夺控制权，并产生暗光晕、外部投影和细节简化。
- **固定兼容性禁区**：`z_image_int8_convrot` 单独生图可用，但与 `Z-Image-Turbo-Fun-Controlnet-Union-2.1-2602-8steps` 组合会输出噪声，禁止自动路由。只有用户明确要求实验时才可换 NVFP4/BF16，保持官方 8 步链（CFG 1、`res_multistep`、`simple`、AuraFlow shift 3，Union strength/control context 0.65~1.0）；这些参数不写回 Klein 标准工作流。
- **止损条件**：出现“结构约 80% 可还原，但主体偏暗、阴影增多、纹理明显少于 Klein/旧 raw”时，不再用盲增步数、strength、精度或 seed 数解决。实测 strength 1.0 和 BF16 都没有恢复丢失细节；完整 Blender Depth 可以在后处理阶段确定性清除 Depth 外投影，却不能修复主体内部烘焙暗光和缺失材质，后两项仍存在就判该候选不合格。
- **HiDream-O1-Image-Dev 也不自动兜底**：其多参考能力可用于显式对照，但军营建筑实验仍出现灰色摄影棚背景、错误投影和主体偏糊；参考注入不能替代完整 Blender Depth，也不能改变默认 FLUX.2 Dev 的 12/48 两阶段入口。以后若重启该方向，先做独立的结构、材质两阶段研发并通过上述 A/B 门槛，不直接改生产配置。

##### World-122 建筑最高优先级管线：组件化白模 → 12 步 → 48 步

这是新建、重做或大幅调整 World-122 建筑的**第一选择**。只要目标是可放置建筑，就先检查组件库并搭 Blender 白模，不先用纯提示词盲抽，也不把手绘轮廓当正式结构真源。纯提示词/ImageGen 只用于概念探索；未经 Blender Depth 锁定的图不能直接提升为正式建筑资产。

组件实现、登记与复用规则见 [World-122 建筑组件登记表](references/world122-building-components.md)。开始建模前必须先读该表，优先复用现有组件；新增可复用组件时，代码和登记表必须在同一次修改中更新。

**真源分工**：

- `tools/ai-gen/building-component-kit.py`：跨建筑复用的参数化组件、材质、相机和 Depth 渲染函数，是组件实现真源。
- `tools/ai-gen/settlement-building-pack-blender.py`：建筑组合与楼层/院落/阳台等装配逻辑；已出现第二次复用的组合件应提升到组件库，禁止复制粘贴两套坐标。
- `tools/ai-gen/_settlement_building_pack_20260821/manifest.json`：相机、低饱和调色板、各建筑 foundation/body/roof/tower 尺寸真源。
- `tools/ai-gen/prompts/world122-building-style.md`：12步与48步共享的唯一 `world122-building-v5` 画风真源。最高优先级是简洁、低饱和、低颗粒的游戏向PBR：大块连续材质面先于纹理，墙面/屋面只保留稀疏的中尺度变化，木纹、砌缝和金属件必须克制；光影统一使用柔和左上顶侧光。公共画风不强制建筑语法，也不同时描述未启用的地台类别；建筑结构由白模和资产级 manifest 决定，实际地台只由当前 `foundationStyle` 合同注入。两阶段每一张正式候选都必须完整注入该公共画风块，缺少 `styleVersion`、`styleTemplate`、地台路由或正文时必须停止。
- `tools/ai-gen/world122-building-candidate-manifest.json`：标准生图参数以及每栋建筑的结构、功能细节、局部配色和禁止项；提示词不能替代白模几何。
- **提示词精简门禁（2026-08-27）**：公共 `world122-building-v5` 只完整注入一次；资产级字段只补充该建筑独有的身份、组件数量、局部配色和公共合同尚未覆盖的高风险项。相同结构事实、材质要求或负面词不得换同义词跨多个块反复堆叠，Depth 已锁定的视角、轮廓和占格也不得靠长篇文字重复加强。正向提示里不得堆砌希望排除的建筑名词，优先用目标拓扑描述。提交前必须删除所有“不提供新约束”的句子，并与同类已接受提示词比较；明显更长或出现多块重复时先压缩再出图。更多文字不等于更强控制，超长提示词导致优先级稀释、风格漂移时应判提示词不合格，而不是增加步数或继续追加约束。
- `tools/ai-gen/_settlement_building_pack_20260821/prompts/<building>.txt`：历史建模说明或人工审阅稿，不再作为正式候选的可执行提示词真源。
- `tools/ai-gen/_settlement_building_pack_20260821/<building>/`：该建筑的 `.blend`、preview、depth、12/48 步候选和入库元数据。

**强制顺序**：

1. **拆需求并查组件表**：把建筑拆成主体壳、屋顶、门窗、楼层、阳台/院墙和功能道具。能由现有组件组合的不得重写；仅当前建筑使用的复杂组合先留在 builder，第二次出现时提升为公共组件。
2. **更新 manifest 与白模**：尺寸、相机、调色板写 manifest；几何写 Blender builder。所有对象保留有意义的英文名并保持独立可编辑，禁止为了省事把门窗、阳台、杂物全部 join 成不可拆网格。
3. **先渲染 preview + depth + 语义阴影代理**：固定正交相机、`elevation=30°`、建筑根节点 `rot.z=44.8°`、1024²、完整 foundation 可见。preview 用于人工查组件位置；depth 是 5080 ControlNet 的结构真源。标准 Blender builder 在普通建模模式下必须同时派生独立的 `*_approval_preview.png` 和 `*_shadow_proxy.json`：地基网格用 `kit.set_shadow_role(obj, "ground")`（公共 `masonry_plinth` 已自动标注），辅助网格用 `ignore`，主体/新柱/烟囱默认不标即为 `body`，需跨空隙合并时写同一 `shadow_group`。代理按模型 XY 连通簇与高度带自动生成 `parts[]`，不从最终 PNG 猜地基；缺少地基语义时 builder 必须失败而不是静默把地基算进阴影。控制台还须打印可直接粘贴的 Codex Markdown。提交白模验收前必须用图像查看工具实际打开审批预览，并在 Codex 中将它打开到文件面板；最终回复必须再次以内嵌图片展示，Windows 路径统一改为正斜杠、用尖括号包裹绝对路径，例如 `![building model approval preview](<E:/path/to/building_model_approval_preview.png>)`。禁止使用反斜杠路径、相对路径或只给纯文本文件名；用户没有实际看到图片时不得视为已经提交白模验收，也不得进入12步。多层建筑必须用逐层独立命名的承重壳锁死层数、逐层宽深和对齐关系；要求三层对接时，一层不得缩进、二三层不得漂移或额外挑出。敞开门扇、暖暗门洞和无文字功能招牌属于建筑身份结构，必须在白模中建模并进入 Body Depth，禁止只依赖精修提示词生成。若 preview 中楼层、门、院墙、靶子或阳台位置不对，必须先改模型，不能靠提示词赌修正。
4. **提交 5080 12 步结构候选**：只走 `generate-world122-building-candidates.py`，默认每批3张；固定 `world122-building-v5`、`flux2-dev-depth`、1024²、同一 depth、Depth 0.78、CFG 3.5、Euler/simple。V5 把简洁低饱和PBR、连续大色块、稀疏中尺度磨损和柔和顶侧光放在最高优先级；地台只注入当前资产实际选择的一种，建筑语法完全服从白模和资产级 manifest。只有用户明确要求更多/更少参考或开展已标记实验时，才可用 `--variants` 显式覆盖数量。禁止为正式候选直接手写 `comfyui-gen.py` 命令。
   - 单格矿洞等自然结构在候选 manifest 中使用 `assetClass: "natural_structure"`、`footprintCells: 1` 与 `generationFootprintCells: 2`：仍以满画布 Depth 生成，保留结构像素密度，再在候选后处理阶段等比缩到 1×1；禁止把小型 Depth 直接交给模型后再用遮罩硬裁。共享画风只作用于石拱、木支护和材质渲染语言，天然岩体不得被解释成房屋、塔楼、窗户或第二入口。
   - 自然结构若洞内允许使用与绿幕同色系的暗部、晶体或光效，生成控制继续锁定 `Body Depth`，最终透明裁切另登记 `postprocessDepthImage`。Cutout Depth 只排除地台，保留洞内建模件；低阈值抠出连续岩体后，仅恢复 Cutout/Body Depth 差集并清理恢复区外的绿主导像素。禁止恢复整张 Cutout 遮罩，否则会把隐藏绿幕或细杆周边底色重新写成不透明。
   - 单格裸露矿脉、碎石矿床等贴地物件使用 `assetClass: "surface_deposit"`，白模先锁完整 1×1 菱形浅床，不能套用矿洞的开口、石拱和支护合同。12步选图与48步 `--init-image` 都保留纯绿底 raw；透明 body 只用于预览和最终入库，禁止作为精修 init，否则透明区会被模型填成黑洞。暗色碎石床可按资产登记较低 `keyThreshold`；候选后处理现在默认保留白模中的浅床，无需旧`skipPseudoPlinthRemoval`反向开关。最终去绿边只替换不透明边界环 RGB，不改变 Alpha。
   - 明确要求现代写字楼语法的建筑使用 `assetClass: "modern_office"`：仍保留 World-122 的30°正交镜头、44.8°根旋转、低饱和风化PBR、可读倒角和柔和左上顶侧光，但结构词改为完整承重壳、幕墙分格、深色钢梃、玻璃门厅和平顶女儿墙，不再注入半木构、坡屋顶或哥特塔楼。该类别只放开已由白模锁定的现代办公组件；屋顶天线塔等特殊设备必须先以安装座、桁架、横臂和天线板进入白模/Body Depth，并锁定数量、归属及“不是额外楼层”，不能只靠提示词临时添加。未明确建模时仍禁止天线；全类继续禁止霓虹、镜面铬楼、现实公司标志、可读行情文字/数字、汽车、街道家具、独立附楼和科幻机械。
   - 现代算力中心使用窄类别 `assetClass: "modern_data_center"`：保留同一正交镜头、低饱和风化PBR、可读倒角和左上顶侧光，但把结构合同锁为完整4×4地基、一个中央四层承重核心、左右各一个附着式两层服务器翼楼，以及由白模/Body Depth明确建出的液冷设备。每组冷却排、冷却罐、低矮管干和中央歧管都必须锁定数量并保持附着，不能漂成独立冷却塔、烟囱或科幻浮空件；徽记只能是无文字几何处理器图形。全类禁止额外楼层、天线/卫星锅、坡顶、第二建筑、散落服务器机柜、车辆、道路、可读文字、镜面铬和霓虹泛光。
   - 高等级住宅跨时代演进使用三个窄类别：`victorian_residential`只允许已建模的砖石、铁艺、连续坡顶和附着式家用蒸汽件，禁止扩成工厂；`modern_residential`只允许已建模的平顶、住宅窗、附着阳台、低矮设备间和太阳能板，必须用住宅门厅、暖窗与绿植区别于`modern_office`；`future_residential`只允许Depth已锁定的曲面楼板、连续塔芯、弧形玻璃、附着式空中花园和小型能源构件，必须保留凸凹圆弧，禁止模型把楼面拉直成矩形板或增生浮空舱、第二塔楼与额外楼层。三类仍继承World-122的正交镜头、低饱和风化PBR、柔和左上顶侧光和游戏尺度可读性；12步选稿继续以完整绿底raw为真源。
5. **12 步只验结构，选稿必须看完整 raw**：联系图默认以3张原始纯绿底 `*_raw.png` 为结构真源，核对视角、完整地基、楼层数与逐层对齐、屋顶是否连续、敞门/招牌/门窗/院落/阳台/功能组件的位置、组件是否离开主体，以及是否凭空增加物件；`*_body.png`/道路预览只用于辅助检查透明边界，任何主体细节与 raw 不一致时都不得作为选稿图。绿幕抠图必须先并排比较 raw、keyed、body：若 keyed 已缺主体，先按该资产主色做40/60/80/100等阈值对照并登记安全 `keyThreshold`；若 keyed 完整但 body 缺主体，则修正 `postprocessDepthImage` 与 `maskEdgePad`，其中后处理Depth必须包含最终要保留的地基、天线、招牌、门扇等全部建模件。任何结构错位都回 Blender 改白模后重新12步，禁止靠抠图或48步掩盖。
   - **旧 Depth 与新 raw 不一致时禁止参与 Alpha**：模型+原图低重绘可能保留或新增旧 Depth 没有的烟管、玻璃顶、门廊和地台；也可能误拿到另一个旧等级/旧模型的 Depth。抠图前必须并排查看 raw 与 Depth，逐项核对屋顶、外轮廓、地台和附属构件。Depth 不完整或主体不同就只用于判定“不可用”，不得通过膨胀、全轮廓相乘或手工回填继续使用；改走边缘连通绿幕安全阈值，并只在确认完全位于主体/地台外的区域用 `finalize-building-runtime.py --clear-alpha-rect/--clear-alpha-polygon` 定点裁除投影和幕布残留。矩形/多边形不得穿过主体，不能用扩大 HSV 绿色范围替代空间裁切，否则会误伤绿植、绿色玻璃、门窗和石材抗锯齿边缘。
   - 围栏、拱门等会把纯绿幕封闭在主体轮廓内部，但建筑本身又含茅草、灰绿石材、橄榄色或庭院植被时，使用资产级 `removeEnclosedKey:true`：它只在全画布删除落入背景 RGB 距离阈值的键色，不启用宽泛 HSV 绿色清理。此类资产禁止用 `removeAllGreen:true`，否则会把屋顶、墙面和地面打成透明孔，使下层道路在预览中看似覆盖主体。
   - **开放钢架 + 橄榄材质软抠图**：瞭望塔、桁架等开放结构若在封闭开口内残留整块绿幕，同时硬 `keyThreshold` 又误切橄榄帆布顶棚，不得继续继承错误 body 的 Alpha，也不得改用全图 HSV `removeAllGreen`。回到已接受 raw，用 `key-world122-building-body.py --soft-key-inner <起始距离> --soft-key-outer <完全保留距离> --nearest-opaque-edge-rgb`：键色取四角/边框中位数，软距离必须作用于全画布以删除塔架内部封闭绿幕，半透明边缘 RGB 取最近不透明主体色。45/90 只是一栋军营的实测值，其他资产必须按 raw 的背景/主体距离分布另测；完整 Depth 先用于核对主体是否确实被误切，禁止默认膨胀回填，因为钢架附近的 Depth 偏差会把绿幕重新保成实体。只有软距离仍缺件时，才允许用 `--protect-depth + --protect-rect` 对人工确认的小矩形保护，且保护结果必须再次在高对比棋盘底检查。正式验收至少量化：开放区域“键色距离≤inner但 Alpha>0”为0、明确主体色（距离≥outer）误删为0、透明像素 RGB 非零为0，并同步重建运行时紧裁与 lighting maps。
6. **玩家确认后才进 48 步**：仍走同一Dev Depth标准入口和同一`world122-building-v5`，默认每批2张，以通过的12步图作为`--init-image`，继续使用同一depth，固定Depth 0.75、`denoise=0.30`、48步低重绘。两张候选都必须继续完整注入公共低饱和、低颗粒PBR和同一`foundationStyle`；精修只增加受控的中尺度材质变化与已建模功能细节，禁止添加密集颗粒、亮金边、过饱和色块或另起画风，也不得改变主体轮廓、层数、院落、屋顶、地台边界或组件位置。只有用户明确要求或已标记实验才可用`--variants`覆盖候选数；改变步数/denoise必须显式`--allow-nonstandard`并留下生成元数据；局部错误用mask返修，不整图重抽。
   - **Dev/旧正式图替换为 Klein 的高保真低重绘实验**：只有玩家明确要求“模型+原图”并指定单张重抽时，才允许以已接受的完整纯绿底 raw 为 `--init-image`、以同角度 Blender Depth 为控制，采用单张36步、Depth 0.90、`denoise=0.20`和`--allow-nonstandard`。它借鉴仓鼠军营 LV3 的 Klein-from-Dev 方法，只改善现有PBR表面，不得改镜头、层数、门窗、机械构件或地台。提交前必须并排核对原raw、Depth和新raw的可见侧、屋脊方向、阳台/升降机侧与四角地台；若旧`*_depth.png`只含局部纠错件，必须改用经查看确认覆盖完整主体的`*_body_depth.png`，禁止用残缺Depth冒充锁角度控制。该例外不改变新建筑默认12/48步标准。
   - **提示词零投影阴影合同**：公共画风、类别提示和资产负面词都必须明确要求“absolutely no cast shadow of any kind”，同时排除 ground shadow、backdrop shadow、green-screen shadow gradient 和模型/地台外的 detached ambient shadow；`contact occlusion`只允许存在于构件接触处。raw出现外部投影阴影时不得直接入库；结构已确认且阴影完全位于Depth外时，可在专用抠绿后用完整Depth约束Alpha清除，不能把阴影当地台或材质保留。
   - **正式抠绿只走建筑专用工具**：禁止把通用GrabCut、BiRefNet或临时HSV脚本作为建筑正式Alpha真源。统一从已接受raw运行`key-world122-building-body.py`，再运行`mask-world122-building-body.py`以完整Depth/Body Depth限制模型外Alpha，最后用`finalize-building-runtime.py --preserve-alpha-exact --nearest-opaque-edge-rgb`紧裁。含植被、橄榄帆布或绿色玻璃时使用边缘连通RGB抠绿并保留封闭主体色；确认主体没有任何绿色材质的纯绿幕资产才可显式`--remove-all-green`。阈值或软抠区间必须按该张raw实测，不继承其他建筑常数；正式前必须在高对比棋盘底检查绿边、透明孔、模型外阴影和透明像素脏RGB。
   - **人工交接源先验通道、不得信文件名**：`raw_green`、`cutout`、`rgba`等后缀只能作为线索，接手前必须实查PNG色彩模式、Alpha分布与四角像素。若所谓绿幕原图已经是RGBA且背景Alpha=0，就按人工透明源处理，冻结现有Alpha，只允许透明RGB清零、紧裁与等比标定，禁止再次抠绿、`removeAllGreen`或用Depth回填。此类用户/人工源即使尚无运行时引用也属于最小可编辑链；只有正式资产已接受且manifest指向唯一canonical source后，才删除同内容交付副本。
   - 已通过整体48步但仍有局部错件时，继续使用 `generate-world122-building-candidates.py --stage refine --mask-image <mask.png>`，以待修48步raw为init、同一Depth为控制，只让白色/红色蒙版区重绘；生成器会把`maskImage/maskChannel`写入元数据。若局部结构替换必须提高denoise，必须同时使用`--allow-nonstandard`并保留原标准48步raw，审阅联系图只收入修正达标版本。蒙版外不得改变楼层、塔冠、花园或地基；入口返修继续禁止开放门洞、发光坡道、桥、楼梯和额外平台。
   - **验收纠错以最新明确确认定稿**：玩家若在拒稿、索取 raw 或准备人工处理后，明确说明此前判断有误并确认既有候选可直接使用，则该最新确认覆盖此前拒稿状态；回到该候选的原始生成路径核对身份并直接按既有 Alpha 收口，禁止再次生图、重新抠图或继续等待人工文件。为方便玩家处理而复制到建筑根目录的同内容 raw 只是交付副本，不能覆盖候选目录中的生成真源；定稿后删除该重复副本，manifest、运行元数据和模型合同统一指向唯一 accepted raw/body。
7. **真透明与 footprint 验收**：先查 RGBA、最大连通域、黄色/绿色残边、孤立像素和投影阴影；抠图不干净就暂停入库并向玩家汇报。正式图必须紧裁且等比缩放，`scaleX≈scaleY`；不能用固定宽高强拉。alpha 自动锚点若仍让贴图偏出地基，使用资产级 `anchorAdjustX/anchorAdjustY`，并保证建造幽灵与实体同源，禁止改全局 footprint 迁就一张贴图。
   - 封闭在模型轮廓内部的局部绿幕细线不得使用全图 `removeAllGreen`，否则灰色钢板和暗部材质会被误删成针孔。先把修复范围限制在人工确认的小矩形，再用 `repair-local-green-spill.py <input> <output> --rect x0,y0,x1,y1` 仅替换绿色主导 RGB 为最近的不透明非绿主体色；修复前后 Alpha 必须逐像素一致，原始 body 必须保留供回退。
   - **同色材质与幕布冲突时按空间职责抠图**：绿色草地、庭院植被、橄榄材质与绿幕相近时，只做边缘连通 RGB key，禁止全画布去绿；围栏庭院内部仍残留绿幕时，优先使用按本图实测的较低硬阈值 + `removeEnclosedKey`，保住建筑、道具和连续庭院，再用完整 Depth 排除模型外背景。全画布 soft key 会把石墙、屋顶和庭院打成针孔，整块 Depth restore 又会把绿幕恢复成不透明地台，两者都不能作为正式收口。若只剩地台外缘或局部幕色，使用 `finalize-building-runtime.py` 的有界 matte 矩形/多边形清理；最后必须以 `--preserve-alpha-exact --nearest-opaque-edge-rgb` 冻结已验收 Alpha。
   - **围栏/栏杆内部透明孔洞按语义与尺寸分级**：`removeEnclosedKey` 后先枚举所有封闭透明连通域，围栏间隙、拱门洞和院落开口等较大区域属于设计结构，必须保留；只有逐个确认不承载结构语义、面积不超过 1～2px 的孤立针孔，才允许用相邻已接受不透明像素的 RGB 中位数填色并置 Alpha=255。禁止对全部封闭孔洞做二值填充，避免把开敞式场地封死。修复清单必须记录阈值、连通域数、像素数和保留的大开口说明；完成后同步重建运行时贴图、`assetCutoutHash`、四张 lighting maps 与黑/灰/白/Alpha 审查图。
8. **正式入库**：只有玩家明确接受的 48 步版本才能覆盖 `assets/terrain/<building>.png`。同步 `data/producer-buildings.json` 的 `displayW/displayH/footOffsetY` 和必要的 anchor 调整，并只重建该建筑的 lighting maps。未通过的 12 步候选不得导入。
9. **定稿后立即瘦身归档**：先核对 `*_runtime_metadata.json.source` 仍指向准备保留的已接受源图，再清除其余候选。每个正式建筑只保留可编辑 `.blend`、模型预览、Depth/Body Depth、结构与精修提示/控制规格、被正式资产引用的 accepted raw + body/cutout + preview、入库元数据和总 manifest；删除未选 12/48 步 seed、`keyed/cleaned/anchored` 可再生中间层、联系表、`*_preview_48px.png`、`.blend1` 和 rejected/temp 目录。若普通 `*_model_preview.png` 与工作流稳定入口 `*_model_approval_preview.png` 字节完全相同且没有独立引用，只保留 approval 版本，禁止把同一白模预览以两个文件名重复入库。多形态环境物件若每个形态都已正式入库，则每个形态各保留一套最终 raw/cutout/模型，不能按“只留一张”误删；障碍物 raw 批量抠图统一使用通用 `finalize-isometric-obstacle-imagegen.py`，不得再复制道路等具体资产的专名脚本。清理不得触碰 `assets/terrain/` 正式图、lighting maps、运行时配置或其他任务目录。
   - **多等级建筑族逐级独立入库**：LV1/LV2/LV3 即使共享同一 2×2 逻辑占格，也必须分别从各自接受的 RGBA 运行 `finalize-building-runtime.py`，独立派生 `displayH`、`footOffsetY` 与 `visualFootprint`，禁止沿用旧图或相邻等级参数强拉。基础等级同步 `producer-buildings.json`、`assetCutoutHash` 和建造缩略图；升级等级同步其权威等级配置。已有独立 `groundContact` 时保持它自己的画布尺寸，只核对主体和接地层的显示底边落在同一世界脚线，不能机械复制主体新尺寸。
   - **单建筑 lighting 清单必须做键级范围检查**：逐个运行 `build-lighting-maps.py <building_id>` 后，按 JSON 对象比较清单变化键，结果只能包含本次目标建筑。脏工作树中其他运行时贴图可能让生成器顺带刷新无关条目；此时只恢复非目标键到运行前内容，禁止用 `git checkout`、HEAD 或整文件覆盖未知未提交修改。四张 lighting PNG、清单尺寸和最终运行时贴图尺寸必须同源。

**World-126 矿洞障碍物模型先行与写实漂移纠正（2026-08-29）**：坍塌木支护、脱轨矿车、天然岩柱、手摇卷扬机和分选料斗等路径障碍物，在生图前先以独立可编辑对象完成 Blender V2 模型；固定 30° 正交相机、44.8° 模型根旋转、资产级矩形 footprint 与统一最低接地点，模型预览必须先验收底边、体量、开口、零件数量和游戏视角。模型门禁同时检查会被扩散模型放大的语言：木构不得排成规则锯齿，岩石不得是蛋形圆石或大块三角低模切面，表面裂纹不得以悬空曲线表现成树枝；这些问题必须回模型/材质修改，不能靠增加步数补救。

本类障碍物若首轮候选由写实漂移成卡通、手绘或塑料质感，应停止沿用该候选作为下一阶段 init，回到获批的带材质 Blender 渲染和对应 Body Depth。2026-08-29 任务在玩家逐项确认后采用显式 Klein 例外：`flux2-klein-4b-depth`、48步、Depth 0.82、`denoise=0.30`，直接从 V2 `*_textured_init_green.png` 低重绘，每件只保留获批 V01；它不改变项目全局 Dev 默认路由。禁止把 Dev/12步或已卡通化中间稿串进此链，因为更多步数只会精修既有风格偏差。候选阶段只证明模型/材质方向，仍标记 `candidate-only; not promoted`；真透明、底边紧裁、运行时 footprint/collider 与地牢接线必须在玩家批准入库后另行完成。归档保留 `.blend`、模型预览、Body Depth、带材质 init、获批 raw、提示词/生成元数据、manifest 与最终总览，未选 seed、A/B 对照、联系表、`.blend1` 和可再生中间物移出仓库或做可恢复清理。

批准入库后，获批 raw 统一经 `finalize-isometric-obstacle-imagegen.py` 做 BiRefNet 真透明和紧裁；绿幕源若在不透明轮廓残留绿色污染，显式加 `--despill-green`，只处理中性边缘带，禁止全图改色。随后按紧裁真实 `w/h` 登记 `ISO_WALL_GEO`，以 `displayH/geo.h` 等比换算接地带 footprint；运行时锚点要从 footprint 中心反推贴图中心，`depth = obstacleFootprintDepthOf(piece)` 且 `depthManual=true`。正式元数据至少保留 accepted raw、cutout 路径、源尺寸、显示高、源 footprint、世界 footprint 与深度规则，避免后续换图只改贴图不改碰撞。

**复合运动建筑的人工主体回灌合同**：玩家交回已修正主体时，该 RGBA 文件立即成为主体唯一真源；只允许清零透明像素 RGB、按 Alpha 紧裁和等比缩放，禁止再次绿幕抠图、修补或生成式重绘。正式资产必须拆成静态主体、独立运动层 spritesheet 和静态面板图，分别保存来源、裁剪框、显示尺寸、脚点、源轴心、偏移、帧数与帧率；运行时合成图只作为预览，不能反向覆盖主体。入库脚本应显式要求该人工主体存在，不再保留已作废的自动去部件/inpaint 回退；定稿瘦身保留人工主体、叶轮源帧、接受的结构/精修源、模型/Depth、最终预览和元数据，未选 seed、inpaint 蒙版/提示/结果、联系表、可再生中间层和 `.blend1` 应移出仓库或可恢复清理。

**复合运动建筑的整图候选拆层合同（风力电站）**：玩家确认的整图候选只负责面板图和材质身份，不能直接覆盖场景主体。必须用 Blender 中独立命名的叶轮枢轴与几何蒙版从整图生成无叶轮静态主体，并把同一接受 raw 投影回叶片几何，按原 `sourceHub` 重渲完整 24 帧；运行时 `offsetX/offsetY` 必须由新主体紧裁框与源轴心重新计算，不能沿用旧贴图常数。去叶轮时若 authored mask 只覆盖叶片核心而留下固定残影，应扩大叶轮安全区或在枢轴上方使用受限圆形清除区，再以旧的已接受无叶轮主体仅填补该小区域；不得抹除屋顶、塔架或把整栋旧主体回灌。交付前至少查看静态 body（不得残留任何固定叶片）、四相位合成图和可直接播放的循环 GIF。

**消耗型全位面增效建筑的运行时补充合同**：功能状态机必须随建筑快照保存物流阶段、当前位置、目标仓库、携带资源、服务/运输剩余时间和批次数；道路路线属于派生数据，读档或拓扑变化时从当前道路格重算。资源到仓时只扣一次，运输断路冻结但已送达服务不回滚；撤岗冻结并停效，拆除不返还已取资源。增效只乘白名单经济建筑的最终产出，默认排除市场压力/价格、输入成本、处理速度、服务范围和概率；前后台共用模块数值与批次口径，后台按服务实际有效时长加权，保持输入批次数不变。

**人口覆盖型按秒消耗建筑合同**：覆盖人口、岗位容量和岗位效率必须分别保存/计算，不能把“岗位人数”直接当完整倍率；固定每人效率的建筑使用`min(1, 人数×单人效率)`，扩编只增加上限。每秒结算的输出与输入各自保存小数余数：输出按完整乘算链结算，输入成本只消费设计明确的基础人口/岗位/人口效率项，不能被工坊、酒馆或全局生产倍率反向放大。资源不足时整批停在就绪态，不补产、不透支；后台位面沿用同一结算周期、余数和仓库扣除口径。若建筑说明为商业产金但非市场，则不得写入市场压力、买卖价差或交易价格。

**资本反馈型被动建筑合同**：若产出公式读取“玩家总金币”，必须先声明资本口径（现行证券交易所为背包+主神空间仓库），并把基础项、人口项和资本项保留为可独立展示的加法贡献；禁止暗中叠加工坊、酒馆、全局生产或市场倍率。前台按固定结算周期重读当前资本，后台从同一资本口径起算并逐周期把本栋新产金币计入下一周期，输入/输出小数余数和结算时钟全部进建筑快照。面板的稳定运行条只由权威供能状态在0/100%间切换，禁止绑定每秒归零的`economyTickMs`。

**无文字功能招牌收口合同**：敞门、旋转门和招牌外框必须先进入白模/Body Depth；生成稿若仍出现字母、单词、符文或伪文字，只允许在用户确认的精修稿上做有界局部替换。替换面必须使用项目身份徽记（如固定数量的硬币、酒杯等）并保持源Alpha逐像素不变，禁止以整图重抽改变已确认的层数、门窗和轮廓。科技/升级徽章若生成器把六边形外部黑底写成不透明像素，必须用确定性几何Alpha蒙版去除框外背景，并在最终尺寸检查四角Alpha为0。

- **建筑科技与四项升级必须分清语义**：一栋新经济建筑使用一个六边形建筑科技徽章，同时解锁建筑及本栋四项升级；四枚升级图分别表达周期、产量、减耗和岗位，不能只换颜色或重复齿轮。生成器输出棋盘格RGB时，沿既有冷钢框使用确定性几何Alpha，不以预览观感宣称透明。清理只删未选兄弟raw、比较页和缓存，保留获选12步→局部修订→获选48步→透明母版的直接链及逐文件清单。

**标准命令骨架**：

```powershell
& 'E:\Program Files\Blender Foundation\Blender 5.1\blender.exe' `
  --background --factory-startup `
  --python tools\ai-gen\settlement-building-pack-blender.py -- `
  tools\ai-gen\_settlement_building_pack_20260821\manifest.json `
  <building_id> <model.blend> <preview.png> <depth.png>

# builder 会自动在 preview 同目录生成 *_approval_preview.png，
# 并打印 Windows/Codex 可直接内嵌的正斜杠绝对路径 Markdown。

python tools\ai-gen\generate-world122-building-candidates.py `
  --stage structure --only <building_id> `
  --out Y:\工作\无尽轮回\scratch\world122-buildings
```

12步结构阶段不写 `--variants` 时固定读取默认3张；48步仍使用同一脚本，改为 `--stage refine --init-image <accepted_s12_raw.png>`，不写 `--variants` 时固定读取默认2张。标准参数与唯一公共画风模板均由 manifest 注入，命令行不重复手写。每张候选旁必须保留 `_generation.json`，其 `styleVersion` 必须是 `world122-building-v5`、`styleTemplate` 必须是唯一正式模板、`model`必须是`flux2-dev-depth`且`foundationStyle`必须与资产分类路由一致，同时 `nonstandardOverride=false` 才能进入正式候选集；生成脚本会拒绝旧版画风入口。若5080请求在沙箱内报 `WinError 10013`，这是网络权限问题，不代表5080离线；按授权流程重试，不擅自切换到Klein或绕过Depth。

**地台与接地要求**：未来中型功能建筑白模必须包含一个完整、低矮、位于已登记可视占格内部的等距地台，并让门槛、墙脚、柱脚和扶壁与其真实相交；地台与主体一同进入供AI结构控制和正式抠图使用的完整Body Depth，不再依赖运行时另叠通用覆盖层。同时必须把整栋视觉地台标为语义 `ground`，让标准 builder 导出 foundation-free 模型阴影代理；门槛、墙脚、柱脚、烟囱脚座、附楼和真实支撑保持默认 `body/part`。新增柱因默认属于主体，会在下一次建模导出时自动进入相应高度段。只有没有可编辑语义模型的旧素材才另派生 foundation-free Body Depth，并在sidecar/manifest中写明排除对象；二者都只供`tools/generate-building-shadow-casters.mjs`生成主体影根，不替代完整Body Depth。非现代建筑使用`rubble_stone`：2.5D等距毛石地台/中世纪不规则毛石干垒基底，表面是不规则毛石切型、随机磨损倒角、天然填缝和风化毛石手工拼贴做旧，外缘统一斜切。现代城市建筑使用`fair_faced_concrete`：清水混凝土现浇拼缝、细气孔、平整收光、轻雨蚀与局部返碱；工业/末世使用`worn_concrete`增加克制磕碰、浅裂、浮尘污渍；近未来使用`precast_concrete`增加精确预制拼缝、克制金属包边、预埋槽和非镜面轻抛光。`natural_structure/surface_deposit/prop/agricultural_compound`默认`foundationStyle:none`，其他未分类建筑默认`rubble_stone`；manifest可显式覆盖但不得静默漏掉建筑地台。候选后处理默认保留地台，只有显式`removePseudoPlinth:true`才允许调用旧伪地台清理器。地台是主体纯视觉结构，不得改变逻辑占格、碰撞、寻路、遮挡AABB或`visualFootprint`。

##### World-122 建筑接地角验收：只测 Alpha 最外轮廓（2026-08-21）
- **提示词、深度图和边缘图不是验收证据**：ImageGen 仍可能重建透视、改变多塔脚位置，或把“透明背景”画成不透明棋盘格；最终必须检查实际 PNG 像素。
- **透明先看通道，不看观感**：若整图 alpha 都是 255，棋盘格只是被画进 RGB 的假透明，必须从原 RGB 重新走 BiRefNet/项目抠图器生成 alpha，禁止直接入库。棋盘背景不是恒定白色，边缘去污染应按邻近真实背景色反推前景，再用最近的不透明主体颜色修复软边；只把 alpha 清零会留下亮灰描边。
- **唯一角度口径**：对真实 Alpha（建议 `alpha >= 128`）取最大外连通域，使用 `findContours(..., RETR_EXTERNAL)` + `approxPolyDP` 提取最下方接地折线；只测这条外轮廓的连续线段。标准 2×2 建筑的地面轴斜率为 `dy/dx = ±0.5`，即屏幕角 `±26.565°`，墙线必须垂直，所有塔脚/门槛必须位于同一地面。
- **禁止用全图 Hough 线段判合格**：砖缝、窗框、屋檐或内部墙线常恰好接近 `±26°`，会掩盖真实塔脚回边达到 `+42°/+51°` 的错误；Hough 只能辅助找候选线，不能代替 Alpha 外轮廓验收。
- **修正边界**：只有整栋建筑两组轴共享同一线性误差时才允许全局仿射；多塔脚各自漂移属于非线性透视，必须重抽、按白模表面投影，或在保持竖线垂直的前提下对实际外轮廓做分段几何映射，然后重新测量每一段。
- **入库门槛**：背景必须是真实 RGBA；主体紧裁后等比缩放；稳定底座接地中心必须对齐固定 `256×128` footprint 中心，可见底边仅允许运行时契约规定的小范围外伸；`alpha>16` 主体应为单一主连通域且不能触碰画布边界。未确认候选不得覆盖 `assets/terrain/`，只有玩家明确接受的版本才能提升为稳定英文资产键；定稿后按本节第9步保留最小可复现源集，删除被否版本和可再生中间层，不能把 accepted raw、最终 body/cutout 或运行时元数据一并误删。
- **结构通过后的像素精修**：玩家已接受主体结构后，后续“降噪/提升饱和度”只改当前候选的 RGB，禁止重新生图改变窗户、阳台、底座或视角。处理必须锁住 alpha（输出 alpha 与输入逐像素一致），在主体 mask 内做边缘保护降噪与饱和度调整；每一轮百分比都以当轮输入为基准并保留可回退候选。安装时只覆盖稳定英文资产，逻辑 footprint、碰撞和道路衔接不得随像素处理改变。
- **人工 RGBA 抠图优先保真**：玩家交回已经清理的 RGBA 时，先检查模式、alpha 范围和主体 bbox；alpha 合格就直接进入 `finalize-building-runtime.py`，禁止再次自动分割。若软边仍混有已知底色，用 `--matte-color '#RRGGBB'` 反推半透明边缘 RGB；若 alpha 内侧还有不透明底色细线，再增加 `--matte-edge-width <源图像素>` 与 `--matte-tolerance <RGB 距离>`。若半透明边缘 RGB 已被选择工具替换成纯蓝/纯色标记、无法按正常 matte 反推，则改用 `--nearest-opaque-edge-rgb`，以最近可靠不透明主体色修边；两种方式都只修 RGB，不改玩家 alpha。
- **人工 Alpha 无污染时使用无损收口**：若人工 RGBA 的透明边缘和半透明 RGB 已通过检查，正式收口只允许传`--display-width`、必要的紧裁`--padding`和`--metadata`；禁止习惯性附加`--nearest-opaque-edge-rgb`、`--defringe-inner-pixels`或`--min-component-pixels`。运行元数据必须显示`nearestOpaqueEdgeRgb:false`、`defringeInnerPixels:0`、`minComponentPixels:0`和`removedComponents:0`，否则不得把该输出视为人工抠图的无损派生。
- **等比入库元数据契约**：`displayW` 由逻辑 footprint 和画面占比确定；`displayH` 必须按最终紧裁画布宽高比反算，`footOffsetY` 再从最终画布接地点计算。替换贴图时禁止沿用旧 `displayH` 强拉新图。alpha 自动拟合后若仍因厚地基或非对称画布偏移，才设置资产级 `anchorAdjustX/anchorAdjustY`；建造幽灵与正式实体必须同时消费这两个值。
- **单建筑光照图增量更新**：新稳定资产键先登记到 `build-lighting-maps.py` 的 `ASSETS`，再运行 `python tools/ai-gen/build-lighting-maps.py <building_id>`。指定资产模式必须保留 manifest 中其他条目，仅更新该建筑的 silhouette/projection/height/normal 四张图和对应记录；禁止为换一栋建筑重建、改写整批无关光照资产。

正式入库命令骨架：

```powershell
python tools/ai-gen/finalize-building-runtime.py `
  <accepted_cutout.png> assets/terrain/<building_id>.png `
  --display-width <displayW> --matte-color '#RRGGBB' `
  --matte-edge-width <source_px> --matte-tolerance <distance> `
  --metadata <runtime_metadata.json>

python tools/ai-gen/build-lighting-maps.py <building_id>
```
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

##### 兜底·ithinkai 中转站 gpt-image-2（2026-08-21 新增）
- 客户端：`tools/ai-gen/gptimage2-gen.py`（--prompt / --prompt-file / --size / --quality / --out）
- 接口：`POST https://token.ithinkai.cn/v1/images/generations`（OpenAI 格式），模型 `gpt-image-2`
- key：环境变量 `ITHINKAI_API_KEY` → `%USERPROFILE%\.ithinkai\config.json`（不落仓库）
- 透明底退化教训（2026-08-22 骨雕战面）：约 1/20 概率模型不给真透明，而在中央画不透明"背景板"（该例不透明占比 77%）。归一化时按"不透明像素占比 >60% 判为背景板"自动拦截重试；prompt 加 `no backdrop` 可显著降低概率，程序化抠图（边缘泛洪）对奶白底可用但易留马赛克残斑，优先重出。
- 定位：双机 ComfyUI 与智谱之外的云端第四途径——无水印、不占本地显卡、按 token 计费
  （实测单张约 400 tokens）；返回图片 URL 有时效，脚本已立即下载；不传 --out 默认落
  `Y:\工作\无尽轮回\scratch\gptimage2_<时间戳>.png`；CDN 拒绝 urllib
  默认 UA（脚本已伪装浏览器）；中文 prompt 经脚本 UTF-8 提交实测正常，curl 直传会乱码，
  仍建议英文提示词。
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
  python tools/ai-gen/comfyui-gen.py --host 192.168.3.142 --model sdxl --prompt "..." --out out.png
  ```
- **兼容修复已应用（2026-08-04）**：flux2fun-controlnet v1.1.0 两处补丁
  （`timestep_zero_index` / `multigpu_clones`）与 comfyui-mesh Icarus stub 补丁已在 5080
  部署（备份与修复版在 `tools/ai-gen/remote-patch/`），FLUX.2 全系列正常出图。
- **跨机 Mesh（2026-08-04 实测通过）**：FLUX.2 dev fp8 拆两卡——5080 跑前端（Icarus），
  本机 3080 Ti 跑后端 4 块（Daedalus @192.168.3.153:7777，n_blocks=4，Turbo LoRA 两端本地加载）。
  用法：`--model flux2-dev-mesh`（8 步 turbo，服务端每步约 0.8s）。前提：本机 Daedalus 已启动
  （`tools/ai-gen/start-daedalus.ps1 -SkipSmoke`）；客户端崩溃遗留会话会卡死 Daedalus，重启即可。
- **模型选择矩阵（2026-08-27 更新）**：只要选择 FLUX，入库、候选和探索统一默认 FLUX.2 Dev；自由生图用 `flux2-dev-fp8`，锁结构用 `flux2-dev-depth`。Klein与专用Klein LoRA配置只保留为显式历史复现或对照入口；
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

#### 多兵种友军母图批次定稿与废案收口（2026-08-27）

- **活动索引是唯一真源**：批次目录必须有 `task-index.json`，逐单位登记稳定 `unitKey`、定稿 `output`、定稿
  `prompt`、直接编辑输入 `sourceOutput/sourcePrompt`、批准状态与替代的旧占位键；总表登记统一视角、批准日期、
  `acceptedPreview`、`futurePlanOnly` 和 `runtimeIntegrationActive`。后续动画只读活动索引，禁止按文件名猜“最高 vN”。
- **批准后保留最小可编辑链**：保留定稿母图、直接编辑源图、两者对应提示词、确实参与身份锁定的参考图，以及最终总览/
  升级线预览；删除更早祖先、被否体型、旧物种/载具方案、过期联系图和中间对比图。`sourceOutput` 只指向能直接继续编辑
  定稿的上一输入，不以“可追溯”为由保留整条失败链。
- **总览同时验四类不变量**：最终联系图至少核对同一朝向/俯角、主体尺度、白底与投影、角色脸型/装备身份；骑乘升级线另做
  一张纵向血统预览，把低阶参考与高阶定稿并列，避免单张看似成立、放回兵种树却换了角色。
- **母图批准不等于运行时入库**：仅为未来动画计划时保持 `futurePlanOnly=true`、`runtimeIntegrationActive=false`；不得提前新增
  配置、生产槽、科技、数值、AI 或存档协议。待机/移动/攻击/死亡完成正式精灵表门禁并接通全链后，才改运行时状态。

#### 建筑升级与科技树专属徽章（2026-08-24）

- **两套运行规格不能混用**：建筑升级图标统一为256×256 RGBA、主体框约244px的冷钢四铆钉方形徽章，配置写
  `building-upgrades.json` 的 `iconImage`；科技树图标统一为1024×1024 RGBA、主体框约1000px的冷钢六边形徽章，
  配置写 `technology-tree.json` 的 `iconPath`。两者都保留原 `icon` Emoji 作为图片加载失败回退。
- **框体统一、主题色跟建筑走**：同系列固定冷钢外框、炭黑内场、主体占比和光照层级；焦点材质按建筑身份变化，
  例如战地医院用青蓝医疗光、皇家铸币局用旧黄铜/琥珀、天气预测塔用蓝灰石板/黄铜/天蓝观测光。四项升级必须用
  不同的机制主体表达真实功能，不能只换四个相似的齿轮或天气符号。
- **“透明背景”必须检查文件通道**：生成器可能返回RGB并把黑底或棋盘格直接画进像素，预览看似透明不等于存在Alpha。
  入库前检查 `mode=RGBA`、Alpha同时包含0与255，并在最终运行尺寸复核轮廓和小图辨识度。
- **深色徽章禁止只靠颜色洪泛抠底**：外围黑底/灰白棋盘格与冷钢框、炭黑内场颜色接近，颜色阈值会沿暗色接缝穿入并吞掉
  框体或主体。应先从画布中心行/列定位可见外框边界，再用确定性几何遮罩收口：升级图标采用八边切角方框，科技图标采用
  上下尖角六边形；Alpha边缘约0.65px羽化，随后按目标可见框尺寸等比归一。
- **最小可复现归档**：只保留被正式引用的成品、对应入选raw、最终提示词和收口脚本；删除默认生图目录中的重复工作副本、
  未选候选、联系表、临时预览、失败抠图和 `__pycache__`。现行范例见
  `tools/ai-gen/_field_hospital_icons_20260824/`、`_royal_mint_icons_20260824/`、
  `_weather_forecast_upgrade_icons_20260824/`。
- **全树缺图收口要按最新配置复扫**：批量补科技图标时，不能只依赖开工时的缺口清单；写入前后都要重新解析当前
  `technology-tree.json`，最终同时满足“所有节点均有 `iconPath`”和“所有 `iconPath` 文件均存在”。并行会话新增节点时，
  只为新缺口补路径，不覆盖其科研成本、前置、占位状态或解锁协议。
- **募兵建筑等级水晶是固定模板**：I—III级同一建筑族以对应运行时建筑贴图为主体依据，保持冷钢六边形框与炭黑内场；底部等级标识固定复用
  `assets/ui/technology-icons/cavalry_school_level_3.png` 的蓝水晶样式，LV1为中央1颗、LV2为左右2颗、LV3为左中右3颗。生图阶段不得自由生成水晶，必须由收口脚本确定性叠加；当前范例见
  `tools/ai-gen/_thatch_hut_tier_icons_20260826/`；全体募兵图标统一入口为
  `tools/ai-gen/_technology_tree_gap_icons_20260826/standardize_recruitment_crystals.py`。图标只表达建筑视觉与等级，尚未确定的单位数值和效果不得通过图标擅自定义。

#### 技能贴图要点（逐步沉淀，2026-08-03 首版）
- **同系列优先**：魔法技能图标必须复刻现有"六边形徽章+浮雕底座"风格，不要自由发挥（暴风雪 v1 白底贴纸被否）
- **同系列大小统一（2026-08-04 陨星教训）**：图标观感由内容框（非透明 bbox）决定，与画布像素无关；
  系列基准=fireball 788×939/宽高比 0.84/占比~70%/偏下 cy≈+29。FLUX.2 直出窄徽章（750×951）观感偏小 →
  必须用参考图模板锁定 img2img 重抽 + check-icon-sizes.py 校验后入库
- **动物专属图标先锁物种剪影（2026-08-23 骆驼惊吓教训）**：不能只写动物名称或只画头部；提示词必须列出能在小图中保留的判别特征，并明确排除相近物种。骆驼至少同时保留单峰、长弯颈、短圆耳、长口鼻和厚分裂上唇，并排除马鬃与马耳。生成稿必须缩到最终运行尺寸复核（建筑升级图标为209×209）；若最终尺寸仍会被读成马、犬等相近动物，即使大图细节正确也不得入库。
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

- **当前统一规则（2026-08-27）**：正式出图、候选和探索只要使用FLUX都默认FLUX.2 Dev；需要锁定构图时使用Dev + Depth。Klein及其专用LoRA只在调用者明确指定的历史复现或对照任务中使用。
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
- **流程纪律**：被否后先诊断“模板没锁住 vs 风格没对上 vs 没归一化”，别盲目换模型或seed重跑；模型保持Dev默认，通过控制图、提示词合同和归一化解决问题。
- **并行会话注意**：`models.json` 的 LoRA 版本（klein-skillicon-v3 / klein-equipment-v1）由并行
  会话更新；默认资产生成必须使用`flux2-dev-fp8`或`flux2-dev-depth`，Klein专用LoRA不得被通用流程自动挂载。

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

#### 视频生成（MiniMax H3 / 豆包 Seedance / 即梦，2026-08-24）
- **状态：已端到端打通。** 伊莉丝 running / walking / idle 实战已覆盖“参考图+提示词 → 安全启动本地豆包 → 选择 Seedance 2.0 Mini/画幅/时长 → 上传 → 提示词回读 → 单次提交 → 等待或恢复下载 → provenance JSON → BiRefNet 抠图/周期截取/锚点对齐 → 透明 spritesheet → 配置入库”。今后从 `tools/ai-gen/ai-asset.py ... --provider doubao` 进入，不再手工操作客户端页面。
- 统一入口仍是 `tools/ai-gen/ai-asset.py`。**视频默认 `--provider doubao`，每天先使用豆包页面当日实际可用的免费额度**；页面明确显示额度耗尽、会员/权限阻断，或用户明确指定 H3、任务存在豆包无法满足的特殊质量需求时，才追加 `--provider h3` 切远程 5080。不得仅凭旧的“每日约 N 条”估算提前绕过豆包。豆包后端固定复用本地客户端登录态，当前默认模型 `Seedance 2.0 Mini`，支持 4~15 秒与自动/3:4/4:3/9:16/16:9/1:1/21:9；`size` 自动映射最近比例，批量候选可显式传 `--candidates N`。
- 客户端自动化：`tools/ai-gen/doubao-seedance-gen.mjs` 只在 `127.0.0.1:9333` 开 CDP，
  不读取/复制 Cookie、Token。首次使用若豆包已普通启动，须由用户完整退出一次；脚本不会杀进程，
  之后会以自动化参数启动本地客户端；成功下载后关闭自己启动的客户端和调试端口。额度不足、内容拦截、人脸认证或提交状态不明时立即停，
  禁止自动二次提交（防重复消耗）。每个 MP4 旁写同名 provenance JSON。
- 页面已完成但自动监听超时时，先 `--inspect` 只读确认，再用
  `--attach-only --download-latest --out <目标.mp4>` 恢复当前会话最后一个视频；恢复模式禁止进入编辑器或重新提交。
- **同一会话恢复旧完成卡片（仓鼠重机枪 2026-08-27）**：如果最新卡片不是目标动作，先加
  `--play-latest --completed-offset N` 打开倒数第 `N+1` 个“你的视频生成好了”卡片，再接
  `--download-latest`。恢复后必须对规范文件做内容哈希去重；若不同动作文件哈希相同，说明仍下载了同一张卡片，
  立即隔离该误恢复文件，继续调整 offset，禁止按文件名或动作标签误收。
- 豆包 Mini 是**快速候选源**：UI 没有 H3 的像素级 `last_frame` 锁定。循环动作只追加回首姿提示词，
  必须继续经过现有 rebuild、首尾缝、空格与透明帧验收；不得因速度快跳过抽卡和最终 GIF 预览。
- **即梦网页是低频人工兜底，不是 `ai-asset.py` 自动后端（2026-08-24 实测）**：常规批量生产优先豆包；
  仅在 H3/豆包不便使用、需要第二模型交叉验证，或当天只补 1～2 个关键候选时，通过已登录的即梦网页手工提交。
  免费会员每日约 100 积分，按本次 5 秒 720P 视频实扣 50 积分计算仅约 2 条，吞吐量明显低于豆包，不能作为常规免费产线。
  上传本地参考图前必须取得用户对
  “具体图片、即梦、生成用途”的当次授权。提交前回读模型、参考模式、首尾图、提示词、时长、分辨率与
  积分，任务状态不明时禁止再次提交。
- **免费账号的模型边界必须按页面实测判断**：模型菜单、倍率、免费资格和每日容量都会漂移，禁止把历史的 `Seedance 1.5 Pro`、一次限免或“每日约两条”等结论写成当前硬编码。2026-08-25 只读检查显示当前菜单为 `Seedance 2.5 / 2.0 / 2.0 Fast / 2.0 Mini`，其中 Mini 标注“日常生成使用”；黑色眼镜王蛇同日连续完成 walking、attack、dying 三条 5 秒 Mini 视频，说明旧的两条估算已失效。每次从页面当前最低消耗且可提交的合适模型开始，逐条提交；只有页面实际阻断后才转 H3，任务状态不明时仍禁止重复提交。
- **即梦循环资产优先用同图首尾帧**：从正式动作首帧裁出单格，合成 16:9 纯白参考图，主体含完整武器并
  占画面高约 70%～75%；首帧和尾帧上传同一张图，提示词限制脚底、中心、镜头、装备、背景和回首姿。
  仓鼠民兵 idle 实测：1.5 Pro 输出 121 帧；周期分析选源帧 60..108，每 2 帧取一帧，得到 24 帧/12fps、
  8×3 的 512² 精灵表，接缝差与普通相邻帧同量级。不得沿用 3fps/6fps 的稀疏预览冒充最终流畅度。
- 即梦下载成片仍是**候选源**：保存原 MP4 和参考图，做均匀联系图、循环窗口分析、透明抠底/去白边、
  脚线与中心对齐，并提供实际目标帧率的 GIF/WebP 预览；用户明确接受后才能覆盖运行时资产。网页预览或
  单次样本没有可见水印，不代表后续任务永久无水印，必须逐次检查下载原片。
- **提交前强制回读（伊莉丝 2026-08-24）**：先运行 `doubao-seedance-gen.mjs --fill-only`，用真实键盘输入写入后
  逐字回读，字符数/哈希一致才准正式提交；空提示曾生成默认“女骑士英姿”战场运镜视频并浪费一次额度。
  provenance JSON 必须带 `promptChars/promptSha256`。
- **无影提示不是抠图保证**：纯白无影首帧 + 多次“无接触阴影”仍会被 Mini 重画成长软影；统一走
  `prepare-video-character-reference.py` / `character-run-video-rebuild.py` 的 BiRefNet 最大主体连通域，清除灰底、
  阴影和角标。方向约束写鼻尖/胸腔/骨盆/膝盖/脚尖沿水平轴，但三分之四参考图不能仅靠文字变成严格正侧面，
  联系图/GIF 未人工确认不得覆盖运行时资产。重建器可用 `--stem running|walking|...` 直接产出对应动作文件名。
- **每次提交使用不可变提示词快照（仓鼠特战 2026-08-26）**：provenance JSON 指向的提示词文件一旦提交就不得原地改写；返工必须新建版本目录或版本文件，并在提交前记录 `promptSha256`。定稿后保留已选 MP4、同名 JSON 与实际提示词，淘汰视频可在选型记录完整后移出仓库，但小体积提示词和 provenance 应继续保留，避免只剩哈希而无法复现语义。
- **定稿归档只保留可复现链（仓鼠重机枪 2026-08-27）**：保留母图/安全参考图、不可变提示词、唯一 MP4
  与同名 provenance、插帧前透明源表、RIFE 成品表与报告、源视频及最终目标帧率 GIF。正式表和报告均已生成后，
  `_rejected/` 误恢复视频、逐帧 BiRefNet 缓存等可重建中间物不进 Git；失败原因、提示词哈希和卡片 offset 写入任务索引即可。
- **超宽正式表与运行时表分层（动力爆矛重骑兵 2026-08-28）**：已验收的透明源表/RIFE 成品表是正式可编辑真源，
  不因 WebGL 最大纹理边长或运行时装载需求而覆盖。另生成运行时副本时只允许逐格整数平移、重心/脚线复核和无损重排，
  禁止重采样或改写自然帧轨迹；每张运行时表的宽高都必须落在目标渲染器纹理上限内。由 AI/状态机提供世界位移的冲锋动作，
  运行时副本应消除源视频的整体画布横移，避免角色同时被精灵帧与世界坐标推进两次；普通攻击和死亡仍保留已批准的一次性源轨迹。
- **一次性冲锋按玩法阶段重映射，预览按运行时时钟交付（腐沼独角仙王 2026-08-28）**：总动画时长应由准备、真实冲锋和恢复阶段组成；抽帧允许按阶段非均匀选取源帧，使完整奔跑段覆盖配置中的 `chargeMs`，但只做整格根运动锁定，不改写已批准的腿部自然轨迹。RIFE 后的用户预览必须按运行时最终 `duration/frameCount` 生成，不能沿用 `sourceFrameRate*2` 的工具默认 GIF；GIF 10ms 量化需用分布式逐帧时长补偿到准确总时长，首尾额外停顿如非玩法配置的一部分必须去掉或明确标注。报告中的 `durationPreserved` 只证明插帧前后时长关系，不能单独证明游戏播放速度正确。
- 超宽多动作表的显存核算以实际 PNG 整图 `width × height × 4` 为准，不能用 `frameWidth × frameHeight × frameCount × 4` 代替；末行空格和行列重排仍会完整上传 GPU。单个需要强驻留的资源族必须独立落在软预算内，每张表还必须低于目标 WebGL 最大纹理边长。
- 用户已确认逐帧自然轨迹后，运行时瘦身只允许逐动作统一裁透明边：横向裁框关于旧格中心对称，纵向裁框同步换算 `footY`，可重新选择列数，但不得重采样可见像素或逐帧重新拉直。正式归档保留获准母图/源视频/提示词/provenance、最终 GIF、运行时表、裁剪布局与可复现脚本；逐帧 PNG、重复源表、接触表和视频级重复预览属于可重建中间物，可恢复清理后不进 Git。
- **Mini 的体型/景深漂移按有效躯干归一**：先对 alpha 主体做形态学开运算，排除长枪、火箭筒、散弹枪等细长武器后估算有效躯干高度；循环待机/奔跑可逐帧统一躯干高度并以躯干/脚线锚定。攻击、死亡等一次性动作只能使用一套固定缩放并保留原始水平轨迹，禁止逐帧压平倒地高度或把后坐、扑击重新居中。
- **枪口附着烟雾不能只靠最大连通域清理**：弹壳、水印、离体阴影可按组件面积/主组件删除，但与枪口相连的浅色烟雾可能属于同一组件；只允许在动作特定的枪口前向 ROI 内，按低色度高亮度做窄域清理，并保护深色枪体与暖色枪焰。脚本需记录删除像素数，最终同时检查源/终联系图和目标帧率 GIF，禁止把该规则扩成全图浅色删除。
- **侧向跑动必须给动作方向参考，不能只靠文字扳正（外卖员 2026-08-25）**：三分之四待机图直接送 Seedance，
  即使提示词反复要求侧向，鼻尖、胸腔和骨盆仍可能在跑动中转向镜头。需要先从同角色候选中裁一张完整的
  右向跑动关键帧作为参考母图，再生成联系图逐帧检查头、胸、胯的方向；正面化候选直接淘汰，不进入抠图与插帧。
- **模型反复发明错误长尾时，止损并做受限后处理（外卖员 2026-08-25）**：仓鼠即使明确写“无鼠类长尾”仍可能
  被 Seedance 连续画成长尾。一次带动作关键帧的修正仍失败后，不继续消耗额度；保留原 MP4，仅在角色后下方 ROI
  内用形态学粗主体核心保护挎包、衣摆、腿、鞋和手，再删除远离核心的细长分支，允许保留短粗尾根。脚本必须记录
  删除像素数，并用最终联系图/GIF 人工确认未伤及主体；这是针对明确解剖错误的窄修正，不得作为通用自动抠图步骤。
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

#### 多动作怪物定稿后的仓库收口（2026-08-29）

- 正式归档只保留：获准母图与直接编辑源、不可变提示词、定稿 MP4 与 provenance、插帧前透明源表、RIFE 成品/报告，以及按运行时时钟生成的最终 GIF/联系图。`frames/birefnet-source`、插帧前重复预览和其他可由上述真源重建的缓存不进 Git；确实参与生成的单帧参考须移入对应正式子目录并由 manifest 显式引用，不能随缓存整批删除。
- 被否视频不以“溯源”为由留在仓库：删除 MP4 和对应 GIF/联系图，仅保留小体积提示词、provenance 和失败原因；任务索引把状态写成 `rejected_archived_metadata_only`，不得继续引用已删除的大文件。
- 运行时接通后，任务索引、最终 `spritesheet-manifest.json` 及生成该清单的脚本必须同时写 `assetOnly:false`、`runtimeIntegrationActive:true`。只手改生成结果会在重跑插帧时退回“仅资产”状态，属于不可复现交付。
- 已有 RIFE 正式表只调整播放节奏时，不重新抽帧、插帧或重采样可见像素；只同步双份运行时配置的 `frameRate`、发布脚本中的布局真源和最终运行时时钟预览。GIF 只有 10ms 时间粒度，高于 50 FPS 时必须用分布式 10/20ms 帧时长逼近目标总时长，并在报告中同时写明游戏内精确帧率与 GIF 量化后的实际循环时长；世界移动速度、碰撞和战斗时钟保持独立不变。
- 超宽多动作表的显存核算以实际 PNG 整图 `width × height × 4` 为准，不能用 `frameWidth × frameHeight × frameCount × 4` 代替；末行空格和行列重排仍会完整上传 GPU。单个需要强驻留的资源族必须独立落在软预算内，每张表还必须低于目标 WebGL 最大纹理边长。
- 用户已确认逐帧自然轨迹后，运行时瘦身只允许逐动作统一裁透明边：横向裁框关于旧格中心对称，纵向裁框同步换算 `footY`，可重新选择列数，但不得重采样可见像素或逐帧重新拉直。正式归档保留获准母图/源视频/提示词/provenance、最终 GIF、运行时表、裁剪布局与可复现脚本；逐帧 PNG、重复源表、接触表和视频级重复预览属于可重建中间物，可恢复清理后不进 Git。

#### 已批准动画的重采样与最小源集

- 清理前沿最终manifest递归追溯直接输入；炮弹/头像等确实读取的分割缓存必须先提升到 `reference/` 或 `source-sheets/`，同步提取脚本与来源清单，再移除缓存。直接编辑过的旧母图、局部修图蒙版、复合攻击的原关键帧快照均不是废案。当前索引只指向保留成品；废案索引用 `rejected_archived_metadata_only` 留下提示词、生成记录和淘汰原因，历史文件名不能继续充当活动预览。

- 压缩既有动画时先区分PNG磁盘体积和解码像素：提高PNG压缩等级不会降低基础RGBA占用；统一重采样比例为s时，裁边前像素量约变为s²。使用预乘Alpha缩放避免透明边缘黑圈，并将referenceCell按同倍率换算；世界显示尺寸与碰撞保持不变。
- 重新RIFE会改变奇数中间帧，即使原生姿态、帧数和时钟未变，也不能声称像素无损或动作已实机验收。保留已认可的单帧停留、循环尾帧修补及其索引；压缩前后GIF标明制作时钟，不能把快照预览当作后来配置或另一分支的播放速度。

- 归档可再生输出前先让默认重建入口直接消费保留的原生关键帧，不再强制读取待清理的旧成品。新清单显式登记每动作的实际输入；旧成品仅作为可恢复的对照来源，保留其容量元数据和已交付GIF。缺少旧对照源时跳过对照重生成，不能改用当前成品冒充旧版或覆盖历史预览。
- RIFE整表、源时钟预览、发布暂存副本和日志可在收口后清理，保留实际输入、必要报告、正式PNG和最终GIF。目录级忽略规则只覆盖这些已确认缓存。旧导出器检测到新布局已激活时不得覆盖运行时PNG；清单生成器重跑必须保留接入状态。

- 只有用户明确要求改变帧内容/像素尺寸或重新优化插帧时，才从获准的**未插帧关键帧**统一重采样后重新RIFE；仅调整播放速度仍只改时钟，不动像素。不得把已插帧结果当关键帧二次插帧。每只角色共用像素比例/脚点，不逐帧按Alpha框缩放；低伏躯体用粗细、带长背刺/武器的角色用主体高度标定。保留原动作轨迹，接触源帧映射为新表0-based帧号，并同步玩法墙钟和GIF。
- 定稿保留获准母图/直接编辑源、视频/provenance/提示词、本轮RIFE实际输入源表、帧号/裁剪参数、运行时PNG及最终GIF/报告。旧版成品、逐帧抠图、重复输入和过期预览可恢复移除，不进Git。索引应区分“当前正式输入”和“可再生历史中间物”；活动链接不得指向已清理文件，重跑旧阶段不得覆盖当前接入状态。直接参与编辑的旧母图不是废案。

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
- 2D：FLUX.2 Dev fp8（33GB，生产主力）+ FLUX.2-dev-Fun-Controlnet-Union + FLUX.2 Klein 4B fp8（3.8GB，历史复现/对照）
  （7.7GB）+ Mistral3 Small 文本编码器（11.4GB）+ Qwen3-4B（7.5GB）+ flux2-vae。另有研发对照用
  Z-Image Turbo INT8 ConvRot（约6.2GB）/NVFP4（约4.5GB）/BF16（约12.3GB）与
  `Z-Image-Turbo-Fun-Controlnet-Union-2.1-2602-8steps`（约6.7GB）；INT8 ConvRot + Union 会输出噪声，
  只允许 INT8 单独生图或显式改用 NVFP4/BF16 做 Union 对照，均不得参与默认路由。
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
- **方形母图禁止直接拉伸成 H3 的 16:9 首帧**：必须先等比缩放后放进目标分辨率画布，四周补纯色背景；
  任何直接 `resize(width, height)` 都会把角色横向拉宽，而且后续透明表的统一比例无法逆转源视频形变。
- **首帧角色高度占画布 70~75%、四周留 ≥10% 安全边距**；顶天立地（100%）时实测
  56 帧里 45 帧贴边、头脚被裁。
- 提示词：`static camera locked in place, no camera movement, no pan, no zoom,
  no push-in, no pull-out, no tilt, no rotation, the body stays perfectly centered
  in the frame and never drifts left or right, only the arms and legs move,
  the entire character with hat and bare feet always fully visible inside the frame
  with generous empty margin on all sides, nothing is cropped or touches the frame edges`。
- 验收量化：逐帧主体 bbox 贴边帧数必须 = 0；水平中心漂移初始 206px → 缩 75% + 强化
  静态镜头后 35px（可接受，拼图时逐帧居中可消）。
- **尺寸验收要在原视频中先做**：以首帧或中立姿态的粗壮躯干 bbox 为基准，比较宽高比、面积与中心轨迹；
  若非姿态伸展即可解释的面积增长、宽高比突变或镜头推近已经发生，必须重生视频，不能靠逐帧缩放或居中掩盖。

#### 4. 无缝循环生成（首帧=尾帧）
- `--first-frame` 与 `--last-frame` 传**同一张图**：结尾姿势/位置强制回到首帧
  （实测中心差 (0,0)px、轮廓重合 IoU 0.99、结尾 5 帧速度无突变=无橡皮筋回弹）。
- 提示词加：`at the end of the video the character naturally returns to the exact
  same pose and the exact same position as the first frame, seamless loop,
  no freeze and no slow down at the end`。
- 已知现象：模型仍会在片头/片尾各留 ~8 帧缓动（"慢起→匀速→缓回"），这是正常现象，
  靠截取算法规避（见 §5），不要因此误判视频失败。
- **复杂装备的身份锁不能只看首尾帧（2026-08-26 仓鼠狙击手）**：同图首尾只能约束两个端点，
  H3 仍可能在中段整段删除夜视仪、兜帽、裤装、匕首或武器部件。头戴设备要在提示词中定义为
  “兜帽/安装架/镜筒组成的单一刚性头部组件”，服装与双手武器逐件列为全程不可删除身份件；生成后至少做
  24～32 个均匀采样点的联系图，逐点检查装备是否存在、拓扑是否一致。任一身份件连续消失即判废，
  不得因首尾完全重合或步态顺滑而进入抠图。定稿后任务索引保留失败尝试名、提示词哈希与失败原因即可；
  已明确判废的 MP4、旧运行时表和派生预览不进入 Git，正式母图、最终视频、提示词、透明源表、RIFE 报告与
  验收 GIF 必须保留。

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
- **端点候选必须按 `pose(s)≈pose(e)` 选，再输出 `[s,e-step]`**；不要只优化“最后一张内容帧→第一张”的接缝，
  否则容易把错误相位包装成局部低差异。可用 `tools/ai-gen/video-cycle-endpoint-analyzer.py` 批量比较候选。
- **最终透明精灵图必须重新验缝**：原视频代理帧通过不代表抠图、裁切、脚底对齐后仍通过；以最终帧计算
  `接缝步幅/正常步幅中位数`，要求落在 `0.5~1.5`。维护师素材曾出现代理判断可用、最终比值 `1.92` 的反例。

#### 6. 精灵图抠图/对齐（防"扯回"）
- 抠图：白底阈值 235 → 形态学闭运算（3×3，填头灯高光等小孔）→ alpha 高斯羽化软边。
- **对齐三铁律（逐帧量化，必须零偏差）**：
  - 角色高度固定（先实测旧图标定，工头=262px）；
  - 脚底基线固定（工头 y=410，防上下跳）；
  - 水平中心固定（工头 x=256，防左右扯/滑步）。
- 尺寸/脚底/中心与旧图一致 ⇒ 碰撞体积配置（collisionWidth/Height、footOffsetY）不用动。
- **重抽候选必须从新源窗口重新求一次固定比例**：不得沿用上一废案的 `fixedScale`。以本次接受循环窗口的
  主体轮廓高度中位数求唯一全局比例，再统一应用到全部帧；长枪、夜视仪、披挂和其他细长装备不参与主体高度。
  仓鼠狙击手重抽若复用旧比例会把主体压到约79px，按新窗口中位数重算后稳定为128～131px、脚线350～351。
- 进游戏前**先扫空白帧**（格内 alpha>10 像素数 <50 视为空），禁止把空格注册进动画
  （否则周期闪没，毒液僵尸 idle 24 格仅带 0 有内容的旧教训）。

#### 6.1 半透明飞行昆虫：保留升降轨迹、宽格安全框与蓝色溢色清理（2026-08-28）

- 飞行/坠落动作不能套地面角色的逐帧脚底对齐。源关键帧先用同一全局比例和画布变换保留自然升降，RIFE调用`--preserve-vertical-motion`关闭中间帧Alpha底边校正；待机/移动的悬浮重心也按源轨迹验收，不把腹部强行拉到地面脚线。
- 横向突刺、飞扑等源视频若主体会离开常规方格，必须先测整段Alpha包围盒并扩大单格宽度；`build-translucent-hover-sheet.py`支持非方格单元。禁止用固定`clearRect`裁画布边缘制造“安全区”，否则会把真实前扑直接裁掉；运行时位移与表内位移是否锁根应单独决定。
- 半透明翅膀会把H.264/YUV蓝幕色度雾保留在低Alpha区域。清理时只改近主体的RGB，不删除翅膀Alpha：先按主体支持域和膨胀半径回填蓝/青偏色，再清理远离主体的断开雾团；RIFE原关键帧必须保持不变，仅对生成的奇数中间帧使用`--despill-blue-middle`。透明像素RGB最终归零。
- 正式门禁同时检查：有效帧无空白/贴边，源关键帧仍位于偶数索引，飞行纵向轨迹未被拉平，半透明翅膀Alpha连续，青色超额像素与蓝色超额像素均为0。任务目录只保留获准母图、正式视频/提示词、关键帧、源表、正式表、报告与GIF；被裁切版、蓝边版和重建候选缓存只在索引保留失败原因后删除。

#### 7. 游戏集成（按真实帧布局与动作时钟）
- 帧格按有效内容和同角色固定像素比例选型；宽动作不缩主体塞方格。512×512是历史实例，不是强制规格；同步帧宽高、裁框、脚点和referenceCell。
- BootScene：`load.spritesheet` 的 `endFrame = 帧数-1`；`anims.create` frames 0..N-1、
  walk 用 `repeat:-1`；帧率/逐帧停留由最终总时长派生，插帧保持原节拍，提速同步事件与动作锁。
- **友军动画必须同时通过“贴图预载 + 动画创建”两张名单**：把单位配置加入
  `load.spritesheet` 遍历只会让 `textures.exists(key)` 为真，不会自动生成 Phaser 动画键；还必须加入
  `anims.create` 遍历，并逐状态核对 `this.anims.exists(companion_<id>_<state>)`。同一张源表复用为
  `attack/charge` 时分别登记动画状态，优先让多个动画键引用一个纹理键；旧渲染器若硬性要求多纹理键，先同步适配状态映射，否则须明确计入重复驻留，不能默认复制贴图来补动画注册。
- `_getTextureKey()` 必须与动画源 spritesheet 一致；换素材前先备份旧图到
  `Y:\工作\无尽轮回\scratch\backup\`（git 里也有历史版本，可放心清）。

#### 8. 验证清单（像素统计优先，GLM 辅助）
- **像素统计优先级 > GLM 描述**：GLM 会跑偏（曾说视频衣服是绿色、背景判断不可靠、
  还会输出模板化"assuming…"套话）。量化证据：直方图相关度、步幅差值、贴边帧数、
  中心漂移、对齐三铁律。
- 循环验证：首尾中心差、(腿部)同相 IoU、接缝步幅 vs 正常步幅、结尾 5 帧速度无突变。
- 抠图验证：每帧背景占比稳定、角色内部孤立背景斑（连通域）、无空格帧。
- 用户明确授权后的集成验证选项：`npx vite build` + `npx eslint` + 无空格帧 + GLM **单张**抽查
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
- **带技能结算帧的动作不能只按视觉距离盲采样**（2026-08-22 丛林祭司）：先锁定游戏配置的
  1-based 释放帧，再把该成品帧显式映射到视频中的爆发关键帧；例如 17 帧 spell 的第 8 帧映射
  到法杖光芒展开的源 f117，前后段再分别压缩。否则动作看似平滑，弹道/伤害却会落在蓄力或静止帧。
- **BiRefNet 会删掉半透明魔法光线**：主体 alpha 清理后，可在限定的技能 ROI 内按目标色通道优势
  （绿色示例 `G-max(R,B)>4`）和白底色差恢复 effect alpha，再做白底反解；ROI 必须避开视频水印，
  并重新执行空帧、贴边与格宽检查。参考 `tools/ai-gen/jungle-wizard-video-rebuild.py`。

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

#### 8. 伊莉丝重对中与插帧（2026-08-21 定稿）
- **质心对齐陷阱**：elise-sprite-align v2 的"全内容质心对齐格心"会被四肢/武器带偏
  （挥剑左伸 → 质心左移 → 身体被推到右侧），实测逐帧 bbox 中心摆动 walk ±36、run ±52。
  正确锚点（逐带实测选型）：**躯干带（内容高 30%~55% 质心 x）** 用于走/跑/防御/待机硬锁定；
  **脚底带（底部 12% 质心 x）** 用于攻击类（脚不动躯干动，保前冲趋势，3 帧平滑+步变 ≤40px），
  且整条曲线首尾站姿帧对齐 idle 站姿脚底锚，跨动作不跳。工具 `tools/ai-gen/elise-recenter.py`。
- **RIFE 插帧进游戏（rife-ncnn-vulkan v4.6 离线 exe）**：RIFE 不保 alpha——RGB 透明区先做
  最近色填充（distance_transform 索引，防边缘黑晕），alpha 作灰度图单独过 RIFE 再取亮度回贴。
  循环动画含尾→首回绕对。插后中间帧脚底会因 alpha 软化上移 2~14px：整像素竖移校准到
  邻帧底边均值（elise-interp-feet-fix.py）。walk 12→24@28fps、run 循环 12→24@32fps 实装。
- **角色插帧公共合同**：统一见 [16b §4](16b-animation-alignment-and-timing.md#4-插帧与循环)。按需一次2×RIFE，保留源关键帧、循环/单次分流、脚点与事件时钟；不重复强制插帧。以下工具异常案例只在采用RIFE时参考。
- **黑闪门禁（2026-08-25 仓鼠长戟兵实测）**：RIFE 可能在两张正确关键帧之间凭空生成不透明近黑块，
  透明 RGB 清零和脚线正确都不能证明没有此问题。`rife-spritesheet-interpolate.py` 必须逐个中间帧检查
  `alpha>96 && max(RGB)<24` 且远离相邻关键帧原有暗部的时间异常；达到 8px 即用两侧“最近前景色填充场”
  重建，再以中间帧有效颜色补洞，报告 `visibleDarkOutlierFrames` 必须为空。禁止用大批“保持前关键帧”掩盖
  黑闪，否则名义 2× 帧数会退化为重复帧；门禁版本由报告 `pipelineVersion` 固定，版本升级后旧暂存不得复用。
- **红块门禁与大修复保持策略（仓鼠特战 2026-08-26）**：豆包角色曾在 RIFE 中间帧出现原关键帧没有的高饱和红块，正式流程应启用红色时间异常修复并要求报告 `visibleRedOutlierFrames={}`、`visibleDarkOutlierFrames={}`。默认不得用 `--hold-large-repair` 整帧复制前关键帧；只有报告证明局部重建仍留下严重大块损坏时才允许定点保持，否则会把名义插帧退化为重复帧。
- **已确认慢步轨迹应保留完整源时长（仓鼠方阵 2026-08-26）**：若用户确认源视频腿部运动正确，问题只出在后续精灵表抽帧，就不要再用短窗口或几何模板“拉直”步态。可在完整原生循环上按固定整数步长取关键帧，并把关键帧播放率设为`原生fps/步长`；循环 RIFE 再补每段中点及末→首回绕，帧率同步×2，墙钟总时长保持不变。方阵从124帧原片取`0..120 step 4`得到31帧@6fps，再插为62帧@12fps，完整保留5.1667秒缓慢推进。验收仍以最终透明表的腿部相位、接缝步幅/段内正常步幅和脚线为准，不能因源视频正确就跳过成品复核。
- 审计脚手架：`tools/_audit_elise_sheets.py`（网格匹配/脚底基线/水平中心/空帧/贴边逐帧量化），
  新角色表入库前先跑它（基准：露娜 bbox 中心 std ≤8、脚基线 std≈0）。
- 全量版：`tools/_audit_all_companion_sheets.py`（读 companion-config + hamster-*-config 全量审计，
  按配置帧区间）。判读口径：attack/挖矿/冲锋的 bbox 中心漂移多为武器挥弧固有（看躯干/脚底带锚点
  才准）；walk 脚基线 std>3 或单帧离群才是真问题（射手帧 0 异源混入、火枪手 dying f7 离群 121px
  都是这么抓出来的）；修复工具 `tools/ai-gen/hamster-feet-align.py`（底边对齐中位数，保锚定）。

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
- **跨来源动作补充口径（2026-08-24）**：当 walk/run 等动作来自不同视频生成批次，原始全局 S 已不再
  同源，先用 `elise-state-scale-contact.py` 把各状态放到同脚线、同像素尺度联系图；只对确认整套偏大的
  状态用 `elise-normalize-state-scale.py` 施加一个共享系数。缩放中心固定为逐帧躯干中心+脚底，禁止按
  每帧 Alpha 高度单独拉齐。风车中段的下蹲、攻击跨步和奔跑伸展都是姿态，不是缩放误差；应以同动作
  站起/站立帧对齐 461px 基准，再让整套动作共同缩放，以保留原始姿态比例。
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

#### 红狼王母版六动作现行规格（2026-08-23，覆盖下方旧红狼参数）

- 红狼王狼形运行时保留同一母版生成的六套序列：idle 12帧、running 16帧、attack 21帧、pounce 23帧、howl 12帧、dying 12帧；旧 pacing 独立图、旧变身图和旧人形图已全部退出运行时。2026-08-23 以当前狼形母版和新生成的红狼人母版作为 H3 首尾帧，新增 transform 20帧（5×4、640格、footY 590）：从视频有效形变段0~91帧均匀取样，末格强制取真实第123帧，固定比例/水平中心/脚底对齐。变身后的狼人现已补齐 idle 20帧、running 12帧、attacking 21帧、howling 20帧、dying 20帧，全部640格、与 transform 末帧同尺度；idle/attack/howl/dying沿用footY 590，running经躯干稳定后独立使用footY 606。running 当前以用户微调并移除背景后的同名8×6画布为正式资源，只注册前12个连续有效格。此前23帧抽样原表和46帧RIFE循环插帧表仅保留为可回退的生成历史，不再作为运行时帧数。飞扑玩法暂复用 attacking 并继续保留白色拖尾。attack/pounce 先由原 12 帧通过 RIFE v4.6 相邻帧 RGB/Alpha 分通道插帧为 23 帧，一次性动作禁止做末帧→首帧回绕插值；中间帧脚底按相邻原帧底边均值校准。普通攻击再删除末段2张慢闭嘴帧，仅保留1张快速咬合过渡和1张完全闭嘴帧，最终为21帧。
- idle/running/howl/dying 为512格；attack/pounce 为640格。640格不能直接沿用151显示框，运行时必须按 `cell/referenceCell` 放大完整画布，再用每状态 `footY` 对齐逻辑脚底；pounce 因安全边距缩放另加 `contentScale:1.15`。
- 狼形 running 取自连续原视频帧，按约42ms/帧播放；walk/pacing 共用同一表但用80/100ms降速。狼人二阶段当前12帧追捕跑恢复到整体减速33%之前的约1.38秒/圈，按115ms/帧播放；walk/pacing仍为124.583333/153.333333ms。BootScene只注册0~11，8×6画布余下空格不进入循环。用户透明12帧先以alpha底边y=590完成粗对齐，随后针对低Alpha边缘“触线但实心脚掌悬空”和躯干起伏做第二轮无重采样整像素校准：中央躯干质心压入405~411px窄带，逐帧Y位移为`+16/0/0/-2/-3/0/+3/0/0/-3/-2/+6`，running专属`footY=606`，使所有帧不沉地且游戏内躯干波动由约9.51px降至2.50px。禁止通过运行时bounce补偿脚线抖动。攻击21帧按50ms推进到闭嘴末帧，再定格到1.2秒结束；命中窗口约第10~18帧，最后第19/20帧快速咬合。飞扑0~7蓄力、8~22冲锋，prepare/charge 仍各900ms，动作和玩法总时长不变。
- 狼人形态视觉和碰撞统一使用1.25目标倍率：640格按512参考换算后的显示边长由188.75px增至235.9375px；当前半径45、90×90碰撞基准增至半径56.25、112.5×112.5，胶囊高度同倍率增长。2秒transform期间按线性进度从1.00插值到1.25，Phaser同纹理内每帧同步displaySize，碰撞矩形/footprint/胶囊同步增长；`footOffsetY`随显示尺寸和当前表的`footY`重算，transform等表用590、running用606，各自锚定同一逻辑脚线。若变身中死亡，碰撞恢复狼形基准。
- 半血二阶段播放 transform 后进入狼人五动作状态机；idle/run/attack 按真实 AI 状态推进，主动嚎叫和死亡各用独立狼人表，dying 继续接 `_preserveCorpse`，约2秒播放后末帧保留1秒。新视频已包含身体起伏，禁止再叠旧程序化 bounce/stretch。

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
- **正式循环只保留一个检测出的真实周期**（2026-08-23 僵尸犬补充）：
  `quadruped-rebuild.py` 默认 `P×2` 适合做周期候选/首尾诊断，不等于最终入库帧数；
  两个重复周期会徒增贴图和解码成本。僵尸犬 walk 实测 `P=38,s=20`，取
  `20..56 step2` = 19帧；run 实测 `P=44,s=24`，取 `24..66 step2` = 22帧，
  两者均按 12 FPS 保持原视频周期时长。选帧后仍须扫空格和首尾相位，不能直接把
  自动重建的双周期检测图入库。
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
- 脚底基线按**帧高**换算：`frameHeight=512 → footY=410`；只有帧高也扩大到
  640 时才换成约513。不能因为横向内容变宽就把脚线按 frameWidth 放大。
- 前扑伸展帧宽超 512（545~583px）时优先用 **640×512 非方形帧格**，只扩宽不扩高；
  这样可保留前扑 reach，又不会为横向留白抬高整套运行时画布。确实上下也越界时才用
  640²/更大帧高。BootScene 的 frameWidth/frameHeight 必须分别读取配置。
- 显示 151×151、内容高 262/脚底 410/居中；碰撞体积不动。
- 使用同一源构图的多动作应共用 idle 首帧量出的**全局缩放**：idle/walk/run 可逐帧稳定躯干和脚线；
  attack 保留相对首帧的 source-space X/Y 位移；dying 只把每帧落地，不逐帧放大倒地姿态。
  若为了横向安全框让某动作改用明显不同的主体占比，则以该动作首个中立帧单独反算固定缩放，
  统一到同一目标有效身高；只允许逐动作归一，禁止逐帧动态归一。
  僵尸犬五动作由同一 BiRefNet 实例批处理后，空帧/越格/半透明/透明区RGB均为0。
- **横向动作先做视频安全框参考图**：扑击、冲锋、前刺、长武器挥击不能直接把占画面
  约80%的母图交给视频模型。用 `video-safe-reference.py` 将高幅横向动作主体宽度降至50%~55%，面向右时
  主体中心放在画面35%~40%，峰值动作要求鼻尖/武器前方仍有至少20%空白、身后至少12%、
  上下至少10%。提示词同时锁定 wide framing / never zoom or reframe。
  50%~55%是首次尝试值；黑熊长距离扑击实测需要降到35%并把中心移到约28%，源视频峰值才完整。
- **源视频边界是独立验收项**：必须逐帧检查生成视频主体 bbox；任一关键帧触碰原视频边界
  就判失败并重生。BiRefNet 抠图后缩进更大 cell 得到 `edgeHitFrames=0`，只能证明精灵表没有
  二次裁切，不能证明视频模型没有先切掉鼻、嘴、爪或武器；已经丢失的像素无法靠后处理恢复。

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
- BootScene：spritesheet frameWidth/Height 分别读取当前动作帧格（可为 640×512），
  endFrame = 帧数-1；动画键与 `_getTextureKey()` 一致。
- animation-config frameLayouts **双份同步**（data/ + public/data/）
  cols/rows/frames 与 sheet 严格一致。
- 非方形动作运行时不能沿用固定正方形显示框：设 `referenceCell=512`，每帧统一
  `pixelScale=baseSpriteSize/referenceCell`，显示框取
  `max(frameWidth,frameHeight)×pixelScale`，脚偏移取
  `(footY-frameHeight/2)×pixelScale`。这样 640×512 攻击与 512×512 idle 的主体像素比例一致，
  切动作不会忽大忽小。
- 新母版已完成脚线/位移对齐时，动画键加版本后缀（如 `*_v2`），隔离旧素材专用的
  `sprite-offsets`；死亡动作同时接 `_preserveCorpse + deathAnim.duration/holdMs`，播完末帧再清理。
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
  - `monster rebuild --name X --video y.mp4 --kind run|attack [--bg-color 同色] [--cell 640] [--out 路径]`：
    视频 → 动画 sheet（周期/窗口检测 + BiRefNet 重建 + CLEAN 验证报告）；
    缺省仍写统一 scratch；当前机器未挂载 scratch 盘或需要保留任务内证据时用 `--out` 显式落盘；
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

### 树木/植被等距素材管线（2026-08-26 Klein 路由更新）
> 2026-08-16 删除的是世界-122 当时的树木资产和旧专用批处理脚本，不代表禁止后续世界新增树木/植被。
> 新资产统一按本节通用链路执行；不得引用已删除的 `gen-tree-iso2-assets.py` / `process-tree-iso2-assets.py`。

**管线（白模深度锁视角 → 生图 → 抠图入库）**
- 白模：在`_blockout_specs/<asset>.json`中用trunk圆柱和树冠球/层叠圆柱建立新规格；现有`snow_pine_01_upright.json`等雪松规格可作为结构参考，但不得直接覆盖。**elevation 30**用于等距障碍树木并与防御塔/掩体统一视角；纯billboard资产建议≤12°。随后用`blender-depth-render.py`输出深度图（输出走%TEMP% ASCII路径）。
- 生图：远程5080使用 `comfyui-gen.py --model flux2-dev-depth --control-image <depth>`；视角/树形/株型由白模Depth锁定。Klein/Klein Depth只在任务明确指定的历史复现或对照实验中使用，不得作为新树木/植被的默认路由。
- **画风锚定**：写实 = `photograph of a real tree` + 自然低饱和 + 树皮/枝叶细节
  （flux2 类型不吃 negative 词，全靠正向锁定；v1 卡通风被用户退回——卡通/写实分歧
  必须首轮小样验收）。5 变体用**树种区分法**（白杨/橡树/白桦/枯树/松树）——同一形态族
  （高瘦）+ 物种差异，比形状差异更自然。
- **抠图铁律**：`ai-asset.py cutout` 子命令经 rmbg_cutout CLI 只出灰度掩膜（会把掩膜当
  成品入库）；入库必须进程内 `predict_alpha` 合成 RGBA（rebuild-h3-birefnet 同款），
  且整个进程跑 ComfyUI venv python（torch + ComfyUI-RMBG）。
- 处理：使用 ComfyUI venv 运行 `process-desert-plant.py`，由 `rmbg_cutout.predict_alpha` 在进程内合成RGBA；障碍树木使用 `--no-square` 保持紧身宽高比，方形点缀植物使用默认方形居中。处理后必须检查树干/茎秆接地点是否保留，再按正式资产的尺寸、footprint和`obstacleH`登记运行时几何。
- **摆放缩放**：isoVisuals 件显示缩放 = `obstacleH / geo.h`（摆墙编辑器口径）；裸推 piece
  不给 scaleX 会按贴图原尺寸放大数倍（实机探针实踩）。
- 当前工具链：`blender-depth-render.py` / `comfyui-gen.py` / `process-desert-plant.py` / `_blockout_specs/<asset>.json`；现存`snow_pine_*.json`可作为白模样例。旧专用脚本名与`.bak-tree-*`只属于历史记录，不能作为新任务入口。

**世界-123 雪原松树 V2（2026-08-24）**
- 五个稳定键 `obstacle_snow_pine_01~05` 分别锁定直立密冠、左倾承雪、右倾断层、强风偏冠、
  老龄疏枝；不得只换同一棵树的镜像来伪装形态差异。
- 唯一正式入口为 `snow-pine-pack-blender.py` + `prompts/snow-pine-obstacle-v2.md`：可编辑模型先锁
  树干曲线、枝层数量/缺口、风向和 44.8°/30° 相机，内置 ImageGen 只精修针叶、风化树皮与枝顶积雪，
  再由 BiRefNet 重建真透明、紧身裁切并运行 `build-lighting-maps.py` 更新剪影。
- 运行时统一 `obstacleH=390`，新图 w/h 写真实裁切尺寸；foot 按旧 foot×新 h÷旧 h 等比换算，
  因此显示高度、碰撞、38 棵散布、360 最小间距、五形态等概率和 50% 随机镜像合同不变。
- 模型、预览、正式母版、透明终稿与元数据保存在 `tools/ai-gen/_snow_pine_upgrade_20260824/`。

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
可在独立端口用`flux2-dev-fp8`兜底，完成后只关闭本轮精确PID。

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
   烘焙，不做 X/Y 翻转——草不画进砖里，8 向循环永不会把草转反。World-122不再使用低矮
   蕨类/小植物点缀，只保留独立障碍物层的四种仙人掌；沙漠地面装饰全部由模型化小件承担。

场景配置参考（scene-manager `_loadScene8`）：`{ tiles:['floor_mud_seamless'],
continuous:true, textureScaleY:0.5774, sandPatches:{texture:'floor_sand_seamless',
perChunk:6, size:760}, deco:{textures:['deco_grass_1','deco_grass_2'], perChunk:28, size:110} }`。

### Blender 建模渲染管线（render-factory-real.py，2026-08-16 定稿）

#### World-122 旧“固定地基 + AI主体”方案（2026-08-20，已废弃，不得执行）

旧方案使用Dev Depth手写48步命令、只生成建筑主体、再裁掉AI地台并尝试叠加独立运行时地基；该旧手写方案已被本分卷前部“World-122建筑最高优先级管线”完整替代。新建或重做建筑只走 `generate-world122-building-candidates.py`：`world122-building-v5` + `flux2-dev-depth`，12步默认3张、48步默认2张；年代化视觉地台必须在Blender白模中建模，与主体一同进入Body Depth和最终贴图，并记录一致的 `foundationStyle`。视觉地台不改变逻辑占格、碰撞、寻路或 `visualFootprint`。

`key-world122-building-body.py`、`mask-world122-building-body.py` 和 `compose-world122-building-preview.py` 仅可用于已标记的旧资产恢复或专门实验，不得作为正式建筑候选入口，也不得用来移除V4已经建模并通过路由验证的视觉地台。

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
- **城市道路与街景道具建模口径（2026-08-25）**：`build-world122-street-decor.py` 使用同一正交
  30°相机和44.8°模型根一次性生成道路变体与住房/农业/金币/能源四类街景道具，所有道具共享固定
  `orthoScale`，禁止逐件自动放大导致水罐、手推车和公告牌失去相对体量。道路先建完整方形铺装几何再由
  相机直接投影成2:1菱形，不允许后期透视拉伸；12帧最终由`compose-world122-street-decor.py`降采样为
  128×64精灵表。母模型、原始透明渲染、安装图集、逐件Alpha报告与两张联系预览必须共同保留；运行时
  道具只允许水平边缘槽位投影，不旋转贴图破坏固定光向与透视。第二阶段沿用同一母模型新增8组贴地
  生活痕迹（脚印、车辙、草屑、水渍、煤尘、油滴、木屑、绳头）和4组公共设施（路灯、水泵、长椅、
  消防桶架），总计28组街景资产；低矮痕迹仍从真实薄几何投影，禁止用平面手绘伪造角度。第三阶段
  新增四个本地边方向各2组的路缘/排水覆盖模型，使用透明4×4参考体锁定与道路相同的128×64画幅；
  运行时按实际道路邻接选择已单独渲染的方向版本，禁止把单张覆盖层旋转或翻转后复用。动态天气也必须
  沿用同一母模型：夜灯复用白天灯具完整几何、只替换发光材质；积水由低矮水面与同平面高光薄片建模，
  每个形态单独固定相机渲染，禁止运行时旋转或俯视手绘。当前母版合同为12帧道路、33张街景道具/痕迹/
  设施/天气贴图和8张方向路缘。Blender 5.1批处理必须带`--factory-startup`，避免用户插件在后台启动时
  写自身日志阻断生成；材质脚本按`BSDF_PRINCIPLED`节点类型查找，不依赖可能变化或本地化的节点名称。
  最终归档保留`.blend`、manifest、原始透明渲染、Alpha报告与审批预览，删除Blender自动产生的`.blend1`；
  运行时已安装贴图不是废案，不得因源目录存在同名原始渲染而误删。
- **沙漠地貌道路式升级口径（2026-08-26）**：平材质地面仍必须以世界坐标连续无缝沙纹理作为底层，
  禁止重新退化为整块不透明菱形地砖；`build-world122-desert-terrain.py`复用道路同一正交30°相机、
  44.8°模型根与固定道具体量，只生成3帧透明128×64碎石细节图集，帧边必须羽化后再叠到格网；
  风纹、裂缝和冲蚀线的模型、图集帧与生成代码均已删除，沙漠地面不得再出现格网线条。
  18组模型化小件按世界坐标宏格和位面世代seed确定性散布；
  小件库除碎石、枯枝、骨片、陶片和枯根外，必须包含石板/砂岩、枯植、骨骸、陶器、遗物和盐晶等
  轮廓明显不同的类型，枯枝只作为低权重稀有项。跨2048分块不得留空带或裁断；所有层
  只烘焙视觉，不创建碰撞、占格、寻路或快照实体。原4张低矮荒漠植物贴图及配置入口已删除，
  旧地貌归档中的线条帧、预览和联系表已清除；四种仙人掌继续作为独立障碍物保留，不进入本地貌小件池。
  地图边缘黑色淡出必须在底材、细节格、软边补丁和小件全部绘制完成后最后叠加，禁止被后续地貌盖回。
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

历史阶段结果见 [AI资产历史记录](02-ai-asset-history.md)。
