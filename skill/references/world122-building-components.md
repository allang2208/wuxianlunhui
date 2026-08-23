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
| `barrel_vault(length, width, height, location, end_mat, roof_mat, segments)` | 沿局部 X 延伸的封闭半椭圆拱顶，端面与曲面分材质；可缩短为跨拱金属肋 | 主神空间仓库；后续小礼拜堂、拱顶库房可复用 |
| `roof_rows(length, width, roof_height, base_z, mat, rows)` | 双坡屋顶两侧的重叠瓦行/草层；`rows` 控制层数 | 同上；茅草屋使用较少行数形成厚草顶 |
| `half_timber_facade(width, height, y, base_z, timber, bays, include_braces)` | 正立面上下梁、立柱和交替斜撑 | 标准壳、风车上层、靶场屋、骑兵塔 |
| `half_timber_side(depth, height, x, base_z, timber, bays)` | 侧立面梁柱和斜撑 | 标准壳、风车上层 |
| `shutter_window(location, glass, timber, iron, orientation, scale)` | 窗框、玻璃、竖横棂与前向双百叶；支持 front/side | 风车、仓库、靶场、骑兵学院、茅草屋 |
| `double_doors(location, width, height, timber, iron, open_angle)` | 双门扇、铁带、铰链、门环；`open_angle=0` 关闭，非零打开 | 风车、仓库、靶场、骑兵学院、茅草屋 |
| `hipped_roof(length, width, height, location, mat)` | 四坡屋顶，自建 mesh；当前作为 `standard_shell(roof_kind='hipped')` 可选项 | 已注册，当前建筑包尚未正式使用 |
| `cone(radius, height, location, mat, vertices)` | 圆锥/低边数尖顶；`vertices=4` 可做方锥塔顶 | 骑兵学院训练塔 |
| `rough_boulder(size, location, mat, rotation, subdivisions)` | 独立可编辑低多边形自然岩块；尺寸、旋转与细分可控，适合重叠成矿堆或自然地基 | 能量矿石堆 |
| `faceted_crystal_prism(height, radius, location, mat, highlight_mat, lean, sides, depth_scale, rotation_z)` | 带肩部与尖顶的多棱晶柱；支持水平倾斜、横截面纵深和交替高光分面，根部保持可嵌入结构 | 能量矿石堆四形态、位面谐振塔 |
| `standard_shell(dims, roof_kind, thatch, bays)` | 组合 foundation、主体灰泥、低石墙、屋顶、正面/侧面木构；返回 frontY/sideX/roofBase 等锚点 | 仓库、铁匠铺、军械库、骑兵学院、茅草屋 |

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
| 军械库 | `Armory_LowerStoneVault` / `Armory_*Buttress*` / `Armory_Main*Door*` / `Armory_Upper*` | 单体加固石砌下层、铁箍扶壁、唯一重型双开门与附墙上层装卸门；保持完整2×2石基和连续双坡屋顶 | `build_armory()` |
| 军械库 | `Armory_ShieldRack_*` / `Armory_Shield_*` / `Armory_PolearmRack_*` / `Armory_Polearm_*` | 由建筑级 `armory_round_shield()` 与 `armory_wall_spear()` 组装的附墙盾牌及长柄武器陈列；所有子件独立可编辑，不得散落为院落道具 | `build_armory()` / `armory_round_shield()` / `armory_wall_spear()` |
| 军械库 | `Armory_Crest*` / `Armory_WallCrate*` / `Armory_DoorLantern` | 无文字盾剑徽记、紧贴正墙的军备箱与单灯；用于军事仓储识别，不生成塔楼、锻炉或独立棚屋 | `build_armory()` |
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
| 研究院 LV2 | `Research_*Buttress*` / `Research_*AcademicCornice*` / `Research_*RoofFinial*` | 沿用 LV1 三塔单体与 2×2 基座，增加更高塔身、附墙扶壁、双层檐口、门灯和黄铜尖顶 | `build_research_institute_lv2()` / `build_research_institute_level(..., 2)` |
| 研究院 LV3 | `Research_*ObservationGallery*` / `Research_Level3*` / `Research_*GiltPier*` | 终级高塔学府；在既有三塔上添加观测回廊、鎏金立柱、门廊、天文钟与翼顶饰件，不增加第四塔 | `build_research_institute_lv3()` / `build_research_institute_level(..., 3)` |
| 教堂 | `Church_MainHall` / `Church_MainRoof*` / `Church_Narthex*` | 紧凑2×2石砌礼拜堂、连续深蓝双坡屋顶与中央入口门厅；承重墙直接落地，不生成独立地基或铺装 | `build_church()` |
| 教堂 | `Church_BellTower_0` / `Church_Bell_0_*` / `Church_BelfryOpening_0_*` / `Church_Parapet*` | 仅保留画面左侧的一座相连平顶垛口钟塔，两可见钟室面内含独立铜钟几何；右侧必须维持完整礼拜堂屋顶，不生成第二塔、尖顶或塔基残留 | `build_church()` |
| 教堂 | `Church_*Window*` / `Church_RoseWindow*` / `Church_*Buttress*` | 蓝色与琥珀色组合的侧墙琉璃窗、入口玫瑰窗和附墙石扶壁；所有窗与结构细节保持建筑内嵌 | `build_church()` |
| 探险家营地 | `ExplorerCamp_CommandHall_*` / `ExplorerCamp_CommandCanvasRoof` | 石脚帆布指挥厅、加固木框、开启入口与暖光；作为单体前进基地的主体 | `build_explorer_camp()` |
| 探险家营地 | `ExplorerCamp_Lookout*` / `ExplorerCamp_Ladder*` / `ExplorerCamp_TowerConnector` | 与主厅相连的唯一木制瞭望塔、观察舱、方锥帆布顶、固定梯与连接段 | `build_explorer_camp()` |
| 探险家营地 | `ExplorerCamp_Supply*` / `ExplorerCamp_Map*` / `ExplorerCamp_Compass*` | 附着式补给雨棚、结构内储物柜、地图板与罗盘徽记；不得拆成独立帐篷或散落道具 | `build_explorer_camp()` |
| 矿工营地 | `MinerCamp_Shed_*` / `MinerCamp_Slate*` | 低矮石木矿棚、连续板岩双坡屋顶、木构外框与独立屋脊梁 | `build_miner_camp()` |
| 矿工营地 | `MinerCamp_Portal_*` | 暗色矿洞内口、暖光深处、双石柱、可编辑拱券石与门槛 | `build_miner_camp()` |
| 矿工营地 | `MinerCamp_Hoist_*` | 与主棚相连的四柱卷扬架、卷筒、绳索、导轨矿笼、矿石和共用斜棚顶；不得拆成独立建筑或矿车 | `build_miner_camp()` |
| 市场 | `Market_TradingHall` / `Market_BroadHippedRoof` / `Market_*Timber` | 单体石木交易厅、宽四坡屋顶和连续半木框架；主体保持封闭，不生成散摊或独立帐篷 | `build_market()` / `hipped_roof()` |
| 市场 | `Market_Counter*` / `Market_SideCounter*` / `Market_*Canopy*` | 四个正面摊位、两个侧面摊位及与主体重叠相连的 L 形条纹前檐；摊位不得拆成独立帐篷 | `build_market()` |
| 市场 | `Market_MainAdvertisement*` / `Market_Product*` / `Market_FixedScale*` | 大型钱币广告牌、四块商品图标吊牌与固定秤；仅使用无文字图标，所有招牌固定在交易厅或前檐 | `build_market()` |
| 面包屋 | `Bakery_MainDoor` / `Bakery_Display*` / `Bakery_ShopCanopy*` / `Bakery_BreadSign*` | 标准壳上的单入口烘焙铺、附墙浅檐、暖色橱窗、固定陈列柜与无文字面包徽记；面包均由建筑级 `bakery_loaf()` 保持独立可编辑 | `build_bakery()` / `bakery_loaf()` |
| 面包屋 | `Bakery_Oven*` / `Bakery_BroadOvenChimney` / `Bakery_FlourSack*` / `Bakery_WallFirewood*` | 侧墙内嵌拱形烤炉、单座粗大烤炉烟囱及全部贴墙的面粉袋/柴薪；不得拆成第二栋烤炉房或散落院落摊位 | `build_bakery()` / `portal_core()` / `portal_arch_ring()` |
| 传送门 | `Portal_LeftPier*` / `Portal_RightPier*` / `Portal_MarbleArch` | 两根方形大理石门柱、柱脚/柱头、内嵌面板与单一道半圆拱；保持简洁单门轮廓 | `build_portal()` / `portal_arch_ring()` |
| 传送门 | `Portal_CyanCore` / `Portal_BrassInnerInlay` / `Portal_Keystone` | 单片拱顶青蓝门芯、窄黄铜内嵌线、单块拱顶石与门槛；禁止扩展成多环祭坛群 | `build_portal()` / `portal_core()` |
| 位面谐振塔 | `PlanarResonator_*` | 完整2×2双层地基、中央机座、四座承重轴承柱、三道相互正交的完整黄铜陀螺环和单一悬浮蓝紫晶核；环与晶核保持独立可编辑 | `build_planar_resonator()` / `resonator_torus_ring()` |
| 丛林神庙 | `JungleTemple_*Terrace` / `JungleTemple_CentralStep_*` / `JungleTemple_Sanctuary*` | 完整方形地基、三层居中退台、唯一中央宽阶与后部封闭圣殿；保持单体功能建筑，不拆成遗迹群 | `build_jungle_temple()` |
| 丛林神庙 | `JungleTemple_UpperLevel_*` / `JungleTemple_*Tower*` | 圣殿上方三层逐级收分的中央楼层，以及左右完全镜像并与主体相连的双塔台；塔台含塔身、平台、四角柱和石顶盖 | `build_jungle_temple()` |
| 丛林神庙 | `JungleTemple_Crown*` / `JungleTemple_RoofComb` / `JungleTemple_SunMedallion*` / `JungleTemple_Vine*` | 顶层阶梯冠部、单一太阳徽记、左右镜像附墙苔藓藤蔓与唯一暗门；植被只能作为附着细节 | `build_jungle_temple()` |
| 雪原城堡 | `SnowCastle_Foundation*` / `SnowCastle_Terrace_*` / `SnowCastle_*CentralFlight*` | 完整矩形石垣地基、三层逐级收分的平台和同轴多段中央宽阶；积雪是独立屋面/边缘组件，不替代承重几何 | `build_snow_castle()` / `snow_castle_stair_flight()` |
| 雪原城堡 | `SnowCastle_KeepLevel_*` / `SnowCastle_*Roof*` / `SnowCastle_Crown*` | 四层逐级收分的日式天守、宽深色四坡檐、独立覆雪面与克制的成对屋脊顶饰；不得改成寺庙、佛塔或散塔群 | `build_snow_castle()` / `japanese_castle_roof()` / `snow_castle_wall_details()` |
| 雪原城堡 | `SnowCastle_*Yagura*` / `SnowCastle_Gatehouse*` | 左右镜像的两层橹塔通过覆顶回廊接入中央天守，前门楼与三段宽阶同轴；所有塔楼必须属于同一城郭地基 | `build_snow_castle()` |
| 沙漠官邸 | `DesertMansion_*Hall*` / `DesertMansion_*StepDeck` / `DesertMansion_*Wing*` / `DesertMansion_*Dome*` | 单体砂岩官邸、三层居中逐级收分主体、中央大洋葱穹顶与左右各一座相连翼楼小穹顶；穹顶由建筑级 `desert_mansion_dome()` 保持可编辑旋转体 | `build_desert_mansion()` / `desert_mansion_dome()` |
| 沙漠官邸 | `DesertMansion_*TorchTower*` / `DesertMansion_Entry*` / `DesertMansion_*FacadeRelief` | 左右完全镜像、位于前侧翼楼肩部且与翼楼相连的双火炬状塔楼，唯一中央拱门、成对窄窗与附墙几何浮雕；三层主体、翼楼与塔可由 manifest `bodyOffset` 相对固定地基平移，但 `Foundation` 与居中的 `UpperPlinth` 不移动，所有结构必须落在地基边界内；禁止拆成独立塔群或宗教建筑群 | `build_desert_mansion()` |
| 三级房屋共用母体 | `House_MainBody` / `House_LowerStone` / `House_MainGabledRoof` / `House_*UpperTimber` | 同一紧凑2×2两层石基半木住宅、连续双坡瓦顶、烟囱、门窗和角柱；三级升级保持承重体、屋顶占地与高度家族一致 | `build_house_level()` |
| 二级房屋增量 | `House_DoorCanopy*` / `House_Level2Balcony*` / `House_*FlowerBox*` / `House_Supply*` | 在共用母体上增加附墙门廊、小型木阳台、花箱和贴墙生活物资；不得生成独立院落或附属房 | `build_house_level(level=2)` |
| 三级房屋增量 | `House_Level3OrnateBalcony*` / `House_Gilt*` / `House_FamilyCrest*` / `House_RidgeFinial*` | 在同一母体上增加雕花铜饰阳台、克制镀金木构、家徽、彩窗花饰和小型屋脊顶饰；不增加第三层、塔楼或第二屋顶 | `build_house_level(level=3)` |
| 茅草屋 | `Cottage_*` | 厚草顶标准壳、门窗、烟囱、灯笼的住宅组合 | `build_thatch_hut()` |
| 麦田风车 | `Mill_*` / `Sail_*` | 细高石基、木构上层、紧凑机房屋顶和四叶片 | `build_windmill()` / `add_windmill_sails()` |
| 主神空间仓库 | `MainWarehouse_*` | 单格白石库房、半圆拱顶、金属跨拱肋、蓝晶双门与宝石封印；继承旧宝箱的白/金/蓝识别但不保留宝箱形体 | `build_main_space_warehouse()` / `barrel_vault()` |

## 建筑与组件使用矩阵

| 建筑 | 主体结构 | 功能组件 |
|---|---|---|
| 麦田风车 | 细高石基 + 木构上层 + 双坡顶 | 四叶片、谷仓门、前/侧窗 |
| 仓库 | 四层标准壳 | 二层前阳台、四层侧阳台、箱桶、袋、吊梁 |
| 主神空间仓库 | 单层白石库房 + 半圆拱顶 | 蓝晶双门、金色拱肋、宝石封印与侧窗；运行时为1×1建筑 |
| 铁匠铺 | 低矮标准壳 | 左开门、内部工具/炉火、工作台、铁砧、烟囱 |
| 靶场 | 后部小屋 + 一格围栏院落 | 前围栏靶子、檐下枪架、弓枪和火药袋 |
| 骑兵学院 | 马厩标准壳 + 单训练塔 | 双马厩门、阁楼窗、徽记、双灯笼 |
| 仓鼠军营 | 中央石砌操练厅 + 对称双瞭望塔 | 强化双开门、箭窗、附墙长矛架、盾徽与门灯 |
| 研究院 | 石砌主厅 + 中央高塔 + 双侧低塔 | 图书室暖窗、双翼蓝灰坡顶、附墙星盘标识 |
| 教堂 | 紧凑石砌礼拜堂 + 左侧平顶垛口钟塔 + 连续深蓝坡顶 | 双面可见铜钟、中央拱门、玫瑰窗、蓝橙侧墙琉璃窗与附墙扶壁 |
| 探险家营地 | 帆布指挥厅 + 单座相连瞭望塔 | 固定梯、补给雨棚、地图板、罗盘徽记与暖灯 |
| 矿工营地 | 石木矿棚 + 一体式矿洞入口 | 拱券石、暖灯、附着卷扬架、卷筒、绳索与导轨矿笼 |
| 市场 | 石木交易厅 + 宽四坡顶 | 四正两侧固定摊位、相连 L 形条纹前檐、大型钱币广告牌、商品吊牌、固定秤与双灯 |
| 面包屋 | 完整石基地基 + 两层半木烘焙铺 + 连续双坡瓦顶 | 附墙烤炉口、单座粗大烟囱、暖橱窗、固定面包陈列、无文字面包徽记、贴墙面粉袋与柴薪 |
| 传送门 | 浅阶大理石地台 + 双方柱单圆拱 | 青蓝单门芯、窄黄铜内嵌线、单块拱顶石与门槛 |
| 位面谐振塔 | 完整2×2双层石质地台 + 中央金属机座 + 四座轴承柱 | 三道黄铜陀螺环、十字导能槽、蓝紫发光轴承与单一悬浮晶核 |
| 丛林神庙 | 完整方形地基 + 三层退台 + 后部封闭圣殿 + 三层收分上楼 | 单中央宽阶、唯一暗门、左右对称双塔台、顶层冠部、太阳徽记与镜像附墙藤蔓 |
| 雪原城堡 | 完整矩形石垣 + 三层阶梯平台 + 四层日式天守 | 同轴三段宽阶、唯一前门楼、左右相连双橹塔、深色多重飞檐、独立覆雪面与暖窗 |
| 沙漠官邸 | 完整矩形地基 + 三层阶梯式中央砂岩主厅 + 左右相连翼楼 | 一座中央大洋葱穹顶、两座翼楼小穹顶、两座镜像火炬状塔楼、唯一中央拱门、三级入口台阶与逐层成对窄窗 |
| 一级房屋 | 两层石基半木住宅 + 连续双坡瓦顶 | 木门、双暖窗、烟囱与双灯笼 |
| 二级房屋 | 与一级相同的两层母体 | 附墙门廊、小阳台、花箱、木桶与小货箱 |
| 三级房屋 | 与一二级相同的两层母体 | 雕花铜饰阳台、家徽、镀金木构、更多花饰、屋脊顶饰与华丽灯具 |
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
