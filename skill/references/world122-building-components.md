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
| `barrel_vault(length, width, height, location, end_mat, roof_mat, segments)` | 沿局部 X 延伸的封闭半椭圆拱顶，端面与曲面分材质；可缩短为跨拱金属肋 | 主神空间仓库宝箱、地牢宝箱闭合/开启模型；后续小礼拜堂、拱顶库房可复用 |
| `roof_rows(length, width, roof_height, base_z, mat, rows)` | 双坡屋顶两侧的重叠瓦行/草层；`rows` 控制层数 | 同上；茅草屋使用较少行数形成厚草顶 |
| `half_timber_facade(width, height, y, base_z, timber, bays, include_braces)` | 正立面上下梁、立柱和交替斜撑 | 标准壳、风车上层、靶场屋、骑兵塔 |
| `half_timber_side(depth, height, x, base_z, timber, bays)` | 侧立面梁柱和斜撑 | 标准壳、风车上层 |
| `shutter_window(location, glass, timber, iron, orientation, scale)` | 窗框、玻璃、竖横棂与前向双百叶；支持 front/side | 风车、仓库、靶场、骑兵学院、茅草屋 |
| `framed_glass_panel(location, width, height, glass, frame_mat, trim_mat, orientation, vertical_divisions, horizontal_divisions, horizontal_bias, ornaments, depth)` | 参数化大幅商业/办公玻璃窗；支持正面/侧面、纵横分格、偏置横梃与可选装饰铆花，所有玻璃、边框与梃件独立可编辑 | 大商场、证券交易所 |
| `solar_panel_array(location, rows, columns, panel_size, panel_mat, frame_mat, row_gap, column_gap, tilt_degrees, support_height, support_mat)` | 参数化光伏板阵列；按行列生成独立光伏模块、四边框、十字电池分隔线和四脚支架，正倾角统一令本地负Y侧降低；适用于地面阵列与屋顶阵列 | 六级房屋、光伏电站 |
| `stacked_bearing_shells(name, floor_sizes, shell_mats, base_z, band_mat, band_height, bevel_width)` | 按自下而上尺寸序列生成独立命名且彼此连接的真实楼层承重壳，可选附着正面/侧面楼板带；返回每层 facade 锚点 | 五至七级房屋；后续多层住宅母体 |
| `double_doors(location, width, height, timber, iron, open_angle)` | 双门扇、铁带、铰链、门环；`open_angle=0` 关闭，非零打开 | 风车、仓库、靶场、骑兵学院、茅草屋 |
| `hipped_roof(length, width, height, location, mat)` | 四坡屋顶，自建 mesh；当前作为 `standard_shell(roof_kind='hipped')` 可选项 | 已注册，当前建筑包尚未正式使用 |
| `cone(radius, height, location, mat, vertices)` | 圆锥/低边数尖顶；`vertices=4` 可做方锥塔顶 | 骑兵学院训练塔 |
| `torus_ring(major_radius, minor_radius, location, mat, rotation, major_segments, minor_segments, smooth)` | 完整可编辑圆环；支持三轴旋转与分段数控制，统一用于相位稳定环、陀螺谐振环等附着式能源硬件 | 位面谐振塔、仓库 LV5 |
| `rough_boulder(size, location, mat, rotation, subdivisions)` | 独立可编辑低多边形自然岩块；尺寸、旋转与细分可控，适合重叠成矿堆或自然地基 | 裸露能量矿脉、矿洞 |
| `faceted_crystal_prism(height, radius, location, mat, highlight_mat, lean, sides, depth_scale, rotation_z)` | 带肩部与尖顶的多棱晶柱；支持水平倾斜、横截面纵深和交替高光分面，根部保持可嵌入结构 | 位面谐振塔；旧能量晶簇模型仅作历史源，不再用于运行时矿脉 |
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
| `post_and_rail_enclosure(width, front_y, back_y, base_z, gate_width, rail_offsets, post_height, post_spacing, include_back, gate_leaves, gate_open_angle)` | 参数化木桩横栏围界；支持居中门洞、可选双扇开启门、后围栏开关及栏杆/立柱密度 | 靶场、奶酪农场 |
| `wind_rotor(name, hub_location, axis, blade_count, inner_radius, outer_radius, root_width, tip_width, thickness, style, lattice_slats)` | 参数化水平轴风轮；`axis=X/Y`控制轴向，`style=lattice`生成格栅风帆，`style=turbine`生成带独立加强脊的渐缩叶片；轮毂、叶片与脊保持独立可编辑，并统一挂到轮毂中心的 `*_Pivot` 空对象，旋转 Pivot 的局部轴即可驱动整套叶轮 | 麦田风车、风力电站 |
| `_build_treasure_chest(asset_id, spec, open_lid, dungeon_style)` | 共用四脚、箱体、拱盖、铰链与开盖父级；通过 manifest 尺寸/材质及主题装饰生成主神仓库与地牢闭合/开启两态，子件保持独立可编辑 | 主神空间仓库宝箱、地牢宝箱房宝箱 |

`wind_rotor` 位于 `building-component-kit.py`；麦田风车保留四叶格栅形态，风力电站使用三叶渐缩形态，禁止复制两套风轮坐标。运行时或 Blender 动画只旋转返回的 `*_Pivot`（风力电站为局部 Y 轴），不得逐片叶片改角度。

## 建筑级组合件（已命名但尚未提升为公共函数）

这些组合件可以从生成的 `.blend` 中直接拆取。出现第二个调用者时，先参数化提升，不复制粘贴。

| 建筑 | 对象前缀/组合件 | 组成与复用方向 | 记录位置 |
|---|---|---|---|
| 仓库 | `Warehouse_SecondFloor_*` | 二层正面装卸平台、立柱、双层栏杆、阁楼门 | `build_warehouse()` |
| 仓库 | `Warehouse_FourthFloor_*` | 与二层垂直方向不同的四层侧阳台、侧门、栏杆 | `build_warehouse()` |
| 仓库 | `Warehouse_Platform_Crate_*` / `Barrel_*` / `BundledSacks` | 箱子铁/木带、桶箍、袋装物资；适合提炼为 clutter kit | `build_warehouse()` |
| 仓库 | `Warehouse_Hoist_*` | 吊梁与滑轮 | `build_warehouse()` |
| 仓库 LV2 | `WarehouseLV2_*Buttress*` / `*ReinforcementBand` | 在同一四层仓库壳体上增加前/侧石扶壁与低层铁箍；只表达结构加固，不增加第五层、塔楼或机械设施 | `build_warehouse_lv2()` / `build_warehouse_level(level=2)` |
| 仓库 LV2 | `WarehouseLV2_SecondLoadingDoor` / `GroundLoadingDock` / `DockCrate*` / `OrderedSackStack` | 第二装卸门、附着式石装卸台和规整货物堆栈；全部保持在原2×2地基边界内，LV3机械货梯仍未加入 | `build_warehouse_lv2()` / `build_warehouse_level(level=2)` |
| 仓库 LV3 | `WarehouseLV3_CargoLift_*` | 贴合右侧外墙并对接四层侧装卸阳台的双导轨货梯、升降货台、护栏、顶梁、滑轮与钢索；全部落在原2×2地基内，不形成第二栋建筑 | `build_warehouse_lv3()` / `build_warehouse_level(level=3)` |
| 仓库 LV3 | `WarehouseLV3_PoweredWinch_*` | 与外墙、货梯共用接地点的动力绞盘、大小传动齿轮、封闭动力鼓、传动轴及开放式防护架；不使用独立锅炉房、烟囱、输送带或自动分拣设备 | `build_warehouse_lv3()` / `build_warehouse_level(level=3)` |
| 仓库 LV4 | `WarehouseLV4_AutomatedConveyor_*` / `WarehouseLV4_EnclosedSorter_*` | 从既有LV3货笼向同侧墙封闭分拣机输送的短距滚筒桥，以及带观察窗、分度鼓、维护面板和状态灯的单套附墙分拣机；不增加楼层、附楼、第二屋顶或第二货梯 | `build_warehouse_lv4()` / `build_warehouse_level(level=4)` |
| 仓库 LV4 | `WarehouseLV4_AutoRouting_*` | 从封闭分拣机向下分出的单一歧管、双路封闭落料管和两只落地接收箱；全部固定在同一可见侧墙与原2×2地基内，不生成外置机器人、车辆或散落输送线 | `build_warehouse_lv4()` / `build_warehouse_level(level=4)` |
| 仓库 LV5 | `WarehouseLV5_PhaseVault_*` / `WarehouseLV5_PhaseCore_*` | 在既有LV4双路落料区外包覆一套附墙相位库舱，内嵌单个多棱相位核心、单个完整稳定环、四个夹具及直连原分拣机的短耦合器；不增加第五层、附楼、第二屋顶或传送门洞 | `build_warehouse_lv5()` / `build_warehouse_level(level=5)` / `torus_ring()` / `faceted_crystal_prism()` |
| 仓库 LV5 | `WarehouseLV5_ReserveCanister_*` / `WarehouseLV5_ReserveConduit*` | 相位库舱两侧各一只封闭储备缓冲罐，以短竖管和单一横向馈线接入稳定环；全部贴合原可见侧墙并留在2×2地基内，不生成独立罐组、漂浮件或长管网 | `build_warehouse_lv5()` / `build_warehouse_level(level=5)` |
| 铁匠铺 | `Forge_Left_Door_*` / `Forge_Left_Interior` | 左侧打开门、门框和可见室内暗面 | `build_blacksmith()` |
| 铁匠铺 | `Forge_Interior_*` / `Forge_Opening_*` | 工具架、余烬、炉口框和炉光 | `build_blacksmith()` |
| 军械库 | `Armory_LowerStoneVault` / `Armory_*Buttress*` / `Armory_Main*Door*` / `Armory_Upper*` | 单体加固石砌下层、铁箍扶壁、唯一重型双开门与附墙上层装卸门；保持完整2×2石基和连续双坡屋顶 | `build_armory()` |
| 军械库 | `Armory_ShieldRack_*` / `Armory_Shield_*` / `Armory_PolearmRack_*` / `Armory_Polearm_*` | 由建筑级 `armory_round_shield()` 与 `armory_wall_spear()` 组装的附墙盾牌及长柄武器陈列；所有子件独立可编辑，不得散落为院落道具 | `build_armory()` / `armory_round_shield()` / `armory_wall_spear()` |
| 军械库 | `Armory_Crest*` / `Armory_WallCrate*` / `Armory_DoorLantern` | 无文字盾剑徽记、紧贴正墙的军备箱与单灯；用于军事仓储识别，不生成塔楼、锻炉或独立棚屋 | `build_armory()` |
| 靶场 | `Range_Yard_*` | 一格院落的侧/前栏杆、门洞和立柱；已改由公共 `post_and_rail_enclosure()` 装配 | `build_shooting_range()` / `building-component-kit.py` |
| 靶场 | `Range_Target_*` | 靠近前围栏的靶柱、底脚、草靶与铁心 | `build_shooting_range()` |
| 靶场 | `Range_Armory_Rack_*` / `Visible_Bow_*` / `Visible_Gun*` / `Powder*` | 檐下实体枪架、弓枪、火药架和袋；屋顶必须为空 | `build_shooting_range()` |
| 靶场 LV2 | `ShootingRangeLV2_Armory_*` / `SingleRoof_*` / `FiringPost_*` / `*Boundary*` | 2×2 中世纪石木靶场母体：后置军械厅与前部射击位共用唯一一座前后贯通双坡屋顶，四柱只承托同一主屋顶；低矮城垛边墙和居中入口不遮挡三座前置草靶，所有构件留在原地基内 | `build_shooting_range_lv2()` |
| 靶场 LV2 | `ShootingRangeLV2_Target_*` / `WeaponRack_*` / `Longbow_*` / `Matchlock_*` / `*AmmoCrate*` / `*PowderKeg*` / `*Arrow*` | 三座带中圈的圆形草靶、附墙长弓/火绳枪混合枪架，以及左右各一组成组弹药箱、火药桶、箭筒和箭束；补给细节沿院墙有序布置，不堵靶线、射击台或中央入口 | `build_shooting_range_lv2()` / `range_straw_target()` |
| 靶场 LV3 | `ShootingRangeLV3_ControlBuilding_*` / `SingleRoof_*` / `CanopyPost_*` / `LaneDivider_*` / `*Backstop*` | 2×2 现代军用靶场：控制室与四柱射击位共用唯一一块前后贯通平屋顶，屋面含连续檐口、双侧排水槽和落水管；三条混凝土射击巷与相连挡弹墙保持独立可读，禁止第二屋顶、第二建筑、塔楼、车辆或扩大占地 | `build_shooting_range_lv3()` |
| 靶场 LV3 | `ShootingRangeLV3_Target_*` / `TargetCarrier_*` / `AmmoLocker_*` / `*AmmoCrate*` / `AmmoCan_*` / `SpentCaseBin_*` / `SafetyPanel*` | 三座钢制升降人形靶、共用目标载轨、附墙弹药柜、左右四组共八只金属弹药箱、四只弹药罐和三只弹壳回收箱；所有补给与训练细节沿设施外围有序布置并避开三条实弹射击巷 | `build_shooting_range_lv3()` / `range_steel_silhouette()` |
| 骑兵学院 | `Cavalry_Training_Tower*` / `Cavalry_Tower_Timber` | 单座训练塔、木构立面和方锥顶 | `build_cavalry_school()` |
| 骑兵学院 | `Stable_Door_*` / `Stable_Loft_Window` / `Cavalry_Crest` | 马厩门组、阁楼窗和马蹄徽记 | `build_cavalry_school()` |
| 仓鼠军营 | `Barracks_MainHall_*` / `Barracks_MainGate_*` | 中央石砌操练厅、连续双坡屋顶、强化门框、双开军营门和暖光入口 | `build_hamster_barracks()` |
| 仓鼠军营 | `Barracks_LeftWatchtower_*` / `Barracks_RightWatchtower_*` | 两座完整对称石砌瞭望塔、强化石带、箭窗、方锥顶与独立顶饰 | `build_hamster_barracks()` |
| 仓鼠军营 | `Barracks_WeaponRack_*` / `Barracks_ShieldCrest` / `Barracks_GateLantern_*` | 附墙长矛架、盾徽与门灯；维持克制的军事识别，不生成独立院落 | `build_hamster_barracks()` |
| 仓鼠军营 LV2 | `BarracksLV2_RomanHall_*` / `Roman*Tower_*` | 独立的紧凑罗马军团营母体：唯一低矮石灰石/灰泥营房、完整石质平屋顶与克制的侧/后低女儿墙，以及左右各一座相连平顶方塔；废弃此前二级坡顶/尖顶塔语法，不增加第三塔、第二营房或占地 | `build_hamster_barracks_lv2()` |
| 仓鼠军营 LV2 | `BarracksLV2_RomanCurtain_*` / `RomanGatehouse_*` | 与双塔和营房相交的单段前幕墙、唯一中央拱门楼、暗门洞及塔/幕墙/门楼成组宽城垛；保持完整2×2地基与清晰中央入口 | `build_hamster_barracks_lv2()` / `portal_core()` / `portal_arch_ring()` |
| 仓鼠军营 LV2 | `*LegionStandard_*` / `*CrimsonScutum*` | 两座塔各固定一面深红罗马军团旗和一面深红罗马盾，统一使用暗红布、氧化黄铜、黑铁与风化石材；旗、横杆、饰边、矛尖及盾件全部独立可编辑，禁止额外旗帜、文字或散落武器 | `build_hamster_barracks_lv2()` |
| 仓鼠军营 LV3 | `BarracksLV3_InfantryTent_*` / `*Sandbag*` | 一顶略收小的完整现代军用双坡帐篷作为唯一主体，含敞开系束门帘、两扇卷帘窗、脊带、入口框和两组低矮沙袋；不继承LV2石厅、红瓦、双塔或垛口 | `build_hamster_barracks_lv3()` |
| 仓鼠军营 LV3 | `BarracksLV3_Watchtower_*` / `TentTowerConnectorLanding` | 一座四柱开放式钢制瞭望塔，含交叉撑、观测台、栏杆、固定梯和小型帆布顶，并以短落地连接台贴合帐篷侧；不增加第二塔、围栏、铁丝网、雷达或车辆 | `build_hamster_barracks_lv3()` |
| 仓鼠军营 LV3 | `BarracksLV3_LeftAmmoStack_*` / `RightSupply*` / `TowerService_*` | 缩小帐篷后释放的营地空间固定为三组有序道具：左侧三只弹药箱叠放、右侧两只补给箱加两只油水桶、塔侧一台野战电台加一只线缆盘；不得堵门、挡梯或随机散落额外箱桶 | `build_hamster_barracks_lv3()` |
| 研究院 LV1 | `ResearchLV1_CentralTower_*` | 唯一中央方塔；白色塔身、冷灰角扶壁、双层蓝色尖券窗、方锥蓝顶和克制顶饰，禁止增生侧塔、角塔或穹顶 | `build_research_institute()` / `research_pyramid_roof()` / `research_pointed_window()` |
| 研究院 LV1 | `ResearchLV1_NorthWing_*` / `SouthWing_*` / `EastWing_*` / `WestWing_*` | 从中央塔向四面伸出的四座相连低矮裙楼；白墙、灰石裙与蓝色双坡顶共享同一方形 2×2 地基 | `build_research_institute()` / `gabled_prism()` |
| 研究院 LV1 | `ResearchLV1_DiamondColumn_*` / `ResearchLV1_FlyingButtress_*` | 四根旋转45度的低矮菱形截面围柱，位于四翼之间并以双层飞扶壁接入中央塔；柱顶保持平阶，不得读成额外塔楼 | `build_research_institute()` / `research_diamond_column()` / `research_diagonal_beam()` |
| 研究院 LV2 | `ResearchLV2_CentralTower_*` | 继承 LV1 唯一中央方塔并明显增高；双层塔身尖券窗、三道冷灰分层石带、相连学术回廊栏带、加强角扶壁、蓝顶肋与更高顶饰构成二级增量 | `build_research_institute_lv2()` / `build_research_institute_level(level=2)` |
| 研究院 LV2 | `ResearchLV2_*Wing_*` / `ResearchLV2_DiamondColumn_*` / `ResearchLV2_FlyingButtress_*` | 四面裙楼、四根平顶菱形围柱、围柱位置和双层飞扶壁高度沿用 LV1；仅裙楼追加贴合墙顶的学术檐口，不增加塔楼或占地 | `build_research_institute_level(level=2)` |
| 研究院 LV3 | `ResearchLV3_CentralTower_*` | 在 LV2 上继续增高唯一中央方塔；三层塔身尖券窗、四道冷灰分层石带、放大相连回廊与冠部、密集角柱、强化蓝顶肋和最高顶饰构成三级增量 | `build_research_institute_lv3()` / `build_research_institute_level(level=3)` |
| 研究院 LV3 | `ResearchLV3_*Wing_*` / `ResearchLV3_DiamondColumn_*` / `ResearchLV3_FlyingButtress_*` | 保持 LV1/LV2 的固定四翼母体、方形 2×2 地基、四根平顶菱形围柱和低位飞扶壁；高等级变化集中于中央塔纵向层次 | `build_research_institute_level(level=3)` |
| 教堂 | `Church_Foundation` / `Church_MainHall` / `Church_MainRoof*` / `Church_Narthex*` | 完整2×2毛石视觉地台上的紧凑石砌礼拜堂、连续深蓝双坡主顶与中央入口门厅；视觉地台不得改变逻辑占格、碰撞或寻路 | `build_church()` |
| 教堂 | `Church_SideChapel_Left*` / `Church_SideChapel_Right*` | 主厅左右各一座等尺寸、等高度、等屋顶的相连附属礼拜翼；所有体块、扶壁和窗必须严格成对镜像，不生成钟塔、尖塔、塔楼、穹顶、屋顶灯塔或不对称附楼 | `build_church()` |
| 教堂 | `Church_FrontLancet_*` / `Church_SideLancet_*` / `Church_RoseWindow*` / `Church_*Buttress*` | 蓝色与琥珀色组合的成对琉璃窗、居中入口玫瑰窗和镜像附墙石扶壁；所有窗与结构细节保持建筑内嵌 | `build_church()` |
| 探险家营地 | `ExplorerCamp_CommandHall_*` / `ExplorerCamp_CartographyCupola*` / `ExplorerCamp_ArchiveWing_*` | 完整4×4地基上的大型帆布石木指挥厅、屋脊制图阁楼与相连地图档案翼；三部分保持连续承重关系，禁止拆成帐篷群 | `build_explorer_camp()` |
| 探险家营地 | `ExplorerCamp_Lookout*` / `ExplorerCamp_Signal*` / `ExplorerCamp_TowerConnector` | 与主厅相连的高位瞭望塔、四面栏台、信号桅杆、观察舱、固定梯与连接廊 | `build_explorer_camp()` |
| 探险家营地 | `ExplorerCamp_Supply*` / `ExplorerCamp_ExpeditionGate*` / `ExplorerCamp_Map*` / `ExplorerCamp_Compass*` | 连体补给廊、双柱远征门、无文字罗盘徽记、地图板与结构内储物柜；不得拆成独立帐篷或散落道具 | `build_explorer_camp()` |
| 矿工营地 | `MinerCamp_Shed_*` / `MinerCamp_Slate*` | 低矮石木矿棚、连续板岩双坡屋顶、木构外框与独立屋脊梁 | `build_miner_camp()` |
| 矿工营地 | `MinerCamp_Portal_*` | 暗色矿洞内口、暖光深处、双石柱、可编辑拱券石与门槛 | `build_miner_camp()` |
| 矿工营地 | `MinerCamp_Hoist_*` | 与主棚相连的四柱卷扬架、卷筒、绳索、导轨矿笼、矿石和共用斜棚顶；不得拆成独立建筑或矿车 | `build_miner_camp()` |
| 矿洞 | `MineCave_*` | 单格岩质洞口、内嵌绿光、拱券石、木支护、轨道与贴地碎石；复用公共 `rough_boulder`，所有结构保持独立可编辑 | `build_mine_cave()` / `portal_core()` / `portal_arch_ring()` |
| 裸露能量矿脉三形态 | `EnergyVein_Footprint_RubbleBed` / `EnergyVein_Rubble_*` / `EnergyVein_Block_*` | 极薄自然碎石底层保留标准1×1方形世界边，投影后正面底边约26.565°；横向裂隙、环状矿窝、Y形分叉三套布局只使用宽扁且部分埋地的能量块，禁止直立晶柱 | `energy_vein_footprint_bed()` / `build_energy_vein()` / `rough_boulder()` |
| 市场 | `Market_TradingHall` / `Market_BroadHippedRoof` / `Market_*Timber` | 单体石木交易厅、宽四坡屋顶和连续半木框架；主体保持封闭，不生成散摊或独立帐篷 | `build_market()` / `hipped_roof()` |
| 市场 | `Market_Counter*` / `Market_SideCounter*` / `Market_*Canopy*` | 四个正面摊位、两个侧面摊位及与主体重叠相连的 L 形条纹前檐；摊位不得拆成独立帐篷 | `build_market()` |
| 市场 | `Market_MainAdvertisement*` / `Market_Product*` / `Market_FixedScale*` | 大型钱币广告牌、四块商品图标吊牌与固定秤；仅使用无文字图标，所有招牌固定在交易厅或前檐 | `build_market()` |
| 皇家铸币局 | `RoyalMint_LowerVault` / `RoyalMint_UpperTreasury*` / `RoyalMint_MainHippedRoof` / `RoyalMint_FiscalTower*` | 单体加固石砌金库、半木财政厅、连续四坡主顶与仅一座贯通屋肩的财政塔；保持完整2×2地基和官方经济建筑轮廓 | `build_royal_mint()` / `hipped_roof()` / `research_pyramid_roof()` |
| 皇家铸币局 | `RoyalMint_MainVaultDoor*` / `RoyalMint_CoinSeal*` / `RoyalMint_Press*` / `RoyalMint_FurnaceChimney*` | 唯一重型金库门、无文字王冠钱币徽记、附墙冲压机/飞轮/币模台和单座低矮能源熔炉烟囱；机械不得拆成独立工坊或散落道具 | `build_royal_mint()` / `double_doors()` / `gear()` / `chimney()` |
| 面包屋 | `Bakery_MainDoor` / `Bakery_Display*` / `Bakery_ShopCanopy*` / `Bakery_BreadSign*` | 标准壳上的单入口烘焙铺、附墙浅檐、暖色橱窗、固定陈列柜与无文字面包徽记；面包均由建筑级 `bakery_loaf()` 保持独立可编辑 | `build_bakery()` / `bakery_loaf()` |
| 面包屋 | `Bakery_Oven*` / `Bakery_BroadOvenChimney` / `Bakery_FlourSack*` / `Bakery_WallFirewood*` | 侧墙内嵌拱形烤炉、单座粗大烤炉烟囱及全部贴墙的面粉袋/柴薪；不得拆成第二栋烤炉房或散落院落摊位 | `build_bakery()` / `portal_core()` / `portal_arch_ring()` |
| 蒸汽电站 | `SteamPlant_HorizontalBoiler_*` / `SteamPlant_BoilerBand_*` / `SteamPlant_FurnaceDoor_*` / `SteamPlant_MainSteamPipe_*` | 与主厂房侧墙重叠的一体式卧式锅炉、黄铜箍带、炉门和蒸汽主管；所有机械保持独立可编辑，不得拆成第二栋锅炉房 | `build_steam_power_plant()` / `cylinder()` |
| 蒸汽电站 | `SteamPlant_BoilerWorkerStation_*` / `SteamPlant_TurbineFlywheel*` / `SteamPlant_PressureGauge_*` / `SteamPlant_EnergyBuffer_*` | 两个固定燃料投入口对应初始两名锅炉工，并配套侧挂飞轮、压力表与附墙能源缓冲罐；无文字标牌、不生成独立仓库 | `build_steam_power_plant()` / `gear()` |
| 风力电站 | `WindPowerPlant_GeneratorHall_*` / `WindPowerPlant_Tower_*` / `WindPowerPlant_Nacelle_*` / `WindPowerPlant_MainRotor_*` | 完整4×4石基上的单体发电机房、贯穿机房的加固传动塔、四脚开放铁塔、唯一机舱与三叶渐缩主风轮；塔架和机房保持承重连接，禁止第二风轮、独立风机或现代白色玻璃钢叶片 | `build_wind_power_plant()` / `wind_rotor()` / `research_diagonal_beam()` |
| 风力电站 | `WindPowerPlant_GeneratorFlywheel*` / `WindPowerPlant_TransferShaft_*` / `WindPowerPlant_EnergyBuffer_*` / `WindPowerPlant_EnergyConduit_*` | 附墙大型发电飞轮、贯通塔架的传动轴、左右两座固定青蓝能源缓冲器与连接导管；全部固定在同一地基和机房，禁止散落机械、第二厂房或风车磨坊语义 | `build_wind_power_plant()` / `gear()` / `cylinder()` |
| 光伏电站 | `SolarPowerPlant_FrontGroundArray_*` / `SolarPowerPlant_RearLeftGroundArray_*` / `SolarPowerPlant_OfficeRoofArray_*` | 完整4×4基座上的前场3×6阵列、办公楼左侧后场3×3阵列与楼顶2×2补充阵列；两组地面阵列共用同一套全局6×6格心、横纵间距、尺寸和倾角，由办公楼占据后场右侧格位，其他可用格全部铺板；每块光伏板、边框、电池分隔线和支架独立可编辑，禁止错列、散乱或留出无功能大片空地 | `build_solar_power_plant()` / `solar_panel_array()` |
| 光伏电站 | `SolarPowerPlant_OfficeFloor*` / `SolarPowerPlant_OfficeLobby_*` / `SolarPowerPlant_OfficeFlatRoof*` / `SolarPowerPlant_OfficeRoofParapet_*` | 基座后侧一栋严格两层、上下外墙垂直对齐的现代控制办公楼；宽玻璃入口、两层办公窗、平顶女儿墙和无文字太阳徽记均固定在主体上，禁止第三层、独立附楼、塔楼或通信天线 | `build_solar_power_plant()` / `framed_glass_panel()` / `box()` / `cylinder()` |
| 光伏电站 | `SolarPowerPlant_InverterCabinet_*` / `SolarPowerPlant_InverterFace_*` / `SolarPowerPlant_InverterStatus_*` / `SolarPowerPlant_InverterConduit_*` | 两组附着在办公楼可见侧墙的逆变储能柜、状态面与导管；设备保持固定连接，不生成独立变电站、冷却塔、烟囱或散落机械 | `build_solar_power_plant()` / `box()` / `cylinder()` |
| 算力重心 | `ComputingCenter_CoreFloor*` / `ComputingCenter_OperationsLobby_*` / `ComputingCenter_ServerWing_*Floor*` / `ComputingCenter_*FlatRoof*` | 完整4×4基座上的中央四层运维核心与左右各一栋相连两层服务器翼楼；四组中央承重壳、两组对称翼楼承重壳、宽玻璃门厅、平顶及连续女儿墙全部独立命名，禁止第五层、塔楼、天线、卫星锅或独立附楼 | `build_computing_center()` / `framed_glass_panel()` / `box()` |
| 算力重心 | `ComputingCenter_*CoolingBank_*` / `ComputingCenter_*CoolantTank_*` / `ComputingCenter_CoolingTrunk_*` / `ComputingCenter_ProcessorEmblem_*` | 左右屋顶各一组含三片散热匣的固定液冷银行、左右外墙各一只带墙架缓冲罐、接入中央低矮歧管的成对冷却主管，以及附墙六边形九节点处理器徽记；所有设备保持与承重壳重叠连接，不生成散落机柜、车辆、文字屏或浮空机械 | `build_computing_center()` / `box()` / `cylinder()` |
| 大学 | `University_MainHall_Floor*_ConnectedBearingShell` / `University_MainHall_*Lancet_*` / `University_MainHall_SteepGabledRoof` / `University_MainHall_*Buttress_*` | 完整4×4围合学院后侧的一栋缩小三层主楼；三组承重壳垂直对齐，尖券窗、扶壁、敞门、翻书徽记、陡坡屋顶与黄铜屋脊均独立命名，禁止第四层、钟楼、尖塔或扩回大型现代教学楼 | `build_university()` / `research_pointed_window()` / `double_doors()` / `gabled_prism()` |
| 大学 | `University_Dormitory_Floor*` / `University_LibraryAnnex_Floor*` / `University_*_Cloister*` / `University_*_SteepGabledRoof` | 中庭左右严格相对的一栋两层宿舍与一栋两层藏书讲学副楼；内向尖券窗、内院门、扶壁和带石柱的附着式回廊共同形成中世纪学院围合，禁止第三层、额外副楼或现代玻璃连廊 | `build_university()` / `research_pointed_window()` / `gabled_prism()` / `cylinder()` |
| 大学 | `University_CourtyardStatue_*` / `University_EnclosureWall_*` / `University_MainGate_*` / `University_Courtyard_*Path` | 中庭固定一尊持书学者雕像及阶梯基座，外围为单圈低矮垛口石墙、四角墙墩和唯一正门门楼；原椭圆操场、跑道、草坪与球门已从活动白模移除，禁止第二雕像、体育设施、车辆、人员、旗帜或文字 | `build_university()` / `box()` / `cylinder()` / `double_doors()` / `gabled_prism()` |
| 深钻井 | `DeepDrill_Foundation` / `DeepDrill_MachineDeck` / `DeepDrill_DerrickPost_*` / `DeepDrill_DerrickBrace_*` / `DeepDrill_DerrickCanopy` | 完整2×2石质机座上的单体开放式深钻塔架；四柱、交叉撑、顶梁与小型坡顶连成一个可编辑结构，禁止解释为油井、现代钢塔或多栋机械棚 | `build_deep_drill()` / `box()` / `gabled_prism()` |
| 深钻井 | `DeepDrill_Bore*` / `DeepDrill_*Collar*` / `DeepDrill_MainDrillShaft` / `DeepDrill_FacetedDrillHead` / `DeepDrill_*Winch*` / `DeepDrill_Extraction*` | 中央暗井口、青蓝抽取芯、重型钻环/钻杆、顶部滑轮、大型卷扬齿轮与附着式导能歧管；全部固定在机座或塔架上，表达建在矿脉上的持续开采 | `build_deep_drill()` / `cylinder()` / `gear()` |
| 深钻井 | `DeepDrill_MaintenanceToolChest` / `DeepDrill_SparePipe*` / `DeepDrill_SpareDrillBit_*` | 地基前沿的不对称维护杂物区：铁箍工具箱、固定备用钻管架和三枚备用钻头；只表达维护用途，不再用四个操作台映射岗位数量 | `build_deep_drill()` / `box()` / `cylinder()` |
| 酒馆 | `Tavern_Floor*` / `Tavern_ContinuousSteepGabledRoof` / `Tavern_RoofCourse*` | 完整2×2地基上的三层相连半木石主体、三层外墙垂直对齐与唯一连续陡坡屋顶；层数由三组独立可编辑承重壳锁定，禁止底层缩进、上层挑出、塔楼、第四层或附属房 | `build_tavern()` / `gabled_prism()` / `roof_rows()` |
| 酒馆 | `Tavern_MainDoor_*` / `Tavern_Floor*StainedWindow*` / `Tavern_MugSign_*` | 敞开双扇大门与暖暗内口、二三层琥珀/蓝绿尖券彩窗、由墙架和双链固定的无文字酒杯徽记；全部属于主体且保持独立可编辑 | `build_tavern()` / `double_doors()` / `research_pointed_window()` |
| 连锁餐馆 | `ChainRestaurant_Floor*` / `ChainRestaurant_ContinuousHippedRoof` / `ChainRestaurant_KitchenChimney_*` | 完整2×2地基上的三层相连半木石餐馆、一层厨房与二三层用餐厅垂直对齐、唯一连续四坡顶及两座附着式厨房烟囱；禁止独立厨房、塔楼、第四层和第二栋建筑 | `build_chain_restaurant()` / `stacked_bearing_shells()` / `hipped_roof()` / `chimney()` |
| 连锁餐馆 | `ChainRestaurant_MainDoor_*` / `ChainRestaurant_Pickup*` / `ChainRestaurant_Floor*DiningWindow*` / `ChainRestaurant_PlateSign_*` | 敞开双扇顾客入口、固定取餐窗/柜台/浅檐、成组琥珀与蓝绿餐厅窗，以及附墙无文字餐盘和餐具徽记；全部组件独立可编辑，不生成露天桌椅或散落食物 | `build_chain_restaurant()` / `double_doors()` / `framed_glass_panel()` / `box()` / `cylinder()` |
| 大商场 | `GrandMall_Floor*` / `GrandMall_ContinuousHippedRoof` / `GrandMall_RoofCrownRidge` | 完整2×2地基上的四层相连商业大厅、四层外墙垂直对齐、唯一连续四坡顶与黄铜屋脊；四组独立承重壳锁定准确层数，禁止底层缩进、塔楼、第五层或附属商铺 | `build_grand_mall()` / `hipped_roof()` |
| 大商场 | `GrandMall_RevolvingDoor_*` / `GrandMall_Floor*Window*` / `GrandMall_MainSign_*` | 暖暗内口前的圆形门槛/顶盖、中央转轴与四片黄铜框玻璃门翼；四层大幅琥珀/蓝绿商业玻璃窗及固定无文字三钱币招牌，全部属于主体并保持独立可编辑 | `build_grand_mall()` / `grand_mall_display_window()` |
| 证券交易所 | `StockExchange_Floor*` / `StockExchange_FlatRoof*` / `StockExchange_RoofParapet*` / `StockExchange_AntennaTower_*` | 完整4×4地基上的六层相连现代金融写字楼；六组独立承重壳锁定准确层数并保持外墙垂直对齐；平顶冠部固定一座四脚开放钢桁架通信天线塔，包含交叉撑、横臂、三块天线板和避雷针，属于屋顶设备而不是第七层或可居住塔楼 | `build_stock_exchange()` / `framed_glass_panel()` / `box()` / `cylinder()` |
| 证券交易所 | `StockExchange_MainLobby_*` / `StockExchange_Floor*OfficeWindow*` / `StockExchange_MainSign_*` | 一层宽玻璃金融门厅、二至六层连续深蓝绿/琥珀办公幕墙、深色钢竖梃与楼板带，以及固定无文字开市钟、钱币和上升折线招牌；禁止可读行情文字、数字或独立广场道具 | `build_stock_exchange()` / `framed_glass_panel()` |
| 战地医院 | `FieldHospital_MainDoor` / `FieldHospital_Intake*` / `FieldHospital_Medical*` | 单体半木石医疗厅、附墙入口雨棚、无文字菱形药叶徽记和医疗窗；入口部件必须属于同一主体，不生成教堂钟塔或独立帐篷 | `build_field_hospital()` / `standard_shell()` |
| 战地医院 | `FieldHospital_Treatment*` / `FieldHospital_FixedStretcher*` / `FieldHospital_Herb*` | 固定在可见侧墙的治疗雨棚、棚下固定担架床和贴墙药材柜；全部位于2×2地基内并保持独立可编辑，不生成院落散件 | `build_field_hospital()` |
| 传送门 | `Portal_LeftPier*` / `Portal_RightPier*` / `Portal_MarbleArch` | 两根方形大理石门柱、柱脚/柱头、内嵌面板与单一道半圆拱；保持简洁单门轮廓 | `build_portal()` / `portal_arch_ring()` |
| 传送门 | `Portal_CyanCore` / `Portal_BrassInnerInlay` / `Portal_Keystone` | 单片拱顶青蓝门芯、窄黄铜内嵌线、单块拱顶石与门槛；禁止扩展成多环祭坛群 | `build_portal()` / `portal_core()` |
| 位面谐振塔 | `PlanarResonator_*` | 完整2×2双层地基、中央机座、四座承重轴承柱、三道相互正交的完整黄铜陀螺环和单一悬浮蓝紫晶核；环与晶核保持独立可编辑 | `build_planar_resonator()` / `resonator_torus_ring()` |
| 天气预报塔 | `WeatherTower_Observation*` / `WeatherTower_BlueHippedRoof` | 完整2×2石基、低矮观测厅、与屋面贯通的单座八角观测塔和蓝灰屋顶；保持一体式承重轮廓，不拆成细塔或多栋附属建筑 | `build_weather_forecast_tower()` / `hipped_roof()` / `cone()` |
| 天气预报塔 | `WeatherTower_Anemometer_*` / `WeatherTower_WindVane_*` / `WeatherTower_Radar*` / `WeatherTower_RainGauge_*` | 建筑级三杯风速仪、风向标、浅抛物雷达碟和双雨量筒；所有部件固定在塔顶或相连屋面基座并保持独立可编辑 | `build_weather_forecast_tower()` / `weather_anemometer()` / `weather_parabolic_dish()` |
| 丛林神庙 | `JungleTemple_*Terrace` / `JungleTemple_CentralStep_*` / `JungleTemple_*Balustrade*` / `JungleTemple_CeremonialPylon*` | 完整4×4地基、三层巨型居中退台、唯一中央宽阶、成组石栏与双侧仪式火盆；保持单体功能建筑，不拆成遗迹群 | `build_jungle_temple()` |
| 丛林神庙 | `JungleTemple_UpperLevel_*` / `JungleTemple_*Tower*` / `JungleTemple_*TowerGallery*` | 圣殿上方四层逐级收分的中央塔体，以及左右完全镜像并由石廊接入主体的双祭坛塔；塔台含塔身、平台、四角柱、火盆和石顶盖 | `build_jungle_temple()` |
| 丛林神庙 | `JungleTemple_Crown*` / `JungleTemple_RoofComb` / `JungleTemple_SunMedallion*` / `JungleTemple_Vine*` | 顶层阶梯冠部、五枚太阳冠芒、附墙几何铭文、左右镜像苔藓藤蔓与唯一暗门；顶冠附着点与藤蔓均须按模型本地X轴成对生成，植被只能作为附着细节 | `build_jungle_temple()` |
| 雪原城堡 | `SnowCastle_Foundation*` / `SnowCastle_OuterRampart*` / `SnowCastle_OuterBastion*` / `SnowCastle_Terrace_*` | 完整4×4雪覆城垣地基、左右镜像外墙与角堡、三层逐级收分的平台和同轴多段中央宽阶；地基及每层平台的侧向雪檐必须左右成对，积雪不替代承重几何 | `build_snow_castle()` / `snow_castle_stair_flight()` |
| 雪原城堡 | `SnowCastle_KeepLevel_*` / `SnowCastle_*Roof*` / `SnowCastle_Crown*` / `SnowCastle_CommandFinial*` | 五层逐级收分的日式主天守、宽深色四坡檐、独立覆雪面与中央统御顶饰；各层侧墙木带、暖窗和窗框须按本地X轴镜像，不得改成寺庙、佛塔或散塔群 | `build_snow_castle()` / `japanese_castle_roof()` / `snow_castle_wall_details()` |
| 雪原城堡 | `SnowCastle_*Yagura*` / `SnowCastle_Gatehouse*` / `SnowCastle_GatePylon*` | 左右镜像的两层橹塔通过覆顶回廊接入中央天守，加厚门楼、双侧门柱与五段宽阶保持同轴；所有塔楼必须属于同一城郭地基 | `build_snow_castle()` |
| 沙漠官邸 | `DesertMansion_*Hall*` / `DesertMansion_*StepDeck` / `DesertMansion_*Wing*` / `DesertMansion_*Dome*` | 完整4×4砂岩宫邸、四层居中逐级收分主体、中央巨型洋葱穹顶与左右各一座相连翼楼穹顶；穹顶由建筑级 `desert_mansion_dome()` 保持可编辑旋转体 | `build_desert_mansion()` / `desert_mansion_dome()` |
| 沙漠官邸 | `DesertMansion_*TorchTower*` / `DesertMansion_Entry*` / `DesertMansion_*RoyalColonnade*` / `DesertMansion_*FacadeRelief` / `DesertMansion_*WingCornerFinial*` | 左右镜像并与翼楼相连的双火炬塔、唯一纪念性拱门、双翼拱廊、成对皇家柱廊、屋顶角饰和附墙几何浮雕；除中央入口与主穹顶外，全部外侧构件须按模型本地X轴成对生成，且所有结构必须落在固定地基边界内 | `build_desert_mansion()` |
| 三级房屋共用母体 | `House_MainBody` / `House_LowerStone` / `House_MainGabledRoof` / `House_*UpperTimber` | 同一紧凑2×2两层石基半木住宅、连续双坡瓦顶、烟囱、门窗和角柱；三级升级保持承重体、屋顶占地与高度家族一致 | `build_house_level()` |
| 二级房屋增量 | `House_DoorCanopy*` / `House_Level2Balcony*` / `House_*FlowerBox*` / `House_Supply*` | 在共用母体上增加附墙门廊、小型木阳台、花箱和贴墙生活物资；不得生成独立院落或附属房 | `build_house_level(level=2)` |
| 三级房屋增量 | `House_Level3OrnateBalcony*` / `House_Gilt*` / `House_FamilyCrest*` / `House_RidgeFinial*` | 在同一母体上增加雕花铜饰阳台、克制镀金木构、家徽、彩窗花饰和小型屋脊顶饰；不增加第三层、塔楼或第二屋顶 | `build_house_level(level=3)` |
| 四级房屋小洋楼 | `HouseLV4_Level*_BearingShell` / `HouseLV4_*Timber` / `HouseLV4_Level2OrnateBalcony*` / `HouseLV4_Level3Juliet*` / `HouseLV4_RoofDormer*` | 在同一标准2×2住宅家族上增加一层完整且上下对齐的承重壳，形成三层半木石小洋楼；延续暖色灰泥、深木构、赤陶瓦、花箱、家徽和克制黄铜装饰，以侧阳台、三层朱丽叶阳台和单个附着式老虎窗提升精致度，禁止塔楼、独立翼楼、宫殿体量或第二主屋顶 | `build_house_lv4()` |
| 五级房屋蒸汽公馆 | `HouseLV5_Level*_BearingShell` / `HouseLV5_BayWindow_*` / `HouseLV5_*Steam*` / `HouseLV5_PressureGauge_*` / `HouseLV5_*Mansard*` | 标准2×2家族上的四层维多利亚城市公馆；砖石立面、附着式两层凸窗、铁艺阳台、单根家用蒸汽立管/压力表、连续青灰四坡屋顶和单老虎窗共同完成蒸汽时代过渡，机械不得扩张为锅炉厂或独立附楼 | `build_house_lv5()` / `stacked_bearing_shells()` |
| 六级房屋现代公寓 | `HouseLV6_Level*_BearingShell` / `HouseLV6_Lobby_*` / `HouseLV6_Level*GlassBalcony*` / `HouseLV6_Roof*` | 标准2×2家族上的五层现代城市住宅；真实五层承重壳、混凝土/暖灰外墙、深钢楼板带、宽玻璃门厅、交错附着阳台、花槽、平顶女儿墙和低矮屋顶设备间构成住宅语义，禁止办公塔、通信塔或独立广场 | `build_house_lv6()` / `stacked_bearing_shells()` / `framed_glass_panel()` |
| 七级房屋未来生态塔 | `HouseLV7_Level*_ArcBearingShell` / `HouseLV7_Level*_CurvedGlassRibbon` / `HouseLV7_SkyGarden_*` / `HouseLV7_CentralTower_*` | 标准2×2家族上的六层弧形未来住宅塔；六个独立椭圆承重壳逐层收分、左右错位并小角度错转，连续中央椭圆塔芯贯通各层并在屋顶形成玻璃观景冠部；二、四、六层使用真正的月牙环扇露台、弧形种植床和随弧栏杆盘旋上升，冠部必须使用无柱、无孔、无断口的连续实心椭圆女儿墙，禁止会封存绿幕的顶部镂空栏杆、退回直筒公寓、矩形贴墙花槽、浮空舱、飞行器、武器或额外第七层 | `build_house_lv7()` / `house_lv7_elliptical_shell()` / `house_lv7_arc_band()` / `house_lv7_arc_railing()` |
| 茅草屋 | `Cottage_*` | 厚草顶标准壳、门窗、烟囱、灯笼的住宅组合 | `build_thatch_hut()` |
| 奶酪农场 | `CheeseFarm_MainHall_*` / `CheeseFarm_Cowshed_*` / `CheeseFarm_Workshop_*` | 4×4宽阔平地上的中央奶酪主厅、左侧开敞牛棚与右侧相连工作间；牛棚槽位、奶酪压榨机、熟成架和奶酪轮均保持独立可编辑，人物与奶牛不烘入建筑模型 | `build_cheese_farm()` / `cheese_farm_wheel()` |
| 奶酪农场 | `CheeseFarm_PerimeterFence_*` / `CheeseFarm_Pasture_*` | 完整边界木栅栏、居中开启双门、低矮牧场地面与两座固定水槽；围栏复用公共组件，宽阔前场保持少杂物 | `build_cheese_farm()` / `post_and_rail_enclosure()` |
| 麦田风车 | `Mill_*` / `Sail_*` | 细高石基、木构上层、紧凑机房屋顶和四叶片 | `build_windmill()` / `wind_rotor()` |
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
| 研究院 LV1 | 四面相连低矮裙楼 + 唯一中央哥特方塔 | 四根菱形截面围柱、双层飞扶壁、蓝色尖券窗、蓝顶与白灰石墙 |
| 研究院 LV2 | 沿用 LV1 四面裙楼与固定占地 + 明显增高唯一中央塔 | 双层塔身窗、三道石带、相连回廊檐口、加强角扶壁、蓝顶肋与更高顶饰 |
| 研究院 LV3 | 沿用 LV1/LV2 四面裙楼与固定占地 + 再次增高唯一中央塔 | 三层塔身窗、四道石带、放大相连回廊与冠部、密集角柱、强化蓝顶肋与最高顶饰 |
| 教堂 | 完整2×2毛石视觉地台 + 对称石砌礼拜堂 + 中央门厅 + 左右镜像附属礼拜翼 + 连续深蓝坡顶 | 居中双开拱门与玫瑰窗、成对蓝橙琉璃窗和镜像附墙扶壁；无任何塔楼、钟室、尖塔、穹顶或不对称附楼 |
| 探险家营地 | 完整4×4远征总部 + 制图阁楼 + 相连档案翼 + 单座高位信号塔 | 固定梯、信号旗、补给廊、纪念性远征门、地图板、罗盘徽记与暖灯 |
| 矿工营地 | 石木矿棚 + 一体式矿洞入口 | 拱券石、暖灯、附着卷扬架、卷筒、绳索与导轨矿笼 |
| 矿洞 | 单格自然岩体 + 内嵌拱形洞口 | 绿光深处、石拱、木支护、铁带、短轨与贴地碎石；Body Depth 控生成、Cutout Depth 保留洞内件并排除地台；运行时碰撞独立使用标准1×1建筑 footprint |
| 市场 | 石木交易厅 + 宽四坡顶 | 四正两侧固定摊位、相连 L 形条纹前檐、大型钱币广告牌、商品吊牌、固定秤与双灯 |
| 皇家铸币局 | 厚重石砌金库 + 半木财政厅 + 连续蓝灰四坡顶 + 单座财政塔 | 重型金库门、王冠钱币徽记、附墙冲压机与双飞轮、币模台、单座低矮能源熔炉烟囱和克制炉光 |
| 面包屋 | 完整石基地基 + 两层半木烘焙铺 + 连续双坡瓦顶 | 附墙烤炉口、单座粗大烟囱、暖橱窗、固定面包陈列、无文字面包徽记、贴墙面粉袋与柴薪 |
| 蒸汽电站 | 完整2×2石基 + 单体石木锅炉房 + 连续青灰双坡顶 | 一体式卧式锅炉、单座高烟囱、大型侧挂飞轮、压力表、两处燃料投入口、蒸汽主管与附墙蓝色能源缓冲罐 |
| 风力电站 | 完整4×4石基 + 单体低矮发电机房 + 贯穿机房的石质传动基座 + 开放铁塔 | 唯一三叶渐缩主风轮、单一机舱与传动轴、附墙发电飞轮、左右双能源缓冲器和固定导管；无第二风机、风车磨坊、独立厂房或现代白色叶片 |
| 光伏电站 | 完整4×4低矮混凝土基座 + 后侧严格两层现代控制办公楼 + 平顶连续女儿墙 | 前场3×6与后场左侧3×3共网格阵列、屋顶2×2补充阵列、宽玻璃入口、办公窗、无文字太阳徽记与附墙双逆变储能柜；除办公楼占位外不留大片空地，无错列、第三层、通信塔、独立附楼、烟囱或散乱光伏板 |
| 算力重心 | 完整4×4低矮混凝土基座 + 中央严格四层运维核心 + 左右对称相连两层服务器翼楼 + 全部平顶连续女儿墙 | 中央宽玻璃门厅、服务器窗与外侧进风格栅、左右屋顶各一组三匣液冷银行、左右各一只附墙缓冲罐、接入中央低矮歧管的成对主管和无文字九节点处理器徽记；无第五层、通信塔、卫星锅、独立附楼、散落机柜、车辆或浮空机械 |
| 深钻井 | 完整2×2石质机座 + 单体开放式四柱深钻塔架 + 小型青灰坡顶 | 中央暗井口与青蓝抽取芯、重型钻环/钻杆、顶部滑轮、大型侧挂卷扬齿轮、附着式导能歧管及四个固定操作岗位 |
| 酒馆 | 完整2×2石基 + 三层外墙垂直对齐的相连半木石主体 + 连续暗酒红陡坡顶 | 敞开双扇大门与暖暗内口、二三层琥珀/蓝绿尖券彩窗、附墙悬挂无文字酒杯徽记与门灯 |
| 连锁餐馆 | 完整2×2石基 + 三层外墙垂直对齐的相连半木石餐馆 + 连续暗褐红四坡顶 | 一层厨房取餐窗与浅檐、敞开双扇顾客入口、二三层成组餐厅窗、两座附着厨房烟囱及无文字餐盘餐具徽记 |
| 大商场 | 完整2×2石基 + 四层外墙垂直对齐的相连石木商业大厅 + 连续青灰四坡顶 | 圆形黄铜框旋转玻璃门、四层华丽琥珀/蓝绿商业玻璃窗、附墙无文字三钱币招牌、双门灯与黄铜屋脊 |
| 证券交易所 | 完整4×4石质基座 + 六层外墙垂直对齐的相连现代金融写字楼 + 平顶连续女儿墙 | 宽玻璃金融门厅、二至六层办公幕墙、深色钢结构梃、低矮屋顶冠部、附墙无文字开市钟/钱币/上升折线招牌；无塔楼、无第七层、无独立附楼或广场道具 |
| 战地医院 | 完整2×2石基 + 单体两层半木石治疗厅 + 连续青灰双坡顶 | 前部固定接诊雨棚、侧墙治疗雨棚、棚下固定担架、医疗窗、贴墙药材柜与无文字菱形药叶徽记 |
| 传送门 | 浅阶大理石地台 + 双方柱单圆拱 | 青蓝单门芯、窄黄铜内嵌线、单块拱顶石与门槛 |
| 位面谐振塔 | 完整2×2双层石质地台 + 中央金属机座 + 四座轴承柱 | 三道黄铜陀螺环、十字导能槽、蓝紫发光轴承与单一悬浮晶核 |
| 天气预报塔 | 完整2×2石质地基 + 低矮观测厅 + 单座相连八角观测塔 | 蓝灰屋顶、三杯风速仪、风向标、浅雷达碟、双雨量筒与冷蓝观测窗 |
| 丛林神庙 | 完整4×4地基 + 三层巨型退台 + 后部封闭圣殿 + 四层收分中央塔体 | 单中央宽阶、双仪式火盆、唯一暗门、石廊连接双祭坛塔、太阳冠芒与镜像附墙藤蔓 |
| 雪原城堡 | 完整4×4雪覆城垣 + 双角堡 + 三层阶梯平台 + 五层日式主天守 | 同轴五段宽阶、加厚前门楼、左右相连双橹塔、深色多重飞檐、独立覆雪面、学院徽章与暖窗 |
| 沙漠官邸 | 完整4×4砂岩宫邸 + 四层阶梯式中央主厅 + 左右相连双翼 | 一座中央巨型洋葱穹顶、两座翼楼穹顶、两座镜像火炬塔、唯一纪念性拱门、双翼皇家柱廊与逐层成对窄窗 |
| 一级房屋 | 两层石基半木住宅 + 连续双坡瓦顶 | 木门、双暖窗、烟囱与双灯笼 |
| 二级房屋 | 与一级相同的两层母体 | 附墙门廊、小阳台、花箱、木桶与小货箱 |
| 三级房屋 | 与一二级相同的两层母体 | 雕花铜饰阳台、家徽、镀金木构、更多花饰、屋脊顶饰与华丽灯具 |
| 四级房屋 | 同一2×2家族的三层半木石小洋楼 + 连续赤陶双坡主顶 | 对齐新增的完整第三层、双层木构节奏、侧阳台、三层朱丽叶阳台、单个附着式老虎窗、家徽、花箱与克制黄铜细节；不得长成塔楼或宫殿 |
| 五级房屋 | 同一2×2家族的四层维多利亚蒸汽公馆 + 连续青灰四坡顶 | 砖石立面、两层附着凸窗、铁艺阳台、家用蒸汽立管和压力表、单老虎窗与烟囱；不得长成工厂或独立翼楼 |
| 六级房屋 | 同一2×2家族的五层现代城市公寓 + 平顶女儿墙 | 宽玻璃门厅、现代框架窗、交错附着玻璃阳台、花槽、屋顶设备间与太阳能板；不得变成办公楼或通信塔 |
| 七级房屋 | 同一2×2家族的六层错转椭圆生态塔 + 贯通中央塔芯与玻璃观景冠部 | 每层楼面和外墙均为真实圆弧，逐层收分并交替偏移；二、四、六层月牙空中花园沿塔体盘旋，配弧形种植床、随弧栏杆、曲面玻璃带和屋顶连续实心椭圆女儿墙；顶部不得使用镂空栏杆或半圈能量环，无直筒公寓、矩形贴墙花槽、浮空舱、武器或第七层 |
| 裸露能量矿脉 | 标准1×1 footprint 式断续碎石带 | 三形态分别为横向裂隙、环状碎石矿窝与Y形分叉矿带；能量块始终宽于高度并嵌入地表，不得生成尖塔晶簇 |
| 茅草屋 | 厚茅草标准壳 | 门窗、烟囱、灯笼 |
| 奶酪农场 | 完整4×4低矮牧场 + 中央奶酪主厅 + 左侧开敞牛棚 + 右侧相连工作间 | 完整木栅栏边界、居中开启双门、牛棚槽位与饲料槽、奶酪压榨机、熟成架、奶酪轮和两座固定水槽；牛倌与奶牛为独立动画资产 |

本表只记录组件覆盖关系。实际完成度、导入状态和验收结果统一查 `git log` 与 `CHANGELOG.md`，不写入 skill。

## 新增组件时具体改哪里

1. **公共组件代码**：`tools/ai-gen/building-component-kit.py`。
2. **当前建筑装配调用**：`tools/ai-gen/settlement-building-pack-blender.py` 的对应 `build_<building>()`。
3. **尺寸/相机/颜色**：`tools/ai-gen/_settlement_building_pack_20260821/manifest.json`。
4. **生成语义与禁止项**：`tools/ai-gen/_settlement_building_pack_20260821/prompts/<building>.txt`。
5. **组件登记**：本文件对应表格；写明函数、参数、首用/现用建筑和对象名前缀。
6. **技能入口**：只有优先级、阶段或验收规则发生变化时才改 `skill/02-ai-asset-pipeline.md`；单纯增加一个组件不把实现细节重复写进入口章节。

组件登记和代码实现必须同批提交。若发现模型里已有可拆对象、但本表没有记录，应先补登记再继续新建筑建模。
