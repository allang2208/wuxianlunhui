> 本文件为 game-dev 技能库分卷，主索引与目录见 ../SKILL.md
> 本节：7. 世界-122 防守地图

## 7. 世界-122 防守地图

### 敌方攻城预设复用玩家城防

以下为本地`StrategicSiege`接入合同；认可布局与尚未发布的公共依赖见`docs/strategic-siege-presets.md`、`docs/strategic-siege-publication.md`，不代表实战验收。

- 墙、四格门、楼梯复用`DefenseCover/BuildableGate/WallStaircase`；塔楼复用`ProducerBuilding`的占格、塔顶节点、前缘与坍塌。敌方预设不登记玩家生产列表、不执行生产升级循环、不受玩家科技换材质/HP、不计费退款，仍保留受击和状态更新。构造前预载主体及前缘层；互相导入的模块延后到建城时定义派生类，避免初始化循环。
- 2×2塔楼使用建筑前顶点锚定，不能把后格中心直接当建筑锚；当前格网下相差96px。通过`buildingRoadLayout`取真实覆盖格并省去重叠外围墙，不缩小逻辑占地来凑视觉。塔顶250、普通墙顶125，接缝遵守现有承托协议，不额外添加传送或自动武器。
- 楼梯从承托墙按格轴/朝向向内生成两段，各升62.5至墙顶125。出生、近战集结和墙顶射手岗位都预留地面入口、梯身及墙顶连接口；表面更新必须包含地面单位，才能走正常地面→楼梯接入。承托墙倒塌同步移除楼梯护栏与承托，不留悬空通道。
- `site.fortifications`以稳定的`wall_* / gate / stair_* / tower_*`键保存耐久；已有零HP记录不得重刷。旧档新增角塔继承覆盖旧墙的最低耐久比例，有已毁墙便保留缺口；缺楼梯记录时仅在承托墙存在且存活时补入。布局升级不能免费补满城防。
- 结果写回原战役入口；退出按本场实体身份释放墙、门、楼梯、塔顶节点和寻路占格，不清空全局建筑/楼梯表。城防不自动成为新的胜利目标，静态图中的半透明剖示不进入游戏。

### 出兵建筑详情面板冷钢排版（2026-08-21）

- 仓鼠兵营与配置型出兵建筑使用统一语义类：`troop-panel-section-title`、`troop-panel-copy`、`troop-panel-*-meta/caption`、`troop-panel-unit-button`；升级项目继续复用 `building-upgrade-card-*`。
- 字号只能走 `ui/panel-theme-backpack.css` 的冷钢令牌，并遵守单面板最多四档：面板标题 20px、栏目/项目标题 16px、正文与按钮 14px、元信息及辅助说明 12px；正文不得再降到 12px，说明不得再使用 10px。
- 普通说明和标签使用冷白/灰白。金币、能源、危险、成功、实时进度等确有语义的字段才允许使用对应状态色，不得用土黄或土绿表达普通层级。
- `.producer-building-panel` 会被多个系统复用，出兵专属视觉必须限定在动态类 `.is-troop-producer` 下，避免污染研究院、铁匠铺、仓库、传送门、位面祭坛和普通详情模式。

### 位面传送门与献祭建筑拆分（2026-08-22）

- `DefenseSystem.base` 在多位面常驻架构中是入侵目标传送门，只负责耐久、毁灭与入侵胜负；禁止再把它传给 `World122TributeSystem.openFor/setup`，否则 DefenseSystem 的高优先级点击会截走传送门旅行面板。
- 位面祭坛 store 是主神空间、scene8~scene11 和地牢的唯一祭品效果源；每件祭品默认30分钟并跨场景连续倒计时，不再冻结。主存档写剩余时长供读档恢复，运行中到期必须刷新玩家面板和友军 `updateMaxStats()`；刷新入口继续由 `tribute-effects` 向 store 单向注册。
- 献祭入口是 `producer-buildings.json.plane_altar`（显示名“位面祭坛”）：`panelMode:"tribute"`、仅 scene8、基础解锁、单座上限。它按普通 `ProducerBuilding` 参与建筑面板、2×2 占格、下沉清理和 `cfgKey` 快照恢复，不是防守目标，也不带 `_isWorldPortalCore`。
- `ProducerBuildingSystem.tryInteract` 是祭坛详情的唯一点击分发入口；出售/被毁必须调用 `World122TributeSystem.detachAltar`，失效实体不得继续献祭。同一稀有度只能生效一件，新祭品覆盖旧的同级效果并刷新为30分钟，因此最多6个生效槽；钥匙代币必须从献祭列表排除。
- `World122TributeSystem.teardown()` 只解除祭坛交互，不得清状态、冻结时间或丢弃 player 引用；世界蟠桃统一使用 `_worldPeachReviveUsed`，重新献祭蟠桃才刷新次数。
- 世界核心传送门使用稳定 id `world_portal_${sceneId}`，`portal` 配置单座上限；旧基础快照只允许按“出生点 + 零建造成本”迁移核心。核心及主城枢纽必须同时禁止详情出售和建筑回收旁路，普通 `cfgKey:"portal"` 不得仅凭数组顺序被提升为入侵目标。
- **核心传送门视觉唯一真源（2026-08-26）**：scene8~scene11 与主城枢纽共用 `producer-buildings.json#portal` 的 `radius/footprintCells/displayW/displayH/footOffsetY/visualFootprint`；全位面统一换图或改尺寸时只改这组共享配置，不再给单一世界复制 `world-system.json#worlds.*.coreVisual`，否则会留下不同位面尺寸漂移或旧 `visualFootprint`。构造器继续统一执行 `applyBuildingFootprint + setupStructureDepth`；`generate-building-preview-assets.mjs` 会为不可建造核心更新接地拟合清单，但因 `playerBuildable:false` 不生成建筑栏缩略图。只有某个位面确需不同贴图时才允许 `coreVisual`，并须让覆盖链完整同步 `visualFootprint` 后再启用。
- 祭坛详情沿用 `renderBuildingDetailHeader`，外壳使用 `.world122-altar-panel.bp-right-column` 和通用 `.bp-panel-* / .bp-type-*` 冷钢组件；动态值只允许内联生命条宽度/语义状态色，禁止在业务模板重新硬编码字号和整套色板。

### 世界-122 防守地图（雏形，2026-08-04）

主神空间传送门 →「世界-122」（scene8，原沼泽地改名）。防守玩法第一版，纯代码零新素材。

#### 基地区域（scene-manager `_loadScene8`）
- 沙袋矩形围栏（1508/2588 × 1780/2820）：北/南边横向沙袋、西/东边旋转 90° 沙袋，
  两端延伸封死四角；**南侧留真实缺口当门口（≈352px）——不要摆门件**：门贴图
  （hub_gate/swamp_gate）可通行门洞只占贴图跨度 8%~21%，按门口尺寸摆会堵死入口。
- 沼泽柴墙三瓦片后墙（完整落在基地北侧，30° 地板线）+ 拒马门口内侧路障。

#### 刷怪波次（`src/world/defense-system.js`）
- 边界 8 个刷怪点；`MONSTER_POOL` 按「类型 × 权重」加权随机生成，**只生成可移动怪物**
  （站桩：矿洞/墓碑/煮锅/集合体排除）；波次随用时成长（HP +16%/波、攻击 +8%/波、
  数量递增、间隔缩短有下限、场上存活上限 40）。
- 怪物标记 `_preferDefenseTargets = true` → 只锁定基地/防御塔（`PerceptionSystem._isValidTarget`
  与 `Enemy._findNearestPlayer` 已加守卫），不追玩家；基地核心被摧毁 → 防守失败、停波次。

#### 防御塔（DefenseTower，复用 Combatant）
- 独立装备栏：背包内**远程武器、手枪除外**（bow/pkm/akm/qbz191/qjb201/shotgun/energy_lmg）；
  弹道/开火特效直接复用 `Combatant.fireProjectile` + `EffectFactory` 枪口火焰/弹壳 +
  `GameScene.playMuzzleFire`（不需要新素材）。
- 每发伤害 = 武器基准 × 玩家六维加成 × (1 + 0.22×(等级−1))；升级=金币（120×1.55^(L−1)，
  满级 10），同时提升耐久；点塔弹出面板（装载/卸下/升级），卸下归还背包。
- 塔渲染走 `_syncNeutralEntities`（spriteCfg 贴图复用：石柱/祭坛，`sizeH` 支持等比非方形）；
  深度按脚底 Y 参与墙体排序。**2026-08-04 生图入库**：防御塔专用贴图
  `obstacle_defense_tower.png`（基座 + 上方机械臂空置武器挂载点），塔 spriteCfg 已切换。

#### 掩体（DefenseCover，可被攻击的防御墙段，2026-08-04）
- **生图**：dev+mesh 批量（`tools/ai-gen/gen-world122-assets.py` + `prompts/cover.md`），
  F→A 六档 × 水平摆(_h)/垂直摆(_v) 共 12 张；视觉基准=游戏墙体 30° 底边。
- **斜向坑**：FLUX.2 不区分 h/v 斜向（全部产出 "/"）→ 处理脚本将 _h 组水平镜像归一为 "\"
  （`tools/ai-gen/process-world122-assets.py`）；入库 `assets/terrain/obstacle_cover_<grade>_<orient>.png`。
- **数值**：hp = F400/E700/D1100/C1600/B2200/A3000，**def/mdef 均为 0**（怪物全额伤害）；
  `_isDefenseStructure=true` 供怪物锁定攻击、`immovable=true` 不可击退/位移、
  `_noShadow=true` 无脚底阴影；碰撞 footprint 见 `COVER_FOOT`（198×133、thick=26）。
- **摆放**：基地菱形房预置（见下节「路线 B 最终管线」）；玩家 B 面板自行加建。

#### 掩体最终管线（路线 B）与基地菱形房 v2（2026-08-05 定稿）
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
- **E/C/B/A 强化重做（2026-08-05 三版）**：用户反馈“体现不出墙壁强度”→ 只重做
  E/C/B/A（F/D 保留），48 步 + 颜色分级：F 白灰 / E 沙色米黄+橄榄绿沙袋 /
  D 暖灰红砖 / C 冷灰蓝混凝土+锈钢板角件 / B 深钢蓝炭黑铆接钢板（砖格 60%+钢板 40%）/
  A 黑砖+蓝色发光符文（符文画在砖面）。提示词先写砖格再写强度元素（防钢板/符文盖掉
  网格，第一版 B/A 网格被盖，FFT 周期弱于直墙基线）；旧版备份 `.bak.brick2`。
  **校验铁律**：强度元素必须“砖格为主、元素为辅”，FFT 双轴峰值 ≥ 直墙基线（~0.03）
  才算过；GLM 缩略图误读网格，必须放大单看砖缝。
- **E/C 修复 + 8 角圆角（2026-08-05 四版，用户先让全网查墙壁贴图做法）**：
  - 行业做法（全网检索）：墙体贴图走“UV 映射 + 烘焙”管线，中段用 tileable 纹理、
    端头/转角用 trim；材质配 PBR 通道；白色残留 = 生成时背景色/alpha 问题，须在
    纹理层消除（渲染成品 0% 白为准）。路线 B 符合该方向（几何 Blender 控制 + AI 只出材质）。
  - E 修复：沙袋固定“仅顶部一行 + 砖格铺满其余”，提示词加 `sandbags only at the top edge,
    no sandbags elsewhere` + `no white background, no pure white areas`（旧版沙袋乱入
    墙体中部/白色残留即“贴合位置错误 + 看到白底”的根因）。
  - C 修复：加 `bright even lighting with subtle highlight and shadow detail, high contrast
    between concrete blocks and mortar lines`（旧版灰闷无层次）+ 钢板改小点缀不盖砖格。
  - **8 角圆滑（用户要求尝试）**：Blender box 加 `bmesh.ops.bevel(affect='VERTICES')`，
    只圆 8 个顶角、不动长棱边（保住底边直线）；bevel=10 世界 px、segments=3，
    先 `transform_apply(scale)` 再 bevel（否则偏移随非均匀缩放）。圆角后底边端点复标
    A(-88,-21)/B(88,-108)、sizeH 259（aspect 1.004），拼接仍连续（40px 端帽叠合覆盖圆角）。
    旧版备份 `.bak.bevel`。
- **⚠ 重大根因：Blender 默认 cube 的 UV 是 3×2 分块布局（2026-08-05 五版修复）**：
  新建 cube 的 UV 不是每面 [0,1]²，而是每张面只采样纹理的一小块——材质贴图
  **只有上半部分被显示**（砖墙上下纹理一致看不出来，E 级沙袋"位置错误/露白"暴露）。
  修复：`render-cover-real.py` 新增 `box_full_uv()`——每个面按局部主轴投影归一化到
  [0,1]²（V 轴优先世界 Z 朝上），纹理顶部始终在墙顶；bevel 后同样适用。
  验证方法：方向标记测试纹理（上洋红/下青色/中黄线）渲染后沿中列采样——修复前只见
  洋红，修复后正面自上而下完整显示洋红→黄→青。**此后任何 Blender 立方体资产
  必须检查 UV 是否为整图映射，不能再吃默认 cube UV**。旧版备份 `.bak.uvfix`。
- **E 改砂岩墙 / A 改大符文（2026-08-05 六版）**：E 级放弃沙袋（用户认为沙袋还有
  优化空间，先不做）→ 纯**沙色/米黄砂岩砖墙**（sandstone brick wall, warm sand and
  beige tones, no sandbags）；A 级符文放大：`one single large glowing blue rune
  engraved across the center, exactly one large rune, no small runes, no repeated
  runes`——成品正面 1 个大符文（顶面映射 1 个，共 2 个），符文约占正面 1/4~1/3。
  旧版备份 `.bak.sandrunes`。验证：GLM 确认 E 无沙袋/砖格规整、A 大符文单点不密集；
  白色像素 0%、MIRROR 对、拼接像素、实机审计全过。
- **变体随机贴图库（2026-08-05/06 七版）**：每级 5 个"高度类似、细节微调"变体
  （v1=定稿；v2~v5 由 `VARIANT_SUFFIX` 微调砖色/磨损/苔藓/色温，A 级由
  `A_RUNE_VARIANTS` 随机替换大符文形态：棱角/圆形/菱形/十字）。
  生成：`gen-cover-textures.py --variants 5 --from-variant 2`（v1 从定稿 tex_<g>.png
  复制保留）；渲染 `render-cover-batch.py FEDCBA 5`；入库
  `obstacle_cover_<g>_v<n>_v/h.png`（v 原样 + h=flip，共 24 变体 × 2 向）。
  游戏集成：BootScene 加载 v2~v5 变体；`DefenseCover` 构造时
  `variant = 1+floor(random()*5)` 随机选贴图（v1 无后缀，v2+ 带 `_v<n>_`）——
  同一房间/防线的墙段不再千篇一律。实机验证：14 件 D 掩体随机分布到 5 变体。
  **mesh 弃用（2026-08-05 实测）**：mesh（Icarus@5080+Daedalus@3080Ti，8 步 Turbo）
  单张 283s vs 5080 单机 fp8 48 步 84s——mesh 更慢 2~3 倍（通信 + 服务端弱卡），
  仅适合"主卡显存装不下大模型"的救急，纹理批量继续 5080 单机 fp8。
- **祭坛/仓库 Blender 重做（2026-08-06 八版，建筑管线）**：
  - 视角体系定论：墙/掩体=等距 2.5D（30° 俯仰、可见顶面）；人物/防御塔/祭坛/仓库=
    **正面平视 billboard、平底**（2.5D 惯例：地形等距 + 立绘建筑，不冲突；
    红线=建筑顶面可见度勿超过墙量级，防御塔 45° 等距版即因此被否）。
  - 新工具 `render-building-real.py`：多 box + prism（三角棱柱坡屋顶）组合、
    每部件独立材质纹理、相机俯仰默认 5°（最多一条极窄顶边）、无阴影、透明底。
  - 祭坛=多层台座+中央碑（大理石+金饰+蓝宝石 AI 材质）；仓库=木屋 box+坡屋顶 prism。
  - **标定**：内容底边比例 cb（如 0.8506）→ `sizeH = size×内容高/内容宽`、
    `footOffsetY = sizeH×(cb−0.5)`；更新 `data/` 与 `public/data/` 双份 game-config.json。
  - 验证：Phaser 层查 texture/sprite 创建与显示参数（headless 截图相机常偏，别依赖；
    GLM 对"平视 vs 俯视"判断不稳，坡屋顶坡面易被误读为等距顶面）。
  - ⚠ **2026-08-06 用户验收不合格 → 已整体还原**：祭坛/仓库图片与标定全部回退到
    ec069a7 之前的原版（祭坛 411KB/512×497 紧贴裁剪、仓库 176KB/宝箱容器风格），
    `git checkout ec069a7^ -- assets/npc/altar.png assets/npc/warehouse/warehouse.png
    data/game-config.json public/data/game-config.json` 四件套；`sizeH` 字段移除后
    GameScene `sprCfg.sizeH || sz` 自动回退方形显示，无需改代码。新 Blender 版
    （仓库木屋/多层台座）保留在 git 历史可查，不删。
- **红狼王 H3 全动作升级（2026-08-06 九版，视频→精灵图）**：
  - 10 段 H3 首帧循环视频：狼 idle/walk/run/飞扑挥爪/飞扑撕咬/变身 + 红狼人
    idle/run/挥爪攻击/仰天嚎叫；**优化配置 1024×576 + 16 步 = 6 分钟/段**
    （原 1344×768+20 步 17 分钟，快 2.6 倍；H3 最短可靠 124 帧，循环靠截取）。
  - 切帧帧数（h3-loop/h3-attack）：狼 walk P=34→11 帧(4×3)、run P=14→7 帧(7×1)、
    红狼人 run P=24→12 帧(7×2)；攻击/变身/嚎叫各 12 帧(4×3)；idle 抽 1 帧静态。
  - **cv2.imwrite 中文路径静默失败（不回错误）**：切帧输出必须走 ASCII temp 再拷回
    （tools/h3-*.py 输出到 `%TEMP%/world122-cover`）。h3-loop-spritesheet 补了
    末行不足 cols 时补透明格（11 帧 4×3 场景会崩 vstack）。
  - RedWolfKing 类重建（extends BlackWolf）：HP≤50% 触发 2s transform →
    红狼人形态（伤害×2、回血、先 howl），狼形态双攻击
    pounceClaw(远/飞扑挥爪)/pounceBite(近/撕咬)；animation-config 双份校准
    frameLayouts/attackTypes/transformedFrameLayout；BootScene 注册 10 纹理键。
  - 实机验证：狼形态 + 变身红狼人均正常渲染、无报错；测试/构建全绿。
- **红狼王抠图+体型修复（2026-08-06 十版）**：
  - **白底残留**：切帧阈值 248 会留下压缩伪影白边/半透明白边。修复：cv2
    `connectedComponents` 对"不透明且 rgb>200"做 4 连通标记，凡连通帧边缘的
    连通域置 alpha=0（flood-fill 思路，但纯 Python BFS 太慢会超时）；主体内部
    浅色毛不连通边缘，安全保留。处理后全部贴图 `white_total=0`。
  - **红狼人太小（108 宽 vs 狼 317 宽）**：H3 参考图把红狼人画瘦了。重生成
    参考图（提示词加强 broad-shouldered / heavily muscular / bulky / large
    imposing frame）→ 4 段视频重生成 → 重切帧，红狼人 108→161 宽（人形
    宽高比 0.61 协调）。**视频模型受参考图体型影响极大，人形参考必须先做壮**
    （宽度目标 ≥150/262 高）。
  - 实机验证：变身红狼人新贴图、纹理匹配、大小协调、无白边；测试/构建全绿。
- **红狼王狼形态大小统一（2026-08-07 十一版）**：
  - 用户反馈"狼形态大小不一"：idle 317×260 / walk 354×253 / run 422×242 高度宽度
    都不齐。根因：`--fixed-scale` 保留视频内狼的绝对尺寸，但 H3 各视频中狼体型
    漂移不同；逐帧 target_h 又只统一高度、宽度仍随视频。
  - 修复：**全部狼形态动作用 target_h=262（非 fixed-scale）+ attack 工具
    `--fixed-scale 0`**，与黑狼管线一致 → 高度全部 262、宽度随姿态
    （idle 317 / walk 356 / run 430 / 前扑 369~413，黑狼同款惯例
    idle 408 / walk 415 / run 458）。
  - run 视频 H3 固有水平拉伸（v2 提示词加 "body stays compact" 仍 430），
    与黑狼 run 458 同量级，接受为奔跑姿态；GLM 把低伏 run 误读为"最小"，
    以像素高度为准。H3 参考图宽高比 1.22（站立狼正常），黑狼 1.56 是姿态差异。
- **红狼王 idle/攻击重做（2026-08-07 十二版，套黑狼白边+大小经验）**：
  - **攻击必须 `--fixed-scale 1`（首帧同比例）**：之前错用 0（逐帧 target_h）
    导致 pounce_bite 413 宽 vs idle 317（+30%）。fixed-scale 后 claw 345 / bite 355
    vs idle 318（+9~12%），与黑狼 pounce 458 vs idle 408 同款；高度 247/227
    是前扑压低姿态（黑狼 224~261 同理），基础体型恒等。
  - **白底必须 BiRefNet**：阈值 248+max 合成会把 235~248 灰白压缩背景判成主体
    （alpha 255 白边）。修复（`rebuild-h3-birefnet.py` 新增）：阈值兜底只对
    深色区（gray ≤ 阈值-13）强制主体，灰白区交给 BiRefNet；alpha = max(BiRefNet,
    深色阈值)；去污染 lum>150 且 alpha<250 半透清零。修复后近白半透
    21763→14823（占 0.5%，余为浅毛软边），GLM 确认无白边。
  - idle 同管线重做（318×262，与攻击/步态高度一致 262）。
  - 跑 BiRefNet 用 ComfyUI venv python（系统 python 无 transformers）。
- **红狼王蓝色 bug + run 脚步白边（2026-08-07 十三版）**：
  - **攻击全蓝根因：cv2.imwrite 按 BGR 解析数组**——rebuild 脚本把 RGB 数组直接
    `cv2.imwrite` → 通道翻转，红狼变蓝。修复：`Image.fromarray(sheet, "RGBA").save()`
    （PIL 正确解释 RGBA）；所有 BiRefNet 重建 sheet 必须 PIL 保存，禁止 cv2.imwrite。
  - **run/walk 高度被切（204 高）根因二连**：① 去污染 lum>150 太激进切浅色毛
    → 改 200（只清近白边）；② **bbox 用 `gray<248` 把画布顶部 235~247 灰白噪点
    圈进 bbox（y0=0）导致狼被压缩** → bbox 改用合成 alpha（>30）。
  - 修复后：run 433×262、walk 368×262、claw 344×246、bite 354×226
    （步态高度统一 262，攻击为前扑压低姿态，黑狼同款）；毛色深红正常；
    近白半透 0.5%（浅毛软边，黑狼基准 <1%）；GLM 确认脚步无白边。
- **红狼王 idle 蓝色残留 + 攻击身高统一（2026-08-07 十四版）**：
  - **idle 仍蓝**：idle 是早期 cv2.imwrite bug 版本，重生成（PIL 保存 + uniform-h）
    后 RGB [90,18,18] 正常；**入库必须核对入库后的文件**（此前一次入库因
    Python cwd 相对路径失败，assets 里还是旧蓝版——GLM 复核才暴露）。
  - **撕咬 vs idle 身高差 15%（226 vs 262）**：H3 撕咬前扑固有压低，重生成视频
    （提示词 keep body tall / no extreme lowering）仍 223。**治本=全部狼形态动作
    uniform-h 统一高度 262**（黑狼同款）：idle 320 / walk 368 / run 433 /
    claw 371 / bite 432，高度全 262；宽度随姿态（站立窄、前扑/奔跑伸展）。
    H3 视频内狼大小漂移是生成特性（run 首帧 471→中段 631 宽），切帧只能
    统一高度，宽度差异读作姿态；黑狼 idle 408 / pounce 458 同样 +12%。
- **红狼王双攻击完整重建（2026-08-07 十八版，撕咬补帧+攻击链路修复）**：
  - **撕咬贴图中间行全空根因**：原采样帧列表漏掉扑咬爆发段（视频 28~48 帧），
    且爆发帧宽超 512 格会裁切/空行。重建：`rwk_pbite.mp4`（%TEMP% 留存）+
    `rebuild-h3-birefnet.py`，采样覆盖爆发段（6,14,22,28,32,36,40,44,52,62,74,85），
    **格子放大到 576²（--cell 576 --center-x 288）**，12 帧全满、高度统一 261；
    BootScene 该贴图 frameWidth/Height 同步 576（其余仍 512²）。
  - **pounceClaw 播不出来的根因（代码层）**：黑狼状态机 `_startBite/_startPounce`
    不设置 `_attackType`，原 RedWolfKing 只在死代码 `triggerWeaponAnim` 里切——
    通用战斗系统被 aiInterval=MAX_SAFE_INTEGER 禁用，永远不触发。修复：
    RedWolfKing 覆写 `_startBite→pounceBite`、`_startPounce→pounceClaw`。
  - **attack 帧数落回 8 帧的根因**：RedWolfKing 构造器在 `super()`（黑狼构造器）之后
    才重设 `_animCfg`，但没重取 `_frameLayouts/_frameDurations` → 一直用黑狼表，
    pounceClaw/pounceBite 键不存在 → 兜底 8 帧，撕咬永远播不到爆发段。
    修复：构造器重设 `_animCfg` 后同步重取 frameLayouts/frameDurations。
  - 攻击节奏：bite 1.2s/12 帧（100ms/帧，命中窗 42%~75% 落在扑咬爆发段）、
    pounce 蓄力 900ms + 冲刺 900ms（4+8 帧）；pacing/walk 修正为 14 帧（4×4，
    原配置 13 帧 4×3 与实际 14 有效帧不符，末帧被丢弃）。
  - **vite JSON 缓存坑**：改 `data/*.json` 后若 `animation-config.js` 服务端仍带旧
    `?t=`，页面 import 会拿到旧数据（实测 attackTypes 少新键）——touch 文件触发
    失效即可；双份 data/ + public/data/ 都要改。
- **红狼王全套抠图清理（2026-08-07 十九版，套黑狼 CLEAN 铁律）**：
  - 用户反馈抠图有问题。用黑狼判据跑全套 10 张：**全部 DIRTY**——
    run stray 1792 / edge_bright 2.5 万 / composite 843，其他张同量级；
    trans_nonblack 1.7 万~82 万（透明区 RGB 残留）、semi 数百~3 万。
  - 边缘亮像素定量：均值 RGB ~(200,184,186) 灰粉（背景白×红毛混合），
    内邻毛色 (128,89,94)，**边缘无白毛** → 可安全压暗还原。
  - 工具 `tools/ai-gen/rw-cutout-clean.py`（复用黑狼 post_clean_sheet 五步：
    alpha 硬二值化 245 → 每格最大连通域 → 透明区 RGB 归零 → 腿部 5×5 毛色均值），
    **差异点：边缘亮像素用 5×5 邻域毛色均值还原，不用黑狼固定 18**
    （固定 18 会把红毛压成黑点）；兜底深红 (90,18,18)。
    注意 pounce_bite 是 576² 格（cell=576），其余 512²。
  - 清理后 10 张全 CLEAN（stray/semi/trans_nonblack/edge_bright/composite 全 0），
    GLM 合成灰底预览 + 实机截图均无白边/白点/脚底灰圈，狼身完整无洞。
- **红狼人形态独立显示尺寸（2026-08-07 二十版）**：
  - 红狼人贴图本身够壮（172×259），但上屏与狼形态共用 spriteSize 151 → 内容
    只有 ~51px 宽，看起来比狼还小。新增 `render.transformedSpriteSize`（默认 200，
    data/ + public/ 双份），变身态按此重算 displaySize（200≈+32%），实机红狼人
    明显高于玩家/普通怪，有压迫感。
  - 实现：RedWolfKing `_getPhaserOptions` 覆写（变身态替换 spriteSize）+ 兜底
    `_drawSheetFrame`（canvas 路径按同一尺寸/偏移等比缩放）。
  - **vite 对 data/*.json 模块缓存可能滞后**：改 JSON 后代码内用 `?? 默认值`
    兜底保证生效（本次 JSON 加了键但页面仍读到旧模块，靠代码默认 200 落地）；
    最终以 JSON 为准需重启 dev server 或等缓存刷新。
- **红狼王变身期锁移动 + 减伤 90%（2026-08-07 二十一版）**：
  - 需求：变身动画期间不可移动、减伤 90%（站着挨打也站得住）。
  - 实现：变身期 `_frozenForCast=true`（MovementSystem 每帧 return，真锁移动，
    不是只清零 vx/vy）+ 终止进行中的撕咬/飞扑（_endBite/_endPounce 会清
    frozenForCast，顺序必须先终止再上锁）；嚎叫期沿用同锁。
  - 减伤：覆写 `takeDamage`，在暴击计算前 `damage × (1 - damageReduction)`，
    默认 0.9，`transform.damageReduction` 可配（animation-config/enemy-config
    data+public 双份四文件同步）。
  - 实机验证：变身中 frozenForCast=true、vx=vy=0、takeDamage(100) 实际掉 10；
    变身+嚎叫结束解锁，红狼人 200 尺寸/攻击/移动正常。
- **红狼人 v2 统一体型（2026-08-08 二十二版，方案 A 重生成）**：
  - 根因：三个红狼人 H3 视频本身体型不一致（待机视频最瘦 ~371 源宽、run ~559、
    attack ~482）→ 切帧后 idle sheet 176 宽 vs run/attack ~257，游戏里待机时人形
    ~69px、跑攻突然 ~100px（+45%），看起来像截取错乱。应用链无问题。
  - 修复：统一参考图 = rwk_tatk 视频 f10（最壮站立帧，GLM 选定），裁 1024×576
    白底；run/attack 用 `minimax-h3-gen.py --first-frame/--last-frame <同一参考>`
    重新生成（i2v 锁体型，1024×576/16 步/124 帧）；idle 直接裁参考图。
  - 产物：idle 261×260、run 14 帧 7×2（步态周期 P≈25，step 2 覆盖一个周期，
    loop IoU 0.717 > step 0.603）、attack 12 帧 4×3；三张 uniform-h 262、脚底 410、
    CLEAN 五指标全 0、GLM 通过；实机红狼人三态体型一致且魁梧。
  - 新工具：`rw-humanoid-idle-cut.py`（单帧静态裁剪）、
    `rw-normalize-cell-height.py`（逐格高度归一化——BiRefNet bbox 被脚底噪声拉高
    导致该格主体偏矮 206~221 的补偿，清理后再归一化一次）、`rw-humanoid-deploy.ps1`。
  - 坑：远程 ComfyUI 崩溃（进程在但不监听）→ SSH 断连会杀会话进程树 →
    必须用 `schtasks /create + /run` 计划任务启动；系统 python 缺 sqlalchemy，
    必须用 `D:\开发文件\ComfyUI\.venv\Scripts\python.exe`；远程操作中文路径
    用 UTF-16LE base64 `-EncodedCommand` 绕过引号/GBK 坑。
- **红狼人抠图规则修正 + 形变修复（2026-08-08 二十三版）**：
  - 用户反馈：没按 SKILL 抠图规则（红狼王不能套黑狼硬边），且大小形变严重。
  - **抠图规则**：红狼王 = 保留浅毛软边（semi≈0.5~1%）+ 去污染，不是黑狼硬二值化
    （semi=0 会把浅毛削平、边缘生硬）。`rw-cutout-clean.py --soft`：
    ① 半透反推前景色 F=(C-(1-α)B)/α（B=255），反推后仍亮(>165)=未分离残留清零；
    ② **composite 判据后处理**：软边中合成到灰底显白（lum>175）的半透像素清零，
       深色毛软边保留 → composite=0 且 semi 保持 0.5~1%；
    ③ 每格最大连通域 / 透明区 RGB 归零 / 边缘亮像素局部毛色 / 腿部去残留照旧。
  - **大小形变根因**：视频源红狼人体型稳定（源宽 spread 仅 8%），是 **uniform-h
    把矮帧放大导致 sheet 宽度暴涨**（估计 spread 23~45%）。修复：
    **fixed-scale（首帧同比例）+ `rebuild-h3-birefnet.py --fixed-bbox`
    （全序列联合 bbox 固定裁切/腿部兜底区域，防 BiRefNet 单帧 bbox 收紧裁掉
    肢体尖）**。结果：idle 261 / run 255~271（spread 6%）/ attack 259~280
    （spread 8%），高度随姿态自然起伏（run 186~217、attack 208~260）。
  - 实测：三态全 CLEAN（stray/trans_nonblack/edge_bright/composite=0）、
    semi 0.66~0.86%、GLM 确认体型一致、脚腿完整、毛发边缘自然、实机无白边。
  - 注意：`--fixed-bbox` 的 bbox 顺序是 (x0,y0,x1,y1)，解包时勿写成 (x0,x1,y0,y1)
    （写反会裁空报 cv2 resize error）。
- **红狼全套 RMBG 重抠 + 脚部阴影清理（2026-08-08 二十四版）**：
  - 用户反馈"脚步还有大量色块"。定量定位：**H3 白底视频自带地面接触阴影**
    （灰/黑，底部 30px 每帧 1800~3800 暗像素），抠图把阴影当主体保留为不透明
    灰黑像素（狼脚带 60~78% 低饱和；还有纯黑 0,0,0）。
  - 工具 `tools/ai-gen/rw-rmbg-recut.py`（黑狼 RMBG 方案的红狼版）：
    白底合成 → 每格 ComfyUI-RMBG `AILab_BiRefNet`（BiRefNet-general，process_res
    1024）→ **alpha = max(alpha_b, 全部旧 alpha)** —— 红狼软边（30~247）也是
    有效主体，不能像黑狼只留 >=248，否则软边被 BiRefNet 更窄分割裁掉（宽度
    261→183 实锤）；黑狼硬边才用 >=248。
  - **脚部阴影清理**（rw-cutout-clean.py）：内容底部 40px 带内，低饱和
    （sat<15，R≈G≈B 灰/黑）不透明像素直接抠掉；深红毛 sat≥19 保留；
    剔除后再 max-component 清碎片（避免阴影断开产生孤岛）。**别用
    "BiRefNet 分歧"判阴影**——BiRefNet 对深色腿 alpha 不稳，会把真腿当阴影删。
  - 验证：10 张 stray/trans_nonblack/edge_bright/composite=0；狼脚灰影
    78%→0、纯黑 19k→0，人形灰影归零；GLM 脚部干净、脚完整无缺角；尺寸保持
    （idle 261 / run 255~271 / attack 259~280）。
- **红狼人两足奔跑 v2 重生成（2026-08-08 二十五版）**：
  - 需求：两只腿奔跑、透视一致、白底、抠图走 ComfyUI-RMBG 插件。
  - 提示词要点（prompts/rwk-humanoid-run-v2.txt）：bipedal running / full body
    side view / body stays compact and upright / **consistent body size and
    perspective throughout** / **no shadow, no contact shadow, no ground
    shadow** —— 源视频底部暗像素从上一版每帧 1800~3800 降到大部分帧 0
    （脚部阴影根除，不再是"抠图阶段补刀"）。
  - 切帧：fixed-scale + `--fixed-bbox` + 步态周期 P≈25（step 2 覆盖一个周期，
    14 帧 7×2）→ run 内容宽 260~290（spread 12%）、高 243~263，透视一致。
  - 抠图：`rw-rmbg-recut.py`（ComfyUI-RMBG BiRefNet-general）+ `--soft` 清理 →
    stray/composite=0、脚部低饱和 0.2%、GLM 确认两足奔跑/体型一致/脚部干净。
- **红狼人粉红边缘残留清理（2026-08-08 二十六版）**：
  - 用户反馈"红色色块没扣干净"。定量定位：轮廓有一圈 **粉红边**（内部毛色
    (45,8,10) 深红，边缘 (147,118,123) 粉红、lum 120~150、alpha 0.84~0.88 半透），
    在深色地板上显粉红色块。
  - 根因：BiRefNet-general 给近不透明边界留了 0.84~0.88 半透 + 去污还原出的
    边缘色偏粉；且原边缘亮像素阈值 150/140 都没覆盖 lum 120~140 区间。
  - 修复（rw-cutout-clean.py --soft）：
    ① 半透 alpha 200~244 的近不透明像素直接转 255（本质是毛像素，BiRefNet
       边界抖动，保留半透必然和地板混合显边）；
    ② **边缘亮像素阈值降到 90**，整圈粉红边（lum 120~150）按 5×5 局部深红
       毛色还原。
  - 验证：edge lum>90=0、semi_red 526→27（余为深红软边，SKILL 允许）、
    深色地板合成残留 0；GLM 在深灰底会误读深红毛为色块，以像素为准，
    实机截图确认无粉红描边/脚部干净。
- **红狼脚底"深色描边"根因 = 固定色压暗 + 硬边（2026-08-08 二十七版）**：
  - 用户反馈奔跑脚下轮廓没干净。逐像素定位：脚底最后一行全是固定 (90,18,18)
    深红（重抠 decontaminate 的 edge_dark 兜底），且 alpha 0/255 棋盘交替
    （近不透明 200~244 转 255 的硬边化）→ 人工深红描边 + 锯齿。
  - 修复：① `rw-rmbg-recut.py` 不再用固定 DARK_RED 压暗边缘（交给 soft 清理）；
    ② `rw-cutout-clean.py` 边缘还原兜底色 = **该格深红毛中位数**（非固定色）；
    ③ **去掉近不透明 200~244 转 255 的硬边化**——粉色问题靠边缘亮像素
    lum>90 还原成深红解决，软边保留（红狼王规则）。
  - 注意：**重抠输入必须是原始切帧**——旧资产已含固定色像素，重抠合并
    max(alpha_b, 旧alpha) 会原样保留旧色，须先还原到未压暗切帧再走管线。
  - 验证：fixed90=0、脚底最后一行 = (41,4,6) 主体深红、实机地板观感正常；
    GLM 在中/深灰预览底会把深红毛误读为"深色描边"，**以实机为准**。
- **红狼轮廓一圈亮红残留 (85,47,53)（2026-08-08 二十七版补）**：
  - 用户坚持精灵图可见"脚部一圈红色轮廓 + 零散红块"。逐像素定位：每帧边缘
    466~667 个亮红像素，均值 (85,47,53) vs 主体深红 (38,4,5)——白底×红毛
    混合残留，亮度 27~90 **低于旧阈值 90 漏网**（不是 GLM 误读，是查漏了）。
  - 修复（rw-cutout-clean --soft 3b/3c）：边缘不透明像素与"该格深红中位数"
    （lum<60 严格深红）的**欧氏距离 >35 → 还原成深红**；不透明偏离深红的孤立
    小连通域（面积<80）→ 透明。参考色必须用 lum<60 的深红中位数（<90 会混入
    浅毛导致阈值偏高失效）。
  - 教训：**"亮度>N"判定会漏掉比主体亮但仍<阈值的中亮残留**；用"与主体色差
    （欧氏距离）"更稳；GLM 深灰底误读≠没问题，用户肉眼在精灵图/浅底上
    看到的红轮廓是真实的，以用户实际看到为准去查。
- **红狼人抠图模型换代：BiRefNet-general → BEN2 + 打包版不同步根因（2026-08-08 二十八版）**：
  - 用户反馈"只扣了部分，还有很多没扣、现有方法解决不了"，要求全网检索更先进方案。
  - **全网检索结论**：插件 `ComfyUI-RMBG` 已内置候选（AILab_BiRefNet: general/HR/
    matting/ToonOut/Lucida；AILab_RMBG: RMBG-2.0/BEN/BEN2/INSPYRENET）。
    ToonOut（动漫/游戏专用微调，99.5% 精度）适合卡通素材；RMBG-2.0 数据更强；
    BEN2（22K 专有数据 + CGM 置信度引导）边缘最干净。
  - **实测结论（rw-rmbg-compare-models.py，GLM 四宫格验收）**：
    BiRefNet-general 有红晕边；ToonOut 残留最少但有白边；RMBG-2.0 红边明显、
    尾巴缺失；**BEN2 边缘最干净、身体最完整、无白边/红边 → 主抠图模型**。
  - **下载通道**：HF 直连/镜像不可达时用 **ModelScope**（modelscope.cn）：
    `1038lab/BiRefNet`（含 BiRefNet_toonout/Lucida）、`briaai/RMBG-2.0`、
    `PramaLLC/BEN2`；resolve/master/<文件名> 直接 curl 下载，~18MB/s。
  - **新管线 `rw-rmbg-birefnet-v2.py`**：白底合成 → 每格 BEN2(1024) →
    alpha=max(BEN2, 旧alpha) → decontaminate → **remove_foot_shadow**
    （内容底部 25% 带内 sat<15 且 lum<100 的暗灰黑块抠掉，防 H3 地面接触
    阴影被当主体保留，逐帧 4000px→0）→ `rw-cutout-clean --soft` 毛色还原。
  - 验证：run 14 帧 / attack 12 帧 GLM 全过（脚下零残留、无白边红边、身体完整）；
    changed_run/attack/idle 三张已部署到 assets 并同步 dist-electron-new 两个加载目录。
  - **重大根因教训：assets 更新 ≠ 游戏更新**。electron 生产模式加载
    `dist-electron-new/win-unpacked/resources/app/dist/assets/enemies/`（extraResources
    的 resources/assets 是第二份），8/8 凌晨打包版全是旧贴图（无半透、白边 1135、
    红色残留 18164、opaque 多 27 万 px）→ 用户"根本没改变"。**贴图改完必须同步
    assets + dist 两处 + dev server 验证 hash 一致**（curl 5173 与本地 md5 对比）。
- **狼形态 7 张贴图漏抠 + 旧 alpha 半透黑影残留（2026-08-08 二十八版补）**：
  - 用户仍反馈"脚下还是一堆残留"。复盘：上一版只重抠了**红狼人形态** 3 张
    （changed_run/attack/idle），**狼形态 7 张（idle/run/pacing/pounce_claw/
    pounce_bite/change/howl）完全没重抠**——游戏里红狼王平时就是狼形态行动，
    用户看到的正是这些旧贴图脚下 200~600px/帧 的暗灰阴影（run 总计 4879px、
    pacing 6408px）。
  - 新修复（rw-rmbg-birefnet-v2.py 增补）：
    ① **remove_dark_semi**：全图清除低饱和（sat<15）暗（lum<100）半透明像素——
       旧 alpha 被 max(alpha_b, 旧alpha) 原样保留的黑影（RGB≈0，alpha 5~250），
       在深色地板上显示浅灰块；深红毛 sat≥19 不受影响。
    ② JOBS 扩展到全部 10 张（狼形态 7 + 红狼人 3），统一 BEN2 + 阴影清理 + soft。
  - pacing 布局 4×4 但 frames=14，r3c2/r3c3 是未读取的第 15/16 格——里面残留
    45k 半透像素，直接整格清零，避免文件级检查误报。
  - 验证：狼形态 run 16 帧 / pacing 14 帧 / pounce / change / howl 全部 GLM 通过
    （脚下零残留、无白边红边、身体完整）；10 张贴图 assets + dist 两处 SYNCED；
    dev server 与本地 md5 一致。
- **红狼人奔跑脚部"大片灰粉块"根因 = 不透明中亮低饱和残留（2026-08-08 二十八版再补）**：
  - 用户仍反馈"脚部大片色块处理不了"（ACCEPT 图第 3 帧灰块、第 9 帧红块）。
    逐像素定位：每帧 145~344px **不透明**灰粉像素 (97,80,82)，位于脚掌/脚踝
    核心（非透明边缘），与深红毛 (34,2,3) 欧氏距离 128~255。
  - 为什么全部旧规则漏掉：① 5b 脚底带只覆盖内容底部 40px，灰粉块延伸到
    y 300~369（脚踝上方）超出 band；② lum≈86 低于旧阈值 90；③ sat≈17 高于
    旧阈值 15。三个条件同时不满足 = 漏网。
  - 修复（rw-cutout-clean.py 新增 5c）：**全格**（不限于底部 band）不透明 +
    低饱和（sat<25）+ 中亮（lum 40~160）+ 偏离深红毛 >40 → 统一染成该格
    深红毛中位数，保留 alpha（非边缘，删 alpha 会缺脚）。
  - 结果：10 张贴图灰粉块 run 14841→0、pacing 9831→0、change 10873→33、
    changed_run 3136→72（余为深红毛过渡）；不透明度不变；GLM 14 帧全过、
    第 3/9 帧脚部干净；assets + dist 两处 SYNCED。
  - 教训：**脚部残留不只在底部带**——中亮低饱和块会延伸到脚踝上方；
    "亮度阈值"和"底部带"两个维度都要放开，用"低饱和 + 偏离主体深红"双条件
    全格覆盖才不漏。
- **红狼王"底部像地面的大块色块"真正根因 = 游戏运行时椭圆阴影（2026-08-08 二十九版）**：
  - 用户多次反馈"脚下像地面的大块色块"，贴图 alpha 清理到 0 后仍存在。
    排查结论：**GameScene._syncEntityShadows 在运行时给每个敌人脚下绘制
    entity_shadow 黑色椭圆**（alpha 0.35，尺寸 = groundRadius×2 × ×2×0.5，
    红狼王 collisionRadius=45 → 90×45px），**完全不在贴图里**——抠图/清 alpha
    永远抓不到；且阴影固定跟随 collider，红狼王奔跑贴图上下弹跳时阴影不动，
    视觉上像贴图底部拖着一块地面色块。
  - 修复：RedWolfKing 构造函数设 `this._noShadow = true`（贴图自带脚部接地感，
    取消运行时阴影；GameScene 已支持该开关）。实机验证（cdp-redwolf-shot.mjs）：
    GLM 确认关闭后"脚下无深色椭圆阴影、浅色地面干净"。
  - 教训：**"色块残留"不一定是贴图问题——先实机截图区分渲染层阴影 vs 贴图
    alpha**；GameScene._syncEntityShadows 的 shadow 是通用机制，个别贴图自带
    接地感的怪可设 _noShadow。
- **黑狼绿幕重生成管线 + "脚底黑边"三连根因（2026-08-11）**：
  - 背景：黑狼老资产（白底视频+阈值抠图）白边/碎块/地面阴影条修不净，改治本：
    **绿幕重生成**（MiniMax H3 I2V，绿幕首帧 + `--bg-color 00FF00` 自动注入纯色底
    无阴影条款）→ `rebuild-h3-birefnet.py --bg-color '#00FF00' --bg-dist 80`
    （黑毛与绿底 RGB 距离 >200，距离通道=确定性硬切，无概率雾）。
  - 一键脚本 `tools/ai-gen/blackwolf-green-run.py`（生成+选帧+重建+后处理）；
    后处理 `tools/ai-gen/blackwolf-post.py`；首帧制作注意：源图脚底的抖动阴影条
    （~50% 密度点阵）会带进视频，须先开运算（`clean_sprite_matte.py`，对抖动
    点阵唯一有效，连续段/密度阈值都抓不住）+ 超宽行剥除。
  - 参数坑：绿幕狼更"长"，target-h 262 下宽 536~568 超 512 格 → clamp 丢整格
    （空格帧），run 用 **target-h 228**（最大宽 494）；`--edge-dark` CLI 传 -1
    关不掉 auto-clean 内嵌的 18（post_clean_sheet 不接 CLI），必须 `--no-auto-clean`。
  - **"脚底黑边类似地板"三连根因**（逐层排查，每层都是真问题）：
    ① 重建 `--edge-dark 18` 固定色压暗 = 红狼王二十七版同款人工描边（黑狼
       底行清一色 RGB 13~19 实锤）→ 禁固定色，边缘污染按**该格深色毛中位数**
       （lum<60）欧氏距离 >35 还原；
    ② `--zero-transparent-rgb` 置黑 + 线性过滤缩采样 = 边缘渗黑（图片查看器
       和游戏内同样可见）→ 透明区 RGB **颜色外渗**（最近实体色，≤24px）替代置黑；
    ③ **最终根因 = 运行时椭圆阴影**（红狼王二十九版重演）：黑狼没设 `_noShadow`，
       GameScene._syncEntityShadows 在 collider 处画 alpha 0.35 黑椭圆，贴图清到
       0 也没用 → BlackWolf 构造函数 `this._noShadow = true`。
  - **教训：贴图问题先实机截图排除渲染层**；凡"清理到 0 还有"必在渲染层。
  - 环境：5080（Blackwell sm_120）xformers 全崩 → ComfyUI 启动加
    `--disable-xformers`（已固化进 ComfyUIStart / ComfyUI_RESTART_3D 计划任务）；
    远程操作走 `ssh r5080`（长任务必须 schtasks，SSH 断连杀会话进程树）。
  - 验证：28 帧循环闭合 IoU 0.696 ≈ 相邻帧步进；品红底/深地砖底/动态 GIF 三验；
    `scratch_tmp/wolf_clean/run_preview_v2.gif`。
  - **v2 追加教训（同日用户实机发现）**：
    ① **首帧清理禁用开运算**——opening(3x3, iters=3) 会吃掉狼爪尖（腿末端变平口柱），
       I2V 以首帧为锚会把"无爪"传导到全部视频；首帧只需保最大连通域（老 idle 的
       "171px 实心阴影条"是段长解析 bug 的误报，实为 1px 抖动，视频重绘会自然抹掉）；
    ② **尺寸统一必须按游戏显示逻辑算**：GameScene:1199 按"帧最长边 → spriteSize(151)"
       等比显示，512 格 ×0.295 / 640 格 ×0.236——pounce（640 格）内容要按 640/512
       放大（scale 0.562 vs 其他 0.4497），否则飞扑狼比走路狼小 20%（老资产即如此）；
    ③ 实机截图工具 `tools/cdp-blackwolf-shot2.mjs`（注入黑狼 + 逐帧记录
       世界坐标→屏幕坐标精确裁剪，连拍覆盖 walk/run/attack 状态）。
  - 全套部署（2026-08-11）：run/walk/bite/pounce/idle 五张绿幕版入库
    （原图 .bak-greenscreen），站立显示高统一 67.2px（228@512 格 / 285@640 格）。
- **主角全帧瞄准扫描管线（2026-08-12，twist 拆分的替代方案验证通过）**：
  - 背景：骷髅模型"腿/躯干/手臂"拆分扭转在复杂人物上必然割裂（用户结论：
    单图拆分无法拼接）。新方案=**零拆分全帧**：瞄准扫描视频（边扫边连续开火）
    → 按角度分桶抽 (neutral, flinch) 帧对 → 运行时瞄准角最近邻选帧 + 开火相位偏
    移 + flipX 镜像；武器层照旧独立旋转（±5° 量化余量，绕握把锚点）。
  - 管线：`player_char/firstframe_aim.png`（用户抠图合成绿幕）→ H3 三条视频
    （下扫/中段/上扫，**单一扫描视频模型只在锚点附近徘徊，必须按角度分段生成**；
    prompt 必须写死 strict side-profile 否则转身）→
    `tools/ai-gen/player-aimsweep-extract.py`（chroma 抠图 + 红底帧剔除 +
    掩膜测角分桶 + 体外高亮=火光定位后座相位 + despill/defringe/外渗）→
    `assets/player/aim_sweep.png` + 角度表嵌入 player-anim-config.json
    `gun_idle.aimSweep`（data/public 双份）。
  - 运行时：GameScene `_syncAimSweep`（姿态状态机 gun_idle 分支优先接管，
    `_crosshairShotKick>0.5` = flinch 相位）；BootScene 按 aimSweep 配置加载。
    **角度表符号：掩膜"手臂上抬为正"与游戏世界 y 向下相反，必须取反**；
    angleScale 1.25 补估算压缩。
  - **骷髅模型保留**：twist 配置/贴图/代码全部原样（手枪/双持仍在用），
    gun_idle 只是新增 aimSweep 键；删除 aimSweep 配置即整体回退旧方案。
  - 待办：武器-手部锚点按角度表 tip 逐桶校准（当前用旧 syncWeapon 偏移，
    有轻微脱手）；极限压枪（<-30°）/正上方（>+75°）角度未覆盖可补专项视频；
    走姿扫描（边走边扫枪）二期。
  - 验证：tools/cdp-aimsweep-verify.mjs（装备 M416 + CDP 鼠标控制各角度截图）。
  - **最终结论（2026-08-12，用户实机验收后判定）：玩家全帧视频管线方案废弃**。
    技术上全链路跑通（扫描帧组/开火相位/双手锚点/移动矩阵/近距平滑全部实现），
    但**视频模型的漂移和不一致对主角不可接受**——主角 100% 时间挂在屏幕上，
    帧间服装/体型细节漂移比怪物显眼得多，12+24 条视频矩阵把不一致放大到不可用。
    已回退：aimSweep 配置/代码/资产全部移除，骷髅 twist 拆分扭转恢复原位
    （spriteSize 144 / WEAPON_ANIM.size 126 一并回退）。
    **教训：AI 视频帧组对"配角/敌人"可行（黑狼全套已上线），对"主角"目前不可行——
    主角级一致性仍需 Spine/建模手工管线。敌人继续用视频管线，主角维持拆分扭转，
    后续主角造型升级应走 Spine 或约稿，不要再试 AI 视频全帧。**
  - 工具留存（敌人/道具仍可用）：`player-aimsweep-extract.py`（角度分桶/火光相位）、
    `player-locomotion-matrix.py`（步态矩阵）——用于怪物时漂移容忍度高，可直接复用。
- **红狼人奔跑贴图"地面平台矩形色带"根因 = H3 视频生成的脚下地面条（2026-08-08 三十版）**：
  - 用户纠正：问题在**狼人形态**（红狼人奔跑），不是狼形态。贴图逐行扫描发现
    每帧脚下 y 380~408 有一条 **252px 宽完整水平矩形深色带**（x 110~362，
    每行完全连续无缺口，颜色 (35,3,4)），而狼人身体只占 x 190~380、腿部宽仅
    40~50px——这是 H3 视频生成时狼人脚下的"地面平台"被当主体保留。
  - 为什么此前全部漏掉：带在 y 380~408（不在底部 60 行统计范围）；颜色与深红
    毛相近（灰粉/阴影清理不覆盖）；GLM 看缩略图会误判为"正常脚部"。
  - 修复（新工具 `rw-remove-ground-band.py`）：自下而上找"连续跨度 >200px 的
    行"组成矩形带；带内像素与"带顶部上方 40px 腿部列范围"取交集——只保留
    腿列，删除平台左右延伸（实测 removed 52652px / 14 帧）。
  - **注意：参考窗口必须取带顶上方（y_lo-44 ~ y_lo-4），不能逐行取 y-24~y——
    带厚 29px 会滑入带自身导致 leg_cols 覆盖全带，0px 删除。**
  - 验证：14 帧均无 >200px 连续行；GLM 确认"两条腿分开有自然空隙、无矩形
    色带、腿部无残缺"；assets + dist 两处 SYNCED。
- **"脚下色块与主体同色"真正根因 = 浅灰接触阴影被染成深红毛（2026-08-08 三十一版）**：
  - 用户反馈"下方色块跟主体颜色太相似了，颜色清理无效"，问是否重做视频。
  - **关键结论：v3 视频本身完全干净**（124 帧逐帧检测底部 40px 无暗像素、
    仅 11414px 浅灰 200~244）。**不需要重做视频**。
  - 完整根因链：
    ① H3 视频生成时角色脚下自带**浅灰接触阴影**（lum 200~244，非纯白 254+）；
    ② 切帧（阈值 248）把它当主体保留——v5 的"白色带" lum 229 就是它；
    ③ `rw-cutout-clean` 脚底带归一化把它**染成深红毛色 (35,3,4)**——从此
       色块和主体颜色一模一样，颜色清理永远分不开。
  - 修复（新工具 `rw-clear-foot-gray.py`）：**浅灰阴影直接删除（alpha=0），
    不染色**。红狼毛是深红 (35,3,4)，lum 200~244 不可能是毛色，只可能是
    背景/阴影残留；仅处理 y≥300 脚下带，防误伤浅色毛发。removed 109554px。
  - 验证：v3 视频重建贴图 14 帧 GLM 全过（无矩形带、脚下干净、腿部完整）；
    实机截图 GLM 确认奔跑形态脚下"无深色大块、浅色地面整洁"。
  - 教训：**"色块与主体同色"时先查处理链是否把背景残留染成了主体色**——
    染色类后处理（脚底带归一化）会固化残留，应改为删除而非染色。
- **红狼王变身动画重生成：旧版实为"狼咆哮"，新版狼→红狼人真转变（2026-08-08 三十二版）**：
  - 用户问"变身动画是根据原模型生成的吗"——排查发现旧 rwk_change.mp4 首末帧
    都是四足狼（GLM 逐帧确认 12 帧全是狼咆哮），**根本没有狼→红狼人的形态转换**，
    游戏里变身实际是"狼咆哮 2s + 瞬间切换"。
  - 重生成（`rw-transform-regen.py`）：H3 i2v **首帧狼站立 + 末帧红狼人站立**
    （--first-frame rw-wolf-ref-1024.png --last-frame rw-humanoid-ref-1024.png），
    提示词强调 transformation / wolf rises up / body expands / legs become arms。
  - 验证（像素 diff 轨迹）：frame0 diff_wolf=1.0 → frame60 中间态 → frame120
    diff_human=4.2——真转变；GLM 逐帧：狼→过渡→红狼人 12 帧连贯、脚下无残留、
    边缘干净、身体完整。
  - 切帧 12 帧(4×3) fixed-bbox → band 清理(65356px) + 浅灰清理(123px) 入格。
  - 教训：**H3 单首帧 i2v 做不了跨形态转变（模型倾向保持首帧形态）**；
    变身/形态转换必须 first+last 双端锁定，且用像素 diff 验证转变轨迹
    （GLM 对首帧形态判断不稳，t_000 被误读为红狼人，diff 对比才可靠）。
- **红狼王变身重复 + 嚎叫改独立技能（2026-08-08 三十三版）**：
  - 用户反馈"变身有重复动画、变身完还有红狼嚎叫"。排查：
    ① 变身完成处代码自动 `_howlTimer = howlDuration ?? 2000`——变身完强制接嚎叫；
    ② 原 howl.png 是**四足狼**嚎叫，红狼人形态播它形态不匹配（GLM 确认）。
  - 修复：
    ① 变身完成 `_howlTimer = 0`，不再自动嚎叫；首次嚎叫延迟 5s（`_howlCd =
       min(cooldown, 5000)`）避免变身动画后立即接嚎叫；
    ② 嚎叫改为**红狼人形态主动技能**（参照 foreman-zombie）：红狼人形态 +
       冷却就绪（默认 30s）+ 有目标 + 咬/扑空闲 → `_startHowl(entities)`，
       给场上全体 enemy 阵营 `applyInspire(buffDuration ?? 30000)`（移速×1.33、
       物攻×1.5，复用已有激励系统）；
    ③ 重生成**红狼人两足嚎叫**动画（`rw-humanoid-howl-regen.py`，首末帧锁红狼人
       参考图）→ 入格 `red_wolf_king_changed_howl.png`（4×3=12 帧），
       transformedSprites.howl / BootScene / _getTextureKey / _drawBody 全链指向它。
  - 关键坑：**嚎叫触发判断不能用 `!_attackType`**——RedWolfKing 的 _attackType
    初始即 'pounceBite' 且不随咬/扑结束重置，条件永远不满足；改看
    `_biteState === 'idle' && _pounceState === 'idle'`。
  - 实机验证：变身完成 howlTimer=0（不再自动嚎叫）；嚎叫技能触发纹理切换
    changed_howl、激励 buff 生效（自身 remaining 28s/30s）；lint 0 error、
    vite build 通过、config-integrity 通过。
- **H3 视频精细度 = 参考图质量 + 分辨率/步数（2026-08-08 三十四版）**：
  - 用户反馈"H3 动画过于粗糙"。两层根因：
    ① 分辨率/步数被砍：SKILL 九版为提速用 1024×576 + 16 步（原生
       1344×768 + 20 步），毛发细节和边缘明显糊；
    ② **参考图从游戏贴图（512²）放大生成，本身模糊**——H3 i2v 锁形态时
       参考图质量直接决定输出精细度，放大贴图当参考 = 糊上加糊。
  - 修复流程：
    ① 参考图改用 AI 文生图（智谱 glm-image，1280×1280，
       `zhipu-gen.py --model glm-image`），提示词强调
       "crisp fur texture / high detail / sharp focus / 8k illustration"；
    ② 生成后用 GLM 验收（主体形态、毛发清晰、无畸形）；
    ③ 清理背景阴影（低饱和 + 中亮 + 非红色调压白，防误删红毛）；
    ④ 缩放到 1344×768 白底画布贴底居中 → 作 first/last frame；
    ⑤ 视频 1344×768 + 20 步生成（每段 ~16min），切帧后照常
       band + 浅灰清理。
  - 结果：run 14 帧 / attack 12 帧 GLM 确认"毛发纹理、肌肉线条、动态细节
    明显更精细"，脚下无残留、身体完整、动作连贯；已部署 assets + dist。
  - 教训：**H3 i2v 参考图必须是高质量原生成图，不能用贴图放大**；文生图
    参考 + HD 参数 + 20 步是精细动画的固定组合。
- **4096² 精灵图规格 + 写实参考图（2026-08-08 三十五版）**：
  - 用户定规格：**4096×4096 画布、8 列 × 4 行 = 32 格取 30 帧（末行留 2 空）、
    每帧 512×1024 竖条、不压缩**。旧 512×512 小格（14/12 帧）画质被压缩。
  - 切帧工具 `rw-humanoid-sheet-4096.py`：步态周期均匀采样 30 帧 → fixed-scale
    （高度 target_h=900 + 宽度≤480 双约束，防竖条超宽）→ 512×1024 竖条贴底
    居中 → 组装 8×4 sheet。清理 `rw-clean-4096.py`（脚下浅灰 + band +
    max-component，适配 512×1024 竖条）。
  - 游戏接入：BootScene spritesheet 改 `frameWidth:512 frameHeight:1024
    endFrame:29`；animation-config transformedFrameLayout run/attack →
    `{cols:8, rows:4, frames:30, frameWidth:512, frameHeight:1024}`（双份同步）；
    GameScene `_configureEnemyBody` 已有非方形帧等比缩放（longest 边=spriteSize），
    512×1024 自动显示为 100×200，无需改渲染。
  - 画风：项目偏写实，参考图用智谱 glm-image 生成（photorealistic / realistic
    fur / horror creature），GLM 验收 + 清背景阴影后作 H3 首末帧。
  - 视角：**水平侧视**（与现有怪物/玩家 billboard 一致，勿改等距透视）。
  - 验证：run 6.8MB / attack 6.2MB（旧 0.5MB），GLM 确认写实毛发、无残留、
    姿态连贯；实机非方形帧等比缩放正常、无拉伸。
- **黑狼贴图主体外黑/白色块清理（2026-08-07 十五版）**：
  - 用户反馈黑狼各精灵图主体范围外有黑/白色块。定量排查三处：
    ① 透明区（alpha<30）RGB 残留（idle 16%、其他 1.5%）——alpha=0 但 RGB 有色；
    ② 半透白边（alpha 30~250 且 lum>150，浅色地面显灰圈——黑狼经验 3808）；
    ③ 半透黑边（黑狼毛边缘羽化，浅背景显黑晕）。
  - 清理三步：透明区 RGB 归零 → lum>150 半透清零 → **硬边（alpha<245 全部清零）**
    （黑狼最终半透≈0，接受轻微锯齿）。
  - 定量铁律：`stray_alpha=0 && semi=0 && trans_nonblack=0` 才算 CLEAN；
    GLM 对黑狼图集仍会误读锯齿边缘为"色块"，以定量为准；实机黑狼确认干净。
  - 用户仍见色块 = 游戏/浏览器缓存旧图，刷新+重启 dev server。
  - **补漏：`black_wolf_bite_regular.png`（撕咬）和 `black_wolf_updown.png` 未清**——
    黑狼攻击默认 `_attackType='bite'` → 用 bite_regular；BootScene 加载它（186 行）。
    清理同一三步后全 CLEAN。**清理脚本必须用绝对路径写回**（Python cwd 飘忽时
    相对路径保存静默失败/FileNotFoundError，且上次"保存成功"的假象掩盖了漏清）。
    黑狼全套贴图（idle/walk/run/pounce/bite_regular/updown）现全部 CLEAN。
- **黑狼移动贴图白边（2026-08-07 十六版，像素级定位）**：
  - 用户指出移动贴图仍有残留且 GLM 识别不了——**用像素分析定位**：
    不透明像素（alpha>245）中 lum>150 的亮像素 walk 4.6 万 / run 11.4 万；
    用形态学边界（不透明且 8 邻域有透明）区分：**边缘亮像素 walk 2.2 万 /
    run 4.8 万 = 背景白边残留**（黑狼纯黑毛，边缘不该亮），内部亮像素是
    黑狼真实白腹/牙齿（保留）。
  - 修复：**轮廓边缘亮像素（lum>150 且贴透明）RGB 压暗到 18（黑毛色）**，
    内部白毛保留。修复后边缘亮像素全 0，黑狼边缘为自然黑毛线。
  - 判据沉淀：黑狼贴图 CLEAN 标准除了 stray/semi/trans_nonblack，还要
    **edge_bright=0**（边缘不透明亮像素）；GLM 对黑狼图集误读锯齿，以像素为准。
- **AI 贴图边缘去污终极方案（2026-08-07 十七版）**：
  - **本质**：AI 生成主体边缘像素是"背景+主体"混合色（RGB 灰 + α 半透），
    贴图透明背景看不出，合成到游戏地板就显灰圈/白边——单纯调 α 阈值永远
    顾此失彼（黑狼反复"抠不干净"根因）。
  - **工具 `tools/ai-gen/sprite-decontaminate.py`**（matting decontamination）：
    ① 半透像素反推前景色 `F = (C−(1−α)·B)/α`（B=背景白），混合灰还原真实毛色；
    ② 反推后仍亮（F≈背景）的半透像素归零（未分离残留）；
    ③ 轮廓边缘不透明亮像素压暗到主体色（黑狼 18）；
    ④ 透明区 RGB 归零。
  - **验证铁律：合成测试**——`--composite-bg 180` 把贴图合成到浅灰背景，
    边缘带残留必须 = 0（比看贴图 alpha 更真实，暴露地面混合问题）。
    黑狼 6 张贴图全部 composite_residue=0，实机轮廓干净。
- 黑狼最终 CLEAN 判据：stray=0 / semi=0 / trans_nonblack=0 / edge_bright=0 /
    composite_residue=0。
- **黑狼从原视频完整重建（2026-08-07 十八版，BiRefNet 管线终版）**：
  - 原视频在 `Y:\工作\无尽轮回\scratch\black_wolf\videos\`（walk/run/attack_pounce_v4/
    attack_bite_regular_v5，全部 1344×768/24fps/124 帧含首尾 pad）；idle 是静态图
    （`black_wolf_idle_new_250x215.png`），updown 无视频源。
  - 工具：`blackwolf-rebuild-from-video.py`（驱动）+ `rebuild-h3-birefnet.py`
    （新增 `--frames-count` 支持 16/28/20/6 帧采样，红狼王 12 帧照旧）。
  - 参数：uniform-h 高度统一 262、512 格（pounce 640 格）、feet-y 410（pounce 513，
    保持 feet fraction 0.80 与其它状态同世界高度）、center-x 256（pounce 320）、
    lum-clear 200、threshold 248、hard-edge 245、edge-dark 18、zero-transparent-rgb。
  - **resize 后必须逐格清理**（不清理必 DIRTY）：alpha 硬二值化（>=245→255，清插值
    半透带）→ 每格只保留最大连通域（清 1~140px 噪点色块）→ 不透明亮像素邻接透明区
    （2px 膨胀）压暗 18（清 resize 白圈）→ 透明区 RGB 归零。验证
    `blackwolf-rebuild-verify.py` 全指标 0 才算 CLEAN。
  - **扑跃帧宽超 512**（前扑伸展 545~583px）→ 格子放大 640²，BootScene spritesheet
    frameWidth/Height 同步 640，animation-config（data/ + public/ 双份）pounce 补
    width/height 640；canvas 渲染按 naturalWidth/cols 自动切帧，其余状态 512 不变。
  - 朝向判定：黑狼左右对称，质量中心偏移不可靠（误报 FLIPPED），用新旧首帧
    交叉相关（flip diff 大即 SAME）才可靠；重建后四状态全部与原资产同向。
  - 循环衔接验证：首尾帧 alpha IoU（0.90~0.95）应显著高于正常步进 IoU（0.75~0.80），
    否则抽帧窗口没覆盖完整步态周期。
- **黑狼步态周期采样 + 腿部兜底（2026-08-07 十八版补）**：
  - **抽帧必须按步态周期，不能均匀抽样**：run 均分抽样（帧间隔 3~4）导致奔跑僵硬；
    实测周期 run P=28（s=40，leg_iou 0.66）、walk P=48（s=40，leg_iou 0.80）。
    run 用 step 1 连续 28 帧（=视频原帧，4×7），walk 用 step 3 抽 16 帧（40+3k），
    相邻帧腿部 IoU 从 0.18/0.30 提到 0.45/0.60。
  - **run 低伏姿态腿部运动模糊坑**：腿部区域灰度中位数 203~245，一半以上像素超
    235 深色阈值兜底线 → 交给 BiRefNet 判定 → BiRefNet 对模糊腿 alpha 不稳 →
    hard-edge 后腿型逐帧抖动（重建后腿部 IoU 仅 0.28，视频原帧 0.64）。
    修复：`rebuild-h3-birefnet.py` 对 **bbox 底部 35% 腿部区域用 threshold=248
    强制主体**（max(BiRefNet, 全身235阈值, 腿部248阈值)），白边由后处理清理。
  - **腿部区域去残留**：脚底贴地/运动模糊产生的不透明灰白像素（lum>160，
    alpha=255，BiRefNet 判为主体）不会被"邻接透明压暗"清掉（离透明区>2px）——
    改为对 bbox 底部 35% 内亮像素做 5×5 邻域毛色均值替换（躯干白毛不受影响）。
    修复后 run 腿部亮像素 228→0、walk 64→0。
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

#### 防御塔贴图视觉基准（2026-08-04 二轮核验定稿）
- **建筑/道具一律正面平视 billboard + 平底**（祭坛/仓库/沙袋/拒马基准）；墙体才是 30° 斜底边
  （墙段专用）。塔/建筑贴图**禁止 45° 等距俯视（可见顶面）**——首版 A 图因此返工。
- **机械臂武器挂载点必须空**：主体写 `empty circular flange socket with no gun`，负面词补
  `gun barrel, cannon, rifle, machine gun, weapon attached`——首版臂尖带枪管状突起被否。
- 提示词模板见 `prompts/defense-tower.md`；产物 `assets/terrain/obstacle_defense_tower.png`
  （正面平视、基座台阶+上方机械臂空法兰挂载座）。
- **工具位置**：生图/抠图工具统一在 `game-dev/tools/ai-gen/`（版本化），
  批量入口 `gen-world122-assets.py`、后处理 `process-world122-assets.py`。
- ⚠ **2026-08-06 v2/v2b 重制（用户口径覆盖旧基准）**：用户指定"参考地面、墙壁的视角/风格 +
  下方基座做圆柱体 + 机械臂单独上方突出"。新塔：30° 等距视角（对齐墙壁、可见圆柱
  椭圆顶面）、暗色石+铆钉金属做旧、圆柱基座 + 顶部单独突出的机械臂（末端空法兰）。
  - 白模 spec `_blockout_specs/defense_tower_v2.json`（elevation 30）→ 深度模板
    `_depth_templates/blender_defense_tower_v2_h.png` → `flux2-dev-depth` strength 0.8
    → `make-transparent-icon.py` 抠图 → `cut-defense-tower-arm-v2.py` 拆臂入库。
  - **v2b 定稿（机械臂重做）**：v2 首版臂"太抽象"（细棍/装饰符号）→ 白模加粗
    （肩/肘关节护罩 + 液压缸 + 粗法兰）+ 提示词强化 heavy industrial robotic arm /
    hydraulic piston / bolts / rust。
  - **v2c 定稿（2026-08-07 截取优化）**：臂"截取不对"根因——①白底抠图把肩部近白
    高光（x400~460）当背景抠成洞，最大连通域把碎片丢了；②切割线落在肩部中段；
    ③臂肩质量偏心（左角 + 颈偏右）。修复：改用 BiRefNet 显著性抠图（不吃背景色
    假设）+ 内部孔洞填充 + 切割线下移到细颈（y85~425），并换用肩颈过渡更对称的
    候选 fc39ae；枢轴=细颈底部中心 (150,338)、挂载点=法兰中心 (149,23)、
    自然角 -1.5740（≈-90.2° 正上方，法兰/颈/枢轴同轴）、pivotWorldY 200.8；
    基座 386×457 → 170×201.3（footOffsetY 100.6）。验证：实机特写/自然/朝右
    连接干净无毛边碎片、臂居中、枪在臂尖。
  - 旧 billboard 版素材在 git 历史可查；候选图已落 `Y:\工作\无尽轮回\scratch\world122\tower_v2\`
    与 `tower_v2b\`。

#### 防御塔机械臂 360° 旋转 + 武器挂载（2026-08-04 实现）
- **拆臂**：行剖面定位塔顶臂区 → 独立臂贴图（枢轴=塔顶中心、臂尖=挂载点、自然角
  =atan2(臂尖−枢轴)）；基座抹臂区。几何统一存 `DEFENSE_TOWER_VISUAL`（defense-system.js）。
  ⚠ **2026-08-06 重新抠图（旧臂是错的）**：旧 347×64 版把塔顶平板左半段当成了手臂，
  与塔图对不上（IoU~0.68），实机就是"一块板 + 竖条"。像素审计后确认真手臂是塔身左侧的
  大结构：x∈[0,116]、y∈[240,463]（肩→臂→末端双爪钳），重新抠出 113×223。
- **新几何（2026-08-06 定稿，`DEFENSE_TOWER_VISUAL.arm`）**：纹理 113×223；
  枢轴=肩部上沿 (77,28)、挂载点=爪心 (44,155)、自然角 1.8250（≈104.6°，指向左下≈垂直向下）、
  pivotWorldY=177.6（塔图 y=268）；工具 `tools/ai-gen/cut-defense-tower-arm.py`
  （矩形裁剪+最大连通域去塔身角料；基座擦除手臂并对 y262~290 过渡带做对角 inpaint 补平）。
- **渲染**：GameScene `_syncDefenseTowers` 三层——基座静态；臂 `rotation = aimAngle − 自然角`
  绕枢轴 360°；武器锚臂尖、`rotation = aimAngle`。
- **旋转铁律（2026-08-06 修复）**：臂 sprite 的 **origin 必须设在枢轴**（`pivot/tw, pivot/th`），
  setPosition 直接落在世界枢轴——旧实现把贴图枢轴对齐到世界点后仍绕 sprite 中心旋转，
  枢轴会画圈漂移（偏差最大 ≈ 15px）。武器尖端仍用 `(tip−pivot)×s` 旋转公式，与臂同源。
- **武器朝向铁律（玩家同口径）**：`rotation = 瞄准角`；朝左（|角|>90°）用 **flipY** 防倒置
  （禁 flipX+π——方向对但贴图倒，实机截图"枪口与臂不一致"根因）；按高度等比 setScale。
- **塔 AI**：`aimAngle` 最短弧平滑（有目标 9 rad/s、回位 4 rad/s）；枪口=臂尖世界坐标
  （弹道与视觉同源）；无武器时臂空转。
- **实机验证工具**：`tools/cdp-defense-tower-arm.mjs`（建 3 塔 + 冻结瞄准 + 六向截图 +
  单塔特写）、`tools/cdp-defense-tower-arm-fire.mjs`（解除冻结 + 假想敌 → 自动索敌/转臂/
  开火截图）；旧 `tools/cdp-defense-tower.mjs` 依赖 DEFENSE_CONFIG.towers 预置塔已过时。
  2026-08-06 验证结果：自然/右/左/上/下/混合角度全部正确（肩部固定、枪随臂转、朝左不颠倒）；
  PKM/AKM/能量LMG 均从爪子枪口出弹、弹道沿枪方向；lint/build 全绿。

#### 防御塔 Blender 建模重做（2026-08-12/13 纯色参考版，AI 生图 v2 弃用）
> 用户对 AI 生图版防御塔不满意 → 本轮**先建模出纯色参考版**（不生成贴图），造型/视角/比例验收后再谈贴图。
> 复用"Blender 建模 → AI 材质"路线 B 的几何端；产物与代码已入库（`tools/render-defense-tower.py` +
> `tools/prep-defense-tower.py` + `tools/cdp-world122-shot.mjs`）。

**视角/构造前置分析（GLM-4.6V + 代码常量双确认）**
- 世界-122 = **30° 俯视等距投影**（基地房间 ry/rx=0.5）；掩体底边斜率 ±0.5（26.57°），h/v 互为镜像
  （`defense-system.js` 的 `COVER_FACE`）。塔基=圆柱底座、机械臂=顶部关节结构。
- 游戏内是**双层渲染**：基座贴图 `obstacle_defense_tower` + 独立机械臂贴图 `obstacle_defense_tower_arm`，
  机械臂绕塔顶（pivotWorldY=235）360° 旋转（GameScene `_syncDefenseTowers`）。

**建模（Blender 5.1，`tools/render-defense-tower.py`）**
- 塔基：圆柱柱身 + 底部法兰 + 中部加固环 + 顶部平台/檐口；机械臂：枢轴柱→上臂→肘关节→前臂→
  腕部武器挂载（橙色点缀）。正交相机 30° 俯视，无阴影、透明底、纯色材质（先不贴图）。
- 坑：① 肘关节圆柱初始放 (0,0) 而非 x=128（已修）；② 相机只居中原点会裁掉机械臂侧——
  `setup_camera` 加 `target` 参数：塔基 (0,0,75)、机械臂 (129,0,175)。
- 渲染产物：`Y:\工作\无尽轮回\scratch\world122\tower_base.png`（324×498）、`tower_arm.png`（687×162）。

**入库标定（`tools/prep-defense-tower.py`）**
- 流程：裁剪包围盒 → 备份旧图到 `assets/terrain/.bak-tower-20260812/` → 覆盖 → 输出标定值。
- `DEFENSE_TOWER_VISUAL.arm`（src/world/defense-system.js）：w:360, h:85, s:360/687；
  pivot:{x:41,y:73}（pivotWorldY:235）；tip:{x:669,y:80}；naturalAngle:0（新图指向 +x）。
- 单位换算：渲染 px/unit=2.56；game_per_unit ≈ 170/(324/2.56) ≈ 1.343。

**实机验证（`tools/cdp-world122-shot.mjs`，CDP headless Edge）**
- 关键调用顺序：`sm.init()` → `switchScene('scene8')` → `ds.setup(player)`（active 不会自动拉起）→
  B 面板自建 demo_tower（塔/掩体实体在 Game.entities，不是 ds.towers）→ 截图。
- 截图：`Y:\工作\无尽轮回\scratch\world122\verify\`（w122-overview / w122-tower / w122-tower-aim2 / w122-cover）。
- GLM 验收：机枪挂在机械臂尖端、朝向一致；旋转后朝向明显不同（360° 机制正常）；无 console 错误；vite build 通过。

**沉淀原则**
- 美术重做走"**纯色/白模参考版先验收 → 造型视角比例通过 → 再做贴图**"，避免整轮返工。
- 替换素材前先把旧图备份到 `assets/terrain/.bak-*`（保持可选回退）。
- 换模型后 pivot/tip/pivotWorldY/naturalAngle 四参数必须随新图同步重标定，不能只换 png。

#### 防御塔正式材质、碰撞、瞄准与阴影收口（2026-08-29/30）

- **美术定稿与最小溯源链**：获选方案固定为冷灰预制混凝土 + 蓝黑钢 + 克制维护标；模型、30°正交相机、324×498底座画布、261×164炮臂帧画布和逐像素 Alpha 均保持不变。正式资源为底座、48帧炮臂表、建筑缩略图及 silhouette/projection/height/normal 四套派生图；仓库只保留获选3号材质、必要 Blender/处理脚本、参数、选择报告和实际大小预览，旧整批候选与旧图标废案不得入库。
- **逻辑占地与视觉标定分离**：塔始终通过 `applyBuildingFootprint(tower, 2)` 使用标准2×2、256×128等距碰撞棱柱；`data/defense-structures.json#defenseTowerVisual.visualFootprint` 仅以 `strict` 把底部法兰映射到该棱柱，`assemblyScale` 只放大底座/炮臂/挂载武器。玩法碰撞体高度固定读取 `collisionBodyHeight:262`，不得被429px视觉高度反写。玩家、友军和怪物的实体分离都必须命中该 footprint，寻路器也不得再排除 `_isDefenseTower`。
- **炮臂、枪口、弹道和阴影同角**：运行时只认 `_renderAimAngle()` 的48向量化角；炮臂帧、挂载武器、枪口点、开火容差和 `shadowCaster.parts` 必须消费同一角度快照。枪口/阴影高度独立读取 `muzzleHeight/shadowHeight`，预测瞄准由 `defenseTowerCombat` 配置节流，索敌快照与实际弹体射程同源；帧角或武器变化时只失效一次塔阴影，不允许每帧重建全场静态阴影。
- **升级图标双路径**：六维芯片与六项模块正式图固定在 `assets/ui/tower/cold-steel/`（209×209 RGBA），DOM轻量镜像固定在 `assets/ui/runtime-icons/ui/tower/cold-steel/`（128×128 RGBA）。十二图共用同一四铆钉枪灰母框，只替换中央战术符号；业务配置引用正式路径，由 `renderLightweightProjectImage` 选择运行时镜像，禁止恢复 emoji 或旧棕金卡片。

### 防御塔战斗机制沉淀（2026-08-14/15 定稿，世界-122 防守塔全套）

> 以下机制全部在 `defense-system.js` / `GameScene._syncDefenseTowers` 落地并实机验证，
> 新防守单位/塔类功能一律按此口径开展。

**友方免伤（玩家/友军不能伤害己方建筑）**
- `damageable-entity.js` 导出 `isFriendlyFire(source, target)`：player/companion 阵营组互免。
- 三条链路全部拦截：`takeDamage`（伤害入口）、`attack.js` 四处近战命中、`projectile.js` 同阵营跳过。
- 防御塔/基地/掩体都因此无法被玩家和友军伤害；敌人照常可攻击（防守玩法成立）。

**防御塔越己方掩体射击**
- 掩体 face 线段注册进 `WallSystem.isoSegments`（带 `_cover: true`）。
- 塔的索敌（`_acquireTarget`）与弹丸（`projectile.js _isBlockedByWall`）都忽略 `_cover` 段——
  真实墙壁仍挡，己方掩体不挡。
- 枪口墙体回退（`WallSystem.resolve`）同样只认真实墙：先用"忽略掩体段"的 `blocked` 判定，
  仅真实墙阻挡才回退；否则 resolve 会把枪口沿掩体滑回塔脚（"下沉到底座" bug）。

**图层锚点与阻挡口径**
- 塔三层共用 `setupStructureDepth` 产出的 `_structureRenderDepth`，机械臂/武器只在其上增加稳定小偏移；
  前后关系仍由2×2接地 footprint 与单位脚点仲裁，禁止按高塔贴图 AABB 反推地面占地。
- 阻挡：存活防御塔对玩家、友军和怪物统一参与实体分离，并作为真实2×2寻路硬障碍；
  塔被摧毁 `active=false` 后才停火、停渲染并退出分离/寻路。

**换弹/过热（玩家口径复制）**
- 弹药：塔覆盖 `_hasAmmo`/`_consumeAmmo`（Combatant 默认无限弹，玩家口径才真扣）；
  `_startReload` 加守卫防 canFire 每帧重置换弹计时 + 读 `getAmmoConfig.singleReloadMode`。
- 过热：`update()` 驱动 `_updateOverheat(dt, isFiring)`；isFiring = 有目标+有弹+非换弹+未过热
  （冷却不参与，机枪持续压制升温）；PKM/QJB/能量机枪按 heatParams 过热锁火。
- 防御塔开火命中**不触发玩家震屏**：`damage-pipeline.js` 的 `GunFeel.onPlayerHit` 排除
  `_isDefenseStructure`（否则塔命中会走玩家命中反馈）。

**机械臂预渲染 3D 旋转帧（解决"单臂 2D 旋转僵硬"）**
- Blender 单独建模（竖枢轴柱+横杆+弧形钩），绕塔顶轴渲染 48 帧（7.5°×48）等距透视，
  游戏按 aimAngle 选帧（`render-defense-tower-frames.py` + `prep-defense-tower-frames.py`）。
- 世界旋转 = **-aimAngle**（游戏 y 向下，屏幕顺时针=世界逆时针的镜像）；镜像塔取反+flipX 帧。
- 臂尖是**椭圆路径**：tipOX = gs·k·reach·cosθ；tipOY = gs·k·(0.5·reach·sinθ − 0.866·dz)
  （x 全量、y 0.5 缩短；dz=挂载件相对枢轴 z 偏移）。**y 分量符号必须 +0.5·sinθ**，
  写反会"下半区枪口落到塔顶/底座"。
- 相机锁定验证法：探针必须停 `_updateCamera` + 固定相机，否则玩家/相机漂移导致截图定位失效。

**枪管裁剪（"枪插进机械臂"假象）**
- 武器贴图只取前 1/3 枪管段裁成独立贴图 `tower_barrel_<weaponId>.png`（`prep-tower-barrels.py`），
  切口端 origin(0,0.5) 对齐臂尖并内嵌 7px（`inset` 可配）→ 枪管从机械臂/钩子伸出。
- **不要用运行时 `setCrop`**：与旋转/origin 组合存在渲染兼容问题（精灵状态对但不可见）。
- 枪口 = 内嵌后根 + 枪管长度沿枪管方向（`_muzzlePoint` 与渲染同口径）。
- 配置按 weaponId（霰弹 super90/saiga12k 同 type 不同贴图必须区分）。

**霰弹枪重设计（Super90 / S12K）**
- 一次击发 = 1 发弹壳：`_fireBlast` 多发弹丸共享一个枪口、扣 1 弹、播一次特效
  （`Combatant.fireProjectile` 支持 `config.noAmmoConsume`，调用方统一扣弹）。
- Super90（weapon12）：max 7、**单发装填**（400ms/发，`_updateReload` 逐发 +1，装满才停）、
  333ms 间隔、6 弹丸。S12K（weapon13）：max 12、**整匣换弹**（2s 一次装满）、150ms、4 弹丸。
- 装填中 `canFire` 拦截 → "打空换弹、没装满不开火"。

**金属贴图流程**
- 机械臂金属材质：`flux2-klein-4b-walltex`（riveted steel 族）生成无缝贴图 →
  `render-defense-tower-frames.py` 第 4 参传贴图覆盖全部件 → 重渲染 48 帧；
  几何不变时标定零变化（帧尺寸/枢轴不变）。

### 世界-122 迭代沉淀（2026-08-15：塔死角排查/基地退回/塔 UI/树木散布）

> 沉底归位：僵尸犬统一工厂 → 第 9 区「怪物渲染图层与构造铁律」#3；怪物 A 移动 +
> 全局移速倍率 → 第 8 区；树木素材管线（等距重做 + 写实 v2 + 抠图/摆放坑）→ 第 2 区；
> CDP 探针坑 → 第 8 区大场景 AI 索敌的 CDP 探针坑条目。

**防御塔死角排查方法论（结论：无功能死角）**
- 探针驱动排查（`tools/cdp-tower-close-range.mjs` / `close-range2.mjs`）：塔索敌/出弹/命中
  三段插桩 + 距离×方向矩阵（60~400px × 东南西北 × 空旷/菱形房内）+ 移动目标途经 + 霰弹。
  结果：全距离全方向命中——贴身怪被碰撞半径推到 ~67-79px 仍正常命中。
- 若再报「死角」：先跑探针复现再改代码；历史真凶是 08-14 前的掩体挡弹道（已修）。

**基地核心重建（2026-08-16 定稿入库）**
- 成品：立方体 + 顶部压顶 + 扁平底座，**采样祭坛大理石贴图**
  `scratch/world122/raw/tex_altar.png`（白底大理石 + 灰纹），`spec.lighting` 加亮；
  入库 `assets/terrain/defense_base.png`，`DefenseBase.spriteCfg =
  { idleKey:'defense_base', size:220, sizeH:183, footOffsetY:92 }`（44.8° 接地视角）。
- 历史：08-15 首版「AI 直出大理石 + 祭坛式建模」用户验收不过已退回 `npc_altar`；
  08-16 这版「采样既有祭坛贴图 + 立方体底座」一次通过——**核心视觉有现成素材先采样**。
- 详细流程见第 2 区「Blender 建模渲染管线」。
- 坑：Blender 的 images.load 路径必须 ASCII（中文路径静默坑），渲染输出写中文路径没问题。

**防御塔整塔命中 + 悬停轮廓 + 神经芯片面板（2026-08-15）**
- 命中盒 = `TOWER_HIT` 矩形（塔脚锚 `{cx:0, cy:-135, hw:115, hh:175}`，世界坐标覆盖基座+
  机械臂+挂载武器）；`tryInteract` 塔分支用 `Renderer.screenToWorld` 转世界坐标判定
  （别用屏幕空间小圆——塔身/塔顶必然脱靶；08-06 矩形命中盒曾退化丢失过一次）。
- 悬停金色轮廓：`DefenseSystem.updateHover`（game.js 每帧驱动）→ `_hoverTower` →
  `GameScene._syncDefenseTowers` 每帧对三层贴图 `filters.internal.addGlow(0xffd700)`
  （敌人攻击预警同链路；建筑/编辑模式与指针在右侧面板上时跳过悬停）。
- 面板「神经芯片」区（2026-08-16 起为六维强化卡，旧「射手演算·合计加成」已被取代，见下）。
- 验证工具：`tools/cdp-tower-panel.mjs`（命中矩阵 + CDP 真实鼠标悬停 + 面板截图）。

**防御塔升级重构——六维芯片取代等级/模块（2026-08-16）**
> 2026-08-16 二轮：改造模块已按用户要求重新引入并与芯片并存（见下节），本节标题中的
> 「/模块」仅指当时删除、二轮恢复前的中间状态。
- **删除**：塔等级（Lv 升级/耐久成长）、升级模块（6 模块 + 模块位）及其面板区块/按钮；
  塔名固定「防御塔」，耐久固定 `tower.hp`。
- **升级收敛到六维芯片**：`tower.chip = {str/dex/con/int/wis/luck}` 初始 `chip.base=10`、
  单项上限30；升级属性本身不加攻，只强化「与该属性挂钩的已装载武器」。
- **武器 ↔ 主属性挂钩**：`DEFENSE_CONFIG.tower.chipWeaponStat`（PKM/QJB-201/能量机枪→力量、
  AKM/M416/QBZ-191→智力、散弹→体质、弓→敏捷）；未配置时默认取该武器 `attackFormula.attrs[0]`。
- **伤害真源零硬编码**：`_computeDamage = computeWeaponAttack(item, 芯片合成属性, null)`——
  芯片只喂挂钩主属性、其余为 0（未挂钩属性对伤害零影响）；强化等级/改造(独头弹·伤害%)/附魔
  全部实时计入；skills=null（塔不吃玩家熟练度）。
- **面板逐属性注释实时反显**：`_statMarginalPerPoint` 用真实公式 +10 区间差分算「每点+X 攻击力」，
  未挂钩属性显示「无影响」；强化后 perEnhance 使每点边际自动变大；升级按钮「+1（-X 金）」
  带升级后伤害预览。
- **金币逐级递增**：`round(baseCost × growth^(当前值-base))`，当前为 60×1.28^n；
  单项从10升到30累计约29652金币。禁止恢复99级配合高指数增长的不可达曲线。
- **武器槽/列表贴图**：`towerWeaponImagePath`（item.iconImage → EquipDataManager 全量源 →
  弹丸贴图兜底），面板不再用 emoji 占位。
- 验证：`tools/cdp-tower-modules.mjs`（初始化/挂钩边际/费用曲线/强化实时计入/上限拦截/面板 DOM）。

**防御塔改造模块重新引入——与六维芯片并存（2026-08-16 二轮）**
- 需求：用户提供 UI 组件图（`素材库\UI\改造\防御塔改造.png`，2 行×3 列深灰圆角卡片，
  每卡=图标+文字一体），要求抠图、去右下角水印后导入并接回塔面板；顺序
  左→右、上→下 = 伤害强化/射程增强/速射模块/快速换弹/过热抑制/快速散热。
- 抠图：`make-transparent-icon.py`（白底泛洪 → 最大连通域 → 羽化 → 边缘去白边）；
  像素分析确认卡片底边 y=1180、水印文字带 y≥1180（左/中/右三段），行 2 裁到 1179
  天然避开；成品 `assets/ui/tower/tower-module-*.png`（RGBA，~505×492），去水印整图
  `素材库\UI\改造\out\full_clean.png`。
- 接法：`DEFENSE_CONFIG.tower.modules` 重新引入 6 模块（icon 指向抠图卡），
  **与六维芯片并存**——芯片管伤害挂钩主属性，改造模块直接强化武器参数
  （伤害%/射程/射速/换弹/过热/散热）；无槽位限制（塔等级已删），金币
  `round(baseCost × growth^(等级-1))` 逐级递增。
- 伤害公式：`_computeDamageFor = computeWeaponAttack(...) × moduleMults().damage`；
  芯片「每点+X」边际差分同步乘模块伤害倍率（真实公式反显仍成立）。
- 面板：`#dtModules` 3×2 网格，每卡 = 抠图图标 + 名称 + Lv + 当前/下一级效果 + 升级按钮。
- 验证：`tools/cdp-tower-modules.mjs` 扩展——6 模块逐项生效（伤害 75→83、射程 1200→1344、
  间隔 92→85、换弹 3500→3150、过热/散热 ok）、费用 150/218/315/457/663 递增、
  满级拦截、面板 6 张图标卡。

**场景树木随机散布特性（2026-08-15 定稿；2026-08-16 已移除）**
> 世界-122 树木已全部删除（贴图/ISO_WALL_GEO/散布逻辑/生成脚本/探针），
> 由仙人掌散布替代：`_scatterCactiScene8` + `scenes.scene8.cactusScatter`
> （同款排除带/碰撞/调用顺序铁律），资产 `obstacle_cactus_*`，见「世界-122 荒漠化」。
- `_loadScene8` 里 `_scatterTreesScene8`（配置 `scenes.scene8.treeScatter`：enabled/count/
  minDist/scaleJitter/bounds/exclude 可调）；排除基地房/玩家出生点/能源点/刷怪点；
  走 isoVisuals + rebuildIsoCollision 真实碰撞；缩放 = obstacleH/geo.h × (1±0.1)。
- **调用顺序铁律**：必须在 DefenseSystem.setup 之前调用（rebuildIsoCollision 只保留门闸
  isoSegments，掩体墙段在 setup 时才注册——树先建碰撞、掩体后注册，顺序反了树没碰撞）。
- 实机验证工具：`tools/cdp-tree-pure-shot.mjs`（纯 __phaserScene 截图，零模块依赖）。

#### 新障碍物碰撞体 + 图层（2026-08-04 定稿）
- 掩体/塔入库后必须补 `ISO_WALL_GEO` 注册：`category:'obstacle'` + `editor` 显示名
  （摆墙编辑器障碍物类自动上架）；foot=底部 15% 带实测（矩形 footprint 碰撞）；
  obstacleH=默认显示高度（掩体 260 宽等比、塔 262）；depth 走 obstacleDepthOf 自动。
- 纯视觉层（防御塔机械臂）**不注册碰撞**——注册会让旋转臂带静止碰撞、挡弹道。

#### 世界-122 建筑面板（B 键，2026-08-04 实现）
- **入口**：仅 scene8（世界-122）B 键开关；复用摆墙面板 CSS（wall-editor-panel）；
  面板打开时置 `Game._buildMode`（input.js 鼠标/按键交给编辑器，与摆墙同守卫）。
- **物品**：`BUILD_ITEMS`（防御塔完成“防御塔工程”后开放，建造消耗 1000 能源；每级掩体**仅一个条目** `cover_<g>_v`，
  名称 `掩体·<g>级`，不再分水平/垂直；F 键镜像即得水平 "\" 向——贴图/碰撞/face 线
  全部跟随镜像，2026-08-05 简化）；
  点选 → 鼠标幽灵预览 → 左键放置扣金币（GoldManager）→ 生成真实实体
  （DefenseTower 入 towers 数组；DefenseCover 带 HP/可被攻击）。
- **变换约束**：不能缩放；只能镜像调方向（F/按钮）——塔=基座 flipX，掩体=实体 `_facingLeft`。
- **校验**：地图边界 + `WallSystem.canMoveTo` + 与已有建筑距离 ≥70px；右键/Esc 取消。
- **CDP 验证铁律**：动态 import 必须用 performance 资源表里带 `?t=` 的真实 URL
  （否则拿到重复模块实例，singleton 不同步）；先等页面稳定再点官方开始按钮。

#### 防御塔/基地点击命中盒（2026-08-06 修复"点塔打不开面板"）
- **根因**：`tryInteract` 的点击判定是"塔脚周围 70px 圆"——塔身高达 262px、
  视觉中心在脚底上方 131px，点塔身/手臂/枪必然脱靶（探针实测：点脚命中、
  点塔身/塔顶全部 false），只有点最底部台阶才开得了。
- **修复**：命中判定改为覆盖整塔视觉范围的**矩形命中盒**
  `DEFENSE_TOWER_VISUAL.hit`：塔 `{cx:0, cy:-130, hw:100, hh:170}`（含机械臂+武器）、
  基地核心 `{cx:0, cy:-107, hw:90, hh:120}`；玩家交互距离 260px 保留。
- **验证**：`tools/cdp-tower-click-e2e.mjs`——真实 CDP 鼠标点击塔身中部 → 面板打开、
  再点关闭（toggle），无控制台报错；点击链路 = input.js mousedown → `mouse.leftPressed`
  → game.js 点击块 → `tryInteract`（模块实例必须用 performance 表 `?t=` URL 导入）。

#### 防御塔/基地不可移动·不可击退（2026-08-06，与墙壁/掩体同口径）
- 防御塔与基地核心此前只有 `noSeparation`（防实体分离推动），缺少 `immovable`
  （`damageable-entity` 的击退闸门：`applyKnockback` 直接 return、位移积分跳过）。
- 修复：`DefenseTower`/`DefenseBase` 构造补 `this.immovable = true`（掩体已有），
  塔/基地现在等同墙壁——任何击退/位移通道一律无效。
- 验证：`tools/cdp-tower-immovable-probe.mjs`——双向 500px 击退 + 30 帧更新，
  位置零位移、knockbackX/Y 恒 0；lint/build 全绿。

#### 防御塔枪械属性与玩家对齐（2026-08-06 排查定稿）
- **排查结论**：换弹/弹匣/命中效果本就走共享链路（Combatant `getAmmoConfig` +
  改造 `reloadTimeDelta/magazineDelta`；投射物快照 `_enchantEffects/_craftEffects` →
  DamagePipeline 附魔 on-hit/流血/易伤/穿甲；`Combatant.takeDamage` 附魔暴击），
  与玩家一致；**不一致的只有两处**：
  1. **每发伤害**：旧实现按武器类型硬编码基准（`BASE_WEAPON_DAMAGE`）× 扁平六维系数，
     无视 attackFormula/强化 enhanceLevel/改造·附魔 damagePercent。
  2. **射速**：旧实现只读 `item.attack.attackInterval`，改造 `attackIntervalDelta`、
     附魔 `attackIntervalMul` 不生效。
- **修复**：`_computeDamage` 改走唯一实战公式 `computeWeaponAttack(item, player.data, null)`
  （含强化/改造/附魔；`null skills` = 不挂玩家技能精通——那是玩家技能非武器属性，
  如需塔吃精通再放开）× 塔等级独立增益 ×(1+0.22×(L−1))；射速按
  `_applyEnchantAttackInterval` 同口径 `base×intervalMul+delta`（下限 100ms）。
- **验证**：`tools/cdp-tower-weapon-parity.mjs`——同一把 AKM（强化+3、改造
  damagePercent+20%/attackIntervalDelta−80/magazineDelta+10/reloadTimeDelta+300、附魔
  damagePercent+15%/attackIntervalMul×0.9）：塔 L1 伤害 39 == 玩家无精通公式 39、
  射速 370==500×0.9−80、换弹 1450==1150+300、弹匣 40==30+10；lint/build 全绿。

#### 防御塔机枪射速提升 + 过热（2026-08-06，能量轻机枪修复）
- **现象**：塔装能量轻机枪只能以基础 333ms 慢速射击、永不发热（玩家侧是 333→50ms
  ramp 加速 + 5s 过热停射 + 4s 冷却）。
- **根因**：塔的 `equipWeapon` 只设基础冷却，`update` 未实现 ramp 与过热；
  且 `Combatant.update` 有一段旧残留恢复（`_overheatValue -= dt*0.0005` ≈0.5/s）
  会抵消任何积累（玩家不调 super.update 所以没暴露）。
- **修复**：
  1. `DefenseTower.update` 补机枪逻辑——"接敌=持续开火"：能量 LMG 按
     `energyLMGParams`（兜底 `item.attack`）做 ramp（base→max 线性，rampUpTime 内）
     与过热积累/恢复（overheatTime/Cooldown/Recover），`canFire` 过热即拦停射；
     PKM/QJB201 走 `Combatant._updateOverheat`（读 heatParams）。
  2. 删除 `Combatant.update` 旧残留恢复（全库无依赖，玩家不调 super.update）。
- **验证**：`tools/cdp-tower-lmg-overheat.mjs` 实测——cd 333→50ms 线性 ramp（2.5s）、
  heat 5s 到 1 强制停射、4s 冷却后重新 ramp，循环正常；lint/build 全绿。

#### 世界-122 布局与刷怪（2026-08-05 定稿）
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

#### ControlNet 深度锁视角（2026-08-04 实测定稿）
- **当前入口（2026-08-27路由更新）**：`flux2-dev-depth` + `--control-image <深度图>`（单卡5080，不依赖mesh）；Klein/Klein Depth/Mesh只保留为明确指定的历史复现或对照入口。
- **铁律：FLUX.2 非 mesh 路径必须用引导采样**（FluxGuidance+BasicGuider+
  SamplerCustomAdvanced+RandomNoise）；旧 SamplerCustom+cfg 出**全黑图**
  （2026-08-04 已修进 comfyui-gen.py）。
- **LoRA归属**：Klein训练的LoRA（3072维）只能挂对应Klein配置；挂到Dev主模型（6144维）会因`double_blocks.*.txt_attn.proj`形状不匹配报错。因此默认Dev工作流禁止自动挂载Klein LoRA；历史复现或对照任务只能通过已登记的专用Klein模型名显式启用。
- **深度模板**：手绘剪影（`_depth_templates/`）即可稳定锁"正面 billboard、平底、居中"；
  实测 10 组件 9/10 视角稳定；**宽扁平地类（农田）需模板加前景高度**，否则会被读成俯视。
- **复用**：`gen-depth-test-assets.py`（批量）+ `make-depth-templates.py`（模板生成）
  + `depth-extract.py`（从参考图提真深度，HF 下载可能超时，剪影优先）。

#### 朝向（水平/垂直）经验（2026-08-04 定稿）
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

#### 视角标准基准（2026-08-04 全量审计定稿）

> 审计方法：GLM-4.6V 只用于"正面 vs 俯视 vs 侧视"粗分类；**30° 斜底边必须以
> 代码几何（ISO_WALL_GEO base/face 斜率）或像素斜率为准**——GLM 读斜边不可靠。

| 形态族 | 标准 | 标准件（可当锚点/参照） | 判定要点 |
|---|---|---|---|
| 墙段/掩体 | **30° 斜底边**（\\ 或 /） | wall_straight、swamp_wall_straight、12 张掩体 | 底边斜率 0.49~0.57（ISO_WALL_GEO） |
| 道具/障碍物 | **正面平视 billboard、平底、居中** | sandbag、barrel、pot、pillar、barricade | GLM 正面 + 像素平底 |
| 建筑/塔 | **正面平视 billboard、平底** | npc_altar、npc_warehouse、防御塔 | GLM 正面 + 像素平底 |
| 角色/怪物 | 侧视 billboard 精灵 | 玩家、现有敌人贴图 | 侧视全身体 |
| NPC（站桩对话/立绘系） | **正面平视 billboard、平底** | 小鼠铁匠/鼠王/侍从、npc_altar | GLM 正面 + 像素平底 |
| 地板 | 30° 等距菱形 | hub_brick、swampbrick | 地板线 30° |

- **问题件记录**：obstacle_woodpile（GLM 非单件居中，待复查/重做）；
  旧塔 45° 等距版已重做；宽扁道具（农田类）深度模板易出俯视，需前景立墙高度。
- 新素材入库前：先判形态族 → 对照对应标准件 → GLM 粗分类 + 像素/几何校验。
- **NPC 视角定论（2026-08-11 实机核验）**：站桩对话 NPC（铁匠/鼠王/侍从）与玩家/怪物
  **不是同一视角**——玩家与全部怪物是**侧视**（像素翻转 IoU 0.09~0.26），鼠王/侍从是
  **正对观众**（IoU 0.82~1.00），铁匠原贴图是 **3/4 斜侧**（IoU 0.54，带脚下木桩）。
  按八版定论统一：**NPC 归入"正面平视 billboard、平底"立绘系**（与祭坛/仓库/防御塔一致），
  玩家/怪物维持侧视；铁匠 3/4 → 正面重做方向正确（原形象保留：银灰板甲+白衬衫+棕皮围裙+
  灰发鼠耳+卷尾+木桩底座+日系动漫）。
- ⚠ **2026-08-06 例外**：防御塔 v2 按用户口径改走"30° 等距（对齐墙壁，可见圆柱顶面）"，
  不再套"建筑/塔=正面平视"——用户明确要求参考地面/墙壁视角；其他建筑（祭坛/仓库等）
  维持 billboard。新素材先按用户当前口径，勿照搬旧表一刀切。

### 铁栅栏滑动门（F→A 六档，2026-08-15）

世界-122 基地入口/可建造墙段式门：左右细柱 + 圆柱铁栅栏 + 每叶上下水平横杆，
开门时两扇叶沿墙轴向两侧滑出并隐藏，关门时从两侧向中间合拢。
- **2026-08-17 门占一个墙位（用户口径：门口大小跟墙壁一样，单边 4 堵墙）**：
  - 基地每边 4 段（faceLen 196.3、端帽重叠 40 → 有效 156.3/段，4 段覆盖 665 ≥ 边 572.4）。
  - openEdge（RB）第 3 段（i=2）由铁栅栏门占据（不再挖宽门洞）：门 face 196.77 =
    墙 face，与相邻墙按墙-墙 40px 端帽重叠拼接；删除旧 JOIN_OVERLAP 门洞收拢逻辑。
  - 合成验证：门栅栏与两侧墙内容重叠（左 19px / 右 29px）无缝；sim 0 卡墙。
- **2026-08-17 菱形闭合实测（用户：4 墙/边"围不拢"，先 Blender 验证再改）**：
  - **结论：墙链本身闭合**——真实贴图沿边跨度 229.6px（v/h 一致、v1~v5 变体同几何），
    相邻墙间距 144.7 → 重叠 85px；四边 + 四角（含门关闭）实机截图全部无缝。
  - **真正的洞 = 门自动打开**：gateMode auto，玩家/侍从距门中点 150px 内即开门，
    栅栏滑出 barCrop 裁剪窗后门洞通透，基地看起来"没围上"。
  - **修复**：BuildableGate/_CoverGate.update 的感应从「圆心 150px」改为
    「点到门线段 ≤65px」才开（只有真过门才触发），离开 0.8s 后自动关；平时菱形闭合。
  - **表面隔离（2026-08-22）**：自动门的友军扫描明确排除 `_surfaceKind==='wall_walk'`；
    城墙上的单位即使二维投影贴近门线也不能触发地面门洞。不要用 `z>0` 代替表面身份，
    楼梯与其他合法地面接近仍按既有门线距离协议处理。
  - **验证工具**：`tools/ai-gen/blender-cover-diamond-real.py`（真实墙 box 230×52×150、
    rot ±52° 顶视+游戏视角渲染+沿边间隙诊断）；`tools/cdp-base-detail-probe.mjs`
    （无头 Edge 实机截图 + 门开/关/离开回归：closed→open→closed ✓）。
  - ⚠ 旧 `blender-cover-diamond-test.py` 是 openRadius 宽洞旧逻辑且用简化 box（沿边
    投影仅 ~83-109px 与贴图实际 229.6px 不符），结论不可信，勿再用来判定闭合。
- **右石柱贴图自身烘焙的深色钢柱（2026-08-16 终案·pillarR）**：用户多轮反馈
  "贴在墙上、不随门开关移动"的钢柱刷新后仍在、没删对——根因是
  `cover_gate_{F,E,D,C}_pillarR.png` 石柱左缘 **x509-530 × y36-350** 一条约 22px 宽、
  近黑色（rgb≈28-59）竖带（镜像 pillarL 对应位置是均匀石色 → 非对称柱影），它属于
  **静态 pillar 层**，因此不随 bars 动画移动；而此前所有修复只改 bars 16 帧、从未碰
  pillarR，所以用户怎么刷新都看得到。修复：`tools/remove-gate-pillar-steel-column.py`
  用钢柱右侧同行石料条（x535-556）回填，暗色占比 87% → 参照水平 0-7%；B/A 档整柱
  即深色主题，不误伤。**排查教训**：用户说"没删对"时先确认动的是不是用户看到的那个
  图层；静态贴图残块用「局部暗色占比 vs 邻列参照」扫，别只扫动画帧。
- **2026-08-17 一格门改版（用户要求：门 = 墙大小，一堵墙 = 一格）**：
  - 门整体缩放到「一格 = 一堵墙」：`GATE_GEOM.worldFaceLen` 270.4 → **176**（水平跨度 =
    COVER_FACE ±88），face 端点与墙 face 同跨（A(-88,-21)/B(88,-109)，v/h 镜像同墙）。
  - 六档贴图以 face 中点 (320,477.6) 为基准整体缩放 **0.80087** 重建（旧 face 219.8 display →
    新 176 display；石柱外缘 ±105 display，与墙端帽 ±94 同级；栅栏叶随帧等比缩放，rail
    探入柱内被 split 裁成「插入石柱」，最外竖杆距柱 ~2-5px 由 rail 桥接）→ 重新
    split 柱/栅栏层 → 图标从新 frame 0 重生成。
  - **重标定 GATE_GEOM**：faceA(105.4,584.0)/faceB(534.6,371.0)、midTex(320,477.6)、
    barCrop {174,0,292,634}（旧 135..505 已失效）；`gateDepthSegs` 柱投影 half 26 → 22。
  - **基地门洞两侧墙段收拢**（`_buildBaseRoom` post-pass）：原洞 237.8 > 门 face 196.77，
    左右邻墙段沿边平移使墙 face 端点**压入门 face 12px**（JOIN_OVERLAP=12）——墙端帽圆角
    比 face 线短 ~26px，flush 会露 2~4px 地板缝，12px 重叠后墙端帽盖住门柱外缘、无透缝；
    转角仍由邻边端帽覆盖（face 越顶点量 29→3.5，端帽本体补足）。碰撞段重叠 12px 可接受，
    开门通行口 ≈173px（门 face 196.77 − 24）。
  - **关门帧栅栏叶贴柱（二轮，消"动画妥协"缝）**：`rebuild-gate-onewall.py` 在 split 之后
    把 frame 0 左叶 [179,320)→[174,320)、右叶 [320,460)→[320,466) 逐行拉伸——最外竖杆/
    横杆正好贴柱内缘（174/466），动画帧 1..15 不动（开门滑动天然覆盖）。
    **三轮微修**：叶拉伸加深 2px（左叶→[172,320)、右叶→[320,468)）且 `barCrop` 右缘
    466→467（w 293）——裁剪窗右边界不含端点，466 是贴柱像素，取 466 会留 1px 缝；
    可见边缘现为 174..466 与柱内缘齐平。
  - **四轮图层修复（用户线索：建筑预览整图连通、摆出三层精灵有缝）**：`_initGateSprite`
    旧深度 左柱4215 / 栅栏4171 / 右柱4127——右柱在栅栏之下，栅栏 barCrop 硬边与柱层
    边界对不齐就露地板。改为 `depthL/depthR = max(底边线+12, depthBars+1)`（4215/4172），
    左右柱一律盖在栅栏之上，用柱体贴图盖住栅栏裁剪边，观感与整图预览一致；开门时叶片
    从柱后滑入（更自然）。syncGateSeamDepths 的"右柱盖墙左端/左柱压墙下"仍生效。
    ⚠ 图层仍按 `syncGateSeamDepths` 的"左在右前"：B 端门右柱抬到墙前（盖墙左端）、
    A 端门左柱压到墙后（墙右端盖门左柱）——接缝观感以实机为准。
  - **B 面板拼接**：`GATE_SNAP_OVERLAP` 51 → 40（与掩体墙端帽同口径）。
  - 一键重建：`python tools/ai-gen/rebuild-gate-onewall.py`（源纹理在不可用的 Y: 盘，
    故走程序化缩放；`_blockout_specs/cover_gate_<g>.json` 已按 0.80087 同步缩放，
    未来 Y: 恢复后可 Blender 重渲复现）。
  - 验证：node --check 通过；vite 编译 200；基地布局数值核验墙/门 face flush；
    sim-defense-crowd 无卡墙/无瞬移（「门口转火门」检查为既有失败项，非本批引入）；
    cdp-gate-seam 门对门偏移同步 +176/+88。
  - ⚠ 通行取舍：一格门通行口 ~173px，防御怪半径 ≤77.5 全通过；poisonMaggot 精英
    （半径 116，需 232）与超大领主被挡在门外 → 转攻墙体（旧 237.8 门也仅勉强容纳
    poisonMaggot，属"门=一格"方案的固有取舍）。
  - ⚠ 旧的 `bake-gate-missing-pillar.py`（贴左墙柱补竖杆）对一格门资产**已过时**：
    新贴图栅栏叶经缩放后 rail 直插柱内、最外竖杆距柱 ~2-5px，不再需要烘焙补柱。
- **2026-08-17 横杆 + 柱外残留清理**：每扇叶上下各加一条水平 rail
  （box 126×14×10，x=±60，z=135/9，leaf/side 标记随叶滑动），与竖杆同烘焙进
  `_bars` 16 帧表，运行时 `_play()` 切帧天然同步，无需新增贴图键。拆分时柱子掩码
  膨胀 2px，并逐帧清除左右柱外边界之外的 bars 像素——修复开门时钢管退出石柱后
  残影穿模。一键重渲：`python tools/ai-gen/rebuild-cover-gates.py`；
  仅清理当前 bars：`python tools/clean-gate-bars-outside-pillars.py`。
    Windows 一键入口：双击项目根目录 `rebuild-gate-assets.bat`。
    运行时兜底：`GATE_GEOM.barCrop` 把 bars 层裁剪到左右柱之间（cell x 174..466），
    旧贴图未重渲时也不会在石柱外残留。
  - **2026-08-17 二轮定稿（已实渲验证）**：① 柱框裁剪会连关门帧最外侧竖杆
    （world x=±115，2D 投影落在柱剪影内）一并删掉——12 杆变 10 杆；竖杆重排为
    ±(5,23,41,59,77,95)（间距 22→18），12 杆全部落在门洞区（柱剪影 cell x 137/502
    之内），横杆保持 ±60×126，两端探入柱区被裁成"插入石柱"效果。
    ② Phaser 4 `setCrop` 写入的是 GameObject._crop（按当前帧算 UV），`_play()`
    每次 `setFrame` 后裁剪即失效（动画冻结在帧 0 裁剪区）——`createGateSprites`
    包一层 setFrame，切帧后按新帧重算 barCrop。③ 旧资产时代的一次性残柱剔除脚本
    （remove-gate-stray-cylinder / remove-gate-wall-steel-column /
    remove-gate-pillar-steel-column）**不纳入重渲流程**：它们按旧贴图固定区域/连通域
    大小删像素，对新渲染可能误删滑出门洞半途的栅栏叶碎片；重渲后柱区残留由 split
    内置清理 + clean-gate-bars-outside-pillars（柱框裁剪，幂等）兜底。
    验收：六档 16 帧柱区残留全 0、帧 15 纯柱子、关门 12 竖杆；GLM 复核关门/开门
    中途帧无穿模无截断。


- **资产管线**（Blender 几何 + 掩体同款材质，与掩体墙同一相机比例）：
  `_blockout_specs/cover_gate_<g>.json`（仅 `tex` 指向 `tex_<g>_v1.png` 不同）→
  `render-cover-gate.py spec out.png --slide 0..1`（2048 渲染，ortho 302.76）→
  `compose-cover-gate.py <g>`（裁剪统一内容框，640×634 单元 4×4 打包）→
  `split-cover-gate-layers.py`（帧15=纯柱子掩码，拆左柱/右柱静态图 + 栅栏 16 帧表，重组零误差）。
- **游戏侧**：`GATE_GEOM`（六档共用几何：face 线 worldFaceLen 270.4、cell 640×634、
  displayScale 0.41）；`gateConfigFor(grade)`；基地固定门用 `GATE_CONFIG`（D 级）。
- **状态机**：默认关闭（门洞碰撞注册）；友军（player/companion，150px）靠近自动开门，
  离开 1.2s 延时关门；`BuildableGate.gateMode`：auto/locked/open（建筑面板详情按钮切换）。
- **感应中心铁律（2026-08-16 门卡死根修）**：开门检测半径必须用**门洞物理中心**
  （`_gateSeg` 面线中点，存 `_detectX/_detectY`），不能用精灵中心 `_cx/_cy`
  （BuildableGate 的 `_spriteCx/_spriteCy`）——等距贴图偏移让精灵中心偏入门内 ~74px
  （基地门实测 (1138,2037) vs 门洞 (1156,2111)），**门外单位被关门段挡在 150px 检测
  半径外永远触发不了开门** → 矿工过门卡死左右摆动（2026-08-16 用户实测复现 +
  CDP A3 阶段回归锚点：`gate._detectX/_detectY === seg 中点`、矿工站门外侧 100px
  关门面 1s 内自动开门）。
- **掩体矩形对友方冗余（2026-08-16 门洞卡死补刀）**：门洞两侧掩体的墙段已按门跨度
  裁剪放行，但 198×133 实体矩形仍伸入门洞——`Game.resolveCollisions` 会把过门洞的
  companion 推回（矿工贴门来回摆）。友方移动本就由 WallSystem.resolve（墙段）管，
  矩形对友方冗余：`rectEnt._isDefenseCover && other._faction === 'companion'` 跳过
  实体分离（怪物/玩家不变，怪物仍靠矩形贴墙被挡）。
- **路径振荡守卫（2026-08-16 幽灵路径）**：寻路空间哈希下矿工在门洞附近可能出现
  「穿基地内部」幽灵路线与正确绕行路线两条近似等代价路线，路径被反复重算翻转 →
  原地左右摆（矿工位移大、卡死看门狗测位移不触发）。`HamsterMinerAI._checkOscillation`：
  2.5s 窗口内当前航点跳变 >150px 且没沿任何一条走远（<120px）→ 清路径强制用当前
  A* 重算，不做传送。这是「卡死看门狗」之外的第二层兜底（看门狗测位移、守卫测
  航点翻转）。
- **建筑面板**：B 面板六档 `gate_<g>_v` 条目（能源，费用=掩体HP×0.25），
  吸附端点 `GATE_SNAP`（与掩体互相吸附，SNAP_OVERLAP 回退），幽灵预览 + F 镜像，
  可被攻击/修理（修理走建筑面板详情按钮，费率同掩体）。
- **图层铁律（重要）**：门是**长跨度墙体**（face 线两端深度差 ~136px），
  绝不能整门单深度——按三段拆：左柱=深端 / 栅栏=中点 / 右柱=浅端，各自 `底边线 y + 12`；
  三段面线注册 `window.GateFaceSegs` 进 `junctionCorrectedDepth` 仲裁
  （实体脚线在段前 → 抬到段上；段后 → 压到段下）；开门移除栅栏段；镜像 h 左右柱深度互换。
- 已知取舍：实体站在门洞中同时跨左右柱时，整门三段的抬升/压制按各段面线独立判定，
  跨两段的重叠区以最近段为准，极端位置可能有 ±1 段误差，可接受。

### 城墙楼梯（Wall Staircase，2026-08-19：替代射击台）

- **玩法定义**：建造面板不再提供独立射击台，改为贴墙建造城墙楼梯。一个逻辑楼梯由
  多个1×1段组成，以墙顶为锚向地面延伸；所有段合法才整组落地。
- **配置真源**：`data/defense-structures.json`。当前墙模型投影标定 `topZ=125`，
  `risePerSegment=62.5`，因此默认两段；段数统一用
  `ceil((wallTopZ-groundZ)/risePerSegment)`，禁止按墙种类写死。
- **正式墙基准**：当前世界-122建筑墙是 `obstacle_block` 方块墙，不是旧
  `obstacle_cover_D` 长掩体。楼梯建模必须走 `tools/ai-gen/build-block-wall-staircase.py`，
  参考原方块墙64×32×80菱形柱；禁止再用230×52×150长墙模型标定。
- **Blender资产**：用户当前建筑提示词是本楼梯视角的最高优先级：
  true orthographic dimetric、camera elevation 30°、azimuth 45°，可见地面轴严格为
  `±26.565°`（斜率`±0.5`）；本条对城墙楼梯覆盖旧的“可见地线30°”通用记录。
  Blender使用真实正方形1×1地块（边长`64√2`），禁止再用azimuth=0相机配合
  非对称模型进深反解四方向。上下段各自模型高度`72.168`→游戏62.5，四方向直接建模输出
  `wall_stair_{lower,upper}_{e1_pos,e1_neg,e2_pos,e2_neg}.png`；
  固定正交尺度/显示画布220×220（1模型单位=1游戏像素，透明安全边不改变实际模型尺寸）。
  下段带80宽×一格长薄接地板，上段带从地面直达第二段起点的80宽定向实心承重体；
  两者与踏步齐宽、bevel=0.65，禁止恢复90.51宽整格方柱造成两侧凸出；
  参考墙只存在于`block_wall_stair_reference.blend`校准场景，正式八张资产不含墙。
- **视觉锚点铁律**：上下段必须各自记录Blender投影 `surfacePx/entryPx/exitPx`。
  Sprite中心以“该段斜面中点”对齐：
  `segment collider center - (baseZ+topZ)/2 - surfacePxOffset`。
  `entry/exit`只用于验证地面、段间和墙顶接口，禁止再从墙顶串联Sprite或用
  `segment.y-baseZ`猜位置。上下段必须用同一个固定正交尺度导出；生成器必须同时验证
  两条地面轴为`(±64,32)`、垂直抬升62.5、四方向接口误差小于0.001px，并检查alpha不触边。
- **可走区域必须来自贴图**：每段除中心锚点外还必须导出
  `walkEntryAPx/walkEntryBPx/walkExitAPx/walkExitBPx`。运行时把四个屏幕锚点按各自
  `baseZ/topZ`还原为地面世界四边形；`surfaceAt`、左右侧边阻挡和RTS路线必须共同读取
  这个四边形，禁止再以整块1×1 footprint或单独的`walkWidth`估算可走位置。
  点击贴图时必须逐级把九个候选踏步Z加回屏幕Y，只接受“同段且同stepIndex”的命中；
  同一屏幕像素命中多个踏步时按实际段Sprite图层、再按30°/45°相机深度选最前候选。
  路线终点就是点击的可见踏步，禁止用`screenY+baseZ`或强制走完整座楼梯。
- **独立碰撞体**：每段楼梯必须拥有自己的1×1建造footprint和独立 `Collider`；
  Collider附带该段`walkSurface`四边形，移动表面只认Blender踏步通道。父楼梯实体只负责
  组合生命值、存档、回收和墙链关系。
- **独立分段渲染**：`GameScene._syncWallStaircaseLayers`必须为`visualSegments`逐段维护
  `data.segmentSprites`；第0段可复用父中立Sprite，其余段必须独立创建、定位、定尺寸和定深度。
  四方向已经使用独立Blender贴图，楼梯严禁进入普通中立实体的`flipX(_facingLeft)`，否则会
  二次镜像。地图隐藏、动态深度、沉陷和销毁必须遍历全部`segmentSprites`，禁止退化成只显示下段。
- **同向并排楼梯必须组成楼梯组**：两座楼梯仅在`dir/ascendingSign/segmentCount/groundZ/targetTopZ`
  一致，且首段中心沿垂直登高轴相差一个标准格（`groupCenterTolerance=8`）时合并。每对楼梯逐段
  选择最近侧边，边端总差允许到`groupRailGapTolerance=48`，
  删除两侧内部`_stairEdge`，并用四边形共享接缝填补Blender踏步间约8px空档；顶部墙连接区同样
  生成共享接缝。接缝命中外扩保护`groupSeamMargin=4`；高度按对应段九级踏步量化，禁止连续斜坡插值。
  横向容差与沿坡相位必须分开：`groupRunTolerance=1.5`限制沿坡误差，禁止用8px总距离把错级踏步
  强行合组。
- **顶部连接宽度禁止重复扣半径**：`WallSystem`侧边线已经按单位`groundRadius`约束中心位置，
  `connectorSurface`只需校验中心仍在`walkWidth/2-edgeHalfThick`内；禁止再次减单位半径。
  80px楼梯重复扣玩家30px半径后只剩19px通道，会让稍微偏心的玩家/友军在墙接口失去surface。
  正确有效半宽为39.5px，并排楼梯共享顶部接缝同口径。
- **楼梯组边界必须动态重建**：新增、读档、回收、摧毁任一楼梯后统一调用
  `DefenseSystem.rebuildWallStairGroups`；先注销全部组员边线，再重算共享面/共享边，最后仅注册
  整组外轮廓。3座→2座→1座时，内部边必须依次恢复为新外边，禁止残留幽灵阻挡或永久开口。
  `DefenseSystem.update`还必须每250ms比较楼梯拓扑签名；热更新旧实例缺少共享数组、组版本过期或
  楼梯坐标集合变化时自动重建，不能要求玩家重新放置或刷新存档。
- **方块墙吸附**：block墙不得投影到 `BLOCK_FACE` 后猜位置；直接复用
  `BLOCK_GRID.e1/e2` 四邻格：顶段中心=墙格心+一个方向步长，下段=墙格心+两个步长，
  墙接口=墙格心+半步长。四方向由鼠标所在侧选择。
- **建造底座采样不能越格**：楼梯每段完整1×1 footprint先负责实体重叠；后续
  `WallSystem.canBuildAt`只检查地形。楼梯专用中心采样半径12、四角/边中点半径2；
  禁止复用普通建筑18px边缘扩张，否则一格iso半边45.255会被扩大到63.255，左右斜向端
  越格误撞相邻墙。完整底座尺寸不缩小。
- **楼梯砖材质版本化**：灰黑版保留
  `_depth_templates/stair_tread_grayblack.png`；当前正式版为白灰砖
  `_depth_templates/stair_tread_whitegray.png`，提示词
  `prompts/stair-brick-whitegray-seamless.txt`。Blender踏步、立面、下段薄底座和上段承重体
  必须统一使用当前材质，并采用Object坐标+Box投影重复；禁止再把`obstacle_block.png`
  成品贴图拉伸到楼梯支撑上。白灰纹理必须再经`enhance-stair-brick-texture.py`
  拉开浅砖面/深灰砖缝；当前八方向成品亮度约116、标准差12.0~15.1。
- **楼梯驻留图层**：楼梯下段同时是中立实体主Sprite，必须跳过`_updateDynamicDepths`
  最后的普通中立实体深度覆写；否则下段会在玩家排序完成后被抬到根结构层，反盖玩家。
  四方向必须按前后侧分流：`ascendingSign=1`（左上/右上后侧）楼梯层=`wallDepth-0.2`，
  `ascendingSign=-1`（左下/右下前侧）楼梯层=`wallDepth+0.2`；驻梯单位只取分段逻辑层和
  场景真实两张Sprite层最大值+1，禁止再把根结构层强制混入后侧楼梯。
- **方块墙顶面来自贴图**：`wallWalk.blockTopSurface`记录`obstacle_block.png`顶面像素四点
  rear(512,85)/right(733,196)/front(512,307)/left(291,196)。运行时按260×259显示尺寸、
  `footOffsetY=61`和`topZ=125`还原成地面世界四边形；移动、点击目标和越界回夹共同使用
  该四边形，不再以格心`BLOCK_FACE`线段估算。普通边缘容差4，楼梯衔接过渡容差24。
- **墙顶弹道使用承托平台豁免**：`projectileWallContext`必须在发射瞬间快照发射者所在
  `_surfaceWalls`，正式`wall_walk`发射的弹体在任意方向上忽略这整块承托平台；楼梯`stairs`不继承豁免，
  非承托墙仍按真实交点高度阻挡。禁止按飞行途中位置动态扩大豁免，避免把远处无关墙变成全局穿透。
  墙下向墙顶射击时，只有本帧弹道精确穿过目标躯干模型，且第一堵墙正是目标承托墙，才允许模型优先；
  其余情况墙体优先。友方弹体撞友方墙只截停且墙体零伤害，敌方弹体撞友方墙按弹体直接伤害扣耐久。
- **相邻墙顶必须有连接面**：真实顶面比128×64逻辑格略小，四方向相邻块之间实测均有
  约7.04px空档。不得直接扩大整块墙的edgeTolerance；应自动选择两块墙彼此相对的顶面边，
  将两条边组成专属四边形连接面，只填墙间缝、不扩大外墙边界。
  `wallConnectorTolerance=2`，邻墙中心必须符合一格距离±2。
- **邻墙索引必须兑现容差**：标准墙格心差是`±64,±32`，但旧存档、热更新或实建取整可能产生
  1~2px墙心偏差。`_blockWallNeighbors`必须先走精确键，再在`neighborCenterTolerance`范围内
  搜索最近墙，并继续交给连接面几何复核；禁止精确键未命中就直接断开墙图，否则人物只能停留在
  楼梯所属的第一块墙。
- **高架拓扑唯一真源**：`elevated-topology.js`按拓扑revision缓存同格全部墙、邻墙连接面、连通分量、
  楼梯入口和空间桶。同格墙不得互相覆盖；楼梯吸附只接受规范墙和外露方向，内部/重叠墙不得生成候选。
  建造、拆除、沉陷、恢复和墙梯组变化必须使拓扑失效，单位查询只访问邻近空间桶。
- **墙顶通行必须检查完整footprint**：不能把整张墙贴图高度扩成地面footprint——下半部分是
  竖直墙面，会制造空气可走区。正确口径是“真实墙顶多边形∪墙间连接面”的联合区域；
  单位中心和以真实`groundRadius`生成的24个外圆点+24个0.7内圈点必须全部受支撑。
  当前墙顶在iso地面约79.38×79.38，玩家半径30可通行；`maxUnitRadius=30`，
  `footprintTolerance=1.5`。越界时沿当前位置→墙顶中心二分寻找最近安全点，禁止把人物中心
  直接夹到贴图边缘。墙顶点击目标同样按半径30向内修正。
- **footprint采样性能**：圆周采样只查询当前承托墙、连接面两端墙和它们的四邻格；
  禁止每个采样点扫描整条墙链。
- **墙顶路线按四邻格BFS**：楼梯可服务其`collectConnectedWalkableWalls`整条墙链，不要求
  直接挂在目标墙块。RTS墙顶路线必须从楼梯墙开始，逐块追加真实顶面中心，再到最终目标；
  禁止楼梯出口直接连远端墙点，否则直墙远端/转角会斜穿空气。
- **墙顶职责固定**：墙图只负责RTS点击、远端BFS路线和楼梯拓扑；玩家与单位即时移动只认真实墙顶
  多边形、墙间连接面和楼梯踏步。不得恢复运行时graph/surface模式开关，也不得把WASD投影到中心线。
- **墙内必须二维自由移动**：W/A/S/D分别保持纯屏幕上/左/下/右位移，斜向输入保持原始向量；
  surface模式不生成`_surfaceMoveAxes`，`WallSystem.resolve`不得旋转、缩放或重解释本帧移动。
- **只在撞边时滑动**：目标点仍受完整墙顶承托时完全不干预；目标越出联合面时，先沿原方向找到
  最远安全点，再把本帧剩余位移朝实际相邻墙中心或楼梯入口收敛。该滑动仅用于碰撞边界，
  不得演变为持续轨道吸附，也不得自动替玩家连续拐弯寻路。反向采样和备用中心回夹两条路径
  必须统一进入滑动恢复；候选出口按输入匹配度逐个尝试，第一候选无有效承托时不得直接停住。
- **转角死点内缩恢复**：若当前合法边缘点无法沿任何候选出口前进，依次从当前墙中心方向内缩
  1.5/3/5px后重试全部候选与目标收敛方向；只接受仍有surface承托且实际位移≥0.05px的结果。
  禁止一次大幅拉回墙中心。多方向循环必须能在换键后立即脱困。
- **连续扫掠与唯一安全点**：所有高架位移从`_elevatedState.lastValidated`到落点按最多3px步长扫掠；
  中途首次失去真实支撑即停在上一有效采样。兜底和边界回夹不得写安全点，不得随机角度试探或伪造
  `wall_walk`。正常移动只有楼梯底部Portal允许切回ground；承托结构被拆除/沉陷时允许受控落地，避免
  保留失效高架身份。墙梯顶部卡住只保留真实连接面上的3px局部推进。
- **墙顶导航半径独立**：地面碰撞与攻击仍使用单位真实`groundRadius`（玩家30），surface承托使用
  `surfaceUnitRadius=24`，仅放宽墙缝/转角6px净空。单位中心仍必须落在真实墙顶或连接面内，
  禁止扩大整张墙贴图形成空气可走区。
- **高架移动长帧限幅**：墙顶/楼梯上的玩家位置积分最多使用34ms；翻滚时长与位移使用同一限幅dt，
  避免浏览器约100ms长帧造成35~62px瞬移或只耗时不走距离。
- **墙顶实体分离豁免**：`WallSystem`忽略墙段不等于`Game.resolveCollisions`忽略墙实体。
  当单位Z>1且`_surfaceWalls`包含脚下DefenseCover时，圆-vs-iso_rect实体分离必须跳过该承托墙；
  否则玩家会被墙实体推出、surface再夹回，形成每帧拉扯卡死。
- **实体分离必须检查垂直区间**：`Game.resolveCollisions`在任何圆/矩形/iso_rect分离前，必须比较
  两实体`Collider.bottomZ/topZ`；高度区间相隔超过2px时跳过二维footprint分离。墙下怪物不得推挤
  墙顶/楼梯单位，同层单位仍正常分离。分离位移调用`WallSystem.resolve`时必须传
  `WallSystem.ignoreForEntity(entity)`，否则同层拥挤推力会被脚下墙段挡回并形成卡死。
- **碰撞后必须最终提交surface**：生产顺序中`Game.resolveCollisions`晚于`DefenseSystem.update`，
  同层单位分离仍可修改高架坐标；碰撞完成后必须调用
  `DefenseSystem.reconcileElevatedSurfaces()`，只重算/回夹高架surface，不重复推进卡死计数。
- **墙顶单位深度唯一权威**：图边上的单位可能同时与两块墙贴图重叠，`wall_walk.renderDepth`
  必须取图边两端墙`_faceDepth`的较大值；`GameScene._updateDynamicDepths`对玩家、侍从和普通实体
  必须至少使用`_surfaceRenderDepth+1`。禁止只按单位自然Y或当前归属墙排序，否则切墙过程中较深的
  相邻墙会间歇覆盖单位。
- **低层拥挤不能污染高层图层**：墙上单位最终深度还要检查脚下近距离实体；仅当低层实体
  `topZ <= 高层bottomZ+2`且逆透视footprint距离在双方半径+16内时，高层单位深度提高到
  `lowerSprite.depth+0.1`以上。防御结构本身仍由`_surfaceRenderDepth`处理，禁止全场扫描后无条件
  把墙上单位置顶。
- **墙顶经过楼梯时忽略楼梯侧边**：wall_walk单位应忽略挂在当前墙链上的`_stairEdge`，
  是否能站立由墙顶完整footprint/连接通道负责；stairs单位仍保留侧边阻挡。
- **楼梯Portal必须按真实输入进入**：统一候选按表面连续性选优；即时移动读取
  `_surfaceInputIntent`，只有输入朝墙中心→Portal入口方向点积≥0.55且完整脚底已离开墙顶安全区时
  才切成`stairs`。人物仍在墙顶联合承托内时楼梯不得抢占，避免`wall_walk/stairs`反复切换。
- **下楼必须有顶部handoff接管区**：墙顶单位输入朝楼梯时，除连接凸包外，上段最后
  `handoffTopProgress=0.65`之后的踏步区域也可返回`handoffDown`候选；该候选优先于仍重叠的墙顶面，
  并原子锁定对应`_surfaceStaircase`。一旦进入stairs，楼梯连续性优先，禁止外侧位置因墙面仍有承托而
  永远无法下楼。碰撞后被推离连接区仍须通过post-collision提交重新进入handoff。
- **重叠surface必须统一选优并原子提交**：禁止按`staircases`数组顺序第一个命中即返回。所有楼梯、
  共享面与墙顶候选由`chooseElevatedSurfaceCandidate`按当前staircase/owner、surfaceKind、Z连续性
  和距离排序；共享面只作平局补缝，不得压过高度连续的正常踏步。`_surfaceRef/_surfaceWall/
  _surfaceWalls/_surfaceStaircase/z`必须由同一候选一次提交。
- **墙顶连接面**：连接几何必须取“上段踏步矩形四点+墙顶目标边两点”的凸包，
  只注册凸包外侧边，入口边和墙顶出口边保持开放；禁止用两条直线斜边包住转弯区，
  后侧方向会让斜边穿过玩家footprint。
  旧版只接到墙顶原始边缘，在完整footprint内缩后仍留下约20~24px安全断层，会在真实移动
  第8帧掉到Z=0并卡死。正式连接面必须保持楼梯顶边宽度并延长到墙顶安全中心。
  `surfaceAt(x,y,unit)`先认两段踏步，再认连接面；连接面保持`kind=stairs/z=topZ`，
  连接面人物中心通道按`walkWidth/2-edgeThick`校验；单位半径已经由楼梯侧边碰撞负责，
  禁止重复扣`groundRadius`。当单位完整footprint已被墙顶承托时返回null，
  让`wall_walk`接管。
- **楼梯边界碰撞使用等距距离**：`_stairEdge`不能用屏幕正圆半径判定。点/线距离必须先将
  Y除以`PERSPECTIVE_SCALE_Y=0.5`还原地面，再与`groundRadius`比较；当前边线半厚0.5。
  墙顶单位只能经连接通道进入楼梯，禁止被与墙重叠的后侧上段踏步直接吸回stairs。
- **衔接验证必须走真实移动链**：逐点传送只能验证surface覆盖，不能发现`WallSystem.resolve`
  与墙段/侧边阻挡共同导致的卡死。探针必须从上段最后几级开始，每帧执行
  `ignoreForEntity → WallSystem.resolve → _updateElevatedSurfaceStates`直到墙顶中心，并断言无ground帧、
  无Z骤降、无零位移卡死、最终surfaceKind=wall_walk。
- **高速位移必须做surface扫掠**：玩家翻滚/冲刺先于`DefenseSystem.update`移动，16ms翻滚约
  9.9px，低帧率或技能位移可达20~120px，不能只检查最终落点。每个有效高架帧保存
  `_elevatedState.lastValidated`；沿上一有效点→落点正向每3px采样（最多128段），遇到首个无支撑点即
  停在上一有效楼梯/连接面/墙顶点并保持高度。
  楼梯底部不启用该保护，允许正常下地；stairs→wall_walk切换必须直接对齐目标Z，禁止平滑下沉。
- **楼梯只吸附外露可建墙面**：`_snapWallStairGrid`收集附近候选后只返回最近的绿色合法候选；
  全部冲突时返回null并隐藏预览。整组占地的实体重叠只忽略目标墙，禁止忽略完整连通墙链，否则
  内层叠墙或楼梯路径中的墙会被错误放行；边线地形采样仍可忽略连通墙链，避免相邻外墙误判。
  第一座楼梯放置后，同一墙块真正外露、占地合法的对面仍可继续建造。
- **上段必须接地**：上段承重体从z=-2连续到第二段起点、长度覆盖完整一格；
  宽度必须等于踏步80而不是格宽90.51。下段薄底座同样80宽、z=-2→3。
  禁止只渲高处踏步，也禁止用整格方柱重新制造侧向凸出。
- **连续墙链**：楼梯吸附、放置忽略和驻墙单位移动都必须通过
  `collectConnectedWalkableWalls` 收集完整端点相接墙链，不能只忽略鼠标命中的单墙段。
- **楼梯建造与导航边界分离**：楼梯建造的地形采样应忽略已有楼梯的导航侧边 `_edgeSegs`，但实体 footprint 重叠仍按每段真实占地检查；这样可补建两个楼梯之间恰好一梯宽的空位，又不会允许实体互叠。
- **墙梯 Portal 必须带墙边身份**：连接面生成时保存命中墙的 `wallEdgeIndex`；墙顶外轮廓据此只打开真实接梯边，其余墙边继续生成高架专用防坠线。建造合法性、连接面、移动开口和调试高亮必须共享同一拓扑结果。
- **旧版清理**：新存档必须写 `stairVersion=2`；历史 `platform` 和无版本楼梯禁止恢复，
  防止墙上重新出现孤立旧楼梯贴图。
- **图层**：所有楼梯段以目标墙 `_faceDepth+0.2+index*0.01` 为基础深度，驻梯单位再+1；
  不再使用楼梯自身格位Y与墙竞争创建顺序；必须在 `_syncStructureRenderOrder` 后再次执行
  `_syncWallStaircaseLayers`，否则主Sprite会被结构拓扑覆盖回墙后。
- **高度真源**：实体 `z` 是脚底高度；人物、武器、阴影和战斗高度全部直接读取`z`。
  每段 `surfaceAt` 按配置的九级踏步量化高度，楼梯上脚底直接贴当前踏步顶面，不再做连续
  斜坡插值或高度缓动；墙顶走`wall_walk`表面并约束在城墙顶面线范围。
  当前两段高度必须严格为`0→62.5→125`且墙顶Z=125；静态接口误差应接近浮点零，禁止用调高模型
  掩盖连接宽度或surface判定错误。
- **目标位置**：墙顶RTS目标必须包含 `{x,y,z,surfaceKind,route}`；route 顺序为
  楼梯各段中心→起始墙顶中心→BFS墙链中心→墙顶投影点。整条连续墙链没有有效楼梯时
  才返回`unreachable`。
- **友军高架航点必须精确消费**：普通地面命令可保留40px到达半径，但route节点统一使用
  `RTS_ROUTE_NODE_DISTANCE=12`和`RTS_ROUTE_Z_TOLERANCE=12`。楼梯出口到墙中心仅约32px，
  禁止使用40~42px/34px提前连续跳过两个节点，否则友军会从上段直接追后续墙点并掉地。
  侍从、射手、斥候及其他仓鼠AI必须复用`resolveRtsMoveDestination`，不得复制私有routeIndex逻辑。
- **通用AI脱困不得接管高架路线**：`_surfaceRouteActive`、`stairs`或`wall_walk`期间，
  MovementSystem的A*卡死重算/随机脱困和CompanionAI的掉队/卡死瞬移必须暂停；高架恢复只走
  surface回夹与看门狗。技能位移调用`WallSystem.resolve`也必须携带`ignoreForEntity`。
- **高架模块边界**：垂直区间统一在`physics/elevation.js`；候选排序与surface身份提交在
  `world/elevated-surface-state.js`；并排楼梯识别、共享接缝和拓扑自愈在
  `world/wall-stair-group.js`。`defense-system.js`只负责组合与运行时调度，禁止把纯规则复制回主文件。
- **攻击受击**：普通投射物用独立 `z/vz`，墙碰撞在二维交点处比较弹道高度与墙顶高度；
  只有正式`wall_walk`发射者可忽略发射快照中的承托墙链，禁止用`_onPlatform`或`z>0`泛化穿墙。
  近战命中必须通过
  `surfaceEffectFromEntity/effectElevationIntersectsEntity` 的同层容差，不能只看二维范围。
- **楼梯/墙顶远程命中**：投射物按发射者与目标真实高度生成直线 `z` 弹道；二维 footprint/躯干矩形
  仅是兼容命中形状，使用前必须确认本帧弹道垂直区间与目标身体相交。正式墙顶发射忽略整块承托平台，
  楼梯途中仍由墙阻挡；墙下命中墙顶目标必须先满足精确躯干命中，不能只凭锁定目标穿墙。
- **所有远程入口同口径**：玩家枪械、`RangedAttack`、`Combatant.fireProjectile`、
  敌人自带射击、仓鼠射手/斥候、法系飞行物和感知LOS都必须读实体/目标Z；
  新投射物入口优先走 `ProjectileFactory`，不得另写只看二维墙线的越墙特例。
- **禁止给墙顶额外画线**：曾新增的 `frontLip` 深浅双线在实机中像墙上残留细长楼梯，
  已完整移除；城墙视觉只允许使用原始 `obstacle_cover_*` 贴图。
- **兼容**：新存档 kind=`wall_staircase` 且 `stairVersion=2`；旧 kind=`platform`
  与无版本楼梯禁止恢复，避免墙上出现孤立旧贴图。

### 城墙塔与外沿女墙（2026-08-29）

- **城墙塔不是普通建筑高台**：实体负责生命、贴图、2×2占格和替换退款；高架拓扑把它展开成四个不进 `Game.entities` 的虚拟方块墙节点。节点必须保留 `_wallTowerOwner`，并由 `ElevatedTopology.expandWallCandidates` 纳入同一 `wall_walk` 连通分量。
- **墙塔接缝瞬时换高**：普通不同高度墙仍拒绝连接；只有一侧带 `_wallTowerOwner` 时连接面声明 `instantHeightTransfer`。单位跨接缝保持世界 XY、直接切换目标 Z，不做斜坡插值；建筑分离必须豁免正受该塔/相邻墙拓扑承托的墙顶单位。
- **塔楼放置与替换是两种合法入口**：2×2 footprint 外侧存在可通行方块墙，或 footprint 内覆盖至少一段可替换独立方块墙，都可放置。四格门门柱、带楼梯的墙不可替换；覆盖成功后按旧墙当前耐久和配置比例退款，同时移除依附女墙。合法贴墙只忽略已确认相邻墙的线段，实体 footprint 重叠仍必须独立检查。
- **塔顶视野只认实际承载引用**：空塔本体不是视野源；单位的当前 `_surfaceRef/_surfaceWall` 指向塔节点时，用塔顶2倍无阻挡视野替代普通墙顶倍率，禁止读取整段 `_surfaceWalls` 推断或把两个倍率叠乘。
- **塔楼城垛必须拆前景层**：主体图画塔身和后半结构，`foregroundOverlay` 只画前侧城垛。单位深度先抬到塔顶承载面，再封顶于前景城垛之下；从普通墙进入塔楼时，脚底圆一触及接缝就预取 `_surfaceForegroundOccluder`，不能等中心点换 owner，否则会闪出一帧错误前景。
- **女墙占地与吸附**：单件是 `64×64` 正方形、面积严格为标准墙格的1/4；每条墙外沿拆成高/低两个半槽。只能吸附真实独立方块墙的外露边，外侧占用格仍允许以后建方块墙；新墙覆盖女墙时按回收口径退款。拖建锁定起始“支撑墙+边+半槽”，只沿同一外沿生成连续半槽，并对每槽独立复验、扣费和落地。
- **女墙接地不取 PNG 底边**：实体锚点是1/4格菱形中心，可见脚线必须对齐该菱形前顶点，所以 `footOffsetY = displayHeight/2 - logicalDepth/2`。直接用 `displayHeight/2` 会整体悬空半个逻辑深度。
- **女墙是单向软掩体，不是硬挡弹墙**：墙顶射手自己的支撑墙女墙不拦出膛投射物；外侧来弹继续命中目标，再用发射点→命中点射线与墙外边界、半槽范围和真实 Z 高度带精确求交。命中有效时在最终伤害链末端把50%转移给女墙，不能先减原始攻击，也不能让投射物提前撞墙消失。
- **材质科技同步**：方块墙的五级材质后缀是女墙与城墙塔的共同视觉真源；塔楼还同步生命、防御和魔防。换肤不改变塔楼2×2占格、虚拟墙顶节点、女墙1/4格 footprint 或寻路合同。
- **资源瘦身**：正式运行图之外，只保留可编辑 Blend、采用模型预览、Depth、采用的分级 raw、运行元数据和生成脚本。重复 staged 成品、组合候选、拼版评审、重复预览、重复深度与 `.blend1` 不入库。

### 射击台历史记录（FiringPlatform，2026-08-16 八版定稿：已由城墙楼梯替代）

- **九版（2026-08-16）**：
  - **台阶单通道**：新增两条台阶侧墙阻挡段（走廊两侧半宽+26 外扩、入口下方 30 →
    台面前缘后 30），爬台阶途中不能左右下台；只能从台阶底部上/下，不能左右绕路。
  - **图层统一口径**：构造时 `setupStructureDepth(this, spriteCfg.size/2)` 注册接地线
    （_faceLine ±149 / _faceDepth=y+12），台上单位保留显式 `max(仲裁, _faceDepth+1)`
    覆盖（台面高于接地线，仲裁窗口不生效）。
  - **贴墙吸附**：恢复 `_snapPlatformToWall`——平台台面边与墙 face 线对齐：
    v 墙("/")用后边 B→L（实体=墙中点+法线×130.7）、h 墙("\")用右边 R→B
    （法线×161.1）；法线朝鼠标侧、F 镜像翻另一侧；无墙回退自由放置。
    尺寸审计：平台台面主体显示宽 260px 与掩体墙一致（世界尺寸不同，显示宽度对齐）。
  - **基地布局（九版+）**：基地 x=900→532→**回到 900**（TL 墙左角贴左边界 x=20）；
    预置射击台已于 2026-08-16 按用户口径删除（基地不再自带平台，B 面板可自行放置）；
    树排除区/能源禁矿带/仓鼠兜底锚点同步。CDP 探针在无预置平台时创建临时测试平台
    供几何用例。
  - **出生点铁律（2026-08-16 修正）**：世界-122 玩家出生点必须
    `WallSystem.canMoveTo` 校验。基地 x=900 时合法点是 **(760,2048)**（房间内、
    不贴墙、不占门洞）；**切勿用按旧基地 x=532 调的 (450,2150)**——基地回到 900
    后它在左下墙外/墙里（y=2150 处墙 x≈592，实测 walkable=false 卡墙）。
    校验探针：`tools/cdp-spawn-check.mjs`。

- **八版+ 审计（2026-08-16）**：
  - 空气墙：视觉台面边缘与游戏菱形像素核验吻合；单向登台阻挡段由"菱形原边（半厚 6）"
    改为"菱形**外扩 26px 多边形**三边（miter 角闭合、半厚 2）"——角色能走到视觉边缘
    （CDP stopDist=0），也走不出去（单向保留）。
  - B 面板预览：幽灵尺寸/锚点对齐实体渲染（297×225、offsetX=-25.6、footOffsetY=49），
    自由放置建筑可放置时幽灵变绿；掩体/门端点吸附复核正常（射击台为自由放置无吸附）。
  - 台阶贴图：踏步从 flat light 素色改为程序化阶梯贴图（stair_tread.png，暖色石阶
    踏步面+深色前缘），渲染管线新增 `material:'stair'`（spec.stair_tex）；重渲染后
    踏步辨识度强。

- **八版（2026-08-16 重建模）**：用户实机反馈"台阶歪斜、没对齐主体"。Blender 无头
  检查（tools/ai-gen/check-platform-align.py）确认根因：台阶 pos 沿**世界 -Y 轴**
  排列（[0,-84/-54/-24]），而主体 rot 44.8 前脸法线 = (0.704,-0.710)——楼梯走向与前脸
  夹角 45~55°，且顶阶背面悬空 33 单位、底阶 93 单位，整串浮在主体前方。
  - **修正**：台阶改沿主体前脸法线（局部 -y）摆放：pos 改
    (61.3,-33.8)/(40.1,-12.5)/(19.0,8.8)（z 不变 13/30/43/60/73/90），顶阶背面贴脸
    （间隙 0）、中/底阶沿法线 30/60；Blender 复核 disp_xy_angle_to_normal≈0°。
  - **重渲染**：render-cover-real.py（本机 Blender 5.1）→ 材质用 factory_wall_tex.png
    提亮暖灰（旧 tex_platform.png 已丢失，均值匹配 (132,118,115)）→ 紧身裁剪
    684×519 → 覆盖 assets/terrain/firing_platform.png（+ h flipX，旧图备份在
    tools/ai-gen/_platform_align/）。
  - **重标定**（tools/ai-gen/calibrate-platform.py 相机矩阵投影）：显示 297×225、
    offsetX=-25.6 / footOffsetY=49；台面菱形 L(-173.6,-60.4) F(-122.5,-33.8)
    R(86.0,-137.2) B(34.9,-162.9)；台阶走廊 E(0,0)→D(-27.4,-81.1)，长 85.6、
    半宽 110、dir (0.320,0.947)；单向登台三边阻挡段沿用。
  - 验证：eslint 0 error + vite build ✓ + npm test 全绿；CDP 探针全绿（表面全覆盖、
    精灵锚点、脚线对齐、单向登台、死亡清理）。

- **七版（2026-08-16 重构，替代六版抬升模型）**：设计方向 = 自由放置高台；登台机制
  从"抬升（lift）"改为**表面可走模型**——单位逻辑坐标 = 台面/台阶的表面屏幕位置，
  无抬升高度（`_platformLift` 只作"在台上"标记，深度覆盖 + 弹道忽略用）。
  - **一对一标定（实机打回根因："走上去再往前走=空气墙/悬浮"）**：逐像素审计贴图 +
    建模投影确认五版/六版几何与贴图完全错位：① 贴图不对称——台面菱形在右上、台阶
    在左下，入口=贴图 (211,581) 而非底部中央；② 台面是水平面（世界 z=102 → 屏幕
    恒定 97.6 display px），不是 178px；③ 台阶轴沿左下↔右上对角线（dir
    (-0.401,+0.916)），不是竖直 (0,1)。旧实现锚在贴图中心 + 恒定 178 抬升 +
    40px 满抬区 → 脚浮在台面上方、再往前走抬升截断 = 空气墙/悬浮。
  - 精灵渲染：`spriteCfg.offsetX=51.1` / `footOffsetY=96.3` 把贴图入口锚定到实体；
    GameScene 中性精灵按 `spriteCfg.offsetX` 平移。
  - 台面菱形（相对实体，屏幕 +y 向下）：L(-78.9,-84.9) F(-27.6,-52.0)
    R(181.1,-184.4) B(129.8,-217.3)；`isOnPlatform` = 点-in-菱形 ||
    点-in-台阶走廊（E(0,0)→D(42.3,-96.5)，长 105.4、半宽 104）。
  - 越墙三件套保留：台上弹道/魔法忽略己方掩体 `_cover`；深度覆盖
    `_faceDepth=y+12` + 台上单位 `_faceDepth+1`。
  - **单向登台（七版+）**：台面菱形左/右/后三边注册 `_platformEdge` 阻挡段
    （WallSystem.isoSegments，halfThick 6），只留台阶所在前边（F→R 整条在台阶
    走廊内）进出——台上不能从其它边走下去，地面单位也不能从其它边走上台；
    `onDeath`/`destroy` 清理阻挡段（防幽灵段残留）。
  - 自由放置（无贴墙）：删除 k 公式/裁墙洞/密封段/移动 ignore 全链路、
    `_snapPlatformToWall`、`WallSystem.platformSegs`；F 镜像仅视觉 flipX。
  - 武器跟随保留（`WeaponTransform` 补减 `_platformLift`，表面模型下恒为 0/1，
    无分离问题）；死亡 `onDeath` 沉陷（BuildingSinkEffect 接管）。
  - 验证：eslint 0 error + vite build ✓ + npm test 全绿；CDP 探针
    （tools/cdp-platform-probe.mjs）——无墙线/无密封段、台阶走廊+台面菱形全覆盖
    （前角→后角 21 点无断崖）、精灵锚点 = (e.x+51.1, e.y-96.3)、玩家脚线=台面表面、
    沉陷死亡清理、贴图渲染。
  - 建模维持五版 v7 资产（自由高台不依赖墙，台阶固定左下↔右上对角；暂不重建模）。

- **需求来源**：围墙内玩家/友方远程弹道被己方掩体墙段（`_cover`）挡，站上射击台后可
  越过围墙向外攻击。
- **⚠ 一二版教训（用户打回两次）**：① 台阶/平台不能沿 local-x 横排（rot 44.8 时投影
  "台阶左平台右"方向反）——台阶沿 local-y 纵深排列；② 不要自研 box 堆叠——**直接参考
  掩体：复制拓宽立方体 + 台阶衔接，rot.z 与掩体一致（44.8）**，平台主体平行墙（同掩体
  沿墙放置），台阶向房内延伸；③ 贴图走**生图管线**（flux2-klein-4b-walltex LoRA 生成
  材质纹理 → render-cover-real.py Blender 渲染），不用渲染器直接贴墙砖。
- **⚠ 三版教训（用户打回第三次）**：① 布尔登台 = 进站台区瞬间抬满 = **瞬移**；② 满高
  box 堆叠踏面不可见 = **没坡度**；③ depth 无条件抬升 = **图层错乱**。
- **⚠ 四版教训（用户打回第四次："建模不像射击台 + 无法走上去"）**——三个独立根因：
  - **建模投影错误**：四版台阶放在台体侧面、与台面同高（pos.y -262→-30 全在平台主体
    前方上方），投影成"台体 + 一堆散块"，根本看不出阶梯。五版重做：台阶**从台面前缘
    逐级连到地面**（3 级，每级 = wall 立面 26 + light 踏面 8，嵌套贴台体前脸），
    ASCII 投影（tools 里 proj 脚本）确认轮廓 = 宽台体 + 左下清晰阶梯；
  - **登台走廊方向反了**：四版走廊沿 `-wallNormal`（指向**墙外**），判定区整个在房间
    外面 → 房内玩家永远触发不了抬升 = "无法走上去"。五版：走廊 = 台面前缘沿
    **屏幕向下**（台阶实际延伸方向）165px、半宽 130；前缘之后 40px 内视为台上满值
    （getLift `along < -40` 才归 0——台面深 26px，`-20` 会让台面后半瞬断）；
  - **贴墙朝向错误**：TR 墙平台用了 v 贴图（长轴斜率 -0.64 ⊥ 墙 +0.5）。五版：
    **贴图由 orient 决定**（'h' → firing_platform_h），mirror 只翻放置侧不翻贴图，
    长轴始终平行墙线；且**平台必须锚定实际掩体 face 线**（掩体 face 线相对房间几何边
    有 ~64px 垂直偏移——`_placeInitialPlatform` 先找距几何边中点最近的掩体段，把几何
    中点投影到 face 线上作为墙线锚点）。
- **资产（五版 v7）**：`_depth_templates/firing_platform_spec.json`（3 级台阶
  340×30 嵌套：riser 26 + light 踏面 8，pos.y -84/-54/-24；平台主体 340×84×102，
  rot 44.8，soil 土底座）→ 材质（沿用 tex_platform.png walltex）→ render-cover-real.py
  渲染 → 紧身裁剪 → `firing_platform.png` + `firing_platform_h.png`（flipX 镜像；
  内容 695×647 → 显示 260×242，footOffsetY 121，脚底=台阶入口）。
- **站台标定**：台面中心在入口正上方 `platformHeight=178`；后缘（贴墙端）191px；
  台面前缘 165px（登台走廊起点）——贴图 x 方向对称，偏移均为 0。
- **贴墙几何（五版）**：实体 = 台阶入口，位置由「台面高出墙顶 25px」反推：
  `k = (178 - 墙高108 - 25) / (wn.y - 墙斜率·wn.x)`（TR 边 ≈50）；
  台面 25px 高于墙顶 → 玩家站台上可越墙射击 ✓。
- **裁墙洞 + 密封段（五版新增，走上去的关键）**：台阶要跨过墙线（入口在房内、台面在
  墙顶上方），墙段不处理会挡停玩家。做法：
  ① `trimCoverSegsForPlatform` **分裂**与平台跨度（±130px 沿墙）重叠的掩体段——洞区
     内的部分移除、两侧剩余保留为新段（`_splitOf` 回链）——只移端点不行（跨全宽段
     段身仍横穿洞区，四版门闸的 moveOut 逻辑对"两端都在洞外/一端在洞内"的段无效）；
  ② 平台自注册 `_platSeg`（_cover 段，跨度 = 洞区）**密封**（怪物挡停转火平台，
     `_owner` 链）；玩家移动在 player/update.js + subsystems.js 五处 resolve 统一传
     `{ segs: WallSystem.platformSegs }` ignore；台上弹道走既有 _cover ignore（三件套）。
  ③ 平台 `noCollision=true`（门同款）——实体碰撞圈在台阶入口，不关会挡玩家走近。
- **登台判定**（DefenseSystem._updatePlatformStates）：玩家 + **PartySystem.members** +
  Game.friendlyUnits（Companion 不在 Game.entities——门感应同款坑）脚线 → getLift 连续
  值；`isOnPlatform = lift>0` 兼容旧调用；走出走廊自动归 0。
- **越墙攻击三件套**：① `Projectile._isBlockedByWall` 忽略掩体段条件扩展
  `_isDefenseTower || _onPlatform`；② `BoltSkillSystem._updateFlying` 台上施法者传
  ignore；③ `WallSystem.resolve/canMoveTo/_nearestBlockingSeg` 加 ignore 透传
  （网格 + 线性双路径都要，`_linearNearestBlockingSeg` 易漏）。
- **深度铁律**：平台顶面线离地面 178px > junctionCorrectedDepth 窗口（60/280），
  **仲裁不生效**——平台贴图深度锚定入口接地线 `_faceDepth = y+12`（与掩体同规则），
  台上单位在 GameScene 显式 `max(仲裁深度, 平台._faceDepth+1)`，**且仅当
  _platformLift>0**（玩家 + 侍从两处）。
- **init 时序坑**：`_buildBaseRoom()` 只算 layout 不建实体——`_placeInitialPlatform`
  必须在掩体墙段创建**之后**调用（预置平台要锚定 face 线 + 裁墙洞），且用
  `_placeInitialPlatformSafe` 防御包装（init 异常不得静默中断后续塔/门搭建）。
- **验证**：CDP 探针（tools/cdp-platform-probe.mjs）——init 生成 count=1/贴图 260×242
  渲染/getLift 0→178 平滑/裁墙分裂（洞区无掩体段残留）+ _platSeg 密封（怪物挡停，
  玩家带 ignore 直达）/resolve 无 ignore 被挡；eslint 0 error + vite build ✓ +
  npm test 全绿（除并行会话 weapon-anim-config 未提交改动弄挂的 1 条近战守卫）。
  headless 相机不驱动 rAF，**视觉/朝向实机复测**。

---

### 建筑派生道路、独立升级项目与 alpha-ground-fit 闭环（2026-08-19）

- **道路生命周期**：`BuildingRoadSystem.detach(entity, { preserveRoads:true })` 用于建筑沉陷和主动拆除：释放中央 2×2/4×4 预约，同时把外围自动道路转为独立道路；道路不随建筑消失，原位可直接重建。场景 teardown/普通重挂仍走默认 detach，避免遗留预约。
- **外围格配置例外（2026-08-21；2026-08-25；2026-08-27）**：配置型建筑用 `producer-buildings.json#perimeterTile` 声明外围格；`"field"` 生成田地，缺省或 `"road"` 生成道路，`"none"` 只保留中央主体 footprint。`none` 必须同时关闭建造预览、外围预约、实际派生 tile，并由 `BuildingRoadSystem.attach()` 在快照恢复路径再次兜底，禁止只隐藏道路 Sprite 却继续占住外围格。传送门、`explorer_camp`（探险家/侦查营地）及 `deep_drill`（深钻井）使用 `none`，周围不得自动产生道路；房屋明确使用 `road`，标准 2×2 主体外自动预约并生成 12 格道路环。
- **升级项目唯一源**：`data/building-upgrades.json` 定义项目、费用、模块 `effect` 与能力；建筑只在 `producer-buildings.json` 或固定建筑配置中声明 `upgradeProject`。`building-upgrade-projects.js` 负责解析，`unit-upgrade-store.js` 按 `effect` 生成统一补丁，禁止再按 `attackSpd/damage/moveSpd` 等模块 ID 写分支。模块首级效果与后续增量不同时使用 `firstLevel + per × (level-1)`，面板当前/下一级预览与实际补丁必须消费同一口径。
- **升级支付事务（2026-08-19）**：矿场/兵营/通用产兵与铁匠铺、研究院能力升级统一走
  `payBuildingUpgradeCost()`；升级永远消耗真实金币与能源，`_devInfiniteResources`
  只允许建筑放置免费。支付顺序为余额预检→扣金币→扣能源，能源扣除失败必须退还金币。
- **出兵模块读条与统一项目卡（2026-08-21）**：仓鼠兵营和所有 `_isTroopProducer` 建筑的模块
  升级必须在开始时扣资源，写入 `{kind:'module', unitType, unitTypes, moduleId, totalMs, remainMs}`，读条完成后
  才提升全局等级并同步存活单位；默认时长与铁匠铺/研究院一致为60秒。同一兵种同一模块跨当前场景
  与后台位面只能有一栋建筑推进。能力与模块卡统一复用 `building-upgrade-card.js`，项目名下必须直接显示下一等级所需金币/
  能源，禁止再显示“悬停查看说明”。模块读条随建筑快照保存，离开位面后由后台结算完成。
- **所有出兵建筑共享升级卡（2026-08-23）**：每栋 `_isTroopProducer` 建筑必须把同一
  `upgradeProject` 常态渲染成一组建筑级升级卡，不得按当前选择兵种筛选、隐藏或重复分组；`unitType`
  只决定下一次出兵。共享读条必须携带该模块在本建筑内全部适用 `unitTypes`，完成时把这些兵种同步到
  同一级；旧档若已分叉则取最高等级同步，避免损失已购买进度。模块级 `unitKinds` 仍是适用性的唯一真源：共享卡保持显示一次，
  但结算、属性补丁与悬浮说明都只覆盖适用兵种，例如探险家营地“攻击强化”只作用于赏金猎人，不能
  作用于仓鼠探险家。探险家营地的专属卡同样留在共享卡组中：“赏金”只覆盖赏金猎人，Lv.1 为
  1.25 倍默认地牢金币、之后每级 +0.15、Lv.6 为 2 倍；“侦察视野”只覆盖探险家，每级 +200px、
  上限 6 级。两张卡分别使用 `assets/ui/building-upgrades/bounty.png` 与 `scout-vision.png`，禁止回退复用
  银行印钞机或攻击射程图标。丛林神庙“丛林之王”只覆盖美洲豹战士：Lv.1 伤害 +10%，之后每级
  +2%，Lv.6 为 +20%；升级激活后，对任一规范化分类标签包含“动物”的目标在最终物理伤害上再乘 2。同一 family
  多来源倍率取最高值，禁止重复叠乘。丛林祭司另有“丛林之力”与“灵动加速”：前者 Lv.1~6 让其
  三种魔法在基础 Lv.1 上额外 +1~+6 级，后者按 10%/15%/20%/25%/30%/35% 缩短轮换施法和技能组件冷却。
  专属 effect 必须通过 `unit-upgrade-store` 补丁实时同步现存、后续、跨位面增援与后台模拟单位。
  骑兵学校的攻击、生命等通用模块同步骑士与轻骑；“冲锋强化”只覆盖骑士，“轻骑机动”只覆盖轻骑。
  草屋、仓鼠军营、靶场、教堂及后续新增出兵建筑一律遵守同一规则，不得配置旧式分兵种等级开关。
  位面特色出兵建筑也不例外；沙漠官邸“骆驼惊吓”必须以 `unitKinds:["camel_cavalry"]` 保持专属，
  即使当前只有一个兵种，也不能依赖单兵种现状把独特项目误声明为通用模块。
- **每栋建筑独立生产选择（2026-08-19）**：`unitType` 只属于建筑实例，通用产兵建筑
  构造时复制独立运行时配置，禁止写共享 `PRODUCER_BUILDINGS` 模板。相邻建筑命中盒重叠时，
  `tryInteract` 必须在全部命中候选中选择离点击点最近的实例，禁止数组第一项抢交互造成
  “同类建筑同步切兵种”的错觉；快照继续逐建筑保存/恢复 `unitType`。
- **混编快照（2026-08-20）**：产兵建筑与兵营除当前 `unitType` 外，必须保存
  `unitRoster:{kind:count}`；恢复按兵种逐个重建，出口预约失败的缺额进入
  `_restoreRosterQueue`，禁止按当前生产类型把旧部队整体转换。后台DPS也必须逐兵种求和。
- **全局能力升级锁（2026-08-20）**：同一 `abilityId` 同时只能有一座铁匠铺/研究院读条；
  `raiseAbilityLevel` 和读档均按配置 `maxLevel` 钳制。后台完成时间按真实剩余时间分段，
  被动能源、募兵速度、结构生命、激励/标记等不得回溯作用于研究完成前的时段。
- **后台经济一致性（2026-08-20）**：牧师什一税保存每座教堂的 `titheTimerMs` 余数并入仓；
  矿工采集比、采矿/数量模块读取 `ENERGY_CONFIG` 与 `miner_economy` 项目，禁止复制0.5/0.15
  等参数；仓鼠军营已迁入通用出兵建筑，基础数据统一读取
  `data/producer-buildings.json#hamster_barracks`。旧快照 `kind:'barracks'` 仅作为读档兼容格式，
  恢复时必须创建 `ProducerBuilding(cfgKey:'hamster_barracks')`，禁止重新启用独立军营系统。
- **首轮出兵与退款（2026-08-20）**：新建产兵建筑从完整生产周期开始计时，只有快照恢复
  缺员可走800ms快速物化；出售按实体 `_buildCost/_buildCurrency` 返还，禁止读取当前版本
  配置价格篡改旧存档的实际成本。
- **特殊模块接线**：靶场 `attackRangeBonus`（+15px/级）、兵营 `defenseMult`（+5%/级）、骑兵学校 `chargeDamageMult`（+15%/级）；教堂 `holyLightRangeBonus`（+15px/级）与 `titheEnergyPerTick`（每10s、每牧师、仅有仓库时入库）。补丁必须同时覆盖新生成单位和场上存活单位。
- **普通格网建筑视觉 footprint（2026-08-23）**：逻辑 footprint/Collider 永远是几何真源，普通2×2为
  `256×128`、基地4×4为`512×256`。配置可提供归一化 `visualFootprint`：
  `centerXRatio/centerYRatio/widthRatio/depthRatio/scaleMode`；若缺省，`resolveConfiguredVisualFootprint()`
  必须从 `displayW/displayH/footOffsetY` 确定性派生同结构标定，禁止直接退回 alpha 猜中心。运行时将标定中心直接映射到逻辑 footprint
  中心（普通建筑的 `entity.y - nominalHeight/2`），并在 `strict` 模式分别求 X/Y 比例，使标定宽深
  精确映射到 nominal 宽深；这四项是代数约束，不允许再由屋檐、台阶、门槛或 alpha bbox 猜中心。
  旧 `anchorAdjustX/Y` 相对修正已移除；显式标定只以绝对中心为真源，新建筑禁止同时维护相对偏移。实体、建造幽灵、
  运动 overlay、按需工作特效与结构阴影必须共用这一结果；非等比缩放时 overlay 的位置与尺寸分别消费 X/Y 比例。
  独立道路补片仍由 `BuildingRoadSystem` 维护，视觉标定不得反写碰撞、占格或寻路。
  只有显式标定和显示配置派生都不可用时，才允许临时回退 alpha 自动识别；回退结果只作初始建议，不能作为正式验收。
  `node tools/calibrate-building-footprints.mjs --check` 必须覆盖生产建筑及其 `buildingTiers[]/recruitmentTiers[]`
  升级贴图、矿工营地、全部房屋等级和4×4建筑，并验证标定中心及映射宽深；素材或标定变化后运行
  `node tools/generate-building-preview-assets.mjs` 更新清单。算法版本8以前的派生清单不得注册。
- **底部锁定铁律**：实体与建造幽灵必须共用 `resolveStructureGroundFit()` 的 `footOffsetY + visualOffsetX`。禁止实体走 `resolveStructureFootOffset()`、幽灵另走一套最低像素计算，否则预览贴地但落地后跳动。像素四边形物理仍只允许显式 `autoFootprint:true` 的异形建筑使用。
- **建筑/单位统一图层拓扑**：建筑主体及运动叠加层当前帧真实 alpha 必须合并为完整世界 AABB（含 flip/rotation），Sprite 尚未创建时才由 `visualFootprint` 确定性回退；二维空间索引只让画面 X/Y 都相交的建筑参与仲裁，禁止退回仅按 X 列收集。视觉 AABB 只负责宽相位，前后关系必须由建筑逻辑 footprint 与单位脚点共用的 u/v 比较器决定；普通格网建筑不得再进入墙/门的面线仲裁，也不得恢复 `structureFrontYAtX` 或单栋 depth 补丁。静态结构 gap 必须大于动态单位前后各0.5所需的完整插槽。`_faceDepth` 永远保留几何前缘，拓扑最终值只写 `_structureRenderDepth`。
- **接地拟合派生资产（2026-08-22）**：建筑贴图或 `displayW/displayH` 变化后必须运行
  `node tools/generate-building-preview-assets.mjs`，同步生成 `data/structure-ground-fits.json` 和
  `assets/ui/building-thumbnails/`。manifest 键包含 texture/frame、源尺寸、显示尺寸、nominal footprint
  和完整 `visualFootprint` 标定，禁止烘入镜像或拟合后的额外平移。运行时仍只从
  `resolveStructureGroundFit()` 读取；未命中的新图最多做一次 768px 长边的批量 alpha 读回，禁止恢复
  `TextureManager#getPixelAlpha` 逐像素循环。

### 世界-122 扩展 + 分块地板 + 能源矿世代布局 + 基地门可攻击（2026-08-16；2026-08-22 更新）
- **地图 4096² → 6144×4096**：scene8 width/height + origin(3072,2048)，data 与 public/data 双份同步；
  刷怪点重排 9 点多路线（右端 7 + 中距 2），`spawn.alertRange 3800→6200`（最远刷怪点距基地 5240）；
  `_loadScene8` 边界墙按宽高分开（勿退回正方形假设）。
- **地板分块惰性加载（方案 B）**：`applyDungeonFloorChunked(w,h,2048)` 注册 `Renderer.terrainChunks`；
  `bakeDungeonFloorChunk` 用**确定性种子按全局行列网格**烘焙（同一 (row,col) 永远同砖，跨块无缝），
  边缘渐隐只在贴地图边界的块上画；GameScene `_updateTerrainChunks` 按相机视口+320px
  每帧最多烘焙 1 块、远离 900px 连同纹理卸载（常驻显存 2~4×16MB）。
  ⚠ 坑：切分块模式必须**先销毁旧 terrain 精灵再删纹理**——否则精灵引用已删纹理，
  Phaser TexturerImage 崩 `frame.source null / reading 'resolution'`（2026-08-16 真机踩过）；
  switchScene 离场统一 `Renderer.terrainChunks = null`，其他场景 floor applier 也清。
- **能源矿世代布局（2026-08-22 当前口径）**：`ENERGY_CONFIG.generation` 每个位面世代使用同一随机流生成
  5 个远距主矿簇（每簇 10~12）和传送门 1200px 环上随机方向的 3 矿保底簇；主矿簇中心与实际矿格
  仍不得落在传送门 3000px 内，保底簇实际矿格不得进入 1200px 内。每矿固定绑定一个
  128×64 等距格，簇内只沿已成功放置格的四邻格连续扩张；矿体保持零碰撞、允许单位穿行。
  运行时 Sprite 画布以 130px 补偿母版透明安全边，实际 Alpha 宽度至少覆盖完整 128px 单格，
  并允许最多约每侧 4px 的纯视觉跨格侵入，让相邻碎石与能量块连续拼接；该侵入不得扩大
  逻辑占格、碰撞、采集范围、生成排斥或快照边界。
  快照保存 `cellI/cellJ`，同格去重；旧固定散点快照只迁移剩余数量与状态，不把已采矿点补回。
- **枯竭生命周期**：单矿 5000~8000 储量，普通来源按有效采集伤害 100% 转为能源。采空后保活显示
  暗灰裂纹态 650ms，再复用 `BuildingSinkEffect` 沉陷并从节点表/实体表永久清除；不再原地重生。
  空矿数组是权威快照，离场返回不得因 setup 的初始生成结果重新刷矿，只有位面世代重建才重新布局。
- **矿脉覆盖型建筑合同（2026-08-25）**：需要压在矿脉上工作的配置型建筑必须在
  `producer-buildings.json` 显式声明 `requiresEnergyVeinOverlap` 与 `allowsEnergyNodeOverlap`。建造门禁使用标准
  2×2 建筑逻辑 footprint 与仍可采矿点的 1×1 footprint 做严格面积重叠；边缘仅接触不算重叠，并且预览与扣费前
  最终入口必须复用同一判定。矿点恢复、每秒防叠清理和生成格合法性检查只对实际覆盖该矿点的显式建筑放行，禁止
  全局忽略 `WallSystem` 阻挡，否则普通建筑下方会重新长矿；视觉底座、Alpha 侵入和 `visualFootprint` 均不得参与门禁。
- **树木间距**：treeScatter.minDist 95→150（6144 地图 100 棵，候选拒绝 40~50 次属正常；
  2026-08-16 树木已移除，同口径改 cactusScatter.count 80 / minDist 150）。
- **基地门可攻击**：基地门由 `{...CoverGate}` 换成 `BuildableGate`（Combatant）——有 hp /
  沉陷死亡 / 建筑面板详情（常锁/常开/修理），与玩家建造门完全同构；face 线几何公式一致；
  摧毁后门段移除、通道永久打开（`_teardownCollision` + BuildingSinkEffect 接管三段精灵）。
- **门面板点击入口**：game.js 点击分发接 `BuildingSystem.tryInteract`（掩体/门自动开面板进详情，
  260px 交互距离；B 面板已打开时仍走 BuildingSystem._onMouseDown）。

### 世界-122 地面连续铺贴定稿（2026-08-16：泥/沙无缝地面 + 草点缀）

场景八地面从"菱形石板地砖"改为**无缝连续纹理**（详细管线见第 2 区
「地面无缝纹理统一入口：floor-asset.py」）：
- 泥地 `floor_mud_seamless` + 沙地软边补丁 `floor_sand_seamless`（噪声不规则边界）；
- 30° 等距纵向压缩 0.5774、侵入式分块 pad=3（细线/黑边收尾）；
- 草簇 `deco_grass_1/2` 固定朝向点缀，不参与砖的 X/Y 翻转；
- 降饱和：泥 S 68.8→39%、沙 59.1→37%（desaturate-texture.py）。
- 已验证：跨界亮度扫描无黑缝（最暗 103）、沙泥无直角边、8 向循环无方向问题。

**沙漠地貌v2（2026-08-26）**覆盖上述scene8旧泥/沙混合表现：运行时以
`data/desert-terrain.json`为唯一参数源，全域使用世界相位连续的`floor_sand_seamless`，再按道路同源
128×64格网仅以0.14密度确定性叠加3帧透明碎石；风纹、裂缝和冲蚀线已从正式图集和生成脚本删除。
18组模型化小件使用世界坐标宏格散布，
相邻2048分块共用同一候选坐标与位面世代seed，重烘焙不漂移、分块边不留空带。建筑清除区同时排除
细节格和小件，底层连续沙纹仍保持无缝；枯枝权重固定为低频，
其余新增石质、枯植、骨骸、陶器、遗物和盐晶轮廓负责随机变化。地貌只写烘焙画布，不进入实体、碰撞、占格、寻路和快照。
菱形地图的64px黑色边缘淡出是最终合成层，必须在所有地貌之后绘制，保证地图边缘仍自然融入区外黑地。

### 世界-122 荒漠化（2026-08-16：树木移除 → 仙人掌障碍物）

树木（`obstacle_tree_*` 五变体 + 散布/生成管线）已**全部移除**：贴图、`ISO_WALL_GEO`
注册、`_scatterTreesScene8` + `treeScatter` 配置、BootScene 加载、gen/process-tree-* 脚本、
`_blockout_specs/tree_*` 白模、cdp-tree-* 探针、prompts/obstacle.md 树木节、SKILL 散布条目。
（通用 `WallSystem.addTree` 程序化圆树仍保留——主神空间/雪原 demo 用，非世界-122。）

**替代 = 仙人掌 4 姿态障碍物（`_scatterCactiScene8` + `scenes.scene8.cactusScatter`）**
- 资产：`assets/terrain/obstacle_cactus_{saguaro2arm,saguaro1arm,barrel,cholla}.png`
  （2026-08-24 V2 真实尺寸依次为 568×1147 / 395×1046 / 872×888 / 708×1133；
  `ISO_WALL_GEO` foot 依次为 139×49 / 147×53 / 382×132 / 146×53，按新分辨率等比换算，
  obstacleH 仍为 240 / 230 / 105 / 150，因此世界碰撞占地与旧版保持一致）。
- V2 管线：`cactus-pack-blender.py` 分别建立双臂巨柱、单臂巨柱、桶状和多节鹿角柱四种可编辑模型；
  `prompts/cactus-obstacle-v2.md` 锁定结构、44.8° 等距方向、30° 俯视、低饱和沙漠植物 PBR
  与柔和左上顶侧光；ImageGen 只做材质精修，最后经 BiRefNet 重建真透明并紧身裁切。
- 模型/预览/生图母版/透明终稿保存在 `tools/ai-gen/_cactus_upgrade_20260824/`；运行时稳定纹理键、
  `cactusScatter` 的数量/排除带/随机水平镜像及存档合同不变。
  **低对比铁律**：同一 STYLE 块（photograph of a real desert cactus + muted + low contrast +
  ~30° 微俯 + 白底无影）+ 后处理降饱和降对比；数值验收白边 <0.5%、无品红、meanSat 19~25、
  lumStd ≈38（cholla 金刺初版 55 偏高，单独 `--contrast 0.7` 拉回 45）。
- 散布：逻辑与旧树木同款（菱形内、排除基地房/玩家/能源点/刷怪点、footprint 口径、
  minDist 150、count 80、随机 flipX），调用顺序铁律不变（DefenseSystem.setup 之前）。
- 原低矮蕨类/小植物点缀已连同4张贴图和配置入口删除；World-122植被只保留上述四种仙人掌障碍物。

### 全位面通用 Phaser 降雨（2026-08-23）

- **唯一入口**：`GameScene` 持有`RainWeatherSystem`，统一读取双份
  `game-config.json#weatherEffects.rain`。降雨目标必须由同一合同合并：`targetSceneIds`保留指定场景兼容，
  `targetSceneTypes:["instance"]`让后续普通位面自动继承，非普通类型可用场景级
  `environmentEffects.rain.enabled:true`显式接入，场景级`false`显式退出；最后以
  `excludedSceneTypes:["dungeon"]`统一排除地牢。`WorldWeatherSystem`的排期/预报/调试与
  `RainWeatherSystem`的实际雨幕必须消费同一目标规则，禁止新增位面时只补其中一侧或继续复制ID白名单。
  `WorldWeatherSystem`是跨场景排期与存档
  真源，只用统一游戏时钟维护每个位面的开始/结束绝对时间；`RainWeatherSystem` 仍只接收当前档位并负责无玩法
  影响的视听表现，不创建实体、物理体、AI或独立计时器，加载切场或天气结束时立即销毁。
- **三层表现**：运行时用 Phaser CanvasTexture 生成纵向渐变雨丝和2:1地表水花；雨丝位于前景
  depth 99976，冷色压暗覆盖位于99968，均低于战争迷雾99980和昼夜覆盖99990；水花使用
  `GROUND_WEATHER + 0.01`，压在建筑/单位之下。禁止给单粒子增加 Filter/postFX。
- **四档强度**：`defaultIntensity:light` 明确首版效果为小雨；中雨、大雨、暴风雨只通过
  `intensities` 合并覆盖发射频率、单次数量、存活上限、寿命、横风与纵向落速、尺寸、水花和环境压暗。
  档位切换必须销毁并按新上限重建两个 Emitter，禁止对既有池反复 `updateConfig()` 扩容。
  位面强制档位必须配置在 `schedule.forcedIntensityBySceneId`；scene8 沙漠固定为 `storm`，排期、旧存档恢复、
  天气预报和开发工具手动触发都必须归一为暴风雨，不能只修改随机权重。
- **暴风雨雷电**：只有 `storm.thunder.enabled` 为真时创建纯白闪光矩形；触发后必须以 alpha 1
  覆盖世界画面 `whiteHoldMs:200`，再在 `recoveryMs:650` 内线性衰减回0。闪光层高于战争迷雾和昼夜覆盖，
  并覆盖整个 GameScene 摄像机输出；独立 HudScene 与 DOM UI 始终保留，形成射击游戏闪光弹式白屏。
  禁止绘制分叉电弧，也禁止复用 `lightning-1/2.mp3` 电击声；雷声必须走 `SoundManager.playThunder()` 的
  三套低通棕噪声与低频正弦合成变体并随机选择，服从 SFX/主音量。首次随机等待3.6~7.2秒，
  后续每次等待8.4~17秒；调度只累计统一世界 delta，不引入独立计时器。
- **相机与性能**：雨丝、水花只在 `camera.worldView + viewportMarginPx` 与当前位面菱形的交集内手动发射，
  两个 Emitter 都必须预留粒子池并设置 `maxAliveParticles`；每帧每层最多补8次发射，暂停时只将
  Emitter `timeScale` 设为0，不允许按12288×8192全图铺雨或另起 Phaser Timer。
- **交互开发工具**：位面调整栏的每个位面行显示“降雨”状态并提供小雨/中雨/大雨/暴风雨四个按钮；
  只有当前已进入位面的按钮可用；按钮通过 `WorldWeatherSystem` 的非存档调试覆盖切换强度或压制当前自动天气，
  不能直接把视觉层当作天气状态真源。存在强制档位的位面只显示该档按钮，避免提供实际不会生效的选项。
  雨天气默认不改视野、移速、战斗、地形含水量或昼夜时钟，后续玩法化必须另建状态真源，视觉系统只接收模式。
- **建模积水与街景动态**：`RoadsideDecorationSystem`只读取权威`rainState.active/intensityId`，不维护第二套
  天气名单或计时器；任何按上条合同接入降雨的场景，只要存在建筑附近的真实城市道路，就自动使用4种固定
  相机建模积水，小雨/中雨/大雨/暴雨仅调整确定性生成密度，停雨时派生重建清除。夜灯同样只读取
  `EnvironmentLightingSystem.getAmbient().daylight`并交换同模型贴图；营业密度读取既有`_economyWorking`
  低频刷新。三者均为纯视觉派生，不创建道路节点、碰撞、占格、寻路、生产或存档字段。
- **预测门禁与事件接口**：`weather_forecasting` 科技只解锁建造，玩家仍须在对应位面保有存活的
  `weather_forecast_tower` 才能看到该位面的天气预报。预测塔使用独立正式贴图、配置驱动功能建筑并随世界快照持久化；
  顶部条由 `WorldEventTimelineSystem.registerProvider(id, provider)` 聚合事件，
  袭击和天气只是首批 provider；新增事件必须提供稳定 id、发生游戏时间、图标、标签与状态，不得耦合进 HUD。
  正式事件图标使用 `assets/ui/event-icons/` 下的 256×256 透明冷钢六边形 PNG，provider 通过 `iconPath`
  提供资源路径并保留 `icon` emoji 作为加载失败回退；HUD 只负责通用渲染，不按事件类型硬编码贴图。
  四档降雨图标必须以 `rain-heavy.png` 为不可变视觉母版，共用同一云层、徽章边框、构图与透明轮廓；
  小雨、中雨只逐档减少云下雨丝，大雨保持密集雨幕，暴风雨只在同一密集雨幕上增加单道无分叉闪电。
- **天气塔升级闭环（2026-08-24）**：`advanced_meteorology`（高级气象学）是天气塔升级的统一科技门禁，基础
  `weather_forecasting` 仍只负责解锁建造。天气塔通过 `economyType:"weather_forecast"` 接入标准人口经济面板，恒定只有1个
  气象员岗位；未上岗时不向时间进度栏提供任何预测，也不产生科研点。四项本栋升级统一读取
  `building-upgrades.json#weather_forecast_analysis`：“预报展望”把监测窗口从2天扩至5天并承载雨量等强度区分；“气象科研”
  三级为单岗位提供约0.58/1.17/1.75科研点/秒；满配三级研究院为2基础+1.5精密设备=3.5点/秒，因此满级天气塔约为其一半；“时段解析”补充预计结束时间与持续时长；
  “灾害预警”接入本塔所在位面的特殊天气。等级和 `_weatherUpgrade` 读条必须进入前台快照、后台结算和恢复构造；升级必须同时
  经过 UI `TechnologyGate` 与 `WeatherForecastTowerSystem.startUpgrade()` 业务校验。监测窗口内的全部降雨必须显示，后续排期写入
  `WorldWeatherSystem.forecastQueue` 并按已公布顺序兑现，禁止刷新 HUD 重新随机。
- **多塔预报择优（2026-08-24）**：同一位面因旧档或调试状态同时存在多座天气塔时，预报权限只能取一座已上岗、存活且可工作的塔，禁止把多塔模块拼接或沿用数组第一座。按本栋四项模块总等级择优；同级依次比较预报窗口、灾害预警、时段解析和气象科研，保证时间进度栏稳定使用效果最好的单塔档案。
- **特殊天气预报注册协议（2026-08-24）**：沙尘暴、死寂雾潮及后续位面事件通过
  `WorldSpecialWeatherRegistry.registerProvider(id, provider)` 注册，provider 必须声明 `forecastSceneIds` 并返回稳定事件ID、
  `sceneId`、起止游戏时间、状态和强度/风险字段。天气塔只向注册表查询自身所在 `sceneId`，禁止一座塔跨位面泄露其他世界预报；
  新位面只需注册 provider，不得在天气塔或 HUD 中新增事件类型分支。特殊天气只有完成“灾害预警”升级后可见。

### 战地医院岗位治疗与医疗科技（2026-08-24）

- **配置与占地**：`producer-buildings.json#field_hospital` 是普通2×2配置型服务建筑，逻辑 footprint、碰撞和寻路保持标准2×2；正式图、缩略图、`structure-ground-fits.json` 与环境光照派生图按建筑导入管线生成，视觉 footprint 只参与渲染接地，不得反推扩大逻辑占格。
- **科技门禁**：医疗线固定接在军事指挥的 `shield_formation` 之后，顺序为“盾阵学 → `field_medicine`（战地医疗）→ `medical_standardization`（医疗标准化）”，三者位于同一科技树轨道；`field_medicine` 只解锁建造，`medical_standardization` 统一解锁 `hospital_rounds / hospital_medicine / hospital_triage / hospital_staff` 四项本栋升级。升级按钮和 `FieldHospitalSystem.startUpgrade()` 必须同时校验科技，禁止只做 UI 灰态。
- **岗位与治疗真源**：岗位容量读取 `population-economy.json#field_hospital` 和 `hospital_staff` 模块；每名医护贡献固定配置效率，实际治疗速度再乘当前位面人口效率与最强经济工坊增效。治疗只选择范围内仍存活且未满血的 player/companion，按生命比例最低优先，同时人数取“上岗医护数与病床数”较小值；只能恢复生命，禁止复活。同一患者落入多家医院范围时只允许实际治疗率最高的一家生效，不叠加回血；治疗率相同则优先实际接诊容量更高者，仍相同再按稳定建筑 ID 仲裁。
- **前后台与存档边界**：`hospitalModules`、`hospitalUpgrade` 和治疗节拍进入建筑快照；后台位面只推进本栋升级读条并同步岗位上限，不模拟治疗，因为现有后台驻军快照只有兵种数量、没有逐单位生命值。若未来要做离屏治疗，必须先扩展逐单位伤势协议，禁止凭总人数伪造回血。
- **详情面板**：继续复用人口经济建筑的统一标题、状态、参数网格、岗位控件、二级进度和升级卡；参数必须同时显示满员配置速度与受岗位/人口/工坊影响后的实际速度，并明确当前接诊人数和病床容量。
- **专属图标**：四项医院升级使用 `assets/ui/building-upgrades/hospital-*.png` 的256方形冷钢四铆钉框；两项医疗科技使用 `assets/ui/technology-icons/field_medicine.png` 与 `medical_standardization.png` 的1024六边形冷钢徽章。图片路径是主显示源，配置中的 emoji 只保留为加载失败回退。

### 世界-122 风吹扬沙环境效果（2026-08-22 首版）

- **唯一入口**：`GameScene` 持有 `WindblownSandSystem`，只读取
  `scenes.scene8.environmentEffects.windblownSand`；不得把环境粒子登记为实体、物理体、AI、
  快照或后台模拟对象。
- **双层管线**：系统运行时生成白色软风线 `windblown_sand_streak` 与椭圆软雾
  `windblown_sand_haze`，再由 ParticleEmitter 统一 tint 为沙色；禁止复用实际仅含 18×4 棕色细条的
  `smoke_particle`。贴地层登记 `WORLD_RENDER_LAYERS.GROUND_WEATHER=-994.3`（结构阴影之上、
  压平建筑之下）；前景层固定 depth 99975（战争迷雾 99980、昼夜覆盖 99990 之下）。两层均用
  `NORMAL` 混合，基础版禁止为每粒沙叠加 Filter/postFX。
- **地面区分度**：世界-122 米黄沙地与土黄泥地本身接近普通沙色，粒子不能只用同明度浅黄。
  中档贴地风线固定采用浅奶金/饱和橙沙/深赭阴影三档 tint，alpha `0.72→0.08`；前景沙雾
  alpha `0.34→0.05`。保留沙尘色相，但必须同时存在高光与暗部轮廓，scene8 在 0.7 zoom 下仍应
  肉眼可辨；夜间整体 alpha 倍率不得低于 0.7。
- **风向口径**：配置中的 `windUv` 是等距地面局部轴方向，只允许经
  `isoLocalToWorldDelta()` 投影一次；贴地风线与前景沙雾在同一时段必须共用唯一方向，只允许速度大小
  不同，禁止给单粒子增加横风方向偏移。初始方向来自 `windUv`，随后按 `directionHoldMs` 保持一段时间，
  再随机选择一个在屏幕投影后与上一方向至少相差 `directionChangeMinDegrees` 的新方向；换向时先清空旧方向存活粒子，
  禁止新旧风向同时出现在画面中。方向计时和阵风相位都只累计 `GameScene` 传入的 `worldDelta`，禁止另起
  `Date.now()`、`setInterval()` 或独立 Phaser Timer。
- **Phaser 4 动态换向陷阱**：禁止用 `ParticleEmitter.updateConfig()` 周期换向；它会合并初始配置并再次
  执行其中的 `reserve`，长期运行会反复扩充 dead 粒子池。正确口径是先 `killAll()`，再分别调用
  `setParticleSpeed()`、`setEmitterAngle()` 并更新 `particleRotate`，只替换运动参数而不重建粒子池。
- **性能边界**：粒子只在 `camera.worldView + viewportMarginPx` 与世界菱形的交集内产生；两层
  深度都低于战争迷雾，未探索区域由迷雾最终遮挡，禁止在发射前用随机点强制命中 `VISIBLE`
  单元，否则基地遮挡、夜间或观察镜头下可能让两个 emitter 长期保持 0 粒子。两个长生命周期
  发射器在创建时 `reserve`，并以 `maxAliveParticles` 硬封顶。
  `quality: low|medium|high` 只缩放频率和池上限，禁止按完整 12288×8192 世界铺粒子，也不得
  逐帧重烘焙 2048 地板分块。
- **生命周期**：仅 scene8 且配置启用时创建；暂停时 emitter `timeScale=0` 且停止新发射，
  `SceneManager.isLoading` 或离开 scene8 时立即 `reset/destroy`。它是可丢弃的纯视觉状态，
  重进世界从零开始，不写存档。
- **配置读取**：环境效果必须优先读取 `GAME_CONFIG.scenes.scene8` 真源；
  `SceneManager.scenes` 是 `init()` 时缓存，只可作兜底，否则开发期 JSON 热更新后可能一直读到
  不含 `environmentEffects` 的旧场景对象，表现为两个 emitter 从未创建。

#### 世界-122 沙尘暴特殊天气（2026-08-22）

- **逻辑与视觉分离**：跨场景天气状态唯一归 `World122SandstormSystem`，只用统一游戏时钟的绝对
  `elapsedMs` 保存 `warning/start/end` 锚点；`WindblownSandSystem` 仍是离开 scene8 即销毁的纯视觉层。
  存档写入 `worlds.sandstorm`，旧档缺失时从当前游戏时间重新排期，禁止用 `Date.now()`、逐帧概率或
  把天气塞进位面快照。
- **状态机与配置**：`clear → warning → active → clear`；每轮平静期只抽一次
  `intervalDays`，提前 `warningLeadDays` 走顶部提示栏，爆发时只抽一次 `durationDays`。默认间隔
  3~6 游戏日、提前 0.25 日预警、持续 1~2 游戏日；T 键位面页的 scene8 行按钮直接进入 active。
- **暴风视觉档位**：激活时以基础扬沙配置合并 `sandstorm.visual`，仅在模式切换时重建两个 emitter，
  从而安全扩大 `reserve/maxAliveParticles`、范围、尺寸、寿命与速度；不得逐帧合并后触发重建，也不得
  用 `timeScale > 1` 同时加速粒子死亡。`lockDirection:true` 表示沙尘暴从爆发到消散始终锁定进入暴风时的
  唯一风向，不执行普通扬沙的周期换向；贴地与前景速度分别为 `640~1040 / 380~640 px/s`，相对首版暴风
  精确翻倍。普通扬沙仍按 `directionHoldMs` 周期换向，两个档位均禁止单粒子方向抖动。
- **视野乘算契约**：沙尘暴只对 `player/companion/military/scout/cavalry` 单位视野配置在
  `VisionSourceRegistry.radiusOf()` 最终半径链增加 scene8 专属 `×0.5`，传送门、塔与出兵建筑不受影响；
  与夜晚 `×0.5` 乘算后为 `×0.25`。不得修改 AI 感知、仇恨、攻击距离、相机或永久探索记录；
  战争迷雾会周期重读半径，天气切换无需重建迷雾网格。

#### 世界-122 沙漠干旱与粮食天气倍率（2026-08-28）

- **限定天气真源**：干旱只登记在`scene8.environmentEffects.drought`，由
  `World122DroughtSystem`使用统一游戏时间维护`clear → warning → active → clear`绝对时间锚点；默认间隔
  2.5~5游戏日、提前0.25日预警、持续0.75~1.5游戏日。状态保存到`worlds.drought`，并按特殊天气
  provider协议注册到天气塔预报；禁止把排期塞进纯视觉对象、位面快照或`Date.now()`计时器。
- **高温视觉**：`DroughtHeatSystem`只消费干旱是否实际生效，在GameScene世界画面边缘生成运行时
  CanvasTexture暖橙/金黄ADD辉光；中心透明，四边与角落更亮，带慢速呼吸，并以约1.8秒淡入、2.4秒淡出。
  深度99988位于战争迷雾之上、昼夜环境覆盖之下，独立HudScene和DOM UI不受影响；离开scene8或清场时销毁，
  不创建实体、碰撞、滤镜、全图粒子或存档字段。
- **粮食天气唯一倍率**：`getFoodProductionWeatherEffect(sceneId, gameTimeMs)`是粮食产出的统一解析器。
  干旱为`×0.5`；小雨/中雨/大雨/暴风雨分别为`×1.25 / ×1.5 / ×1.75 / ×2.0`。意外重叠时降雨优先，
  两者禁止叠乘。倍率只乘最终粮食成品，不改岗位、人口效率、加工速度、原料扣除、运输、祭品概率或仓容。
  风车、面包屋、连锁餐馆、奶酪农场的当前位面周期、详情面板和`world122-sim`离场结算必须消费同一结果。

#### 全位面通用毁灭挑战（2026-08-23）

- **状态真源**：`WorldDestructionChallengeSystem` 按 `sceneId + worldEpoch` 保存 scene8~scene11 的独立挑战记录，
  主存档入口为 `worlds.destructionChallenges`。挑战只使用 `EnvironmentLightingSystem.elapsedMs` 推进，禁止使用
  `Date.now()`、独立 Timer 或位面快照保存调度状态。传送门被毁、世代号失效或新游戏重置时删除记录；正常离场、
  观察切换和存读档不得停止挑战。
- **生成规则**：触发后等待5秒，每5秒在目标位面菱形地图右侧角落生成6只普通怪，以累计60只普通怪为一个周期。
  每个周期中点（30、90、150……）生成精英，第N周期生成N只；周期终点（60、120、180……）以领主取代同批精英，
  第1~2周期各1只领主、第3~4周期各2只，之后每2个周期再增加1只。离场期间保留
  状态但不物化实体，回场后只生成下一批，禁止追补离场期间全部积压批次造成瞬时实体洪峰。
- **生成背压与热路径契约**：普通怪达到 `softMaxAlive:36` 后保留待生成队列并等待空位，所有挑战怪不得突破
  `hardMaxAlive:60`；每帧最多物化 `spawnPerFrame:2`，普通怪需为里程碑保留 `milestoneReserve:6` 个槽位。
  待生成队列属于瞬态调度状态，不写入存档。防守怪生成时必须预置基地目标，感知与友军决策需错峰；远距离建筑目标
  使用战略可达判断，只在接近攻击范围后做精确 LOS，禁止恢复逐怪逐帧全场建筑/敌人扫描。
- **战斗复用**：怪物必须走 `DefenseSystem.spawnDestructionChallengeMonster()`，复用正式 normal/elite/lord 池、
  `WallSystem.findSafeSpawn`、防守目标选择和沿途交战逻辑；禁止复制怪物工厂或另写 AI。挑战怪带独立标记，不能进入
  五日入侵的存活数、清波和胜利判断，普通入侵结束也不得误删挑战怪。无尽挑战默认不结算防守金币，避免无限刷金。
- **配置与工具**：参数真源为双份 `world-system.json#destructionChallenge`，默认 `spawnIntervalMs:5000`、
  `normalPerBatch:6`、`eliteEveryNormals:30`、`lordEveryNormals:60`、`eliteIncreaseEveryCycles:1`、
  `lordIncreaseEveryCycles:2`。交互开发工具“位面”页每一行都提供触发按钮；
  未接通或传送门已毁时禁用，触发后只显示状态与累计数量，不提供提前停止入口。

### 世界-122 建筑与建造（2026-08-17）

**建筑贴图替换工作流（素材库 → 英文名 → 显式 visualFootprint 标定）**
- 源素材：`E:\无尽轮回\游戏\素材库\场景\建筑\{军营,矿场,铁匠铺,草屋}.png`（4096² 等距斜视、
  透明背景、建筑贴底边）；复制到 `assets/terrain/` 必须改英文名（barracks/mine/blacksmith），
  禁止中文文件名。
- 显示参数标定（勿拍脑袋）：生成/换图/调尺寸时至少同步维护 `displayW/displayH/footOffsetY`，运行时和
  离线生成器会自动派生严格视觉 footprint；需要精调素材语义中心时，再填写归一化 `visualFootprint`
  覆盖派生值。`strict` 模式映射到256×128（基地512×256）；禁止用 alpha 最低点、稳定横截面或 bbox
  作为正式中心，也禁止追加 `anchorAdjustX/Y`。`autoFootprint:true` 仅供明确异形建筑启用。
- 替换点：BootScene `load.image`（键名即英文）、各建筑 config `tex`（实体渲染 idleKey）、
  building-system `BUILD_ITEMS.tex`（面板缩略图 img 路径自动跟随）。
- **显示尺寸统一口径（2026-08-23）**：`displayW/displayH/footOffsetY` 是首批标定迁移来源；运行时正式
  结果由 `visualFootprint` 映射计算。普通2×2严格落到256×128，4×4基地严格落到512×256。
- 新增产兵建筑：`data/producer-buildings.json` 加条目（唯一真源，含 tex/displayW/H/footOffsetY/
  spawn/unitTypes/modules）；`building-assets.js`会从配置自动建立运行时manifest，普通建筑不得再新增
  一份手工常驻名单。

**建筑开发标准工作流（世界-122，2026-08-18 定稿；新建筑/替换建筑一律按此开展）**
1. **素材先入库**：从 `E:\无尽轮回\游戏\素材库\场景\建筑\` 复制到
   `assets/terrain/<english_key>.png`；只用英文 key，禁止在运行时引用素材库外路径。
2. **紧身裁透明边，再标定视觉 footprint**：源图若有大透明留白，先按 `alpha>16` 紧身裁剪；随后
   更新 `displayW/displayH/footOffsetY`，统一 helper 会自动派生中心、宽度和纵深。只有自动结果仍需
   素材级精调时才写显式 `visualFootprint`。预览、实体、overlay与阴影共用同一标定；alpha扫描只可
   给出初始建议，不能直接成为正式中心。
   **禁止**直接把带留白的 4096² 图塞进项目后沿用旧尺寸，否则会缩小/悬浮。
3. **配置唯一真源**：普通2×2建筑统一登记 `data/producer-buildings.json`：
   `cost/hp/def/mdef/tex/displayW/displayH/footOffsetY/sellRefundRatio` 为必填数值。
   `visualFootprint` 为可选精调覆盖；禁止与 `anchorAdjustX/Y` 并存。配置或贴图变化后必须运行
   `node tools/generate-building-preview-assets.mjs`，让新标定进入版本化 manifest。
   - 产兵：`spawnEnabled=true` + `unitTypes/modules`；
   - 工坊：`spawnEnabled=false` + `workshopType/abilities`；
   - **仅数值/详情、暂无玩法**：`spawnEnabled=false, panelMode:"detail", modules:{}`，
     不要伪装成空能力工坊。
4. **资源注册与驻留**：普通建筑在`producer-buildings.json`登记`tex/assetPath`后，由
   `src/phaser/assets/building-assets.js`自动收录主体；`animation`、`groundContact`、
   `foregroundOverlay`、`recruitmentTiers[].visual`也必须放在同一配置内，房屋/仓库/研究所各等级放在
   `population-economy.json`的`levels`。BootScene中的历史`load.image`声明会被驻留器拦截，不能把它
   当成唯一登记点；新增普通建筑不得绕过manifest做无条件Boot常驻。配置`tex`、`BUILD_ITEMS`缩略图和
   实体`spriteCfg.idleKey`必须同key。
   - 传送门、位面祭坛和确实被地牢障碍共用的小型贴图才可进入`CORE_TEXTURE_KEYS`；不得因为加载失败
     就把普通建筑改为核心。建造卡选中时`setBuildingPreview()`临时pin，取消预览后必须clear；场上实例、
     升级`targetLevel`与多等级并存由`ensureBuildingEntities()`计算，业务代码不得直接删除纹理。
   - 建筑升级/扩建项目的`iconImage`属于DOM图标，不进入Phaser manifest。新增、改名或删除项目后运行
     `powershell -ExecutionPolicy Bypass -File tools/build-runtime-project-icons.ps1 -Prune`；生成器会扫描
     双份配置真源中的`data/`配置，以及`src/`内直接引用的`assets/ui/building-upgrades/`图片，不再维护
     三张手工路径名单。关闭面板/悬浮窗后必须移除`<img>`节点。
   - **建筑面板缩略图统一规格（2026-08-20）**：以道路缩略图 `building_road.png`
     的 128×64、2:1 画幅作为统一预览边界；`.build-panel .we-thumb img` 使用相同大小的预览框，
     所有图片必须通过 `object-fit:contain` 等比缩放并完整显示，禁止拉伸、压扁或裁切。
     新增建筑若提供独立 `icon`，使用透明背景 128×64 PNG，并在该画布内保持原图宽高比；
     未提供时仍可回退 `tex`，由建筑面板等比缩放。该规则只作用于面板缩略图，不得据此修改
     场景实体的 `displayW/displayH`、footprint 或碰撞。
   - **面板性能口径（2026-08-22）**：正式卡片统一引用上述派生 128×64 缩略图并异步解码，禁止把
     3K~4K 世界贴图直接放进卡片。金币/能源或场景条件变化只原位更新卡片 class、title 和价格；
     只有科技折叠或排序变化允许重建网格。鼠标预览每个 `requestAnimationFrame` 最多计算一次，
     但 `mousedown` 必须用点击坐标同步冲刷，`mouseup` 必须用松开坐标重算拖墙/道路终点，且
     `_place()` 保留完整 `_canPlace()`、科技、条件和支付复验；禁止跨帧缓存动态合法性。
     普通幽灵、对齐线和12格外围道路可在同一 Phaser Scene 内隐藏复用，切场/关面板必须销毁并
     取消待执行 rAF；4格门、楼梯等复合预览继续走专用清理，禁止近似成单张图标。
5. **遮挡/占地接入**：构造中走 `applyBuildingFootprint(this, 2)` +
   `setupStructureDepth(this)`；新增建筑不手写另一套碰撞、脚底或深度规则。
   - **导入/换图/调图必须同步检查图层（2026-08-23，强制）**：任何建筑首次导入，或修改
     `texture/displayW/displayH/footOffsetY/anchorAdjust/overlay/workingEffect` 后，都不能只检查贴地和尺寸；
     必须同时确认实体具备 `_isGridBuilding + _structureDepthMode:'iso_footprint'`，主体进入
     `_syncStructureRenderOrder()`，运动 overlay、按需工作特效与标签跟随最终结构 depth 通道。保留 NPC、商店、
     对话等身份的建筑不得为了进图层链伪造 `_isDefenseStructure`；应保持业务身份不变，通过
     `applyBuildingFootprint + setupStructureDepth` 接入。建筑换图不得用创建顺序、固定 depth、
     `sprite.y + 常数` 或扩大 footprint 修遮挡。
    - **前角遮挡契约**：动态单位深度必须调用 `WallSystem.resolveDynamicEntityDepth(...)`；单位与建筑
      当前帧真实 alpha 世界 AABB 只负责确认画面确实相交，随后以单位逻辑脚点和建筑逻辑 footprint
      的共享 u/v 比较器建立前后约束。墙、门、掩体再由 `junctionCorrectedDepth` 做独立面线仲裁；
      禁止把普通建筑重新混入墙线算法，或为单栋建筑手写 depth、调整贴图锚点修遮挡。纯视觉平民的最终 depth 必须在
      `GameScene._syncStructureRenderOrder()` 之后统一写入，业务系统只更新位置与动画。
    - **升级换图缓存与多等级拟合（2026-08-27）**：建筑升级切换主体、运动层或前景层的纹理、最终显示尺寸、
      位置、翻转或旋转时，必须用不含动画帧和迷雾显隐的固定视觉几何签名，在同一帧使结构拓扑快速缓存失效，
      并先完成 `_syncStructureRenderOrder()` 再更新动态单位深度；禁止等周期性全量重建后才修正遮挡。多等级建筑即使
      已由显式 `visualFootprint` 严格映射到统一逻辑占格，也必须同步维护各等级 `displayW/displayH/footOffsetY`
      与 ground-fit manifest，避免回退路径、附着层或后续换图审计读取陈旧几何。
      对完整绘制院落/围栏底面的4×4素材，必须由本级 `displayH/footOffsetY` 独立反推
      `centerYRatio = 0.5 + (footOffsetY - 128) / displayH`、`depthRatio = 256 / displayH`，并以
      `strict` 映射确认 `mappedFootprintWidth=512`、`mappedFootprintDepth=256`；禁止用道路补片或
      `uniform` 缩放掩盖错误的纵深标定，否则贴图院落会越出碰撞棱柱并被误判成外围道路。
    - **纯视觉平民占用契约**：不进入 `Game.entities` 的岗位平民仍必须通过
      `civilian-visual-utils` 的目标点投影与分段移动扫掠，使用配置化 `groundRadius` 对普通建筑
      `iso_rect` footprint 做推出/沿边滑行；禁止在业务系统中直接累加坐标穿过建筑后，再用提高
      depth 掩盖空间错误。该轻量占用不注册战斗碰撞、物理体或存档对象。
      阻挡候选必须同时消费标准建筑 footprint 与 `WallSystem.isoSegments` 当前有效墙/门段：门洞段
      随开关 push/splice，自然决定平民能否通行；已有 footprint 的掩体段不得重复推出。所有平民记录
      必须持有权威逻辑 `x/y`，拓扑推出缓动对象时同步平移其分段起点。结构重建递增
      `_structureFootprintRevision`，墙段增删递增 `_collisionRevision`，只在版本变化时重投影静止平民。
    - **复合生产建筑的内部视觉对象（2026-08-25，奶酪农场）**：逻辑占格、内部活动区与渲染层必须
     分开建模。建筑仍以完整 `footprintCells` 参与放置、碰撞和寻路；内部奶牛等纯视觉对象可通过
     `civilianIgnoredStructures:[owner]` 忽略本栋推出，并只在美术标定的安全多边形和连接航点内移动。
     若设计明确要求内部对象始终盖过整栋复合建筑，应在建筑拓扑排序完成后的
     `syncAllCivilianVisualDepths()` 统一读取 owner 的 `frontFx` 通道再抬高，禁止业务系统逐帧私写 depth；
     同栋多个内部对象必须继续按逻辑脚点 Y 分配窄幅、单调的深度偏移（屏幕 Y 越大越靠前），仅在
     完全同脚线时使用稳定 slot 破同值，不能退化为 Sprite 创建顺序。`perimeterTile:"none"` 只关闭
     建造预览、预约和自动外围地块；需要道路物流时仍以概念外围 `roadCells` 查询玩家手铺道路接入口，
     不得因关闭自动道路而绕过连续道路到仓库的业务门禁。
    - **固定地表层契约**：道路（含建筑中央纯视觉补片）、道路贴地痕迹、农田、服务范围圈、结构阴影、压平投影和贴地装置
      不随建筑主体做世界 Y 排序，统一读取 `world-render-layers.js`，按
      `ROAD=-995 < ROAD_EDGE=-994.95 < ROAD_DECAL=-994.9 < FIELD=-994.85 < GROUND_RANGE=-994.8 < STRUCTURE_SHADOW=-994.4 < GROUND_WEATHER=-994.3 < FLAT_STRUCTURE=-994.2`
      严格递增且互不相等；`field/field_fill`必须始终盖过完整道路层族，避免菱形边缘重叠时被道路、路缘或道路痕迹遮盖。建筑主体继续使用结构拓扑 depth，禁止再写
      `主体 depth - 偏移` 或 `building.y - 常数`。纯视觉平民的创建与逐帧 depth 只能走
     `civilian-visual-utils`；建筑拓扑变化时该入口必须把静止平民和既有目的地推出新 footprint。
   - **非墙2×2建筑道路环（2026-08-19）**：实体物理仍是中央2×2，但建造预约统一为4×4；
     `building-road-system.js` 从建筑前顶点锚点反算中央4格，外围12格铺
     `building_road_tiles`。删除独立地基后，中央4格也用外围同源纹理作纯视觉补片，填满主体透明处与
     外围铺装之间的断口；补片使用 `road_fill/field_fill` 语义，不计入道路移速、手铺道路、退款或快照。
     16格逐格检查边界、墙/建筑/障碍与既有预约，禁止用一个放大的
     圆形半径近似；预览外围格必须按各格合法性分别染绿/红。
   - 道路资产必须由固定几何或平材质经过正交30°相机投影，AI不得直接决定菱形角度或外轮廓；
     世界-122格网最终真源始终为`BLOCK_GRID.e1/e2=(±64,32)`，即2:1、边角26.565°。当前
     `building_road_tiles`由`build-world122-street-decor.py`的44.8°根节点铺装模型生成12帧：
     4整洁、4积尘、2裂缝、2修补，并由`buildingRoadFrame()`按45%/35%/15%/5%确定性分配。
   - **城市道路语义街景（2026-08-25）**：`roadside-decorations.json`按住房/农业/金币/能源和通用
     权重表登记28组Blender模型渲染，并拆成`prop / surface / fixture`三层。大件道具继续使用建筑道路27%、
     城内手铺路16%的候选密度；贴地生活痕迹为44%/28%，固定写入`ROAD_DECAL=-994.9`且永远压在单位与
     建筑下方；公共设施为7.5%/4.5%，只在道路边缘按脚点排序，并与同格大件道具互斥。道路格坐标、层级
     独立salt与固定seed唯一决定出现、槽位和素材，禁止自由旋转破坏模型光向。三岔/十字路口、建筑正面
     最下缘入口、城市半径外道路与`road_fill/field/field_fill`三层一律不生成。所有街景Sprite只写视觉
     位置、Alpha和depth，不创建碰撞、占格、道路节点、寻路请求或快照字段；道路拓扑变化时由
     `RoadsideDecorationSystem`派生重建，离场/拆路必须销毁旧Sprite。
   - **道路暴露边缘建模（2026-08-25）**：四个道路邻接方向分别使用独立Blender渲染的路缘石/排水格栅
     与破损积尘版本，共8张128×64透明覆盖图；运行时只在对应相邻格不是`road`时选择该方向，每格最多
     一条边，不旋转或翻转贴图。建筑道路候选密度52%，城市手铺路32%，死路再乘0.7；允许T形路口仅在
     唯一暴露外边生成，但四向连通格没有暴露边所以自然为空。覆盖层固定写入`ROAD_EDGE=-994.95`，位于
     道路之上、生活痕迹之下，不产生碰撞、占格、移速、退款、物流或存档影响，并继续避开建筑正门。
   - 道路与4×4预约属于建筑派生状态：建造/快照恢复时重建，出售/回收/沉陷/离场时释放；
     快照只存建筑，不存Phaser Sprite。
   - **手动铺路（2026-08-19）**：建筑面板增加`道路`，每格10能源；按方块墙同款手势
     单击铺1格、长按沿e1/e2主轴拖动铺一排。只对新增且合法的格逐块扣费，已有道路、
     建筑4×4预约格和实体占用格跳过，能源不足时保留已铺部分并停止。
   - 手动道路不生成实体或碰撞，快照记录
     `{i,j,refundable,buildCost,buildCurrency}`；自动道路环与手动道路共用同一格贴图。
     玩家付费铺设时记录真实成本并按半价回收；建筑拆除后转成的独立附属道路必须标记
     `refundable:false/buildCost:0`，允许继续拆除但禁止返资源，避免拆建刷资源。旧 `{i,j}`
     快照按玩家付费道路兼容恢复。建筑外围12格允许复用手动道路，中央2×2禁止压住手动道路；
     自动建筑拆除后，共享格上的手动道路继续保留。
6. **建筑详情三段式（强制）**：所有可交互建筑（墙/门/射击台/基地/塔/小屋/兵营/
   生产建筑）统一复用 `renderBuildingDetailHeader`，顺序不可颠倒：
   **① 缩略图与名称 → ② 生命条、当前/最大耐久、百分比 → ③ 特殊功能**。
   特殊功能仅放在生命条之后（门控、修理、武器装载、采矿、募兵、研究、仓储、献祭等）；
   无玩法建筑明确显示“暂无额外功能”。详情面板统一右上 `right:26px/top:26px`。
   - **经济岗位第二进度条分类审查（新增经济建筑强制）**：接线前先把指标写成
     `stable_output`、`single_bounded_phase` 或 `parallel_jobs` 三类。持续收益及仅在内部按周期入账的
     `stable_output` 必须读取业务快照中的稳定发挥率，并另显真实每秒产出/消耗；严禁把
     `_economyTickMs / settlementIntervalMs`、取模余数、每秒结算计时或 `Date.now()` 映射成收益条。
     `single_bounded_phase` 只允许显示当前真实阶段，标题必须同步写明取货、返店、加工、送仓或服务，
     进入新阶段后归零时不能仍标作整批/收益。`parallel_jobs` 未提供逐岗位独立条时，禁止用任务进度的
     最大值、最小值或平均值拼成单条；改显示稳定运行效率，避免领先任务完成后由落后任务接管而倒退。
     初次渲染与面板 tick 必须共用 `_getEconomySecondaryProgress()` 同一真源，阻断归零只能来自权威业务
     snapshot，不能由 UI 猜测。静态交付前逐项枚举 `producer-buildings.json` 全部 `economyType`，确认每种
     岗位建筑都有明确分支、标签与数值单位，并搜索 `_economyTickMs`、`settlementIntervalMs`、`progress`
     排除误绑；运行时由用户重点观察一次结算、缺资源/恢复、阶段切换和并行任务交接。
7. **验收**：打开左下「范围」，确认标准2×2碰撞始终为256×128且格心不偏移，贴图底座
   通过视觉锚点与该四边形对齐；禁止再让靶场/军营按像素改变物理宽深。再跑
   `test-structure-visual-anchor.mjs`、
   `test-config-integrity.mjs`（贴图/配置链）+ 建筑面板布局回归 +
   Vite build；有交互的新建筑再跑 CDP 实机探针，检查缩略图、耐久、百分比、特殊功能顺序、
   右上定位和出售/修理等现有操作。
   - **图层验收矩阵（所有建筑贴图变更必做）**：分别让玩家/友军位于建筑后方、前方、左前角、
     右前角，确认后方被主体遮挡、前方与同线单位盖过主体、两侧无突然翻层；再检查相邻建筑、墙门
      交叠时主体拓扑稳定，阴影在主体下，运动部件/按需工作特效在主体上且不穿墙。静态检查只能确认接线，
     不能代替这组运行时视觉验收。
   - **先挡住“塔楼化”**：提示词中的“适当做高”不能解释为窄高塔。抠图和接入前先量主体
     `bboxH/bboxW`，同时对照同占地建筑的横向体量；比例突增或2×2底座只剩小脚点时直接退回重抽，
     不进入去背景和标定阶段。
   - **底线只测承重底座**：门扇、台阶、货物、风车叶片等装饰允许越过视觉底线，但底座左右两组
     承重边仍须接近 `±26.565°` 且构成约2:1菱形。不能把“底部25%全部轮廓”一次拟合，装饰越线会
     污染角度；应沿 alpha 最大外轮廓提取下包络连续线段，再人工确认哪些线段属于地基。
   - **质感指标只作告警**：亮度、饱和度、噪点和邻域差分用于批量粗筛；敞开门口、室内器械、砖缝
     等有效细节也会提高局部差分，不能凭单一“噪点分数”否决。最终仍以风格一致、轮廓清楚、底座
     合格及玩家选定为准。

**最近实例（2026-08-18）**
- 批量替换（素材库 `场景\建筑\新建文件夹`）：兵营/教堂/研究院/草屋/铁匠铺/靶场已分别
  替换 `barracks/church/research_institute/thatch_hut/blacksmith/shooting_range`；全部先紧身裁
  再按已有 `displayW` 重标为：
  `barracks 1157×886 → 271×208/104`（26.403°、底座2.014:1，2026-08-19合格终版）、
  `church 938×993 → 270×286/143`（白底泛洪抠图；25.91°/2.058:1，
  运行时归一254.0×127.0/26.565°，2026-08-19合格终版）、
  `research_institute 1233×998 → 267×216/108`（26.659°、底座1.992:1，2026-08-19合格终版）、
  `thatch_hut 1401×990 → 271×191/96`（锁兵营底座生成；26.892°/1.972:1，
  运行时归一257.3×128.7/26.565°，2026-08-19终版）、
  `blacksmith 1235×996 → 267×215/108`（白底泛洪抠图；27.01°/1.962:1，
  运行时归一256.4×128.2/26.565°，2026-08-19修正版）、
  `shooting_range 1325×1005 → 271×206/103`（26.062°、底座2.045:1，2026-08-19合格终版）。
  **贴图替换不改既有建筑玩法配置**；随后必须运行 `build-lighting-maps.py` 重建投影/轮廓/
  高度/法线派生资产。该批裁后 alpha 全部水平居中、底边贴画布底部，因此图层标准结论为：
  保持 `spriteCfg.offsetX=0`、`footOffsetY=displayH/2` 与 manifest
  `shadow.anchorMode="footprint_center"`；禁止通过修改 collision footprint 或随意加 shadow inset
  来补视觉误差。
- **矿工营地合格终版（2026-08-19）**：素材库 `矿工营地.png` 紧身裁为1200×1013，
  替换 `assets/terrain/mine.png`，标定268×226/footOffsetY113；原图综合26.966°、
  底座1.966:1、完全对称，运行时归一约255.0×127.5/26.565°/offsetX≈0。
  名称保持“矿工营地”，矿工生成/升级/补员/存档等玩法配置不变。
- 传送门：同一目录 `传送门.png` 已替代 `assets/terrain/portal.png`；紧身裁为
  1127×1192，`producer-buildings.json.portal` 标定为
  `displayW=300/displayH=317/footOffsetY=159/autoFootprint=false`；视觉放大但碰撞固定使用
  标准2×2的256×128，不受能量涡底部像素影响；已重建
  `portal_projection/silhouette/height/normal`。
  `panelMode:"portal"` 的详情面板提供 **主神空间 / 世界-123·雪原 / 世界-124·林地 /
  世界-125·地牢遗迹** 四个目的地，按钮必须调用 `SceneManager.switchScene`，禁止直接改 `currentScene` 绕过
  世界-122快照、实体清理和传送冷却链路。

### 世界-124 林地（2026-08-18）

- 场景：`scene10` / 世界-124·林地，沿用世界-122/123 的 `12288×8192` 菱形边界与
  30° 等距连续地板；主神空间传送门进入，底部返回门离开；不接防守、建造或刷怪系统。
- 镜头：`scene10` 必须与世界-122、雪原共同登记在 `ZOOMED_OUT_WORLD_SCENES`，基础缩放为
  `0.7`；不得因林地树木较高而单独恢复 `1.0`，否则同规格世界的可视范围会不一致。
- **生图模型边界**：下列既有资产的模型字段只记录各自产出时的历史来源，不得改写；任何新生成或替换的草地、植物、树木都统一遵循第2分卷当前路由，自由生图使用`flux2-dev-fp8`，锁视角/株型使用`flux2-dev-depth`。Klein只用于明确指定的历史复现或对照任务。
- 草地：`floor_grass_forest_seamless.png` 走 `floor-asset.py grass-forest`（FLUX.2 Dev →
  make-seamless → 降饱和）产出，游戏内连续铺贴 `textureScaleY=0.5774`；
  林地点缀使用 `deco_forest_grass_1~4.png`：FLUX.2 Dev 单株生成 → 非白纯色底 →
  BiRefNet → `process-desert-plant.py --size 256`，视角必须与雪地/沙漠植物统一为
  **微俯30°侧看 + 直立株型 + 低饱和 + 无阴影**；旧 `deco_grass_1/2` 已删除。
  入场 seed 随机、同一次分块重烘焙稳定。
- 树木：5 棵 `obstacle_forest_pine_01~05.png` 复用不同白模深度图，以
  `flux2-dev-depth` 锁定树形/30°视角，**普通阈值抠图不可信时必须从 `_raw.png` 用
  `cutout-energy-node.py`（BiRefNet）重抠**；紧身裁后的尺寸/footprint/obstacleH 必须登记
  `ISO_WALL_GEO`，再由 `_scatterForestPinesScene10` 随机散布、避开出生点和返回门。
- 验收：`test-world124-forest.mjs`（场景/草地/树资产/几何/入口）+ 配置校验 + Vite build；
  视觉调整时优先改 `forestTreeScatter` 的 count/minDist/scaleJitter，不要绕过 footprint 碰撞。
- 传送门：素材库无现成素材，先用占位图（`tools/ai-gen/gen-portal-placeholder.py` 生成，
  裁后 615×921，正式图走素材库/AI 管线后重标）；纯详情建筑：2000能源、HP3000、
  def80/mdef80、`panelMode:"detail"`，标定 `displayW=288/displayH=431/footOffsetY=216`；
  传送功能待多世界并行系统接入。回归 `test-world122-portal-building.mjs`。

### 世界-125 地牢遗迹（2026-08-19）

- 场景：`scene11`，复用世界-122/123的 `12288×8192` 菱形边界、2048分块地板与底部
  返回门；纯探索，不接世界-122防守/采矿/生产系统。
- 地板：直接使用僵尸地牢高级 `blackbrick_7/blackbrick_8` 贴图池与随机等距拼砖口径，
  `glow=false`；不重新生成地砖、不启用连续平铺。
- 环境：`world125-environment.js` 每次入场随机生成28根石柱和22组不含烛台的摆墙预制组合；
  组合池取「火把墙」之后的纯障碍组合并显式排除 `obstacle_candle`，保留组内变换/图层，统一走 footprint、碰撞、
  菱形内缩、出生点/返回门排除和最小间距。
- 入口：世界切换面板、主神空间传送门、世界-122建筑传送门均登记 scene11；
  BGM复用 `dungeon_echo.mp3`。
- 镜头：在 `GameScene.zoomedOutWorld` 中与 scene8 共用 `0.7` 基础缩放。
- 验收：`scripts/test-world125-dungeon-world.mjs`（配置/地板/障碍/三入口/音乐/镜头 +
  真实散布函数）+ 传送门旧回归 + ESLint + Vite build。

#### 世界-125“尸雾遗迹”常驻环境特效（2026-08-22）

- **唯一入口与配置真源**：`GameScene` 持有 `World125AtmosphereSystem`，只读取双份
  `game-config.json#scenes.scene11.environmentEffects.dungeonAtmosphere`；配置优先取
  `GAME_CONFIG.scenes.scene11`，`SceneManager.scenes` 只作缓存兜底。环境效果是可丢弃视觉状态，
  禁止登记为实体、物理、AI、位面快照或后台模拟对象。
- **分层与战争迷雾**：贴地尸雾复用 `WORLD_RENDER_LAYERS.GROUND_WEATHER=-994.3`；冷色
  呼吸覆盖为99970，前景腐化尘/烛火火星为99974，均低于战争迷雾99980和昼夜覆盖99990。
  尸雾/浮尘依靠最终FOW遮罩覆盖未探索区，禁止为找可见格而让发射器长期空转；烛火源点则用
  `isFogPointVisible` 过滤，常驻光继续复用 `registerEnvironmentGlow` 的FOW门禁。
- **统一气流与性能**：尸雾和腐化尘同一时段只共享一个 `airflowUv`，经
  `isoLocalToWorldDelta()` 投影一次；保持 `directionHoldMs` 后整体换向，先 `killAll()`，再调用
  `setParticleSpeed/setEmitterAngle`，禁止 `updateConfig()` 反复扩池。粒子只在
  `camera.worldView + viewportMarginPx` 与世界菱形交集内生成，三个发射器均预留池并设置
  `maxAliveParticles`，不按12288×8192全图铺设。
- **烛台复用口径**：现有 `obstacle_candle.png` 为317×640三烛台，运行时约89×180，俯视烛盘和
  底脚符合当前黑砖等距视角，无需重新建模。该贴图只由可建造的 `dungeon_candle` 实体使用；
  中央/左/右火焰源图点分别为`(158,18)/(42,108)/(278,54)`，通过建筑贴图尺寸、锚点与flip换算
  为世界坐标。每座烛台只注册一枚呼吸光，全部烛台共用一个手动发射火星的Emitter，禁止逐烛台创建Emitter。
- **死寂雾潮状态与视觉分层**：`World125FogTideSystem` 是scene11自动天气排期和玩法倍率真源，
  `World125AtmosphereSystem` 只接收外部 `fogTideActive` 并切换视觉档位；T键“位面”页统一调用
  `GameScene.getWorld125AtmosphereDebugModel/toggleWorld125FogTide`，禁止UI直接访问私有环境实例。
  自动状态使用统一游戏时间按 `clear → warning → active` 推进，默认4~7日随机一轮、提前0.35日预警、持续0.75~1.5日，
  排期写入主存档且离开scene11继续推进；开发按钮只是正式状态机的立即触发/结束入口。视觉配置仍只在模式切换时重建共享Emitter，`lockDirection:true` 保证
  整段雾潮全场同一气流。暂停时Emitter `timeScale=0`，加载、离场或清理场景时统一销毁视觉资源。
- **视野乘算口径**：只对 `player/companion/military/scout/cavalry` 单位档案调用雾潮倍率，最终链保持
  `基础半径 × 祭品 × 昼夜 × 沙尘暴 × 死寂雾潮 × 高地`。范围外雾潮 `×0.6`；存活守夜烛台范围内
  白天 `×1`，夜间雾潮修正 `×0.9`，与全局夜晚 `×0.5` 相乘后分别得到 `0.3/0.45`。烛台自身使用
  独立 `candle` 视野档案，照明半径不受黑夜和雾潮削减；不得修改攻击距离、AI感知或永久探索记录。
- **场景中只保留玩法烛台**：`world125-environment.js` 的单体散布和预制组合池都必须排除烛台，
  防止外观相同却不能受击、不能提供庇护的假烛台。玩家建造的 `dungeon_candle` 必须走
  `ProducerBuilding` 实体、生命/碰撞/出售/销毁和位面快照链；只有 `CandleSanctuarySystem` 注册且
  存活的实体参与260px庇护判定。玩家进出庇护区的提示只跟踪玩家，友军倍率仍逐单位计算。特殊建筑用
  `allowedSceneIds:["scene11"]` 锁定建造位面，并由科技解锁，不在UI层单独伪造门禁。
- **烛台单体升级闭环**：照明模块来自独立 `upgradeProject`，科技树的 `upgrade:<moduleId>` 必须纳入
  `TechnologySystem` 已知升级ID校验。单体等级和读条要随建筑快照保存，离场时由 `world122-sim` 推进，
  恢复后重新同步 `fogSightRadius`；支付与科技门禁留在已持有这些依赖的建筑面板，范围注册核心不得
  反向依赖科技/快照系统形成循环模块链。同列父子科技需要科技树绘制纵向连接线，避免零宽折线路径。
- **亡者猎场倍率口径**：用统一 `hasEnemyFamily(entity, '僵尸')` 查询敌方全部分类标签，不按具体类名列白名单；只配置旧 `family:"僵尸"` 的怪物仍兼容。移速
  `×1.2` 只接入 `MovementSystem` 最终移动倍率；攻击间隔 `×0.85` 除 `CombatSystem` 的通用决策/普攻
  冷却外，自管僵尸必须通过 `Enemy.getAttackIntervalDelta()` 推进技能冷却、接触/活体常驻伤害和攻击型召唤计时。
  禁止改写 `speed/aiInterval/cooldown` 基值，也不加速动作动画、前摇、投射物、死亡计时、击退/技能位移
  或扩大攻击距离。天气结束后倍率函数返回1，保证即时、无残留恢复。

**建造清除障碍物与草（2026-08-17 用户口径：建造处有树/草类障碍物直接删除）**
- **判定顺序铁律（2026-08-17 审计修复）**：不能先用普通 `canMoveTo` 拒绝落点、再在建造
  成功后删树——那会让清除逻辑永远不可达。散布障碍生成的碰撞矩形必须回链
  `_scatterSource`；建筑预览/放置用 `WallSystem.canBuildAt`，只忽略可清除的 `_scatter`
  碰撞，普通墙、边界、门和建筑仍阻挡。扣费并成功创建实体后才真正删除，放置失败不破坏场景。
- 散布实体（仙人掌/树，`isoVisuals` 内 `_scatter` 件）：`WallSystem.removeScatterObstaclesAt(x,y,r)`
  ——footprint 矩形圆-矩形相交判定，删除后 `rebuildIsoCollision()` + `_syncWallsToPhaser()`
  （该函数会清空重建，不会重复建精灵）+ 失效 `_minimapStaticKey`。
- 拖墙/4格门是多落点建造，必须走 `removeScatterObstaclesInZones(zones)` 批量清理，只重建
  一次碰撞与 Phaser 视觉；逐格调用会产生明显重复开销。
- 草/装饰贴图（烘焙进地板 chunk，非实体）：`registerDecoClearZone(x,y,r)` 注册世界圆 +
  `GameScene.eraseDecoAt(x,y,r)` 局部重烘焙相交 chunk。草绘制跳过清除区时**不消耗随机种子**
  （continue 放在消耗 rand 的取值之前），其余草位置跨块不变。
- 多落点清草用 `registerDecoClearZones` + `GameScene.eraseDecoBatch`：一次登记全部圆，每个
  相交 chunk 最多重烘焙一次。清除区查询走 256px 空间桶，不再让每棵草遍历全部历史建筑。
- **生命周期铁律**：`clearDecoClearZones()` 必须在进入和离开 scene8 时调用；否则旧建筑
  拆除后草洞仍永久残留，并会污染其他场景相同世界坐标的地板装饰。
- ⚠ 重烘焙遍历 `_terrainChunkSprites` 时**先收集 key 列表再逐个重建**——迭代中
  delete+set 同一 key 会让 Map 迭代器重访新条目造成死循环。
- 清除半径：平台 140 / 小屋·兵营·产兵 95 / 掩体·门 110 / 塔等 60。
- 仙人掌 `cactusScatter.count` 80→40（game-config.json 双份 + scene-manager 默认兜底）。

**1×1 方块墙 + 4格门（2026-08-17 定稿）**
- 方块墙按 64×32 菱形格网吸附，可单击放一块或长按拖动沿 e1/e2 主轴铺一排；放置判定按
  格心冲突处理，同格拒绝、四邻允许，方块自身 face 段不重复参与阻挡。
- 4格门 = 两端各 1 格方块墙石柱 + 中间 2 格 `cover_gate_D_bars` 栅栏；可在空地新建，
  也可把一条4连方块墙单向替换成门（保留两端、移除中间两块）。
- e2 为默认方向，F 切 e1；实际实体必须使用 `orient:'v', mirror:(dir==='e1')`，不能只改
  碰撞 orient 不翻栅栏贴图，否则预览与落地门方向相反。
- **预览必须与实体同构**：场景幽灵禁止再用近似 `gate_4cell.png` 整图（该图只作面板图标）。
  `_createGate4Preview` 直接创建两张真实 `obstacle_block` + `cover_gate_D_bars` 关闭帧，
  缩放/裁剪/脚底统一读取 `GATE4_VISUAL` 与 `GATE_GEOM.barCrop`；组件深度按实际
  `cellY+28 / anchorY+44` 排序。替换4连墙时临时隐藏中间两块真实精灵，取消/移走即恢复。
- 回归：`scripts/test-world122-build-regressions.mjs` 锁定真实组件预览、共享参数、
  e1 镜像、批量清障、清草生命周期和升级存档，并已纳入 `npm test`。
- **正式计价与建筑模式收口（2026-08-18）**：
  - 新方块墙/4格门统一采用 **C级墙数值**：HP 1600，造价
    `round(1600×0.25)=400 能源`；4格门保持已验收的 D 级视觉资产（`visualGrade:D`），
    只把生命/详情等级/价格切到 C，禁止因数值升级破坏视觉终案。
  - 旧 F→A 长掩体和旧滑动门从 `BUILD_ITEMS` 删除；底层实体/资产保留历史兼容。
  - 玩家放置实体统一记录 `_builtByPlayer/_buildCost/_buildCurrency`。建筑详情操作区固定三列：
    返回 / 修理 / 回收；回收返还实际建造成本 50%。4格门用 `_buildGroup` 整组回收，
    点击任一石柱通过 `_buildGroupRoot` 跳转门详情；拆除顺序必须**门先、墙后**，
    防 gate.destroy 恢复已删除墙段形成幽灵碰撞。
  - **快捷回收模式（2026-08-20）**：建筑面板底部用独立 `_recycleMode`；启用时必须先取消
    放置和详情，与建造选择互斥。左键可连续命中并回收玩家建筑或手动道路，右键/Esc只退出
    回收并保留建筑面板；捕获阶段调用 `stopImmediatePropagation()`，防止同次点击继续打开详情。
    实体命中优先于道路，且只接受 `_builtByPlayer`；营地/兵营/通用生产建筑复用各自 `sell()`，
    墙/门/楼梯/塔走 BuildingSystem 统一清理，继续同步碰撞、系统数组和高架拓扑。
  - **放置态主栏目与自由镜头（2026-08-23）**：选择建筑后主栏目保留 `active`，仅加
    `is-placement-hidden` 滑出并设 `inert`；右键/放置中的 Esc 或一次成功建造后取消当前选择并滑回。
    成功落地时若 `Input.keys` 仍持有精确的 `ControlLeft`，单体、方块墙行和道路行统一保留当前
    建筑选择及隐藏栏目以继续放置；松开左 Ctrl 后的下一次成功落地再正常滑回。一次性打包重建不复用该规则。
    建筑模式必须显式锁住玩家输入并保持 RTS 关闭，相机不跟随玩家；边缘平移复用 RTS 的
    24px/900px·s 口径和 `_mouseSeen` 防漂移。退出建筑模式再统一解锁输入并恢复玩家跟随。
  - 方块墙详情用 `obstacle_block` 与真实400能源；4格门详情用 `gate_4cell`、真实结构/价格；
    射击台详情补建造成本。预置建筑无 `_builtByPlayer`，回收按钮禁用。
  - **尺寸判定**：紧凑建筑按真实 collisionRadius，两建筑最小中心距 =
    `新半径+旧半径+4`；方块墙按 128×64 footprint 半对角；射击台保留贴墙衔接，
    对其它紧凑建筑按大 footprint 留距。边界用 `_fitsPlacementBounds` 检完整 footprint，
    不再只看锚点离边缘20px。
  - **拖墙事务**：window blur、画布外/面板上 mouseup 只取消本次拖墙；每个有效方块逐块
    扣400能源，余额不足立即停止，已成功部分保留并显示实际总消耗；构造异常退还本块费用。
  - 回归：`test-world122-build-regressions.mjs` 扩至22项，锁定C级价格、旧条目移除、
    详情真值/回收、实际尺寸/边界、拖拽取消和批量扣费。

**铁匠铺能力工坊 + 世界-122升级存档（2026-08-17/18）**
- `producer-buildings.json.blacksmith.spawnEnabled=false`：铁匠铺不产兵，改为毒箭/自动防御/
  横扫/标记/穿甲弹/巨人杀手等能力读条升级；等级真源 `ability-store.js`，对对应兵种全局生效。
- 穿甲弹目标为仓鼠火枪与仓鼠赏金猎人：Lv1护甲穿透25%，之后每级+2.5个百分点；两者复用
  `DamageableEntity` 的 `weapon._craftEffects.armorPenetrationPercent` 结算入口。
- 巨人杀手目标为仓鼠民兵、仓鼠长戟与仓鼠反载：Lv1 对带“骑兵”或“大型”规范化分类词条的怪物
  最终伤害 +25%，之后每级 +5 个百分点，Lv10 为 +70%。目标判断必须读取统一 `family/families`
  多标签入口，不得按怪物类名写白名单；同一目标同时含两个词条时只结算一次倍率。
- 兵种模块与能力项目均提供“升级 / 持续升级”双按钮。同一 `cfgKey` 的配置型建筑、以及全部仓鼠兵营
  各自共享一个持续升级占用槽；当前场景与后台位面合计只能有一栋同类别建筑持有持续目标。持续升级
  只能在当前无读条时新挂或切换，读条期间可以停止续升但不能改挂另一项目。
- **出兵升级卡布局（2026-08-23）**：升级区允许两列卡片，但单卡内部必须使用“名称/资源/进度在上，
  升级/持续升级双按钮在下”的纵向结构；内容区、操作区和双按钮网格都必须 `min-width: 0` +
  `width: 100%`，卡片使用 `overflow: hidden`。禁止在半宽卡片内横排固定宽度操作组后，再靠缩短
  进度条掩盖溢出；铁匠铺、研究院和经济建筑不跟随这条出兵专属覆盖。位面特色出兵建筑的升级说明
  必须放在升级标题之后并在同一标题区自动换行，不能作为 `#pbModules` 的独立网格子项占用卡片格。
- `_continuous` 是要持续轮询的目标，不是一次启动结果：资源、科技或同一全局项目暂时不满足时必须
  保留，并在前台每秒重新判定，满足后自动扣费并开始下一档；只有满级、目标失效、建筑出售或被毁时
  才清理。禁止因一次资源不足造成 UI 显示与真实状态脱节。
- 产兵建筑面板实例会在草屋/铁匠铺间复用；每次 refresh 必须显式设置
  `pbUnitType.style.display = isAbilityShop ? 'none' : ''`，不能只在铁匠铺分支隐藏。
- 铁匠铺与研究院项目卡的固定副文案为下一等级资源需求（金币 + 能源），与产兵建筑模块共用卡片结构、
  进度条和剩余时间格式；项目详情仍通过悬停浮层提供，但卡片内不得出现“悬停查看说明”字样。
- 兵种模块等级与能力等级通过 `serialize/restore/reset` 接入主存档 `world122` 字段；
  场景切换保留，页面读档恢复，新游戏 `Game.start` 重置，避免上一局泄漏。

**研究院（2026-08-18，代码与正式贴图完成）**
- 配置入口：`producer-buildings.json.research_institute`，复用 `ProducerBuilding` 和铁匠铺
  能力工坊读条面板（`spawnEnabled=false / workshopType=research`），建筑造价500能源、
  HP2200、def70/mdef90。正式贴图键/路径固定：
  `research_institute` → `assets/terrain/research_institute.png`。
- 研究项目（等级沿用 `ability-store`，进主存档）：
  - `research_structure_hp`：方块墙与4格门共享同一等级，最大生命每级同时 +10%；
  - `research_passive_energy`：每级每秒 +1 能源（Lv.N = N/秒）；
  - `research_recruit_speed`：Lv1募兵速度+10%，之后每级+2个百分点；生产周期按
    `baseInterval/(1+bonus)` 计算，升级时按新旧周期比例缩放进行中的剩余时间。
- 旧测试存档兼容：`research_wall_hp/research_gate_hp` 恢复时取两者较高等级迁移到
  `research_structure_hp`，随后删除旧键；面板只显示一项“防御结构强化”。
- `research-system.js` 是唯一效果入口。墙/门构造时 `applyResearchHp` 自动读取当前等级；
  研究完成时 `applyResearchToWorld` 即时更新场上结构。增加最大生命时当前生命同步增加差值，
  保持“已损失生命量”不变，不无条件回满。读档恢复 ability level 后必须
  `ResearchSystem.refreshWorld()`，否则现有墙门仍停在旧上限。
- 被动能源由 `ProducerBuildingSystem.update(dt)` 唯一推进，只在世界-122系统 active 时运行；
  1000ms 完整秒结算，多秒卡顿一次补齐；退出/进入场景重置余数计时，等级保留。
- 能力面板描述支持 `displayMode=percent|flat`，统一替换 `{chance}/{dmg}/{pct}/{value}`；
  研究院显示“作用于现有及后续新建结构”，铁匠铺仍显示兵种能力文案。
- 正式资产 `assets/terrain/research_institute.png` 为1024×1093透明PNG；2×2视觉标定
  `displayW=288/displayH=308/footOffsetY=150`；底部14px透明留白由自动脚点扫描扣除，
  预览与实体共用结果。
- 回归：`test-research-institute.mjs`。

### 世界-122 场景快照（M0 多世界并行地基，2026-08-18 落地）

- **唯一入口 `src/world/world122-snapshot.js`**：`captureWorld122` 捕获 → 内存驻留 →
  `applyWorld122Snapshot` 恢复；scene-manager 离场时**先捕获后 teardown**（顺序铁律，
  捕获在 `DefenseSystem.teardown()` 之前），`_loadScene8` 各系统 setup 完后恢复。
- **覆盖对象**：基地 HP、波次（_wave/_phase/_phaseTimer；**wave 进行中离开 → 回场 break
  阶段重开本波**，不逐怪存档）、玩家建筑七类（塔含武器/芯片/改造模块、方块墙、4格门整组
  pillars+门、射击台、矿场含建筑级 modules+暂存能量+矿工数、兵营含兵种+产兵读条、
  产兵建筑含 cfgKey/兵种/读条/持续升级/仓库单仓存量）、矿点（保存单格坐标、余量与枯竭转场余时；
  完整快照的空数组代表已经采空，走 `EnergyNodeSystem.restoreNodes` 覆盖 setup 结果，不得随机补铺；
  `initializedByPortal` 基础快照的空数组则表示资源尚未首次物化，不得清除首次生成矿簇）。
- **口径**：计时器按剩余毫秒冻结续跑（M0 不推进后台时间，M1 再加真实时间结算）；
  单位只记兵种+存活数、回场建筑旁重生成；**败北不持久化**；胜利恢复时 `_victoryGranted=true`
  防重复发奖；**矿场恢复先挂 modules 再 spawnMiner**（矿工才吃到升级）；
  仓库存量按快照覆盖（构造时 EnergyManager pending 已灌入，覆盖避免重复计数）。
- **存档/新游戏**：主存档 `world122.scene`（game-ui-manager save/load）；
  `Game.start` 调 `resetWorld122Snapshot()`。
- **验证**：`scripts/test-world122-snapshot.mjs`（21 项契约）+ `tools/cdp-world122-snapshot.mjs`
  （实机 15 项：建造→捕获→回主城清空→重进全恢复）。

### 世界-122 后台抽象结算 + 世界切换面板（M1，2026-08-18 落地）

- **结算引擎 `src/world/world122-sim.js`（纯数据、无 Game 依赖链，可 Node 直测）**：
  `settleWorld122(snap, elapsedMs, {commit, grant})`；`commit:false` 为预览（不改快照、
  不升全局等级），世界切换面板预估即用它跑快照克隆。
- **接入点**：`applyWorld122Snapshot` 物化前先结算（离场 >1s 才结算）；回场波次仍进行
  → break 重开本波；被毁建筑（hp≤0）不复活；后台失守 → 快照作废重开局 + 浮字战报。
- **结算口径**：产兵按兵种周期（unitTypes.spawnIntervalMs 覆盖 > 建筑级）×快速募兵倍率，
  cap 封顶；采矿 = 矿工数 × 25 能源/s × 采矿模块，受仓库余量与矿点余量双封顶
  （无仓库不采，与实机满仓口径一致）；读条完成即升全局等级。后台只完成离场时已经开始的当前
  读条，不跨档连续扣费；持续目标独立保存在建筑快照中，回场后立即恢复每秒条件/资源轮询并自动续升。
  波次 = TP 预算 ×35 HP/只 vs 塔 DPS（捕获时实机口径入快照 `dps`）+
  单位 DPS（`_unitsDps` 读 AI 实参）；怪物输出按接触系数 0.5 依「墙/门→建筑→基地」承伤；
  胜利奖励能源直接写入快照仓库（恢复时物化）、金币走 grant 回调（此时建筑未物化，
  EnergyManager 无法承接）。
- **恢复补员铁律**：出口槽位预约窗口 750ms，恢复时爆发生成会互撞——首只立即生成，
  缺额挂 `_restoreTopUp`，各系统 update 里按 800ms/个 快速补齐（兵营/产兵/矿场同口径）。
- **世界切换面板 `src/ui/world-switch-panel.js`**：BasePanel 复用；`init()` 往 `.side-menu`
  注入「🌐 世界」按钮；世界-122 行显示快照概况 + 离线预估战报；前往 =
  `SceneManager.switchScene`（离场捕获/入场结算恢复全自动）。
- **模块挂载**：`window.World122Snapshot/World122Sim`（main.js）——探针勿走
  performance 资源表找这俩：贴图流会把早期模块 URL 逐出缓冲（CDP 踩坑实录）。
- **验证**：`scripts/test-world122-sim.mjs`（13 项功能）+ `test-world122-snapshot.mjs`
  （30 项契约）+ `tools/cdp-world122-sim-switch.mjs`（实机 11 项：建造→回拨时间→
  面板切 123→切回验证补员/采矿/波次战报）。

### 性能前置优化（2026-08-19，多世界并行 M2 前置）

- **分离碰撞网格宽相**：`Game.resolveCollisions` 由 O(n²) 全对遍历改为
  `SpatialPartitionSystem.queryRadius(x, y, groundRadius + 340)` 近邻候选 + 索引去重
  （保持 i<j 成对口径；+340 覆盖 4×4 基地半对角 ~286 + 对方半径余量；分离判定的
  Y 逆透视压缩保证世界空间距离 ≤ 缩放空间距离，半径查询不漏对）。
  SPS 缺失时回退 `entities.slice(i + 1)` 原口径。逻辑/渲染全绿行为测试不变。
- **静态实体休眠带**：主循环对 `_dormantBand` 实体（方块墙/掩体、4格门/铁栅门、射击台、
  能源矿——构造时打标）按 ~1/4 帧率聚合 dt 更新（`e._dormantAcc < 66` 跳过）；
  计时类语义不变（dt 累加）。塔/单位/怪物不打标（战斗响应不能降）。
- **小地图动态层 100ms 降频**：`_syncMinimap` 入口 `_minimapNextAt` 节流（10Hz 足够）；
  静态层缓存键逻辑不变。
- **运行时性能观测与视口裁切（2026-08-23）**：`PerformanceMonitor` 采集逻辑主循环、
  Canvas、Phaser 同步、DOM UI 的最近 60/120/240 帧可选窗口平均/P95/峰值；交互开发工具“性能”页
  必须按平均 CPU 耗时降序显示占已测分项比例、P95、峰值和周期累计，并提供一键复制 Markdown 报告，
  同时保留实体、HUD、寻路队列和门追击缓存计数。`GameScene` 只对 `camera.worldView + 320px` 外的
  Sprite、名字/血条、阴影、X 光和友军动画做视觉隐藏与同步跳过；不得修改实体 `active`、AI、
  物理、碰撞、寻路或小地图真源。视口隐藏使用独立恢复标记，并在恢复后继续由战争迷雾最终
  执行可见性门禁，禁止用简单 `setVisible(true)` 绕过雾状态。结构阴影 caster 使用非渲染身份句柄，
  共享 Graphics 只在脏帧把可见投影预三角化为 `fillTriangle` 命令；报告必须同时记录阴影可见/裁切
  job、几何生成前/后的裁切数、阴影专用裁切缓冲、轮廓减面前后顶点与压缩率、聚簇、羽化路径、三角形、命令缓冲、重建次数
  和最近重建耗时，便于区分脏帧构造与稳态提交。阴影按实际 hull bbox 使用默认 64px 缓冲；不能把
  实体视觉 320px 缓冲重新套回阴影，也不能为了减面跳过接地角所在扫描行。
- **开门追击共享缓存（2026-08-23）**：建造门和防御目标候选按实体表身份、数量与 250ms TTL
  共享；门内目标优先从 `SpatialPartitionSystem.queryRadius` 取 1500px 局部候选，再执行原有
  侧向、LOS 与目标优先级精判。门开关、存活和 hp 必须在消费缓存时重新校验，缓存只能减少
  全表扫描，不能改变过门追击语义。

### 世界-122 后台活 tick 驱动（M2 阶段一，2026-08-19 落地）

- **`src/world/world-sim-driver.js`**：玩家不在 122 时每 1s 对驻留快照增量结算
  （`settleWorld122(snap, now - snap.capturedAt, {commit:true})`）——世界在后台持续运转，
  面板状态实时、失守/胜利/清波/建筑损失即时浮字通知（任意场景可见）。
- **锚点铁律**：结算锚点用快照 `capturedAt` 而非驱动器自身时钟——读档离线数小时、
  探针回拨都能完整结算；前台全真（`isWorld122Live`）时停 tick。
- **波次进度跨 tick 累计**：`wave.progressSec` 累计交战时长，清波耗时 = HP池/防守DPS
  （封顶 waveTimeMin/Max）；怪物输出按实际交战时长分段结算（不是只在清波时结算）；
  **防守 DPS 每波重算**（塔毁则后续波次停摆待玩家）；无防守输出时按实际时长推平防线。
- 回场时 apply 结算只补 tick 间隙（秒级）；失守快照作废重开局（与 M0/M1 同口径）。
- 世界切换面板 122 行直读驻留快照（波次/建筑/损毁/仓库能源），打开期间 1.2s 自刷新。
- **验证**：`test-world122-sim.mjs` 增量≈一次性等价/进度累计等 17 项 +
  `cdp-world122-sim-switch.mjs` 实机 11 项（驱动 tick 下后台推 3 波/拆 3 墙/补员满编）。
- **CDP 探针坑（新增）**：① 全新无头页里模块是**裸路径**（无 ?t=），?t= 只见于 HMR
  历史页——探针 `loaded()` 必须裸路径优先；② 贴图流会把早期模块条目逐出
  performance 资源缓冲——模块 URL 表要在**游戏启动前**捕获（`__probeUrlMap`），
  或走 window 挂载（`World122Snapshot/World122Sim`）。

### 多位面后台数据化与事件账本（M3，2026-08-24 落地）

- **休眠位面的权威状态只有快照**：scene8~scene11 不在前台时不得创建或保留建筑、普通单位、
  敌人、AI、碰撞、寻路、动画、HUD 或 Phaser 渲染对象参与更新。`world122-snapshot.js` 中的紧凑
  `structures/nodes/wave` 与全局兵线批次是持久真源；`backgroundLedger` 是可丢弃、可重建的派生索引，
  只缓存科研贡献、军力摘要、结构/兵力计数和下一事件游戏时间，绝不能作为第二份资源真源。
- **调度合同**：`WorldSimDriver` 的1Hz定时器只汇总缓存科研贡献、推进全局科技和检查
  `nextWakeAtGameTimeMs`。连续资源不逐秒写快照；建筑升级、矿工补员、招募、探险、面包屋和矿点
  重生到期时才调用 `settleWorld122`。打开世界面板、保存、切入位面、入侵阶段边界是权威读取点，
  必须把 `capturedGameTimeMs → nowGame` 的差值一次结清。游戏时间 `0` 是合法锚点，不得用 `||`
  当成缺失值。
- **科技边界合同**：后台科研贡献可缓存，但全局科技将在当前1Hz窗口完成时，必须先把所有休眠位面
  结算到旧科技末端；完成后失效全部账本，再按新科技重建。否则新能力会错误回溯到整段离线时间。
- **后台入侵合同**：`WorldInvasionSystem` 每帧只累加 `backgroundAccumulatorMs`，默认每10秒解析一个
  阶段窗；每窗先 `WorldSimDriver.flushWorld(target)`，再读取账本中的塔、生产建筑驻军与兵线批次
  聚合DPS/HP。解析复杂度随结构条目、批次数和波次数增长，不随帧数或士兵数量增长；传送门告警、
  波次推进、胜负、位面世代校验和毁灭仍走原全局生命周期。保存或切入目标位面前必须补齐不足一个
  阶段窗的余量。
- **大兵力合同**：后台新增的同兵种增援以 `count + hpRatio` 队列批次保存，兼容旧逐兵记录并在读档
  时自动合并；入侵承伤直接减少批次数和平均生命比例。只有目标位面真实加载时才逐个创建单位，单次
  物化最多24名并沿用750ms重试；安全出生位不足、达到预算或创建失败的剩余数量继续留在原批次，
  禁止为了后台事件提前展开数组或实体。
- **地牢并发合同**：GameScene 的统一世界时钟在地牢地图、战斗、商店、事件和奖励界面仍推进，
  因而地牢中触发的位面入侵照常走后台阶段窗。地牢现场本身继续按现有 observation suspend 合同冻结
  精确运行时引用以保证战斗可恢复；该冻结包不参与更新。不得把位面入侵兵力混入地牢实体集合。
- **存档/物化顺序铁律**：保存走 `经济与招募账本 → 剩余后台入侵窗 → 序列化`；入场走
  `经济与招募账本 → 剩余后台入侵窗 → 各系统空 setup → applyWorldSnapshot → onWorldLoaded/入侵实体接管`。
  旧档恢复必须清空 `backgroundLedger` 后重建；该字段版本变化不应阻断
  世界快照恢复。调试可读 `window.WorldSimDriver.getDebugModel()`，但调试读取不得物化位面。

### 观察模式 + 指挥模式 RTS 化（2026-08-19 落地）
- **世界切换 = 仅相机跳转**：世界切换面板「前往」走 `SceneManager.switchScene(id, player, undefined, { observer })`——
  目标世界**不生成玩家实体**（玩家对象/坐标原地保留），相机落世界中心自由平移，
  切完自动 `RTSCommand.setEnabled(true)` 进入指挥模式；前往本体所在世界 = 返回本体
  （玩家原位恢复：`_worldPlayerPos[sceneId]` 离场记忆，122/123/124 加载器恢复）。
- **状态机**：`Game._observerMode/_observerHomeScene/_worldPlayerPos`（game.js 声明，
  switchScene 维护）；观察模式三卡口——game.js 不 `Camera.update(player)`、
  GameScene 跳过玩家钉屏（`_observerMode || RTSCommand.enabled` 双条件）、
  仓鼠单位 `update` 传 null 玩家（不跟随不在场玩家；8 实体统一守卫 `!game._observerMode`）、
  出兵集结点 `preferredTarget` 兜底回建筑自身（兵营/矿场/产兵）。
- **指挥模式 RTS 化（rts-command.js）**：
  - 可用域 = 世界-122 或观察模式任意世界（tick 门槛 `commandable`）；
  - **边缘平移**：屏幕四缘 24px，900 world px/s（dt 缩放），世界边界钳制；
    **必须见过真实 mousemove 才平移**（`_mouseSeen`——无头/未动鼠标默认 (0,0) 会被误判贴左上缘，
    实机曾把相机从 4200 漂到 2767）；
  - **双击同类复选**：350ms 同窗同单位 → 屏幕上所有同类型友军全选（类型键 =
    `getUnitKind`（兵种登记表）→ 队员档案 id 兜底；屏幕矩形按 Renderer.worldToScreen 的
    CSS px 口径与 window.innerWidth/Height 比较）；
  - **编队**：Ctrl+数字编入 / Shift+数字加选 / 数字选中（0-9，`keydown` capture 阶段先于
    快捷栏，指挥模式下快捷栏数字键让位——input.js `_rtsDigits` 守卫）；
  - 退出指挥模式镜头 `Camera.follow(player)` 回归（观察模式不动）。
- **中键轮盘统一（companion-command-wheel.js）**：指挥模式下轮盘目标 = RTSCommand 当前
  选中单位（队友 + 仓鼠部队一视同仁），执行走 `RTSCommand.issueWheelCommand(mode, point)`——
  队友 PartySystem.setCommand、仓鼠按统一命令映射；2026-08-22 起移动攻击与巡逻统一交给
  `RtsTacticalOrderSystem`：前者沿途索敌、战后继续到终点，后者记录下令位置并在两端往返、遇敌战后续巡。
  左侧通用指令栏与轮盘写入同一高层命令；矿工/探险家只执行移动段，不获得攻击能力。
- **验证**：`scripts/test-world-observer.mjs`（20 项契约）+ `tools/cdp-world-observer.mjs`
  （实机 6 项：观察进出/双击/编队/轮盘统一下达/边缘平移）+ 既有 test-rts-command 17 项不回退。

### 指挥模式输入链与跨表面移动审计（2026-08-19）

- **右键必须由 RTS 自己捕获**：`mousedown(button=2)` 写 `_pendingRightClick`，`tick` 消费并同步清
  `Input.mouse.rightPressed`；禁止只依赖 Input 单帧边沿标志，否则其它输入分支/帧尾清理会造成无响应。
- **观察模式鼠标入口不能写死 scene8**：选择、框选、编队和右键统一读
  `_isCommandable() = scene8 || Game._observerMode`；跨世界选择/编队召回必须用当前
  `_collectAllies()` 剪枝，禁止保留上一世界仍 active 的幽灵引用。
- **高架坐标口径**：单位点击矩形、选中圈、攻击标记均使用视觉脚底 `y-z`。
  `move.point` 保留 `{x,y,z,surfaceKind,route,renderDepth}`；绿色箭头以 `y-z` 定位，但按地面 `y`
  与承载层 `renderDepth` 的较高者排序，不能把屏幕 Y 直接当世界 depth。F1 指挥与普通组队栏右键
  都必须先走 `resolveSurfaceTarget`，再按单位补全路线；`rts-command-utils.js` 统一消费路线航点。
  地面→墙顶按楼梯正向路线，墙顶/楼梯→地面由 `routeSurfaceMoveForUnit` 反转楼梯路线；
  队友与所有可选仓鼠兵种必须显式消费同一 move 契约。
- **中键轮盘目标数与队员ID不可混用**：RTS 目标存在于 `RTSCommand._selection`，此时
  `_targetIds=[]` 是正常状态；`_resolveTargets()` 必须返回实际目标数，`_openWheel()` 按
  `targetCount` 判断，不能再用 `_targetIds.length` 阻止轮盘打开。
- **显式命令终态**：右键空地固定下发纯 `move`，移动中不进入默认索敌；`move` 到达或指定
  `attack` 目标死亡/失活后必须经 `finishRtsCommandAtHold()` 切为 `hold`，禁止回落 `follow`。
  `follow` 只允许由玩家明确下达。
- **复数单位地面移动必须列队（2026-08-23）**：右键移动、移动攻击与巡逻在下令瞬间按选中组
  中心到点击点的方向生成以点击点为几何中心的方阵槽位，并用最近槽贪心减少单位换位交叉；禁止使用
  黄金角、随机抖动或让全部单位争抢同一像素。阵型规划只执行一次，玩家继续走专用 RTS 控制器，
  其他友军继续走既有 `_command`/战术命令；行军途中由独立寻路与分离自然打散，终点重新成阵。
  高架目标不套地面方阵，继续按单位规划表面路线并服从楼梯 FIFO。
- **终点方阵的投影与到达合同（2026-08-30）**：方阵仍在 `u/v` 中生成，但槽位间距必须除以
  `min(1,PERSPECTIVE_SCALE_Y)`，保证投影后的世界距离也满足两倍最大半径+8px；留白共用
  `RTS_FORMATION_SLOT_CLEARANCE`（两倍4px到达容差），普通半径20px单位最小投影中心间距48px。预约判距保留微小
  浮点容差，不能把开阔地的正常槽位误改为散点。地面槽位携带 `formationSlot:true`，只对此类指令
  使用4px到达容差、逐帧到位检查与末段减速；普通单选移动和高架航点保持原规则。
  移动攻击战后恢复及巡逻再次去程必须保留此标记；玩家只降低专用RTS移动意图，不修改基础移速或接入友军AI。
- **友军默认索敌范围唯一真源**：`game-config.json > rtsCommand.defaultAcquireRange`，当前统一为
  `900px`。队员、近战/远程仓鼠战斗单位及轮盘“主动攻击”均读取 `RTS_DEFAULT_ACQUIRE_RANGE`；
  攻击/施法射程仍由各兵种配置独立控制，矿工资源感知不属于战斗索敌。
- **小地图跳镜头/拖动（2026-08-23）**：`GameScene._minimapLayout()` 是绘制/点击反算唯一真源；
  只在指挥模式下左键实际地图内容调用 `minimapWorldPointAt(clientX,clientY)`，按住后持续用
  `clampToContent:true` 更新 `Camera.x/y`，拖出内容框时钳在地图边缘。全过程保留单位选择、暂停
  屏幕边缘平移并 `stopImmediatePropagation` 防穿透；初次按下仍拒绝宽高比留白、隐藏小地图和系统UI。
- **回归**：`test-rts-command.mjs`、`test-world-observer.mjs`；
  `cdp-world-observer.mjs` 必须走真实左右键/中键长按/小地图点击，禁止只直接调用 `_execute()`。

### 建筑摧毁/主动回收统一沉陷（2026-08-19）

- **生命周期统一**：摧毁、出售、回收都进入 `BuildingSinkEffect.start()`；先拆碰撞、生产单位、
  系统数组与退款，再由特效立即接管精灵并移除实体。塔三层、门多片、楼梯 `segmentSprites`
  均作为一组保留原相对位置/原 depth 下沉。
- **贴图本体不能用水平 crop 作为主路径**：`building-sink-geometry.js` 从
  `isoFootprintVertices` 取得 footprint 投影，取 `left→front→right` 前缘链并按原斜率延伸到
  全部子精灵联合视觉宽度（左右各留6px），再向屏幕下方挤出地下多边形。
  WebGL 用 `sprite.enableFilters(); sprite.filters.external.addMask(graphics,true,mainCamera,'world')`
  反向裁除进入地下区域的像素；矩形 `setCrop` 仅是 Filter 不可用时的降级。
- **原地下沉**：精灵只沿屏幕Y轴移动，接缝默认锁定主贴图当前帧的不透明内容底边；
  精灵表 alpha 测量必须使用当前 frame 的 `cutX/cutY/cutWidth/cutHeight`，禁止扫描整张源图。
- **烟尘复用玩家奔跑真源**：建筑只在 footprint 内采样生成点，调用同一个
  `EffectFactory.createDustEffect` / 对象池 `DustEffect`；玩家默认参数保持1倍，建筑按投影面积
  传 `scale 1.65~2.6`、`lifeMul 1.5` 和遮罩上方 depth。禁止再维护建筑专属烟团粒子实现。
- **图层**：建筑精灵保持 `_sinkBaseDepth`；footprint 扬尘遮盖层位于全部子精灵之上，
  DustEffect 再高一层；建筑完全消失后遮盖层继续700ms淡出。
- **验证**：`test-building-damage-fx.mjs`（纯几何/接线）+
  `cdp-building-sink-mask.mjs`（WebGL反向Mask、无水平crop、左右完整覆盖、同款DustEffect）。

### 图鉴栏整改（2026-08-19：收回修复 + 硬编码清除 + 友军栏目）

- **收回修复（根因链）**：`SystemUI.init` 遮罩点击收回原本只在"子页面 UIState 键全关"时生效——
  键一滞留（子面板随场景切换消失但键未清）永久拦截收回。改为子页面**面板 DOM 实际激活**
  （classList active）才拦截，滞留键 `UIState.close(key)` 自愈后正常收回；
  图鉴与状态/背包共用同一 `systemPanel`，收回动画天然同款（transform 0.25s 抽屉）。
- **硬编码清除**：枪械详情半自动分支 `+5°`/`500ms` 两行无任何数据源 → 移除；
  散布展示统一走 `spreadParams`（逐武器真源，半自动同口径），独头弹逐层散布走
  `weapon-fx-config.shotgun.slugRecoilAnglePerLayer`。
- **友军独立栏目**：图鉴主 tab 加「友军」（装备/怪物/友军），数据唯一真源 =
  `UNIT_KIND_CFG`（unit-upgrade-store 登记表）+ `hamster-miner-config.json`；
  产出建筑由 `producer-buildings.json` unitTypes **反查**（⚠ unitTypes 用短 key，
  登记表值对象 id 是全名——`hamster_militia`→`militia` 先反查再匹配）；
  军营（战士/盾卫）与矿场（矿工）不走产兵表，两个固定项注释标注。
  详情 = 基本信息 + 六维 + 怪物公式派生（`CodexFormulaHelper`，与 statFormula:'enemy'
  同口径）+ 攻击参数（伤害/间隔/射程/判定帧/弹道速度）+ 描述。
- **风格**：友军卡片青蓝点缀（`.codex-ally-card`）、友军标签 `.cd-family-tag.ally`、
  图鉴主 tab 激活改金色 `#ffd98a`——与背包/属性栏金棕主色调一致。
- **验证**：`test-codex-ally.mjs`（10 项契约）+ `cdp-codex-ally.mjs`（实机 3 项 +
  截图 `codex-ally-2026-08-19.png`）。
- **排障沉淀**：图鉴"不能收回"实机诊断法——DOMDebugger.getEventListeners 证监听器在挂、
  遮罩点击后 DOM active 类是否摘除是真相（探针裸路径 import 会产生第二模块实例，
  `SystemUI.isOpen` 读它不可信；DOM 类才是跨实例真相）。

### 侧栏改版与快捷键整合（2026-08-19）

- **世界切换按钮正式图标**：素材库 `UI\世界切换.png` → `assets/ui/icons/world_switch.png`，
  白底抠图走 `tools/ai-gen/make-transparent-icon.py`（泛洪白底→最大连通域→羽化→去白边，
  水印随非主连通域自动剔除）；按钮改为 `hud-panels-misc.js` 侧栏静态构建
  （world-switch-panel.js 不再注入，main.js 只挂 `window.WorldSwitchPanel`）。
- **侧栏顺序**：状态（Caps) → 技能（K) → 背包（Tab) → 图鉴（U) → 任务（L) → 世界传送（O) →
  队员管理（P) → 属性点（隐藏）。对调口径：技能↔背包、世界传送↔组队。
- **快捷键**：`CONFIG.KEYS` 加 `PARTY:'KeyP'` / `WORLD:'KeyO'`，图鉴 `CODEX` 让位 O→U；
  input.js 守卫/常态双分支都挂 P/O。**P 键独立暂停已拆**——暂停整合进菜单
  （Esc 开菜单即暂停：game-menu.open 已三重暂停 Game._paused + TimerManager.pause +
  Phaser pause，close 全恢复），config 移除 PAUSE 键位。
- **验证**：`test-side-menu-keys.mjs`（12 项契约，含顺序/徽标/键位表/暂停整合）+
  `tools/cdp-side-menu.mjs`（实机 5 项 + 侧栏截图 `tools/verify-shots/side-menu-2026-08-19.png`）。

### 基地菱形房无缝拼接（WIP，2026-08-17）

**问题**：基地四边掩体墙拼接有缝（用户反馈），且贴图替换后易被错误放大。
**思路（用户指定）**：先在 Blender 用原模型摆成菱形验证无缝，再按确认尺寸渲染进游戏。
- 工具：`tools/ai-gen/blender-cover-diamond-test.py`（Blender 5.1 后台跑）：
  复刻 `_buildBaseRoom` 拼接数学（COVER_FACE faceLen 196.33、joinOverlap 40、
  cornerExtend 29、门洞 90），box 按显示比例 260/230 转游戏 px，顶视渲染 + 端面间距诊断。
- 已确认：TL 边 box 沿边投影 ≈138.6px < 间距 144.7px → **约 6px 缝隙**（box 长轴与 TL 边
  夹角大）；TR/LB 边投影充足。修复方向 = 拉伸 box 长度（或调整 rot/摆位）直到投影 ≥ 间距。
- ⚠ 渲染黑屏坑：`--factory-startup` 后默认灯随全选删除一起没了，必须补 Sun 灯（energy 3）。
- 待办：Blender 几何诊断精修（端面间距要含短轴贡献）、渲染贴图复刻、游戏内验证。

### 墙面与楼梯统一高架导航面（2026-08-19）

- 修改前备份：`backup/unified-elevated-surface-20260820-015841`。
- `src/world/unified-elevated-navigation.js` 是墙顶、楼梯踏步、楼梯共享缝与墙梯桥接的统一查询入口；
  必须先收集全部候选，再按高度连续性、当前表面和显式 handoff 选择，最后原子提交
  `surfaceKind/surfaceRef/surfaceWall/surfaceStaircase/z`。
- `stair-seam` 只代表并排同向楼梯之间的横向接缝；`wall-stair-bridge` 才允许墙梯交接保护。
  两者不得共用“继续下楼”的状态判断，否则低层横移会被顶层接口抬到墙高。
- 墙顶下楼提前捕获由 `handoffCaptureMargin=24` 控制。启动条件同时包含：
  脚底仍受目标墙顶承托、输入朝向楼梯、实际位移正在远离墙中心。初次查询、边界扫掠与
  碰撞后复核必须复用同一份 `_surfaceQueryMotionIntent`，不能在回退采样时把位移误清零。
- 楼梯单位当前高度低于顶层 2px 以上时禁止命中顶层 connector；完整进入墙顶安全承托区后，
  楼梯面必须让位给 `wall_walk`。这两条负责消除 2.5D 投影重叠造成的跨层抢占。
- 桥接面期间关闭单位分离并忽略当前楼梯组/连接墙边线；离开桥接面后恢复普通高度分层碰撞。
  `Game.resolveCollisions()` 后调用 `DefenseSystem.reconcileElevatedSurfaces()` 提交最终身份。
- 回归：RTS 32/32、快照 42/42、墙深度 10/10、ESLint 0 error；
  `tools/cdp-wall-stair-inspect.mjs` 的五档宽度上下墙、并排三楼梯多层横移、友军路线、
  拥挤推挤、楼梯倒序和碰撞后复核全部通过，最终 `errors: []`。

### 城墙高架远程战斗（2026-08-20）

- 配置真源：`defense-structures.json.wallWalk.rangedCombat`。当前仅保留
  `rangeMultiplier=1.2`；data/public 必须同步。墙体优先级是离散弹道规则，不再使用角度净空参数。
- 加成资格唯一口径：`_surfaceKind==='wall_walk'` 且阵营为 `player/companion`。
  楼梯途中不加成，敌人不加成。禁止用 `z>0` 代替正式墙顶身份，否则楼梯与其它浮空状态会误吃收益。
- `combat/elevated-ranged.js` 负责射程、发射/目标Z及墙体上下文；
  `combat/ranged-line-of-sight.js` 负责枪械、锁定魔法和直线光束的统一视线。所有发射物必须在
  发射瞬间快照射程与墙体上下文，禁止飞行途中因单位上下墙而改变既有弹道。
- 标准枪弹统一在 `ProjectileFactory` 应用倍率；魔法统一在
  `getMagicRangeMultiplier` 与原武器改造倍率乘算。雷枪不走普通魔法弹道，必须显式消费该倍率。
- AI攻击判断和实际飞行距离必须同时加成：露娜的 `combatRange/basicAttackRange/技能ranges`，
  射手、斥候、火枪手的 attackRange/maxDist 都要读统一函数。只延长弹体而不延长AI判断等于功能未生效。
- 矩形墙弹道碰撞必须使用线段进入/离开矩形的参数区间，在真实交点插值Z，并返回最近命中的墙实体；
  禁止使用整段平均Z。面线墙继续在唯一交点插值Z。`projectileBlocked`只作旧布尔接口兼容，
  新弹道结算必须读取`projectileWallHit`，才能区分模型例外、友方墙零伤害和敌方墙体伤害。
- 露娜普通光球与火枪手必须和射手/斥候一样保存`z/vz`并走`projectileBlocked`；
  渲染读取`y-z`与`visualAngle`，深度跟标准投射物一致为`groundY+500`。
- **全面审计整改（同日）**：
  - 牧师`castRange`、自动/指令目标选择与`HolyLightSystem.triggerOn`必须统一消费
    `getMagicRangeMultiplier + hasRangedLineOfSight`；调用方选定目标不等于允许跳过最终门禁。
  - Bolt类投射物必须在`_launchAll`快照每发`maxRange`，飞行更新只读快照；
    射程外目标与maxRange同帧越界时先终止弹体。
  - 枪手/法师AI的“进入射程”必须同时满足LOS；候选优先选择当前可直射目标，
    出膛前再复核一次，防目标在动画前摇期间移到墙后。
  - 墙顶20%只作用`maxRange`。`aimRadius/chainRange`等技能作用范围只保留武器改造倍率。
  - 墙顶弹体忽略发射快照内整块承托墙链；楼梯无豁免，远处非承托墙仍阻挡。
  - 墙下射墙顶仅精确躯干模型命中可越过目标自己的承托墙，否则敌弹对墙结算、友弹只被截停。
- 回归契约：`test-elevated-ranged.mjs`已覆盖承托平台豁免、楼梯阻挡、非承托墙、模型例外与敌我墙伤害；
  专项已纳入`npm test`主链。2026-08-20复查结果：高架弹道27/27、嵌墙10/10、友军战斗8/8、
  目标运行时代码语法14/14通过；未执行构建或浏览器验证。

### 多世界传送门与五日入侵（2026-08-20）

- **配置真源**：`data/world-system.json`（运行时 import）与 `public/data/world-system.json`
  保持镜像。世界名称、地牢通关条件、传送门出生点/耐久/重建费用、入侵间隔、波次成长和怪物池
  全部由此配置；新增怪物只需登记 `type/weight/threat/unlockDay`，实体构造器继续由
  `DefenseSystem.MONSTER_FACTORY` 负责。
- **进度真源**：`WorldProgressionSystem` 保存地牢通关次数、每类探险结果和各世界传送门
  `everConstructed/constructed/destroyed/hp`。第一次构造免费，只有被摧毁后的重建走真实金币/
  能源支付事务；未建成或已摧毁的世界不得进入传送目标列表。
- **详情按钮提示（2026-08-23）**：传送门建筑详情的“构造传送门”按钮只能根据
  `WorldProgressionSystem.getConstructableWorlds()` 是否非空切换金色脉冲，不得在面板复制地牢解锁、
  首次构造或毁坏重建条件；候选归零后随 `refresh()` 立即熄灭。动画必须尊重
  `prefers-reduced-motion`，降级为静态金色外发光。
- **基础快照不变量**：已建成且未摧毁的传送门必须对应一个 `sceneId` 快照。首次构造、重建、
  新游戏初始世界和读档都会调用 `ensureWorldBaseSnapshot`；已有完整快照不覆盖，重建则强制生成
  只含基础传送门和时间锚点的空建设快照。首次进入继续按场景规则生成地形/资源，离场后捕获为
  完整快照；入侵选目标前必须再次兜底补齐，禁止“已建门但无快照”的空位面进入后台结算。
- **位面初始特色建筑迁移（2026-08-23）**：`world-system.json#worlds.*.featureBuilding` 是首次接通时免费生成特色建筑的唯一映射；雪原 `scene9` 必须生成 `snow_castle`（显示名“雪原城堡”）。新增映射若需补齐已接通旧档，必须配置稳定 `migrationId`，由 `ensureWorldBaseSnapshot` 在同一 `worldEpoch=1` 快照中至多补一次并写入 `featureBuildingMigrations`；完整快照捕获必须继承该标记，防止玩家后续拆除后每次读档又被重新生成。
- **生命周期与世代号**：`WorldProgressionSystem` 的唯一内部状态为 `LOCKED / AVAILABLE /
  ACTIVE / DESTROYED / REBUILDING`；旧 `constructed/destroyed/everConstructed` 仅作为兼容派生字段。
  首次构造进入 `worldEpoch=1`，每次重建递增。基础/完整快照、入侵活动和世界传送门实体必须携带
  同一世代号；恢复、后台 tick、承伤、胜负回调和毁灭入口都要校验世代，旧世代回调只能忽略，
  不能清除或伤害新世界。v1 布尔存档迁移时，已建/已毁位面归入世代1，半途 `REBUILDING` 按毁坏处理。
- **毁灭事务与保存原子性**：毁灭事务以 `sceneId + worldEpoch` 幂等；先把进度状态置为
  `DESTROYED`，再删快照/旧坐标、撤主城入口并撤离玩家或观察者。快照捕获和存档序列化必须调用
  `canPersistWorld`，禁止在毁门与离场/保存竞态中重新写回旧实体。强制回城不得使用通用 rollback；
  加载失败时清空位面系统、墙体、实体、特效与循环音，有限重试，成功抵达主城才关闭事务。
- **配置化重置规则**：`world-system.json.resetPolicyDefaults` 提供 `baseTemplate / generationVersion /
  seedStrategy / resourceRule / preserveOnDestroy / clearOnDestroy / rebuildProtectionDays`，世界条目只需
  覆盖差异（当前每个世界声明独立 `baseSeed`）。`world-reset-policy.js` 是唯一归一化与种子派生入口；
  传送门状态和快照封存当前世代的 `generationVersion/generationSeed`。同一 `worldEpoch` 按用途盐拆分
  地表、障碍、资源随机流，重复进入稳定复现；重建后世代递增才换布局。旧档缺生成字段时按
  `sceneId + baseSeed + generationVersion + worldEpoch` 补齐。新建/重建时写入绝对游戏时钟保护截止点，
  保护期内由统一候选池排除；毁门清零保护，旧档缺字段按无保护迁移。
- **统一时间**：`WorldInvasionSystem.progressMs` 只消费 `EnvironmentLightingSystem` 的游戏帧增量，
  五日阈值到达后从已建传送门中随机选世界。前台目标调用 `DefenseSystem.beginManagedInvasion`；
  后台目标直接修改对应 sceneId 快照，承伤顺序为墙/门 → 普通建筑 → 传送门。
- **四世界同构**：scene8~scene11 都走 `SceneManager._setupPersistentWorld`，共同接入建筑、资源、
  单位、道路、快照和 RTS。`world122-snapshot.js` 旧导出保留兼容，新代码使用按 sceneId 的
  `capture/apply/serialize/restoreWorldScenes`；后台生产用游戏时间锚点，地牢探险期间也持续结算。
- **传送门死亡契约**：世界核心传送门标记 `_isWorldPortalCore`，目标分类按 BASE 处理；死亡即判定
  整个位面毁灭，删除该 `sceneId` 的建筑/单位/掉落物/矿点/道路快照和玩家旧坐标，位面内玩家或
  以该位面为本体的观察者强制返回主城。未重建传送门前禁止载入该位面；重建只恢复传送门进度，
  下次进入没有旧快照，必须按场景基础规则重新生成。若所有已建传送门同时断线，主城世界面板只
  开放“曾经建成过”的传送门应急重建，不能借此首次构造新世界。
- **入侵响应与调试契约**：传送门耐久按 `world-system.json.invasion.portalWarnings` 的 50%/25%/10%
  分段预警；HUD 显示实时耐久，异世界目标提供“本体支援”并以 `observer:false` 明确转移玩家，10%
  阶段提示支援或撤离；地牢探险中只允许世界面板观察指挥，玩家本体支援保持禁用。交互开发工具
  “位面”页签只调用系统公开调试入口：展示状态/世代/快照/候选池，
  推进时间必须同时推进 `EnvironmentLightingSystem` 统一时钟和入侵系统，模拟毁门必须复用正式毁灭事务。
- **顶部时间进度栏**：玩家可见名称统一为“时间进度栏”；`WorldInvasionSystem.getTimelineFrame()` 提供从当前时刻
  向未来展开的五日滑动窗口，`WorldEventTimelineSystem` 把袭击、预测到的天气及后续 provider 事件换算到同一
  相对时间横轴。“现在”固定在左侧4%安全锚点，事件按`剩余时间/五日窗口`定位并随时间流逝持续向左靠近现在，
  禁止再让当前游标向右追赶静止事件。袭击文字仍读取
  `getHudModel()` 并保留“距离入侵 N 天”；入侵发生后继续显示目标、波次、传送门耐久与支援按钮，时间轴不再
  复用条宽表达传送门耐久。底线固定铺满窗口并按左侧临近危险红到右侧远期安全绿显示，不再用填充宽度表达
  当前时间。事件标记使用两条防碰撞泳道，靠近两端时向栏内对齐；持续位移只更新事件与竖线的`left`，事件 DOM
  只在可见内容或结构变化时重建，禁止随10Hz HUD刷新重复创建或解码图标。
- **事件密度与交互**：当前筛选按钮由可见事件的 `type/typeLabel` 自动生成，默认“全部”，新增 provider 不得在
  HUD 硬编码新类型。筛选只影响显示副本，不得删除 provider 事件或修改排期。同一近时间窗超过2项时合并为
  `+N` 事件簇，点击后展开完整事件列表；两项以内仍使用双泳道独立显示。天气事件必须提供 `sceneId/worldName`、
  `intensityId/intensityName`、`startsAtGameTimeMs/endsAtGameTimeMs`，点击独立天气标记或事件簇内天气项时显示
  位面、强度、开始、结束和状态。详情浮层再次点击同一来源、关闭按钮或 Esc 均可关闭。每个事件另有独立钉在
  `position` 百分比上的竖向进度线，不得跟随靠边图标的视觉位移；当前时间游标抵达事件时两线应精确重叠。入侵
  事件使用红色脉冲、天气事件使用蓝色脉冲，混合事件簇按入侵红色优先；减少动态效果模式保留静态语义色与辉光。
  每个事件标记在鼠标悬停或键盘聚焦时必须显示类型化说明，天气包含位面/强度/起止时间，入侵包含状态/触发时间，
  事件簇包含数量/类型。时间进度栏默认使用窄幅细版，只保留轨道、图标、事件线和当前游标；下方箭头切换到原完整
  标题、筛选、袭击文字及详情版，再次点击可收起。简版与详情版必须共用同一 DOM 数据和事件百分比，禁止复制排期。
- **世界栏目切换事务（2026-08-20 修复）**：`SceneManager.switchScene` 以布尔值报告是否真正完成；
  目标不存在、传送门未建成或已有切换进行中时必须拒绝且不得改写观察/RTS 状态。普通切换在任何状态写入前
  快照实体、特效、相机、当前场景、本体坐标、观察状态及 `_worldPlayerPos`，加载失败统一回滚；观察态回滚
  禁止补入玩家实体。面板只有在返回成功且 `currentScene===target` 后才按真实 `_observerMode` 同步 RTS。
- **观察与坐标不变量**：观察主城也不能生成/移动玩家、消费重生点或用异世界本体覆盖 `_mainPlayerPos`；
  主城运行实体必须从驻留 Map 克隆后删除玩家，避免污染下次真实回城。scene8~scene11 正常返回均优先恢复
  各自 `_worldPlayerPos`。地牢期间世界栏目必须拒绝切换，不能绕过成功/失败/放弃的统一结算入口。

### 全局兵线与跨位面增援（2026-08-20）

- **唯一策略真源**：`TroopLineSystem` 只保存 `follow / hold / rally` 三态。仓鼠兵营与所有配置型军事
  产兵建筑统一标记 `_isTroopProducer`，生成后调用 `onUnitProduced`；矿工营地、传送门、仓库、商店、
  铁匠铺等功能建筑不得混入。`follow` 生成即跟随，`hold` 在出口待命，`rally` 按全局点下发。
- **集结点生命周期**：集结点必须保存 `sceneId + worldEpoch + x/y/z/surfaceKind`。设置前校验目标传送门
  已建成；每帧、读档、场景进入和存档序列化都复核世代。目标位面毁灭时，必须同时删除待抵达增援、
  已物化的跨位面部队和集结点，并把策略恢复为 `follow`；同 sceneId 重建后不得复活旧坐标。
- **切换与传送严格分离**：只有明确传入 `portalTravel:true` 的实体传送门旅行可以携带当前处于 `follow`
  的军事单位和队友。世界栏目观察、入侵观察/支援和通用 `switchScene` 不得隐式带兵。离场前先把随行士兵
  从原生产建筑名册与实体表移出，使源世界快照真实减员；目标加载成功后在玩家附近重新物化并继续跟随。
- **跨位面新兵**：前台新兵先以 `move` 指令走到本位面核心传送门，抵达后序列化为独立增援记录；目标
  位面加载时按保存坐标物化并待命。后台世界由 `WorldSimDriver` 在抽象生产结算前后比较 `unitRoster`，只把
  本 tick 新增兵种移入同一增援队列，并同步扣回源快照单位数/DPS，避免后台并行生产绕过兵线策略。
- **独立驻留与存档**：跨位面抵达的单位不归属目标世界任何生产建筑，防止占用当地建筑人口上限；
  `TroopLineSystem` 在场景离开时独立收纳、进入时恢复，主存档写入 `worlds.troopLines`。记录至少保存兵种、
  血量比例、目标位面世代和目标点；物化统一走 `createMilitaryUnit`，继续读取当前全局兵种升级。
- **v2事务与归属契约**：增援记录保存稳定单位ID、原生产建筑/位面/世代、有效状态和承载面目标；来源归属
  必须按`originProducerId + originSceneId + originWorldEpoch`三元组匹配，禁止不同位面重复建筑ID互相占编制。物化成功
  后才从队列提交删除，工厂异常、无安全落点和场景回滚都必须保留记录。所有单位统计本地、途中和
  异世界存活总数，并占用原生产位面的军事人口；只有位面特色出兵建筑额外受本建筑/分兵种 `unitCap`。
  目标世界不把外来驻军计入当地军事人口。快照保存建筑稳定ID、`troopLineDeployed` 与分兵种外派表，
  后台补员按同一口径，禁止通过反复传送突破人口或特色编制。
- **后台驻军与队友驻留**：后台入侵把独立驻军DPS计入防御，按`backgroundGarrisonAbsorbRatio`承担伤亡并
  回写兵线记录；回场只物化幸存者。非跟随队友留在原位面并暂停AI，真实传送只搬运跟随队友；观察/支援
  不隐式搬运。驻留位面毁灭时普通驻军随位面清除，剧情队友撤回主城并恢复跟随。
- **安全落点与编队**：跨位面单位先在传送门附近通过墙体、建筑、单位和地图边界校验后落地；高架目标保存
  `wallId/staircaseId`并从地面传送门重新规划正式表面路线。目标位面已加载但暂时没有安全落点时，权威记录
  必须保留并节流定时重试，不能只依赖重新进入位面或下一批增援触发。RTS编队保存稳定单位ID，物化新实例后仍可恢复。
- **指挥 UI**：兵线面板只在 scene8~scene11 的指挥模式显示，标题固定“兵线控制”。点“自定义集结点”后
  进入一次性右键取点态；允许先通过观察切换到另一已建位面再选点，取点优先复用
  `DefenseSystem.resolveSurfaceTarget`。取点期间右键不得再下发普通移动/攻击指令，成功后显示位面名和坐标。
- **建筑独立集结**：指挥模式左键单选 `_isTroopProducer` 建筑后，右键当前位面的可达位置，为该建筑保存
  `originSceneId + originWorldEpoch + producerId + target`。它只接管该建筑之后生产的单位，并优先于全局
  `follow/hold/rally`，但不得改写左侧兵线面板状态；后台生产也必须先检查独立设置，不得被全局跨位面兵线抽走。
  全局“自订”只有在目标校验并成功保存后才统一清空全部
  建筑独立集结；取消取点、不可达或保存失败均不得清空。独立记录随 `worlds.troopLines` 存档，建筑销毁、出售
  或所属位面世代失效时删除。当前位面有效集结点使用持续金色虚线标识：起点固定在画布上沿外的天空，
  沿视觉 Z 轴向下指到 `physicalY-z` 的真实承载面，并随相机平移、缩放逐帧重算；独立点优先于全局点显示。
  产兵建筑选中提示必须直接描绘 `isoFootprintVertices` 返回的底面多边形，禁止按贴图或碰撞半径回退成椭圆；
  提示层位于建筑主体之下，并以金色半透明填充和轮廓显示真实占格。
- **指挥态建筑详情与集结信息整合（2026-08-23）**：指挥模式点击任意建筑均沿现有系统打开详情且
  无玩家距离限制，不切出指挥态。产兵建筑同时保持唯一 `producer` 选择，使独立集结右键语义、占地高亮
  和金色引导线继续有效；集结状态作为“集结部署”分区直接放进仓鼠兵营和配置型出兵建筑的详情栏目，
  与募兵状态、兵种选择、单位升级形成单一纵向信息流，禁止再在详情左侧悬挂重复生命值/兵种信息的小面板。
  分区只读取 `TroopLineSystem` 权威状态并原地刷新；切换建筑或点击空地只关闭详情，不得启动建设放置监听器。
- **建筑详情连续切换与指挥态悬停（2026-08-24）**：`buildingDetail` 分组的面板外点击守卫在命中另一栋
  建筑时必须把同一次指针过程留给建筑交互链；同面板类型原地替换目标，跨类型先打开目标详情再关闭旧面板，
  禁止要求玩家先点一次关闭、再点第二次打开。空地、关闭按钮、Esc 和再次点击同一建筑仍按既有规则关闭。
  指挥态悬停只为当前可见建筑按实际 Phaser 主体贴图加金色 `filters.internal.addGlow`，运动叠加层和防御塔
  多层贴图同步处理；不得给全场建筑常驻滤镜，也不得借悬停改写产兵建筑选择、占地提示或集结命令。

### 能源经济数值审计基线（2026-08-20，已整改）

- **平衡边界**：本轮只审计自动矿工。玩家、露娜、伊莉丝和其他普通队友因技能/武器组合不可稳定量化，
  不纳入产能基线；2026-08-22 起普通来源统一使用 `ENERGY_CONFIG.gatherRatio=1.0`，矿工继续使用
  `hamster-miner-config.json#energyGatherRatio=0.125` 的专用倍率。
- **配置分层**：矿工营地结构/补员参数唯一真源为 `data/hamster-miner-camp-building.json`；矿工基础属性与
  专用 `energyGatherRatio=0.125` 在 `data/hamster-miner-config.json`；成长与逐级费用在
  `data/building-upgrades.json#miner_economy`。建筑只通过 `upgradeProject` 关联项目，不得再写项目 ID 或固定费用。
- **共享公式**：前台矿工实体把专用采集倍率传给 `EnergyNode`，普通来源仍用全局倍率；后台统一调用
  `miner-economy.js`，按伤害、攻击间隔、采矿倍率、数量及7%暴击期望逐击取整。基础矿工含暴击期望
  约6.21能源/秒；满经济模块为3只、115伤害、1.6倍采矿、1.8秒间隔，不计暴击约38.33/秒，
  含暴击期望约39.62/秒。
- **成长与费用**：采矿/伤害/攻速/移速每级分别+6%/+1.5%/-1%/+1.5%，均10级；增员上限2级。
  矿工营地面板中的伤害、攻速、增员项目分别显示为“采矿强化”“工作加速”“矿工增援”，仅调整矿工职业语义，内部 effect 与数值口径不变。
- **矿工营地升级读条（2026-08-23）**：矿工营地模块与房屋、银行、经济工坊、仓库统一使用 `renderBuildingUpgradeCard`；开始时通过 `payBuildingUpgradeCost()` 扣费，完成读条后才提升本栋模块等级并同步存活矿工。当前读条必须进入世界快照，离场位面继续推进，回场恢复剩余时间；风车和市场没有配置升级项目，不得为视觉统一虚构升级。
  采矿模块能源费为250/300/350/400/450/500/575/650/725/800，增员为5000/8000；其余矿工模块
  仍为500能源/级；金币与通用军事项目统一按
  `500/700/900/1200/1500/1900/2400/3000/3800/4800` 的逐级曲线，10级累计20700。
  费用解析走通用项目函数，UI显示真实下一级费用。
- **矿工岗位即时物化（2026-08-25）**：玩家增加岗位时，营地必须在同一次岗位变更中直接生成本次新增岗位对应的矿工，禁止复用死亡补员的 `respawnMs` 读条逐个等待；出口空间不足时才进入 `SpawnPlacement.retryMs` 短重试。矿工死亡后的常规补员周期、撤岗返营提交、快照恢复和人口占用保持原合同。面板不再显示“矿工就绪”读条。“背包扩容”使用专用 `miner-backpack-expansion.png` 升级图标，禁止回退为 emoji 占位。
- **D/C金币消耗基线（2026-08-24）**：常规军事与矿工十级模块使用上述曲线，单项目累计20700；
  铁匠铺与研究院的能力项目继续使用各自 `goldBase/goldGrowth`，经济建筑按项目价值配置独立
  `goldByLevel`。防御塔芯片单项限定10→30，费用为 `60×1.28^n`、累计约29652。价格唯一真源均在
  `data/building-upgrades.json` 或塔配置，UI和扣费端只消费解析结果，不复制静态总价。
- **后期边界**：B/A级地牢未完成前不新增臆测的后期金币项目，也不提前写毕业总价。对应内容完成后，
  必须用实际路线产出、银行同时间窗收益和现有D/C消耗剩余量重新审计，再决定是否提高或新增消耗。
- **仓储冷启动**：当前世界没有活动仓库时首仓费用为0，后续恢复500金币；单仓容量15000。建筑记录
  实际支付成本，因此免费首仓回收为0；仓库被毁后世界再次无仓库时可重新获得冷启动保障。每个位面生命周期
  首次成功落地冷启动仓库时向该仓直接存入1000能源和500食物，领取标记必须随位面快照保存；出售、普通摧毁
  或读档恢复不得重复发放，只有新游戏或位面生命周期彻底重置后才能再次领取。
- **仓库详情实时刷新边界（2026-08-27）**：仓库同时声明 `economyType:"warehouse"` 与
  `workshopType:"warehouse"`，详情渲染和100ms实时刷新都必须在通用经济分支之前识别仓库，或显式将
  `_isEnergyWarehouse` 排除出通用经济分支；等级扩建/独立升级完成后，仓库专用分支负责重建按钮状态，禁止
  被通用经济分支提前 `return`，造成必须关闭再打开面板才能继续升级。
- **持续消耗**：军事单位生产粮食费配置为民兵50、斥候75、战士125、盾卫150、射手120、火枪180、
  牧师240、轻骑220、骑士300，配置字段统一为 `spawnFoodCost` / `unitSpawnFoodCost`。矿工不属于军事出兵，死亡补员费用固定为0，前后台补员均免费。军事单位前后台都在真正生成时扣粮；
  快照恢复只物化已保存单位不收费；余额不足时计时归零等待，不凭空补员。开发工具 `_devInfiniteResources`
  不得豁免军事招募粮食；单次入口预检与最终生成事务都必须执行真实粮食校验，避免读条期间库存变化后透支出兵。
- **三态招募协议（2026-08-21）**：仓鼠兵营和所有配置型军事生产建筑默认 `paused`，不再建成后自动读条。
  `single` 按当前选择兵种完整读条并只生成一名，成功后自动回到 `paused`；`continuous` 在人口、能源和
  出口条件满足时循环生产；暂停冻结当前读条，切换兵种按新兵种周期重新计时。状态统一定义在
  `src/world/recruit-mode.js`，成本、兵种和周期继续读取建筑配置，不在 UI 或状态协议中硬编码。
- **前后台一致性**：世界快照必须捕获/恢复 `recruitMode`，缺字段的旧快照按 `paused`；后台
  `settleWorld122` 同样尊重三态，单次只结算一名后写回暂停，暂停时不得因离开世界恢复自动生产。
  快照名册恢复队列是唯一例外：只物化已保存单位且不收费，不得被暂停状态阻断。
- **全局结算**：`research_passive_energy` 有前台世界时只由 `ResearchSystem` 结算；无前台世界时，
  `WorldSimDriver` 只把被动能源记入最近离开的一个快照。牧师什一税仍按每个世界的实际牧师数结算。
- **维护闭环**：墙与塔修理效率改为8/7耐久每能源；通用建筑、矿工营地、兵营、产兵建筑和防御塔
  的回收额均乘剩余耐久比例，阻断低耐久时“拆掉重建比修理便宜”的固定半价套利。
- **旧奖励口径**：新五日入侵胜利路径仍不计旧十波配置中的500能源；除非后续明确迁移，不得纳入收益模型。

### 后续打磨方向（未做）
- 波次/Boss 波/经济平衡数值；塔血量被摧毁后重建/出售；怪物分路（多入口）与减速/范围塔；
  塔面板换弹/弹药显示；防守胜利结算（撑过 N 波）；**防御塔机械臂上的武器贴图挂载渲染**
  （需标定臂尖挂载点 + GameScene 塔武器 sprite 叠加）；D 级石垒底边不规则，后续可精修。

### 要塞式压平视图（2026-08-20，2026-08-29 输入/指令修订）
- **唯一入口**：scene8~scene11 仅在建筑模式或 RTS 指挥模式使用 `Space` 切换压平/恢复；
  `FlatViewSystem` 不注册滚轮或其它备用键。普通直接操控时 `Space` 继续只属于玩家闪避；退出建筑/RTS
  输入态、切离支持场景时必须自动恢复立面，禁止遗留无法恢复的压平画面。观察者只有正式启用 RTS
  指挥态时才继承这一入口，不能另建观察者快捷键分支。
- **显示边界**：`GameScene` 的常规同步完成后再调用 `FlatViewSystem.sync`。只隐藏建筑立面、塔多层精灵、
  门、楼梯分段和非障碍墙件，并按 `isoFootprintVertices` 真实占地绘制地面投影；不得修改实体坐标、碰撞、
  路径、射程、弹道或高度。
- **视觉恢复**：首次接管时保存每个 Phaser 对象原本的 `visible/depth`，退出时精确恢复；建筑底部铺装
  统一由 `BuildingRoadSystem` 的固定地表层 Sprite 维护，压平模式不创建或接管额外地基。建筑太阳影和附着受损
  特效压平时移除，环境障碍阴影保留。所有建筑装饰特效同样隐藏，包括 `overlaySprite` 风车旋转部件与
  `workingEffectGraphics` 按需工作特效；由于战争迷雾是后置可见性仲裁，必须在雾同步后再次压制这些装饰层，退出
  压平后交回常规建筑同步自然恢复。
- **高低层适配**：见 `docs/flat-view-elevation-interaction-plan-2026-08-20.md`。压平层只读取
  `_surfaceKind/_surfaceWall/z`：墙顶/楼梯单位显示高度环与地面投影线，同点上下层单位连续点击轮换，
  通用弹体撞隐藏墙时显示短时阻挡标记；移动/攻击指令点显示目标承载层，混层编队明确提示各自寻路，
  复数选择面板统计各层数量。必须继续复用 elevation/LOS/route 真源，禁止另建压平专用 Z 轴。
- **压平点击坐标**：压平投影上的点击点已经是物理地面 `x/y`，`resolveSurfaceTarget` 不得再把墙顶/踏步
  `z` 叠加到 `y`；普通立面点击才执行屏幕投影还原。RTS 的移动、移动攻击、巡逻及集结统一经同一个
  屏幕点解析入口，一次右键只下发一条指令，禁止 DOM 捕获与 `Input.rightPressed` 各消费一次。
- **普通鼠标状态**：RTS 指挥模式、建筑模式及普通直接操控中原本使用默认指针的空手/近战等状态，在真实
  游戏表面统一使用 48×48 冷钢标准箭头，CSS 热点固定
  为左上尖端 `(3,2)`；枪黑外框与银灰主体只表达普通选择，不使用绿/红/金等语义色。DOM UI 恢复控件
  自身指针，可交互建筑继续使用手型，直接操控的枪械/弓箭使用冷钢轻量准星，禁止普通指针覆盖这些状态。
- **可登高鼠标状态**：只由 `RTSCommand` 在普通移动语义下读取同一个 `resolveSurfaceTarget` 结果，并继续按
  已选单位调用 `routeSurfaceMoveForUnit`；至少一个友军可达 `wall_walk` 时，`GameScene` 才用最高层 DOM 鼠标
  画布显示立体绿色上箭头并覆盖默认鼠标与武器准星。UI 悬停、拖框、集结、移动攻击、巡逻和全员不可达
  墙段必须恢复各自原鼠标状态。箭头使用枪灰/石墨钢外框、银灰切边与克制成功绿内芯；位置不得直接复用
  `Input.mouse`：普通立面投影 `target.y-target.z`，压平视图投影物理 `target.y`，再经 `Renderer.worldToScreen`
  输出 CSS 客户区坐标，并以可见钢框底部中心贴合墙顶安全区内收后的目标点。动画只做 6px 相对向上循环与
  克制回绕淡出，不得另建城墙命中、路线或可达性判定。
- **六类高优先级指令鼠标**：移动攻击、巡逻、全局/建筑独立集结、指定攻击、无效目标与建筑回收统一使用
  48×48 冷钢语义游标，目标型热点必须落在中心或军旗杆底。`GameScene._syncCrosshair` 是游戏世界游标唯一
  写入方；`RTSCommand`、`BuildingSystem` 只返回语义状态。悬停反馈和正式点击必须共用
  `resolveSurfaceTarget`、单位表面路线、集结只读门禁及回收候选门禁，禁止为游标另建可达/可回收判断。
  状态优先级固定为 UI 控件自身指针 > 当前模式（回收/移动攻击/巡逻/集结）及其无效变体 > 指定攻击 > 可登高 >
  建筑交互 > 普通冷钢箭头；普通模式队友指令取点也必须压过枪械/弓箭准星。
- **范围技能结算**：`elevation.js` 已提供承载面/飞行体积快照，`Ground*`、`Vertical*`、持续 `GroundZone`
  及范围技能调用方统一消费；墙上与墙下投影重合不再跨层命中。闪电、雷暴领域和感电过载按上一跳实体逐跳
  检查真实高度 LOS。该规则在普通/压平视图中始终相同，严禁在 `FlatViewSystem` 内增加战斗分支。

### 全局科技树与功能门禁（2026-08-21 初版）

- **配置与状态分离**：科技节点、前置、研究量、布局和解锁目标统一维护在 `data/technology-tree.json`；
  `TechnologySystem` 只保存完成项、当前项目、远端目标队列与各节点进度，不得把科技点接入金币、能源或顶部资源栏。
  - **多前置 AND 汇合协议（v34，2026-08-27）**：配置顶层固定声明 `prerequisiteMode:"all"`；节点列出两个或更多 `prerequisites` 时，必须全部完成才允许进入可研究状态，配置校验、自动随机、目标队列与开发工具瞬间研发统一复用 `TechnologySystem.getPrerequisiteStatus()/arePrerequisitesMet()`，禁止消费方私自改成任一满足。面板参考文明系列的汇合路线表达：同一目标的各条入线使用稳定的不同颜色和独立入线端口，待研发前置显示虚线、已完成前置单独转实线，目标卡显示 `AND 已完成数/总数`；详情必须逐项列出前置状态，跨页前置即使不绘线也必须显示在清单中。选中多前置目标时研究计划表达为完成所有缺口后再研究目标，不得把并行依赖伪装成单条因果链。
  - **三线结构（v23）**：主科技树固定分为“工程 / 军事指挥 / 经济与位面”三条主线页；军事和指挥共享同一分支，
  经济页承载住房、农业、市场、银行、经济工坊和位面物流协议。仓库与一级房屋是基础功能，不登记科技拥有权；
  小麦风车同样作为基础经济建筑直接开放，“农业分工”只登记其四项本栋升级的拥有权；
    `聚落规划 -> house_level_2`、`住房优化 -> house_level_3`、`洋楼营造 -> house_level_4`、
    `蒸汽住宅工程 -> house_level_5`、`现代住宅体系 -> house_level_6`、`生态垂直都市 -> house_level_7`，六级节点按住房纵链逐项研究；
    `经济工程 -> 位面物流协议`不再接在七级住房之后，改由能源体系的`蒸汽工业标准化`分支解锁；升级按钮隐藏时保留原槽位且业务层必须二次校验。
  工程线按 `工程制图 -> 城防工事 -> 防御塔工程` 延伸；位面打通后，传送门首次构造直接由位面生命周期开放，
  不登记科技拥有权，也不得在传送门面板额外检查研发状态。可构造列表和最终构造入口仍必须校验对应地牢解锁条件。
  - **经济与位面横向四分支（v21，2026-08-26）**：经济页固定分为住房、农业、金币、能源四条横向分支，住房位于顶部并作为时代主线。二至五级住房分别门禁乳品畜牧/主权铸币/深钻工程、面包烘焙/综合商业/风力发电、连锁餐饮/资本市场/光伏发电、酒馆经营/分布式算力/位面谐振；六级住房门禁中央厨房标准化、算力标准化和谐振校准；七级住房门禁宴饮标准化与位面祭祀。当前没有七级能源节点，不得为填满版面伪造空科技。
  能源分支内部允许保留两条清晰横线：新能源线沿深钻工程继续进入风力、光伏和位面谐振；蒸汽线为`深钻工程 → 蒸汽动力 → 蒸汽工业标准化 → 经济工程 → 位面物流协议`。布局坐标只决定显示位置，真实可达性始终由`prerequisites`决定；布局调整必须同步科技 JSON 版本与`TechnologySystem.VERSION`，既有已完成科技保持完成，新游戏按新前置图研究。
  - **军事建筑纵向骨架与三级黑火药门槛（v40，2026-08-27）**：`thatch_hut_level_1`是军事页左上角、无前置且通过`initiallyCompleted:true`在新游戏与旧存档中默认完成的“仓鼠草屋·I级”节点；它与原“仓鼠草屋军备”交换位置，作为纵向建筑骨架真实起点。纵向路线固定为“仓鼠草屋·I级 → 军营建制 → 阵地射击 → 骑兵学 → 战地神学”，依次开放军营、靶场、骑兵学院和教堂；仓鼠草屋仍没有建筑科技所有者，初始即可建造。草屋横向支线固定为“仓鼠草屋·I级 → 侦察编制 → 仓鼠草屋军备 → 斥候营地 → 特战基地”，军备同时负责铁匠铺、征募效率与战术指挥，不再承担纵向建筑门槛。各建筑的基础兵种、I级基线、II级与III级编制只在本行向右展开。靶场二级阶段的`gunpowder`玩家名称固定为“黑火药”，基础成本650、折算1950点，独立解锁仓鼠火枪；五类III级都必须显式同时要求本建筑II级与黑火药，靶场路线固定为“黑火药 → 长弓整编 → 靶场III级”，三级仍以`[shooting_range_level_2, gunpowder]`表达 AND 汇合，禁止因为黑火药已是二级前置就删掉显式时代门槛。五类出兵建筑的II级基础520/折算1560、III级基础920/折算4140保持不变；十项高阶编制合计28500点。兵营三级由仓鼠特战替换废弃的动力甲占位，并与仓鼠防暴队完整开放；教堂按单线法术支援换代设计为`仓鼠牧师 → 仓鼠主教 → 仓鼠大主教`，二、三级在单位完整开发前保持占位。
  - **骑兵学院完整换代线（v42，2026-08-28）**：轻骑线固定为“仓鼠轻骑 → 仓鼠骑兵 → 仓鼠侦察游骑兵”，重骑线固定为“仓鼠骑士 → 仓鼠翼骑兵 → 仓鼠动力爆矛重骑兵”。两条三级路线已共同完成，`cavalry_school_level_3`必须以`[cavalry_school_level_2, gunpowder]`作显式AND前置，并在同一节点登记三级编制和两个三级单位的解锁所有权；不得重新引入侦察游骑兵的`supplementalUnitUnlocks`或独立提前招募科技。旧版临时`cavalry_scout_rifle`的完成状态、进度和研究目标由v42迁移到正式三级编制。
  - **兵种开发路线（用户长期规划真源）**：下表是后续新增友军时必须遵守的稳定设计合同，不是完成进度或临时待办；具体制作状态仍写入`CHANGELOG.md`/`TODO.md`。层级关系固定为I→II→III，建筑之间的开发优先级由用户后续决定，不得自行调整路线、合并兵种或跨级实装。

    | 建筑 | 兵种职能 | I级 → II级 → III级 | 长期定位与三级目标 |
    |---|---|---|---|
    | 仓鼠草屋 → 斥候营地 → 特战基地 | 长枪兵 | 仓鼠民兵 → 仓鼠长戟 → 仓鼠反载 | 中低伤害、中等耐久、低抗性；三级平时使用冲锋枪，周期性用火箭筒造成爆发伤害。 |
    | 仓鼠草屋 → 斥候营地 → 特战基地 | 斥候 | 仓鼠斥候 → 仓鼠游侠 → 仓鼠狙击手 | 标记升级、高伤害、高视野。 |
    | 仓鼠军营 → 现代步兵军营 | 突击输出 | 仓鼠战士 → 仓鼠冠军 → 仓鼠特战 | 中等耐久与持续输出逐级换代；三级为现代沙色战术步兵，使用泵动霰弹枪进行窄角近距爆发，不继承盾卫自动防御。 |
    | 仓鼠军营 → 现代步兵军营 | 盾卫 | 仓鼠盾卫 → 仓鼠方阵 → 仓鼠防暴队 | 低伤害、高耐久、高抗性；三级以防暴盾和低伤散弹扇区稳步压制。 |
    | 靶场 | 射手 | 仓鼠射手 → 仓鼠长弓 → 仓鼠突击 | 叠加毒液、相对重火力、高机动；三级为突击步枪单位。 |
    | 靶场 | 重火力 | 仓鼠弩手 → 仓鼠火枪 → 仓鼠重机枪 | 目标穿透与护甲穿透。 |
    | 骑兵学院 | 轻骑兵 | 仓鼠轻骑 → 仓鼠骑兵 → 仓鼠侦察游骑兵 | 高机动轻骑逐级换代；三级使用半自动侦察步枪进行中距离单发，并允许移动指令与瞄准/攻击并存。 |
    | 骑兵学院 | 重骑兵 | 仓鼠骑士 → 仓鼠翼骑兵 → 仓鼠动力爆矛重骑兵 | 中高机动、高耐久、高造价；三级以火箭助推冲锋直击眩晕主目标，并在命中点造成无AOE眩晕的范围爆炸伤害。 |
    | 教堂 → 主教议会 → 圣迹大教堂 | 法术支援 | 仓鼠牧师 → 仓鼠主教 → 仓鼠大主教 | 二级强化群体治疗、净化与持续续航；三级强化大范围祝福、护盾与圣域支援，不预设复活。 |

  - **路线开发闭环**：每个新兵种先按`skill/09-monsters-npc.md#玩家友方单位添加工作流`完成配置、实体、AI、六维/伤害、正式动画与RIFE门禁、预载/工厂、UI图标、所属建筑解绑、存档/后台模拟等真实闭环，再加入对应建筑`unitTypes`并移除行级占位。新兵种还必须继承建筑`upgradeProject`的共享模块口径；不得只补名称、科技卡或空实体来提前开放等级。教堂法术单位还必须先复用统一治疗、状态净化、护盾与施法快照协议；复活不属于当前占位设计，未经单独确认不得加入。
  - **科研升级与整级换兵边界**：`producer-buildings.json#recruitmentTiers`是等级、建筑名称、槽位、角色画像和替换目标唯一真源。可研究的等级科技通过`recruitmentTier:<tierId>`全局门禁；科研完成后，当前建筑、读档恢复与后续新建实例立即使用该级名称和建筑贴图。兵种换代独立遵守完整开发门槛：同一级所有兵种必须登记运行时`unitTypes`并移除行级`placeholder`后，才按同一槽位替换后续可招募兵种并重置该次生产周期；已生成单位、混编快照和外派部队保持原兵种，不做实体变形。尚未完整开发的等级允许先完成科研与建筑外观升级，但继续沿用最近一档完整可玩兵种，避免引用缺失实体。`supplementalUnitUnlocks`是明确的独立单位科技例外：仅允许已登记运行时单位、且对应`unit:<key>`科技已完成的兵种在所属等级科技尚未完成时加入当前招募选项；所属整级或更高整级启用后仍按槽位换代移除旧单位。当前唯一实例是黑火药先独立解锁仓鼠火枪，完成长弓整编后火枪再并入正常二级编制；不能用该字段泄漏长弓、动力甲或其他占位兵种。开发会话只修改自己负责的行级占位和单位登记，不得代替并行会话改动其他兵种。
  - **单条高阶兵种可先完整暂存（仓鼠方阵 2026-08-26）**：某一槽位已完成时，可以先把真实单位加入`unitTypes`、工厂/预载/图标/升级/兵线/快照/后台模拟，并只移除本行`placeholder`；`isRecruitmentTierImplemented()`会因同级另一行仍占位而继续使用上一档完整编制。此阶段不得清除科技节点占位、不得提前宣称该等级可招募，也不得只给单条路线登记正式科技所有权。最后一条路线完成时，再一次性给同级全部单位补齐`unit`解锁、解除科技占位并提升科技版本，避免半套编制从默认解锁兜底泄漏。
  - **完成编制必须显式登记单位解锁归属（v32，2026-08-26）**：当某级两条路线均已落地时，对应科技节点的`unlocks`必须同时列出`recruitmentTier:<tierId>`和该级每个`unit:<unitKey>`，科技详情、`TechnologySystem.isUnlocked('unit', key)`、生产按钮与最终`spawnUnit()`共用同一所有者。系统对“没有任何科技所有者”的单位默认返回已解锁，因此只登记`recruitmentTier`会让单位业务门禁依赖兜底，科技卡也看不到真实解锁内容。新增或补齐这些显式归属时同步提升`technology-tree.json`与`TechnologySystem.VERSION`；已完成对应节点的旧档会自然继承新增解锁，不需要改写已出兵实体。
- **新增建筑门禁**：`军营建制 -> hamster_barracks` 接在军事组织之后，盾阵学改以军营建制为前置；
  `位面祭祀 -> plane_altar` 放入经济与位面页并以市场流通为前置。两类建筑继续复用建筑栏折叠门禁和落地二次校验。
- **位面专项研究**：随位面解锁才可研究的特色科技必须放入独立 `planeResearch` 配置，不得混入三条主线前置；
  未解锁位面时对应项目仍显示在“位面独特科技”栏目，但卡片内容和详情必须使用动态马赛克遮蔽且禁止研究；
  开发工具“解锁全部科技”是明确例外：它直接完成全部 `planeResearch`，不要求对应位面已开放；已完成状态
  优先于位面遮蔽，卡片和详情必须显示真实科技内容，关联建筑、兵种和升级门禁立即解除；
  位面满足资格后原卡片解除遮蔽并进入自动随机池。位面特色建筑与其高阶/标志性兵种默认拆成两级：
  第一级登记建筑（以及明确作为建筑基础编制的兵种），第二级以前者为前置，只登记对应特色兵种；不得把
  “能建造建筑”和“能招募全部特色单位”重新合并成一个门禁。当前固定映射为：`scene8`沙漠官邸营造术
  →沙漠僧侣修行、`scene9`雪原城堡营造术→雪原忍术、`scene10`丛林神庙仪式→丛林祭司传承。
  拆分科技必须同步提升配置/系统版本；旧档若已完成原合并科技，应在迁移中补齐新增兵种科技，避免既有
  招募权限回锁。新档则必须真实完成第二级研究。单位门禁必须覆盖默认兵种回退、切换按钮、单次/连续生产、
  双通道队列、最终`spawnUnit()`与快照恢复，不能只在面板隐藏按钮。若第一级科技负责解锁特色建筑建造，
  新世界不得再由`featureBuilding`免费预置同一座限量建筑；移除自动种子时保留旧快照中已存在的建筑。
  科技面板顶部为此提供独立“位面独特科技”栏目；全部位面专项节点只在该栏目展示。
  遮蔽层仅使用可平铺的黑白电视雪花噪点，必须不透明覆盖整张研究卡牌；禁止再叠加马赛克块、扫描线或
  整卡位移。相邻卡片采用不同噪点相位，面板关闭时暂停，并在 `prefers-reduced-motion` 环境下退化为静态遮蔽。
- **研究结算**：每座存活研究院线性提供配置化研究速度；`WorldSimDriver` 每秒汇总当前活动建筑与非活动位面
  快照中的研究院，只推进一次全局科技，严禁按世界循环重复结算。没有有效手选项目时，只能从当前满足全部
  前置的未完成科技中随机选择；切换科技保留进度。单次 tick 完成项目后的剩余研究点必须继续投入队列下一项，
  不得在项目边界丢失，否则 ETA 与多研究院线性产出口径会分叉。
- **目标队列（v2）**：允许把任意未完成节点设为远端研究目标，`TechnologySystem` 按前置依赖拓扑顺序生成
  `researchQueue`，逐项完成后自动切换下一项；取消目标或目标完成后恢复“当前可研究节点中随机选择”的
  原自动规则。v1 存档的 `activeTechId` 迁移为同名目标，已有 `progressById` 不丢失。
- **v3 存档迁移**：旧科技存档保留原节点完成顺序、进度和位面专项完成状态，并一次性完成 v3 新增经济节点，
  防止已经在使用的房屋等级、经济建筑和仓库协议因升级版本被重新锁定；新游戏仍按完整三线从零研究。
- **研究反馈**：科技树必须同时显示研究院数量、实时速度、目标队列/自动随机模式和 ETA；远端目标允许直接
  选择，卡片显示队列序号，选中节点时高亮包含已完成部分在内的完整前置路径。
- **门禁默认值**：只有科技配置明确声明拥有权的 `type:id` 才受锁定；没有登记的既有功能默认可用，避免新增
  科技表时误伤全部旧功能。UI 必须隐藏锁定按钮，底层建造、产兵、升级和指令入口仍须二次校验。
- **门禁布局不变量**：兵种、升级项目和兵线等既有控件隐藏时继续保留原始网格/列表占位，解锁后在原槽位恢复；
  浮动栏目不得用隐藏锚点的零尺寸 `DOMRect` 计算坐标；新增常驻入口必须追加在既有栏目之后，不得改变原按钮
  序号。**建筑栏是明确例外**：锁定建筑使用折叠门禁，不保留空槽，所有可见建筑连续排列；默认按科技实际完成
  顺序排列，基础建筑在前，同一科技内保持原清单顺序，并可切换为能源造价升序（金币建筑置后）。科技完成/
  解锁刷新只重绘建筑网格，不得取消放置或退出回收模式；只有读入低科技存档使当前操作重新上锁时才终止。
- **统一门禁与配置校验（v2）**：玩家 UI 的科技可见性统一通过 `TechnologyGate` 绑定，负责占位、鼠标、
  键盘、`aria-hidden`、`inert` 与解锁事件刷新；业务底层继续调用 `TechnologySystem.isUnlocked`。
  科技配置载入时必须检查重复节点、无效研究量、缺失/自指前置、循环依赖、不可达节点、非法解锁类型、
  不存在的建筑/兵种/升级/机制目标与重复解锁归属，禁止把这些校验散落在各消费面板。
- **功能退役必须整链删除（2026-08-22）**：移除位面建筑能力时同时清理 `BUILD_ITEMS`、放置与实例化分支、
  点击/RTS/场景生命周期、BootScene 预载、专用渲染层、科技节点与目标类型、面板样式、回归脚本、生成工具和
  正式贴图；科技恢复会按当前节点表过滤旧 ID，不为已删除节点另写迁移。名称相近不代表同一系统：位面防守
  陷阱退役不得删除僵尸地牢 `trap-system.js`、`trap_idle/trap_anim`、地牢事件贴图、音效或配置。
- **存档兼容**：新存档独立写入顶层 `technologyTree`。旧存档缺少该字段时一次性完成全部现有科技，保证已有
  建筑、兵种和机制不被回锁；新游戏则从零开始。
- **界面契约**：科技树挂载右侧栏目统一层但覆盖全屏，沿用右滑 0.25 秒动效；正常交互只允许右上角关闭按钮
  和 ESC 关闭，不提供遮罩点击、再次点击入口或其他隐式收回路径。开启期间除科技树自身键盘交互和 ESC 外，
  不得让背包、任务、队伍、世界等全局栏目快捷键穿透。开发工具“技能”页的一键解锁用于全量测试；“瞬间研发”
  开关只把科技详情的目标按钮改为完成当前所选科技，必须按依赖拓扑连同未完成前置逐项调用正式完成结算，
  不得直接写 `completed`、绕过位面资格/规划占位，或破坏原目标队列与消费方刷新。

### 位面战争迷雾（2026-08-21 定稿）

- **适用范围**：只在持久位面 `scene8~scene11` 启用。逻辑真源为 `FogOfWarSystem`，配置真源为
  `data/fog-of-war.json`（`public/data/` 必须同步）；默认格宽 128、更新间隔 100ms，12288×8192 位面为
  96×64 网格。严禁按 Phaser Sprite 可见性反推逻辑视野。
- **三态语义**：`UNEXPLORED` 为纯黑；`EXPLORED` 显示暗化地形和静态建筑，但隐藏敌对/动态情报；
  `VISIBLE` 正常显示。主画面低分辨率 CanvasTexture、小地图遮罩、HUD 与 RTS 目标门禁必须读取同一网格，
  禁止各系统复制距离判定。
- **视野源**：玩家 1150、队友 900、普通军事单位 720、斥候 1450、骑兵 950、传送门 900、
  出兵建筑 650、防御塔 1200；墙顶乘 2、楼梯乘 1.2。墙、门、道路、仓库及普通建筑无视野。所有有效友军源取并集；
  观察相机不提供视野，观察模式仍只看友军实际控制区域。正式队员只存在于 `PartySystem.members`，不在
  `Game.entities`；必须在玩家实体确实物化于当前位面时额外合入，禁止观察模式借用留存队伍坐标开图。
- **昼夜倍率**：`EnvironmentLightingSystem` 的 `daylight <= 0.12` 为统一夜晚口径；普通有效视野源最终半径
  乘 `vision.nightMultiplier`（默认 0.5），白天恢复 1。仓鼠探险家以实体级 `fogSightRadius:1600` 覆盖斥候
  profile，并由“侦察视野”每级增加 200px（Lv.6 为 2800px）；`fogSightDebuffImmune:true` 使其跳过昼夜、
  沙尘暴和死寂雾潮等视野负倍率，但祭品视野加成及墙顶/楼梯倍率仍在同一
  `VisionSourceRegistry.radiusOf()` 链路叠加。
- **信息门禁**：敌人、入侵特工、掉落物在非 `VISIBLE` 格必须同时隐藏本体、阴影、名字/血条、Boss 条、
  X 光克隆、关联特效/浮字/投射物和小地图标记。RTS 点选、框选、已选目标清理、右键攻击目标及自动寻敌
  同样拒绝隐藏敌人；空地移动、巡逻、集结允许进入未知区域。
- **建造门禁（2026-08-24 调整）**：玩家建筑可落在 `VISIBLE` 或已经探索但当前无视野的 `EXPLORED`
  网格，只拒绝战争黑雾 `UNEXPLORED`。预览与实际落地必须共用
  `FogOfWarSystem.isPolygonFullyExplored` 严格枚举多边形实际覆盖的雾格；检查完整
  菱形占地、4格门全部格、楼梯全部段，以及随建筑生成的外围道路/田地，禁止只检查锚点或使用“任一格可见”
  的 `isAreaVisible` 后让结构伸进黑雾。无迷雾场景保持原放置规则；敌人、掉落物与动态情报仍必须
  `VISIBLE`，本调整只作用于建造门禁。
- **建造门禁缓存**：高频预览只缓存严格多边形门禁结果，键必须包含当前场景、雾网格对象身份、`revision` 与
  完整顶点精确坐标；禁止按锚点、所在雾格或整个 `_canPlace*` 结果缓存，否则会混淆4格门方向、楼梯分段，或
  让单位/建筑占用与地形变化沿用旧结论。缓存必须有容量上限，切换/取消选择时清理，连续建造可在同 revision 复用。
- **模拟边界**：战争迷雾仅是玩家信息层，不得修改 `active`、AI、仇恨、伤害、碰撞、寻路、波次或后台结算。
  遮挡只裁剪视野栅格，墙后敌人仍正常运动和战斗；禁止用隐藏、停更或移除碰撞体代替 LOS。
- **高度感知 LOS**：`FogOcclusionGrid` 复用 `WallSystem.isoSegments` 与建筑 footprint 构建阻挡格，每格保留
  阻挡源和顶部高度；观察者眼高由所处表面高度加单位身体高度计算，视线高于阻挡顶部即可越过。墙顶单位只忽略
  自己脚下的 `_surfaceWall`，不得忽略整段连墙 AABB，否则会把相邻墙体错误变透明。自然地形高度图尚未接入。
- **粗网格与动态失效**：128 像素粗格必须对视野源所在格补一次精确射线，避免同格墙体漏视野；墙段引用、端点、
  高度及建筑结构快照变化时立即重建阻挡网格，并保留 1 秒兜底检查，避免开门、拆墙或建造后沿用陈旧 LOS。
- **城门契约**：`occlusion.gateDoorsBlockVision` 默认为 `false`，标记 `_gateHole` 的门扇无论开关都不阻挡视野；
  门柱与两侧城墙仍按普通墙段阻挡。城门视觉透明不等于移除物理碰撞或改变通行状态。
- **视觉特效边界**：实体状态特效、连接/投射/浮字、持续地面区域、天气技能和环境局部光都必须在视觉层读取
  当前格；隐藏时只暂停显示和新视觉粒子，伤害 tick 与实体组件更新照常执行。可见网格使用双缓冲复用，禁止
  在 100ms 更新循环里 `slice()` 整张 96×64 表。
- **特效接入协议**：普通 `EffectManager` 特效由 `FogVisualAdapter` 自动注册；独立生命周期视觉在构造/销毁时
  显式 `register/unregister`。新特效优先实现 `getFogPosition()`、`getFogVisuals()` 和 `setFogVisible()`，禁止再把
  特效私有字段名追加进 `GameScene`。隐藏/恢复必须记住特效原本的 `visible`，不能在离开视野后强制显示本应隐藏的层。
- **遮罩与小地图**：主画面和小地图共享同一张低分辨率 CanvasTexture；小地图实体点/相机框另画动态层，禁止
  恢复逐格 `Graphics.fillRect`。柔边、探索边界渐变与展开/收缩时长读取 `fog-of-war.json.visual`；这些效果只修改
  遮罩 alpha，逻辑 `VISIBLE` 判定必须保持即时、二值，不能用渐变透明度决定 RTS 是否可选中敌人。
- **存档与世代**：快照只保存压缩后的 `explored` 位图，`visible` 每次进场由友军源重算。记录必须绑定
  `worldEpoch`；位面毁灭、世代重建、新游戏或读档切换要清除旧内存态。旧完整快照缺字段时按“全图已探索、
  当前不可见”兼容，`initializedByPortal` 的新位面基础快照仍从全黑开始。

### 人口经济建筑骨架（2026-08-21）

- **数值真源**：人口、岗位、风车粮食、银行、皇家铸币局与市场参数统一在 `data/population-economy.json`；建筑注册、造价、贴图和外围格类型仍由 `data/producer-buildings.json` 驱动。禁止把容量、岗位上限、产率或汇率复制到面板代码。
- **基础建造费用**：矿工营地和仓鼠草屋各消耗 500 能源；方块墙沿用 C 级防御数值，但每块独立消耗 50 能源，不改变 4 格门的既有造价。房屋基础价仍为 300 金币，通过 `firstWhenNoneCost: 0` 为当前无活动房屋的位面提供首栋免费；建成后恢复基础价，并把实际支付额写入 `_buildCost`，确保免费房屋回收不返金。
- **房屋升级反馈**：等级贴图、显示尺寸、脚点与完成音效路径由 `population-economy.json#house` 驱动，完成反馈只挂在 `_updateHouseUpgrade` 的唯一结算点。产品明确要求全局通知时使用 `SoundManager.playFile(..., 'ui')`，不按玩家与房屋距离衰减；烟尘复用 `BuildingSinkEffect` 同源的 footprint 采样和 `DustEffect` 参数，但必须通过非破坏性的 `BuildingFootprintDustEffect` 播放，禁止为升级创建沉陷特效、使实体失效或释放占地。
- **房屋LV5—LV7跨时代升级（2026-08-25）**：四级小洋楼之后依次进入维多利亚蒸汽住宅、现代公寓和未来生态空中花园塔楼；每一级都必须在`population-economy.json#house.levels`声明独立`technologyUnlockId`、人口容量、升级费用/时长、贴图显示尺寸、脚点和显式`visualFootprint`。七级仍只占标准2×2逻辑footprint，弧形楼板、阳台、雨棚和空中花园只属于视觉体量，不得扩大碰撞、占格或寻路；BootScene、接地拟合清单和单建筑光照派生图必须随新稳定贴图键同步。
- **人口语义**：人口上限只由房屋等级求和；研究院、天气预测塔、风车、银行、皇家铸币局、市场、工坊、位面谐振塔和矿工营地在建筑实例上保存 `assignedWorkers` 数值，通过 `setAssignedWorkers/adjustAssignedWorkers` 占用全位面人口。普通岗位不创建实体；矿工营地是明确例外：每个新增岗位在岗位变更回调内立即物化一名不可选择的经济矿工实体，用于寻路、受击、背包携带与返营提交，但不接受 RTS 指令、不参与主动战斗；只有出口受阻才允许短重试，不能套用死亡补员读条。“矿工增援”只增加岗位容量，不能绕过人口直接生成矿工。
- **军事人口双线路（2026-08-23）**：军事人口容量直接复用本位面房屋人口容量，但单位不写入经济岗位人口，二者只共享上限数值、占用彼此独立。普通草屋、军营、教堂、靶场、骑兵学校及后续普通出兵建筑不得配置建筑级 `unitCap`，每名已出兵单位占1点军事人口；本地、跨位面途中和外派驻军都继续占原生产位面的军事人口。带 `featureWorldId` 的位面特色出兵建筑必须同时检查全局军事人口和自身 `unitCap`，并保存分兵种外派编制；快照恢复已有部队不因临时超额被删除，超额时只暂停新招募。前台、后台结算和右上 HUD 必须读取同一军事人口真源。
- **风车农民视觉**：`HamsterFarmerVisualSystem` 只为当前位面、已有岗位的风车维护 Phaser Sprite，显示数固定不超过 `visualWorkerCap: 4`；“田垄扩建”满级后仍可安排 6 个岗位并按 6 人结算生产，但第 5—6 名农夫不再额外创建精灵。农民在 12 格田地环的相邻格间直线移动，循环 `idle → running → harvesting`；不创建物理体、碰撞体、寻路请求或存档对象。岗位归零、建筑出售/摧毁、位面离场时必须销毁 Sprite，回场按 `min(assignedWorkers, visualWorkerCap)` 重建。
- **生产建筑分层动画（2026-08-22 风车首例）**：主体必须继续使用静态 `spriteCfg.idleKey`，运动部件由 `producer-buildings.json#<building>.animation` 配置为独立 overlay spritesheet；BootScene 加载并注册动画，中立建筑渲染链让 overlay 跟随主体的位置、尺寸、镜像、深度、雾可见性和销毁生命周期。主体与运动部件同源时应使用同一帧画布、原点和显示规格实现天然轴心重合；异源时必须分别测量主体转轴帽中心和运动部件源轴心，把运动部件轴心重排到自身帧中心，再用独立 `displayW/displayH` 保持既有视觉大小，并通过 `offsetX/offsetY` 把 overlay 帧中心精确放到主体轴承的世界位置。主体轴帽原像素应作为 overlay 前景遮挡，使扇叶根部位于轴帽后方。禁止为对轴强制统一主体与运动部件尺寸、按画布中心猜测轴心、用整栋动画贴图覆盖静态主体，或用后处理后的整栋合成帧修正位置。相邻 3D 关键帧可通过双向半角变换与预乘 alpha 混合补帧，但帧数和帧率必须等比例增加以维持循环时长；详情面板继续读取独立 `panelKey`，逻辑占格、建造预览和静态缩略图不变。需要随降雨档位变速的运动层只在自身 `animation.weatherSpeedMultiplierByIntensity` 声明 `clear/light/moderate/heavy/storm` 倍率，中立建筑渲染链读取当前帧 `WorldWeatherSystem` 状态设置该 Sprite 的 `anims.timeScale`；天气结束必须回落到 `clear`，不得读取纯视觉雨粒子系统或另建天气计时器，也不得影响未声明映射的普通风车。
- **复合运动建筑定稿边界（风力电站）**：建筑面板使用完整静态 `panelKey`，场景主体使用去叶轮的 `idleKey`，独立叶轮只由 `animation.textureKey` 驱动；三者不得互相覆盖或复用错误画布。人工修正主体时只更新主体图及其 runtime metadata，叶轮源帧、轴心、`offsetX/offsetY` 和建筑逻辑占格保持不变；叶轮必须继续作为可独立旋转、可随雾/镜像/销毁同步的 overlay，而不能烘焙回主体。
- **建筑亮窗系统已取消（2026-08-24）**：静态排查确认原系统会在启动时统一预载 15 张蒙版，按 RGBA8 解压约占 109 MiB，其中草屋与骑兵学校两张接近 4K；每栋可见建筑还会常驻一个 ADD Sprite 并逐帧同步。现已删除 `producer-buildings.json#windowGlow`、BootScene 预载、中立建筑亮窗 Sprite 的创建/更新/深度/迷雾/压平/销毁链及蒙版生成工具和资源。后续不得恢复通用常驻建筑亮窗；确有必要的反馈只能做小范围、按业务工作态启停、无整幅大纹理的 `workingEffect`，例如位面谐振塔晶尖效果。
- **风车田地**：风车中心固定标准 2×2，外围复用 `BuildingRoadSystem` 的 4×4 预约与 12 格生命周期，但 tile kind 为 `field`。田地不算道路、不提供移动加成，并在风车拆除/摧毁时删除，不能转成可退款手铺道路。
- **建造前置**：所有带 `economyType` 的经济建筑（含房屋、麦田风车、银行、皇家铸币局、市场）都要求当前位面至少有一座活动仓库；仓库自身必须始终可建。建筑卡显示仓库锁定态，选择入口和最终放置入口都要再次权威校验，防止选中后仓库被毁仍能落地。
- **生产与仓储语义**：风车按农夫数生产粮食，当前每名农夫 1.5 粮食/秒、满岗位风车 6 粮食/秒。粮食逐仓写入 `storedFood`，与 `storedEnergy` 共享 `storageCapacity`；满仓时未入库产量留在本栋整数余量中等待空间，不得写入脱离仓库的全局库存。所有军事出兵从同一位面仓库扣粮，恢复快照中已有单位不收费；银行逐栋统计服务半径内存活房屋的当前等级人口容量，并按该房屋同时被多少座活动银行覆盖折算：1 家 100%、2 家 67%、3 家及以上 0%。单轮金币 = 折算有效服务人口 × 每人金币比例 × 上岗职员数 × 全局人口效率 × 最强工坊增效，并按本栋金融工具决定的周期离散结算；重叠只惩罚实际重叠区域内的房屋，非重叠房屋保持原收益，前台与后台必须读取 `population-economy.json#bank` 的同一参数。所有产金建筑的金币固定路由为玩家背包 → 主人空间 `WarehouseSystem` → 产出建筑坐标的金币掉落。金币在背包与主人空间仓库中分别执行单格无限堆叠：同一容器始终只保留一个金币格，拾取、产金、手动存取和旧档恢复都必须合并到该格；禁止重新引入999/99999分堆上限或允许拆分金币。背包和主人空间仓库必须提供“实际存入数量”接口，禁止用布尔返回猜测溢出量；主人空间仓库物品必须随主存档序列化，否则转存金币会在读档后丢失。当已分配岗位超过现有人口容量时，所有岗位统一按 `capacity / used` 比例降效，不强制清空玩家调度。
- **风车本栋升级与产量公式（2026-08-24，2026-08-28天气扩展）**：`wheat_windmill_economy` 提供“精选麦种、风帆传动、田垄扩建、轮作农法”四项本栋升级。满级分别把单人基础产量从 1.5 提升到 2.0、传动倍率从 1.0 提升到 1.2、岗位从 4 提升到 6、田地产量倍率从 1.0 提升到 1.25；原生满级满员产量固定为 `6 × 2.0 × 1.2 × 1.25 = 18 粮食/秒`，再统一乘人口效率、范围内最强工坊增效、酒馆倍率、粮食天气倍率与祭品生产倍率。详情面板的“满员配置产量”不包含这些外部倍率，实际产量必须显示当前粮食天气名称和倍率。`windmillModules / windmillUpgrade` 进入建筑快照，后台位面必须用同一公式推进升级与产粮；旧档缺字段时按四项 Lv.0 恢复为原4岗位、6粮食/秒。
- **研究所全局/本栋边界（2026-08-23，2026-08-24 拆分）**：研究所保留稳定配置键 `research_institute`，通过 `economyType:"research"` 进入经济建筑分类。`research_structure_hp / research_passive_energy / research_recruit_speed` 三项仍由全局能力表保存，一次升级对所有位面共同生效；塔楼 LV1→LV3、`research_staff` 扩编研究员和 `research_base_points` 精密设备改为每座建筑各自保存，详情面板必须分成“本栋研究所升级”和“全局通用研究”两块，禁止再让本栋岗位/设备等级扩散到后续新建研究所。旧档中的两项全局本栋等级只在恢复时一次性复制给旧档已有的每座研究所，并转存为 `researchModules / researchUpgrade`；新建研究所从 Lv.0 模块开始。
- **研究所科研点与数量上限（2026-08-26 多位面重平衡）**：LV1/LV2/LV3 本栋基础科研分别为 1/1.25/1.5 点/秒，后两级必须由“制度化科研/高塔学府”解锁；精密设备每级 +0.05、满级 +0.5，因此满配三级研究所固定为 2 点/秒。初始 6 个研究员岗位，每人发挥 10%，未上岗时严格为 0，初始满编发挥 60%，两级本栋扩编后容量依次为 8/10 人并发挥 80%/100%。本栋原始速度 =（等级基础科研 + 精密设备加成）× `min(1, 上岗研究员 × 10%)` × 全局人口效率 × 最强经济工坊增效 × 酒馆倍率 × 祭品生产倍率；所有前台/后台位面先由 `WorldSimDriver` 汇总原始速度，再通过 `TechnologySystem.getEffectiveResearchRate()` 使用12点/秒全效阈值、超额部分20%效率和36点/秒硬上限，只推进一次全局科技树。科技面板必须同时显示有效与原始速度。每个位面研究所上限保持基础1座、“制度化科研”2座、“高塔学府”3座；旧版 `research_institute_capacity` 只隐藏保留为旧档已投入等级的兼容上限。
- **科技科研成本曲线（v19）**：`technology-tree.json` 中各节点继续保存便于设计的基础 `researchCost`，运行时统一按 `researchCostCurve` 折算并按10点向上取整：基础成本 `<150` 保持1倍、`150—299` 为1.5倍、`300—499` 为2倍、`500—749` 为3倍、`>=750` 为4.5倍，位面专项科技统一4倍。禁止在面板、结算或单个节点另写倍率；旧档未完成科技必须按“旧进度/基础成本”的完成百分比迁移到新成本，已完成科技不得回锁。
- **五级科研建筑（v30）**：稳定序列固定为“研究所 → 大学 → 高能实验室 → 位面观测阵列 → 跨位面中枢”，配置中的 `researchTier` 依次为1—5。大学为兼容旧档继续使用稳定配置键 `high_energy_laboratory`；新高能实验室使用独立键 `high_energy_research_laboratory`，禁止把大学旧实例迁移成实验室。二至五级统一使用 `economyType:"advanced_research"` 和每栋 `researchFacility` 配置，不各写结算器；满员基础科研/岗位/造价依次为大学`2.0点/6人/15000能源`、高能实验室`2.5点/8人/19000能源`、位面观测阵列`3.0点/6人/22500能源`、跨位面中枢`4.0点/10人/36000能源`。前三座上位设施每个位面最多1座；高能实验室要求控制2个位面，观测阵列要求3个位面，跨位面中枢要求5个位面且全存档全局唯一。前台和后台必须按同一岗位、人口、工坊、酒馆、集群和祭品乘区计算，再进入全局科研软上限；逻辑footprint与视觉`visualFootprint`继续分离。高能实验室当前沿用旧占位贴图，正式资产可直接覆盖同名路径，不得伪称已完成美术验收。
- **科研产业集群**：集群参数唯一真源为`population-economy.json#researchCluster`。研究院、气象塔和上位科研建筑只统计640px内“已上岗且种类不同”的相邻科研设施，每种提供3%最终科研增效、最多12%；同一`clusterType`无论建多少座都只视为同类且不互相提供层数，空壳建筑不生效。集群只放大各栋原始科研产出，不改变科技成本、岗位数量、气象功能或12点软阈值/36点硬上限；前后台位面、建筑详情与科技面板必须保持同一口径。

- **算力重心数值闭环（2026-08-26）**：`producer-buildings.json#computing_center`只声明4×4建造、贴图、`economyType`和`upgradeProject`；岗位效率与资本反馈率读取`population-economy.json#computing_center`，基础算力、人口模型、液冷能耗和岗位容量读取`building-upgrades.json#computing_center_economy`，禁止在面板或结算分支复制数值。前台与后台统一按`（基础算力 + 位面人口 × 人口模型 + 玩家总金币 × 资本反馈率）× 岗位效率 × 全局人口效率`结算金币，并按同一运行倍率扣当前位面仓库能源；基础6岗、每岗10%，扩编满级10岗，液冷满级把满负荷能耗从140降至100能源/秒。`distributed_computing`门禁建造，`computing_standardization`同时门禁四项升级，升级按钮灰态和扣费入口都必须权威校验。快照必须成对捕获并在`_restoreProducer()`物化时回灌`computingCenterGoldRemainder / computingCenterEnergyRemainder / computingCenterModules / computingCenterUpgrade`，后台只可推进同一模块等级和读条。四项升级正式图标使用`assets/ui/building-upgrades/computing-*.png`，两项科技使用`assets/ui/technology-icons/distributed_computing.png`与`computing_standardization.png`；图片是主显示源，Emoji只作加载失败回退。

#### 科研长期扩展数值合同（2026-08-26）

> 用途：以后新增科技节点、科研建筑、研究院升级或多位面科研增益时，必须先按本节填数和做静态预算。不得只看单座建筑或单项科技，必须同时评估“节点成本—全局有效科研—岗位人口—可控位面数”。

**1. 已确认基线**

- v20共73个科技节点，按`researchCostCurve`折算后总成本为71240点，作为当前约三分之一内容的基线快照；后续节点数变化时应重算快照，不得把71240当成永久常量。
- 当前成本分布为工程14670、军事指挥3040、经济与位面49530、位面独特4000。军事线仅占约4.3%，属于当前内容空缺，不能作为未来分支成本比例。
- v30阶段共98个科技节点，折算后总成本181260点；工程48820、军事指挥60090、经济与位面63710、位面独特8640，分支占比约为26.93%/33.15%/35.15%/4.77%。这是募兵三级仍使用9900点断崖成本时的历史快照。
- v33仍为98个科技节点；募兵二/三级改为1560/4140点后，折算总成本152760点；工程48820、军事指挥31590、经济与位面63710、位面独特8640，分支占比约为31.96%/20.68%/41.71%/5.66%。军事线回到长期预算20%—25%区间，工程和位面独特占比仍需靠后续内容扩展而不是继续抬高现有募兵门槛。
- v40仍为98个科技节点；军事建筑使用纵向时代骨架，黑火药折算1950点并作为五类三级编制共同门槛，靶场已恢复“黑火药→长弓整编→靶场III级”的完整顺序。教堂二、三级保留主教/大主教未来占位，兵营三级以仓鼠特战替换旧动力甲占位并正式开放；这些接线调整均不改变科研成本。折算总成本仍为154450点；工程48820、军事指挥33280、经济与位面63710、位面独特8640，分支占比约为31.61%/21.55%/41.25%/5.59%。
- 当前研究所、气象科研、大学/高能实验室/位面观测阵列/跨位面中枢与3%/类、最多12%的产业集群共同构成科研供给。当前速度曲线为原始科研前12点/秒100%生效、超额部分20%生效、有效科研最高36点/秒。
- “义务教育→高能实验学→位面观测学→跨位面科研协同”在v30的基础成本依次为700/1400/2600/5200，折算成本依次为2100/6300/11700/23400；按对应阶段约6/9/12/18有效科研点每秒估算，单节点约需5.8/11.7/16.3/21.7分钟。以后调整这条路线时必须迁移未完成节点的进度百分比，已完成后段科技的旧档必须补齐新增前置，不能回锁既有建筑权限。

**2. 最终科技树成本预算**

| 内容阶段 | 折算后成本预算 | 累计目标 |
| --- | ---: | ---: |
| 当前前期内容 | 7万—9万 | 7万—9万 |
| 中期新增内容 | 12万—18万 | 19万—27万 |
| 后期/终局新增内容 | 22万—30万 | **41万—57万** |

- “最终约220节点”只是数量预期，不得将现有71240简单乘三。若最终总成本只有213720点，当五至六位面成型后，理论上只需约1.7—2.6小时就能清空整棵科技树，不能承载完整游戏。
- 最终累计成本占比建议：工程20%—25%、军事指挥20%—25%、经济与位面40%—50%、位面独特/终局10%—15%。每次新增一组科技后都应按折算后成本重算分支占比，优先弥补军事与终局内容，不继续放大当前经济线偏重。

**3. 新增科技单项成本标准**

| 科技类型 | 目标折算后成本 | 目标等待感 |
| --- | ---: | --- |
| 普通中期科技 | 1500—5000 | 约2—7分钟 |
| 高级科技 | 5000—15000 | 约4—14分钟 |
| 关键时代门槛 | 15000—25000 | 约7—17分钟 |
| 终局工程/封顶科技 | 25000—40000 | 约12—22分钟 |

- 表内一律指`TechnologySystem.getResearchCost()`得到的折算后成本，不是JSON中的原始`researchCost`。填值时先确定目标折算成本，再根据`researchCostCurve`反算基础值，并按10点向上取整复核。
- 单项科技的等待感应使用该节点实际可触达时的预期有效科研速度计算，而不是用36点封顶速度统一估算。除明确的长线终局工程外，单节点不得设计成超过25分钟纯等待。
- 若节点只是常规数值升级，应使用区间下半部；解锁新建筑、新单位、新位面机制或科研吞吐阶段时，才使用上半部。

**4. 科研吞吐分期标准**

| 阶段 | 全效阈值 | 超额效率 | 有效科研上限 | 实施条件 |
| --- | ---: | ---: | ---: | --- |
| 当前阶段 | 12/秒 | 20% | 36/秒 | v20现行值，立即保持 |
| 中期科研网络 | 16/秒 | 22% | 45/秒 | 中期新增成本至少落地12万，且通过关键科技解锁 |
| 后期跨位面科研 | 20/秒 | 25% | 60/秒 | 后期新增成本至少落地22万，且通过终局科技解锁 |

- 45/60不是预先写死的默认数值；只有对应内容成本与解锁节点同批实现时才可接入。提高吞吐但没有同步增加可研究成本，或只增加成本却不给后期建筑留边际收益，都属于违反本合同。
- 吞吐升档优先做成全局科技能力，前台、后台、暂停科技面板和存档恢复必须共用同一阶段判定；不得只修改`technology-tree.json#researchRateCurve`后让旧档无条件获得后期吞吐。

**5. 新科研建筑填值标准**

- 普通研究院升级后单座满配不得高于2.0点/秒；中后期每位面唯一的专业设施原生满配建议2.5—3.0点/秒、4—8岗位；全存档唯一的枢纽/终局设施建议3.5—4.0点/秒、8—12岗位。
- 任何新建筑若原生满配超过4.0点/秒，必须同时满足“全存档唯一、至少五位面门槛、对应吞吐升档已解锁”，并重做完整时间预算；不允许用多座无上限普通建筑堆原始科研。
- 岗位效率必须线性、可读：无人时严格为0，满岗刚好100%，岗位不能借工坊、酒馆或集群增益突破100%的本栋岗位效率。普通科研核心位面的科研岗位总量建议不超过一座同阶最高房屋容量的70%；承担全局枢纽的位面可放宽到90%，但混合经济仍应需要第二座房屋。
- 每座新科研建筑必须有稳定`clusterType`，但新增种类不得自动提高集群的12%上限。当现有极限配置已达当期有效上限90%时，后续设施应优先提供分支专长、吞吐升档解锁或新机制，不继续只堆全局原始点数。

**6. 新增科技/科研建筑强制检查清单**

1. 先记录新增前的节点数、折算后总成本、四类分支成本占比，再记录新增后的同口径差值。
2. 为每个新节点记录基础`researchCost`、折算后成本、预计可触达时的有效科研速度和预计分钟数；超出本节区间必须给出玩法理由。
3. 复核所有前置ID存在、无环、列/分支可达；解锁的建筑、单位或机制必须已进入`TechnologySystem`的已知目标集，不得用面板隐藏代替业务门禁。
4. 新科研建筑必须同时复核造价、岗位、房屋容量、每位面/全局数量上限、`requiredWorldCount`、集群类型和五至六位面极限原始/有效速度。
5. 前台`PopulationEconomySystem`、后台`world122-sim`、`WorldSimDriver`全局汇总、建筑详情、科技面板和快照恢复必须使用同一数值口径；不得只接当前位面。
6. 每次修改科技图数据都要同步检查`technology-tree.json#version`与`TechnologySystem.VERSION`。仅新增节点时不得重放旧成本迁移；只有成本曲线再次改变时才提高独立的成本迁移版本，旧档未完成科技仍按百分比迁移。
   - **女墙独立解锁（v44）**：工程主链固定为`fortification_engineering → wall_battlement_engineering → wall_tower_engineering → defense_tower_engineering`；`wall_battlement_engineering`基础科研点数为120并独占`building:wall_battlement`解锁，城防工事不再直接开放女墙。v44以前已完成城防工事的旧档必须自动补齐女墙构筑，保留原有建造权限；该迁移只补完成态，不改女墙尺寸、材质等级、放置或塔楼覆盖逻辑。
7. 交付记录必须给出“新总成本、分支占比、典型时间、五/六位面极限速度、单位面科研岗位/房屋容量”五项结论；不得只报“JSON可解析”。分批开发期间的局部预算不能替代收口审计：当计划中的新科技、新科研建筑及其升级全部开发完成后，必须再执行一次覆盖完整科技树、全部科研产出、产业集群、岗位住房和五至六位面极限的全量数值审计，再决定是否调整成本曲线或吞吐阶段。
- **研究院三级视觉真源**：LV1/LV2/LV3 分别使用稳定键 `research_institute`、`research_institute_lv2`、`research_institute_lv3`；三档共用蓝色屋顶、白灰石墙、哥特尖拱、四面裙楼与菱形围柱语言，只通过塔楼高度和细节密度递进，禁止重新抽图造成配色或建筑语法漂移。三档正式源分别锁定 LV1 refine v02、LV2 refine v01、LV3 refine v02；运行时元数据必须继续指向对应 accepted body，模型、Depth、提示词和最小可复现源集按 AI 资产分卷的定稿瘦身规则保留。升级只切换贴图、显示高度、脚点和派生光照图，不改变标准2×2逻辑 footprint、碰撞、道路预约或寻路占格。
- **气象科研汇总口径（2026-08-24；2026-08-26重平衡）**：气象科研每级 +0.25、满级0.75点/秒，与研究院原始速率共同进入 `WorldSimDriver` 的单次全局科技推进和同一科研软阈值，但不计入科技树面板的“研究院数量”。前台读取 `PopulationEconomySystem.getWeatherForecastResearchSnapshot()`，后台读取同一模块等级、1岗位、全局人口效率和最强经济工坊增效；岗位与 `weatherModules` 随快照恢复，禁止只在当前位面加科研或把天气塔数量误显示成研究院数量。
- **位面谐振塔发电口径（2026-08-23）**：`producer-buildings.json#planar_resonator` 只登记结构、6000 能源造价与升级项目，岗位比例读取 `population-economy.json#planar_resonator`，四项本栋等级读取 `building-upgrades.json#planar_resonator_economy`。单轮可入库能源 = 晶核原始产能 × 导能回收率 × `min(1, 上岗技师 × 20%)` × 全局人口效率 × 最强工坊增效 × 生产祭品倍率；基础 10 秒/轮、100 原始能源、80% 回收、2 岗，岗位升级至 5 后满效。未入库整数继续保存在本栋 `_workProductionRemainder`，禁止满仓时丢失或写入脱离仓库的全局能源。建筑由“位面谐振”解锁，四升级共同由后继“谐振校准”解锁；UI 门禁与 `startResonatorUpgrade()` 业务校验必须并存。`resonatorModules`、`resonatorUpgrade`、岗位、周期和余量必须进入快照，`world122-sim` 用同一离散周期公式推进后台发电与升级。
- **风力电站发电口径（2026-08-27调整）**：`producer-buildings.json#wind_power_plant` 登记标准2×2逻辑占格、静态主体/面板/独立叶轮和科技门禁；逻辑 footprint、碰撞与寻路按2×2处理，静态主体换图不得改动已经确认的24帧叶轮图集，只能根据新主体轮毂重新标定 overlay 偏移。岗位参数读取 `population-economy.json#wind_power_plant`，四项本栋升级读取 `building-upgrades.json#wind_power_plant_economy`。发电按固定周期把“基础产能 × 岗位效率 × 全局人口效率 × 最强工坊倍率 × 酒馆倍率 × 全局生产倍率”写入本位面仓库；满仓余量保留在本栋，禁止写入顶层全局能源或跨位面借仓。建筑解锁与升级标准化必须分别由连续两个科技节点控制，UI门禁和业务入口双重校验；岗位、模块、升级读条、生产周期与余量进入建筑快照，当前位面和离场位面复用同一公式，后台不创建叶轮 Sprite。
- **光伏电站发电口径（2026-08-26）**：`producer-buildings.json#solar_power_plant` 登记标准4×4结构、每位面2座上限、`upgradeProject`与`perimeterTile:"road"`；放置预览、黑雾校验、占地预约、正式落地、打包重建和拆除必须共用四周外围道路口径。岗位容量与每人20%效率读取`population-economy.json#solar_power_plant`，追日周期、阵列原始产能、储能转换率和岗位扩编统一读取`building-upgrades.json#solar_power_plant_economy`。基础3岗时为`600 × 90% ÷ 4秒 × 60% = 81能源/秒`，四项满级并扩至5岗时为`800 × 100% ÷ 3秒 = 266.67能源/秒`，再统一乘人口效率、最强工坊、酒馆与全局生产倍率。建筑与四升级分别由`solar_power`、`solar_power_standardization`连续双门禁控制；前台/后台必须复用同一离散周期、满仓余量、岗位、模块和升级读条快照。四张升级图标固定使用256方形冷钢四铆钉徽章，两项科技使用1024六边形冷钢徽章，Emoji仅作加载失败回退。
- **建筑面板经济与募兵归类（2026-08-26）**：经济建筑默认排序固定为仓库、房屋置顶，其后按“农业建筑 → 能源建筑 → 金币建筑 → 科研与功能建筑”分段，并在各段内由低阶到高阶排列；仅玩家主动选择能源排序时临时改用原有能源优先规则。军械库与战地医院属于军事支援，固定进入募兵建筑页。分段标题必须复用冷钢面板字体层级和主题变量，分类只改变标题与排列，不改变科技门禁、费用或建造业务。
- **位面谐振塔晶尖工作特效（2026-08-24）**：`producer-buildings.json#planar_resonator.workingEffect` 以主体贴图归一坐标登记晶体尖端、半径、周期和蓝/青/金色序列；中立建筑渲染链使用一层 `BlendModes.ADD` Graphics 平滑绘制呼吸光晕、闪星与确定性上升光屑。启停只读 `PopulationEconomySystem` 由 `actualEnergyPerSecond > 0` 产生的瞬时 `_economyWorking`，无人上岗、建筑沉没、销毁时必须立即熄灭；特效同步主体最终缩放、镜像、结构深度、地图模式、视口裁剪、战争迷雾与销毁生命周期，不进入实体、占格、碰撞、寻路、阴影或存档，也禁止用逐帧随机造成跳闪。
- **仓库等级、独立升级与容量口径（2026-08-26；2026-08-27 UI补图）**：仓库等级由 `population-economy.json#warehouse.levels` 保存，本栋 `_economyLevel/_economyUpgrade` 负责 LV1—LV5 扩建；基础容量依次为 15000/45000/120000/300000/750000。`warehouse_logistics` 仍独立保存每栋 `warehouseModules/warehouseUpgrade`，最终物理容量固定为“当前等级基础容量 + 立体货架固定附加值”，禁止等级扩建重置旧模块、把货架倍率乘到等级容量或把两条成长线互相覆盖。能源与粮食压缩分别改变对应资源占用系数，因此共享占用必须按 `storedEnergy × energyFactor + storedFood × foodFactor` 计算；压缩只能释放容量，不能修改或凭空增加库存。前台入库/满仓/面板、后台快照和跨位面退款必须复用同一等级加货架公式；详情面板的“仓储容量”显示当前选中仓库压缩后物理占用率，“位面总容量”显示当前位面全部活动仓库总占用率。等级扩建卡固定使用 `assets/ui/building-upgrades/warehouse-level-expansion.png` 表达建筑向上扩建，`warehouse-capacity.png` 继续只用于立体货架容量项目，Emoji 仅作图片加载失败回退。LV2—LV5 使用稳定独立纹理键，替换贴图不得改变标准2×2逻辑 footprint、碰撞、道路预约或寻路占格。
- **跨位面资源协议**：消费发生的当前位面有活动仓库时，建造、出兵和升级只按本地库存与原价结算；当前位面无仓库、其他位面存在仓库网络时才进入跨位面事务，Lv.0 统一额外消耗 50%，`warehouse_cross_plane` 每级降低 5%，Lv.10 为 0%，多座远端仓库取最高协议等级。报价、可支付检查、实际扣除与失败回滚必须由同一事务给出，禁止 UI 显示基础价而扣除跨位面价；市场兑换、生产入库、出售退款和维修不套用该协议。远端能源/粮食必须直接扣对应位面快照逐仓库存，不能在当前位面创建虚假仓库或脱离仓库存成全局资源。
- **经济岗位第二进度条真源**：研究院、天气预测塔、工坊、市场、风车、位面谐振塔、深钻井、银行、皇家铸币局和大商场必须显示稳定的业务发挥率，禁止绑定共享 `_economyTickMs` 或循环结算余数。研究院、气象科研、风车与谐振塔取当前实际/配置产出，天气塔无气象科研时显示岗位监测；市场显示有效商人人效，工坊显示实际/配置增效；银行、大商场显示稳定收益效率和真实金币/秒，皇家铸币局显示稳定铸币效率以及金币/能源/食物每秒速率，资源不足时归零但业务层仍只保留一个就绪批次。单一物流状态机的面包屋和酒馆可以显示当前阶段进度，但标题必须随取货、返程、加工、送仓或服务切换；多锅炉工并行的蒸汽电站不得汇总最大任务进度，统一显示稳定运行效率。矿工营地不再伪造矿工就绪条；其岗位增减与出口阻塞由岗位条和状态提示表达。
- **市场语义**：市场是解决短期资源短缺的应急流动性，不是套利或资源增殖系统。市场至少需要配置数量的商人才能交易；报价必须满足“买入金币成本 ≥ 基准价 × (1 + `minimumTradeLossRate`)”“卖出金币收入 ≤ 基准价 × (1 - `minimumTradeLossRate`)”，压力和动态 spread 只能让当前方向的价格继续恶化，不能穿透固定亏损底线。商人可缩小动态 spread 并略微加快压力回归，但不能降低固定损耗；交易按钮必须显示按整数金币舍入后的真实扣款，而不是预算上限。交易前同时验证付出资源与目标仓储容量，失败时回滚；同一前台位面的市场继续共享交易压力，后台使用相同的配置恢复速度。
- **多位面边界**：离场位面只在快照中结算房屋读条、风车粮食、位面谐振塔能源、银行/皇家铸币局金币和市场压力衰减，不创建精灵、不寻路、不逐平民更新。房屋等级、升级读条、岗位数、生产余量与市场压力属于建筑实例字段；粮食和谐振能源随仓库结构逐仓保存，顶层 `populationEconomy` 只保留版本/迁移元数据。后台产金建筑若背包与主人空间仓库均满，把溢出量记在对应建筑的 `pendingGoldDrop`，回场物化后在其坐标生成掉落，禁止在错误位面提前创建实体。
- **经济工坊真源**：工坊数值仍由 `population-economy.json#workshop` 与 `building-upgrades.json#economic_workshop` 驱动；四项等级保存在建筑实例 `modules`，使用独立 `_workshopUpgrade` 读条，不得写入全局兵种模块或能力等级。默认等级是 0，数值为范围 1200px、配置效率 10%、维修 5% 最大生命/秒、工程师 2 名；升级上限分别为 10/10/10/3。
- **无人岗位统一提示（2026-08-24）**：所有当前岗位容量大于0、但 `_assignedWorkers===0` 的人口经济建筑，通过 `PopulationEconomySystem.isWorkforceUnstaffed()` 使用同一判定；矿工营地与配置型经济建筑不得各写分支，房屋、仓库及没有有效岗位的建筑不得误显示。表现层由 `GameScene` 运行时绘制透明中心的红色禁止环和斜杠，按建筑稳定ID错相缓慢旋转并轻微呼吸，不创建贴图、粒子、Tween、独立计时器或存档字段。标识必须跟随视口裁切、战争迷雾、地图模式、压平模式、出售/摧毁沉陷与场景清理；安排任意1名人员后当帧隐藏，重新归零后当帧恢复。
- **工坊增效口径**：实际增效 = 配置效率 × `上岗工程师数量 × 20%`，上限为配置效率；容量 2 但只安排 1 人时只得到 2% 默认增效，5 名满员得到 100% 配置效果。光环只作用于有产出/交易岗位的经济建筑，房屋与工坊不受益；多栋工坊覆盖同一建筑时只取最强值，不叠加。
- **工程师维修与视觉口径**：工程师容量由 `workshop_engineers` 升级决定，只有 `assignedWorkers` 对应的上岗人口才由 `WorkshopEconomySystem` 维护为纯 Phaser Sprite/逻辑记录；不进入 `Game.entities`、碰撞、物理或寻路。空闲时在工坊 300px 内循环 `idle/running` 随机移动，接单途中使用 `running`，抵达受损建筑后持续使用 `fixing`。每名工程师一次只认领一个受损 `_isDefenseStructure`，目标之间不得重复认领；直线抵达目标维修点后才按最大生命百分比免费恢复。工坊范围出现 `enemy/agent` 时释放全部目标、返岗并停止维修，敌情消失后再重新分派；岗位归零、建筑出售/摧毁或位面离场必须销毁 Sprite。
- **军械库减耗与整理口径（2026-08-23）**：军械库由 `population-economy.json#armory`、`building-upgrades.json#armory_economy` 与 `ArmoryEconomySystem` 驱动，属于仓库前置的标准2×2经济建筑，不产兵。基础服务半径600px、满员减耗10%、维护师岗位2个；实际效果 = 配置值 × `上岗维护师数量 × 20%`，5名满效，多栋军械库覆盖同一出兵建筑时只取最强减耗。装备护理/服务范围/资源整理/增加人员是每栋独立等级，统一由“军需标准化”科技门禁；资源整理未升级时即有1%满员分钟概率，每次升级+1%，按模块Lv.0起算经过9次升级后满级10%，强化石自动堆叠进主神空间仓库，满仓时数量保存在本栋快照。前台报价、实际扣粮、后台位面招募必须读取同一减耗倍率并按整数向上取整，禁止只改面板价格或只改当前位面。
- **军械库维护师视觉口径（2026-08-23）**：`ArmoryMaintainerVisualSystem` 只按本栋当前上岗人数物化纯视觉维护师，动作与体量读取 `population-economy.json#armory.workerVisual`。空闲时在本栋当前服务半径内切换 idle/walking 并随机活动，定期从同一范围内选择未被其他维护师认领的活动建筑，贴近建筑外缘后循环 maintenance，再释放目标继续巡检。每段移动统一按“直线路程 ÷ 当前速度 + `moveGraceMs`”设置防卡死计时；巡游超时放弃目的地重新待机，赴维护目标超时则从当前位置完成本次维护动画并释放认领，禁止永久占住目标。维护动画不回血、不额外修改减耗或资源整理概率；岗位归零、建筑出售/摧毁、位面离场与系统重置必须通过通用平民淡出入口清理。维护师不进入实体、战斗、物理、寻路或独立存档链，移动与遮挡统一复用 `civilian-visual-utils` 的轻量占用和脚线深度。
- **纯视觉平民通用生命周期**：农民、工程师、银行家及以后新增的岗位平民统一通过 `civilian-visual-utils.js` 注册；岗位减少、建筑出售/摧毁、位面离场或系统重置时必须先从平民目标池注销，再按 `population-economy.json#civilianVisual.fadeOutDurationMs` 淡出并销毁 Sprite，禁止各系统直接 `sprite.destroy()`。平民始终不进入 `Game.entities` / `Game.friendlyUnits`，不创建物理体、碰撞体、寻路请求或独立存档对象。
- **房屋居民周边活动与道路接入（2026-08-25；2026-08-27）**：房屋继续按稳定建筑标识派生配置数量的纯视觉居民；标准 2×2 房屋落地时通过 `perimeterTile:"road"` 自动预约并生成外围 12 格道路，升级到 Lv.2—Lv.7 时沿用同一建筑实例与道路归属，不重复铺设。居民从当前脚点经轻量建筑/墙门扫掠寻找道路入口，进入后绑定该入口所属四向道路连通分量并只在该分量内复用BFS路线随机活动，允许离开原房屋周边范围。若旧快照或异常恢复暂时没有道路，仍在 `residentVisual.localActivityRadius` 内从房屋外缘生成、待机和随机漫步；道路/墙门拓扑变化时只按版本重绑当前道路格，道路消失或当前分量不再与房屋探测入口相连时退回周边活动。离路接入不创建通用AI、PathManager、实体、物理体或存档；入口被建筑/墙门阻挡时轮换有限候选并错峰重试，禁止逐帧全图寻路。
- **面包屋离散搬运生产（2026-08-23；2026-08-25 道路路线复用）**：`producer-buildings.json#bakery` 只登记结构/贴图/造价，岗位与基础批次参数读取 `population-economy.json#bakery`，四项本栋等级与费用读取 `building-upgrades.json#bakery_economy`。每栋固定 1 名面包师，按“到指定仓库取 50 粮食 → 回面包屋加工 → 把整批成品送回有容量仓库”推进；取粮与交货必须调用 `EnergyManager` 的指定仓库事务，仓库不足、被毁或满仓时等待，禁止用全局粮食加减伪造搬运行程。面包师业务记录挂在建筑上并随建筑快照保存，但不进入实体/物理/战斗或通用 AI/PathManager；Sprite 只读取这条记录的位置和阶段，并注册到通用平民视觉入口。连接仓库后复用 `BuildingRoadSystem` 按道路/墙门版本缓存的 BFS 规范路线，取货/交货正向消费、返店反向消费，每帧只推进航点；派生路线不进快照，只在读档、目标仓库或拓扑变化时从当前道路格重算。服务半径只在道路航点走完后接受交互；当前脚点因断路落入孤立分量时冻结原阶段，重新连通后续走，禁止隔空完成或传送。
- **面包师视觉阶段映射（2026-08-23）**：`HamsterBakerVisualSystem` 只能读取 `_bakeryJob`，不得反向推进经济阶段或另存坐标；`idle` 显示待机，`to_pickup/to_bakery` 播放未装载奔跑，`processing` 必须把 Sprite 退出可见平民集合并隐藏，`waiting_deposit/to_deposit` 播放抱面包奔跑。三组动作统一走 `population-economy.json#bakery.workerVisual`、`worker_` 动画前缀、`applyCivilianAnimSize` 和通用平民注册/销毁入口；岗位归零、出售、摧毁、离场与系统重置都必须清除视觉记录。视频截取要保留透明联系图/GIF与逐格 Alpha 报告，循环帧数等于有效内容帧，禁止把转场、触边帧或网格空格注册进动画；跑步必须先确认完整左右脚双步相位，不能为了压低像素接缝而截成只有一次抬腿的短片段。
- **面包屋升级与祭品边界**：基础处理 10 秒、产出 5 倍、植物祭品 1%、移速 80px/s；快速烹饪/美食家/食材处理/小步快跑每级分别 `-0.5s / +0.5倍 / +0.2pp / +5%`，均为 10 级本栋升级。建筑由“面包烘焙”科技解锁，四升级共同由后继“烘焙工艺”解锁，UI 隐藏/禁用与 `BakeryEconomySystem.startUpgrade()` 业务校验必须同时存在。祭品只从既有植物祭品 ID 池抽取，直接进入主神空间 `WarehouseSystem`；满仓时在建筑/后台快照保留待入库 ID，不能掉落到错误位面或静默丢弃。后台只做同参数的距离+处理周期聚合、粮食仓储和概率结算，不创建面包师 Sprite。
- **蒸汽电站食物换能源与双锅炉工道路物流（2026-08-25）**：结构、建造上限与科技门禁登记在 `producer-buildings.json#steam_power_plant`，输入量、处理时长、基础产出、移动速度和初始 2 个锅炉工岗位读取 `population-economy.json#steam_power_plant`，四项本栋升级读取 `building-upgrades.json#steam_power_plant_economy`。每名锅炉工只维护纯数据业务状态 `idle → to_pickup → to_plant → processing → waiting_deposit/to_deposit`：抵达指定可达仓库时才扣粮，回到电站后才开始加工，完成后把能源送入可达且有容量的仓库。工作资格与面包屋一致：蒸汽电站外围接入道路且同一道路网络能 BFS 到至少一座活动仓库时，`roadConnected` 才为真；前台与后台位面都必须在该门禁后推进运输和加工。断路时冻结阶段、脚点、携粮、待存能源和加工计时，不退款、不重复扣粮或产能，恢复连接后从当前道路格续算，派生路线不进存档。
- **蒸汽电站前后台与视觉同源**：快照必须保留本栋模块/升级、岗位、每名锅炉工的阶段与位置、目标仓库、携粮、待存能源、处理剩余时间、完成批次和小数余量；后台从建筑、道路与墙门快照重建同一连通拓扑，不创建精灵，并按“基础产出 × 人口效率 × 最强工坊倍率 × 酒馆加权倍率 × 全局生产倍率”结算，保留小数余量。视觉只能投影业务状态：`idle/processing` 待机、`to_pickup` 空手奔跑、`to_plant` 抱食物奔跑、`to_deposit` 抱能量块奔跑、`waiting_deposit` 定格持能量块；坐标未变化或道路冻结时不得原地跑。锅炉工移动只能逐格消费 BFS 道路航点，路线末端未进入服务半径时重算路线而不是直线穿楼补点，返回后停留在电站道路接入点加工；道路路线已负责避开建筑主体，因此沿有效路线移动时与面包师一致使用 `structures:[]`，Sprite 登记为 `civilianCollisionMode:'walls_only'`，只保留墙门扫掠，避免外围道路贴近建筑 footprint 时被二次推出并卡死。四组素材必须按逐帧 Alpha 中位主体高度和共同脚线分别配置 `scale/footRatio`：当前 `displaySize:91.6`，待机/空手奔跑/抱食物奔跑/抱能量块奔跑分别使用 `1 / 0.977578 / 0.990909 / 0.990909`，统一约 78px 可见高度，不得回退为按帧格机械照抄 128。全局关闭非战斗居民动画只卸载锅炉工精灵/动画/纹理，生产、岗位与物流继续推进。

- **深钻井范围采掘与前后台同源（2026-08-25）**：`producer-buildings.json#deep_drill` 只登记结构、矿脉覆盖标记及 `perimeterTile:"none"`；建造预览、正式放置和快照恢复都不得自动生成外围道路，只保留中央标准2×2逻辑占格。
  4个初始岗位、600px范围、结算周期和单人基础采速读取 `population-economy.json#deep_drill`。前台按由近到远调用
  `EnergyNode.takeDamage()` 的标准采集入口真实扣减矿脉储量，并通过玩家阵营建筑直接入仓；最终入仓量统一为
  `原始采掘 × 人口效率 × 最强工坊倍率 × 酒馆倍率 × 全局生产倍率`，增效只放大产出，不额外消耗矿脉。
  无岗位、范围内无活矿、无仓库、满仓或最终倍率为0时必须停机且不得扣矿。`deepDrillTickMs`、小数余量与累计入仓量
  随建筑快照保存；后台只按建筑坐标开采600px内的快照矿点，受矿脉余量和真实仓容共同封顶，采空后永久枯竭。
  仓容换算原始采掘上限时要允许最终 `floor(raw × multiplier)` 正好装入剩余容量，禁止直接向下取整
  `free / multiplier` 导致少量仓容被误判不可用。面板第二进度条与“实际入仓效率”必须在阻断态归零，最近一次结算值
  保持到下次结算，不得每帧清空造成状态闪烁。

- **三层酒馆道路物流与全位面最终产出乘算（2026-08-25）**：酒馆是“经济工程”的上位单体2×2经济建筑，每个位面最多1座，固定1个酒保岗位。酒保业务状态唯一口径为`idle → to_pickup → to_tavern → serving`：到指定可达仓库时一次扣除本批粮食，抱粮返店后才开启服务；运输阶段断路保存当前位置、目标仓库、携粮和阶段，拓扑恢复后从当前道路格重算派生路线，服务阶段断路不取消已送达宴饮。撤岗冻结任务并立即停效，重新上岗续作；拆除/摧毁清理任务且已取粮不返还。Sprite只投影任务并严格使用`idle/empty_running/food_loaded_running`三态，不进入实体、物理、战斗、通用AI或独立存档，关闭居民动画只卸载视觉。
- **酒馆倍率白名单与前后台同源**：`TavernEconomySystem.getPlaneOutputMultiplier(economyType)`只对白名单`windmill/bakery/miner_camp/deep_drill/steam_power_plant/planar_resonator/bank/royal_mint/research/weather_forecast`返回有效服务中的最强酒馆倍率；异常旧档多酒馆不叠加。统一顺序是`基础产出 × 人口效率 × 工坊倍率 × 酒馆倍率 × 全局生产倍率`，市场、医院、军械库、住房、工坊和酒馆自身恒为1；不得改处理速度、输入成本、市场压力/价格、祭品概率或服务范围。矿工与深钻井都只放大最终入仓量，不能增加矿脉消耗；面包屋、蒸汽电站、矿工及连续资源都保留小数余数。后台快照保存`tavernModules/tavernUpgrade/tavernJob`以及阶段、位置、目标、携粮、服务/运输剩余时间和批次数，不保存路线；按本段离线时间内的实际`serving`毫秒加权倍率，并保持原输入批次数不变。
- **银行家视觉口径**：只有银行实际安排岗位时，`HamsterBankerVisualSystem` 才按 `min(assignedWorkers, visualWorkerCap)` 维护纯视觉银行家。银行家从通用平民注册表全图随机选择非银行家目标，直线移动时播放 `running`，抵达目标 50~80px 后面向目标完整播放一次 `speeching`，随后进入配置化随机 CD；无可用目标或 CD 期间只在银行附近随机移动并播放 `idle/running`。目标销毁时立即释放占用并返岗，多名银行家不得同时占用同一交谈目标。
- **银行四项本栋升级**：`bank_economy` 的金融工具、扩容人员、印钞机、服务辐射分别控制结算速度（每级 +5%，10 级）、职员上限（初始 1，每级 +1，2 级）、每名服务人口每轮金币（初始 10%，每级 +5%，10 级）和服务半径（初始 600px，每级 +50px，10 级）。等级保存在 `bankModules`，使用独立 `bankUpgrade` 读条；后台位面必须继续推进读条并按同一房屋范围公式结算。
- **皇家铸币局上位产金（2026-08-24）**：`royal_mint` 是“信用金融 → 主权铸币”之后解锁的标准2×2经济建筑，每个位面由 `buildLimit:1` 权威限制一座；当前正式美术未定稿时只允许复用银行贴图作功能占位，候选不得提前进入运行资源。它不读取房屋覆盖、不参与银行重叠衰减，而是按“上岗铸币工 × 单人单批金币 × 人口效率 × 最强工坊增效”离散产金，并从本位面仓库同时扣除“上岗铸币工 × 单人单批能源 × 人口效率”的能源与“上岗铸币工 × 60”的固定食物；任一资源不足时批次停在就绪态，禁止跨位面借用资源或继续累计无限批次。基础2岗、4金币/人/批、30能源/人/批、60食物/人/批、10秒/批，满基础岗位为0.8金币/秒、6能源/秒与12食物/秒；精密币模、自动冲压、能源熔铸、财政编制满级后达到4岗、8金币/人/批、20能源/人/批、60食物/人/批、约6.67秒/批，即4.8金币/秒、12能源/秒与约36食物/秒（外部增效前）。人口超额只降低金币与能源口径，固定岗位食物成本不变；四项升级由“铸币标准化”统一门禁并保存为 `mintModules / mintUpgrade`，小数金币保存在 `mintGoldRemainder`；前台、后台和详情面板必须使用同一批次公式。
- **覆盖圈与后台边界**：打开工坊或银行建筑详情时绘制按 `PERSPECTIVE_SCALE_Y` 压缩的覆盖椭圆，范围升级后实时重绘，关闭/出售/摧毁/离场必须销毁。后台位面不物化工程师或银行家；工坊只在已确认无敌的 prep/break 时间窗保存抽象目标与剩余行程，银行按房屋坐标、等级容量、岗位、升级周期与余数离散结算；经济增效继续按坐标范围与最强光环结算。

---

