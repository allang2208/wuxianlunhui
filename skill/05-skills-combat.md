> 本文件为 game-dev 技能库分卷，主索引与目录见 ../SKILL.md
> 本节：5. 技能与战斗系统

## 5. 技能与战斗系统

### 高架远程战斗统一口径（2026-08-20）

- 高处奖励只按阵营与表面身份判定：仅 `player/companion + wall_walk` 获得
  `defense-structures.json.wallWalk.rangedCombat.rangeMultiplier`（当前 1.2）；
  楼梯途中、普通浮空和敌人不得用 `z > 0` 冒领加成。
- “能否攻击”和“弹体能飞多远”必须消费同一有效射程。标准弹体收口到
  `ProjectileFactory`，魔法收口到 `getMagicRangeMultiplier`，AI 的选敌、施法决策和
  技能最终释放点都要复核射程与 `hasRangedLineOfSight`。
- 墙顶加成只扩大施法者到目标的 `maxRange`；`aimRadius`、`chainRange`、
  `explosionRadius` 等技能作用范围只使用 `getMagicAreaMultiplier`，防止高处同时放大
  锁定容差、传导距离和 AOE。
- 发射时必须快照 `maxRange`、`z/vz` 与 `projectileWallContext`。弹体飞行途中即使
  射手上下墙，也不能改变已发射弹体的射程或近墙净空。
- 墙碰撞必须在真实二维交点插值弹道 Z：矩形墙用 Liang-Barsky 的 enter/exit 区间，
  面线墙用唯一交点。不得恢复“站上平台后忽略全部墙段”的旧穿墙特例。

### 范围技能与连锁法术统一 Z 轴结算（2026-08-20）

- 唯一配置为 `data/combat-elevation.json`（与 `public/data` 双份同步）：`surfaceTolerance` 控制同一承载层
  的台阶连续容差，`projectileVerticalPadding` 控制飞行技能体积的微小碰撞补偿；业务系统不得另写墙高阈值。
- 高度上下文统一由 `src/physics/elevation.js` 创建：施法者跟随范围用 `surfaceEffectFromEntity`，指定落点用
  `surfaceEffectAtPoint`，真实飞行碰撞用 `volumeEffectContext(flyZ, radius)`。这些都是释放/撞击瞬间快照，
  后续上下墙不得让已释放效果换层。
- 鼠标/RTS 屏幕点用 `DefenseSystem.resolveSurfaceTarget`；已经处于真实物理平面的弹体撞击点必须用
  `DefenseSystem.resolvePhysicalSurface(x, y, impactZ)`，保持 `x/y` 不变并按撞击高度选择最近承载层，禁止
  再用 `impactZ` 反推屏幕 `y`。
- `Ground*` 与现有 `Vertical*` 形状的最后一个参数为 `elevationContext`。新调用必须显式传入；地表形状先
  验证目标脚底与效果承载面，再执行 footprint；缺失上下文时必须失败关闭，不能回退二维命中。飞行魔法的
  躯干回退也必须额外经过同一个高度体积门禁。
- 弹体每帧先夹取到目标或最大射程的真实终点，再检查该完整三维线段是否撞墙，最后才允许命中或结束；
  最后一帧不得先结算目标、先按射程销毁再补墙检。
- `GroundZone` 必须持有 `surfaceContext` 并由每次 tick 的形状复用；暴风雪、熔岩、毒雾、燃烧区等持续区域
  禁止每帧重新按施法者位置解析高度。冰墙生成伤害、弹开和寒冷光环同样只作用于墙段快照所在层。
- 逻辑坐标始终保留真实物理 `x/y`；飞行体、地表区域、落点粒子、光束和浮字的显示统一使用
  `displayY = physicalY - z`，不得为了视觉对齐修改伤害中心或路径坐标。
- 连锁法术每一跳都以“上一跳实体”为 LOS 起点重新调用 `hasRangedLineOfSight`。闪电、雷暴领域、感电过载
  任一跳被墙体或高度阻断就终止，不能只按二维 `chainRange` 择敌或复用首跳结果。
- 带施法前摇的锁定法术在释放帧必须重新验证目标存活、`hittable`、阵营/建筑限制、真实射程和 LOS；
  鼠标候选距离使用目标投影位置 `entity.y - entitySurfaceZ(entity)`，物理射程仍使用真实 `x/y`。
- `FlatViewSystem` 只读显示，不得出现在任何命中判定中；普通/压平视图必须运行完全相同的 Z 轴结算。

### 技能添加标准工作流（2026-08-02 定稿，闪电技能首航）

新增技能一律按此开展（闪电：锁定+传导+伤害+击退+眩晕+修炼+音效+图标+面板全链路验证）。

#### 0. 形态选型（先定形态，再动手）

| 形态 | 复用模板 | 适用场景 |
|---|---|---|
| 弹道投射物 | `bolt-skill-system.js` kind 配置 | 火球/冰锥：凝聚→发射→飞行→命中 |
| 地面区域 | `GroundZone` 基类 | 毒雾/酸液/燃烧区 |
| 锁定/传导 | `LightningStrikeSystem` + `LightningBoltEffect` | 闪电：点选最近敌人→立即命中→连锁 |
| 移动雷云（跟身持续） | `StormDomainSystem` + `StormCloudFx` | 雷暴领域：头顶雷云跟随自己周期落雷+传导 |
| 电磁炮直线光束 | `ThunderLanceSystem` + `spawnRailgunBeam` | 贯穿雷枪：长按蓄力→沿鼠标方向笔直贯穿全部敌人（感电增伤+击退）→终点电爆 |
| 其他自管 | 独立 system 组件 | 风车/推击等 |

#### 1. 数据（data/skills.json + public/data/skills.json 双份同步）

- `id/name/icon/iconImage/description/maxLevel/tags`（tags 含 魔法+主动 → 技能面板筛选/可拖快捷栏）。
- `effectFormula`：数值一律公式（含 `level`）或常量；每 5 级成长节点用 `Math.floor((level - 1) / 5)` 模式（冰锥数量/闪电传导同款）。
- `expFormula`：`100 + (level - 1) * 100`（与其他技能一致）；`expRewards`：`{ hit, kill, multiHit, multiKill }`（multiHit=单次命中≥2 目标、multiKill=单次击杀≥2 目标；**经验函数须按整次施法累计命中/击杀数统计**，冰锥为此改为 _end 统一结算）。
- **魔法类技能必须配置 `mpCost`（魔法消耗）**——遗漏/为 0 时助手必须主动提醒用户补上（2026-08-02 闪电曾漏配，用户明确要求此后工作流强制检查）；施法端 `trigger()` 统一做耗蓝校验（`mp` 不足 → 浮动提示「魔法不足」，不进入结算、不消耗冷却）。
- `sounds`：`{ hit: '路径' }` 或 `{ cast: [p1, p2] }`（数组=同时播放，闪电首例）。
- **双份必须字节一致**（test-regressions 断言，npm test 会查）。

##### 技能暂时搁置的可逆合同（2026-08-25）

- 搁置不等于删除：在双份 `skills.json` 的技能定义上同时设置 `hidden: true` 与 `disabled: true`，可增加 `shelvedReason` 说明原因。`hidden` 只负责不展示，`disabled` 负责不执行，不能只从 `skillList` 数组删掉名称。
- `buildSkillFromJSON` 和玩家 fallback 必须传递三个字段；否则 JSON 已标记，运行时技能对象却仍是可见/可用。
- 展示门禁覆盖玩家技能网格、直接详情入口、通用技能列表与开发调试下拉框；快捷栏同时拒绝新绑定并清理热更/旧会话遗留绑定。
- 执行门禁必须放在技能组件 `trigger()` 最前面，并让玩家/通用经验入口忽略搁置技能，防止旧快捷键、调试命令或直接调用绕过 UI。
- 恢复时先完成原实现的验收，再同步移除双份 JSON 与 fallback 的 `hidden/disabled/shelvedReason`；不得只恢复界面或只恢复触发层。

#### 2. 系统组件（src/entities/components/xxx-system.js）

- `trigger()`：冷却检查 → 耗蓝 → 目标/方向判定 → 失败提示（`SceneManager.showTopNotification`）→ 结算（`takeDamage` + `applyKnockback(angle,px)` + `applyStun(ms)`）→ 特效 → 经验。
- `update(dt)`：冷却递减（ms）。
- **玩家接线四件套**：① `player/index.js` import + `this.xxxSystem = new XxxSystem(this)` + `_xxxCooldown = 0` 字段；② `subsystems.js` update 段 `this.xxxSystem.update(dt)`；③ `subsystems.js` 死亡复位段清 `_xxxCooldown`；④ `subsystems.js` `_initSkills` 加 `if (!skills.xxx)` 兜底（JSON 加载失败/旧缓存仍可用）。
- **数值兜底收敛（配置唯一真相，2026-08-05 全魔法系统落地）**：系统顶部定义 `XXX_DEFAULTS` 常量
  （值与 skills.json 同字段缺省兜底一致），`trigger()` 里 `const effect = { ...XXX_DEFAULTS, ...baseEffect, mpCost }`
  合并——skills.json effectFormula 是唯一真源，业务代码**禁止散落 `effect.cooldown || 25` 之类魔法数字**；
  伤害公式内 `?? 0` 防御读取可保留（合并后不会触发）。已覆盖：贯穿雷枪/雷暴领域/闪电锁定/暴风雪/陨星/
  圣光/冰墙/灼锋焰甲/无人机/冰锥/火球（投射物走 `kind.defaults` 并入 `BoltSkillSystem._getEffect`）。
- 怪物复用（可选）：参考 `zombie-wizard.js` 的 IceSpikeSystem/FireballSystem（构造 + update + AI 决策触发）；
  **瞄准类技能 `trigger` 必须可传参 `trigger(optAimX, optAimY)`**——玩家用鼠标（内部读 Renderer.screenToWorld），
  怪物传面向方向（缺省回退自身前方 100px，贯穿雷枪已按此实现）；蓄力光球类特效玩家锚定施法手，
  怪物同样生成但先用默认锚点（`_defaultChargeAnchor` 身体中线上方）占位，待怪物绑定点做好再替换。

#### 3. 快捷栏（quick-bar.js）

- 触发分支：`else if (skillId === 'xxx') { player.xxxSystem.trigger(); }`。
- 冷却同步：`updateCooldowns` 读 `Game.player._xxxCooldown` → `this.cooldowns['xxx']`（转圈显示）。
- **自目标技能（可对自己释放）**：skills.json 标 `selfCast: true`（圣光首例）；`input.js` keydown 传 `e.altKey` → `QuickBar.useSlot(code, altKey)` → 对应系统实现 `triggerSelf()` 直接对自己释放（跳过瞄准/距离/视线三重判定，耗蓝/音效/冷却/经验照常）。

#### 4. 技能栏/面板（skill-manager.js）

- `skillList` 三处数组加 `player.skills.xxx`（武器分支列表各加一遍）。
- **技能栏默认排序（2026-08-02 定稿）**：精通类 → 被动类 → 主动类 → 魔法类（`_getSkillCategoryPriority`：精通按名称含「精通」识别、其余按 tags 的 passive/active/magic 归类；新技能 tags 决定归类，精通命名必须含「精通」）。
- 详情面板三区（照火球/冰锥格式）：🧮 伤害公式（基础/魔攻加成=魔法攻击×系数/智力加成/当前总伤害）+ 技能效果（effect 全部字段）+ **下一级全项预览**（nextEffect）。
- 升级方式说明（经验来源三条口径）+ 升级飘字 `effectText` 分支。
- 经验函数 `addXxxExp(player, hitCount, killCount, multiHit)`——hit/kill/multiHit 各自独立累加。

#### 5. 特效（src/effects/）

- 优先复用 `combat-fx` 共享件（burstParticles / fireGroundShockwave / 抛物线投射物）。
- 锁定/传导类连接特效直接套用 **`LightningBoltEffect` 模板**（见下节，换 colors/widthScale 即可）。
- 自管特效类：`EffectManager.add()` 驱动 `update(dt)`，`window.__phaserScene` + `worldEffectsGroup` 建 graphics，`active=false` 自动清理。
- **色块/粒子风格优先**（impact_dot + ADD + 多层 tint / fillCircle 色块链）——避免线条感。
- 禁止 per-object filters（数量多即卡）；深度=实体 depth+2 或地面 y-998 口径；位置/观感类必须 CDP 实机验证。

##### 角色锚点扇形照射特效（2026-08-25，美杜莎石化凝视）

- **判定与外轮廓同源**：System 先从技能配置读取 `range/arcDegrees`，伤害扇形、最外层照射面和调试范围全部消费同一数值；Effect 只负责绘制，禁止自行选敌、结算伤害或用“看起来差不多”的另一套角度。
- **锚点取最终显示态**：眼睛、口器或武器发射点应从当前 Sprite 的真实显示尺寸、origin、局部归一化锚点和 `flipX` 推导，每帧在动画/翻转/动态深度完成后更新；逻辑判定仍以 Collider footprint 为中心，不能为了迁就视觉修改伤害原点。
- **手电筒式体积锥**：最外层使用无描边填充面严格覆盖完整扇形，向内叠加低透明主色、柔光与稀疏色块/尘粒形成体积；禁止用两条硬边线冒充照射范围，也避免 per-object filter。
- **生命周期完整**：NORMAL/ADD Graphics 一并进入 `worldEffectsGroup`、迷雾枚举和最终 Sprite depth；短时展开后在动作末尾自然淡出，被打断、死亡或场景清理时走快速淡出并成对销毁，不得让 VFX 残留改变控制或伤害持续时间。

#### 6. 图标与音效（可选但推荐）

- 图标（本地 ComfyUI 出图，2026-08-03 起）：先读文首「本地 AI 出图工作流」——用本地 ComfyUI 生成
  （同系列风格参照现有技能图标），过 GLM-4.6V 验收 + 像素统计后抠图入库 `assets/skills/xxx.png`
  （1024×1024 透明底，与火球同规格），`iconImage` 指向。技能贴图要点见文首「技能贴图要点」清单。
- 清理（2026-08-03 起强制）：确认 iconImage/贴图引用后，删除生成过程全部废案与未调用图片
  （迭代版本/候选图/预览图），只保留最终被引用资产，避免仓库膨胀。
- 音效：素材复制 `assets/sounds/skills/xxx.mp3`，skills.json `sounds` 配置，系统内 `SoundManager.playFile` 播放。

#### 7. 验证

- lint / npm test（含双份 JSON 断言）/ vite build / node --check。
- **核对清单**：魔法类技能 `mpCost` 已配置（>0）；双份 JSON 字节一致；技能面板数值与 effectFormula 同源。
- 数值逐级核验：按 L1/5/6/10/11/16/20 手算伤害/传导/眩晕/击退成长。
- 开发面板「技能」页签 + 控制台 `await setSkillLevel('xxx', L)` 快速测各等级。
- 实机：释放 / 锁定 / 范围外失败提示 / 冷却转圈 / 怪物受击表现（击退/眩晕/死亡）。

#### 8. 坑（闪电首航沉淀）

- 形态别硬套：锁定型别塞 BoltSkillSystem（那是弹道基类）。
- 特效需求先对齐：定格 vs 持续闪烁 vs 色块/线条，先问清再做（闪电经历 3 轮返工）。
- 冷却字段名 `_xxxCooldown`（ms）必须与 quick-bar 同步口径一致。
- 经验"命中/击杀/多目标命中/多目标击杀"四条口径各自独立累加，别合并；单次施法多目标奖励必须在施法端按整次累计（火球/闪电天然按次，冰锥需改 _end 统一结算）。
- **魔法类技能漏配 mpCost 是高频遗漏**——数据配置完先核对，漏了提醒用户。
- 直接改等级测主动技能 OK；被动技能不触发属性回算（需重新装备/升级触发）。

---

### 法系投射物技能系统（2026-07-28，火球/冰锥合并）

`src/entities/components/bolt-skill-system.js` 基类（凝聚悬浮→发射→直线飞行预判/撞墙/命中统一流程），差异全部 kind 配置驱动：fields（状态字段名，GameScene/快捷栏按现有字段读取不可改）/ makeProjectiles / anim / trail / onImpact / onMaxRange。`fireball-system.js`/`ice-spike-system.js` 降为 ~120 行 kind 封装（-516 行）。**注意：命中循环不 break——冰锥同帧多目标结算是原版行为（准穿透），新 kind 的 onImpact 自行处置投射物 active。**新法系技能 = 写一份 kind 配置即可。

- **施法者专属冷却倍率（2026-08-23）**：投射物技能在通用改造冷却之后，可读取施法者的
  `getSkillCooldownMultiplier(skillKey)` 再乘一次。该入口用于丛林祭司“灵动加速”等单位固有升级，
  禁止复用或覆盖装备系统的 `_cooldownReduction`；升级生效时还要同步缩放已在倒计时的组件冷却。

- **火球爆炸音效（2026-08-22）**：路径由双份 `skills.json#fireball.sounds.hit` 配置；
  在火球 `onImpact` 完成爆炸结算后播放，直接命中、撞墙和达到最大射程的空爆都响。
  同一颗火球依靠 `flyActive` 守卫只结算并播放一次，禁止提前绑到发射阶段。

#### 高架法系特效深度（2026-08-20，火球/冰锥墙顶遮挡修复）

- **物理坐标与显示坐标分离**：弹体、尾迹和命中特效的显示 Y 可以使用
  `physicalY - z`，但 depth 必须继续使用物理地面 Y；禁止把抬升后的显示 Y 直接
  `setDepth(displayY + 常量)`，否则墙顶火球/冰锥会被承托墙贴图盖住。
- **统一入口**：飞行主体、粒子尾迹、爆炸/碎裂、冲击波、火球环境光统一调用
  `resolveSkillEffectDepth()`；墙顶发射时保存 `renderDepthContext` 快照，使已发射弹体
  不会因施法者后来上下楼而跳层，并保证深度高于发射瞬间的整条承托墙链。
- **楼梯不继承墙顶豁免**：`stairs` 仍按普通墙体遮挡与地面深度处理；只有正式
  `wall_walk` 来源应用承托墙链的最低显示层。持续环境光必须与主体共用最终 depth，
  不能在后续逐帧同步中回退到旧的 `caster.depth + 2`。

**适用场景**：地面燃烧区、油池+火焰、毒雾、酸液等地表区域特效。**范例**：`lantern-miner-zombie.js` 的提灯攻击（矿灯抛物线 → 落地油脂扩散 → 火焰成簇喷发 → 周期性魔法伤害）。

#### 1. 核心构成（三层分离）

| 层 | 实现 | 关键参数 | 备注 |
|---|---|---|---|
| **油脂底面** | `scene.add.graphics()` 填充椭圆 | `oilCfg.color/alpha`、`growMs` | NORMAL 混合；`setDepth(y - 1000)` 压在所有实体之下；从落地点按 `growMs` 扩散到满半径 |
| **反光/高光** | `graphics` 描边椭圆 | `glossCfg.color/alpha` | `setBlendMode('ADD')`；`setDepth(y - 999)`；与油脂呼吸错相位，表现湿润反光 |
| **火焰粒子** | `scene.add.particles(0,0,'impact_dot', {...})` | `flameMorphMs`、`flameBurstCount`、`flamePoints` | ADD 发光混合；`scale: {start:3.3,end:0.3}` 由大到小，`alpha: {start:0.85,end:0}` 淡出；tint 随机白/黄/橙 |

#### 2. 火焰喷发要点（避坑）

- **发射器放 (0,0)**：`add.particles(0, 0, texture, config)` 后再 `explode(count, worldX, worldY)`，**不要** `setPosition(x,y)` 后再 explode——Phaser 4 会把 explode 的坐标当本地坐标，导致双倍偏移飞出屏幕（SKILL.md 已有记录）。
- **加入 UpdateList**：`particles.addToUpdateList()`，否则粒子静止一帧不运动。
- **成簇喷发**：按 `flameMorphMs`（如 70ms）每 tick 在油脂区内随机取 `flamePoints` 个点，每点生成一个一次性发射器，`explode(1, jx, jy)` 时在喷发点周围 ±40px 随机偏移，形成不规则火团。
- **一次性发射器**：`emitting: false` + `explode(...)` 喷发，用 `scene.time.delayedCall` 延迟销毁，避免累积到 `_burnZones.flames` 导致内存泄漏。

#### 3. 燃烧区生命周期

- **存储**：`this._burnZones.push({ x, y, timer, tickTimer, flameTimer, flames: [], oilGfx, glossGfx })`。
- **每帧更新**：`_updateBurnZones(dt, entities)` 中推进 `timer`（存活时长）、`tickTimer`（伤害周期）、`oilFrac`（扩散进度）、`flameTimer`（火焰喷发周期）。
- **伤害判定**：`GroundEllipse` 圆形椭圆（radius × radius×PERSPECTIVE_SCALE_Y），按 `tickMs` 对 `hostilesOf` 造成 `matk × damageMul` 魔法伤害。
- **清理**：`_destroyBurnZone(zone)` 统一 killTweensOf / stop / destroy 所有 graphics 与粒子发射器；实体销毁/移除时通过 `_destroyCustomEffects()` 统一入口（`game.js removeEntity` 会调用）。

#### 4. 抛物线投射物（矿灯/闪光弹等）

- **预判落点**：`AimHelper.lead` 按飞行时间内的目标移动预判。
- **路径**：`x = sx + (tx - sx) * p`；`y = sy + (ty - sy) * p - arcH * 4 * p * (1 - p)`（标准抛物线）。
- **旋转**：`sprite.rotation = p * Math.PI * 3 * (flyDuration / 1500)` 控制落地前旋转圈数。
- **落地**：`onComplete` 销毁投射物 sprite 并调用 `_lanternImpact(tx, ty)` 生成燃烧区。

#### 5. 复用清单

新增地表区域特效时优先复制以下模式，不要重写：
- 油脂扩散：`oilFrac` + `setScale` 同步缩放 graphics
- 呼吸反光：Tween `alpha` yoyo + ADD 混合
- 火焰成簇：一次性 `add.particles` + `explode` + `delayedCall` 销毁
- 伤害周期：`tickMs` + `GroundEllipse.intersectsEntity`

---

### 火焰/油脂区域特效工作流（2026-07-23 新增；2026-07-28 共享件 combat-fx.js 落地）

**共享件（2026-07-28，新特效优先调用，勿再逐字拷贝）**：`src/effects/combat-fx.js`——
- `launchArcProjectile({textureKey,size,sx,sy,tx,ty,arcHeight,duration,spin,depth,onImpact})` 抛物线投射物（scene 守卫内建，返回 `{sprite,tween,cancel()}`，cancel 供 `_destroyCustomEffects` 防尸体落地结算）；预判/枪口偏移留在调用方。
- `createGroundWarning(x,y,r)` / `keepWarningAlive(warn)` / `destroyWarning(warn)` 红椭圆警示三件套（创建/保活/显式销毁口诀收口）。
- `fireGroundShockwave({x,y,maxRadius,strokeColor,fillColor,flicker,groundLayer,...})` 冲击波扩散圈（闪烁版/纯描边版）。
- `fireRadialLines({x,y,count,innerFrom,innerTo,outerFrom,outerTo,...})` 放射冲击线。
- `burstParticles({texture,x,y,count,config,destroyAfterMs,jitter,depth})` 一次性粒子爆发（(0,0) 陷阱收口；impact_dot 懒生成兜底内建）。
- `fireRadialBurst({x,y,count,color,duration,perspective,...})` 随机放射爆裂线（符文剑命中爆裂共享化；perspective 控制正圆/透视椭圆）。
已迁移：集合体/矿石蜘蛛/提灯/突击特工/手脑/蝇手/胖子僵尸（净删 306 行）。`_hostiles` 重复实现已全部换 `hostilesOf`（amalgam/shounao/fly-hand 遗留 3 处已迁）。火球/冰锥爆炸与飞行尾迹已粒子化（2026-07-28 二轮）：火球爆炸=冲击波圈+ADD 火焰爆发+烟尘余韵，冰锥碎裂=冰屑（重力）+小冰环。符文长剑右键特殊攻击已迁入（三轮）：命中爆裂 RuneSwordExplodeEffect → fireRadialBurst（旧类已删），飞剑补蓝色能量尾迹。

---

### 持续区域特效基类 GroundZone（2026-07-28，毒雾/酸液新区域一律按此开展）

`src/effects/ground-zone.js`（自提灯燃烧区抽出的模板）：三层分离（底面 NORMAL 贴花 growMs 扩散+呼吸 / 反光 ADD 描边错相位呼吸 / 区域粒子簇 (0,0) 陷阱收口）+ 生命周期（timer/tickTimer/oilFrac/flameTimer）自管。**伤害逻辑由调用方 onTick(zone, entities) 回调提供**（读自己的 matk/公式，基类不管数值）；底面/反光/粒子参数全可配（毒雾=绿 tint、酸液=黄绿即可复用）。构造时必须传释放点的 `surfaceContext`（缺省只解析一次），每次 tick 复用 `zone.surfaceContext`，禁止持续区域在宿主上下墙后跟着换层。调用方持有 zones 数组：update 中 `if (!zone.update(dt, entities)) splice`，`_destroyCustomEffects` 中 `zone.destroy()`。已迁移：提灯燃烧区（-152 行）。

---

### 锁定/传导类技能特效模板（2026-08-02，LightningBoltEffect 首航）

`src/effects/lightning-bolt.js` 的 `LightningBoltEffect` 是锁定/传导类（瞬发连接型）技能的标准化特效，同类型直接复用：

```js
EffectManager.add(new LightningBoltEffect(source, target, {
    durationMs: 500,          // 定格显示时长
    fadeMs: 250,              // 淡出时长
    segments: 10,             // 锯齿段数
    jitter: 0.12,             // 锯齿幅度（距离比例）
    widthScale: 1,            // 整体粗细倍率
    colors: {                 // 换配色（如红色闪电/金色锁链）只改这里
        glowOuter: 0x6a4bff,  // 外层辉光（ADD）
        glowInner: 0xa98fff,
        core: 0xdcd6ff,       // 内芯色块（NORMAL）
        white: 0xffffff,      // 白芯
    },
}));
```

**实现要点（改模板前先读）**：
- 中点位移 → 每段中点细分 → Chaikin 切角平滑 → 按 4px 步长重采样成连续色块链（细端圆块仍相连）。
- 每点半径烘焙 0.75~1.25 随机因子（创建时固定）；释放后不再重生成（定格）；末 fadeMs 线性淡出。
- 深度 = 两端实体精灵 depth 较大者 + 1；目标死亡后终点冻结残留。
- 不挂 per-object filters（数量多即卡）——色块堆叠自带辉光观感。
- 离屏预览：`tools/sim-lightning-preview.mjs`（同算法渲染 PNG，调参不入游戏）。

---

### 持续直线魔法束去线条化模板（2026-08-25，夜与火之剑定稿）

适用于夜与火之剑这类持续数秒、随释放者锚点移动、但方向与长度锁定的直线魔法束。不要照搬旧版“定时生成大量细直线”的做法，也不要直接复用雷枪的一次性 tween；持续束应由独立 Effect 类在 `EffectManager` 中按 `dt` 驱动。

- **主体只填面、不描边**：NORMAL Graphics 画暗色承托，ADD Graphics 画外辉光、主色层和青白核心；用多段不规则 ribbon polygon 表现宽度起伏与边缘柔化，禁止用一排 `lineTo/strokePath` 冒充体积。
- **雷枪语言只复用去线条化部分**：沿束轴推进固定参数的色块圆点流，首尾用 `sin(tπ)` 淡化；夜与火另加两侧柔软火舌色块，不复制雷枪加速环，保留技能辨识度。
- **随机参数创建时固定**：mote/wisp 的 phase、速度、偏移、大小只在构造时生成，逐帧仅推进位置；禁止每 100ms 重新分配一批线段数组，避免密集闪烁与持续 GC。
- **起落节奏**：前约 240ms 用 ease-out 把束长从 0 展开，前约 180ms 渐入，结束前约 380ms 渐隐；剑尖与射束末端分别用多层圆形色块形成汇聚和散逸，不使用 per-object filter。
- **逻辑与视觉同源**：System 先完成墙体截断，`NightFlameBeamEffect.length`、持续伤害 `VerticalRect.length` 与调试范围提示必须消费同一个 `clampedLength`；特效类只画画面，不读取目标或结算伤害。
- **跟随与迷雾**：每帧只更新 effect 的 `x/y` 跟随武器释放点，锁定 `angle/length`；NORMAL/ADD 两个 Graphics 都加入 `worldEffectsGroup`，`getFogVisuals()` 必须同时返回两层，结束时成对 destroy。
- **释放阶段必须分离**：`windup → beam → recover` 各自持有明确状态；前摇只播人物攻击动画，到配置释放帧才创建 beam/范围提示并开始持续伤害，持续期定格释放帧。beam 计时结束要先硬销毁伤害范围和视觉，再启动 recover，禁止 recover 仍带光柱或用总墙钟让前摇偷走持续时间。
- **剑尖锚点与图层同源**：Effect 暴露 `setOrigin()`/`setDepth()`，场景在武器姿态及动态深度完成后，用真实 `weaponSprite` 剑尖世界坐标同步主体、辉光与范围提示，并把两层光柱统一放在 `weaponSprite.depth + ε`；不要在逻辑层用玩家中心和估算握点长期推算剑尖，也不要让 ADD 辉光落回武器层下方。

参考实现：`src/effects/nightflame-effect.js` + `src/entities/components/special-attack-system.js`。

---

### 魔法施法快照与统一结算契约（2026-08-24）

- 延迟释放、投射物和持续区域在通过目标/距离/资源门槛后创建 `createMagicCastContext()`；快照固定当前主手法杖制作效果、六维、穿透、暴击率、暴击伤害和法袍魔伤，命中时不得再读取玩家当前装备。
- 所有 `takeDamage(amount, source, type, knockback, hitContext)` 覆写都必须透传第 5 参数。带快照时 `Combatant` 不再预掷一次魔法暴击，统一由 `DamageableEntity` 结算，避免双重暴击或倍率丢失。
- 技能伤害/治疗公式读取 `context.stats`；`lightHeal` 只进入治疗，`magicDamage` 只进入伤害，连锁伤害不能污染治疗。制作词条的连锁、急速等尾段效果也读取施法快照，不能在命中时换杖套利。
- 冷却统一按 `(1 - 法杖急速) × (1 - 法袍减冷却)` 乘一次，系统与快捷栏共用同一技能分类/冷却入口，禁止技能内部重复缩短。
- MP 常态按秒恢复，权威公式来自 `data/combat-formulas.json`：`1.0 + 精神×0.08 + 智力×0.02`；战斗内外不分状态，HUD/属性面板/tooltip 必须统一显示“每秒”。

#### 临时线障碍法术（冰墙口径）

- 逻辑阻挡与视觉段完全分离：一次施法只注册一条带 `_iceWall` 标记的连续 `WallSystem.isoSegments` 线，段数成长只增加冰晶视觉，不增加 Damageable 实体或碰撞对象。
- `_iceWall` 线作为硬障碍进入 PathFinder SpatialHash；创建/销毁调用 `invalidateRegion(bbox)` 局部失效，禁止为短时墙做全图 `invalidateCache()`。场景清理必须按共享线引用去重注销。
- 视觉冰晶不进入 `Game.entities`，但每段提供独立水平 `_faceLine/_faceDepth`，由 `junctionCorrectedDepth()` 与玩家、敌人、友军共用前后遮挡；不能用整堵长墙单一 depth。
- 延迟生成必须携带施法快照与链式倍率，落点伤害读取 `castContext.stats`；禁止在 500ms 破土延迟后重新读取当前法杖或共享系统级临时倍率。

---

### 魔法施法动作标准（2026-08-02 定稿：前摇/第 N 帧释放/倒放后摇/跨步）

魔法类主动技能释放统一走施法动作（空手施法 cast / 法杖施法 staff_cast），规则：

#### 1. 素材与动画注册
- 素材规格：4096×2048，**8 列×4 行 512×512 格**（"4×8 切割"= 4 行×8 列），帧连续（空手 12 帧=0~11、法杖 9 帧=0~8）；**入库前用 pngjs 扫格确认帧序与空白格**（法杖施法首次扫描误判为 4×8 导致错排，已修正）。
- `player-anim-config.json`（双份）条目：`frameCount/frames/frameRate` + **`releaseFrame`（第几帧释放）/`forwardMs`（前摇）/`recoverMs`（后摇）**——全部配置驱动，代码零魔法数。

#### 2. 武器→施法动画选择
- 武器数据（EDM）`castAnimKey: 'staff_cast'` 指定施法动画键；未配置回退 `cast`（GameScene `startPlayerCast` 读取，无硬编码武器类型判断）。

#### 3. 释放流程（GameScene.startPlayerCast）
- 前摇播 forwardMs（默认 500ms）；`animationupdate` 到 `releaseFrame` 帧触发 `onRelease`（魔法实际结算，只一次）；**定时兜底**：事件未触发时按 `(releaseFrame/totalFrames)×forwardMs+40ms` 强制释放。
- 前摇播完自动 `playReverse` recoverMs（默认 250ms）倒放回 idle；含超时兜底收尾。
- **输入全锁**：前摇+后摇期间 update.js 施法分支 early-return（不可移动/攻击/技能/开枪）+ quick-bar 拦截；**后摇阶段空格翻滚可打断**（`_interruptCastRecover` → cancelPlayerCast + triggerDodge）。
- **施法跨步**：前摇沿起手朝向推进 `+30px`（`_castStepMax`，记录起手原点），后摇向原点线性归位（每帧 WallSystem.resolve 防穿墙；被墙钳制也不会回退过头）；打断/死亡清理原点。

#### 4. 接入点
- 系统 trigger 通过 `_startPlayerCast(doRelease)` 包装（第 N 帧才结算）：冰锥/火球**一段不播、二段发射时播**；闪电/圣光（含 Alt 自释放）起手即播。
- 玩家接线：index.js 施法字段、subsystems.js 兜底/死亡复位/`_updateCastStep`、update.js 施法分支、quick-bar 拦截。

#### 5. 坑（必看）
- **`GameScene._updatePlayerAnimation` 每帧状态机会覆盖施法动画** → 释放帧永远到不了、魔法不释放（闪电/圣光曾双双失效）。必须加施法守卫（`_castState !== 'idle'` 时 return）+ 卡死自愈（施法状态但动画未在播 → `_endPlayerCast`）。
- 施法期间隐藏/保留武器：按用户口径**武器保持在 idle 右手持握位置**（不隐藏）。
- 自目标技能：skills.json `selfCast: true` + 系统 `triggerSelf()` + Alt+快捷键（input.js 传 altKey → useSlot(code, altKey)）。

---

### Buff/Debuff 添加标准工作流（新状态效果一律按此开展）

**内置机制：状态免疫（statusImmune，2026-07-25）**：`applyStatusImmune(duration)` 授予后，`addStatusEffect` 与全部 apply*（眩晕/恐惧/激励/中毒/流血/致残/束缚/双易伤）统一拦截其他任何 buff/debuff（免疫本身除外）；永久免疫传 `Number.MAX_SAFE_INTEGER`。范例：`mine-cave.js` 矿洞常驻免疫。

**玩家普通攻击眩晕阶级合同（2026-08-25）**：三段普通攻击继续读取各自 `hitCheck.stunMs`；普通与精英怪完整承受原时长，领主按 `combat-config.json#basicAttackStun.lordResistance` 使用体质线性公式判定豁免，首领保持不受普通攻击眩晕。只有豁免成功才设置短时黄光贴图反馈；技能眩晕、状态免疫和其他控制来源不得复用这次领主专属随机判定。

#### 1. 注册显示配置（src/entities/damageable-entity.js `STATUS_CONFIG`）
`type: { icon, name, color }`——逻辑层 `statusEffects` 数组（{type, duration, remaining, stacks}）与 UI 显示共用。

#### 2. 应用入口（基类方法，如 `applyFear(duration, source)`）
- `addStatusEffect(type, duration, { stacks })`：同类型**持续时间孰长刷新**（内置 Math.max）；`stacks` 显式传入用于叠层语义（层数逻辑在 apply 方法内计算）。
- 来源实体记录到 `this._<effect>Source`（需要参照点的效果，如恐惧逃离）。
- **左上角状态栏（玩家 UI）仅当 `this._faction === 'player'` 时调 `StatusBar.addEffect`**——怪物中的效果不进玩家状态栏。
- 浮动文字（EffectManager FloatingTextEffect）。

#### 3. 行为生效点（三层各就位，缺一不可）
- **玩家**：`player/update.js` 状态分支（参照 stun/fear 模式：输入处理、强制行为、防御取消、`_updateSubsystems`、墙壁解析后 return）。
- **怪物移动**：`systems/movement-system.js` update 前段加分支（死亡/眩晕/束缚/施法/恐惧序列），返回前设 vx/vy + WallSystem.resolve——**MovementSystem 每帧重算 vx/vy，任何移动类效果必须在这里接管，不能只改实体自身 update**。
- **怪物行为中断**：`enemy.js` 基类 update 加 return（技能/攻击决策中断）；自定义怪物类（armored-knight/shounao/fly-swarm 等覆盖了基类 update 的）**各自补同款检查**——基类的检查到不了它们。

#### 4. 数值语义
- 持续时间：ms；叠层：stacks 字段（上限在 apply 方法内 clamp）。
- 效果数值放配置（如 howl.fearMs），不硬编码在逻辑里。
- 辅助计算放基类方法（如 `getFearSpeedMul()`），玩家/怪物/系统共用。

#### 5. 验证
lint / vite build / test-collider / test-craft-sync；实机验证：状态栏图标、持续时间刷新、叠层、到期消失、死亡/场景切换清理。

#### 6. 宝箱岔路分支（zombie-dungeon.js `_addChestBranches`）
- **规则**：从中间列节点向上/下缘伸出链式支路（双向边可往返）；每条 2~3 节点；**有且只有一个战斗节点（首个，精英概率固定 50%）**；尽头固定宝箱事件（event + `node.eventType: 'treasureChest'`，复用节点事件类型记录机制）。
- **条数**：`chestBranches.count` 配置驱动；缺省按地牢 grade 自动计算（F=2、每级 +2，dungeon-config.js `getZombieDungeonConfig`）。
- **独立性**：岔路节点带 `isBranch` 标记，不参与全局精英率标记（`!node.isBranch` 排除）；岔路事件节点走正常事件池；宝箱节点经 node.eventType 强制为 treasureChest。

---

### 状态效果系统（DamageableEntity 统一驱动）

#### 设计原则
- **单一来源**：所有伤害型状态效果（中毒、流血、魔法易伤、无人机易伤）的 `_update*` 方法**只存在于 DamageableEntity 基类**
- **子类不重复**：`enemy.js` 和 `combat-system.js` 不再包含 `_updatePoison`/`_updateBleed` 等方法
- **统一入口**：`DamageableEntity.update(dt)` 调用 `updateStatusEffects(dt)` + 4 个 `_update*` 方法

#### 属性初始化链
```
Combatant 构造函数 → DamageableEntity 构造函数
  _poisonStacks, _poisonTimer, _poisonTickTimer, _poisonEffectId
  _bleedStacks, _bleedTimer, _bleedTickTimer, _bleedEffectId
  _magicVulnerabilityStacks, _magicVulnerabilityTimer
  _droneVulnerabilityStacks, _droneVulnerabilityTimer

Enemy 构造函数只保留特有属性：
  this._poisonEffect = new PoisonEffect();  // 粒子效果（基类没有）
```

#### 为什么之前重复？
`enemy.js` 和 `combat-system.js` 各自维护了一套 `_updatePoison`/`_updateBleed`/`_updateMagicVulnerability`/`_updateDroneVulnerability`。
这意味着：当 `CombatSystem.update()` 和 `Enemy.update()` 都被调用时，**状态效果每帧被更新两次**，导致中毒/流血伤害翻倍。

#### 重构后调用链
```
Enemy.update() → DamageableEntity.update() → updateStatusEffects() + _updatePoison() + ...
CombatSystem.update() → 不再调用状态效果更新（只负责战斗：眩晕、攻击、武器动画）
```

---

### 阶段性进度总结（2026-07-28：经验系统重构一期——pacing 闭环 + 压级衰减）

#### 本次完成（方案经用户验收；二轮：pacingRuns 2.5→5.0 经验效率减半）
1. **pacing 闭环公式**（`src/config/exp-system.js` 唯一口径，配置 `combat-formulas.json enemy.expValue`）：每场产出预算 = 升级曲线段成本 ÷ pacingRuns(**5.0**，2026-07-28 二轮用户拍板减半，同级地牢 4~6 场升一段），按地牢加权击杀（普通×1/精英×2/领主×4/首领×10，由 dungeon-config 机械解析）分摊——**毕业场数是构造出来的**；全清≈4 场、80%≈5 场、直奔 Boss≈8.9 场，探索与升级速度自然挂钩。实测 base：F 25.3 / E 103.8 / D 120.5 / C 144.5。**注意：加权击杀 W 已把"高级地牢房间/战斗更多"摊薄进单价**（F 档 W≈121 / E≈163 / D≈260 / C≈316），单怪经验 F→C 仅 ×5.7，不会随段预算 ×14 膨胀。
2. **压级衰减兜底**：`diff = 玩家等级 − 怪物有效等级`，≤5 级不衰减，超出每级 −15%，rank 下限 普通1%/精英3%/领主5%/首领10%——速刷低级本练级经济死亡，回刷材料不受阻。
3. **怪物有效等级锚定**：`L_m = anchors[grade] + (配置等级 − 3)`（F3/E13/D28/C43/B58/A73），保留种间相对差异；当前仅用于经验/衰减语义。**属性成长（HP/六维按 ΔL 缩放）列入二期，必须实机逐档校验后实装。**
3.5. **越级加成与可视化（2026-07-28 续）**：等级差倍率双向化 `getExpLevelMultiplier`——越级 5 级+每级 +10% 封顶 1.5×（`underdog` 配置块）；经验飘字按 tag 变色（衰减灰/越级绿，`gainExp(amount, tag)`）；出征规则栏衰减档标红；通关结算面板（`_showVictory`：击杀统计/经验合计/探索完成度/距下一级，全清 +10% 奖励，数据源 `src/world/dungeon-run-stats.js`）。
3.6. **属性成长+祭品加持（2026-07-28 二期落地）**：`monsterGrowth`——ΔL=有效等级−配置等级，**直改派生属性**（六维 str 系数仅 0.05，按六维成长攻击不涨；hp 0.10/首领 0.05、atk/matk 0.08、def/mdef 0.04 每级）；`empower`+`src/config/dungeon-empower.js`——出征面板 3 格加持槽（祭品堆叠计强度，普通1~传说6 上限 12，depart 消耗/关闭退还），怪物有效等级 +4S、经验×(1+0.08S)、金币×(1+0.15S)、掉率+1.5pp×S、S≥6 封顶+1，衰减按强化后等级（高等级回刷低级本闭环）；出征左栏只读显示强度/等级区间/属性倍率/奖励倍率/经验效率。
3.7. **清剿奖+连战+节点预览（2026-07-28 三轮）**：`roomBonus.share=0.3`——预算 70% 击杀分摊/30% 按战斗节点开门清算（两池闭环）；`combatStreak`——连战 3 场起 ×1.15 每场 +5% 封顶 ×1.5，empty 不计不断、事件节点清零（`_settleCombatRoom` 统一结算，顶部提示+紫色"（连战）"飘字）；地图悬停节点显示预估经验（`getRoomExpEstimate`，含下一战连战倍率预览与"将中断连战"提示）。**注意：精英战 1 波 6 怪击杀经验低于普通战 3 波 15 怪（补偿=必掉祭品+宝箱房），预览如实显示。**
4. **接入点**：`enemy.getExpValue(playerLevel)` 委托 exp-system；`damageable-entity` 击杀结算传玩家等级；`DungeonMapSystem.init/shutdown` 注入/清空当前地牢类型（setCurrentDungeonType）；`player/base.js getExpForLevel` 与 exp-system `computeMaxExp` 同源；主神空间回退 F 档。
5. **出征界面**：规则栏每档地牢显示推荐等级段（与 bands 配置同源），dungeonList 加 recLevel 元数据。
6. **教训**：加权击杀解析时 nodeCount 必须先减岔路预算再算网格战斗节点（nodeCount 口径含岔路，直接乘战斗比例会把岔路节点两边重复计入，W 偏高 30%+ 稀释经验）。

#### 验证
- `npm test` 四连全过：test-regressions 扩容至 63 断言（闭环不变量/衰减边界/锚定单调/主神空间回退），lint 0 error，vite build ✅。

---

### 阶段性进度总结（2026-08-03：火系高级魔法「陨星坠落」落地）

#### 本次完成
1. **陨星坠落（meteor，火系高级魔法，需法杖）**：鼠标指向处落点 → 陨石直接加速坠落（坠落本身即预告，
   2026-08-03 调整：删除地面警示红圈）→
   大范围爆炸（半径 140+5L px，中心全额→边缘 50% 距离衰减）+ **眩晕 2s**（替换原击退）+ 叠 3 层灼伤 →
   留下熔岩区域（3~6s，每 0.5s 一跳灼烧伤害 + 叠 1 层灼伤；地面燃烧改为**火炬式**——
   参考障碍物火炬的连续发射器（impact_dot + 三色 ADD 上飘），每次施法随机散布 54 个（×3）、
   粒子放大 25%，铺满整个影响区域）。
2. **实现形态**：`MeteorSystem`（暴风雪同套门禁：法杖门槛/施法距离/MP 含链式减免/施法动画第 8 帧释放/
   链式强化/檀木加速/冷却）+ `MeteorStrike` 三阶段特效（坠落/爆炸/熔岩），
   熔岩 = 纯火炬火焰（无油面/反光地面）：随机散布燃烧发射器（椭圆内均匀随机 54 个 ×1.25 放大、自销毁），
   落地火花 `jitter=0` 精确对准落地点（粒子靠速度随机散射，不再整体平移）；
   新增**火焰椭圆边**（标准椭圆 + 5 层软光晕：宽淡外圈 → 窄亮焰心，无硬线条感；无呼吸/无绕圈），
   从落地点一个点**恒定 0.5s** 外扩到最大影响边缘，**扩散到后立即消失**（不再随熔岩持续）
   深度 y-998 位于火炬火焰（y-996）之下；**熔岩燃烧结束（自然到期）即销毁**
   （自然结束路径必须显式 destroy，否则残影泄漏）；复用 `fireGroundShockwave`、`burstParticles`、`Camera.triggerShake`。
3. **接线**：magic-categories（fire+meteor、tier 3）、skills.json 双份、player/index + subsystems 更新与死亡清理、
   quick-bar 触发与冷却同步、skill-manager 四分支（经验/网格/详情/经验说明）。
4. **图标（2026-08-03 二版重做）**：初版与火球同质（都是橙红火团）被否；二版强调**暗色岩石核心 +
   熔岩裂纹 + 长拖尾**（负面词排除 fireball/flame sphere），GLM-4.6V 验收"不是纯火球、是带岩石核心的流星"，
   角点背景抠图 + 去污染入库 1024×1024 透明底。

#### 性能实测（熔岩 54 发射器，cdp-meteor-perf.mjs）
- 基线（无特效）：Phaser 场景帧 0.45ms / 逻辑帧 p50 0.8ms。
- 熔岩阶段：场景帧 0.74ms（**增量 +0.29ms/帧**，约 1.8% 帧预算）、逻辑帧无感知增量；
  54 个连续发射器 + ~460 并发粒子 + GPU 填充对 3080 Ti 均无压力 → **不会造成卡顿**。
- 低端机预案：发射器 54→27 且每点 2 粒（对象减半、视觉近似）即可再省一半。

#### 陨星音效序列（素材库 技能音效/陨星 三件）
- 落地瞬间：`落地.mp3`（无论是否命中都播）；
- 落地后 0.2s：`燃烧1.mp3`；
- 落地后 2s 起：`燃烧2.mp3`，随后**每 0.7s 重叠循环**播放（不等上一条播完），熔岩结束即停。
- 实现：MeteorStrike 帧驱动计时（`_lavaElapsed`），随游戏暂停自然停；命中音效由特效层统一管理，
  不再走 skills.json `sounds.hit`（字段保留指向落地文件作文档）。

#### 陨星数值（V1.1：MP 线性 100→150、爆炸眩晕 2s）
| 字段 | Lv1 | Lv5 | Lv10 | Lv15 | Lv20 |
|---|---|---|---|---|---|
| 冷却 | 32s | 32s | 31s | 30s | 28s |
| MP（线性） | 100 | 110 | 123 | 136 | 150 |
| 射程 | 650px | 650 | 650 | 650 | 650 |
| 爆炸半径 | 145px | 165 | 190 | 215 | 240 |
| 爆炸眩晕 | 2s | 2s | 2s | 2s | 2s |
| 熔岩半径 | 124px | 140 | 160 | 180 | 200 |
| 熔岩持续 | 3s | 3s | 4s | 5s | 6s |
| 爆炸·基础 | 132 | 180 | 240 | 300 | 360 |
| 爆炸·魔攻/智力系数 | 2.6 / 2.85 | 4.2 / 4.65 | 6.2 / 6.9 | 8.2 / 9.15 | 10.2 / 11.4 |
| 熔岩·每跳基础 | 11 | 23 | 38 | 53 | 68 |
| 熔岩·系数 | 0.28 | 0.40 | 0.55 | 0.70 | 0.85 |
| 灼伤层数（爆炸） | 3 | 3 | 3 | 3 | 3 |
| 震屏 | 14 | 14 | 14 | 14 | 14 |

#### 沉淀约定（img2img 换系别主体的坑）
- **换系别主体不要用异系参考**：用暴风雪（冰蓝）图标做参考，无论 denoise 多高、是否中央遮罩 inpaint，
  主体都会被回染成蓝色晶体——"主体替换顽固" + "色调偏置"双重作祟；改用同系火球参考（fireball_icon）后一次通过。
  做同系列图标时，img2img 参考应从**同色调系**里选。
- **两段式确认**：先"高 denoise 换主体"，若底座/框架丢了再"中央遮罩 inpaint 补回"——比反过来（先保框架再换主体）
  更容易收敛，因为主体替换是主要难点。
- **地面燃烧铺满用"火炬式发射器"**：障碍物火炬是 `frequency` 连续发射器
  （speedY 上飘 −50~−110、tint [白,橙,黄]、ADD）。铺满影响区域用**椭圆内均匀随机散布**
  （`rr=sqrt(random)` + 角度，y 压缩 0.5 贴合透视）而非网格——每次施法散布都不同、无呆板感；
  数量/放大直接乘系数（如 54 个 ×1.25）。粒子按区域时长 `delayedCall` 自销毁，强制清理走 destroy。

---

### 阶段性进度总结（2026-08-03：火系初级 Buff 型技能「灼锋焰甲」落地）

#### 本次完成
1. **灼锋焰甲（flameArmor，火系初级魔法，Buff 型新形态）**：施放给自己上 Buff（持续 12→30s，冷却 60s，MP 40→80 随级增长）：
   - 命中附伤：除魔法技能外的任何攻击命中附带魔法伤害 + 四散红色火花粒子；
   - 灼烧光环：每 0.5s 对半径 130+5L px 内敌方造成魔法伤害（同样迸发火花）；
   - 武器火焰（**2026-08-03 实机+GLM-4.6V 验收定稿**）：运行时读武器贴图像素定位剑身区间，火焰整段覆盖剑身
     （密集采样 + 三层光带）、排除剑柄/把手、左右对称、无漂浮；脚底火焰环旋转。
2. **实现形态**：`FlameArmorSystem`（MP 门禁含改造减免/冷却改造/状态效果 + StatusBar 图标/
   到期 `_onFlameArmorEnd` 钩子统一结算经验）+ `FlameArmorFx`（EffectManager 常驻特效）：
   武器火焰**运行时读武器贴图像素定位剑身区间**（长轴不透明宽度突变处=护手/柄起点，按纹理键缓存），
   仅沿剑身每 ~10px 密集采样（每点 2 粒）+ 沿剑身呼吸火焰光带（外橙红/内亮黄/焰心三层线）实现整段覆盖，
   排除剑柄/把手；脚底 footprint 外沿旋转火焰环（椭圆描边呼吸 + 沿环扫过高亮弧 + 6 火点公转火星，
   单发射器多点 explode 控制粒子量）。
   伤害挂钩零侵入：在 `DamagePipeline.applyHit` 加一行，凡物理攻击命中即附伤，魔法技能天然排除。
3. **接线**：skills.json 双份、magic-categories（fire+flameArmor、tier 1）、damageable-entity 状态注册与到期钩子、
   status-bar 配置、player/subsystems（更新/死亡清理/到期钩子）、quick-bar、skill-manager 五分支。
4. **图标**：直接使用用户素材库 `灼锋焰甲/1.png`（1024 透明底，六边形徽章+紫金+火焰剑盾），GLM-4.6V 验收通过，无需再生成。

#### 沉淀约定（Buff 型技能模板）
- **挂伤害用 DamagePipeline 而非攻击代码**：近战/远程/冲刺/风车/推击等物理攻击全部汇聚在 `applyHit`，
  在其中按 `damageType !== 'magic'` 挂钩即可实现"除魔法技能外所有攻击附伤"，天然排除火球/陨星等魔法技能；
  逐攻击类去改必遗漏。
- **状态到期钩子**：玩家专有 buff 走 `addStatusEffect` + `updateStatusEffects` 的 `_onXxxEnd` 钩子
  （类型注册在 damageable-entity.js，方法定义在 subsystems mixin），到期统一结算经验与回收特效；
  死亡/场景切换走系统自己的 `clearBuff`（不结算经验，与暴风雪/陨星同口径）。
- **持续跟随特效**：Buff 类粒子特效做成 EffectManager 常驻 effect（active 标志 + update 内自检 buff 是否仍在，
  过期 destroy 自动回收），不要挂 GameScene 每帧显式清理；常驻火焰粒子 tint 以红/黄为主
  （纯白在 ADD 混合下盖掉色相，观感会"约等于纯白"）。
- **"附着在武器上"要读武器精灵/贴图，不要用玩家朝向估算**：武器姿态由 GameScene 的 weaponSprite 每帧
  （rotation + flipX + displayWidth/Height）决定；竖版贴图（剑/杖）剑身沿 local Y、尖端在贴图顶部，
  横版（枪械）沿 local X、视觉尖端方向 = flipX ? -1 : +1。剑柄/护手排除靠贴图像素分析
  （宽度突变阈值 55% 最大宽），全覆盖靠密集采样 + 沿剑身光带，粒子深度要高于武器（player.y+30）
  否则被剑身遮挡看起来"错位"。

#### 灼锋焰甲数值（V1.1 定稿：持续 12→30s / 冷却 60s / MP 随级）
| 字段 | Lv1 | Lv5 | Lv10 | Lv15 | Lv20 |
|---|---|---|---|---|---|
| 冷却 | 60s | 60s | 60s | 60s | 60s |
| 持续 | 12s | 15s | 20s | 25s | 30s |
| 持续/冷却 | 20% | 25% | 33% | 42% | 50% |
| MP | 40 | 48 | 58 | 69 | 80 |
| 命中附伤基础 | 12.5 | 22.5 | 35 | 47.5 | 60 |
| 命中附伤 魔攻/智力系数 | 0.41 | 0.65 | 0.95 | 1.25 | 1.55 |
| 光环每跳基础 | 7 | 15 | 25 | 35 | 45 |
| 光环 魔攻/智力系数 | 0.15 | 0.27 | 0.42 | 0.57 | 0.72 |
| 光环半径 | 136px | 160px | 190px | 220px | 250px |
| 光环每跳间隔 | 0.5s | 0.5s | 0.5s | 0.5s | 0.5s |
| 经验：命中/击杀 | 1 / 8 | — | — | — | — |
| 经验：多命中/多击杀 | 5 / 10 | — | — | — | — |
| 升级经验公式 | 100+(L−1)×100（1→20 累计 21000） | | | | |
| 附伤/光环对枪械 | **生效**（投射物命中走 DamagePipeline，每发子弹命中附伤+火花） | | | | |

---

### 阶段性进度总结（2026-08-05：电系中高级技能 + 感电叠层机制落地）

#### 本次完成
1. **电系专属状态「感电」（electrified，新 Buff/Debuff）**：每层使目标受到的电系伤害 +3%；**叠满 5 层自动触发「过载」**——眩晕 1.2s + 对周围 150px 每个敌方单位传导一次电击（`20 + matk×1.2 + int×1.2`）并清空全部层数。与冰系 chill→冻结平行，电系性格 = 伤害放大 + 连锁爆发。
   - 实现全流程：`damageable-entity.js` STATUS_CONFIG + `applyElectrified(stacks, duration, source)`（免疫拦截→叠层→满层过载→StatusBar→飘字）+ `_updateElectrified` 到期清空；`status-bar.js` 条目（desc 悬停）；伤害结算段新增 **`damageType='electric'` 子类型**（按魔法伤害口径结算 mdef/魔力易伤/法袍加成/暴击符文），并乘 `(1 + 0.03×层数)`；`docs/buff-reference.md` 登记。
2. **闪电（初级）调整**：不再造成击退（移除 `applyKnockback` 结算与面板行）；命中叠加 1 层感电（4s），融入电系叠层闭环。
3. **雷暴领域（stormDomain，电·中级，tier 2 需法杖）**：移动雷云跟身炮台——头顶雷云（`storm-cloud-fx.js` v2：参照暴风雪乌云——运行时柔边贴图 + **深蓝黑/靛蓝/电光蓝四层色块**云团 + 云内电弧锯齿 + 蓝色云雾/电花/坠落电弧粒子，深度恒为 1<<28；**不画云底圆环描边**）跟随自己，持续 10→13s（L1 起 10s），每 0.9s 对雷云范围内（220+8L px）最近敌人落雷：主目标全额 + 邻近传导（每 8 级 +1 目标、每跳衰减 30%）+ 250ms 打断眩晕 + 感电 1 层。CD 30s / MP 80→120。落雷数随持续增长（L1≈11 → L20≈14）。
4. **贯穿雷枪（thunderLance，电·高级，tier 3 需法杖）**：**长按快捷键蓄力**（input.js `_chargeKeyHeldCode` 长按检测 + quick-bar `thunderLanceKeyDown/KeyUp`，参照无人机长按模式；**按键松开安全网**：系统记录绑定键 `setHoldKey`（keydown 时 Input.keys 已含该键标记 `_holdKeyPressed`），update 每帧检测键已松开但 release 未被调用（首次进入绑定未就绪走 useSlot 等路径）→ 自动 release，杜绝蓄力到满；鼠标点击二段式不启用安全网。施法姿势释放帧定格且不可移动——`startPlayerCast` 新增 `holdAtRelease`，`resumePlayerCastHold` 收尾回 idle；**蓄力期间瞄准随鼠标实时变化**，最终释放方向以松开/满蓄时鼠标为准，鼠标转到背后时翻转玩家贴图朝向（flipX）；**伤害随蓄力比例**：蓄力 0.5~2.5s → 20%~100%（满蓄 ×chargeBonusMul 1.3），**不足 0.5s 释放失败：不进入冷却（清 CD）+ 返还 MP**；**手部蓄力汇聚光球** `charge-orb-fx.js`：粒子向手握点汇聚 + 光球随进度放大，成功爆散/取消淡出；**手部锚点 = 施法武器握把（weaponSprite，法杖中段=前伸手，CDP 实机确认暂停帧手位）优先 + 手层内容质心回退**，每帧取（不锁定，翻转朝向时跟随镜像）；眩晕/冻结/死亡自动取消；目标地点无提示特效）→ 沿鼠标方向射出**电磁炮直线光束**（`spawnRailgunBeam`：白蓝三层辉光直线 + 4 个加速环从后往前扫过 + **附着电流=色块圆点链**（见特效沉淀⑨），非蛇形闪电；widthScale 4.0，残留 373ms）——**锥形判定贯穿路径上所有敌人**（视线可达、按距离排序），命中目标**沿光束方向击退 50→150px 随等级**，**感电层数越高伤害越高（每层 +10%）**，命中叠 2 层感电；射程尽头/撞墙处电爆（冲击波+放射线+粒子，无天顶光柱/无感电地面蓝圈）。CD 32→28s / MP 120→155，射程 915→1200px（随等级）。
   - **2026-08-05 特效沉淀**：① `LightningBoltEffect` 新增 `uniform` 等宽模式（关闭施法端粗→目标端细，半径恒定 + 整体偏细）——感电过载电弧已切细等宽（`widthScale: 0.45`）；② 雷暴领域云删除云底蓝色椭圆描边，只保留云团/电弧/粒子；③ 天顶闪电光柱抽为共享件 **`spawnLightningColumn`（combat-fx.js ⑧）**——白蓝梯形闪电柱一闪而逝（贯穿雷枪已不再使用：施法者/终点光柱均取消）；④ 电磁炮直线光束抽为共享件 **`spawnRailgunBeam`（combat-fx.js ⑨）**——笔直三层辉光直线 + 4 加速环，widthScale 4.0；⑤ **蓄力定格模板**：`startPlayerCast({ holdAtRelease })` 第 releaseFrame 帧触发 onRelease 后**先完成前摇跨步站稳（+30px）**，再冻结动画（timeScale 0）保持 casting 输入锁定，`resumePlayerCastHold()` 恢复播完前摇→倒放后摇回 idle，取消走 `cancelPlayerCast`；⑥ **蓄力汇聚光球模板**：`ChargeOrbFx`（charge-orb-fx.js）——锚点取施法武器握把/手层质心（见正文），粒子从手周围椭圆环四面八方生成、寿命=到达时间（视觉"收进"光球），`finish()` 爆散 / `cancel()` 淡出；⑦ **电流去线条化模板（光柱附着电流）**：参考 `LightningBoltEffect` 的"色块圆点链"避免线条感——沿光柱**平行方向**生成短折线，重采样成小圆点色块链（辉光 ADD + 白芯），**首尾用 sin 权重不规则淡出**（两端熄灭、中间亮，每点叠加随机断续），半径随光柱弱缩放（√widthScale），90ms 分段伪随机跳变闪烁——任何"光束/电流"类特效都按此做，禁止纯线条 stroke。
   - **2026-08-05 重设计说明**：原「雷神审判」为定点蓄力连环 AOE，与暴风雪（定点持续）/陨星（定点爆发）设计重叠，已整体替换为「贯穿雷枪」（蓄力贯穿型，追踪/直线操作）；旧组件 thunder-judgment-system.js 与图标 雷神审判.png 已删除。
5. **接线**：skills.json 双份（25 技能）、magic-categories（electric 三技能 + tier 2/3）、玩家四件套（index.js 导入/字段/实例化，subsystems.js update + 死亡复位 `clearCloud`/`clearStorm` + `_initSkills` 兜底）、quick-bar（触发分支 + 冷却同步 + `_getTotalCooldown` 名单）、skill-manager（三处 skillList + effectText + 经验函数 + 详情面板 + 经验说明）。
6. **图标（2026-08-05 LoRA + 不规则切割 + HSV 明度柔光定稿）**：`assets/skills/雷暴领域.png` / `贯穿雷枪.png`
   提示词：**irregular low-poly faceted surface with facets of uneven sizes and shapes, not a uniform
   grid + soft diffuse glossy sheen + no harsh contrast + translucent like crystal glass**，
   12 步重出（雷暴 seed 111111 / 雷枪 seed 151515，不规则切割 + 水晶通透 + 深紫高饱和）。
   **反光后处理必须用 HSV 只压明度（V）对比、完整保留色相（H）/饱和度（S）**——第一版 RGB 向中值压缩
   导致饱和度下降、蒙雾感（用户反馈"色彩失真蒙雾"）；HSV 版 S 中值完全保留（雷暴 158 / 雷枪 135），
   V 标准差 -41%（雷暴 43.8→25.7、雷枪 46.8→27.7），GLM 复验
   **柔和漫反射 + 饱和纯正无蒙雾 + 不规则切割 + 水晶通透全项通过**。归一后同系列规格
   （雷暴 786×932 / 0.84 / fill 69.9% / cy+28，aspect 与 fireball 一致；贯穿 800×918 / 0.87 / 70.0% / cy+28），
   废案与 .bak 已清。
   - **教训沉淀**：技能图标正式出图必须走 `flux2-klein-4b` + klein-skillicon-v2 LoRA（触发词开头）；
     **steps ≥12**；切割写 irregular / uneven sizes / not a uniform grid；Klein+LoRA 对"不规则切割"
     稳定绑定强对比高光（提示词/cfg/步数压不住）→ 入库前做**HSV 明度柔化**：`convert('HSV')` 后
     只把紫面（b>r>g）的 V 向中值压缩（strength≈0.55，-40% 明度差），H/S 不动——
     **禁止 RGB 向中值压缩**（会掉饱和出雾感）；主体写 translucent like crystal glass；
     电系主题不写 dark/gray 云；归一后复核 aspect >5% 换 seed；多 seed 抽选 + GLM 逐项验收。
#### 沉淀约定（电系叠层模板）
- **感电消费点 = takeDamage 伤害结算段**：新增 `damageType='electric'` 与 magic 同口径结算（mdef/魔力易伤/法袍秘法/暴击符文都认），再乘感电系数——不要在各技能系统里手乘，避免遗漏。
- **叠层转质变阈值 5 层**：`applyElectrified` 内部达到即触发过载并清空（重复施放可再次叠层），与 chill 20→冻结同模式；数值走参数不硬编码（stacks/duration 由 skills.json effectFormula 传入）。
- **移动雷云形态**：跟身持续类技能 = 系统组件自管计时 + EffectManager 常驻特效（`StormCloudFx`，active 自检 buff 是否仍在），死亡/场景切换走 `clearCloud` 不结算经验（与灼锋焰甲同口径）。
- **蓄力连环形态**：`createGroundWarning` 保活续命（每帧 `keepWarningAlive`），结束时必须 `destroyWarning` 显式销毁；阶段状态机放系统 `update(dt)` 里推进（warning → storming → final → end）。
- **优先目标**：落雷优先感电层数最高者（并列取最近），让「先叠层再引爆」的连招有明确收益。
- **fallback 收敛 + 怪物复用（2026-08-05 收尾沉淀）**：① 所有魔法系统数值缺省统一收敛到顶部
  `XXX_DEFAULTS` + `{ ...DEFAULTS, ...baseEffect }` 合并，skills.json 为唯一真源，禁止业务代码散落
  `|| 默认值`（详见「技能添加标准工作流」§2）；② 贯穿雷枪瞄准参数化 `trigger(optAimX, optAimY)`——
  玩家=鼠标、怪物=面向方向（缺省自身前方 100px）；③ 怪物也生成蓄力光球，锚点暂用
  `_defaultChargeAnchor()`（身体中线上方）占位，怪物绑定点做好后替换该锚点即可。
#### 电系数值（V1.1 定稿：2026-08-05 精调——雷暴领域持续/传导成长、贯穿雷枪蓄力收益上调）
| 雷暴领域 | Lv1 | Lv5 | Lv10 | Lv15 | Lv20 |
|---|---|---|---|---|---|
| 冷却 / MP | 30s / 80 | 30 / 88 | 30 / 99 | 30 / 109 | 30 / 120 |
| 持续 | 10s | 10s | 11s | 12s | 13s |
| 雷云半径 | 228px | 260 | 300 | 340 | 380 |
| 每雷·基础 / 魔攻系数 | 29 / 0.50 | 45 / 0.70 | 65 / 0.95 | 85 / 1.20 | 105 / 1.45 |
| 传导目标（额外） | 1 | 1 | 2 | 2 | 3 |

| 贯穿雷枪（电磁炮） | Lv1 | Lv5 | Lv10 | Lv15 | Lv20 |
|---|---|---|---|---|---|
| 冷却 / MP | 32s / 120 | 32 / 127 | 31 / 136 | 30 / 145 | 28 / 155 |
| 蓄力 | 2.5s（贯穿伤害 ×1.3） | 2.5s | 2.5s | 2.5s | 2.5s |
| 贯穿射程 | 915px | 975 | 1050 | 1125 | 1200 |
| 贯穿·基础 | 124 | 180 | 250 | 320 | 390 |
| 贯穿·魔攻/智力系数 | 2.06 / 2.30 | 3.1 / 3.5 | 4.4 / 5.0 | 5.7 / 6.5 | 7.0 / 8.0 |
| 感电增伤 | 每层 +10% | 每层 +10% | 每层 +10% | 每层 +10% | 每层 +10% |

---

### 阶段性进度总结（2026-08-23：光魔法中级「圣辉领域」+ 高级「圣光审判」落地）

- **光系三段补齐**：holyLight(初级定点) → sanctuaryDomain(中级跟身光环：友疗+净化+僵尸压制) →
  holyJudgment(高级蓄力天降巨柱：蓄力比例伤害/半径、不死净化斩杀、友方清全部负面)。
  设计纪律：中级=跟身持续辅助域（错开雷暴跟身炮台），高级=蓄力大圈审判（错开陨星瞬发定点、雷枪蓄力直线）。
- **数值/接线模板沿用**：skills.json 双份 effectFormula 公式串 + magic-categories tier 法杖门槛 +
  玩家四件套（index 导入/字段/实例化 + subsystems 死亡复位/_initSkills 兜底/update）+ quick-bar
  （触发分支/长按键组/冷却同步/_getTotalCooldown 名单）+ skill-manager（三列表/升级提示/经验函数/
  详情/训练说明五处）。新增技能照此清单逐处对账，漏一处即静默失效。
- **ChargeOrbFx 配色板**：新增可选 palette 参数（tints/glowOuter/glowInner/core），默认电系蓝不变；
  非电系蓄力技能传自己的色系（圣光审判=金色 HOLY_PALETTE）。
- **净化实现口径**：遍历 statusEffects 按 CLEANSE_TYPES 清单 removeStatusEffect，感电另清
  `_electrifiedStacks`；领域每 2s 每人移除 1 个，审判落柱全清。Boss/领主经 `rank==='boss'/'lord'`
  豁免净化即死；净化致死用 `takeDamage(hp×10, 'magic')` 保证穿防击杀。
- **图标教训**：normalize-skill-icon.py 的全图纯白键控会把发光白芯抠穿成洞——发光系（光柱/圣环）
  图标入库必须走无白键归一（scratch normalize_icon_nokey.py）或先验证中心 alpha；
  check-icon-sizes.py 只量 bbox 不查中心空洞。
- **实机验证探针**：tools/cdp-holy-magic-verify.mjs（领域激活/治疗/净化/僵尸每跳致死 +
  审判法杖门禁/蓄力不足返还/满蓄击杀/净化斩杀鉴别）。探针注意：MinerZombie 等敌人真实 hp 在
  `e.hp`，`e.data.hp` 是静态配置副本，读错字段会误判「没掉血」。
