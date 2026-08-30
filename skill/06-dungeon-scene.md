> 本文件为 game-dev 技能库分卷，主索引与目录见 ../SKILL.md
> 本节：6. 地牢与场景构建

## 6. 地牢与场景构建

### ⭐ 生成世界标准工作流（2026-08-19 定稿，新增世界一律按此开展）

> 适用于世界-123/124/125这类大地图世界。顺序固定为：
> **定义世界 → 选地板 → 注册场景 → 构建边界 → 生成环境 → 接入入口 → 镜头 → 验收**。
> 禁止只加 `_loadSceneN` 而遗漏配置、传送入口、清理链或回归测试。

#### 1. 定义世界规格

1. 分配未使用的 `sceneN`，名称统一为 `世界-<编号>·<主题>`。
2. 大世界默认复用世界-122规格：
   `width=12288`、`height=8192`、`origin=(6144,4096)`、`diamondFloor.enabled=true`。
3. 菱形几何统一调用 `SceneManager._scene8Diamond(scene)`，边界统一调用
   `_registerScene8Boundary(diamond)`；禁止复制另一套斜率或手写矩形可移动区。
4. 需要世界-122广角视野时，把场景加入 `GameScene._updateCamera` 的
   `zoomedOutWorld`，基础缩放使用 `0.7`；未声明则保持 `1.0`。

#### 2. 选择地板管线

- **无缝连续纹理**（雪地/草地/沙地）：`setDungeonFloorProfile({continuous:true,
  textureScaleY:0.5774,...})`，再调用
  `applyDungeonFloorChunked(w,h,2048,diamond)`。
- **复用地牢菱形砖池**（世界-125）：直接沿用地牢 `tiles` 和 `glow/overlap` 口径，
  不开 `continuous`；分块系统会按全局格坐标确定性选择砖块/镜像，跨块不跳变。
- 地板、点缀贴图必须先由 `BootScene` 注册；能复用现有正式资产时禁止重新生图。
- `data/game-config.json` 与 `public/data/game-config.json` 必须字节一致；编辑器/运行时
  读源不同，漏同步会出现“测试通过但实机旧配置”。

#### 3. 注册与加载场景

1. 在两份 `game-config.json.scenes` 写场景配置。
2. 在 `SceneManager.init().scenes` 增加兜底配置。
3. 在 `switchScene` 分发增加 `_loadSceneN`；加载器需要等待预制资源时声明为 `async`
   并在分发处 `await`。
4. 进入加载器先 `clearDecoClearZones()`，重置 Camera aim/shake/lock，再设置
   `CONFIG.WORLD_WIDTH/HEIGHT`。
5. `switchScene` 会先执行目标加载器、在收尾阶段才提交 `currentScene`；加载器内凡是会按场景
   选择世界尺寸的初始化器必须显式接收目标场景（如回城调用 `Renderer.generateWorld('main')`），
   禁止从尚未更新的 `currentScene` 反推目标，否则会把目标尺寸覆盖成离场场景的默认尺寸。
6. 标准加载骨架：
   - 设置 floor profile并注册2048分块；
   - `WallSystem.init(w,h)`；
   - 注册四条无视觉矩形外边和菱形四边 `_boundary` 线段；
   - `_syncWallsToPhaser()`；
   - 普通模式生成玩家并 `Camera.follow`，观察模式只把相机放世界中心；
   - 生成环境；
   - 在菱形底端 `cy+ry-160` 放 `Portal(...,'main','返回主神空间')`。
7. 离场清理条件必须包含新场景；`Renderer.terrainChunks`、实体和墙视觉沿用
   `switchScene` 统一清理，不另建生命周期。

#### 4. 环境生成标准

- **地板点缀**（草/蕨等无碰撞物）：放入 floor profile 的 `deco`；每次入场生成新 seed，
  同一次分块重烘焙保持稳定。
- **单体障碍**（树、石柱、烛台）：贴图与 footprint 登记在 `ISO_WALL_GEO`，尺寸优先读
  `obstacle-defaults.json`，否则用 `obstacleH/geo.h`。
- **摆墙预制组合**：先 `await loadWallPrefabs()`，保留组内相对坐标、scale/rotation/flip
  与保存 depth 差值；只抽取全部件均为 `category:'obstacle'` 的组合。
- 每个候选必须同时通过：菱形内缩、玩家排除、返回门排除、最小间距、
  `getObstacleFootprintRect`、`WallSystem.canMoveTo` 和已放 footprint 相交校验。
- 世界散布件标 `_scatter:true` 复用静态投影；组合件再标 `_prefabKey` 便于审计。
- 全部候选确定后只调用一次 `rebuildIsoCollision()` 和一次 `_syncWallsToPhaser()`；
  禁止每放一件就全量重建。

#### 5. 接入所有传送入口

新增世界必须同时登记：

1. `src/ui/world-switch-panel.js` 的 `WORLDS`；
2. `data/game-config.json.portals.mainHub.entries`（并同步 public）；
3. `data/producer-buildings.json.portal.destinations`；
4. `data/audio-config.json.bgm[sceneN]`（无音乐显式写 `null`）。

按钮必须调用 `SceneManager.switchScene`；世界切换面板继续走观察模式 `_travel`，
建筑传送门走正常人物传送，禁止直接改 `currentScene`。

#### 6. 决定世界玩法与持久化

- 纯探索世界不要接入 `DefenseSystem/EnergyNodeSystem/ProducerBuildingSystem`。
- 有建筑、波次、资源或生产状态的世界，先定义快照和后台结算语义，再接入切换入口；
  禁止依赖切场后仍存活的实体引用。
- 所有随机环境默认“每次进入重新生成”；需要保持布局时，把 seed/坐标写入世界快照，
  不要保存 Phaser Sprite。

#### 7. 验收清单

1. 新建 `scripts/test-world<编号>-<theme>.mjs`，至少锁定：双份配置一致、尺寸/菱形、
   地板键、环境类型、无错误玩法系统、世界面板/主城门/建筑门三入口、镜头缩放。
2. 随机散布函数必须用真实 `ISO_WALL_GEO` 和真实预制库重复运行，验证配置数量能放满。
3. 更新受目的地数量影响的旧回归测试，并把新测试加入 `npm test`。
4. 运行：新世界测试、相邻世界测试、传送门测试、ESLint（0 error）和 `npx vite build`。
5. 需要视觉验收时优先使用项目安全入口
   `powershell -ExecutionPolicy Bypass -File tools\cdp-run.ps1 <probe.mjs>`；
   禁止按进程名全杀浏览器。

#### 8. 已落地变体

- 世界-123：连续雪地 + 表面补丁 + 雪松/雪草；与世界-122同为 `0.7` 基础镜头缩放。
- 世界-124：连续草地 + 林地草簇 + 五姿态针叶树；与世界-122同为 `0.7` 基础镜头缩放。
- 世界-125：遗迹大石板 `ruinslab_1/2` 砖池（2026-08-23 起，见下条）+ 石柱/烛台/纯障碍预制组合；
  与世界-122同为 `0.7` 基础镜头缩放。

#### 世界-125 遗迹大石板地砖（2026-08-23）
- 旧 `blackbrick_7/8` 内部砖缝实测约 ±37°，与建筑底边 2:1（0.5）口径不符，scene11 已换
  `ruinslab_1/2`；blackbrick-7/8 仍归僵尸地牢中/高级使用，勿动。
- 管线：AI 只出轴对齐大板无缝材质（prompts/floor-seamless-dungeon-slab.txt，4×4 大板、
  接缝差<2、desat 0.35/lighten 0.92 对齐旧砖亮度 ~53），`tools/ai-gen/build-dungeon-slab-tiles.py`
  逆等距映射切菱形砖：`--width 512 --slope 0.5 --slabs 2 --variants 2`；砖缝严格平行菱形边，
  变体按整砖周期（0.25 纹理单位）错相，混铺砖缝全场连通。
- 角度口径：世界位面建筑地基/道路/底边是 2:1（0.5）；历史连续墙地牢房间/墙体仍是 30°（0.5774）。
  **僵尸 `worldBlock1x1` 单格墙体系属于建筑口径**，墙块、门闸和地板统一跟 0.5；其他旧地牢继续跟各自
  0.5774 合同，禁止把两种投影在同一套场景结构内混用。

#### 僵尸地牢建筑2:1数学无缝黑色方砖地貌（2026-08-26，2026-08-27角度/画风修订）
- 初级/中级/高级统一通过`floor.terrainProfile:'zombieDungeonStone'`路由到
  `data/dungeon-terrain.json`；底层固定为`floor_dungeon_black_bricks_seamless`，砖格按屏幕空间
  `(+64,+32)/(-64,+32)`双轴投影构建，斜率0.5、屏幕角26.565°，单砖周期128×64、整图周期1024×512。
  该贴图已按建筑2:1口径预投影，运行时必须`continuous:true/textureScaleY:1.0`，禁止再次纵向压缩，也禁止退回
  旧菱形图随机拼贴或无砖缝暗石面。石面材质固定复用原始`assets/terrain/blackbrick.png`，但画质尺度必须
  对齐当前`building_road_tiles`：先去除母砖外圈，再以16px低频代理降采样/回升和柔化，只保留宽幅磨损起伏；
  砂浆缝、倒角和逐砖明暗由数学网格控制，禁止把原图逐像素颗粒、孔隙和裂纹完整压进每块128×64砖面形成满屏噪点，
  也禁止退化成完全无石面变化的平滑程序灰面。重复周期内用8档克制冷暖/明暗与4种低频镜像组合打散统一感；
  破碎固定为8×8周期中4格（6.25%），每格最多一个小缺角和一条两段式细裂，不生成碎屑实体、不改变碰撞，
  不得提高到会在全屏形成裂纹网的高频比例。
  白色碎屑`cellDetails`层已删除，上层顺序固定为`deco → 墙脚淡出`；`deco`在
  `bakeDungeonFloor/applyDiamondFloor/applyArenaFloor`三条入口都必须透传。
- 僵尸单格墙竞技场的门外入场/出口飞地必须调用`bakeDungeonFloorPatch`，与房内连续地板按世界坐标锁定
  同一纹理相位；禁止再用整张地砖独立缩放或不吸附格网的自由中心。六格门洞从房内1格到门外1格保持原宽，
  门外肩位才沿两侧各扩1个128×64格，随后延伸至门外5格；门槛直段、整格肩位和外平台全部只使用2:1格网轴，
  禁止平台一出门就压到两侧门柱墙脚。视觉多边形、玩家出生中心和离场命中必须同源；
  外侧三边注册`_gateZoneBoundary + _movementOnly`活动边界，门口一边开放，碰撞重建保留、地块销毁时同步摘除，
  且投射物高度碰撞必须跳过该纯移动边界。
- 地牢小件复用道路资产标准：正交30°相机、44.8°模型根与固定prop相机；
  18种小件统一使用低亮度石材、旧骨、蜡和纸张，只烘焙进地板画布，禁止登记`ISO_WALL_GEO`或创建碰撞。每次入场刷新`deco.seed`，
  同一次房间重烘焙必须稳定；竞技场小件只落在各房间菱形，通道不散布，边缘安全距不小于贴图半径。
- `ObstacleSpawnSystem.spawnForRoom/spawnForPassages`固定返回0，房间烛台、中央石柱、预制障碍组合
  与通道火把全部停止生成；配置`combatRoom.obstacles:false`作为第二道门禁。不要删除这些全局资产，
  `obstacle_candle/obstacle_torch`仍被世界-125、建筑和编辑器复用。

- **矿洞墙面火把显式例外（2026-08-30）**：用户重新要求后，仅`abandonedMine.wallTorches`启用
  `DungeonWallTorchSystem`。复用正式`obstacle_torch`、粒子与常驻暖光，只读最终墙段/门线及房间、
  通道含孔轮廓，在墙门完成后稀疏挂饰；不恢复ObstacleSpawnSystem，不加入isoVisuals/碰撞或布局随机流。
  只挂可见内侧直墙，跳过门端、转角和木撑；杯口/背板锚同变换，离场/失败恢复必须清理粒子并注销光源。
  参数在墙样式中，来源和范围见`docs/abandoned-mine-wall-torches.md`；普通地板小物仍不登记实时灯光。
  非发光挂绳/矿镐/木牌经`wallDecorations`与独立配置接入同一挂饰生命周期，火把先占位、挂饰填剩余净空；
  坐标散列加权选型、同类近距排除、每房/通道/全场数量上限，不改场地随机流。平放小物须在模型中转为挂墙
  姿态并重渲，两轴独立出图保留光向；宽挂饰沿另一等距轴贴岩体可见侧面，不用屏幕法线或抬depth掩盖邻墙裁切。

#### 沼泽地牢连续湿泥地貌（2026-08-26）
- 沼泽初级/中级/高级统一通过`floor.terrainProfile:'swampDungeonWetland'`路由到
  `data/swamp-dungeon-terrain.json`；连续湿泥底材、4帧透明泥水细节和18种低矮小件复用僵尸地牢
  已打通的`cellDetails → deco → 墙脚淡出`烘焙链，边缘淡出必须保持最后绘制。
- 底材美术方向固定为“连续湿泥上的浅水漫滩”，不得收敛成平滑干泥或规则裂损地板。正式母材先保留旧版
  全域潮湿薄层，再从原始泥面经38px宽幅模糊后的自然暗部推导浅水遮罩；禁止手工盖规则椭圆池、人工裂纹网，
  也禁止为了降噪抹掉母材原有的细泥、天然裂纹与泥水交界。运行时仍按`textureScaleY:0.5774`消费。
- 沼泽竞技场出入口飞地与僵尸单格墙使用同一行为合同：门内1格、门外1格保持藤门原宽，门外肩位沿两侧
  各扩1格并延伸5格；格距由藤门真实底边跨度÷6反推，沿连续墙30°双轴展开。视觉必须调用
  `bakeDungeonFloorPatch`按世界相位烘焙，出生中心、离场多边形和七段`_gateZoneBoundary + _movementOnly`
  外缘同源；门内边开放、门槛重叠带不发光，清场同步销毁，禁止退回整张1024贴图独立放大和AABB判定。
- 小件沿用道路正交30°相机与44.8°模型根合同，按每次入场seed确定性散布；泥块、湿石、苔石、
  芦苇、香蒲、睡莲、浮萍、菌菇、腐木板、根须、细枝、蜗牛壳、蛙骨、破碗、锈钩、草绳、沼泽花与卵簇
  全部只进入地板画布，不创建实体、碰撞、占格或寻路阻挡。根须/细枝使用低权重，避免枝条主导画面。
- 旧`swamp_deco_3..6`和`swampbrick_new1`停止预载与运行时使用，但素材文件不在本次范围内删除。
  `wallStyle:'swamp'`、藤门、宝箱房和战斗房布局合同保持不变；僵尸地牢的烛台/通道火把也不得受此配置影响。

### ⭐ 地牢迷宫自动生成关键参考（2026-08-11 定稿，新增地牢/迷宫必读）

> 本节沉淀分级竞技场（3 房直线 / 5 房蛇形迷宫）的完整自动生成体系：布局纯函数 → 房间
> 菱形墙 → 通道预制放置 → 门墙/封口/补缝 → 波次门控。后续新增地牢、改布局、加
> 通道方向，一律以本节为唯一参考；先读「铁律」再动手。

#### 0. 架构与文件地图
- `src/world/combat-arena-layout.js`：**纯函数**布局（无 Phaser 依赖，可单测）。
  - `diamondRadii(size)`：rx = size×1.2，ry = rx×0.5774（30° 等距投影）。
  - `computeArenaLayout({ normalSize, eliteSize, passageLen, gap, roomCount })`：
    N 房线性串联（全部 LT 进 / RB 出，纯 v1 通道，房间 1-3 的同构模式）。
  - `computeMazeLayout({ sizes, passageLen, gap, rows })`：蛇形网格（排内 ±v1 交替、
    排间 +v2 折返），每房记 inEdge/outEdge（末房出口 = 入口对边）。
  - `MAZE_AXIS_V1=(0.866,0.5)`（左右通道轴）、`MAZE_AXIS_V2=(0.866,-0.5)`（上下
    通道轴）、`passageEdges(dir)` 方向→出入口边映射、`pointInDiamond`。
- `src/world/combat-room-system.js`：布局消费端——菱形墙、通道放置、门墙、封口、补缝。
- `src/world/dungeon-map-system.js`：竞技场入口（`_enterCombatArena`）、波次/门控编排。
- 配置：`data/dungeon-config.json` → `combatArena.roomCountByGrade`（F 1/1、E 1/3、D+ 3/5，普通/精英）与 `combatArena.maze = { enabled, roomCount, rows }`；
  `passagePrefabs = { v1: '左右通道·样式', v2: '上下通道·样式' }`。
- 房数契约：节点只负责传入本场 `roomCount`，实际波次、末房宝箱、门控、陷阱和出口一律读取
  `arena.rooms.length`；禁止在这些消费端再次按等级推导房数，否则配置调整后会出现房数与波次脱节。

#### 1. 菱形几何铁律
- 四顶点 T(cx,cy−ry) R(cx+rx,cy) B(cx,cy+ry) L(cx−rx,cy)；四边斜率 ±0.5774。
- 对边中点连接的中心距公式**四方向相同**：
  `(rx_A + rx_B) × EDGE_MID_FACTOR + passageLen`（EDGE_MID_FACTOR = hypot(1,0.5774)/2）。
- 边参数化必须**上端→下端**：RB=R→B、LT=T→L、TR=T→R、**BL=L→B**——旧 B→L 会让
  `_fillEdgeGaps` 补缝瓦 sy<0 上下颠倒（2026-08-11 修复）。
- 深度唯一规则：墙件 depth = max(底边两端点 y)（`WallSystem.depthOf`）；门墙 depth =
  门洞中心底边 y（"墙看底边 max、门看门洞中心"）。

#### 2. 通道系统（核心复用件）
- 通道 = 墙样式预制件（`左右通道`/`上下通道`），`_analyzePassagePrefab` 解析：
  两个功能门墙件底边中心距 = 通道长度；双轴校验（v1/v2，取 |dot|≥0.8，反向交换两端）。
- `_placeArenaPassage`：平移预制 → 摘门洞覆盖墙件（removeSpanCoveringPieces）→
  直墙件裁剪入件 / 门墙建功能门（`_createArenaGate`，初始常开）。
- **180° 镜像（反向通道 -v1/-v2）——本轮最重要教训**：
  - **禁止**"位置反射 + flipX(±flipY) 翻转"：门墙精灵锚点（在门洞中心上方 ~93px）
    会被反射到门洞另一侧 → 视觉门洞偏移 ~187px、贴图朝向反转（用户实测"4→5 门口
    错位、方向反了"）。补 flipY 只是贴标签，不治本。
  - **正解（2026-08-11 定稿）**：反射件**底边线段**（绕 gA 底边中心 180°），再由
    `WallSystem._buildSegPiece`（直墙）/ `_buildGatePieceAt`（门墙）从反射底边
    **重建件**——锚点/缩放/朝向全部由几何自动推导，镜像结果与正向通道完全同构
    （门精灵锚点在门洞上方、flipX 保持预制件原生值、flipY=false）。
  - `_buildSegPiece` 是 `_addSegPiece` 抽出的纯构建（wall-system.js），不推入
    isoVisuals，返回件对象供调用方走裁剪/入件流程。
  - 无底边的装饰件才用"位置反射 + flipX/flipY 双翻"兜底。

#### 3. 封口/补缝 flip 解耦（2026-08-11）
- `_sealPassageSides` 补通道侧墙端到房间边的楔形缺口：
  - **端点交换与 flip 解耦**：`swap = axis.y < 0`（向上轴 v2/-v1 交换端点 → B 在下端
    → sy>0）；`flip = (axis.x < 0) !== swap`（保 sx>0）。`lay()` 内先 swap 再按轴
    铺 A/B。
  - 旧 `flip = axis.x*axis.y <= 0` 且 swap 绑定 flip：-v1 判断相反 → 封口瓦上下颠倒
    飘进房间（6 块负 sy 件）。
- `_fillEdgeGaps` 补开洞边缝隙：边参数化上端→下端（§1）；门侧瓦端锚定 8px 叠合，
  绝不跨进门口；两侧都是墙时整瓦居中步进。

#### 4. 波次/门控/出口/宝箱泛化（硬编码 3 全部改成 arena.rooms.length）
- `forceArenaWaves(getArenaRoomCount())` 必须在 `enterCombatArena` **之后**调用
  （之前 `_arena` 未建返回 0 → 波次不足 → "房 3 清完不开门"）。
- 出口门锚定末房 outEdge 中点（`_setupGate` 通用）；宝箱房 setup 末房；`_trapExtras`
  末房来路通道索引 len−2；入侵混合战特工末房随最后一波刷新。

#### 5. 验证方法论（每次改迷宫必须走）
1. **CDP 数值审计**（headless Edge 走真实 GPU，勿 `--disable-gpu`）：
   - 房间零重叠（菱形中心互不包含）；通道轴正确（v1/v2/-v1）；
   - 8 门全开、门中心 = 通道边中点；**负 sy 件 = 0、游离墙件 = 0**（离所有房间边线
     >160px 且非宝箱房墙）；
   - **门精灵锚点对比正向通道**：锚点在门洞中心上方 ~93px、flipX 与同向边一致——
     这是"门口错位 / 方向反"的最快判据（P4 镜像门曾翻到下方 94px + flipX 反转）。
2. **GLM-4.6V 识图复核**：全景（蛇形排列、四面墙完整、通道对齐自然）+ P4 通道特写
   （两侧墙平行完整、门洞横跨通道且与房间墙对齐、无竖摆/断口/重叠/游离墙、
   纹理方向正常）。
3. `npm test`（51/51，含 pathfinding-bench 竞技场断言）、lint 0 error、vite build。

#### 6. 踩坑清单（按时间线）
- 通道直墙件越线**不要缩 scaleX**（削墙顶出台阶/错位），整件进房才丢，缺口由封口补。
- `_clipPassagePieceToRooms` 房间对象字段用 `cx/cy`（不是 x/y）——NaN 比较恒 false
  会把全部侧墙件误丢（"通道没做墙"）。
- seal 收集侧墙只认 `_passageWall` 标记件——转弯通道轴与房间 TR/BL/LT 边平行，不
  标记会把房间边墙当侧墙补到通道中间（横墙挡路）。
- `halfSpan = length/2 + 500` 才够覆盖 3 段瓦末端件（+250 会把末端排除 → 封口从
  通道中段铺起）。
- headless 渲染探针先查 `window.__phaserScene` 是否就绪，再判断"渲染问题 vs 数据
  问题"；浏览器缓存会让旧代码看起来"没修改"——改完让用户 **Ctrl+F5** 强刷。

#### 7. 新地牢全流程实录：C 级「恶魔洞窟」（2026-08-11，矿洞主题）

> 一条龙做完的完整参考（墙/地砖/铁闸门/数据/验证），新地牢照此走。

**生成（远程 5080，队列共享）**：
- 岩壁墙（路线 B 定稿 2026-08-11）：Blender box 几何 spec
  （`_blockout_specs/demon_wall_b.json`：520×52×150 rot52）→ `render-cover-real.py`
  直接渲染成品墙（AI 岩质材质 `demon_rock_tex.png` 贴 box 正面/顶面，无投影、
  透明底、底边由几何精确控制）→ `prep-demon-wall-B.py`（水平镜像 → 内容裁剪 →
  标定 base/face/slope）。成品 `demon_wall_straight.png` 684×659，slope 0.64
  （32.6°），wallH 326。**渲染坑**：`box_full_uv` 每面整张纹理（默认 cube UV 只
  显示上半部）；材质直连 Base Color，EEVEE 下 AO/Mix 会刷成纯色；`bevelTopOnly`
  保底边直线。
- 地砖：`demon_floor_b.json`（230×230×10 box rot45）→ render-cover-real →
  内容包围盒裁剪入库 `demonbrick1.png`（640×334 菱形板；floor 系统按 alpha 包围盒
  实测几何，无需手写 geo）。
- 铁闸门（路线 B，弃用 H3 视频）：岩壁单块（`demon_gate_wall.json` 406×56×102）+
  铁栅独立渲染（`demon_gate_bars.json`：7 立柱 181 高 + 顶梁，AI 铸铁材质
  `demon_iron_tex.png`）→ `compose-demon-gate-B.py` 程序化合成 16 帧升起
  （**平行四边形门洞**：洞顶/洞底与墙底边平行；铁栅按"顶部对齐 + 立柱加高 +
  逐列地面线裁剪 + 底部 40px 冗余"填满门洞；关闭帧用深铁色底梁填实立柱锯齿）。
  成品 `demon_gate.png` 640×576/帧，slope 0.6347，wallH 291，gateX [159,481]。
  **坑**：
  1. 闸门 wallH 必须与直墙同长宽比（直墙 684/326≈2.10 → 640 宽门墙高≈305），
     否则闸门世界宽度 ≠ 被替换墙段（歪门/悬空）；
  2. 铁栅立柱底边是锯齿线（每根柱的端盖投影），绝不能直接对齐底边——用
     "洞顶对齐 + 高度冗余 + 裁齐"方案；
  3. 合成后**帧高变化必须同步 `BootScene` 的 spritesheet frameHeight**
     （786→576）：帧错位时 placeAt 创建的精灵无有效帧，闸门整扇不显示；
  4. `WallGate.placeAt` 在贴图未就绪时**静默返回 false**（闸门消失、墙件回插）：
     真实流程 BootScene 加载完才进游戏没问题；测试脚本必须等
     `textures.exists('demon_gate')` 再进竞技场；
  5. 竞技场门是 `_createArenaGate` 实例（`_arena.entryGate` +
     `passages[].gates`），不是 WallGate 单例；出口门才是 WallGate。

**数据驱动（不硬编码）**：
- `dungeonList.demonCavern` + `demonCavern` 配置块（C 级，floor tiles demonbrick1）。
- `_keyFor('demonCavern')`（SKILL 规定的唯一代码登记点）。
- **`family: 'zombie'` 数据字段**：`_isZombieFamily()` 改为读配置
  `getZombieDungeonConfig(type).family === 'zombie'`，替代硬编码地牢列表——新地牢
  进僵尸家族（战斗/竞技场/怪物池）只需在配置块加 family。
- `ISO_WALL_STYLES.demonCavern`（straight/gate/chestPrefab/gateSound）+ `ISO_WALL_GEO`
  demon_straight/demon_gate（**geo 的 w/h 是单帧格子尺寸**，不是整表尺寸——整表会
  让门闸辉光烘焙只算 1 格、刷 "has no frame"）。
- **通道预制样式重映射**（`_placeArenaPassage._remapPassagePieceToStyle`）：默认
  预制（wall_straight/wall_gate）按当前墙样式从底边重建件——新地牢通道自动换
  匹配墙/铁闸门，无需为每套样式维护专属通道预制。

**验证**：CDP 进 demonCavern → 5 房竞技场、10 门全 demon_gate 且全开
（入口 1 + 通道 8 + 出口 WallGate 1）、帧 0/15 切换正常、无负 sy；GLM：房 1 岩地+
岩壁+橙矿晶、通道铁闸底边与岩壁齐、关闭帧铁栅完全覆盖门洞、无贴图异常；
墙/门相关测试 248 项通过（test-gate-corner / arena-layout / wall-depth / wall-embed /
collision-grid / regressions）、vite build ✓。

**遗留**：demon 转角预制未做（当前回退程序化转角臂）；宝箱房用通用「宝箱房」
（直墙件自动重映射、门件仍默认纹理）。

---

### 地牢随机事件表现与接入工作流（2026-08-27）

- 限定事件真源为 `src/world/dungeon-event-definitions.js`：同一事件键必须同时登记 `NEW_EVENT_WEIGHTS`、`RESTRICTED_EVENT_META`、`EVENT_BG_IMAGES` 与 `NEW_EVENT_CONFIGS`。`scope` 负责题材隔离，`grade` 继续走地牢等级 ±1；不要为单个地牢另写抽取分支。通用事件固定保留30%，限定池占70%。
- 结果只使用 `handleNewDungeonEvent()` 已支持的协议：金币、HP/MP药水、普通/特殊材料、百分比恢复/伤害、揭示节点、3场战斗Buff/Debuff，以及 `combat + forceMonsters + encounter`。新增结果类型前必须先扩展应用、结算、存档/恢复和结果面板全链，不能只写配置字段。
- 限定事件中的 `outcome.gold` 是事件作者的基础值，最终正负金币统一乘 `combat-formulas.json#dungeonRewards[当前地牢grade].eventGoldMultiplier` 后取整；必须按实际地牢等级缩放，不能按事件自身等级或在单个事件里复制阶段倍率。通用补给堆探查金币与宝箱金币分别读取 `universalEventRewards.supplyPile[grade].inspectGold` 和 `treasureChest[grade].gold`。
- 事件战斗的 `forceMonsters` 必须是 `ZOMBIE_FACTORY_MAP` 已登记的 enemy-config 键；`encounter.monstersPerWave` 必须不少于强制怪数量。限定事件不得绕过当前地牢题材/阶级池去引用未登记工厂。
- 每个事件背景使用3:2横图，路径固定为 `assets/scenes/dungeon-events/<slug>.png`，画面主体置于中景，底部约25%保持低细节供243px事件面板覆盖；禁止图中文字、UI、水印、分栏和边框。背景由 DOM `background-size:cover` 直接读取，无需 BootScene preload。
- 所有事件属性检定必须统一走 `AttributeCheckSystem.getSuccessRate()/check()`：原始值为 `baseRate + 属性值 × attrMultiplier`，20%—80%保持线性，区间外以指数软边界渐近5%/95%，最终再做数值安全钳制。选项面板只用 `getSuccessRate()` 预览，禁止调用 `check()` 消耗随机数；新增事件只配置 `attribute/baseRate`，不得复制或另写概率公式。
- 僵尸与沼泽限定事件固定使用三选项结构：两个结合现场行为、奖励和失败代价有明确差异的属性检定，加一个无属性检定的叙事选项。第三项可以是真正的安全离开，也可以在题材与现场铺垫合理时出现伏击、追杀或强制战斗；按钮文案与结果必须让反转在叙事上成立，不得机械地把所有第三项都写成安全出口或相同陷阱。雪原 C/B/A 事件继续使用三个属性检定加一个无检定叙事选择的四选项结构；每档5个事件中固定4个末项付出生命/魔力/减益代价或进入战斗，1个末项安全离开或因善意获得小型确定奖励。雪原事件权重相同时，这一4:1结构必须在C、B、A各档分别成立，确保±1混合池仍保持80%非安全末项；不得只按15个事件总数凑比例，也不得为统一数量删减雪原分支。
- 交付前做静态映射核对：四张事件表键集合一致、图片文件存在、每个 choice id 唯一、属性键限 `str/dex/con/int/wis/luck`、奖励字段均被处理器消费、限定池在目标地牢 grade 下非空；运行时验证仍按本项目默认约定由用户执行。

### 地牢添加标准工作流（新增地牢一律按此开展）

#### 地牢祭品生命周期（2026-08-22）

- `ExpeditionSystem.depart()` 不再携带祭品；它按地牢 `grade` 映射 `anchorTokenF~A`，自动从背包/仓库检测并消耗1枚对应钥匙后进入地牢。
- `tribute-effects` 在所有场景只读取位面祭坛 store；地牢不再使用 `_carriedItems`，也不得在 `depart()` 中 teardown/冻结献祭状态。
- 全部祭品默认持续30分钟，进入地牢后继续按同一绝对到期时间倒计时；`Game.update()` 必须在地牢地图/事件早退前推进 `World122TributeSystem.update()`，到期后立即重算玩家与友军属性。
- `DungeonMapSystem.shutdown()` 只清理地牢专用特效图标，不清除或延长全局献祭；蟠桃使用次数统一由 `_worldPeachReviveUsed` 持有，只有重新献祭蟠桃才刷新。

#### 1. 展示元数据（data/dungeon-config.json `dungeonList`）
新增条目：`{ name, nodeCount, battleRatio, level, reward, grade, series, seriesName, seriesIcon, seriesOrder, tier, tierOrder, unlockAfter? }`——`grade`（F~A）驱动事件池 ±1 匹配、通用事件奖励档、祭品掉落表（maxRarity/权重）和出征钥匙门槛；`series*` 驱动祭坛下拉父标题，`tierOrder` 固定系列内初级→中级→高级顺序，`unlockAfter` 指向同系列前一级 type。出征界面选择器/说明栏自动读取配置；新增多级系列必须同时声明层级元数据，禁止在 UI 硬编码系列名单。

- **同系列逐级解锁合同（2026-08-24）**：初级不写 `unlockAfter`，中级指向初级、高级指向中级；解锁状态只读取 `WorldProgressionSystem.hasCompletedDungeon()` 的成功通关记录。下拉选项禁用只是展示层，`ExpeditionSystem.depart()` 必须在钥匙检查与消耗之前再次校验，避免通过脚本或陈旧 DOM 绕过门槛并误扣钥匙。

#### 2. 地牢配置块（同文件，如 `zombieDungeonMid`）
- `nodeCount.min/max`：房间数
- `shortestCombatPath`：到达 Boss 的最少战斗场数
- `typeRatios.combat/event`：战斗/随机事件比例（合计 1；祭品耦合键 combatChanceDelta 会同步调整两边）
- `eliteCombatChance`：战斗事件中精英战斗概率
- `encounters.normal/elite`：波次、每波数量、monsterComposition/tierWeights（池见第 4 节）
- `grid.rows/startRows`：行数与起始路线（startRows 长度=起始路线数）
- `bossEncounter`（可选）：独立 Boss 遭遇。存在则 `_enterBoss` 自动走普通战斗流程副本（不再按地牢名硬编码分支）；`monsterComposition` 支持 `{ lord: N }`（lord 池=rank 领主，跨 family）；缺省走 BossRewardSystem 专属 Boss（集合体）
- `eliteChestReward`（可选）：精英宝箱奖励
- `floor`（可选）：`{ tiles: [贴图键...], glow: false, overlapX, overlapY }`——地砖**每格随机选图 + 随机 X/Y 镜像（4 种朝向）**，平铺层统一行为，无需声明（2026-07-25 确认：以后地砖默认都带随机翻转）；**自然材质（草地等）必配 overlapX/overlapY（如 6/3）**：平铺步进内缩让相邻砖叠合几 px（只叠不缺），盖住锯齿边缘缝隙与半透明暗边——亮色材质缝隙明显，黑砖类可不加
- 分阶段只交付地图生成时，尚未制作的怪物/Boss不得写不存在的工厂键；可以临时让 `encounters` 与 `bossEncounter` 的 `poolKeys` 复用一个已登记怪物作为占位，并在同批文档/CHANGELOG明确“非正式生态”。占位Boss必须仍声明 `bossEncounter`，避免缺省后误入通用集合体Boss；正式怪物完成后再整体替换池与阶级匹配规则。

#### 3. 登记映射（src/config/dungeon-config.js `_keyFor`）
地牢 type → 配置块键。**这是唯一的代码硬编码点**（工作流保留）。

- 雪原三级固定登记为 `frozenBeginner → frozenDungeonBeginner`（C）、`frozenMid → frozenDungeonMid`（B）、`frozen → frozenDungeon`（A）；经验系统的 `DUNGEON_BLOCK_KEY` 与加载图类型数组必须同步，避免生成配置生效但经验预算或加载表现回退到其他地牢。

#### 4. 怪物池（src/world/zombie-dungeon.js `monsterPool`）
normal/elite/lord 三个 getter，按 family+rank 从 enemy-config.json 筛；新怪物需先注册 `ZOMBIE_FACTORY_MAP` + create 工厂。事件/奖励对应关系由 grade 驱动（见 dungeon-event-definitions.js RESTRICTED_EVENT_META 的 scope/grade）。

- `encounter.poolKeys` 是遭遇级白名单，缺省保持旧版“白名单内跨阶级随机”语义；需要让同一白名单按波次槽位匹配阶级时，显式声明 `matchPoolRanks: true`。
- 阶级匹配口径以双份 `enemy-config.json#<key>.rank` 为真源：normal 槽排除 `elite/lord/boss`，elite、lord、boss 槽只接受同名 rank。普通、精英、领主工厂仍必须全部登记到 `ZOMBIE_FACTORY_MAP`，不能只写配置键。
- 某槽位在白名单内找不到对应阶级时会继续走 `poolFamily` / 默认池兜底；因此启用 `matchPoolRanks` 的遭遇必须覆盖 `waveComposition`、`monsterComposition` 实际使用的每一种阶级，否则会漏入白名单外怪物。修改后同步 `data/`、`public/data/`，并让 `scripts/generate-dungeons-table.mjs` 输出真实分池，避免总表仍显示扁平白名单。
- **只允许指定地牢抽取的怪物**：怪物配置写 `poolWhitelistOnly:true`，并在通用 normal/elite/lord getter、family 回退和阶级缺口回退三条路径都排除该键；目标地牢通过显式 `poolKeys` 加入，配合 `matchPoolRanks:true` 只占自身 rank 槽。`forceMonsters` 是明确事件注入，不受普通池限制；`poolKeys` 不能绕过 `noPool`。
- **首领绑定的全场唯一生成器**：矿洞/巢穴等结构本体继续 `noPool`，由首领工厂注入生成工厂；首领更新时先查全场现存同类结构，再通过墙体安全召唤器创建 1 个并把“已解决”锁存。多首领共享这一个结构，最后一名首领死亡才清除；玩家提前摧毁后不自动补建，避免无限刷新。
- **地牢怪物登记与按波加载合同（2026-08-29）**：所有地牢入场统一调用 `resolveDungeonEnemyPreloadTypes()`，它以 `DungeonConfig.getDungeonEnemyPreloadTypes()` 的 `encounters.normal/elite`、`bossEncounter.poolKeys` 与显式 `enemyPreloadTypes` 为基础，再自动合并实际刷怪会使用的家族回退池、等级匹配缺口、当前 scope/等级可抽到的事件强制怪、D 级以上时空特工入侵、无独立 `bossEncounter` 时的通用 Boss，以及墓碑/矿洞/巫婆等伴生与召唤链。`ExpeditionSystem.depart()` 在扣钥匙和清主场景之前只以 `validateEnemyTypes(required:true)` 校验全生态登记完整性，禁止一次性上传并 pin 全部候选怪物；`DungeonMapSystem` 取得实际波次工厂后，必须先将其反查为类型、用 `expandDungeonEnemyDependencies()` 补齐伴生/召唤闭包，再 `setDungeonEnemyTypes()` + `prefetchEnemyTypes(required:true)`，加载成功后才允许实例化。加载期间不能把空怪数组判作清场，失败不得生成 `enemy_circle` 占位怪，并需提供重试或保留背包退出；返回路线图或 `shutdown()` 时解除波次驻留。新增无法由上述规则推导的自定义生成源时，才把额外怪物写入地牢配置 `enemyPreloadTypes`。

#### 5. 验证
JSON 校验；lint / vite build / test-collider / test-craft-sync；`node scripts/generate-dungeons-table.mjs` 刷新 dungeons-table.md；CHANGELOG 记录。

---

### 地牢场景构建标准工作流（2026-07-25 定稿，全套实战经验）

本节是**经过验证的完整流程**——新地牢场景一律按此开展，含菱形地块、墙体、夹角、地板-墙连接、门口、透视遮挡全套。

#### 一、菱形房间模板
1. **尺寸**：固定档位（2026-07-25 起不再随机）：普通 1024 / 精英 1792 / Boss 2048，地牢级 `combatRoom` 子配置可覆盖（如高级 bossSize=1024）→ `rx = 1.2S`、`ry = rx × 0.5774`（30°），边距 M=260（≥墙贴图高度 217 + 缓冲，否则上夹角被世界顶裁掉），菱形在世界正中央，区外全黑
2. **地板烘焙** `applyDiamondFloor(worldW, worldH, cx, cy, rx, ry)`（dungeon-floor-texture.js）：纯黑底 → 等距平铺按菱形路径裁剪 → **墙脚接触阴影（统一标准，2026-07-25 升级）**：沿菱形边缘向内 64px 真渐变黑带（逐笔 alpha 0.40×(1-i/64) 递减描边叠加，墙根 ≈40% 黑 → 0）——**所有墙壁-地板衔接处一律用此处理**。旧版是 16 笔等 alpha(0.12) 平刷（整带仅 ≈15% 平黑），亮地砖上几乎不可见（中级/初级"没有阴影"的根因：blackbrick-7/8 亮度 ≈50 是高级砖 ≈25 的两倍）
3. **地板配置分级**：`setDungeonFloorProfile` 按地牢类型设置（高级 blackbrick_7/8、初级/中级各自 tiles）；需要地砖的场景（如门外白区）读 `getDungeonFloorProfile()` 跟随当前地牢

#### 二、墙体构建 `WallSystem.buildIsoDiamondWalls(cx, cy, rx, ry)`
1. 四顶点转角**点对点**（两臂各一件直墙）+ 四边**定长瓦片续接**（`faceLen` 固定，不足靠叠合，**绝不压扁**——压扁会让小房间边墙比夹角矮一截）
2. 深度规则：**后墙（室内侧朝镜头）depth = min 底边 y，前墙（室外侧朝镜头）depth = max 底边 y**；转角臂统一 **+5 偏置**（顶点侧盖住续接件，预制转角同款规则；+260 曾误挡顶点下方高个实体已废弃，+5 为安全值不得加大）
3. 碰撞：`rebuildIsoCollision()` → `isoSegments` 线段模型（点-线段距离场，移动/滑动用）+ 36×20 阶梯矩形（寻路/小地图用）；滑动走**沿墙切向分量**（速度不超意图，杜绝贴墙加速滑行；旧"切向传送脱困"块是加速根因，已删）
4. 玩家入场：随机顶点内法线方向（off = offsetFromEdge + 60）；怪物：对角顶点附近拒绝采样（菱形内缩不等式 `|dx|/(rx-i) + |dy|/(ry-i) <= 1`）；出口：门闸（见四）

#### 三、夹角构建（上/下/左/右）
1. **原则：夹角不出 AI 素材，基底直墙拼装**——顶点处两臂各一件（按走向选 flipX：右下 "\" 不翻转、左下 "/" 翻转），续接件 8px 叠合（只叠不缺）
2. 透视深度：**整体 下>左>右>上**；夹角内**朝下的臂（更靠近镜头）depth 更大**
3. 生成脚本 `tools/gen-corner-prefabs.mjs`（从基准件读缩放保持全套一致）→ 写入 wall-prefabs.json
4. **废弃方案记录（别再走）**：顶点后冲过冲（错位）、墙柱/补丁填充（不成熟）、AI 转角贴图（规格不齐）

#### 四、门口（门闸）系统
1. **素材管线** `tools/door-video-frames.py`：视频按可用时长均匀取 16 帧 → 边界洪水抠图（白底/棋盘底）+ 水印区抹除 + **门洞封闭区二次抠图**（栏杆包围的亮区洪水填充进不去，阈值去底）→ 16 帧统一包围盒对齐 → 打包 spritesheet；首帧=关闭、末帧=打开。**显示比例对整体缩放是不变量**（640/2048 截帧拼接表现相同，不要追求大规格）
2. **几何注册** `ISO_WALL_GEO.gate`：base（底边线，**只拟合两侧墙身，避开门洞区**——门框架会拉偏拟合线）、gateX（门洞 x 范围）、frames
3. **门闸实体**（wall-gate.js）：状态机 open/closed/opening/closing（**动画用 Phaser tween 计数器驱动，禁止手动逐帧 tick**——手动驱动链路易断，动画卡死）；碰撞 = **门两侧墙体线段常开 + 门洞线段按状态启停**；**原位替换**（继承被替换件 span 与 depth，不做任何接缝特权/过门退层——这些方案全部试过并废弃）；悬停金色轮廓（全 16 帧拱门区剪影×shadowBlur 烘焙，**本体 destination-out 抹除只留外发光**，跟随当前帧）；**斜接遮盖位继承（2026-07-25）：转角两臂同 depth，默认构建里后建的臂盖住先建臂的端边——门闸替换先建臂（下夹角 bL/上夹角 tL，平局按数组顺序必中先建臂）时必须 depth-0.1 退到兄弟臂下面，否则门闸贴图的裁切边暴露在斜接缝上。依据：用户手工预设（门墙 depth 最低、右臂最高）严丝合缝，几何与代码生成完全一致，差的就是这层顺序**；`_setupGate` 仍需先 `_syncWallsToPhaser()` 后 `placeAt`（防门闸被整批重建的墙件压住）
4. **门外独立地块**：入场即生成（战斗完成不等）；位置 = 门洞中心沿外法线出界 + 边距（**不做晶格吸附**，防拽回主场景）；烘焙 = 当前地牢地砖 → **裁掉菱形内部分**（destination-out 菱形路径，不重叠）→ 远角径向圆滑淡出 → 25% 延伸；轮廓环绕光晕只留外侧（朝门一侧渐隐擦除）；图层归地形层（-999）
5. **回城触发**：玩家在白区内**且已走出菱形边界**（点-in-菱形 false）→ `_leaveCombatViaPortal()`；出口传送门已删
6. **世界单格墙、格心通道与长门（2026-08-23，2026-08-27 扩展）**：`combatRoom.wallConstruction:"worldBlock1x1"`
   使用 `2 × gridEdgeRadius` 个网格中心覆盖每条边，四个顶点各只生成一块墙；偶数边长让中央6格门洞
   的两个端点也落在格心。门端墙块只保留朝实体墙一侧的半段碰撞，多房通道首末格与这两个门端墙块
   共享，中间按整数个128×64格心铺墙，禁止半格错位、缩短墙块或另加封口瓦。通道地板四角直接取
   两端门洞端点，与房间菱形地板在真实边线上做并集；每条通道两端各建一扇同跨度功能门。
   `frozen_gate` 是 4×4、单帧
   640×640 的16帧冰锥门，帧0完全升起、帧15沉入地面；`ISO_WALL_GEO.frozen_gate` 的 `base/gateX`
   必须与 `tools/ai-gen/frozen-icicle-gate-geometry.json` 一致，正式贴图由
   `tools/ai-gen/build-frozen-icicle-gate.py` 确定性重建。该长门运行时必须把同一帧按门线等分裁成
   浅/中/深三段，各自以段底边 `maxY+3.9` 排序（同线冰墙为 `maxY+4`），遮挡面线缓存也按三段注册；
   禁止恢复整门单一中心 depth，否则浅端长门会覆盖相邻墙块。各地牢继续使用自己的
   `ISO_WALL_STYLES.block/gate`；门体用 `depthSlices` 配置浅/中/深切片，禁止横向拉伸普通拱门填满6格门洞。
   布局必须走 `computeGridMazeLayout`，`passageCells` 是门边到门边的整数格心距离；末房宝箱事件传
   `openArena:true`，只生成宝箱、倒计时和排除区，禁止再套用含 `frozen_straight` 的历史宝箱房预制。
7. **僵尸地牢单格黑砖标准（2026-08-27）**：初/中/高级僵尸配置统一
   `wallConstruction:"worldBlock1x1" + gateCells:6 + passageCells:8 + wallStyle:"zombie"`；
   `ISO_WALL_STYLES.zombie.block="zombie_block"`，普通房、精英房、整数格通道和高级集合体 Boss 房必须全部走
   `_appendWorldBlockRoomWalls`，不得回退 `buildIsoDiamondWalls` 连续墙。高级 Boss 的玩家从 RB 门内侧生成，Boss
   在 LT 对侧生成；`BossRewardSystem.cleanup()` 必须归还 `_roomConstruction/_gridGateSpan/_gridEdgeCells/_gridGateCells`，
   防止下一场继承单格门洞上下文。
   末房宝箱使用 `appendWorldBlockTreasureRoom()` 在房间中心追加 **12格边长黑砖实体房 + RB 六格独立闸门**；
   宝箱门归 `ChestRoomSystem` 自己管理，不能复用全局 `WallGate`（全局实例已被末房出口占用）。门资源失败时回填
   `opening.fillPieces` 保证闭环；刷怪排除区覆盖整个宝箱房；奖励、60秒倒计时和超时不开门状态机保持原合同。
   冰封世界仍传 `openArena:true`，不要套用僵尸实体宝箱房。
8. **僵尸墙 V4 素材真源与清理边界（2026-08-27）**：运行时成品是
   `assets/terrain/zombie_wall_block.png` 与 `zombie_gate.png`；生成口径固定
   `world122-building-v4 + flux2-klein-4b-depth + 结构3张(12步) + 精修2张(48步)`。
   `_zombie_dungeon_walls_v4_20260827/` 保存候选证据与最终清单；
   `_zombie_dungeon_walls_20260826/` 虽为早期目录名，但其中 Blender 模型、`geometry.json`、墙体基模、门框/栏杆
   mask 和 depth 控制图仍是 `finalize-zombie-dungeon-wall-v4.py` 的正式输入，**不得整目录当废案删除**。
   可清理项仅限 `.blend1`、临时缓存等确定性备份；结构/精修候选、选中元数据、控制图与预览属于可复现证据。
9. **僵尸六格门口墙柱/栅栏/图层合同（2026-08-27）**：和冰封门一样，门洞端点保留普通
   `zombie_wall_block` 作为两侧匹配墙柱；`zombie_gate` 只含移动铁栅，禁止再把独立石门柱、石横梁或墙延伸烘焙进门贴图。
   铁栅固定13根竖栏、3道横梁、13枚四棱闸刺；每枚尖刺必须宽肩向上咬合竖栏、由独立锻造套箍锁接、尖端精确触及门底线，禁止恢复成宽端朝地、悬空越过底线的倒锥吊坠。三道横梁交点和端部保留铆钉/箍件，不能退化为无连接细节的基础方条。底线/门洞统一 `base=face=gateX: [32,300]→[608,588]`，精确映射六格跨度；
   闭合有效高 `225.7447px`，不得恢复比墙顶明显更高的旧门框比例。`depthSlices:3` 必须由竞技场门、全局 `WallGate`、
   `ChestRoomSystem` 独立门同时消费，门体/金色轮廓/X光遮挡面线/结构遮挡缓存都逐段以 `maxY+3.9` 排序；墙柱为
   `maxY+4`。离线总览也必须按同一分段规则合成，禁止用整门单一中心 depth 伪验收。

10. **双轴门的源图裁片合同（2026-08-30）**：`LT/RB`（左上/右下）门按几何水平镜像时，
    不得在切片精灵上直接组合`flipX:true + setCrop(原图列)`；Phaser 4会把crop UV取图列翻到另一端，
    同时镜像quad，导致图像与本段底线/depth错配。三条功能门路径和门轮廓统一调用
    `gate-visual-state.js:bindGateSourceCrop`，将精灵镜像转换为负`scaleX + flipX:false`，
    保持中心原点和源图列不变，每次`setFrame`后重新计算crop UV；逻辑`piece.flipX`、门端锚、
    碰撞线和运动不变。启用`tuckEndSlices`时轮廓只比门体高0.05，避免旧+0.5越过端墙。
    普通未切片门不改。离线先裁原图再镜像整画布与该合同等价，但不能覆盖引擎渲染问题，
    不得据离线预览宣布实机方向正确。
11. **矿洞独立门叶的完整显隐合同（2026-08-30）**：仅`abandoned_mine_gate.leafMotion`启用完整帧0的刚性升降，
    不再播放被640画布上缘裁断的历史帧1～15。`bindGateSourceCrop`之后绑定`bindGateLeafMotion`，
    按原Blender16个`liftPixels`关键位移插值，只移动门体/轮廓精灵Y；逻辑底线、六段depth、端片退层和碰撞不动。
    总时长仍900ms：关闭先在完全升起位置淡入180ms，再下落720ms；开启先升起720ms，再淡出180ms。
    `_gateVisualFrame`保存连续逻辑进度，实际纹理帧始终0；轮廓同步必须读逻辑进度，不能读`frame.name`，
    避免每帧把高亮拉回地面。中途反向沿当前进度返回；竞技场入口/通道、全局出口和独立宝箱门共用实现。
    `hideWhenOpen`仅在alpha归零后隐藏，不另建淡化tween；离场沿现有动画计数器清理。其它门保留原离散帧。

#### 五、透视遮挡（X 光圆圈）
1. 判定（几何法，不用包围盒）：墙件 depth > 实体 depth 且**脚底在墙面底边线之后 + 身体进入墙面覆盖带（覆盖量 > 身体 15%）**；遮挡物 = iso 墙件 + 门闸统一列表
2. 三层：地板透视洞（动态 CanvasTexture 抠烘焙地板、径向渐隐）→ 圆环（中间透明、边缘黑→透明渐变）→ 实体克隆（玩家含武器/副手/盾牌）
3. **接缝防半遮**：触发后按圆覆盖范围内所有墙件（全包围盒）的最高 depth 绘制
4. 禁用 Phaser 4 蒙版（BitmapMask 已删除，Filter 通道太贵）

#### 六、备份与恢复
战斗房/Boss 房进入前必须备份 `WallSystem.walls + isoVisuals`，离开时恢复（否则战斗房的墙残留到主神空间）
- **离开清理还必须含 X 光透视对象**（2026-07-25）：X 光圈/克隆/地板洞是独立 sprite 不属于任何显示组，地图模式分支跳过 `_syncXRayCircles` 导致战斗残留透视定格在地图界面（"透视到地图里的金币"根因）——`cleanupGate`/`BossRewardSystem.cleanup` 统一调 `GameScene._purgeXRayCircles()`，地图模式分支每帧兜底隐藏

#### 七、战斗房尺寸（2026-07-25 起，固定档位，不再随机）
- 全局（`data/dungeon-config.json` → `combatRoom`）：**普通 1024 / 精英 1792 / Boss 2048**
- **地牢级覆盖**：地牢配置块内加 `combatRoom` 子对象即可（如 `zombieDungeon.combatRoom.bossSize=1024`＝僵尸地牢高级 Boss 房 1024）；`DungeonConfig.getCombatRoomConfig(dungeonType)` 三级合并（DEFAULTS←全局←地牢级）
- 调用点：精英/普通由 `_enterCombat` 按 `node.isElite` 传 `options.roomSize`；波次 Boss（初/中级 `bossEncounter`）由 `_enterBossCombat` 传 bossSize；集合体 Boss（高级）由 `enterBossBattle(player, cb, dungeonType)` 第三参透传到 boss-reward 的 `arena.size` getter
- 入侵战场地尺寸独立（`AgentInvasionSystem.getArenaSize()`），不受此规则影响

#### 八、宝箱房系统（2026-07-25，精英战斗专属，`src/world/chest-room-system.js`）
1. **生成分流**：连续墙地牢仍按墙壁预制「宝箱房」（门墙×1+直墙×3，data/wall-prefabs.json）在场地中央拼小菱形房——**几何中心=全部件 face 线段端点外接框中心**；冰封单格墙竞技场传 `openArena:true`，只建开放宝箱点；僵尸单格墙竞技场传 `worldBlockRoom`，在末房中央生成12格边长实体黑砖房。三条路径都必须注册刷怪排除区并复用同一奖励/倒计时状态机。
2. **门墙独立控制**：不进 isoVisuals——复刻 wall-gate placeAt 映射放 wall_gate 帧0（关门），碰撞=两侧常开+门洞启停；`onCombatComplete` 且未超时 → tween 播 0→15 帧开门 + 门洞碰撞移除
3. **等级宝箱**：宝箱等级=地牢 grade（F/E/D/C/B/A），视觉统一使用 `chest_closed` / `chest_opened` 双状态贴图，grade 只驱动奖励表=`combat-formulas.json universalEventRewards.treasureChest[grade]`。竞技场宝箱房每箱必得该档强化石+改造券，另掷 50% 金币 / 25% 粉尘 / 25% 宝箱怪位（**宝箱怪位当前按金币兜底**）；随机事件宝箱仍按自身互斥结果处理
4. **60s 倒计时**：Phaser text（**改色用 setBackgroundColor/setColor，禁用 setStyle——会整体覆盖丢失字号字体**）；白底黑字黑框（矩形垫底），≤10s 红底黑字；超时→宝箱 1s 淡出、房门不再开
5. **开箱**：玩家靠近120px → 同一 Sprite 先用140ms淡出 `chest_closed`，切换 `chest_opened` 后用260ms淡入，并播放 `chest_open.mp3`；两个状态固定512×512方形画布，但必须按实体底座而非整幅 Alpha 外框归一：闭合态底座跨度408px、显示宽192px、origin(0.5,0.75)，开启态底座跨度325px、显示宽241px、origin(0.5,0.78015)，两态可见底边相对逻辑点均为约26.625px。禁止为追求同一画布宽度而让开启态箱体缩小；过渡不得创建未登记的第二个 Sprite，`cleanup()` 必须停止当前 `openAnim` 后再销毁宝箱，避免离场残留。
6. **离场守卫**：`hasUnopenedLoot()` 时走出大门白区 → 弹确认框（是=正常离场 / 否=退回场内 160px+1s 冷却防连发）
7. **已删旧制**：击杀精英刷 DungeonChest 靠近自开流程（dungeon-chest.js 已删）、`eliteChestReward` 配置（出征面板文案改读 treasureChest 表）；**F 级地牢岔路战斗固定普通**（zombie-dungeon.js 岔路 eliteChance 按 grade 判定，F=0）
8. **清理**：`CombatRoomSystem.cleanupGate` 统一调 `ChestRoomSystem.cleanup()`（门墙/宝箱/倒计时销毁 + 门洞碰撞段移除；直墙件随 `_restoreSceneState` 自动还原）
9. **门墙深度（2026-07-30 修复）**：`_placeGate` 深度 = **max(min(底边 y) − 显示墙高, gA 上端邻墙深度 + 0.1)**，不沿用预制保存值——宝箱房是低矮装饰围墙，实体应恒画在墙上；预制值（≈min 底边+5）下门墙贴图比直墙高，门区实体（脚线 3950~4101）会进入门框覆盖带被盖住（"门墙左侧挡实体、右边正常"根因：右侧直墙贴图矮够不着实体）。**邻墙搜索容差必须 40px**（预制手摆端点有 ~25px 间隙，2px 精确共享取不到 → 上墙裁切边压门墙的第二轮 bug）；只拉 gA 上端邻墙，gB 右侧"右件盖门墙"手调规则不动。X 光 occluders 在门打开后必须剔除门洞段（`cg.open ? [] : [cg.gateSeg]`），否则开门后门洞仍当墙透视

#### 九、地牢金币收益审计边界（2026-08-24）

- 主动地牢金币的唯一数值源是 `data/combat-formulas.json#dungeonRewards`；怪物倍率、战斗节点清剿奖、
  Boss奖与通关基础奖必须按同一等级读取，宝箱成长继续由 `universalEventRewards.treasureChest` 管理。
- Boss奖与通关卡牌金币不得直接忽略 `GoldManager.addGold()` 的失败结果：统一按“玩家背包 → 主神空间仓库”
  路由并显示真实入库位置。Boss战两处存储都满时，余量保留为场内金币掉落；通关卡牌在写入前必须核验
  背包+仓库总容量，容量不足不改变卡牌选择、不发部分奖励，也不推进胜利结算。
- 奖励节点清理必须同时停止关闭轮询、恢复临时卡牌并关闭 `RewardSystem`；死亡、异常切场或
  `DungeonMapSystem.shutdown()` 之后不得残留 `_isOpen` 或全屏 `#rewardPanel`。奖励面板打开失败时回路线图，
  保留奖励节点供重新进入，禁止把 `_isShowingReward` 永久卡住。
- 审计不能只看Boss或通关卡牌，必须按真实路线汇总普通战、精英战、怪物掉落、Boss、宝箱与通关奖，
  再与同时间窗的银行等被动收益比较；目标是主动探索显著高于纯挂机，而不是只让单项数字看起来更大。
- B/A级内容未完成前不得预设后期金币消耗项目、毕业总价或回收次数。待其路线、房间、怪物、Boss、
  宝箱和失败成本稳定后，用实际完整通关样本重新审计，并在确认结论后再改配置与沉淀规则。
10. **尸体清理（2026-07-30）**：`cleanupRoom`（离场拆房）**不跳过存活尸体**——地牢 map 状态实体更新暂停（game.js 地图分支早退），尸体计时器冻结，保留的尸体贴图会被带进下一场战斗房；`isPreservedCorpse` 跳过只用于 `cleanupMonstersOnly`（波次间同房保留，腐蚀光环继续生效）

---

### 墙体添加标准工作流（独立流程，新墙类素材/墙件一律按此开展；2026-08-28 补齐墙/门独立建模门禁）

#### 零、墙体与功能门独立建模门禁

1. 新地牢先确定连续墙 `buildIsoDiamondWalls` 或单格墙 `wallConstruction:"worldBlock1x1"`，再锁定 `footprint/groundCenter/display/halfThick`、2:1 等距相机与四角共享规则；禁止先生成完整房间图再裁墙、门和地板。
2. 墙与功能门必须是两套独立结构资产。门再拆为静态门柱/门框与可动门叶；单格墙默认由门洞两端同款墙块兼任门柱，门帧不得烘焙侧墙、地板或完整房间。
3. “建模”必须有可编辑 `.blend`（墙/门分 collection 或 object）或可完整重建轮廓和运动的确定性几何脚本。ImageGen 位图、抠图、裁切、仿射和逐帧平移只算二维贴图加工；复用既有结构时必须明确写“结构复用 + 新材质”。
4. AI 只负责受 Depth/Alpha 控制的材质与局部细化；相机、墙脚、墙高、门底线、门洞跨度、杆件数量和运动轨迹由结构真源决定，最终化必须恢复原轮廓与落位。
5. 升降门 16 帧必须来自真实门叶组件运动或确定性参数重建，帧 0 完全关闭、帧 15 完全打开；`base/face/gateX/frames/halfThick/depthSlices` 与 geometry JSON 同源，并精确映射 `gateCells`。
6. 正式交付至少保留模型/重建脚本、geometry/manifest、Depth、Alpha、门帧、运行时 PNG/spritesheet，以及按运行时锚点、缩放和分层数学生成的重复墙、墙-门-墙、双臂转角拼接证据。
7. `BootScene`、`ISO_WALL_GEO`、`ISO_WALL_STYLES.block(s)/gate`、`wallConstruction/gateCells/passageCells` 必须同源；地板始终走独立连续层，不得烘进墙门。
8. 多款 1×1 墙可按格坐标稳定选款，但必须共享结构核心、锚点、占地与显示尺寸；只允许局部崎岖/木撑/矿脉变化，禁止随机位移、缩放、旋转。只有无方向环境光材质才允许水平镜像。
9. 墙高比较使用 `(groundCenter.y - alphaBBox.top) × displayH/sourceH` 的运行时可见高度，不能拿 1024 源图像素或错误的投影高度直接写 `wallH`。
10. 同组墙必须用同一低频光照真源统一曝光与阴影：主体中位亮度差 ≤0.01、平均亮度差 ≤0.015，并输出数值报告和连续拼接预览。含明确烘焙光向时样式必须禁用水平镜像。

**反推基准**：恐怖地牢是完整 Blender 墙/门叶分离模型；雪原墙是既有 `obstacle_block.png` 结构/Alpha 真源加冰材质，冰锥门由确定性脚本独立构建；废弃矿洞三种 Blender 墙柱共用 1×1 核心和锚点，独立 `AnimatedGateLeaf` 只渲染六格门叶并按门洞格分六层排序。三者都不从“墙+门+地板”整图反向裁运行时部件。

#### 一、素材管线（贴图进项目前必过）
1. **抠图**：纯色/棋盘底用**边界洪水填充**（不误伤主体砖缝亮灰）；水印/描边用 alpha 阈值清零或定点抹除
2. **几何锚点实测**（写入 `ISO_WALL_GEO`，贴图像素空间）：
   - `base`：底边线两端点（全跨度，含端帽）；`face`：正面墙底边跨度（不含端帽，**拼接/碰撞一律用 face**）
   - `vertex`（转角接合点）、`tipX`（臂尖）、`wallH`（底边→顶沿墙高）、`slope`（底边固有斜率）
   - 实测方法：alpha 包围盒 + 列剖面底边/顶边拟合（**拟合区避开特征区**——门洞、拱门会拉偏拟合线）
   - **`editor`：摆墙面板显示名**——带此字段的条目自动出现在摆墙编辑器「标准组件 · 墙壁」栏与图层命名表（wall-editor.js 从 ISO_WALL_GEO 动态生成，新墙/门组件加此字段即自动入面板，无需改编辑器代码）
3. **角度标准**：显示斜率对齐地板线 30°（`FLOOR_SLOPE=0.5774`），角度补偿 `slopeFixOf(geo)` = FLOOR_SLOPE / geo.slope
4. **高度归一化（谨慎）**：仅当贴图顶/底边不平行且需要与直墙对齐时用（`wall-height-normalize.py`，按列绕底边缩放）；**带拱门/突起特征的贴图用 k≥1 变体**（只拉不压，特征区不压缩，参考 `tools/gate-top-warp.py`；"拼接叠合遮盖顶部分歧"方案已被用户否决，禁止再用）

#### 二、拼接规则（血泪教训浓缩）
1. 底边精确映射：独立 sx/sy 把 face 映射到目标线段（base 永远贴合，顶部分歧用叠合吸收）
2. **叠合 8px，只叠不缺**：精确对顶必露缝（锚点拟合公差 ±6px）
3. **瓦片定长定高，不足靠叠合，绝不压扁**（小房间边墙矮一截的根因）
4. 长边覆盖：接缝阵列（编辑器标记A→生成/铺满）
5. 同水平对齐：同一条边上的件必须同 scale（拼接吸附继承 A 的 scale/flip）

#### 三、夹角拼接
1. 基底两件点对点（见地牢工作流三）；顶点缝隙接受或用编辑器微调，**不做填充**
2. 深度：整体 下>左>右>上；夹角内朝下的臂在上层

#### 四、图层规则
1. 后墙 min、前墙 max（单 depth 斜墙必有误差区，规则只决定误差放哪侧）
2. 转角与续接件的接缝：顶点侧盖住下侧（预制转角 +5 偏置即可，**不要加大偏置**——会误挡高个实体）
3. 特征件（门闸等）：**原位替换**，不做特权
4. 实体排序：实体 depth = 脚底 y + 10；判定遮挡看脚底与墙底边关系，不看包围盒
5. **遮挡透视（新墙类必做项）**：X 光透视由 `ISO_WALL_GEO` 驱动——geo 注册（base/face/wallH 实测准确）后 isoVisuals 墙件自动纳入 occluders；门闸由 `WallGate`（placeAt 锁定样式几何）与宝箱房门（GameScene occluders 显式纳入）覆盖。**验证必做**：玩家/怪物站到墙后应出现透视圆圈+贴图克隆；门贴图必须是 spritesheet 且 `geo.frames` 正确

#### 五、关键陷阱（每条都踩过）
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

### 墙壁系统（2026-07-24 重构：可视化编辑器 + 预制组合）

**核心思路**：墙壁/场景布置不再靠代码盲推贴图几何——通用件模型 + 游戏内可视化编辑器（所见即所得），摆好的布局存为**预制组合**，场景按预制渲染；后续地牢随机生成预制房间 + 镜像翻转复用同一格式。

#### 通用件模型（wall-system.js）
- 件结构：`{ tex, x, y, scaleX, scaleY, flipX, flipY, depth }`（origin 固定 0.5,0.5），存 `WallSystem.isoVisuals`，`_placeIsoPiece` 直接渲染并回写 `p._sprite`
- 碰撞自动生成：`rebuildIsoCollision()` 按件底边线段（`texPointToWorld` 应用 scale/flip 变换）每 30px 一块 36×20 阶梯矩形（`_iso` 标记，混 `WallSystem.walls`，寻路/小地图自动兼容）；编辑后重建即可
- 贴图几何锚点 `ISO_WALL_GEO`（base 全跨度/**face 正面墙跨度(不含端帽)**/vertex/tipX/wallH，贴图像素空间）仅供：默认布局生成 + 碰撞底边提取；**拼接吸附与碰撞一律用 face**（端帽互相重叠藏进相邻件体内，接缝呈壁柱观感）

#### 常见陷阱：flipX 镜像锚点（本次大错乱根因）
- Phaser flipX 是 **quad 不动、贴图内容镜像**（翻转 UV，不改顶点）：origin(0,0) 时贴图点 p.x 落在 `x0 + (w - p.x) * sx`
- 错误写法 `x0 = A.x - (w - p1.x)*sx` 会让 flip 瓦片整体偏移一个瓦宽（游戏内"断断续续"的直接原因）
- 正确：`x0 = A.x - (w - p0.x)*sx; y0 = A.y - p0.y*sy`（flip 时 p0→A、p1→B）；**凡写 flip 锚点公式，先用单件底边线段数值自检再上图**

#### 素材管线（tools/wall-asset-prep.py）
- 源图：`素材库/场景/地形/僵尸地牢/` wall-2.png + wall-转角上/下/左/右.png
- 处理：alpha<80 清零（去 faint 描边/AI 水印）+ 内容包围盒裁剪 + 最长边 1600 压缩（optimize）；**不做列裁剪**（主体保持原样，端帽/渐隐尾保留，用户手动拼合）
- **高度归一化（tools/wall-height-normalize.py）**：AI 素材常带轻微真透视（顶/底边不平行），按列绕底边纵向缩放使顶边∥底边——否则拼接"底部对齐顶部矮一截"。新直墙/转角一律先过这道
- 产物：`assets/terrain/wall_diag.png` + `wall_corner_top/bottom/left/right.png` + `wall_straight.png`（新直墙，已归一化）；`tools/wall-room-sim.py` 为拼装模拟器（与 JS 同数学，改布局先跑它）

#### 墙壁编辑器（src/ui/wall-editor.js，HUD 左下「摆墙」按钮）
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

#### 预制组合库（src/world/wall-prefabs.js → data/wall-prefabs.json）
- 结构：`{ "<key>": { name, pieces: [...] } }`；BootScene.create 预载（fetch /data/，即 public/data 副本）
- 保存：Electron 走通用 `save-json`/`load-json` IPC（限 data/ 目录，dev 写 public/data）；**Vite 开发服务器走 `vite.config.js` 的 `__save-json` 中间件（POST，直写 public/data + data/ 双份，刷新即生效）**；纯浏览器无中间件时回退下载
- 主神空间测试房：代码默认菱形房间已移除，用户用编辑器自摆；`_setupMainHubTerrain` 仅在预制 `hub_diamond` 存在时按预制渲染；编辑器「恢复默认菱形」按钮仍可生成代码默认布局作起点
- **注意**：wall-prefabs.json 也是 data/ ↔ public/data/ 双份，中间件/IPC 保存只写 public/data（dev 运行时读这份）；提交/打包前记得同步回 data/（中间件已双写）

#### 夹角生成（2026-07-24 定论：一图基底流——夹角不出 AI 素材，基底直墙拼装）
- **工作流定论：生图 AI 只出一张直墙基底，其余全部程序化完成**（夹角=基底拼装、吸附/叠合=编辑器、角度/等高=管线归一化）
- 四个夹角 = 基底直墙（wall_straight）2~4 件拼成：顶点处两臂各一件（按方向选 flipX）+ 每臂续接件（`SNAP_OVERLAP` 叠合）
- 透视规则：整体深度 下>左>右>上；夹角内**朝下的臂（更靠近镜头）depth 更大**（顶点在上层）
- 顶点缝隙：点对点相接接受微小缝隙（过冲方案、墙柱填充方案均已废弃——错位/不成熟），介意时在编辑器里单件微调
- 生成脚本：`tools/gen-corner-prefabs.mjs`（从既有上夹角读缩放保持全套一致）→ 写入 wall-prefabs.json；用户「上夹角」为手工拼装基准件
- 需要新夹角规格时改脚本顶点/臂长重跑即可，不要再走 AI 出图

#### 墙壁与实体透视关系（2026-07-24）
- **墙件 depth 规则**：后墙（室内一侧朝镜头，如上夹角两臂、左右夹角的上臂）depth = **min 底边 y**——室内实体（footY 沿墙处处更大）永远绘制在墙前，修复"右臂错误遮挡人物"；前墙（室外一侧朝镜头，如下夹角两臂、左右夹角的下臂）depth = **max 底边 y**——正确遮挡室内。单 depth 对角墙必有误差区，规则只决定误差放哪侧
- **X 光圆圈**（GameScene `_syncXRayCircles`，每帧）：墙件 depth > 实体 depth 且**几何遮挡判定**（脚底在墙面底边线之后且身体进入墙面覆盖带，覆盖量 > 身体 15% 才算被遮挡——不用包围盒，斜墙 AABB 一半是空的必提前触发）→ 三层：①**地板透视洞**（动态 CanvasTexture，每帧从烘焙地板 `Renderer.terrainTexture` 抠实体为中心 192×192 区域，径向 destination-in 渐隐，盖在墙上相当于挖洞）②**圆环**（中间全透明、边缘黑→透明渐变）③实体贴图克隆（alpha 0.9，**玩家含武器/副手/盾牌克隆**）；**接缝防半遮：触发后按圆覆盖范围内所有墙件（全包围盒）的最高 depth 绘制**；脱离遮挡自动隐藏，实体移除自动销毁纹理与贴图；地图模式不启用。**注意：Phaser 4 已删除 BitmapMask（createBitmapMask 不存在），WebGL 下蒙版只有 Filter 通道（per-object render pass，贵）——遮挡透视走"抠地板盖墙+圆环+贴图克隆"轻量方案，不用蒙版**

#### iso 墙碰撞：线段模型（2026-07-24，修贴墙加速滑行）
- `WallSystem.isoSegments`：`rebuildIsoCollision()` 按件底边生成 `{x1,y1,x2,y2,halfThick:10}` 线段；`canMoveTo` 用点-线段距离场，`blocked` 用线段相交
- `resolve` 滑动顺序：直达 → **沿最近阻挡墙段的切向分量滑动**（速度不超移动意图，杜绝"贴墙突然加速"）→ 轴分解滑动 → 步长回退；旧"切向滑动脱困"块已删除（它是加速根因：每帧侧向传送一个半径）
- 阶梯矩形（36×20/30px）保留给寻路/小地图/静态物理体，不再作为移动滑动依据

#### 门闸系统（2026-07-24，战斗房带门直墙）

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

#### 待接入（下一阶段）
- 地牢随机生成：从预制库抽房间布局放置 + `_mirrorPieces` 镜像
- ~~主神空间边界墙仍是旧硬拉伸视觉~~（2026-07-29 已完成：主神空间菱形化，见下节）
- ~~Boss 场地门闸化~~（2026-07-28 已完成：Boss 房复用 CombatRoomSystem 门闸机制，传送门仅作 placeAt 失败兜底）

#### 主神空间状态缓存（2026-07-30 补齐）
- **机制**：`SceneManager._saveMainSceneState()`（保存 `_mainEntities/_mainPlayerPos/_mainTrees/_mainEffects/_mainCamera`）→ `_loadMainScene` 恢复实体与玩家位置；无缓存时走兜底=只剩光杆玩家。
- **保存时机（2026-08-29 修订）**：①`switchScene` 离开 main 时保存正式快照；②`Game.init` 初始生成完毕后保存安全网；③只有仍在 `main` 现场直接调用出征的兼容路径，`depart()` 才允许在清实体前补存。正常流程已先执行 `main → scene7`，此时再次保存会用出征准备场景的精简实体覆盖主神空间，是“资源失败返回错误空间/只剩光杆玩家”的根因。
- **失败回城合同**：地牢怪物资源失败的无损退出必须先解除 `SceneManager` loading 锁，再调用 `switchScene('main', player, undefined, { forceReload:true })` 并确认场景提交；禁止因 `isLoading` 或当前场景相同而静默短路。
- **教训：所有旁路必须同时核对保存与覆盖**——缺少快照会空城，离开 main 后重复保存同样会污染正确快照；判断依据必须是当前现场是否确实为 `main`，不能仅因为即将清实体就无条件保存。

#### NPC 立绘调整工具（2026-07-30 重构）
- **交互**：点击「调整立绘」后直接拖对话左侧立绘（X/Y 自由拖动）；面板只负责缩放/旋转/镜像/重置/保存。
- **持久化**：`data/npc-portrait-params.json`（保存管道=Electron `save-json` IPC → Vite `__save-json` 双写 → 下载兜底，与 wall-prefabs 同规格）；参数模型 `{x,y,scale,rotation,flipX}`（旧 offsetX/bottom 自动迁移；锚 bottom 按 NPC 默认恢复，不入库）。**rel 必须带 `data/` 前缀**（vite 中间件强制校验，否则必落下载兜底）。
- **关键细节**：拖动期禁用立绘 `transition: transform 0.3s`（否则拖拽滞后）；立绘 mousedown 必须 stopPropagation（对话框 clickOutside 关闭/画布抢事件）；`WeaponAnimConfig` 解析一律 `animConfigKey || weaponType`（R93 副手误吃 G18 pistol 配置翻转的根因——weaponType 是同族共享，animConfigKey 才是按枪配置键）；**weaponType 分支名单随 animConfigKey 解析同步补齐**（weapon-transform getWeaponSize/getAttackAnimOffset/锚点表——R93 漏补导致错误放大+手臂错位）。

#### 障碍物体系（2026-07-30 新增）
- **素材管线**：AI 道具图（透明底带噪点）→ 最大连通域 + 包围盒 → `assets/terrain/obstacle_*.png`；geo 注册 `ISO_WALL_GEO` 加 `category:'obstacle'` + `foot:{w,d}`（底部 15% 高度区实测 footprint 宽，深≈宽×0.35）。
- **碰撞**：`_addPieceCollision` 障碍物走**矩形 footprint 墙**（锚底边中心、随缩放；`_obstacle` 标记）；`_pieceBaseSegments` 返回空（不进 iso 线段模型）。
- **图层**：障碍物 `depth` 必须取 `getObstacleFootprintRect()` 的前缘，与玩家脚线和建筑占地处于同一世界 Y 空间；旋转件禁止按整张贴图 AABB 最低点排序。地牢预制组合只能用 `0.01` 级偏置稳定同层件顺序，禁止把整组强抬到附近墙体之上，也禁止把编辑器保存的绝对 depth 差平移到新场景——两者都会让障碍物脱离占地位置并错误遮挡玩家。
- **编辑器**：摆墙面板分类页签（墙类/门类/障碍物类，geo 带 editor 自动归类：category→障碍物、gateX→门、其余→墙）；障碍物放置不做 30° 角度补偿（billboard）；Shift+滚轮=旋转（仅障碍物，`rotation` 字段经 `_placeIsoPiece`/`_applyToSprite` 应用）。
- **障碍物编辑器**：仅单选一个障碍物时显示（墙壁编辑器下方）；重置=初始变换；保存=全部障碍物写 `data/obstacle-layout.json`（_persistJson 三管道），`_setupMainHubTerrain` 按布局重建（含首启竞速兜底）。
- **固定 NPC（祭坛/仓库）**：不再用 obstacle 静态墙——`collisionShape:'rect'` 矩形 footprint + `resolveCollisions` 圆-矩形精确分离分支（逆透视压缩判定；圆心在矩形内沿长轴推出）。

#### 主神空间菱形化（2026-07-29 落地，复用地牢标准工作流；**同日已按用户要求回退**，保留条目作参考）
- **回退说明（V0.326）**：菱形世界（5436×3359/双材质地板/代码建墙）用户实机不满意，scene-manager/dungeon-floor-texture git 回退、game-config 手改回退（**npcs.altar 祭坛贴图配置保留**）；`inner` 双材质与 roomSize 机制随之移除。大理石墙/门改为**编辑器组件**路径：新透明底素材（墙.png/门.png）过 `tools/prep-hub-wall-gate.py`（透明底无需 GrabCut：最大连通域+腐蚀1px+几何实测；门洞 gateX 按"列最低不透明 y 高于底边线 60px 的连续区间"实测）→ `ISO_WALL_GEO.hub_straight/hub_gate`（editor 字段自动进摆墙面板）+ `ISO_WALL_STYLES.mainHub.gate='hub_gate'`。
- **尺寸**：S=2048（`mainHub.roomSize`）→ rx=2457.6/ry=1419.0，边距 M=260，世界 5436×3359，origin=(2718,1679)；`_setupMainHubTerrain` 与地牢同路径：`applyDiamondFloor` + `setWallStyle('mainHub')` + `buildIsoDiamondWalls`；边界矩形墙降为 `noVisual` 隐形兜底；hub_diamond 预制分支已删。
- **地板双材质**：`profile.inner = { size, tiles }`（dungeon-floor-texture）——外圈大理石 + 中心 1024 档内圈木地板；`setDungeonFloorProfile` 新字段必须显式透传（deco 教训同款）。
- **墙样式**：`ISO_WALL_GEO.hub_straight`（slope 0.5049 / wallH 703.9）+ `ISO_WALL_STYLES.mainHub`（无 corners/gate → 全直墙无门）；从地牢返回时样式被复位，统一入口每次重设 mainHub 再建墙。
- **坐标迁移**：portals/testArea 等绝对坐标项必须随世界尺寸手迁（本次 (3478,2363)→(3918,1949)）；相对 origin 的（NPC/武器排/掉落）自动跟随。
- **祭坛贴图 NPC**：保留 `npcType:'altar'` 的点击/对话身份，但占地与图层按建筑处理：
  `applyBuildingFootprint(..., 2) + setupStructureDepth()` 接入标准2×2菱形 footprint 和结构拓扑排序；
  禁止为进入建筑图层伪造 `_isDefenseStructure`，否则会错误进入敌方建筑索敌链。`sprite/clickArea/noSeparation`
  等字段仍需由 `game.js` 逐项透传（祭坛此前只传基础字段=实心圆的根因）。
- **2026-08-21 重新菱形化（用户明确要求，对齐世界-122）**：主神空间 4096×4096 方形 → 12288×8192 菱形；
  复用 `_scene8Diamond`/`_registerScene8Boundary` 同一真源，分块地板菱形裁剪区外全黑，硬边界墙改 noVisual 兜底；
  hub_brick 砖池与相机 1.0 保留；坐标统一平移 (+4096,+2048)，`_loadMainScene` 带菱形落点守卫。详见 CHANGELOG 当日条目。

#### 白底 AI 素材抠图（2026-07-29，大理石墙血泪经验）
即梦白底图（含烘焙进 RGB 的假透明棋盘底纹）抠图三坑，正解 = **GrabCut + 盖板几何重建**（`tools/prep-hub-assets.py`）：
1. **固定亮度阈值洪水**吃墙顶亮面（顶沿 230→208 软渐变无暗缝可挡）。
2. **浮动容差洪水**（邻像素比较）从抗锯齿软边漏进墙内，墙内平滑区一旦进入全淹。
3. **Canny 路障**：低阈值被背景噪点触发碎网；必须**先高斯模糊**再 Canny——即便如此软轮廓仍漏。
4. **正解**：sure_bg=边界连通高亮区（>235）+ sure_fg=暗核（<205 最大连通域腐蚀）→ GrabCut 仲裁亮盖板归属；残留盖板坑用**几何重建**填（墙带顶边必为与底边平行的直线：窗格最小顶沿拟合截距、强制斜率=底边、分位数防噪）→ 封闭内洞边界洪水反填。
5. **分位数取偏低**（30）：拟合线宁低勿高——偏高会把棋盘底纹条带填进 alpha。
6. 换素材时优先要**深色底**图源，白底/棋盘底天然难抠。

#### 僵尸地牢菱形房间（2026-07-24 落地）
- **尺寸规则**：原正方形 S（1024~2048 随机、Boss 1024）→ rx=1.2S、ry=rx×0.5774（30°）；**边距 M=260（≥墙贴图高度 190×角度补偿≈217 + 缓冲，否则上夹角被世界顶裁掉）**，菱形在世界正中央，区外全黑
- **地板**：`applyDiamondFloor(worldW, worldH, cx, cy, rx, ry)`（dungeon-floor-texture.js）——黑砖等距平铺按菱形裁剪，区外全黑，边缘黑渐变
- **墙壁**：`WallSystem.buildIsoDiamondWalls(cx, cy, rx, ry)`——基底直墙斜铺：四顶点转角点对点（上=后墙 min、下=前墙 max、左/右=上臂 min 下臂 max；**转角臂统一 +5 深度偏置**——顶点侧盖住续接件，预制转角同款规则；纹理随机的墙若让续接件盖住转角臂，贴图切边会暴露在接缝上（2026-07-25 沼泽柴墙左夹角接缝教训））+ 四边续接（**瓦片定长定高、不足靠叠合，绝不压扁**——否则小房间边墙比夹角矮一截），`rebuildIsoCollision()` 出阶梯碰撞
- **生成点**：玩家从随机顶点的内法线方向入场（off=offsetFromEdge+60）；怪物在对角顶点附近拒绝采样（菱形内缩不等式 `|dx|/(rx-i)+|dy|/(ry-i)<=1`）；出口传送门仍居中
- **Boss 场地**：高级僵尸 `boss-reward-system._setupArena` 已迁移到 `worldBlock1x1` 单格黑砖墙环，RB 六格出口门、玩家在 RB 内侧、集合体在 LT 内侧；只有非单格墙旧地牢才保留连续菱形墙与上下顶点生成规则
- **备份/恢复**：combat-room 与 boss-reward 均备份恢复 `WallSystem.isoVisuals`（否则战斗房墙残留主神空间）

---

### 等距投影素材规范（按场景构建体系选择，禁止跨体系混用）

**World-122建筑/道路与僵尸`worldBlock1x1`单格墙体系的视觉对齐基准 = 2:1（dy/dx=0.5，26.565°）**；
建筑真实 Alpha 接地折线、道路、僵尸黑砖地板、墙块顶面与六格门底线必须遵守同一口径。历史连续墙地牢仍保留
30°（0.5774）视觉合同与`slopeFixOf`补偿，不能因为僵尸地牢修订而全局改写。`PERSPECTIVE_SCALE_Y=0.5`
既是通用碰撞/阴影投影，也是建筑/僵尸单格体系的可见地面口径；在旧30°地牢中它仍只用于不可见计算。
**引擎不是近大远小的透视投影**：角色/怪物/地板全图恒定大小，远近只靠 Y 压缩 + Y 排序遮挡表达——场景素材禁止按远近缩放。

**一句话规则：先看场景构建体系；建筑/僵尸单格墙的地面与顶面走26.565°，旧连续墙地牢走30°，立面始终垂直，影子和碰撞始终按0.5。**

| 物件类型 | 规则 | 例子 |
|---|---|---|
| 沿地面延伸的"线" | 与地板线平行（±30°，斜率 0.5774） | 墙、栅栏、地板纹路、道路、河流、桌台长边 |
| 站立物件 | 立面垂直（billboard）；俯视可见的**顶面**边缘走 ±30° | 柱子、柜子、箱子、树、门、墙柱/端头 |
| 贴地影子/占位 | 2:1 压扁椭圆（跟碰撞投影 0.5，不与地板线对齐也看不出） | 落地阴影、篝火/锅/石块底面 |
| 角色/怪物 | 侧视 billboard，与投影角度无关 | 玩家、现有敌人贴图 |
| NPC（站桩对话/立绘系） | 正面平视 billboard、平底 | 小鼠铁匠/鼠王/侍从、npc_altar（2026-08-06 八版定论） |

### 环境光照与太阳投影（2026-08-18）

- **单位阴影深浅**（2026-08-21）：`DYNAMIC_SHADOW_OPACITY=0.30078125`（0.240625 再 +25%，
  部分单位太淡的用户口径）；静态 `STATIC_SHADOW_OPACITY=0.1925` 不变。个体用
  `shadow.opacity` 覆盖，全局只调 environment-lighting-system.js 顶部两个常量。
- **太阳方向先走世界-122 的 u/v 地面坐标**：`EnvironmentLightingSystem` 内以方位角得
  `sunU/sunV`，再调用 `isoLocalToWorldDelta()` 投到屏幕；**禁止**在 GameScene 再对
  `profile.offsetY` 乘一次 `PERSPECTIVE_SCALE_Y`，否则会二次压扁、方向偏离世界-122 菱形地面。
  日出=屏幕左/影向右，正午=屏幕上/影向下，日落=屏幕右/影向左。
- **尺寸与方向分离**：贴地 footprint 高度仍按 `PERSPECTIVE_SCALE_Y=0.5` 压扁；太阳位移已经
  在 `isoLocalToWorldDelta` 内完成透视投影。散布障碍物的 `getObstacleFootprintRect().h`
  是碰撞世界深度，注册静态影子时必须再乘 0.5。
- **静态投影根部**：仙人掌/雪松随机 `flipX` 要映射到投影的 `flipY`，不得翻转长轴，否则影子
  会反向穿回模型。普通建筑由独立 shadow caster 锚到逻辑脚点并复用最终 `visualFootprint`
  接触面；只有异形/缺配置素材回退主体 alpha，不再让独立道路或地面铺装污染阴影根部。
- **造型分档**：高柱仙人掌用长的 `projection`，多节仙人掌用中等投影，桶状仙人掌用短
  `contact` 阴影；不允许所有障碍物复用一种长影。
- **派生资产入口**：`tools/ai-gen/build-lighting-maps.py` 从原 PNG alpha 确定性生成
  `*_silhouette / *_projection / *_height / *_normal`，清单为
  `data/environment-lighting-assets.json`。不重绘原图；建筑/仙人掌/雪松需要真实轮廓投影时先跑此脚本。
- **动态单位投影已退役**：玩家、敌人、友军、NPC 统一使用水平 2:1 接触影，不再从 Phaser
  当前帧生成 `unit_projection_*`。旧派生纹理与质量分档链不得恢复；显式
  `shadow.directional=true` 只保留短方向尾影协议。
- **建筑锚点不能一刀切（2026-08-23 更新）**：普通格网建筑默认复用
  `resolveStructureGroundFit` 的最终 `visualFootprint` 映射，阴影接触面与实体、建造幽灵、overlay
  共用同一中心和宽深；显式标定优先，缺省时从 `displayW/displayH/footOffsetY` 确定性派生。
  `anchorAdjustX/Y` 不得再进入严格棱柱路径；`flipX` 只镜像最终局部轮廓。只有
  `autoFootprint:true` 异形建筑或显示配置不完整的临时素材才回退主体 alpha 接地区。
  独立道路/地面铺装、碰撞与建造占格不参与阴影采样。个别美术需要独立阴影根部时，在建筑配置写
  `shadowCaster.contactPolygon` 覆盖，不要修改 collision footprint 补视觉阴影。
- **基地投影只取底座**：`defense_base` 是立方体+顶盖+扁平底座；完整 alpha 旋转后会把主体
  投成大块错误阴影。`build-lighting-maps.py` 的 `PROJECTION_BOTTOM_BANDS["defense_base"]=0.20`
  只取贴图底部 20% alpha 生成 `defense_base_projection.png`。大型建筑出现“影子像整个模型/
  脱离底座”时，优先增加该配置，不要先拉长或加深影子。

#### 静态投影算法（2026-08-21：建筑 shadow caster 与建造 footprint 解耦）

> **当前建筑契约（2026-08-23 更新）**：普通建筑不再读取 manifest 剪影，也不把独立道路/地面铺装
> 当阴影真源。`resolveStructureShadowCaster` 优先读取显式 `shadowCaster`，否则复用实体已经采用的
> `visualFootprint` 拟合结果；缺省标定由显示尺寸和脚线确定性派生。只有异形或配置不完整的素材才扫描
> 主体 Sprite 当前 alpha，所有视觉拟合都不可用时才回退 placement footprint；建造与碰撞逻辑完全不改。
> 散布障碍物继续凸包∪manifest 剪影；掩体墙、门、楼梯继续各自的专用纯几何链。

- **普通建筑真源**：优先使用 `shadowCaster.contactPolygon`（相对逻辑脚点的局部坐标），
  其次复用 `visualFootprint` 映射接触面，再次才是主体 alpha 接地拟合，最后走 placement footprint
  兜底。默认高度只取主体 Sprite 最终显示高度，
  不再由 footprint 半径放大。普通建筑默认把真实接地轮廓作为单一棱柱，沿全局唯一太阳向量
  正交平行扫掠：左右终端边必须是平行线，不能分别追随不同高度的屋檐、塔楼或侧翼。
  `resolveStructureAlphaShadowSlices` 仅在配置显式写 `shadowCaster.autoParts:true` 时启用；它会对
  当前 TextureManager 帧做一次最高 384×384 的降采样，按离地高度提取下/中/上横向实体。
  该模式适合明确需要复杂远端轮廓并经过逐建筑验收的特例，不得再作为所有普通建筑的默认值。
  alpha 截面 X 坐标必须用 `groundFit.visualOffsetX + 纹理像素相对 Sprite 中心偏移`
  完整映回逻辑脚点；不能只算 `(pixelX-contactX)×scaleX`，后者会漏掉稳定底座中心校正，
  典型症状就是右侧远端影角斜率不对。
  **上层截面只能信任 alpha 的左右边界**：不能再按截面宽度猜对称 iso 菱形纵深，否则
  人造的前/后顶点会生成额外斜边，把左侧或右侧影角拉歪。自动部件统一使用实测 left/right
  加最小稳定 Y 厚度的薄横截面；接地纵深仍只由 0~24% 的真实 contact polygon 提供。
- **覆盖优先级**：配置了 `shadowCaster.parts[]` 就完全使用显式部件，每层写 `polygon`
  （或 `footprint:'contact'`）与 `baseZ/topZ`；默认是单体平行扫掠，只有显式
  `shadowCaster.autoParts:true` 才启用自动分层造型。`getLayeredShadowPolygon` 负责把自动或
  显式部件分层挤出后合成单一边界。
- **共享结构阴影层**（2026-08-24 性能结构修复）：单个 Graphics、深度读取
  `WORLD_RENDER_LAYERS.STRUCTURE_SHADOW`（当前 −994.4，位于道路和地基之上），每帧汇入全部
  结构阴影多边形。重叠/相贴的 job 先聚簇并集再画，聚簇判定覆盖顶点互含、普通相交和共线相贴；
  并集扫描必须额外保留全部输入顶点所在行，不能用固定 2px 步长吞掉接地角。并集完成后统一调用
  `getShadowFeatherLayers()`：最外层严格保留原尺寸，默认 8px/5 层只向轮廓内部收缩，累计透明度按
  source-over 反解，保证内部仍精确达到原 `shadow.opacity`、边缘平滑淡出且不越过接地边。
  互不相交的簇可保留自己的透明度；禁止质心外扩和居中描边。树木/接触型散布障碍
  也并入此层，但几何必须是**水平 2:1 footprint 沿归一化太阳方向的凸扫掠**，不得旋转基础
  椭圆；每个 caster 只注册不进入 display list 的身份句柄。战争迷雾必须过滤逐实体 job 并触发 revision 重画，
  不能隐藏整层。移动单位仍用独立接触影 Sprite。**运行时纯几何、无烘焙无角度分桶——连续不跳**；共享层
  只在变脏时对最终轮廓执行一次 Earcut，并把结果写成 `fillTriangle` 命令，干净帧禁止继续用
  `fillPoints` 让 Phaser 4 每次 render 重跑 Earcut。只允许下文 epsilon 脏检查复用完全相同的结果，
  任何角度分桶/形变烘焙优化都已证明引入错位/跳动/分割，禁止回潮
  （形变烘焙、旋转矩形、固定画布、contactQuad、垂直剪切五条弯路留档）。
- **顶点真源分流**：普通建筑使用独立 shadow caster；掩体/门/楼梯保留专用
  iso footprint；散布障碍物使用视觉底座矩形四角（foot × visualWidthMul/DepthMul，纵深 ×0.5 压扁）。
- **深浅、夜影与地牢环境影**：静态基础透明度 0.1925（基准 0.55
  →−30%→再−50%，2026-08-19 用户口径）。室外环境系数为
  `nightShadowStrength + (1−nightShadowStrength) × clamp((daylight−0.1)/0.2)`：
  默认白昼 100%，深夜保留 40%，黄昏/晨曦平滑过渡。地牢战斗场景不使用被冻结的太阳
  时间二次衰减，固定为 `dungeonShadowStrength=0.55`；地牢路线地图模式仍隐藏阴影。
  个体仍可 `shadow.opacity` 覆盖基础透明度。改基础深浅调
  `STATIC/DYNAMIC_SHADOW_OPACITY`，改环境档位调两个 strength 配置。
- **延长段上限**：建筑 `maxOffset = max(43, height×0.5)`；障碍物各自
  `shadow.maxOffset`（42~72）；length 随仰角曲线（正午短、晨昏长）。
- **水平接触影（单位唯一默认，2026-08-21 footprint 对齐修复）**：玩家/怪物/友军/NPC
  阴影中心严格等于视觉脚底/碰撞脚点，宽高严格取 `resolveUnitGroundFootprint` 返回的
  `Collider.radius` 水平 2:1 footprint，默认 `widthMul=depthMul=1`、
  `rotation=0`，始终保持屏幕水平 2:1 柔边椭圆。`entity_shadow` 的径向透明度采样点必须由
  `getContactShadowGradientStops()` 统一生成，并用同一 `smoothstep` 曲线在外缘降到 0；禁止为个别单位
  另画硬边纹理。禁止把整个椭圆旋转到太阳影向——影向接近
  屏幕 Y 轴时会把水平脚底错误立成竖椭圆。普通单位不再产生方向位移或晨昏尺寸膨胀；只有
  个体显式配置 `shadow.directional=true` 时才启用旧方向尾影。
  透明度 0.30078125（2026-08-21 单位影再加深 25%；建筑静态仍为 0.1925）×环境强度、
  深度跟随本体仲裁后 −0.1（墙体遮挡继承）。单位不做逐列剪影；帧剪影链已退役，禁止回潮。
  `collisionShape:'rect'` 与 `collisionWidth/Height` 是玩家、怪物、NPC 的躯干受击矩形，不是
  地面 footprint，禁止用它们拉伸阴影；“范围”按钮红色 footprint 与单位阴影必须复用同一入口。
  锚点：玩家/怪/NPC = collider.x/y（footprint 圆心，玩家再 −z）；友军 = 视觉脚底
  `sprite.y + footOffsetY`（精灵已含 z 与帧格归一化，纯跟随队员无逻辑坐标也不错位）。
  `_getUnitRenderFootprint` 是阴影与“范围”红色 footprint 的共同中心入口；范围模式必须把
  队伍成员和世界友军也纳入绘制。
- **投影图派生资产仍保留**（silhouette/projection/height/normal 供后续局部光效）；
  生成必须内容紧身裁剪，禁止 PROJECTION_BOTTOM_BANDS 带状采样。
- **flipX 一次性镜像**（2026-08-19）：镜像实例在 `_resolveShadowSilhouette` 先把
  列/前顶点按贴图中心镜像（mirrorX=texW−x），下游全部用镜像后几何、flipSign 归一；
  禁止下游再补镜像（错位根因）。
- **门/斜墙类走 `groundLine` 面线映射**（2026-08-19）：它们的地面接触是对角面线
  不是 V 形底座——`_ensureGateSunShadow` 专用注册（body=自身 iso footprint 薄矩形、
  剪影列沿实体 `_faceLine` 世界面线映射、`_facingLeft` 列镜像）；无 spriteCfg 的
  实体（占位圆）不能走通用 ensure。
- **楼梯整条一影（2026-08-19 定稿）**：楼梯由多块主体拼接（segmentSprites 逐段
  z 抬升）——实体级单影只盖第 0 段（碎裂根因），逐段出影有分块感，而贴图是
  对角斜墙、剪影展开会偏离全局影向 40°+（七扭八斜根因）。最终方案：全段 1×1
  footprint 顶点合并成梯轴长带，单个凸包沿全局影向统一挤出（`_silCache` 置 null
  走纯凸包）；高度取各段剪影实测最大 measuredHeight（影长修复不回退）。
  `_ensureStairSunShadows` 专用注册；`_structureSunShadows` 值对楼梯回到单值。
- **掩体墙只用 footprint 凸包（2026-08-19 用户口径）**：`_isDefenseCover`（方块墙/
  各档护墙）在 ensure 里 `_silCache` 置 null——多边形回退 footprint 凸包
  （方块墙 1×1 菱形、护墙面线薄条），剪影只取实测高度。墙贴图内容在大画布内
  偏移大，剪影实体四边形会比 footprint 宽近一倍且沿墙斜向歪轴。
- **墙壁/门/楼梯**： obstacle_block、wall_stair_*、cover_gate_A~D 已入光照清单
  （spritesheet 走 FRAME_CROPS 帧 0 裁剪）；结构阴影过滤器不再排除掩体，
  能源矿（发光体）仍排除。
- **性能口径（2026-08-24 结构修复）**：多边形按 epsilon 脏检查缓存复用
  （0.11°/0.5px/顶点签名），共享层干净帧复用预三角化命令。`getUnionOfPolygons()` 扫描阶段仍以
  2px 补样并纳入全部输入顶点行，输出左右 v 单调包络再做 RDP 压缩；high/medium 的世界像素误差
  上限分别为 0.35/0.7px，首尾和宽度接近收拢的尖端强制保留，禁止在扫描前粗采样接地角。
  绘制 job 按实际投影 bbox 对 `camera.worldView + shadowPaddingPx` 裁切；阴影专用默认缓冲为 64px，
  不再复用实体视觉的 320px。精确轮廓生成前还要用 footprint/parts/源 Sprite 包围范围向所有方向扩张
  `max(currentLength,maxOffset)+8px` 做保守粗裁；这是为了跳过离屏 caster 的并集和 Earcut，不能只在
  精确轮廓生成后裁。接触胶囊按屏幕直径使用 8/12/16 段。质量档位 high 保持 8px/5 步，
  medium 封顶 6px/2 步，low 关闭结构长投影并把接触影羽化降到 4px/1 步；均不得改变模拟。
  性能报告必须暴露 visibleJobs、viewportCulled、preGeometryCulled、postGeometryCulled、
  viewportPaddingPx、rawContourVertices、
  contourVertices、contourReductionPercent、clusters、featherPaths、triangles、commandBufferLength、
  rebuilds 与 lastRebuildMs；场景重启复位层脏检查状态。
- **死链纪律**：派生 projection/silhouette PNG 运行时不加载（剪影数据走 manifest
  shadowSilhouette 列）；manifest 只留 alphaBBox/shadowSilhouette/路径字段
  （anchorMode 为贴图回归测试契约占位保留，别删）。
- **实机探针**：`tools/cdp-sun-shadow-verify.mjs`（三时相冻结+inspect+截图）、
  `tools/cdp-obstacle-shadow-debug.mjs`、`tools/cdp-sun-shadow-audit.mjs`。
  配置太阳必须走 `window.EnvironmentLightingSystem`（main.js 挂载）：HMR 后
  裸路径 import 是第二实例，configure 不到游戏真正读的太阳。
- **重建派生图的坑**：先关无头 Edge 再跑 build-lighting-maps.py——页面把贴图
  内存映射，PIL save 会随机报 Errno 22（Windows 文件映射占用）。
- **保鲜护栏（2026-08-19 贴合审计）**：契约测试逐资产对照当前贴图校验
  alphaBBox/剪影列/frontY（±2px）——换/改贴图没跑 build-lighting-maps.py 直接
  红测，报错信息写明哪个键失配。失配症状就是"阴影整套错位不贴边"
  （church/research_institute 曾因此错位：旧条目 1239/1126 宽、新图 1039/1051）。

#### 建筑贴图替换后的阴影工作流

> **2026-08-21 起第 1/2 步对建筑阴影不再必需**（建筑不看 manifest 剪影，见上节 shadow caster 契约）；
> 该脚本仍服务于散布障碍物剪影与 projection/height/normal 派生图留档。

1. **保持贴图键不变时**：替换 `assets/terrain/<key>.png` 后运行
   `python tools/ai-gen/build-lighting-maps.py`，重新生成 `<key>_projection/height/normal/silhouette`
   与 manifest `base` 实测（先关无头 Edge，否则 PIL save 可能 Errno 22）。
2. **新贴图键/新建筑时**：把 key 加入 `build-lighting-maps.py` 的 `ASSETS` 并运行脚本即可。
   运行时只消费 manifest 的 `shadowSilhouette`/`alphaBBox`（projection/silhouette/height/normal
   PNG 仅磁盘留档，不再预加载）；散布障碍物的 hull+剪影门也直接看 manifest
   有没有剪影列（2026-08-19 唯一性审计：曾用 `textures.exists(key+'_projection')`
   当门，预加载清理后该门永假、仙人掌/雪松静默退化成椭圆——已改 manifest 门复活）。
   普通建筑阴影根部自动复用最终 `visualFootprint` 接触面，不含独立道路/地面铺装；仅异形或
   配置不完整素材回退主体当前 alpha，确需独立阴影低模时才写
   `shadowCaster.contactPolygon`/`parts` 覆盖。
3. 检查 `data/environment-lighting-assets.json`：`base.centerX/width` 已自动生成；
   `shadow.anchorMode/anchorInsetX/Y` 仅对沿用预投影贴图的散布障碍物有意义，建筑不需要。
   不要通过修改 collision footprint 来补视觉影子位置。
4. 进入世界-122，至少在正午与晨昏观察（或用 `tools/cdp-sun-shadow-verify.mjs` 冻结三时相）：
   影子根部贴建筑底座四边形、长度不过门/墙、建筑本体不被影子盖住；
   换贴图后必须重启 Vite，确保新增静态资源被加载。
5. 普通建筑只需提交原贴图及显式 `shadowCaster` 配置（如有）；只有散布障碍物改图时才同时提交
   `assets/terrain/lighting/` 派生图与 manifest 改动，不得只提交障碍物原图。
   换贴图后必须重启 Vite，确保新增静态资源被加载。

#### 游戏内时间系统（2026-08-18）

- **唯一时间源**：`EnvironmentLightingSystem._elapsedMs / dayDurationMs / startPhase` 同时驱动
  太阳方向、阴影、环境色和右上角时间 UI。禁止另起 `Date.now()` 秒表，否则画面时间与太阳脱节。
- 时相映射：phase=0 为日出 06:00，0.25 为正午 12:00，0.5 为日落 18:00，0.75 为午夜 00:00；
  UI 显示 `第N日 · HH:MM · 晨曦/白昼/黄昏/深夜`。
- Phaser 暂停时环境系统不 update，因此游戏时间、太阳和阴影同时冻结；不要用独立
  `setInterval` 更新游戏时钟。
- 存档必须写 `gameTime: EnvironmentLightingSystem.serializeTime()`；读档调用
  `restoreTime(data.gameTime)`，旧存档无该字段时保持当前默认时间。
- 右上角旧 `.game-timer` 秒表已删除；DOM 与程序化 HUD 均使用 `#gameTime /
  #gameTimeIcon / #gameTimeText`。表盘用 `#gameTimeDial`（2026-08-19 24h 太阳针，60px SVG）：
  SVG `<g>` 单针、`refreshGameTime` 内 `rotate(phase×360−90, 24, 24)` 由 `getSun().phase`
  驱动——上=正午、右=日落、下=午夜、左=日出（针=太阳方位）；
  不做精灵图帧（帧数爆炸跳变），刷新与暂停/读档同链，无独立秒表。
- **地牢时间、世界观察与入侵进度（2026-08-22 修订）**：`EnvironmentLightingSystem` 在
  `scene7` 地牢探险中继续推进，五日入侵、特殊天气排期、`WorldSimDriver` 后台位面资源/生产/
  科技结算以及全局兵线均使用同一游戏时间，不再以地牢状态冻结。`isDungeonIsolationActive()`
  只表示当前画面正在渲染 `scene7`，禁止再将它用作全局计时开关。
- 地牢进行中允许通过世界面板以 `observer:true` 观察、选择和指挥已建传送门位面；首次切出时
  暂存地牢实体、特效、墙体、地形、相机与交互 UI，面板增加“返回本体”地牢行，返回后恢复同一
  探险现场。玩家本体仍属于地牢，入侵“本体支援”继续禁用，不能借观察切换绕过地牢结算。
  地牢成功/失败/安全撤离/主动放弃必须在 `shutdown` 前统一调用
  `_recordRunResult`，每局只登记一次；F→A 进度比例只读 `world-system.json`，禁止在退出按钮
  分支另写常量。成功结果同时是世界位面解锁条件，失败与放弃只推进入侵、不解锁世界。

#### 出图提示词要点
- `worldBlock1x1`/建筑系素材写“**底边与水平线呈26.565度夹角、严格2:1**”；旧连续墙地牢素材才写30度。
  提示词角度必须服从实际地板/墙体构建体系，禁止再用单一全局角度覆盖全部地牢。
- 垫图：把 wall-直墙.png 和一块地板砖存为固定参考图，每批素材垫图生成
- 同一套素材（如直墙+四转角+墙柱）必须**一批出齐**，分开生成必出规格差（砖块大小不一）
- 干净输出：透明底、无白色描边/辅助线、无"由 AI 生成"水印

---

### 阶段性进度总结（2026-07-26）

#### 本次完成：沼泽地牢墙体全套落地 + 宝箱房体系 + 系列修复
1. **墙样式表 `ISO_WALL_STYLES`**（`{straight, gate, chestPrefab, gateSound, corners?}`，key=dungeonType）：沼泽柴墙/藤门素材管线全套（泛洪抠图+水印 inpaint+腐蚀 2px 去颜色污染+两端锥形裁切；门视频 16 帧反转+连通域过滤）；`buildIsoDiamondWalls`/WallGate/门音效/宝箱房预制/夹角预制全走样式。新地牢换墙四步法已文档化。
   - **⚠ 双份 JSON 坑（2026-08-08 沼泽走廊修复实测）**：`wall-prefabs.json`/`dungeon-config.json`
     有 **data/ 与 public/data/ 两份**——运行时 fetch 的是 **public/data**（Vite 从 public 提供），
     编辑器保存走 `/__save-json` 同时写两份；**手工改配置只改 data/ 不生效**（游戏仍读旧 public
     副本）。改配置必须两份同步。
   - **✅ 沼泽地牢走廊换墙（2026-08-08）**：三房间串联竞技场的连接通道预制由
     `combatArena.passagePrefabs` 决定，样式为沼泽时取 `passagePrefabs.swamp`；此前该值
     指向僵尸版「左右通道」（wall_straight/wall_gate）→ 沼泽房间是柴墙、走廊却是僵尸砖墙。
     修复：新建「左右通道·沼泽」预制（swamp_wall_straight/swamp_gate，直墙 face 中点按
     僵尸预制同轴同偏移换算、尺度换沼泽档，见 `tools/gen-swamp-passage-prefab.py`），
     `passagePrefabs.swamp` 指向它（data/ + public/data/ 两份同步）。
    验证：`tools/cdp-swamp-arena-check.mjs` 进沼泽竞技场——76 块墙全 swamp_wall_straight、
    门全 swamp_gate，GLM 确认走廊柴墙与房间衔接自然、连通正常；gate-corner/wall-embed/
    arena-layout 测试全绿。
   - **⚠ 换墙后通道中段留大空隙（2026-08-08 二修）**：首版沼泽通道预制直接按僵尸预制的
     face 中点克隆（每侧 2 段），但**沼泽直墙世界长 374px < 僵尸墙 476px** → 每侧中段
     留 94~105px 空隙（僵尸版靠 8px 叠合连续，换短墙后断裂；`_sealPassageSides` 只补
     侧墙到房间边线的**两端**，不补中段内部空隙）。修复：按 SKILL「定长瓦片 + 叠合」
     规则把每侧改成 **3 段**（步长 374−8=366，覆盖 ≈1106px ≥ 走廊 964px），两侧垂直
     偏移取原预制的 perp 实测值（走廊两侧不等距）。验证：两侧墙段沿轴投影**零空隙**
     （全部 ≤0 即叠合），GLM 两条通道均连续无黑缝。教训：**换不同长度墙段时必须重算
     瓦片数量，不能只换贴图/尺度**。
   - **⚠ 通道口"错位扭曲"根因（2026-08-08 三修）**：3 段瓦补连续后用户仍报门口
     "错位扭曲"。排查：`_clipPassagePieceToRooms` 把部分越线的通道直墙件**按比例缩
     scaleX**（沼泽墙被裁 136~154px），削短同时削短**墙顶** → 通道口墙顶台阶/错位；
     僵尸走廊几何相同但砖纹不明显、且瓦长 476 未被裁，故旧观感正常。修复：部分越线
     不再缩 scaleX（保留整件，尾端超出由房间墙/门盖住——SKILL「定长定高瓦片、尾端
     由邻居盖住」规则），仅整件进房才丢弃。验证：关闭裁剪后门口自然、墙不突入房间；
     `scripts/test-wall-depth.mjs` 的 `_sealPassageSides` 正则窗口 3000→5000（封口
     中位数逻辑使函数变长）。教训：**定长瓦片禁按比例缩放；越线交给邻居遮挡**。
  - **✅ 通道地板盖不住墙角（2026-08-08 四修）**：走廊地板 quad 两个端边原来是
     "房间边线向内平移 80px"，端点落在房间内部，60° 墙角楔形区地板不到墙线
     （墙脚露黑）。修复：`_arenaPassageFloorQuad` 侧边取**实际墙线**（不再内收 12px），
     端边改为**房间真实边线**——地板端点 = 走廊侧墙线 × 房间边线交点（=墙角点），
     精确盖到墙角；房内延伸由房间菱形地板并集补齐。验证：GLM 通道草地完整覆盖、
     墙脚无黑洞、门口两侧完整。注意：headless 下 `applyArenaFloor` 的烘焙地板
     渲染不稳定（terrainTexture 常全黑），像素复核不可靠，最终以实机为准。
  - **⚠ 通道侧墙探入房间内部（2026-08-08 五修）**：用户报"通道2 侵入第二间房
    场地、突出来"。量化（`tools/probe-passage2.mjs` 在页面读 isoVisuals + 房间
     边线投影）：沼泽预制 `t_start=-40`（门中心前 40px 起铺）在 60° 房间边线面前
     不够——row −211 首件端面探入房A **140.6px**、row +184 末件探入房B **125.9px**，
     且带碰撞挡住房内可走区（房2 内 (4238,2313)/(4300,2350) pre 不可通行）。根因
     是三修把 `_clipPassagePieceToRooms` 改成"部分越线保留整件"后失去裁剪；再早的
     scaleX 裁剪会削墙顶。修复：**任一端点越进房内（>8px 公差）即整件丢弃**，缺口由
     既有 `_sealPassageSides` 用整瓦补到房间边线（两端各 8px 叠合）——与僵尸版
     "定长定高、尾端由封口补"同口径，不缩放、不削墙顶。验证：post 房2 门洞内侧
     (4238,2313)/(4300,2350)/(4400,2330) 全部可通行；精灵列表无突出件、有封口瓦；
     arena-layout/wall-embed/gate-corner/wall-depth + npm test 全绿；僵尸版侧墙端面
    均在 ±8px 公差内不受影响。教训：**60° 边线在侧墙 row 上的交点不在门中心**，
    铺瓦范围两端必须交给边线裁剪/封口兜底，预制起始点不能拍脑袋定。
  - **✅ 多房迷宫竞技场（2026-08-08 六修/新章）**：三房直线串联 → 任意房数
    蛇形网格迷宫（默认 5 房 2 排）。核心复用：菱形四对边（LT/RB、TR/BL）的通道
    连接中心距公式**完全相同**（= (rx_A+rx_B)*EDGE_MID_FACTOR + passageLen），
    四方向通道几何对称，只需补 v2 轴（上下通道）识别 + 反向放置旋转。
    实现要点：
    1. `computeMazeLayout`（combat-arena-layout.js）：蛇形拓扑（排内 ±v1 交替、
       排间 +v2 折返），房记 inEdge/outEdge（末房出口 = 入口对边，避免出入口同边冲突）；
       **世界尺寸含负方向——蛇形会向 -y 走，整组平移使 minX/minY ≥ margin**。
    2. `_analyzePassagePrefab` 双轴校验（v1=(0.866,0.5) / v2=(0.866,-0.5)，取
       |dot| 大者）；配置 `passagePrefabs` 改 `{ v1, v2 }` 对象格式（坑：deepMerge
       的 DEFAULT_ARENA 也必须是对象，字符串会被逐字拆开成 {0:'左',1:'右',...}）。
    3. `_placeArenaPassage` 反向通道**绕 gA 中心旋转 180°**（x'=2gA.x−x，
       y'=2gA.y−y，flipX/flipY 取反）——水平镜像只翻 x 得到的是 -v2 方向，
       y 不翻会落点校验失败（反向通道 = 上下通道镜像，不是左右通道镜像）。
       门洞/底边几何经 texPointToWorld 的 flip 变换自动正确。
    4. 地板/封口/裁剪的边线动态化：新增 `_roomEdgeLine(room, edge)`（TR/BL 边），
       `_arenaPassageFloorQuad`/`_sealPassageSides`/`_clipPassagePieceToRooms`
       不再硬编码 RB/LT——转弯通道（TR→BL）地板/封口全靠这个。
    5. 波次/门控/出口/宝箱泛化：硬编码 3 → `arena.rooms.length`（forceArenaWaves、
       `_checkZombieCombatComplete` stage<len、`_onArenaRoomSealed` 末房、宝箱房
       setup 末房、`_trapExtras` 末房来路通道索引 len−2）；出口门锚定末房 outEdge
       中点（`_setupGate` 通用）。
    6. 沼泽上下通道预制：`gen-swamp-passage-prefab.py` 双源（左右/上下）生成
       「上下通道·沼泽」，L=964.6 与左右一致；data/ + public/data/ 双份同步。
    配置：`combatArena.maze = { enabled, roomCount, rows }`（默认 5 房 2 排启用；
    关掉或 roomCount≤3 走原三房直线）。验证：`tools/cdp-maze-check.mjs` 进沼泽
    竞技场——5 房 4 通道门位置 d1=d2=0、通道中点可通行、四条地板 quad 端点
    errA/errB=0（转弯 TR→BL 与反向 LT→RB 全对）、三房回归 roomCount=3；
    npm test 全绿。坑：headless 下 `_enterNode` 时 `window.__phaserScene` 常未就绪
    → 门精灵 0（headless 伪影，真实游戏正常；验证门用 step-place 手动重建）；
    地板烘焙渲染不稳定（黑区）是既有问题，几何以 quad 端点计算为准。
  - **⚠ 多房迷宫房 4/5 墙壁错乱根因：seal/fill 的 flip 解耦（2026-08-11 二修定稿）**：
    蛇形折返的 v2/-v1 通道在房 4/5 出现墙体重叠/错位。CDP 插桩（isoVisuals.push +
    _addSegPiece 全量栈）定位到两类"上下颠倒/镜像偏移"墙件：
    1. **`_sealPassageSides` 的 flip 公式**：旧 `flip = axis.x*axis.y<=0` 且
       `if(flip) swap` 绑定——-v1（反向轴，(-,-) 得 + → flip=false）不交换端点，
       A 落下端 → `_addSegPiece` sy<0 上下颠倒（6 块负 sy 件飘进房间）；
       首修改成 `axis.y<0` 又令 -v1 flip=true → sx<0 底边镜像偏移（残留 2 块）。
       **正解：swap 与 flip 解耦**——`swap = axis.y<0`（向上轴交换端点保 sy>0），
       `flip = (axis.x<0) !== swap`（保 sx>0）。四轴 v1/v2/-v1/-v2 全验证。
    2. **`_fillEdgeGaps` 的 BL 边参数化顺序反了**：BL 应为 **L→B**（上端→下端，
       与 TR 同方向），旧 B→L 下端→上端 → 填充件 sy<0 上下颠倒。
    3. 验证：5 房蛇形（1-2 LT/RB、房 3 出 TR、房 4 入 BL 出 LT、房 5 入 RB 出 LT）、
       4 通道轴 v1/v1/v2/-v1、8 门全开、房间零重叠、**negSy=0、游离件=0**、
       GLM 全景"蛇形排列、四面墙完整、通道衔接自然、无异常"；lint/build/npm test 全绿。
  - **⚠ 4→5 通道门口错位的真根因：镜像旋转漏了 flipY（2026-08-11 三修定稿）**：
    第 3→4（v2）通道正常、4→5（-v1 镜像通道）门口错位/通道墙一塌糊涂/方向反——
    前两轮"补 flipY / 解耦 seal flip"都没根治（用户实测无变化）。最终定案
    （按用户"直接复制通道做镜像翻转"）：`_placeArenaPassage` 的 180° 镜像
    **改为几何重建**——反射每个件的**底边线段**（绕 gA 底边中心），再用墙体系统
    （`_buildSegPiece` / `_buildGatePieceAt`）从反射底边重建件，锚点/缩放/朝向
    全部由几何自动推导。旧"位置反射 + flipX(±flipY) 翻转"会把门墙精灵锚点翻到
    门洞另一侧（视觉门洞偏移 187px）且贴图朝向反转。验证：P4 门精灵与 P1 同构
    （锚点在门洞上方 ~93px、flipX=true、flipY=false）；GLM"两侧墙完整平行、
    门洞与房间墙对齐、无竖摆/断口/重叠/游离墙、纹理方向正确"。
  - **⚠ 地牢左侧信息面板仅路线图显示（2026-08-11）**：时空特工入侵几率标签
    （AgentInvasionSystem）与预期奖励面板（DungeonMapSystem）不再进战斗画面——
    `_enterNode` 隐藏 + 各状态入口兜底（_enterCombat/_enterBoss/_enterBossCombat/
    _enterInvasionBattle/_enterReward/_enterEvent），`_returnToMap` 恢复。
    两栏统一挂到 `#dungeonRouteInfoStack`，按上方背景图 contain 后的左黑幕真实宽度居中并纵向排列，
    总高度必须止于 `.party-bar` 上缘之前。收益预览只读实际发奖真源：首领金币读
    `BOSS_REWARD_CONFIG.reward`，精英宝箱装备档位/概率读 `ChestRoomSystem.getRewardPreview()`，
    祭品范围读当前 grade 的有效掉落权重；禁止使用仅供出征说明的 `dungeonList.reward` 或未启用的
    Boss 奖励卡推导。特工概率显示值与当回合 RNG 共用 `chance`，入侵触发、捕获消费和战胜后都归零。
  - **⚠ headless 探针禁用 --disable-gpu（2026-08-08 迷宫通道墙排查）**：用户报
    "衔接通道没做墙"。排查中 `cdp-swamp-arena-check` 系探针带 `--disable-gpu`，
    导致 headless Edge 里 **Phaser scene 不启动（window.__phaserScene 恒 false）**：
    墙精灵不渲染、`_createArenaGate` 因无 scene 返回 null（门 0）、截图空白，
    数据层（isoVisuals）却是正常的——误判为"代码没墙"。去掉 `--disable-gpu`
    后 scene 就绪（门 18 扇、墙件 96、渲染连续）。教训：**headless 渲染类探针
    一律走真实 GPU（不要 --disable-gpu）；先查 `window.__phaserScene` 是否就绪，
    再判断"渲染问题"还是"数据问题"**。本次最终结论：数据+渲染均正常，用户所见
    是浏览器加载中间版本缓存（HMR 未生效），强刷后恢复。
  - **⚠ 通道侧墙全丢根因：signC 用错字段（2026-08-08 七修）**：用户持续报
    "衔接通道没做墙 / 看不到墙壁"。深挖（完整启动流程 cdp-swamp-webgl-check）：
    `_clipPassagePieceToRooms` 里 `const signC = (e.c.x - e.P.x)*nx + (e.c.y - e.P.y)*ny`
    ——**e.c 是房间对象（字段 cx/cy），e.c.x/e.c.y 是 undefined** → signC=NaN →
    `NaN < 0` 恒 false → **法线永不翻转** → 通道对侧（LT 等）边线方向错 →
    五修"任一端点越线即丢"把所有侧墙件误判"整件在房内"**全部丢弃**（三房旧逻辑
    只丢整件进房、部分越线保留，NaN 符号错误影响小，所以三房一直正常）。
    修复：`e.c.cx`/`e.c.cy`。验证：修复后完整流程 wallTotal 99→125、通道 1 墙件
    1→12、渲染棕色墙恢复；npm test 全绿。教训：**几何判定里房间对象一律用 cx/cy
    （不是 x/y），NaN 比较恒 false 会静默走错分支——排查"墙消失"先怀疑符号/法线
    判定**。headless 首次场 scene 未就绪会掩盖此问题（墙精灵 0 与墙件被丢混在一起），
    必须走完整启动流程验证。
  - **⚠ 转弯通道横墙挡路（2026-08-08 八修/九修）**：用户报"第三四间房衔接通道没做好、
    墙壁没衔接、不可移动区域也有墙壁"。分阶段重建定位：横墙（通道中间 perp≈0 的墙）
    在 `_sealPassageSides` 阶段产生。两个根因叠加：
    1. **flip 瓦方向**：`lay` 沿通道轴铺瓦时 a<b（从通道外向内），flip=true 的通道
       （v2 轴）`_addSegPiece` 期望 A 端=上端（贴图朝向）→ A/B 反向 → 瓦被翻转、
       base 段横在通道中间（v2 通道的 seal 瓦方向显示为 -v1 横墙）。修复：flip 时
       lay 交换 a/b。
    2. **halfSpan 过窄**：`length/2+250` 会把 3 段瓦的末端件（沿轴 ~L/2+340）排除 →
       hi/lo 偏小 → 封口瓦从通道中段补起。修复：`length/2+500`。
    3. **相邻房间平行边墙误收集**：转弯通道轴（v2/-v1）与房间 TR/BL/LT 边平行，
       seal 会把房间边墙当侧墙（perp 落在 60-400）→ 补瓦错位。修复：`_placeArenaPassage`
       给预制侧墙打 `_passageWall` 标记，seal 只收集标记件。
    验证：分阶段 seal 后横墙 2→0，通道 3 碰撞剖面 t=300~500 全部可通行，
    渲染棕色提升、暗区大减；npm test 全绿。教训：**转弯通道（v2/-v1）与房间边平行，
    任何"收集平行件"的逻辑都必须按来源标记过滤；flip 瓦的 A/B 朝向要按贴图语义**。
  - **⚠ 火球命中后残留不消失（2026-08-08 九修）**：僵尸巫师的火球命中目标后残留在
    原地。两处根因：
    1. `fireball-system.js onImpact`：`spike.flyActive/active=false` 在**音效/特效/AOE
       结算之后**才执行——任一步抛异常（音效缺失、粒子/爆炸异常）→ 状态残留 →
       火球粒子一直显示。修复：**状态清理提前到结算前** + 结算包 try/catch（异常不
       阻塞火球回收）。
    2. `GameScene _syncOtherMagicCasters`：`hasFire` 只看 `_fireballActive`/
       `_fireball.active`——巫师死亡（hp<=0）或状态残留（active 但 flyActive=false）
       时仍判"有火球" → 清理循环跳过 → 粒子残留。修复：hasFire 增加**施法者存活
       （hp>0）**与**发射后 flyActive** 双条件。
    验证：npm test 全绿；命中后火球粒子立即回收、施法者死亡同样清理。
    教训：**投射物/特效的"结束标记"必须原子化提前置位（先清状态再结算），渲染层
    判"活跃"要同时看施法者存活与飞行状态**。
  - **⚠ 迷宫房3 清完不开门（2026-08-08 十修）**：用户报"第三个房间完成战斗不打开，
    是不是宝箱房的缘故（原来三间房第三间有宝箱房）"。排查：`_enterCombatArena` 里
    `forceArenaWaves(CombatRoomSystem.getArenaRoomCount())` 在 `enterCombatArena`
    **之前**调用——此时 `_arena` 尚未建立，`getArenaRoomCount()` 返回 **0** →
    `forceArenaWaves(0)` 无效 → `_totalWaves` 保持遭遇默认（沼泽 3 波）→ 迷宫 5 房
    只有 3 波：房3（第 3 波）清完 `_zombieCombat.isComplete` 提前 true →
    `_checkZombieCombatComplete` 跳过"开门等下一房间"分支、走"战斗完成"只开末房
    出口门 → 房3 去路门（通道 3）永不开启，玩家卡死（观感像宝箱房/开门逻辑错）。
    修复：`forceArenaWaves` 移到 `enterCombatArena` 成功**之后**，用真实房间数
    （5 波）。验证：roomCount=5→totalWaves=5、房3 清完 isComplete=false、通道 3
    门正常开启；npm test 全绿。教训：**竞技场波次数必须等场地建成后再按房间数编排，
    进场前 getArenaRoomCount() 返回 0 会让 forceArenaWaves 静默失效**。
  - **✅ 地牢选择界面背景图（2026-08-08）**：路线选择界面上方背景走
    `DungeonConfig.getZombieDungeonConfig(dungeonType).mapBackground`，**配置键注意
    `_keyFor` 映射**（swamp → `swampDungeon`，不是 dungeonList 的 'swamp' 键）；
    僵尸默认 `assets/scenes/dungeon-bg/zombie.png`（2560×1065，湿地+地牢废墟风格，
    注意与兜底 `dungeon-map-bg.png`（2560×1440 城堡）不是同一张）。新增地牢背景：
    参考僵尸原图 → `flux2-dev-fp8` 文生图（无深度图时用强构图提示词；HuggingFace
    被墙下不了 Depth-Anything，深度控制不可用）→ 放大到与参考同尺寸 → 存
    `assets/scenes/dungeon-map-bg-<主题>.png` → data/ + public/data/ 两份配置
    `swampDungeon.mapBackground`。验证：`tools/cdp-swamp-webgl-check.mjs` 进地图
    截图 + GLM。生成提示词见 `tools/_swamp_bg_prompt2.txt`（宽幅 2.4:1）。
2. **夹角**：运行时支持预制夹角（`_placeCornerPrefab`：共享端点锚定顶点、深度按房间规则重算 min/max+编辑器内部顺序保留）；最终四角全部用用户手摆纯直墙预制。
3. **一房一门**：`_setupGate` 优先替换样式门件（装饰门→功能门），无门件回退最近直墙件（跳过 `_corner`）；门闸缩放统一为墙件同尺度（`ISO_WALL_HEIGHT/wallH + slopeFixOf`，修大小墙衔接）。
4. **宝箱房**：按预制原样放置（x/y/scale/flip/depth 仅平移，**不重算**——此前重算图层+门墙缩放归一是"预制图层混乱+缺口"根因）；门墙碰撞从件变换推导；宝箱贴图换 D.png/D-打开.png 静态双图；墙脚阴影（离屏实色+blur 羽化，alpha 0.55）；门纳入 X 光 occluders。
5. **地板**：`overlapX/overlapY` 叠合机制（自然材质必配）；地砖默认随机选图+随机镜像（立约无需声明）；brick-4 泥水砖已剔除。
6. **拼接**：`edgeFill` 废弃均匀拉伸，回定长定高瓦片+overshoot 由转角臂+5 偏置盖住（转角臂统一 +5 已入规则）。
7. **门外白区**：远两角从锐角→圆角路径→最终**分形噪声海岸线淡出**（96/28px 双层值噪声调制保留阈值，每次生成不同）。
8. **关键修复**：`rebuildIsoCollision` 保留 `_gate`/`_chestGate` 门线段（门洞可穿根因）；宝箱房刷怪回退点不再落中心排除区；AttackRangeEffect 警示圈 depth y-998 + 保活重置 life。
9. **诊断日志**：`[DungeonFloor]` 地砖池、`[XRay] 宝箱房门` occluder 注册（排查"修改未应用"类问题先查它）。

#### 关键改动文件
- `src/world/wall-system.js`、`src/world/wall-gate.js`、`src/world/chest-room-system.js`、`src/world/combat-room-system.js`
- `src/world/dungeon-floor-texture.js`、`src/world/dungeon-map-system.js`、`src/world/zombie-dungeon.js`
- `src/phaser/scenes/BootScene.js`、`src/phaser/scenes/GameScene.js`、`src/ui/wall-editor.js`
- `assets/terrain/swamp_*`（柴墙/藤门/地砖）、`assets/sounds/environment/swamp_gate.mp3`

#### 验证状态
- `npm run lint` ✅（0 error）
- `npx vite build` ✅
- `node scripts/test-collider.mjs` / `test-craft-sync.mjs` ✅

---

### 阶段性进度总结（2026-07-26 续）

#### 本次完成：门外白区边缘体系 + 沼泽装饰 + 死亡序列修复
1. **门外白区边缘**：多轮迭代——规则圆弧（太规则）→ 噪声海岸线（阈值/半平面 bug 两连）→ **EQ 柱状图**定稿（柱条沿外法线、柱高=随机游走+尖峰、内部平整实心、柱间细缝、门侧 ±45° 保护、长边扇区限定）。**教训：白区只在进房时烘焙一次，改代码必须重进战斗房验证**。
2. **X 光透视全局停用**：`GameScene._xrayEnabled = false` 开关，代码保留可恢复。
3. **沼泽装饰道具**：4 件素材（柴堆/草茎/树桩/苔石）重管线抠图（泛洪+腐蚀 2px+漂白压暗）；`_spawnFloorDeco` 按晶格 30% 随机摆放（origin 底边贴地、y 排序、cleanup 统一销毁）；配置 `floor.deco`——**注意 `setDungeonFloorProfile` 必须显式透传新字段**（deco 被丢导致不生效的教训）。
4. **矿石蜘蛛死亡序列修复**：game.js 尸体识别只看 `_deathAnimTimer/_corpseTimer/_fadeTimer`（硬约定），自定义字段名导致死亡后 update 被跳过——已对齐标准字段，临终下砸+dying+定格+淡出全部生效。
5. **地砖**：AI 新砖（45°菱形纵向压缩掰 30°）入库试用 `swampbrick_new1`，旧 3 张备份 `swampbrick_old/`；**不同宽度砖不可混铺（网格步进错位）**。

#### 关键改动文件
- `src/world/combat-room-system.js`（白区烘焙/装饰生成）、`src/effects/gate-light.js`
- `src/world/dungeon-floor-texture.js`（deco 透传）、`src/entities/enemy-types/ore-spider.js`
- `src/phaser/scenes/GameScene.js`（X 光开关）、`assets/terrain/swamp_*`

#### 验证状态
- `npm run lint` ✅（0 error）
- `npx vite build` ✅
- `node scripts/test-collider.mjs` / `test-craft-sync.mjs` ✅

---

### 阶段性进度总结（2026-07-25）

#### 本次完成：矿石蜘蛛（精英）+ 沼泽地-高级地牢 + 近战口径统一 + 系列修复
1. **近战命中口径统一**：`_shared/enemy-utils.js` 新增 `inMeleeRange`（与 CombatSystem 触发同语义圆形边缘距离）；矿工/工头/提灯/盾卫/突击/手脑近战命中从 GroundEllipse（垂直半射程）切换；技能 range 读取约定 `skill.range ?? this.attackDistance ?? 默认值`。带地面椭圆圈视觉的范围技能（砸地冲击波/嚎叫/燃烧区）保留椭圆。
2. **新怪物矿石蜘蛛（oreSpider，精英/僵尸）**：投掷晶石（600px 触发、28 帧第 21 帧发射、1s 抛物线+360°/s 旋转、落地红圈警示+100px 物理×1.25+烟尘）；起跳下砸（18 帧第 10 帧阶梯判定 200×2/350×1 不叠加+红圈提示+命中眩晕 2s）；临终一砸（attacking-2 播 14 帧含判定→dying 12 帧→定格 1s→淡出）。精英战抽中它时其余普通怪固定矿工僵尸。
3. **新地牢沼泽地-高级（swamp，C 级）**：55~60 房间、起始 4 路线、怪物/事件/Boss 全用僵尸体系（`_isZombieFamily`+事件 family 映射+'swampDungeon' 配置块）、地板 swampbrick_1/2/3 随机拼接。
4. **系列修复**：玩家流血不扣血（基类 _updateBleed 扣 this.hp 而玩家真实 HP 是 data.hp；玩家专属流血/中毒块+无敌闸门）；无敌开关全场景生效；`colliderOffsetY` 必须写 render 块（核心规则 6）；AttackRangeEffect 警示圈 depth 统一 y-998（实体之下）且保活必须重置 `life`（不是 maxLife）；AI 素材对齐前先提高 alpha 阈值区分本体与残影。
5. **工头鞭子特效重写**：扫掠扇面+柄粗梢细+末梢爆点，220ms，每次鞭击一条。

#### 关键改动文件
- `src/entities/enemy-types/ore-spider.js`（新增）、`_shared/enemy-utils.js`
- `src/entities/damageable-entity.js`（状态免疫 statusImmune）
- `src/entities/player/update.js`、`src/entities/player/subsystems.js`
- `src/effects/attack-range-effect.js`
- `data/enemy-config.json`、`data/dungeon-config.json`
- `src/config/dungeon-config.js`、`src/world/dungeon-map-system.js`、`src/world/dungeon-event-system.js`、`src/world/zombie-dungeon.js`
- `src/phaser/scenes/BootScene.js`、`src/game.js`

#### 验证状态
- `npm run lint` ✅（0 error）
- `npx vite build` ✅
- `node scripts/test-collider.mjs` / `test-craft-sync.mjs` ✅

---

