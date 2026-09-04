# 矿业工会 · 模型与出图记录

## 定稿归档清理（2026-09-01）

用户选定的结构03、03A直接编辑链、48步02、纯紫晶矿车修订、模型/Depth、提示词、参数、最终透明图和运行时登记全部保留。已删除结构01/02、未采用的无蒙版纠偏批、48步01、`.blend1`等明确未选文件；`accepted_48_v02/`及当前紫晶矿车来源链未清理。完整删除清单与保留边界见`cleanup-manifest.json`，下文提到的已删候选只作为历史比较记录，不是活动路径。

用户要求矿洞位面特色建筑“矿业工会”，依次确认模型、03A纠偏稿，并选择48步精修02。随后要求将矿车货物替换成纯紫色晶石，并回复“可用，继续”确认该修订。当前正式贴图、缩略图和四张光照图已入库；玩法尚未定义，未开放游戏内建造入口。

正式资源：[主体PNG](../../../assets/terrain/mining_guild.png)、[128×64缩略图](../../../assets/ui/building-thumbnails/mining_guild.png)。尺寸、严格视觉占地参数和资源登记状态见[runtime/README.md](runtime/README.md)及[asset-registration.json](runtime/asset-registration.json)。未向生产建筑配置中猜填费用、属性、兵种或经济效果。

当前交付：[纯紫色晶石修订PNG](cart_purple_crystal_v01/mining_guild.png)、[整体预览](cart_purple_crystal_v01/mining_guild_preview.png)及[车内细节](cart_purple_crystal_v01/cart_after_detail.png)。**精修02仍是选定底稿**，覆盖此前助手对01的推荐；仅车内局部经Dev+Depth蒙版48步重绘，并收敛晶石高光与饱和度。车身、轨道、建筑、地台、徽记、旗面和台面样石均保留。复用原Alpha和裁切框，原始02及全部生成祖先不覆盖；来源与参数见[本轮记录](cart_purple_crystal_v01/provenance.json)。下文为阶段历史，历史“灰岩紫矿斑”描述不再约束本轮晶石货物。

## 造型

- 4×4为首版建模建议，与已有探险家营地/丛林神庙同规格；800×800×28模型地台投影为约2:1菱形。实际占格、碰撞与运行时标定尚未修改。
- 一个两层石木工会主厅，首层分体墙保留真实门洞、暖暗内部、开启双门和浅门槛，二层连续承重体与板岩双坡顶。
- 左侧附着低矮装矿棚，台内短轨、四轮敞口矿车、水平牵引绞盘和小鉴矿台构成采矿身份，不建立第二座独立矿井或高塔。
- 无文字交叉矿镐徽记、山墙紫旗和车内少量紫矿呼应矿洞高能矿脉；没有人物、外部道路、泛光特效或可读文字。
- 共用建筑组件与30°正交相机、44.8°根旋转，1024²透明原生预览与完整Body Depth；灰石/深木/板岩色块用于模型审阅，最终PBR表面尚未制作。

## 文件

- `mining_guild_model.blend`：可编辑模型、材质、灯组和相机，所有门窗、车轮、徽记、矿石等保留独立英文名称。
- `mining_guild_model_preview.png` / `mining_guild_model_approval_preview.png`：同一次原生渲染，后者为交付展示副本。
- `mining_guild_body_depth.png`：同相机完整结构深度，包含地台，是各次生成共用的结构控制源。
- `manifest.json`：造型尺寸、材质、相机与用途真源；`model-metadata.json`记录地台投影角点和来源状态。
- `build-model.py`：本建筑装配，复用`building-component-kit.py`和`settlement-building-pack-blender.py`的材质/场景/相机/渲染入口；未修改共享组件代码。
- 组件登记：`skill/references/world122-building-components.md`的矿业工会条目。

## 重建

```powershell
& 'E:/Program Files/Blender Foundation/Blender 5.1/blender.exe' --background --factory-startup --python tools/ai-gen/_mining_guild_20260831/build-model.py -- tools/ai-gen/_mining_guild_20260831/manifest.json mining_guild tools/ai-gen/_mining_guild_20260831/mining_guild_model.blend tools/ai-gen/_mining_guild_20260831/mining_guild_model_preview.png tools/ai-gen/_mining_guild_20260831/mining_guild_body_depth.png
```

## 首次建模阶段边界（历史记录）

已进行建模生产与离线预览查看，按预览修正棚顶遮住旗帜以及台阶埋入地台的问题。未运行测试或运行时验证，按约定由用户测试；未接入游戏、修改经济/科技/兵种、运行AI生图、构建或同步EXE。模型及4×4规模仍待用户视觉确认。

Blender在保存模型时出现系统缩略图缓存路径编码警告；正式blend、预览和Depth仍成功写入本目录，未修改用户缓存或Blender配置。

## 已确认模型后的12步准备

- `candidate-manifest.json`：FLUX.2 Dev + 同模型完整Depth，1024²，12步×3张，CFG 3.5，Depth 0.78，Euler/simple，种子132311～132313。Edge Control关闭；自动生成的边缘图仅为本地辅助文件，不上传。
- `mining_guild_structure_prompt_prepared.txt`与`candidates_dev_s12/mining_guild/mining_guild_structure_prompt.txt`：通过标准入口组装的实际提示词，公共建筑v5画风仅一次；采用canonical `rubble_stone`地台路由，与模型的fieldstone同义，不改变几何。
- 标准生成器新增仅`assetClass:mining_guild`启用的窄分支，避免旧通用“省略招牌/家具/旗帜”和虚构塔楼的指令冲突；保留已建模入口、矿车、徽记、旗帜与鉴矿台，不改变其他建筑。
- 沙箱首次在Depth上传前报WinError 10013；随后标准网络权限申请被自动安全审查拒绝，要求用户明确允许向`http://192.168.3.142:8188`发送这份Depth、提示词和参数。未绕过拒绝、未上传成功、未提交任务，没有成图或选择结果。
- 获得明确上传授权后，可继续同一标准命令；无需重建模型或改用其他后端。

上述阻断随后由用户明确回复“允许，我能给你一次性授权，以后不用每次都问我是否允许吗”解除。使用同一标准入口重试成功，未绕过审查。向`192.168.3.142:8188`发送了本模型Depth、提示词与生成参数，没有发送代码、存档、凭据或无关文件。后续同目的地建筑任务的限范围授权记录在项目`AGENTS.md`，不会关闭系统沙箱、自动审查或选稿门禁。

```powershell
& 'E:/无尽轮回/长期备份/2026-7-13-1/ComfyUI/.venv/Scripts/python.exe' -B tools/ai-gen/generate-world122-building-candidates.py --manifest tools/ai-gen/_mining_guild_20260831/candidate-manifest.json --out tools/ai-gen/_mining_guild_20260831/candidates_dev_s12 --only mining_guild --stage structure --variants 3 --raw-only
```

已完成本地出图准备和必要局部修改核对；未运行测试或运行时验证，按约定由用户测试。未启动48步、接入游戏或同步EXE。

## 3张候选的结果

| 候选 | 种子 | 主要观察 |
|---|---|---|
| 1号 | 132311 | 敞门保留，但单面山墙旗被换成正面双旗；紫矿变高晶柱，徽记与台上器件偏亮金色。 |
| 2号 | 132312 | 单面山墙旗保留，但双门被关上，车内晶柱更高，地台增加散石。 |
| 3号 | 132313 | 单面山墙旗、敞门与整体组合更接近模型；紫矿较接近岩石表面矿物。但桌面仍被解释成金属砝码，材质颗粒、金紫饱和度偏高，地台外存在明显投影。 |

建议以3号的构图作纠偏参考，恢复低矮紫矿与鉴矿台样石、收敛表面颗粒和金紫亮度、取消外投影后再考虑精修。推荐不等于用户选定；本批没有通过标准画风/结构全部门禁，因此没有自动进入48步。

三张完整`*_raw.png`、每张`*_generation.json`、实际提示词与同相机Depth均保留。`present-candidates.py`只将完整原图等比排版，未抠图、裁主体、改色或用Depth遮罩遮掩偏移。已查看本次真实修改和交付素材；未运行测试或运行时验证，按约定由用户测试。未接入游戏、同步EXE、提交或推送。

## 选定03后的纠偏与03A交付（上一阶段）

用户已确认以03继续调整，原03、模型与完整Depth不变。既定局域网授权继续适用，本次没有再次索取上传许可或改动安全设置。

1. `corrections_03_dev_s12/`（已清理）：以原03为init，Dev 12步、Depth 0.75、denoise 0.50、种子132331/132332。两张分别发生关门/添散石等回退，均不采用；失败原因保留在本段与`cleanup-manifest.json`。
2. `corrections_03_masked_dev_s12/`：回到原03，使用保存的区域蒙版，Dev 12步、Depth 0.75、denoise 0.70、种子132341。台面生成了灰/紫矿石样品，敞门保留，但右侧添石、金紫仍偏亮；整张不作为成品，仅其台面多边形成为03A的直接编辑输入。
3. `corrected_03A/`：建筑专用key（RGB距离90，封闭绿幕清理；高饱和绿H45～80、S≥180、V≥20）和完整Depth外扩12px清理原03绿幕/外投影。主体没有绿色材质，保留灰石与暗屋面。后续RGB处理直接复用这份Alpha，不挪动门窗、矿车、轨道、单面旗和地台。
4. `finish-source03.py`：只合成生成台面的限定多边形，羽化1.25px；对源RGB做两次保边降噪（85%混合），局部收敛紫旗、矿物、徽记和绞盘。调色带饱和度渐变和区域边缘羽化，防止误染旗帜旁的中性墙面。未经采用的额外散石不在合成区域内。

全部AI调用均通过标准生成器；12步图生图使用`--stage refine --allow-nonstandard --raw-only`，明确记录为**纠偏实验**，不能因命令名为refine就视为已通过48步精修门禁。没有使用其他生成后端，也没有修改共享生成器、模型、游戏逻辑或运行时纹理。

未采用的无蒙版`correction-manifest.json`及一次性准备脚本已清理；获准链继续由`masked-correction-manifest.json`、保留的`*_generation.json`及`corrected_03A/provenance.json`记录参数、合成坐标、直接输入、颜色参数和Alpha来源。

当前可见结果：敞门和原有布局保留；台面由金色砝码换为矿石样品；颗粒与金紫亮度收敛；透明预览不再保留地台外投影。**瓦片排布、石缝数量和车内矿石外形仍沿用原03**，RGB降噪不能把它们真正重做成更稀疏的大块面。03A是本轮推荐审阅候选，不标记为已获准定稿。

已查看完整生成图、编辑蒙版、透明候选与离线对照。未运行测试或运行时验证，按约定由用户测试；未进入48步定稿、接入游戏、标定运行时占格、构建、同步EXE、提交或推送。

## 03A确认后的标准48步精修

以下是上轮出图时的观察与推荐，已由用户本轮选择02覆盖；01的样石补色不再是待办。

- 用户确认03A并继续；使用已有同目的地局域网上传授权，没有重复询问许可，没有修改权限或共享生成器。
- `refine_03A_inputs/mining_guild_03A_refine_init_green.png`：03A原1024²画布补纯绿工作副本。源RGBA四角Alpha均为0，未裁剪、缩放、重新抠图或改色；`input-provenance.json`记录准备方法与确认范围，03A源不变。
- `refine-03A-manifest.json`：Dev 48步×2、Depth 0.75、denoise 0.30、CFG 3.5、Euler/simple，种子132351/132352；原模型完整Depth与`world122-building-v5`公共画风不变，Edge关闭，无非标准覆盖。
- `candidates_03A_dev_s48/mining_guild/`：两张完整raw、各自生成元数据、实际提示词和Depth；`candidates_03A_dev_s48/review.json`记录逐张观察。局部Edge文件由标准入口派生，但未用于控制或上传。
- `present-refine-03A.py`：将03A补绿副本与两张完整生成图等比排版，不裁主体、不调色、不修补。

| 候选 | 观察与建议 |
|---|---|
| 精修01 / 132351 | 更接近03A，敞门、单旗、圆形矿镐徽记、绞盘、轨道矿车和两块样石均保留；没有此前新增大块散石的回退。材质更清晰，但台面紫色样石变得偏灰，小五金和旗面细节也有变化。推荐供用户选定，定稿时仍需局部补回克制的紫色样石。 |
| 精修02 / 132352 | 主布局和敞门保留，但徽记形状、旗面纹样变化更多，一块台面样石变成圆柱状；保留原图供比较，不优先推荐。 |

```powershell
& 'E:/无尽轮回/长期备份/2026-7-13-1/ComfyUI/.venv/Scripts/python.exe' -B tools/ai-gen/generate-world122-building-candidates.py --manifest tools/ai-gen/_mining_guild_20260831/refine-03A-manifest.json --out tools/ai-gen/_mining_guild_20260831/candidates_03A_dev_s48 --only mining_guild --stage refine --init-image tools/ai-gen/_mining_guild_20260831/refine_03A_inputs/mining_guild_03A_refine_init_green.png --raw-only
```

两张48步任务均已完成，后端分别报告56.4秒和70.4秒。已查看完整图与本轮实际改动，未把推荐记为用户选定；未进行新候选Alpha收口、运行时标定或游戏接入。未运行测试或运行时验证，按约定由用户测试；未构建、同步EXE、提交或推送，保留并行会话改动。

## 用户选定02与透明素材定稿

- 选定真源：`candidates_03A_dev_s48/mining_guild/mining_guild_refine_v02_raw.png`，种子132352。用户选择覆盖助手此前的比较意见，不再把其徽记或圆柱状样石当作待修问题，也不补回01或03A的颜色。
- 交付：`accepted_48_v02/mining_guild.png`，**RGBA 877×691**，原始像素紧裁，四周保留4px透明边，没有缩放主体。`mining_guild_selected02_preview.png`为单独的棋盘底展示图，不能作为透明资产使用。
- 专用抠绿按本图四角测得键色`[13,247,0]`，RGB距离阈值80、清理封闭键色；没有全画布HSV去绿。保留门洞、棚下开口和地台边界。
- 原Depth仅用于观察参考，没有乘入Alpha、膨胀或回填，以保留用户已接受的02细小轮廓差异；专用抠绿后未见需要额外裁除的独立外投影。
- 使用专用绿边工具，修复范围限定为Alpha内侧2px，G≥90且分别高于R/B至少35；工具报告仅替换1078个边缘RGB像素，Alpha不变。最终以`--preserve-alpha-exact --nearest-opaque-edge-rgb`紧裁。
- `accepted_48_v02/provenance.json`记录选择、完整祖先、工具参数及输出；`export-metadata.json`记录裁剪框`[74,232,951,923]`。Alpha范围为0～255，透明像素RGB均为0。名义512×403显示尺寸和脚点199仅为导出参考，未做运行时占格标定、未写游戏配置。

```powershell
& 'E:/无尽轮回/长期备份/2026-7-13-1/ComfyUI/.venv/Scripts/python.exe' -B tools/ai-gen/key-world122-building-body.py tools/ai-gen/_mining_guild_20260831/candidates_03A_dev_s48/mining_guild/mining_guild_refine_v02_raw.png tools/ai-gen/_mining_guild_20260831/accepted_48_v02/mining_guild_keyed.png --threshold 80 --remove-enclosed-key --nearest-opaque-edge-rgb --preview tools/ai-gen/_mining_guild_20260831/accepted_48_v02/mining_guild_keyed_preview.png
& 'E:/无尽轮回/长期备份/2026-7-13-1/ComfyUI/.venv/Scripts/python.exe' -B tools/ai-gen/repair-local-green-spill.py tools/ai-gen/_mining_guild_20260831/accepted_48_v02/mining_guild_keyed.png tools/ai-gen/_mining_guild_20260831/accepted_48_v02/mining_guild_edge_clean.png --rect 0,0,1024,1024 --max-edge-distance 2 --min-green 90 --green-margin 35
& 'E:/无尽轮回/长期备份/2026-7-13-1/ComfyUI/.venv/Scripts/python.exe' -B tools/ai-gen/finalize-building-runtime.py tools/ai-gen/_mining_guild_20260831/accepted_48_v02/mining_guild_edge_clean.png tools/ai-gen/_mining_guild_20260831/accepted_48_v02/mining_guild.png --display-width 512 --padding 4 --preserve-alpha-exact --nearest-opaque-edge-rgb --metadata tools/ai-gen/_mining_guild_20260831/accepted_48_v02/export-metadata.json
```

已查看原图、keyed、透明定稿和高对比棋盘预览，并核对本次实际改动。未运行测试或运行时验证，按约定由用户测试；未再次生图、接入游戏、修改占格/经济/科技、制作运行时光照图、构建或同步EXE。
