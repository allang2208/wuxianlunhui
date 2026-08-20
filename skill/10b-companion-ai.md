> 本文件为 game-dev 技能库分卷，主索引与目录见 ../SKILL.md
> 本节：侍从战斗 AI（CompanionAI，2026-08-14，远程法师露娜）

## 侍从战斗 AI（CompanionAI，2026-08-14，远程法师露娜）

- **城墙高架远程统一（2026-08-20）**：露娜技能/普通光球、仓鼠牧师圣光、射手、斥候与
  火枪手均按`wall_walk`获得1.2倍最大射程，并在决策与释放时使用带Z的统一LOS。
  牧师不得继续裸读`castRange`或依赖`triggerOn`无门禁；Bolt投射物射程必须在出膛时快照。
  墙顶增益不扩大闪电/圣光`aimRadius`或闪电`chainRange`。

- **伊莉丝普攻命中（2026-08-16）**：`_dealMeleeHit` 追加眩晕 + 击退——`attackStunMs`
  （默认 1000，与玩家近战一段同口径，仅普通怪 rank 缺省 normal）+ `attackKnockback`
  （默认 50，径向，全类型）；配置在 `data/companion-config.json` warrior_bruno ai 块，
  契约断言在 `scripts/test-party-system.mjs`。
- **架构**：`src/ai/companion-ai-decision.js`（零依赖纯函数：`decideCompanionAction`
  状态机 + `pickCompanionSpell` 技能选择，可单测）→ `src/ai/companion-ai.js`
  （CompanionAI 运行时：决策 tick 120ms + 每帧移动/施法推进）。
  状态机：`idle → follow → advance → cast → flee`（优先级：施法站定 > 近战威胁贴脸
  flee > 射程内施法 > 推进站位 > 跟随 > idle）。
- **挂载**：PartySystem 只存 AI 工厂注册表（`registerAI(id, factory)` +
  `updateCombat(dt, entities, player)`），**不静态 import companion-ai.js**（其依赖链
  带 JSON import，node 单测会挂）；Game.js 启动时注册 mage_luna 工厂，主循环在实体
  update 后调用 updateCombat。companion-config.json 的 `ai` 字段配置
  followOffset/combatRange/safeDistance/castFrozenMs 等。
- **移动复用 MovementSystem**：companion 补战斗字段（active/x/y/vx/vy/maxSpeed/
  groundRadius/_faction='companion'）。MovementSystem 2026-08-14 起支持
  `_tacticalTarget` 作为寻路目标（moveGoal = 战术目标优先，其次攻击目标）——露娜的
  跟随点/施法站位/撤退点都是 _tacticalTarget，路径朝战术点生成而非敌人。
- **敌我判定安全**：BoltSkillSystem._isHostile 与 LightningStrikeSystem 改为阵营分组
  （player/companion 互为友军、只敌视 enemy；enemy 敌视一切非 enemy）——露娜
  _faction='companion'，火球/闪电不会误伤玩家。怪物 PerceptionSystem 只选 player
  目标，露娜不会被仇恨（纯远程输出）。
- **技能复用玩家系统**：露娜构造 FireballSystem/IceSpikeSystem/LightningStrikeSystem/
  HolyLightSystem；**BoltSkillSystem 非玩家需二次 trigger**（第一次凝聚、第二次发射）；
  施法射程从 skills.json effectFormula 读 maxRange（通常缺省）→ AI 用
  SKILL_RANGE_FALLBACK（火球 1200/冰锥 800/闪电 600）兜底；MP 消耗由 AI 自行扣除
  （非玩家系统不扣）。技能优先级：闪电（群控）> 火球（群伤）> 冰锥（单体）。
- **远程后排策略**：目标只在 combatRange×1.3 内选择（不跨图追残血）；近战威胁
  （attackRange<220 且无 ranged）进入 safeDistance → flee（撤退点=背离威胁+朝玩家）；
  施法站定 _frozenForCast 锁定移动并保持 spell 动画。寻路跟随点=玩家左后
  followOffset。
- **渲染**：GameScene._syncCompanionSprites 按 `member.aiConfig` 分叉——AI 队员位置
  用 member.x/y、动画按 member._animState（spell/run/walk/idle，idle=奔跑首帧）；
  无 AI 队员保持原玩家状态驱动逻辑。
- **验证**：单测 116/116（含 12 条决策/技能选择纯函数）；CDP `tools/cdp-luna-ai.mjs`
  （跟随/施法命中 46 伤害/不误伤玩家/撤退 60→224px）与 `tools/cdp-luna-anim.mjs`
  （AI 驱动：idle 奔跑首帧、follow walk 循环、cast spell、flee run 循环质心 0px）。
- **已知限制**：圣光（10 级解锁）暂未接入 AI（holyLight 敌我判定按同阵营治疗，需
  友军分组改造后启用）；露娜不会被怪物仇恨；撤退为战术点寻路（地牢空旷场景可用）。
- **生成位置三保险（2026-08-14 二修）**：① 初始/场景切换生成用 `_findValidSpawn`
  （跟随点优先 → 8 方向螺旋外扩 → `WallSystem.canMoveTo` 校验 → `findSafeSpawn` →
  玩家脚下兜底），不再裸偏移导致生成进墙；② 场景切换检测（`SceneManager.currentScene`
  变化 → 清路径/target → 重新找落点）；③ 每 1.5s 卡墙自愈——当前位置 canMoveTo 为
  false（卡进墙）或**离玩家 >1200px**（墙外无墙空地 canMoveTo 仍为 true，但寻路不
  连通）或路径反复失败（stuckCount≥3）→ 拉回玩家附近合法点。另修：advance 站位点
  离玩家 >followOffset×3.3 不追（远程后排不追远目标，避免在地牢跑丢/卡墙外）。
  探针 `tools/cdp-luna-dungeon-spawn.mjs` 用主实例 `ExpeditionSystem.depart()`
  真实进地牢（**勿用 Runtime.evaluate 动态 import 模块——会创建平行实例**）：露娜
  生成在玩家 ~200px 内、canMoveTo 合法、能移动/撤退/战斗输出。
- **队友防卡死瞬移（2026-08-14 三修，仅作用于队员）**：MovementSystem 的
  GATE-WAIT 面向怪物（卡在关着的门洞前选择等待，开门自然恢复）——队友不等待。
  CompanionAI 独立位移检测：每 400ms 采样，**2s 窗口总位移 <10px 且仍有移动意图**
  （战术目标未到达或攻击目标在射程外）→ 卡死；连续 2 次确认 → 瞬移脱离：优先
  卡死点半径 50~200px 螺旋搜索"更靠近玩家"的合法点（canMoveTo 校验），否则瞬移到
  玩家附近合法点；4s 冷却防抖动。只作用于队员（玩家/敌人不受影响）。行业参考：
  L4D survivor bot 卡死传送到下一路径点、Godot `map_get_closest_point` 拉回导航
  最近点、Gmod-Auto-Unstuck 检测后延迟瞬移、Unvanquished 先侧向脱困再兜底。
- **队友渲染三修（2026-08-14 四修）**：① **图层**——AI 队员精灵 depth 由
  `_updateDynamicDepths` 按世界 Y 计算（脚底+10 + junctionCorrectedDepth，与敌人同
  口径），不再固定 `playerSprite.depth+0.5`（否则墙后也显示在墙前）；纯渲染队员
  保持玩家层。② **主动找位置**——监听 `DungeonMapSystem.state`（map↔combat）变化：
  玩家被传送时露娜清路径/目标并重定位到玩家附近合法点（同场景切换机制），避免残留
  地图坐标；advance 时玩家距离 >450px 优先跟近玩家（保持阵型，远程后排不落单），
  怪在射程内仍由 cast 分支站定施法；距离自愈阈值 1200→900。③ **朝向**——aiMode
  flipX 由自身决定：移动时面朝 vx 方向（往哪走面朝哪）、施法面朝 target、idle 保持
  上次朝向（`_lastFaceRight`），不再跟随玩家镜像（逃跑时不再面朝怪物）。
- **露娜初始魔法 600 + 消耗品自动使用（2026-08-15）**：
  - `companion-config.json` mage_luna 加 `baseMaxMp: 600`——companion.js
    `_maxMpOverride` 覆盖 maxMp 基础公式（600 基准 + 每级 10 + 装备加成），
    serialize/fromSerialized 保留。
  - `companion.consumableSettings`：`{ enabled, hpThreshold:0.3, mpThreshold:0.25,
    useLowToHigh:true }`，序列化保留。
  - AI 自动用药（CompanionAI `_useAutoConsumable`，1s 节流）：HP/MP 各自独立判定
    （**勿用 `!used` 串联——生命和魔法可能同时低于阈值**），背包选对应恢复药水
    （level 升序 → 恢复量升序 = 低级→高级），用 `applyConsumableEffect` 生效并扣
    堆叠，通知 PartySystem 刷新 UI。
  - UI：companion-panel 装备页背包栏加「⚙️ 消耗品设置」按钮 → 展开面板（启用开关/
    HP 阈值/MP 阈值/背包消耗品列表/保存）。新增更高级消耗品（equipment.json
    consumable + level 字段）自动参与低级→高级排序，无需改代码。
- **露娜 walk/run 视频重建管线（2026-08-15，walking and running.mp4）**：
  `tools/ai-gen/luna-wr-rebuild.py`（须 ComfyUI venv python 运行）——PyAV 抽帧 →
  BiRefNet（ComfyUI-RMBG）抠图（unpremultiply 防白边）→ 对齐（脚底 FEET_Y 固定 +
  水平**内容质心**精确居中 CENTER_X，质心跨度 <1.5px，循环回跳无位置跳动）→ 拼
  512×512 sheet。视频 24fps/121 帧分段：walk 循环 f12-37（26 帧，回跳对齐差异
  0.017 无缝）；run 起步 f81-97（17 帧）+ 循环 f98-120（23 帧，衔接 0.054、
  回跳 0.086 = 素材最优）。配置：walk frames [0,25]@24；run startFrames [0,16]+
  loopFrames [17,39]@24。**坑**：sheet 未填满的行尾是空白 cell，循环回跳校验必须
  用实际 frameCount 的最后一帧，不能按 cols×rows 全表算（会把空白帧当回跳帧）。
- **spell 动画跳过/占据排查（2026-08-15）**：两个真 bug——
  ① `_tryCast` 写计时器到 `c._castTimer`（companion 字段），但 `_updateCast` 误读
    `this._castTimer`（AI 实例字段恒 0）→ 施法首帧即结束、spell 动画被跳过；统一到
    `c._castTimer`。② `_applyAction` 开头的施法锁定检查在 flee 之前提前 return——
    近战贴脸时 decide 已返回 'flee'，但施法锁定把 flee 分支（含打断施法）拦下，
    露娜站桩 spell 不逃跑；修为例外：`action === 'flee'` 跳过施法锁定、打断施法逃跑
    （决策纯函数同步：威胁贴脸优先级高于施法站定）。
  诊断探针 `tools/cdp-luna-spell-diag.mjs`：注册检查 + 施法期间逐帧采样
  （castState/currentAnim/frame/texKey）+ 手动 `_tryCast` 渲染验证。
- **露娜朝向/内置CD/普通攻击（2026-08-15）**：
  - **朝向**：GameScene aiMode——逃跑（`member._lastAction==='flee'` 且移动中）面朝
    移动方向；其余（idle/施法/走位）**始终面朝目标**（member.target 优先，否则扫
    Game.entities 最近敌人）。`_lastAction` 由 CompanionAI 同步到 companion
    （`c._lastAction = action`）——渲染层读 member 而非 AI 实例，否则恒 undefined。
  - **法术内置 CD**：`_castCooldown` 默认 2000ms，所有法术共享最小释放间隔；
    `_pickReadySpell` 开头 `if (c._castCooldown > 0) return null`；普通攻击不占用
    该 CD（独立 `_basicAtkCd`）。
  - **普通攻击**：config `basicAttackRange 600 / basicAttackSpeed 600 /
    basicAttackInterval 2000 / basicAttackDamageMul 0.2`；CompanionAI `_tryBasicAttack`
    发射蓝色光球（`_basic` 状态，600px/s 直线飞行、600px 射程），命中造成
    `matk×0.2` 伤害，攻击动作播 spell 动画（castState=casting + _castTimer=500ms）；
    GameScene `_syncCompanionBasics` 渲染光球（impact_dot 纹理 + 蓝 tint + ADD 混合）。
    决策：无法术可用（CD/MP/射程）且普通攻击就绪 → cast 分支 fallback 普通攻击。
  验证探针 `tools/cdp-luna-basic.mjs`（内置 CD 递减、普通攻击 dmg=matk×0.2、idle
  朝向目标左右切换）。
- **攻击整合 + 躲避停用（2026-08-15 二修）**：
  - 原两套攻击：采集 `_fireGatherBolt/_bolts`（800ms、280px、青色弹、伤害
    atk||matk）与普通攻击 `_basic`（2s、600px、蓝色光球、matk×0.2）——**已整合为一套**
    `_basic`：`_cmdGather` 攻击段改用 `_basicReady/_tryBasicAttack(node)`（同公式/同
    投射物/同间隔），删除 `_fireGatherBolt/_updateGatherBolt/_bolts/_gatherAtkTimer`；
    aggressive/patrol 指令无法术时也 fallback 普通攻击。
  - **光球渲染统一**：`_basic` 存 companion 字段（`c._basic`），GameScene
    `_syncCompanionBasics` 读 `m._basic`——此前写 AI 实例字段导致光球不可见。
  - **躲避停用**：`companion-config ai.fleeEnabled: false`；`_meleeThreat` 包装
    威胁评估（false 时返回 null），默认状态机 + aggressive/patrol/gather 指令全部
    不再 flee；保留卡死瞬移/掉队瞬移（防卡墙）。露娜现只做 跟随/攻击/施法/idle。
- **普通攻击 100% 魔攻 + 提前量瞄准（2026-08-15 三修）**：
  - `basicAttackDamageMul` 0.2 → 1.0（普通攻击伤害 = 魔法攻击力全额）。
  - 瞄准复用远程怪物同款 `AimHelper.lead`（毒液僵尸/僵尸巫师的拦截点预判）：
    普通攻击 `_tryBasicAttack` 用 `AimHelper.lead(c.x, c.y, target..., vx, vy, speed)`
    计算拦截点再取角度（无有效解回退当前位置）；法术（火球/冰锥）走
    `BoltSkillSystem._getAimTarget` 非玩家分支，本就带 lead 预判——两条攻击链路
    均为提前量瞄准。zombie-wizard 的 `extraDelayS=0.3` 是给"延迟发射"前摇用的，
    露娜弹体立即发射，不需要额外延迟参数。
- **spell 动画大小/位置对齐（2026-08-15 四修）**：spelling.png 是旧素材——人物高
  461（walk/run 471）、质心漂移 208~280（72px）、顶部 y19（walk/run y7），施法时
  人物在帧内晃动/下沉（"大小没对齐 + 施法贴图后退"）。`tools/ai-gen/luna-spell-realign.py`
  按 walk/run 重建同标准（TARGET_H=470/FEET_Y=478/CENTER_X=256、内容质心精确居中）
  重排现有 alpha 帧（无需重新抠图）：重排后 cx 255.7~256.5、h 471、topY 7 与
  walk/run 完全一致。施法原地性 = aiMode 渲染 `setPosition(member.x, member.y)` +
  `_frozenForCast` 锁定移动（帧内容不再偏移后视觉无后退）。
- **露娜魔攻恒 1 根因（2026-08-15 五修）**：Companion.calculateCombatStats 的魔攻
  基础公式误读空的 `formulas.matk`（{}）→ 无装备 matk=0 → 普通攻击 `max(1, matk×1.0)`
  恒 1（打怪/采矿都是）。修复：与玩家对齐用 `formulas.magicAttack`
  （int×1.5 + wis×0.5，`floor:true`——注意配置是 `floor:true` 不是 `round:'floor'`），
  无装备露娜 matk=25。同时：① 构造函数补 `calculateCombatStats()`（此前构造后 matk
  恒 0）；② `fromSerialized` 恢复时预置 `_equipAttrBonus`（恢复的 data 已含装备加成，
  差值法不得重复叠加——否则 int/wis 等翻倍）。
- **spell 50% 释放点（2026-08-15 六修）**：法术/普通攻击改为"spell 动画播到一半才
  发射"——`_tryCast` 只凝聚（fireball/iceSpike 第一次 trigger；lightning 不触发），
  记录 `_pendingRelease` + `_castDuration`；`_updateCast` 每帧检测 elapsed ≥
  total×0.5 时 `_releasePending`（法术第二次 trigger 发射 / 普通攻击 `_spawnBasic`
  生成光球 + 扣 MP）。**坑**：法术 CD 必须在 50% 释放成功后才设置——凝聚时若先设
  CD，BoltSkillSystem.trigger 的冷却检查会拦截第二次 trigger（火球凝聚后永不发射，
  表现为施法扣蓝但零伤害）。flee 打断施法需清 `_pendingRelease/_castDuration`。
- **普通攻击光球穿怪修复（2026-08-15 七修）**：`_updateBasic` 原先只检测发射时的
  单个 `b.target`——光球路径上经过的其他怪物完全不判定（锁定远怪时近怪被直接穿过）。
  改为：优先命中发射目标，其次遍历 `Game.entities` 中所有 active/hp>0 的 enemy，
  光球 30px 半径内即命中（与法术投射物同思路）。诊断探针
  `tools/cdp-luna-basic-hit.mjs`：两个怪物同一直线、锁定远怪——修复后近怪先被命中
  （25 伤害），不再穿过。
- **卡死瞬移排除"输出中"（2026-08-15 八修）**：卡死判定新增伤害窗口——攻击释放
  （`_releasePending`/`_spawnBasic`）与普通攻击命中都刷新 `_lastAttackAt`；
  `_checkStuck` 在判定窗口（2.5s）内有过攻击 → 重置 streak 不判卡死、不瞬移
  （站桩输出被误判卡死的问题）。真正卡死（墙里、无目标、打不到怪）仍正常瞬移。
- **施法/攻击位移形变重调（2026-08-15 九修）**：① **位移**——施法/攻击结束后新增
  200ms 硬直（`_castRecoverTimer`，期间保持 `_frozenForCast` 不移动），消除"动画
  刚播完就滑动"的位移（手动施法采样 x/y 位移 0）；flee 打断需清硬直。② **形变**——
  spell 帧宽度跨度 162~393（施法展臂帧比 walk 宽 40%），重排脚本 `luna-spell-realign.py`
  增加水平限幅 `MAX_WIDTH=300`（仅 X 轴压缩展臂帧、保持高度 471），跨度缩至
  162~300，人物不再"忽宽忽窄"。
- **spell 动画用 spelling.mp4 重做（2026-08-15 十修）**：视频 121 帧——f0-70 站立
  施法（起手→咏唱→收手）、f77 起后仰倒地；只截取施法段。`tools/ai-gen/luna-spell-video-rebuild.py`
  （ComfyUI venv python）抽 f0,2,...,70（36 帧）→ BiRefNet 抠图 → 对齐
  （TARGET_H=470/FEET_Y=478/CENTER_X=256 + MAX_WIDTH=300）→ 8×5 sheet；配置
  spell frameCount 36 / frames [0,35] / 20fps / repeat -1。**卡死瞬移攻击窗口探针
  注意**：前序测试若 2.5s 内攻击过，卡死场景需重置 `_lastAttackAt=0` 否则误判
  "输出中"。
- **spell 人物压扁修复（2026-08-15 十一修）**：十修沿用的 `MAX_WIDTH=300` 水平限幅
  会把展臂帧压扁——**已移除限幅，改纯等比缩放**（只统一高度 470，宽度按原始比例）。
- **spell 前16正放+后16倒放（2026-08-15 十二修）**：`tools/ai-gen/luna-spell-loop.py`
  从前 16 帧合成 32 帧 sheet（cell0-15 正放 帧0→15、cell16-31 倒放 帧15→0），
  首尾差异 0 循环无缝；配置 frameCount 32 / frames [0,31] / 26.67fps（1.2s 播完）。
- **spell 脚部对齐（2026-08-15 十三修）**：全内容质心对齐会被施法手臂摆动拉偏——
  脚底区域质心在帧间漂移 28px（视觉滑步）。水平对齐基准改为**脚底区域（底部 15%
  高度）质心**居中（SKILL 对齐三铁律：水平中心固定防滑步），修复后跨度 1.0px。
- **施法/攻击状态机防插播（2026-08-15 十四修）**：castFrozenMs=1200 匹配动画完整
  时长；`_applyAction`/`_tick` 施法锁定区分"施法中→spell 动画"与"硬直中→停帧
  idle"（否则动画播完循环重播 = 抽动）；控制技能（hasStatusEffect stun/frozen/
  bind）才强制清施法状态打断动画。
- **掉队瞬移理智判定 + walk/run 切换（2026-08-14 五修，用户需求）**：
  - 需求①：被卡在门外进不来 → 距离过远瞬移回玩家身边，但**区分卡住 vs 正常 AI 远离**
    （躲避敌人/寻找输出位置离玩家远是合法的，不该瞬移）。
  - 实现：decision 纯函数 `shouldRelocateCompanion`——超过 teleportDist(700) 后，
    flee（逃近战威胁，撤退点含朝玩家分量会自动收敛）/ advance 站位（站位点离玩家
    ≤followOffset×3.3）/ 施法锁定 / 距离在缩小（有效追赶）→ 不瞬移；
    其余（掉队、路径反复失败 stuckCount≥2、撞墙）→ 瞬移；超 teleportHardDist(1100)
    无条件瞬移兜底。**掉队判定必须看"距离趋势"**：跟着玩家跑时距离可能瞬时拉大，
    只要每帧都在缩小就是正常追赶。
  - 需求②：离玩家过远 / 逃避敌人 / 寻找位置输出 → running；小范围移动 → walking。
    实现：`shouldUseRun(mode, dist, cfg)`——flee 永远 run；其余按移动距离
    （到跟随点/站位点的直线距离）超 runDist(260) 用 run。
    `_setMoveState` 同步 maxSpeed（run→runSpeed/walk→walkSpeed）。advance 归队
    （离玩家>450）直接 run。
    **注意：不用 PathManager.path 长度判 run/walk**——决策瞬间路径还是旧目标的
    （MovementSystem 下帧才重算），读路径长度会 stale 导致误判 run；预寻路整合点
    在卡住检测（stuckCount）而非路程判定。
  - 配置：companion-config.json `ai` 字段可覆盖 runDist/teleportDist/teleportHardDist。
  - 露娜 running 接入 24 帧版：`assets/companions/luna/running.png`（8×3、24 帧完整
    双步周期）——**完整周期循环不能拆 startFrames**（24 帧拆 6+18 会让循环段不是
    整数周期，接缝左右脚错位）；配置只给 loopFrames [0,23]，BootScene 无 startFrames
    时走 frames 默认分支全帧循环。单测 133/133（新增 run 判定/掉队判定 17 条）。
- **状态机回归修复（2026-08-14 六修）**：用户反馈"running 常态化（无 idle）+ spell 不放"。
  - 根因①（run 常态化）：`_applyAction` 各分支条件未命中时（flee 无威胁 / cast 无目标 /
    advance 无目标）不设置 `_animState` → 残留上一帧 run。修复：分支前默认
    `_setMoveState('idle')` + 清 vx/vy（各分支命中后覆盖）。
  - 根因②（spell 不放）：默认 idle 重置把**施法锁定期的 spell 动画砍掉**——施法中决策
    返回 'cast'，但 spell 已进 CD 为 null → 不 _tryCast → _animState 被重置成 idle。
    修复：`_applyAction` 开头加**施法锁定守卫**——`_castState !== 'idle' || _frozenForCast`
    时保持 `_animState='spell'` 并直接返回（清 vx/vy）。
  - 实机探针 `tools/cdp-luna-state-probe.mjs`：静止→idle、远移→run→walk→idle、
    施法→spell（_tryCast 后 cast=casting/anim=spell/timer=650/frozen=true）、近战→flee(run)，
    全部 PASS。**CDP 高频采样要在页面内循环**（evaluate 往返延迟会错过 650ms 施法窗）。
- **spell 动画不播放（2026-08-14 七修，根因在渲染层）**：
  - 根因：`_syncCompanionSprites` 判重播用 `!sprite.anims.isPlaying || key!==spellKey`——
    spell 动画 repeat 0 播完一次 isPlaying=false → **每帧从头重播，永远卡在前几帧**
    （视觉上"没播放/闪一下"）。修复：三个动画分支统一改为**只在动画键变化时播放**
    （`currentAnim?.key !== targetKey`）。
  - spell 动画 repeat 0 → **-1**（施法期间循环播放完整施法动作）；castFrozenMs 650 → 1300ms
    （32 帧@20fps=1.6s 循环的 80%，动作清晰可见；650ms 太短一闪而过）。
  - **idle 素材接入（2026-08-14）**：`E:\无尽轮回\游戏\素材库\人物\luna\luna.png`（2048² 白底）
    → BiRefNet 抠图 + 去污染 → 512 格对齐（top19/bottom479/高461/中心256，与 walk/run/spell 一致）
    → `assets/companions/luna/idle.png` → companion-config `animations.idle`（单帧）
    → 渲染层 idle 停帧优先取 idle 动画首帧（原为 run 首帧）。
  - 探针新增 E 场景（渲染层直接验证）：手动设 castState=casting/_animState=spell →
    `_syncCompanionSprites` → sprite 播放 `companion_mage_luna_spell` ✓；清回 idle →
    停帧 `companion_mage_luna_idle` 帧 0 ✓。**headless 掉帧会压缩施法窗**（_castTimer 按 dt 递减），
    AI 层施法验证看 after 状态，渲染层播放由 E 场景直接验证。单测 135/135。
- **walking 动画不播放（2026-08-14 八修，动画状态机三连 bug 收口）**：
  - 根因：idle 停帧用 `sprite.setTexture(idleKey, idleFrame)` 停止动画后，
    `sprite.anims.currentAnim` 仍残留旧动画引用；切回同一动画（如 walk）时
    `currentAnim.key === walkKey` → 跳过 play → **动画卡在停帧不播**。
    上一轮为修 spell 把重播条件从 `!isPlaying || key!==X` 收紧成 `key!==X`，恰好引入此回归。
  - 修复：三个动画分支恢复 `!sprite.anims.isPlaying || currentAnim.key !== X` 判重播——
    **前提是 spell 已 repeat -1**（循环播放中 isPlaying 恒 true，不会因"播完一次"误重播）；
    只有被 idle 停帧打断（isPlaying=false）时才重新播放。
  - 教训：**渲染层动画切换的判重播必须同时覆盖"动画未播"和"键变化"**；
    改判重播条件前先确认动画 repeat 语义（repeat 0 会自然停 → 不能只查 isPlaying；
    repeat -1 循环 → isPlaying 恒 true → 可安全用）。探针 F 场景：
    walk→idle→walk 循环切换恢复播放 ✓。单测 135/135、npm test 51/51。
- **idle 抠图白边 + 大小（2026-08-14 九修）**：
  - 白边：BiRefNet 边缘半透像素 unpremultiply 反推偏白 + 2048→512 缩放插值产生白圈。
    处理（红狼人同款）：① 合成灰底(127)判据——半透像素合成后亮度 >175 = 白边残留 → alpha 清零；
    ② 3×3 最小值滤波侵蚀边缘，去掉半透明白圈。边缘白边 15% → 0.78%，GLM 复验无白边、细节完整。
  - 大小：idle 素材（luna.png 2048²）角色宽高比 0.379，动画素材（walk/run）约 0.52——
    按高度对齐后 idle 宽 175 vs walk 202-243，显得瘦小。折中：target_h 461→500、feet_y 505
    （宽 189、高 500，视觉面积约为 walk 的 92%）。**站立姿态窄是素材比例，强行宽度匹配会超高出格**。
    动画对齐基准：所有动画 frameWidth/frameHeight 512、显示由 spriteSize 控制。
- **BiRefNet 细长物体尖端羽化（2026-08-14 十修，running 法杖尖端消失）**：
  - 症状：游戏里 running 法杖尖端像被截掉一段；但源视频完整（BiRefNet alpha bbox 离右缘
    300px+）、精灵图 bbox 无贴边、GLM 说"完整"——**所有常规检测都漏了**。
  - 根因：BiRefNet 显著性分割对**细长尖端**支持弱——帧 30/31 法杖尖端 alpha 只有 166/171
    （<74%），深色背景下尖端"半透明消失"，但 bbox(alpha>16) 和 max_x 检测都正常。
  - 检测方法：**逐帧查尖端 max_alpha / 最右 5 列 alpha 均值 vs 前 10 列**——正常渐变
    均值差 <30%，羽化帧差 >40% 且 max_alpha <200。
  - 修复：**融合抠图**——`alpha_final = where(BiRefNet<190 & 阈值(gray<232)有深色, 阈值, BiRefNet)`，
    只把 BiRefNet 漏掉的深色细节（法杖尖端）用阈值补回，主体仍走 BiRefNet；
    再灰底判据清理白边。24 帧尖端 max_alpha 全 255，右5列均值 158→188+。
  - 教训：**细长物体（法杖/武器/触角）抠图后必须查尖端 alpha 渐变**，不能只看 bbox；
    GLM 对细长半透明尖端也判不准（两次矛盾），像素证据优先。

---

### 图层/背景随分辨率适配工作流（"cover 铺满 + bottom 锚定"）

适用：背景图、栏位面板、立绘等需要随分辨率自动调整且不产生黑边/漂移的图层。
- **cover 铺满**：`scale = max(viewW/imgW, viewH/imgH)`——图片始终覆盖视口，无黑边（超出部分裁切）。
- **bottom 锚定**：`y = viewH - imgH*scale`（图片底部贴视口底部）、`x = (viewW - imgW*scale)/2`（水平居中）——位置固定不随分辨率漂移，底部内容始终可见。
- **坐标区域**：用游戏内开发工具的坐标工具在目标分辨率（如 2560×1440）下实测 `left/bottom/width/height`，`bottom/left` 用固定像素，`width/height` 按视口比例等比适配。
- **禁用做法**：`window.innerWidth/Height` 动态居中（分辨率变化时位置漂移）、固定像素画布（高分屏大量黑边）。
- **拖动/缩放钳制区域必须与初始定位区域一致**（共用同一区域计算函数），否则能拖出定位区导致"看似没调整"。

---

