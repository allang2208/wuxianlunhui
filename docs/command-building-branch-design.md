# 指挥所 → 司令部 → 国防部

**Git发布边界**：下文接入状态指本地开发工作区；本次仅归档正式素材/来源与知识库，完整玩法代码受未合入公共协议阻断，详见[发布记录](world-strategy-publication.md)。

2026-08-30。三档4×4指挥建筑已完成建模、材质精修、透明主体及源码接入。用户确认采用**指挥所A、司令部B、国防部A**，记录在`tools/ai-gen/_command_branch_20260830/final-selection.json`。稳定建筑键仍为`expedition_camp`，旧远征营地原地使用新名称与素材；编组、打包、行军、接战及部队归属不改。

**当前交付：定稿A/B/A、三级科技与旧档兼容已落盘。**

- 正式素材：`assets/terrain/command_post.png`、`military_headquarters.png`、`defense_ministry.png`；三张128×64建造缩略图与各四张lighting派生图同步制作。素材沿用现有按需建筑加载，不新增逐帧逻辑。
- 制作真源：`accepted/runtime-assets.json`逐级指向选中raw、body、生成元数据、运行时元数据和四底色预览；`accepted/command_buildings_accepted.png`为同占地离线总览，不是游戏截图。旧模型Depth与所选raw不完全一致，未参与Alpha裁切；从raw进行安全RGB抠绿，只在Alpha内侧3px处理溢色，保留旗帜、桌面和所有获准造型。
- 显示标定：各级分别测量地台外侧接地点，使用`strict`独立XY映射至512×256，基础与一级共用标定，二三级独立登记。没有修改逻辑4×4、碰撞、寻路、道路或建造价；仍为800能源、每个位面一座。
- 科技：`technology-tree.json`与`TechnologySystem`升级为v53，三节点位于「军事指挥 → 指挥中枢」。一级解锁建造；二三级通过`buildingTiers`全局更新现有/新建/读档建筑名称与外观，仍只有一支亲征军团、最多24名士兵及原队友规则。
- 旧档：只从正在载入的存档判断兼容资格。v53以前含`expedition_camp`结构或外派亲征军团时，补齐`command_post_level_1`，不改其他已完成项、未完成研究、部队和世界快照，也不免费获得二/三级；原先完全没有科技存档的旧版仍沿用既有`legacyUnlockAll`兼容。一级的这一兼容完成可以先于旧前置，不顺带赠送战术指挥等其他权限。
- 首个建设位面可直接建造基础研究所；其一级科研不要求出征或多个位面。指挥所仅以战术指挥为前置，不新增地牢首通门槛。世界面板提示和出征编组标题已统一名称。
- 修改范围：`data/producer-buildings.json`、`data/technology-tree.json`、两份派生清单，`src/world/technology-system.js`、`src/ui/game-ui-manager.js`、`src/ui/strategic-expedition-panel.js`、`src/ui/world-switch-panel.js`与`src/world/world-strategy-system.js`，以及本资产目录、光照生成器的三个目标键和交付文档。没有改动战争调度、士兵AI或存档结构。
- 已查看本轮真实diff及必要配置调用链；仅执行素材生产工具。**未运行测试或运行时验证，按约定由用户测试；未构建、启动游戏或同步固定EXE。** 请重点验证科技解锁/升级、旧营地读档、建造幽灵与实体脚线、编组出征后返回。已接受的局部旗色/徽记/桌面差异保留；更高等级暂无额外玩法收益。

**上一阶段：六张48步精修候选。** 用户明确要求继续精修后，按上一轮建议采用第一批指挥所2号、第二批司令部4号和国防部5号，以三张完整绿底raw作为init；沿用同一模型Depth、FLUX.2 Dev、48步配置、Depth0.75、denoise0.30，每级2张。用户本次推进授权优先于此前的阶段建议；原结构偏差记录保留，不把历史审阅改写成“已经通过”，本轮以所选raw布局精修材质。

- 清单与来源：`refinement-manifest.json`，逐级`selectedSource`指向真实12步原图与生成元数据；未使用透明预览作为init。
- 新脚本：`prepare-refinement.py`记录来源与精修提示，`generate-refinement.py`通过标准建筑生成器派发，`compose-refinement-review.py`排原图/A/B对照；日志为`generation-f01.log`及三份分级日志。
- 输出目录：`candidates_dev_s48_v1/`；`refinement-review/command_branch_s48_raw_comparison.png`为原图/A/B完整绿底对照，`command_branch_s48_comparison.png`为辅助透明材质预览，另有各级独立对照。Depth仅用于生成，不用存在差异的旧轮廓裁掉选中图的旗帜和附属件；透明预览不是正式Alpha验收。
- 逐张意见：`refinement-review-notes.json`。当前比较建议为指挥所A、司令部B、国防部A，尚非用户定稿。六张主要体量和设备位置基本保留，但徽记、旗色、桌面小物与门廊装饰仍有变化；指挥所B出现蓝底徽记，国防部B出现绿蓝双色旗，司令部砖瓦细纹仍密。保留原图方便取舍，不宣称精修完全不改细节。
- 精修批次未替换正式资产、启用科技或修改游戏逻辑。未运行测试或运行时验证，按约定由用户测试；后续选稿后仍需正式Alpha收口、逐级visualFootprint标定和玩法接入。

**历史路径说明**：下述批次为当时记录。未选raw、执行日志、对照图、旧派发/安装/预算脚本现已清理；保留清单与审阅元数据。当前重建入口仅使用制作目录`README.md`，最终状态以本文开头为准。

**第二批记录：累计18张12步候选。** 用户要求“继续抽”后，沿用已授权服务器、已确认模型与标准Dev Depth参数，只调整新批次资产提示词和seed，追加每档3张。第二批显示编号为4/5/6，对应`candidates_dev_s12_v2/`中的v01/v02/v03；第一批1/2/3及其清单、原图与对照保持不变。

- 第二批清单：`candidate-manifest-b02.json`；种子分别为830511—513、830521—523、830531—533。`prepared-inputs-b02/`保留提示词，`generation-b02.log`与三份分级日志保留执行过程。
- 批次脚本：`prepare-batch-02.py`只初始化独立清单，`prepare-candidates.py --manifest ...`导出标准提示词，`generate-batch-02.py`调用标准生成器；`compose-candidate-review.py --manifest ...`生成第二批对照并同步审阅状态。`preview-settings-b02.json`记录辅助抠绿参数，未用旧Depth遮罩改写原图。
- 第二批对照：`candidate-review-b02/command_branch_s12_raw_contact_sheet.png`为完整原图，`command_branch_s12_candidates.png`为辅助材质预览；逐张观察写入`candidate-review-notes-b02.json`。未改变相机、模型、Depth、4×4地基或生成标准参数。
- 改善与局限：指挥所4号和司令部5号的旗位更靠近模型；司令部4号恢复单短横梁；国防部三张均收敛为单设备箱与单通信碟。但指挥所继续增生桌面设备并丢失部分窗格，司令部仍有旗位/徽记/横梁偏差，国防部仍有旗位和窗格偏差。整批仍未通过结构准入，不自动进入48步。
- 当前仅作为选图建议：指挥所仍优先上一批2号，司令部优先本批4号，国防部优先本批5号。建议不等于用户确认，也不自动授权精修或入库。
- 本轮修改局限于候选目录内的批次准备、派发与对照脚本，以及本文、TODO和CHANGELOG；没有修改共享生成器、科技、游戏逻辑或正式素材。未运行测试或运行时验证，按约定由用户测试。

**第一批记录**：用户已确认三档模型，并明确授权向`192.168.3.142:8188`发送这三栋建筑的Depth与提示词。建筑专用FLUX.2 Dev + Depth的12步候选已完成，每级3张共9张，原图、提示词、Depth与逐张生成元数据均已落盘；尚未进入48步、替换正式资产或修改游戏逻辑。生成器仅为`command_building`类别补齐提示词分支，避免默认建筑提示错误排除已建模的军旗、沙盘、台阶和通信碟。

本批只能作为材质方向参考，**结构审阅未通过**：三档军旗均偏离模型位置；部分候选增加天线、设备箱或第二面旗，部分屋顶、门廊和窗格也被改写。材质方向暂建议每档第2张，不代表选定或验收。按`SKILL.md`索引第02卷，结构偏差应回到模型/控制图与12步阶段处理，不能指望48步精修或Alpha裁切掩盖；结构通过且用户选定后才可精修。

- 完整原图对照：`candidate-review/command_branch_s12_raw_contact_sheet.png`，作为结构判断依据。
- 辅助材质对照：`candidate-review/command_branch_s12_candidates.png`，以及各级`*_candidate_lineup.png`；每行同一级，左至右1/2/3。透明预览仅去除幕布，未用不匹配的Depth裁掉结构偏差；仍可能有细杆绿边，不能当正式Alpha。
- 逐张意见与来源：`candidate-review-notes.json`、`candidate-review/review-index.json`、`candidate-manifest.json`。指挥所为木架/橄榄帆布/毛石；司令部为砖石/蓝灰板岩；国防部为混凝土/钢/蓝灰玻璃。罗盘亮度、地图饱和度及部分过密砖缝仍需收敛。
- 执行日志：`generation-s12.log`与`generation-parallel.log`及三份分级日志。中途只释放本批本地串行派发器，按既有任务ID接回正在生成的司令部v02，复用已下载图后完成剩余原定seed；未取消或重排服务器任务，也未超出授权九张。
- `compose-candidate-review.py`生成对照并保留所有raw，`preview-settings.json`记录逐图阈值。128阈值对国防部v03墙体误删，已仅重做辅助预览为80；司令部v01与国防部v01采用100并清除封闭幕色，其余保留128。未修改原图或进行正式Alpha验收。

## 建筑语言与材料

| 等级 | 名称 | 结构 | 材料与识别 |
| --- | --- | --- | --- |
| LV1 | 指挥所 | 单层主厅、四坡帆布顶、开放木构门廊 | 毛石基座、深木梁、橄榄色帆布；野战营房感 |
| LV2 | 司令部 | 双层砖石楼、板岩坡顶、常设石构入口 | 暖灰砖、灰石角柱、蓝灰板岩瓦；屋顶电报天线 |
| LV3 | 国防部 | 三层中轴楼、双侧办公翼、分层平屋顶 | 混凝土、深灰钢、蓝灰玻璃；屋顶通信碟与设备箱 |

三档保持中央入口、罗盘徽记、左侧军旗和右侧沙盘位置，增加楼层时不扩大地基。参考已接受的工程师营地/工程工坊/载具工厂系列的比例、低饱和色、厚实构件和清晰等距轮廓；不用人物或车辆充当建筑细节，不添加真实组织标识。基础材质预览用于确认结构与配色，墙面砖缝、帆布织纹、石材纹理和玻璃细节留到后续贴图阶段。

固定逻辑占地4×4，名义地面投影512×256；Blender地基为400×400×14模型单位，不能把400直接写入游戏碰撞配置。相机30°正交、根旋转44.8°，每级1024×1024；地基完整可见。墙壳、楼板、门叶、旗杆、徽记、天线、通信碟和沙盘都是独立命名对象，支持继续编辑。

## 解锁科技设置（v53已接入）

运行时真源：`data/technology-tree.json`。原`technology-branch.draft.json`已作为被正式配置取代的草案清理，历史预算见`research-budget.json`。三节点位于「军事指挥 → 指挥中枢」，lane9、column2/4/6；不搬动lane5指挥指令、lane6军需支援或lane8铁匠铺路线。科技图标复用各自正式建筑图片。

| 科技 | 全部直接前置 | 基础成本 | 折算科研点 | 假设有效科研/秒 | 单节点时间，不含前置 |
| --- | --- | ---: | ---: | ---: | ---: |
| 指挥所 | 战术指挥 | 180 | 270 | 1.2 | 3.75分钟 |
| 司令部 | 指挥所、集结网络、烧制砖工艺 | 520 | 1560 | 6 | 4.33分钟 |
| 国防部 | 司令部、远征后勤、现代机械制造 | 920 | 4140 | 12 | 5.75分钟 |

三档科技ID为`command_post_level_1/2/3`。全部前置为AND，不是任选。一级不依赖地牢首通、远征后勤或另一个尚未接通的位面。采用既有成本曲线，与工程建筑三级预算对齐；不再叠加一笔建筑升级科研费。

一级解锁稳定建筑键`expedition_camp`的建造权和I级建筑等级；二三级通过`buildingTier`全局切换名称与外观。**不创建三栋互相独立的建筑，不改用募兵等级，不新增单位或科研产出。** 保留800能源建造价、每建设位面一座、1支亲征军团、24名士兵及原队友限制。二三级只提供建筑名称与美术换代，不额外提供多军团、自动战争、补给或容量增益。

已保留`expedition_camp`存档键及现有营地/外派军团状态；v53迁移按上述存档证据补齐一级权限。新档须正常研究后建造。基础研究所不依赖指挥建筑、地牢首通或跨位面条件，未形成新增的解锁循环。

## 科研预算快照

`research-budget.json`基于本轮读取的v51配置生成，计入普通节点、基线节点名义成本和位面专项；这是草案预算，不是已实施的全局平衡调整或存档剩余成本。

- 现有103节点，名义总科研167030；加入草案后106节点、173000，增加5970。
- 草案后工程55150（31.88%）、军事指挥44910（25.96%）、经济与位面64300（37.17%）、位面独特8640（4.99%）。军事业已接近长期预算上沿，不靠再抬高这条线的价格填充游戏时长。
- 不增加科研建筑产能或研究岗位，单位面科研岗位与房屋容量均保持原值，三档指挥建筑新增科研岗位为0。五/六位面继续共用12点全效、超额20%、最高36点/秒；不假设任意存档都能达到封顶。仅在达到既有上限时，这条支线增加的5970点理论最短约2.76分钟。
- 二三级的功能收益尚待后续玩法设计；贴图/功能接入时可以据实际收益重定成本，不能把本轮材质升级草案视为最终数值验收。

## 文件与复现

资产目录：`tools/ai-gen/_command_branch_20260830/`。

- 总览：`command_branch_model_approval_preview.png`。
- 模型：`command_post/command_post_model.blend`、`military_headquarters/military_headquarters_model.blend`、`defense_ministry/defense_ministry_model.blend`。
- 每级同目录有`*_model_preview.png`、`*_model_approval_preview.png`、`*_depth.png`和渲染日志。
- 新组装器：`tools/ai-gen/command-building-branch-blender.py`。复用现有`building-component-kit.py`及`settlement-building-pack-blender.py`的组件、相机、灯光和Depth；没有改动公共组件。
- `manifest.json`记录尺寸、色板、材料说明和引用；`render-models.ps1`用Blender 5.1后台生成模型与图。`--factory-startup`只隔离用户插件与本地化节点命名，不更改用户偏好；`--python-exit-code 1`使生成失败能被正常报告。
- `prepare-delivery.py`用Pillow排版离线总览并计算预算快照，不修改各级原始渲染图。没有调用AI纹理生成或外部服务。
- 定稿重建：`finalize-selected.py`按`final-selection.json`调用共享建筑抠绿/边缘修复/紧裁工具，生成三张正式主体、缩略图、元数据与离线预览，不重新生图。`install-selected-config.py`为本次一次性配置接线记录，不用于覆盖后续玩法改动。
- 光照只生成三个目标：`python tools/ai-gen/build-lighting-maps.py command_post military_headquarters defense_ministry`。接地清单分别以`node tools/generate-building-preview-assets.mjs --only expedition_camp`、`--only command_post_level_2`、`--only command_post_level_3`生成；一级与基础视觉相同，生成器自动去重，不另传`command_post_level_1`。这是素材派生步骤，不是游戏验证。

## 后续接入待办

- [x] 三档4×4模型、材质分区和Depth落盘。
- [x] 发布并查看同尺度离线总览，向用户展示模型。
- [x] 三级科技前置、成本、等级ID、稳定建筑键及兼容边界落盘。
- [x] 按用户授权完成两批共18张12步候选，分别保存原图、生成参数与编号对照图。
- [x] 用户确认继续精修后，按推荐2/4/5来源完成每级两张48步候选；历史结构差异仍记录，不用抠图掩盖错位。
- [x] 用户接受推荐的A/B/A版本；沿用其徽记、旗色与附属细节，不再次生图。
- [x] 正式透明主体、三级缩略图与光照派生图落盘，逐级`strict`标定512×256，不改道路或逻辑占地。
- [x] 完整`buildingTiers[].visual`、正式科技节点和旧档兼容已接入；源码科技数据为`data/technology-tree.json`，不创建额外public镜像。
- [ ] 用户验证科技入口、已有营地升级、编组出征与读档。未运行测试或游戏运行时验证，按约定由用户测试；未发布或修改固定EXE。
