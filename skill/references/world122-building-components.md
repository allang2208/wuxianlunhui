# World-122 建筑组件登记表

本表是组件发现与复用的唯一登记入口。组件代码真源仍在 `tools/ai-gen/building-component-kit.py`；建筑装配真源在 `tools/ai-gen/settlement-building-pack-blender.py`。建模前先查本表，新增组件后在同一次修改中更新本表。

## 登记和提升规则

1. 可跨两栋及以上建筑复用、输入可以参数化、没有写死某栋建筑坐标的几何，放进 `building-component-kit.py`，并登记到“公共组件”。
2. 只服务一栋建筑、但内部已经由多个命名对象组成的结构，暂时留在对应 `build_<building>()` 中，登记到“建筑级组合件”。第二栋建筑需要同类结构时，先提炼为公共函数，再调用，禁止复制整段坐标。
3. 新组件必须记录：函数/对象前缀、参数契约、依赖材质、朝向约定、首个使用建筑、当前使用建筑。
4. 组件产生的 Blender 对象必须使用稳定英文名；门扇、栏杆、箱桶、枪架等子件保持独立，保证 `.blend` 可以直接拆取复用。
5. 仅调整尺寸或颜色不创建新组件：尺寸写 `manifest.json`，公共颜色写顶层 `palette`，单栋差异写该建筑的 `paletteOverrides`。每栋建筑独有的生成约束写 `prompts/<building>.txt`。

## 坐标与接口约定

- 坐标：`x=屏幕横向对应的模型轴`，`y=纵深（正值远离相机）`，`z=向上`；位置通常表示组件中心。
- 角度参数使用度，组件内部统一转换为 Blender 弧度。
- 所有组件接收 `collection`、`parent/root` 和稳定 `name`，新对象挂在建筑 ROOT 下并移入该建筑的 editable collection。
- 建筑 ROOT 固定旋转 `44.8°`；相机为 30° 正交相机。组件内部不得再偷偷补一套全局视角旋转。
- 材质由 `common_context()` 统一创建并传入，组件不能自行生成风格冲突的高饱和材质。

## 基础几何、材质与渲染基础件

| 函数 | 作用与主要参数 | 当前用途 |
|---|---|---|
| `rgba(values)` | 将 manifest 颜色转为 Blender RGBA 浮点元组 | 全部材质 |
| `move_to_collection(obj, collection)` | 把新对象移入指定可编辑集合 | 所有 primitive 与自建 mesh |
| `material(name, color, roughness, metallic, noise, emission)` | 统一 PBR、噪声、凹凸和发光材质 | stone/plaster/timber/roof/thatch/iron/brass/glass/glow/straw |
| `bevel(obj, width, segments)` | 给硬表面边缘增加可读倒角 | 所有箱体、圆柱与自建屋顶 |
| `box(..., size, location, mat, rotation, bevel_width)` | 参数化长方体；墙、梁、平台、栏杆、箱子和武器的基础图元 | 全部建筑 |
| `cylinder(..., radius, depth, location, mat, rotation, vertices, bevel_width)` | 圆柱、桶、轮、靶面、门环、滑轮等基础图元 | 风车、仓库、靶场、门、灯笼、齿轮 |
| `setup_scene(spec, preview_path)` | 透明 Eevee 场景、统一光照、色彩管理和 1024 输出 | 所有组件化建筑 |
| `setup_camera(spec, root)` | 按完整组件包围盒自动计算正交画幅与 bottomY | 所有组件化建筑 |
| `render_depth(scene, root, camera, depth_path, label)` | 从同一模型/相机输出黑底灰度 Depth Control | 所有 12/48 步建筑候选 |

## 公共结构组件

| 函数 | 参数契约/生成内容 | 当前使用建筑 |
|---|---|---|
| `gabled_prism(length, width, roof_height, location, gable_mat, roof_mat)` | 可编辑五面双坡屋顶主体，山墙和坡面分材质 | 风车、仓库、铁匠铺、靶场、骑兵学院、茅草屋 |
| `roof_rows(length, width, roof_height, base_z, mat, rows)` | 双坡屋顶两侧的重叠瓦行/草层；`rows` 控制层数 | 同上；茅草屋使用较少行数形成厚草顶 |
| `half_timber_facade(width, height, y, base_z, timber, bays, include_braces)` | 正立面上下梁、立柱和交替斜撑 | 标准壳、风车上层、靶场屋、骑兵塔 |
| `half_timber_side(depth, height, x, base_z, timber, bays)` | 侧立面梁柱和斜撑 | 标准壳、风车上层 |
| `shutter_window(location, glass, timber, iron, orientation, scale)` | 窗框、玻璃、竖横棂与前向双百叶；支持 front/side | 风车、仓库、靶场、骑兵学院、茅草屋 |
| `double_doors(location, width, height, timber, iron, open_angle)` | 双门扇、铁带、铰链、门环；`open_angle=0` 关闭，非零打开 | 风车、仓库、靶场、骑兵学院、茅草屋 |
| `hipped_roof(length, width, height, location, mat)` | 四坡屋顶，自建 mesh；当前作为 `standard_shell(roof_kind='hipped')` 可选项 | 已注册，当前建筑包尚未正式使用 |
| `cone(radius, height, location, mat, vertices)` | 圆锥/低边数尖顶；`vertices=4` 可做方锥塔顶 | 骑兵学院训练塔 |
| `rough_boulder(size, location, mat, rotation, subdivisions)` | 独立可编辑低多边形自然岩块；尺寸、旋转与细分可控，适合重叠成矿堆或自然地基 | 能量矿石堆 |
| `faceted_crystal_prism(height, radius, location, mat, highlight_mat, lean, sides, depth_scale, rotation_z)` | 带肩部与尖顶的多棱晶柱；支持水平倾斜、横截面纵深和交替高光分面，根部保持可嵌入结构 | 能量矿石堆四形态 |
| `standard_shell(dims, roof_kind, thatch, bays)` | 组合 foundation、主体灰泥、低石墙、屋顶、正面/侧面木构；返回 frontY/sideX/roofBase 等锚点 | 仓库、铁匠铺、骑兵学院、茅草屋 |

其中 `hipped_roof`、`cone`、`standard_shell` 当前定义在 `settlement-building-pack-blender.py`。当第二套建筑包也需要这些组件时，应移动到 `building-component-kit.py`，本表路径随代码一起更新。

## 公共道具组件

| 函数 | 参数契约/生成内容 | 当前使用建筑 |
|---|---|---|
| `chimney(location, stone, iron, height)` | 烟囱筒、铁箍、帽檐和开口 | 铁匠铺、茅草屋；银行明确禁止时不得添加 |
| `gear(radius, location, metal, axis, teeth)` | 齿盘、齿、轮毂；支持 X/Y 朝向 | 铁匠铺招牌背板 |
| `lantern(location, iron, glow, orientation)` | 支架、灯笼笼体、发光芯、上下盖 | 仓库、铁匠铺、骑兵学院、茅草屋 |
| `workbench(location, timber, iron)` | 台面、四腿和台钳 | 铁匠铺 |
| `anvil(location, iron)` | 底脚、腰、砧面和砧角 | 铁匠铺 |
| `add_windmill_sails(y, hub_z, blade_length, radius, blade_width)` | 四组中心梁、双导轨、格栅叶片与前后轮毂 | 麦田风车 |

`add_windmill_sails` 当前仍在建筑包脚本中；第二栋建筑需要风车/水车叶片时再提炼成 kit 公共函数，并补充轴向参数。

## 建筑级组合件（已命名但尚未提升为公共函数）

这些组合件可以从生成的 `.blend` 中直接拆取。出现第二个调用者时，先参数化提升，不复制粘贴。

| 建筑 | 对象前缀/组合件 | 组成与复用方向 | 记录位置 |
|---|---|---|---|
| 仓库 | `Warehouse_SecondFloor_*` | 二层正面装卸平台、立柱、双层栏杆、阁楼门 | `build_warehouse()` |
| 仓库 | `Warehouse_FourthFloor_*` | 与二层垂直方向不同的四层侧阳台、侧门、栏杆 | `build_warehouse()` |
| 仓库 | `Warehouse_Platform_Crate_*` / `Barrel_*` / `BundledSacks` | 箱子铁/木带、桶箍、袋装物资；适合提炼为 clutter kit | `build_warehouse()` |
| 仓库 | `Warehouse_Hoist_*` | 吊梁与滑轮 | `build_warehouse()` |
| 铁匠铺 | `Forge_Left_Door_*` / `Forge_Left_Interior` | 左侧打开门、门框和可见室内暗面 | `build_blacksmith()` |
| 铁匠铺 | `Forge_Interior_*` / `Forge_Opening_*` | 工具架、余烬、炉口框和炉光 | `build_blacksmith()` |
| 靶场 | `Range_Yard_*` | 一格院落的侧/前栏杆、门洞和立柱 | `build_shooting_range()` |
| 靶场 | `Range_Target_*` | 靠近前围栏的靶柱、底脚、草靶与铁心 | `build_shooting_range()` |
| 靶场 | `Range_Armory_Rack_*` / `Visible_Bow_*` / `Visible_Gun*` / `Powder*` | 檐下实体枪架、弓枪、火药架和袋；屋顶必须为空 | `build_shooting_range()` |
| 骑兵学院 | `Cavalry_Training_Tower*` / `Cavalry_Tower_Timber` | 单座训练塔、木构立面和方锥顶 | `build_cavalry_school()` |
| 骑兵学院 | `Stable_Door_*` / `Stable_Loft_Window` / `Cavalry_Crest` | 马厩门组、阁楼窗和马蹄徽记 | `build_cavalry_school()` |
| 仓鼠军营 | `Barracks_MainHall_*` / `Barracks_MainGate_*` | 中央石砌操练厅、连续双坡屋顶、强化门框、双开军营门和暖光入口 | `build_hamster_barracks()` |
| 仓鼠军营 | `Barracks_LeftWatchtower_*` / `Barracks_RightWatchtower_*` | 两座完整对称石砌瞭望塔、强化石带、箭窗、方锥顶与独立顶饰 | `build_hamster_barracks()` |
| 仓鼠军营 | `Barracks_WeaponRack_*` / `Barracks_ShieldCrest` / `Barracks_GateLantern_*` | 附墙长矛架、盾徽与门灯；维持克制的军事识别，不生成独立院落 | `build_hamster_barracks()` |
| 研究院 | `Research_CentralTower_*` / `Research_LeftTower_*` / `Research_RightTower_*` | 一座高中央塔与两座低侧塔；石砌塔身、半木图书室、暖窗和陡峭四坡顶 | `build_research_institute()` / `add_research_tower()` |
| 研究院 | `Research_WingRoof_*` / `Research_Main*` / `Research_Astrolabe_*` | 两翼连续坡屋顶、连接式主厅与附墙星盘标识；保持三塔为单体建筑 | `build_research_institute()` / `research_pyramid_roof()` |
| 探险家营地 | `ExplorerCamp_CommandHall_*` / `ExplorerCamp_CommandCanvasRoof` | 石脚帆布指挥厅、加固木框、开启入口与暖光；作为单体前进基地的主体 | `build_explorer_camp()` |
| 探险家营地 | `ExplorerCamp_Lookout*` / `ExplorerCamp_Ladder*` / `ExplorerCamp_TowerConnector` | 与主厅相连的唯一木制瞭望塔、观察舱、方锥帆布顶、固定梯与连接段 | `build_explorer_camp()` |
| 探险家营地 | `ExplorerCamp_Supply*` / `ExplorerCamp_Map*` / `ExplorerCamp_Compass*` | 附着式补给雨棚、结构内储物柜、地图板与罗盘徽记；不得拆成独立帐篷或散落道具 | `build_explorer_camp()` |
| 矿工营地 | `MinerCamp_Shed_*` / `MinerCamp_Slate*` | 低矮石木矿棚、连续板岩双坡屋顶、木构外框与独立屋脊梁 | `build_miner_camp()` |
| 矿工营地 | `MinerCamp_Portal_*` | 暗色矿洞内口、暖光深处、双石柱、可编辑拱券石与门槛 | `build_miner_camp()` |
| 矿工营地 | `MinerCamp_Hoist_*` | 与主棚相连的四柱卷扬架、卷筒、绳索、导轨矿笼、矿石和共用斜棚顶；不得拆成独立建筑或矿车 | `build_miner_camp()` |
| 市场 | `Market_TradingHall` / `Market_BroadHippedRoof` / `Market_*Timber` | 单体石木交易厅、宽四坡屋顶和连续半木框架；主体保持封闭，不生成散摊或独立帐篷 | `build_market()` / `hipped_roof()` |
| 市场 | `Market_Counter*` / `Market_SideCounter*` / `Market_*Canopy*` | 四个正面摊位、两个侧面摊位及与主体重叠相连的 L 形条纹前檐；摊位不得拆成独立帐篷 | `build_market()` |
| 市场 | `Market_MainAdvertisement*` / `Market_Product*` / `Market_FixedScale*` | 大型钱币广告牌、四块商品图标吊牌与固定秤；仅使用无文字图标，所有招牌固定在交易厅或前檐 | `build_market()` |
| 传送门 | `Portal_LeftPier*` / `Portal_RightPier*` / `Portal_MarbleArch` | 两根方形大理石门柱、柱脚/柱头、内嵌面板与单一道半圆拱；保持简洁单门轮廓 | `build_portal()` / `portal_arch_ring()` |
| 传送门 | `Portal_CyanCore` / `Portal_BrassInnerInlay` / `Portal_Keystone` | 单片拱顶青蓝门芯、窄黄铜内嵌线、单块拱顶石与门槛；禁止扩展成多环祭坛群 | `build_portal()` / `portal_core()` |
| 丛林神庙 | `JungleTemple_*Terrace` / `JungleTemple_CentralStep_*` / `JungleTemple_Sanctuary*` | 完整方形地基、三层居中退台、唯一中央宽阶与后部封闭圣殿；保持单体功能建筑，不拆成遗迹群 | `build_jungle_temple()` |
| 丛林神庙 | `JungleTemple_UpperLevel_*` / `JungleTemple_*Tower*` | 圣殿上方三层逐级收分的中央楼层，以及左右完全镜像并与主体相连的双塔台；塔台含塔身、平台、四角柱和石顶盖 | `build_jungle_temple()` |
| 丛林神庙 | `JungleTemple_Crown*` / `JungleTemple_RoofComb` / `JungleTemple_SunMedallion*` / `JungleTemple_Vine*` | 顶层阶梯冠部、单一太阳徽记、左右镜像附墙苔藓藤蔓与唯一暗门；植被只能作为附着细节 | `build_jungle_temple()` |
| 茅草屋 | `Cottage_*` | 厚草顶标准壳、门窗、烟囱、灯笼的住宅组合 | `build_thatch_hut()` |
| 麦田风车 | `Mill_*` / `Sail_*` | 细高石基、木构上层、紧凑机房屋顶和四叶片 | `build_windmill()` / `add_windmill_sails()` |

## 建筑与组件使用矩阵

| 建筑 | 主体结构 | 功能组件 |
|---|---|---|
| 麦田风车 | 细高石基 + 木构上层 + 双坡顶 | 四叶片、谷仓门、前/侧窗 |
| 仓库 | 四层标准壳 | 二层前阳台、四层侧阳台、箱桶、袋、吊梁 |
| 铁匠铺 | 低矮标准壳 | 左开门、内部工具/炉火、工作台、铁砧、烟囱 |
| 靶场 | 后部小屋 + 一格围栏院落 | 前围栏靶子、檐下枪架、弓枪和火药袋 |
| 骑兵学院 | 马厩标准壳 + 单训练塔 | 双马厩门、阁楼窗、徽记、双灯笼 |
| 仓鼠军营 | 中央石砌操练厅 + 对称双瞭望塔 | 强化双开门、箭窗、附墙长矛架、盾徽与门灯 |
| 研究院 | 石砌主厅 + 中央高塔 + 双侧低塔 | 图书室暖窗、双翼蓝灰坡顶、附墙星盘标识 |
| 探险家营地 | 帆布指挥厅 + 单座相连瞭望塔 | 固定梯、补给雨棚、地图板、罗盘徽记与暖灯 |
| 矿工营地 | 石木矿棚 + 一体式矿洞入口 | 拱券石、暖灯、附着卷扬架、卷筒、绳索与导轨矿笼 |
| 市场 | 石木交易厅 + 宽四坡顶 | 四正两侧固定摊位、相连 L 形条纹前檐、大型钱币广告牌、商品吊牌、固定秤与双灯 |
| 传送门 | 浅阶大理石地台 + 双方柱单圆拱 | 青蓝单门芯、窄黄铜内嵌线、单块拱顶石与门槛 |
| 丛林神庙 | 完整方形地基 + 三层退台 + 后部封闭圣殿 + 三层收分上楼 | 单中央宽阶、唯一暗门、左右对称双塔台、顶层冠部、太阳徽记与镜像附墙藤蔓 |
| 能量矿石堆 | `EnergyNode_Rock_*` + `EnergyNode_Crystal_*` | 四种运行时形态共享一体化自然岩块矿堆；双尖、三冠、斜晶与密集晶群分别由 manifest 晶柱数组装配，正常/枯竭态复用同一 Depth |
| 茅草屋 | 厚茅草标准壳 | 门窗、烟囱、灯笼 |

本表只记录组件覆盖关系。实际完成度、导入状态和验收结果统一查 `git log` 与 `CHANGELOG.md`，不写入 skill。

## 新增组件时具体改哪里

1. **公共组件代码**：`tools/ai-gen/building-component-kit.py`。
2. **当前建筑装配调用**：`tools/ai-gen/settlement-building-pack-blender.py` 的对应 `build_<building>()`。
3. **尺寸/相机/颜色**：`tools/ai-gen/_settlement_building_pack_20260821/manifest.json`。
4. **生成语义与禁止项**：`tools/ai-gen/_settlement_building_pack_20260821/prompts/<building>.txt`。
5. **组件登记**：本文件对应表格；写明函数、参数、首用/现用建筑和对象名前缀。
6. **技能入口**：只有优先级、阶段或验收规则发生变化时才改 `skill/02-ai-asset-pipeline.md`；单纯增加一个组件不把实现细节重复写进入口章节。

组件登记和代码实现必须同批提交。若发现模型里已有可拆对象、但本表没有记录，应先补登记再继续新建筑建模。
