# 变更日志

## 格式
每次对话结束时记录：
- 对话日期
- 修改的文件
- 修改内容摘要
- 测试结果
- 已知问题

## 2026-07-18（地牢地图机制确认 + 瞄准镜头失效修复）

### 对话：地图自适应/拖动边界排查 + 瞄准模式修复
- **地牢地图（排查确认，无需改动）**：自适应算法在位——`_centerRouteMap` 按节点包围盒计算 `mapScale = min(scaleX, scaleY, 1.5)` 并居中（褐色面板即地图画布背景 #1a1814）；拖动边界在位——`_clampMapOffset` 每次拖动后执行，地图画布始终覆盖显示区域，拖不出屏。
- **瞄准镜头失效（根因修复）**：主手为枪械且副手有盾时，右键先被盾防御状态管理拦截（enterDefense），随后"防御中跳过攻击输入"提前 return，瞄准分支永远执行不到。修复：盾防御状态管理加主手枪械判定 `_isMainGun`——主手是枪则右键优先瞄准模式（不进入盾防御，残留防御状态强制退出）；近战/空手右键照旧盾防御。瞄准偏移链路（update.js → Camera.aimOffset → camera.js 平滑 → GameScene scroll 同步）验证完好；瞄具改造（highPowerScope 900px/redDotScope 300px/无瞄具 100px）随 sparse `_craftEffects` 正常生效。
- **测试结果**：`npm run lint` ✅；`npx vite build` ✅；`test-collider` ✅。
- **已知问题**：实机待验证——①枪械+盾右键出瞄准镜头偏移；②近战+盾右键盾防御不回归；③三档瞄具偏移距离差异。

## 2026-07-18（诅咒铠甲事件必刷铠甲骑士 + 单波定制遭遇）

### 对话：事件强制怪物链路 + 单波构成
- **强制怪物链路**：cursedArmor（被诅咒的板甲）力量拆解失败结局 `forceMonsters: ['armoredKnight']` 经 handleNewDungeonEvent → node.forceMonsters → ZombieDungeonCombat 第 5 参，首波 unshift 插入（tier 'forced'）；`createArmoredKnight` 工厂登记入 ZOMBIE_FACTORY_MAP（family 骑士不进怪物池随机）。
- **单波定制遭遇**：结局配置 `encounter: { combatWaves: 1, monstersPerWave: 5, tierWeights: {normal:1, elite:0} }` → node.encounterOverride → 构造第 3 参（原 boss 战 override 机制复用）；`nextWaveMonsterClasses` 新增强制怪扣减（drawTarget = monstersPerWave − forcedCount）——诅咒铠甲战斗 = **1 波 × (1 铠甲骑士 + 4 普通池随机)**，composition/tierWeights 两分支均按扣减后名额抽取。
- **测试结果**：`npm run lint` ✅；`npx vite build` ✅；`test-collider` / `test-craft-sync` ✅。
- **已知问题**：实机待验证——诅咒铠甲战斗单波 5 只（1 骑士+4 普通）、无第二波；forceMonsters 仅僵尸系地牢生效。

## 2026-07-18（骑士冲锋朝向/二连击突进/格挡与玩家眩晕规则）

### 对话：铠甲骑士三项 + 玩家眩晕两项
- **冲锋回头根因**：追踪冲锋每帧 `flipX = cos(rotation) < 0`，目标贴近正上/下方时 cos 近 0 符号抖动、越过目标瞬间方向翻转 180°。修复：`_chargeFaceDir` 死区朝向——仅 `|dx| > 20px` 才更新水平朝向，冲锋期间 flipX 只读死区值，移动仍全量追踪。
- **二连击突进**：参考突变体-3 连击突进——`_startCombo` 向目标方向记录 `lungeDistance: 30` 总位移，`_updateCombo` 每帧按 `lungeSpeed: 500` 插值执行（WallSystem 碰撞，不瞬移）；新增 `combo.triggerRange: 75`（发动条件，伤害判定 range 仍 125），减少空挥。
- **格挡 1.5s**：`block.duration` 2000→1500，BootScene defend 动画 duration 同步 1500；格挡弹反眩晕 2s/击退 100px 与玩家盾基础弹反属性一致（此前已实现，本次确认）。
- **眩晕禁止技能/物品**：`QuickBar.useSlot` 加 `player.isStunned` 拦截（技能与物品同一入口）。
- **玩家眩晕终止所有动作**：`applyStun` 调用新 `_cancelAllActionsForStun()`——主副手攻击动画回 idle、闪避/冲刺(_dashState)/风车(含范围特效)/推击/特殊攻击/蓄力全部复位、四槽换弹中断（含单发装填）、退出无人机操控、速度清零——眩晕期间只播放 idle 精灵图（update 眩晕分支本就阻断移动/攻击输入）。
- **测试结果**：enemy-config.json 校验 ✅；`npm run lint` ✅；`npx vite build` ✅；`test-collider` / `test-craft-sync` ✅。
- **已知问题**：实机待验证——①冲锋全程不再回头；②二连击 30px 插帧突进观感与 75px 触发；③格挡 1.5s 动画对齐；④玩家被眩晕后动作全断、只播 idle、技能/物品禁用。

## 2026-07-18（七项修复与优化）

### 对话：换弹中断/按钮布局/无人机/初级地牢/骑士音效/清怪/冲锋速度
- **Super90 换弹切枪中断**：`switchWeaponMode` 成功后遍历四槽取消全部换弹状态（reloading/reloadTimer/singleReloadMode 清零），切枪立即中断换弹动作。
- **秒杀按钮遮挡修复**：根因=两按钮共用 `.invincible-toggle`（同坐标 left:124px）。game-style.css 新增 `#oneHitKillToggle { left: 180px; }`，无敌还原、秒杀居右。
- **无人机**：
  - 时长根因=skills.json duration 公式 `5+level×0.5`（lv1 仅 5.5s），按拍板改 `15+level×1`（lv1=16s/lv20=35s，双份 JSON 同步）；
  - 贴图根因=iconImage 指向从未存在的 drone_skill.png/shotgun_mastery.png（404→emoji 兜底），改为已存在的 `assets/skills/无人机.png`、`assets/icons/S12k-icon.png`（subsystems 兜底 3 处同步）；
  - 长按阈值 `input.skillLongPressMs` 300→1500；
  - 新增 `_holdPosition` 悬停：长按飞到鼠标点后原地停留、不再跟随玩家，再次长按飞往下一点，重新部署时重置；短按维持原 toggle（部署/操控/退出）。
- **僵尸地牢-初级精英混入**：根因=beginner 缺 `encounters` 键，普通战斗回退 DEFAULTS（20% 精英）。补 encounters：normal 全普通怪（3 波×5，tierWeights 1/0），elite 显式复制精英构成备用；boss 战 bossEncounter 不受影响。
- **铠甲骑士音效**（sounds 配置块驱动）：素材 3 个 mp3 复制到 `assets/sounds/enemies/armored_knight/`；walk 每 500ms 播 walking.mp3；combo 帧 6/17 播 attacking.mp3（与伤害帧 12/25 独立）；格挡每次受击播 defending.mp3（替换原通用 wood_thud）；冲锋每 300ms 播 walking.mp3、撞中目标播 defending.mp3。
- **主神空间清怪**：删除胖子僵尸/普通僵尸/集合体三个生成调用（方法保留备用），只留铠甲骑士与测试靶/DPS 靶。
- **冲锋速度**：charge.speed 900→300（配置）。
- **测试结果**：全部 JSON 校验 ✅（skills 双份同步一致）；`npm run lint` ✅；`npx vite build` ✅；`test-collider` / `test-craft-sync` ✅。
- **已知问题**：实机待验证——①切枪中断换弹手感；②两按钮不再重叠；③无人机 16s 时长/新图标/长按 1.5s 飞行+悬停；④初级地牢普通战斗不再出精英；⑤骑士音效各触发点；⑥300px 冲锋速度观感。

## 2026-07-18（新怪物：铠甲骑士）

### 对话：新增精英怪铠甲骑士（按添加怪物工作流）
- **素材**：`素材库/怪物/铠甲骑士` 5 张精灵图（8×4 网格 512×512）复制到 `assets/enemies/armored_knight/`——idle 1 帧 / walking 11 帧 / attacking 32 帧 / attacking-2 19 帧 / defending 14 帧。
- **配置**（`enemy-config.json` armoredKnight，全部配置驱动）：精英、HP 800、speed 187.5（同僵尸）、六维按突变体-3 ×1.15 取整（str58/dex35/con46/int6/wis12/luck7，公式派生 atk≈47/def≈86）、level 10（经验精英 ×2 = 120）、family 骑士（不进僵尸地牢怪物池）。`attackSkills` 块集中管理三技能数值。
- **技能**（`armored-knight.js`，自定义 AI 关闭通用近战）：
  - 二连击挥砍：32 帧 2s，第 12/25 帧各判定一次 atk×1（range 125），CD 4s；
  - 持盾冲锋：瞬间发动（无蓄力），900px/s 逐帧追踪目标，命中 atk×2 + 击退 200px + 眩晕 2.5s，撞停或超 1800px 止，CD 10s；**冲锋期间 `_parryImmune`**（集合体同机制，结束后还原）；目标弹反成功则不受伤不眩晕只保留击退（复用玩家盾 `_lastParried` 判定）；
  - 举盾格挡：玩家攻击动作临近（260px）时面对目标举盾 2s，期间不可移动/不可其他动作，`takeDamage` 覆写——玩家来源伤害全部按弹反处理（免伤 + 近战攻击者眩晕 2s 击退 100px，弹反免疫者除外），CD 6s；附 `shieldSystem._lastParried` 代理接入 DamagePipeline 抑制击退/craft 命中效果（与玩家盾同口径）。
- **注册**：BootScene 5 组精灵图 + 5 个动画（combo/defend 单次、charge 循环）；enemy-types.js 导入导出；`game.js spawnMainArmoredKnight` 主神空间生成 1 只测试（永久警戒）。
- **测试结果**：enemy-config.json 校验 ✅；`npm run lint` ✅；`npx vite build` ✅；`test-collider` / `test-craft-sync` ✅。
- **已知问题**：实机待验证——①三技能动画与帧判定同步；②冲锋追踪手感与 1800px 截停；③格挡弹反对玩家近战/枪械/技能各路径表现；④渲染比例（spriteSize 220/footOffsetY 43 按帧内容推算，可能需微调）。

## 2026-07-18（改造系统深化：registry 驱动聚合 + craft-system 拆分）

### 对话：技术债清理——三角机制重构 + craft-system.js 拆分
- **registry 三角重构**：新建 `src/ui/craft/craft-effects.js`——`aggregateCraftEffects` 按 `CRAFT_EFFECT_REGISTRY[key].applyMode` 聚合（flag=布尔 OR / override=后选覆盖 / add·multiply=求和），替代 `_applyModEffects` 中 44 行人工逐键收集；返回稀疏对象（与旧全量零值对象在消费端 falsy 判断下等价，语义抽样测试 PASS）。**新增改造效果只需 craft-config.json 加 effects + registry 注册条目，聚合自动生效**（`applyModEffectsToPlayer` 同迁弹药重初始化）。
- **craft-system.js 拆分**：891 → 741 行。贴图回退链抽为 `src/ui/craft/weapon-image.js`（`resolveWeaponImageSrc`，含 ItemDatabase.getByWeaponId 反查）；`_applyModEffects` 变为薄封装；删除已无用的 ItemDatabase 导入。DOM 拖拽/编辑模式/弹窗保留在 craft-system.js（UI 控制器），外部 API（open/close/_updateUI/_getCraftConfig 等）不变。
- **test-craft-sync.mjs 适配**：收集腿改为结构性断言（craft-effects.js 引用 CRAFT_EFFECT_REGISTRY+applyMode，收集≡注册），保留配置⊆注册、配置⊆消费两腿，新增 registry 条目结构校验（applyMode 合法 + display 存在）。
- **测试结果**：`node scripts/test-craft-sync.mjs` ✅（38 配置键/39 注册/聚合驱动✓/38 消费）；聚合语义抽样（flag/override/add）PASS；`npm run lint` ✅；`npx vite build` ✅；`test-collider` ✅。
- **已知问题**：实机待验证——改造面板装配/替换配件后效果与 tooltip 显示与重构前一致。

## 2026-07-18（无人机长按指挥飞行 + 易伤暴击修复）

### 对话：无人机操作优化 + 易伤 buff 暴击率排查
- **排查结论（两个真 bug）**：
  1. **易伤暴击率加成未进实际伤害判定**：`Combatant.takeDamage` 的真实暴击率只算 `source.crit + 附魔 - critRes`，漏加 `droneCritBonus`；`DamageableEntity` 里虽加了无人机暴击率，但那条 isCrit 只喂 criticalStrike 经验、不影响伤害。修复：`combatant.js` finalCritRate 补 `droneCritBonus`（与经验判定同口径）。
  2. **易伤伤害加成双重应用**：`Combatant.takeDamage` 与 `DamageableEntity.takeDamage` 各乘了一次 `(1 + droneBonus)`（Enemy 继承链两级都走），实际增伤高于描述（如 12% 变 25.4%）。修复：删除 Combatant 层的重复块，统一由 DamageableEntity 在防御计算后应用一次。
- **长按指挥飞行**：`game-config.json` 新增 `input.skillLongPressMs: 300`；input.js 对无人机技能键按下只记录、松开时交 `QuickBar.droneKeyUp` 按时长分流——短按维持原 toggle（部署/操控/退出），长按 `_droneMoveCommand` 调 `DroneSystem.commandFlyToMouse()`：`Renderer.screenToWorld` 取鼠标世界坐标设 `_moveTarget`，无人机自动飞往（撞墙用 WallSystem.resolve，0.5s 无进展放弃防卡死，到达 12px 内停止；操控模式 WASD 输入立即取消命令）。未部署时长按 = 先部署再飞行（部署等同施放，受冷却限制）。
- **测试结果**：game-config.json 校验通过；`npm run lint` ✅；`npx vite build` ✅；`test-collider` / `test-craft-sync` ✅。
- **已知问题**：实机待验证——①长按下无人机飞鼠标点、短按原行为不回归；②被易伤目标的暴击触发率上升；③易伤增伤数值与技能描述一致（不再双倍）。

## 2026-07-18（集合体投掷音效前置 + 首领经验确认）

### 对话：投掷音效再前移 1.5s + bossMultiplier 确认
- **投掷音效前置调度**：`attackSkills.throw` 配置 `soundPreMs`（当前 750）；`amalgam-zombie.js` 新增投掷预备机制——`_decideAttack` 命中投掷时立即播放 throwing 音效并置 `_throwPending = soundPreMs`（同时进入冷却防止重复触发），update 循环倒计时到点后 `_startAttack('throw')` 才开始攻击动作，`_throwSoundPlayed` 抑制攻击内重复播放。音效起点 = 攻击动作前 soundPreMs。预备期间目标丢失则自然取消。（初版 1500ms，实测后后移 750ms 对齐听感）
- **首领经验 ×10（确认无需改动）**：`enemy.js getExpValue()` 已按 `rank === 'boss'` 应用 `combat-formulas.json` 的 `bossMultiplier: 10`；amalgamZombie（rank boss、level 7、无 expValue 覆盖）击杀经验 = (10 + 7×5) × 10 = **450**，召唤物闸门不受影响。
- **测试结果**：enemy-config.json 校验通过；`npm run lint` ✅；`npx vite build` ✅。
- **已知问题**：实机待验证——音效起点与抬手/出手的听感对齐（不合适改 `soundPreMs`）；注意攻击动作整体后移 1.5s（玩家多 1.5s 反应时间）。

## 2026-07-18（集合体投掷音效）

### 对话：集合体投掷音效启用 throwing.mp3 + 音效前移
- `data/enemy-config.json` amalgamZombie `sounds.throw` 由占位 `idle.mp3` 改为 `assets/sounds/enemies/amalgam/throwing.mp3`（素材早已复制到项目，仅配置未接）。
- **音效前移（音画同步）**：`attackSkills.throw` 新增 `soundLeadMs: 2000`；`amalgam-zombie.js _updateThrowFire` 拆出独立音效触发点 `max(0, fireT - soundLeadMs)`（`_throwSoundPlayed` 标志，`_startAttack` 重置）——出手帧 16/25（1200ms）减去 2000ms 前移量后锚定到攻击动画起点，音头覆盖抬手过程，出手/落地与画面对齐。
- **测试结果**：enemy-config.json 校验通过；`npm run lint` ✅；`npx vite build` ✅。
- **已知问题**：实机听感待确认（如前移量不合适，改 `soundLeadMs` 即可）。

## 2026-07-17（遗留 bug 与技术债务分批清理）

### 对话：7 阶段 19 项清理（v0.198+）
- **文案/键值级（6 项）**：宝箱怪战斗文案与实刷 3 只一致；附魔成功音效由不存在的 `SoundManager.play('enchant_success')` 改为 `playFile(levelup_cyber_5s.wav)`；「沉重」文案改"攻击速度降低约26%"（×1.35 间隔的真实口径）；enchant-config 卷轴 weaponTypes 删死值 `'melee'`；符文重构文案 20px→40px（与实现一致，双份 craft-config.json 同步）；锐利符文文案删"右键特殊攻击"前缀（魔抗穿透作用于一切魔法伤害）。
- **附魔系（3 项）**：投射物发射时快照 `_enchantEffects/_craftEffects` 到 `_effectSnapshot`（projectile-factory 统一注入），命中按快照判定，杜绝飞行中切枪改效果；`_baseCooldowns` 首缓存污染修复——`Attack` 构造时固化 `baseMaxCooldown`，`_applyEnchantAttackInterval` 改读创建基准（能量轻机枪 ramp 运行时值不再被当基准缓存）；附魔界面从装备槽拖出武器补调 `_applySkillOverrides` + `_syncWeaponVisual`（沉重/冷却/贴图立即还原）。
- **改造系（5 项）**：次级格挡实现补 `isMelee` 判定（与描述一致），registry tooltip 同步；冲刺体力删 `staminaCostDelta` 双用（只吃 `skillStaminaCostDelta`）；基类 `combatant.js` `_startReload/_updateReload` 改读 state（`_initAmmoForSlot` 已计入改造），不再直读 ammoCfg 原值；`getCraftEffectDisplay` 透传聚合效果，`magicVulnerabilityOnHit` 显示真实层数、`magicVulnerabilityStacks` 不再渲染空行；craft-system 武器贴图 weaponIdMap 硬编码表删除，`ItemDatabase.getByWeaponId` 懒索引反查（新武器免登记，load/addItem 自动失效重建）。
- **地牢系（2 项）**：`_cleanupEventUI` 先调 `DungeonEventSystem._cleanupUI()` 销毁打字机再移除 DOM；地牢 buff 实体状态键 `'buff'` 改唯一键（`goddessBless`/`demonPrayer`/`buffCfg.id`），`consumeBattleBuffs/clearAllBuffs` 按同键移除，多 buff 不再互删图标。
- **死代码批删（逐条 grep 确认零调用）**：`node._combatCompleted` 只写不读；`ZOMBIE_DUNGEON_CONFIG` 残留 `combatWaves/monstersPerWave/tierWeights`（实际读 `DungeonConfig.getZombieEncounterConfig`）；`consumeGoddessBless`；`EnchantConfig.getGradeCost`；Player 空 `_onHitEntity` 覆盖（**注意**：`damage-pipeline.js` 的 `_onHitEntity` 调用保留——enemy.js 敌人实现是活的，毒伤/协同流血依赖它）；craft-system `_ticketCost`/`_modifications`/`getWeaponEffects`；registry 五个零调用函数（保留 `getCraftEffectDisplay`）；codex `_craftEffects` 展示死分支（图鉴为 DB 合并物品永无实例改造数据）；spitter-zombie 敌人端 `_craftEffects` 复制残留。
- **配置化（3 项）**：强化三常量（maxLevel 15/baseCost 100/costGrowth 1.5）移入 `data/game-config.json` 新增 `enhance` 节，`enhance-system.js` 统一 `_getEnhanceConfig()` 读取（`??` 回退）；强化石/改造券模板补 `id`（reward-system 模板 + 地牢事件奖励创建点注入 `id: configKey`），消耗匹配改 id 优先、无 id 旧实例名称兜底；`weapon-damage-formulas.js` 补注释标明最小回退定位（核查与 attack-formula.js 无重复，不合并）。
- **测试结果**：每阶段跑 `npm run lint` / `npx vite build` / `test-collider.mjs` / `test-craft-sync.mjs` 全部通过（registry 三角计数 38/39/39/38 不变，确认只删函数未动效果条目）。
- **已知问题**：待用户拍板——enhanceFlat 倍率、bossMultiplier、投掷音效（idle vs throwing）；椭圆分离手感需实机回归。

## 2026-07-17（受击粒子落地黄/眩晕双星/召唤物统一标签与闸门）

### 对话：集合体两项 + 召唤物系统性调整（v0.198+）
- **集合体受击粒子换落地黄色**：`enemy-config.json` amalgamZombie 新增 `hitParticleColor: "#b8860b"`；`triggerZombieHitParticles` 读取该配置，`playZombieHitParticles` 支持自定义 tint——自定义色用白色 `impact_dot` 纹理（tint 乘算准确显色），默认绿色沿用原绿色纹理不变（其他僵尸不受影响）。
- **眩晕双星动画特效**：`GameScene._ensureStunStarTexture`（四角星纹理）+ `_syncStunEffects`——眩晕实体头顶两颗星星以半径 26px 旋转（Y 按平面透视压缩、带上下浮动），眩晕持续时间内播放，结束或实体失效自动销毁，地图模式全部清理；update 循环接入。
- **召唤物统一 `_summoned` 标签（一劳永逸）**：集合体召唤僵尸/投掷胖子、僵尸巫师召唤犬统一打 `_summoned = true`（不影响地牢原有怪物）。
- **统一闸门（金币/经验/技能修炼全拦截）**：
  - `damageable-entity.js onDeath`：金币掉落+玩家经验跳过 `_summoned`；
  - 同文件 takeDamage：暴击经验、武器精通经验（kill/crit）、无人机经验三个分支全部加 `!this._summoned` 闸门；
  - 各技能击杀计数（attack.js ×2、whirlwind、ice-spike、dash ×2、push-strike、fireball 共 7 处）全部改为 `killed && !entity._summoned` 才计数。
  - 设计说明：`_summoned` 为唯一标签，未来任何召唤方打标即自动被全部闸门拦截；命中数（hitCount）仍照常计入（未被"杀死"的召唤物命中属于正常命中经验，与"杀死召唤物无收益"语义一致）。
- **测试结果**：`npm run lint` ✅；`npx vite build` ✅；`node scripts/test-collider.mjs` ✅。
- **已知问题**：实机待验证——①集合体受击为落地黄、其他僵尸仍为绿色；②被眩晕单位头顶双星旋转、醒后消失；③杀召唤犬/召唤僵尸/投掷胖子不掉金币经验、武器精通/各技能修炼不累积，原地牢怪正常。

## 2026-07-17（集合体弹反免疫 + 位移免疫确认）

### 对话：集合体弹反交互独立设置（v0.198+）
- **弹反免疫（配置驱动）**：`enemy-config.json` amalgamZombie 新增 `parryImmune: true`；`amalgam-zombie.js` 构造函数读入 `_parryImmune`；`shield-system.js triggerParry` 在弹反音效后对免疫单位直接 return——弹反对集合体**不再造成眩晕、击退、打断动作**（攻击动画/阶段照常进行）。玩家侧收益（免伤、免体力消耗、弹反音效、防御经验）全部不受影响、不做修改。
- **位移免疫（已确认在位）**：集合体已具备完整防位移链——speed 0 显性锁死、每帧 vx/vy/knockback 归零、`applyKnockback` 空覆盖（任何来源击退无效）、`noSeparation`（分离时对方承担全部位移）、出生点锚点钉死（每帧强制归位）。任何单位都无法推动集合体。
- **测试结果**：enemy-config.json 校验通过；`npm run lint` ✅；`npx vite build` ✅；`node scripts/test-collider.mjs` ✅。
- **已知问题**：实机待验证——①对集合体弹反：玩家不受伤害/不耗体力/有音效，但集合体不眩晕、不被击退、攻击不被打断；②集合体被任何方式攻击/挤压时纹丝不动。

## 2026-07-17（左下"秒杀"调试按钮）

### 对话：新增秒杀模式开关（v0.198+）
- **按钮**：`hud-panels-misc.js` 无敌按钮旁新增"秒杀"切换按钮（同款样式），点击切换 `window.Game._oneHitKill`，开启时显示"秒杀中"（active 高亮）。
- **秒杀判定**：`damageable-entity.js takeDamage` 在扣血前检查——`source._faction === 'player' && Game._oneHitKill` 时 `baseDamage` 提到 `max(baseDamage, this.hp)`，走正常伤害流程（死亡特效/掉落/经验照常触发，不会跳过结算）。
- **作用域**：全局生效（含地牢 BOSS 战），供快速测试。
- **测试结果**：`npm run lint` ✅；`npx vite build` ✅；`node scripts/test-collider.mjs` ✅。
- **已知问题**：实机待验证——按钮切换与秒杀生效（伤害数字、掉落、经验照常）。

## 2026-07-17（召唤 CD 15s 确认 + 召唤点黑色刷怪粒子）

### 对话：集合体召唤调整（v0.198+）
- **召唤 CD**：`attackSkills.summon.cooldown = 15000`（15s，配置已确认生效，首次召唤同样在生成 15s 后触发）。
- **召唤点黑色粒子**：`_updateSummon` 每只僵尸召唤成功时，在其脚下调用 `GameScene.playDungeonSpawnParticles(sx, sy)`（与地牢战斗房刷怪同款：纯黑、更慢、1.5s、NORMAL 混合）。
- **测试结果**：`npm run lint` ✅；`npx vite build` ✅。
- **已知问题**：实机待验证——召唤间隔 15s 与召唤点黑色粒子观感。

## 2026-07-17（血条再下移/冲击波加粗闪烁/footprint 270 上移 100）

### 对话：集合体三项微调（v0.198+）
- **血条再下移 100px**：`_syncEntityHud` boss 血条 `barY` 由 `topY + 88` → `topY + 188`（660px 贴图下进一步下移）。
- **冲击波加粗 + 闪烁**：`_fireSlamShockwave` 描边 4px → **8px**；透明度在淡出曲线上叠加高频正弦闪烁（`0.55 + 0.45 × sin(t×π×8)`），冲击波呈脉冲感。
- **footprint 椭圆优化**：`collisionRadius` 240 → **270**（+30）；`render.colliderOffsetY` -50 → **-100**（中心点再上移 50px，阴影/命中/分离同源随动）。
- **测试结果**：enemy-config.json 校验通过；`npm run lint` ✅；`npx vite build` ✅；`node scripts/test-collider.mjs` ✅。
- **已知问题**：实机待验证——①血条新位置；②冲击波加粗+脉冲闪烁观感；③270/-100 的椭圆与贴图对齐及可接近手感。

## 2026-07-17（落地粒子偏色根因/砸地区域 200-400-800/砸地冲击波）

### 对话：集合体三项调整（v0.198+）
- **落地粒子仍显绿色的根因**：`zombie_hit_dot` 纹理本身就是绿色（`fillStyle(0x55ff55)` 生成），Phaser tint 是**乘法**——深黄 tint × 绿色纹理仍偏绿。修复：新增白色粒子纹理 `impact_dot`（`_ensureImpactDotTexture`），`playTanImpactParticles` 改用白纹理，深黄 tint（0xb8860b）现在准确显色。
- **砸地伤害区域调整**（enemy-config.json `attackSkills.slam.zones`）：100/200/500 → **200px ×1.2 / 400px ×0.7 / 800px ×0.2**，各自区域判定不叠加，其他不变。
- **砸地范围提示改为冲击波动画（首版参考）**：删除静态三层红圈显示，改为每个伤害帧（7/12/17/20/24/27）从集合体中心释放一个红色椭圆冲击波——`_fireSlamShockwave`：椭圆由 0 扩散至最大伤害圈半径（800px），4px 描边随扩散淡出（alpha 0.9→0）+ 极淡填充，平面透视 2:1，600ms Cubic.easeOut；同时最多 6 个波并存，结束自动销毁；`_destroyCustomEffects` 统一清理在飞的波（死亡/战斗结束无残留）。
- **测试结果**：enemy-config.json 校验通过（zones 200/400/800）；`npm run lint` ✅；`npx vite build` ✅；`node scripts/test-collider.mjs` ✅。
- **已知问题**：实机待验证——①落地粒子正确显示深黄色；②冲击波扩散节奏/透明度/透视比例观感（首版供参考，参数在 `_fireSlamShockwave` 可调）；③200/400/800 三圈伤害手感。

## 2026-07-17（落地粒子深黄/砸地CD驱动+三圈显示/分离椭圆匹配/投掷预判）

### 对话：集合体四项调整（v0.198+）
- **落地粒子改深黄色**：`playTanImpactParticles` tint `0xc8a060`（黄褐）→ `0xb8860b`（深黄）。
- **砸地攻击放不出来的根因**：**不是 AI 问题，是判定范围问题**——footprint 半径翻倍到 240 后，玩家被分离边界挡在 ~262px 外，而 `_decideAttack` 要求 `dist <= triggerRange(250)` 才触发砸地，永远不满足。修复：砸地改为 **CD 一旦满足立即释放**（有目标即可，不再受 triggerRange 限制）；投掷攻击仍按自身 CD 独立进行，动画/阶段互不影响（`_attackKind` 互斥，一方进行中另一方等待）。
- **砸地范围显示**：`_createSlamZoneDisplay`——三圈按伤害深度分层红色（500px 浅红 `0xff8080` / 200px 中红 `0xd03030` / 100px 深红 `0x8a0a0a`，伤害最高圈最深），先大区后小区叠加绘制，椭圆 2:1 透视；砸地结束自动取消；新增 `_destroyCustomEffects`（清理警示圈/范围圈/飞行投射物），`onDeath` 与 `game.js removeEntity` 均调用，怪物死亡/战斗结束正确删除效果。
- **footprint 椭圆精准匹配（根因）**：`resolveCollisions` 分离判定此前用世界圆（r 沿 Y 全量），而 footprint 视觉/投射物判定是椭圆（ry=r×0.5 透视），沿 Y 方向物理边界比视觉椭圆远一倍——"视觉有空间却不能接近"。修复：分离判定加入逆透视变换（`dy × 1/PERSPECTIVE_SCALE_Y`，与 `projectile._hitFootprintEllipse` 同口径），位移量再变换回世界空间，分离体积与 footprint 椭圆完全一致。
- **投掷预判**：`_startAttack('throw')` 改用与其他远程怪物（僵尸巫师/毒液僵尸）相同的 `AimHelper.lead` 预判——延迟 = 出手帧时间（1.2s）+ 飞行时间（0.6s），落点与红色警示圈均按预判拦截点显示，不再锁定目标当前位置。
- **测试结果**：`npm run lint` ✅；`npx vite build` ✅；`node scripts/test-collider.mjs` ✅。
- **已知问题**：实机待验证——①深黄色落地粒子；②砸地 CD 到点即放、三圈红显示与结束取消；③接近集合体沿 Y 方向阻挡边界与椭圆视觉一致；④移动目标的投掷落点预判准确性。

## 2026-07-17（召唤物无奖励/集合体音效/血条去标签/footprint分离同源）

### 对话：集合体四项调整（v0.198+）
- **召唤物无经验金钱**：`amalgam-zombie.js` 召唤僵尸（`_updateSummon`）与投掷生成胖子僵尸（`_impactThrow`）打 `_noExpGold = true` 标记；`damageable-entity.js onDeath` 的金币掉落+经验分支跳过标记实体。**不影响地牢原有僵尸/胖子僵尸**（标记只打在集合体生成的实体上）。
- **集合体音效系统**：素材复制到 `assets/sounds/enemies/amalgam/`（规则 4）；`enemy-config.json` 新增 `sounds` 配置块（idle/throw/impact/slamHit/death/idleInterval，配置驱动）；`amalgam-zombie.js` 新增 `_playSound(key)` 助手（SoundManager.playFile）与五个触发点——待机环境音按 idleInterval 循环、投掷出手（fireFrame）、投射物落地、砸地 6 个命中帧、死亡。SKILL.md 新增「音效导入工作流」章节（素材建档→配置映射→事件播放三步）。**备注**：`throwing.mp3` 已入库未使用（投掷按用户指定用 idle.mp3），如需切换改配置一行即可。
- **世界内血条**：删除血条下方的 `Lv.X · 首领` 标签文字。
- **footprint 椭圆与实际分离不一致根因**：`game.js resolveCollisions` 的分离计算用实体 x/y，而 footprint 椭圆/阴影/命中判定用 `Collider` 偏移后坐标（colliderOffsetY=-50）——物理分离区比视觉椭圆低 50px，造成"视觉有空间却不能接近"。修复：分离计算统一取 `collider.x/y`（与命中椭圆/阴影同源）。
- **测试结果**：enemy-config.json 校验通过；`npm run lint` ✅；`npx vite build` ✅；`node scripts/test-collider.mjs` ✅。
- **已知问题**：实机待验证——①召唤僵尸/投掷胖子死亡不掉金币经验、地牢原有怪物正常掉落；②五个音效点（待机循环/投掷/落地/砸地帧/死亡）；③血条无首领标签；④集合体可接近距离与视觉椭圆一致。

## 2026-07-17（集合体判定圆/血条重做/警示圈销毁/落点粒子）

### 对话：集合体四项调整（v0.198+）
- **判定圆**：`enemy-config.json` amalgamZombie `collisionRadius` 120→**240**（半径翻倍）；新增 `render.colliderOffsetY: -50`（footprint 上移 50px，经 `Collider.syncPosition` 的 entity.colliderOffsetY 机制生效，阴影/命中/分离同源随动）。
- **生命值显示重做**（GameScene `_syncEntityHud` boss 分支）：
  - 世界内血条整体下移 100px（`topY - 12` → `topY + 88`），解决上浮过高；
  - 字段错开：名字（barY-34）/ HP 数值（barY-8）/ `Lv.X · 首领` 标签（血条下方 barY+barH+12）不再贴在一起；
  - 召唤阈值绿线改为仅在配置了 HP 阈值召唤的 Boss 才画（集合体定时召唤不画）。
- **新增 BOSS 专属血条（屏幕空间 DOM）**：`GameScene._ensureBossHpBar/showBossHpBar/_updateBossHpBar/_hideBossHpBar`——位于顶部状态栏下方 20px、520px 居中（首领名+渐变血条+数值）；`damageable-entity.js` 在 `rank==='boss' && source._faction==='player'` 受击时触发显示（只有玩家攻击到才显示），5 秒无新命中自动隐藏、Boss 死亡立即隐藏。
- **投掷警示圈落地不消失根因**：`AttackRangeEffect.update()` 只在 `life<=0` 时才销毁 Phaser 图形，而 `_destroyWarning` 置 `active=false` 后 EffectManager 在下一帧就把效果移除出列——life 永远到不了 0，graphics 永久残留。修复：`_destroyWarning` 现在**立即调用** `_destroyPhaserGraphics()` 销毁图形（落地事件即删除）。
- **落点黄褐色粒子**：`GameScene.playTanImpactParticles(x, y)`——参考僵尸受击粒子，黄褐色 tint、2.0 起始缩放（更大）、20 颗（更多）、lifespan 1500（1.5 秒）、重力下坠；在 `_impactThrow` 落点处触发。
- **测试结果**：enemy-config.json 校验通过；`npm run lint` ✅；`npx vite build` ✅；`node scripts/test-collider.mjs` ✅。
- **已知问题**：实机待验证——①判定圆 240/上移 50 的命中手感与阴影位置；②世界内血条下移/错开版式；③命中才显示的 BOSS 血条位置/渐变/隐藏时机；④投掷警示圈落地即消失；⑤黄褐色粒子大小/浓度/时长。

## 2026-07-17（清单全量收尾：地牢中低优先级/改造P2/数值决策/技术债务）

### 对话：按清单完成全部剩余工作（v0.198+）
- **A1 地牢中优先级 7 项**：`game.js` 拦截 `state='reward'`（奖励面板期间实体不更新）；波次切换改 `_scheduleNextWave`（暂停自动顺延，不再真实时间刷波）；商店轮询句柄存 `_shopCheckInterval` 并在 shutdown 清理 + `_returnToMap` 加 active 守卫；`_checkBossDefeated` 不再把 null boss 当战胜；补给堆药水=瓶数×单瓶恢复量（`POTION_HEAL/POTION_MP` 导出）且不再与旧 successRewards 双重发奖；事件结果按钮 300ms 延迟激活防双击穿透；负金币扣除钳制到持有量。
- **A2 改造 P2 六项**：G18 weapon9 完整改造选项复制移到 weapon10 完整赋值之后（四个死格修复）；`_getCraftConfig` 无配置返回 null 不再回退 PKM（UI 显示"该武器不可改造"，锈剑/弓/盾不能再装消音器）；同 id 配件不再白扣 4 券；拖入装备栏立即 `_initAmmoForSlot`；registry 补 `staminaCostDelta/skillStaminaCostDelta/dashDoubleHit`；tooltip 弹夹 magazineOverride 优先。
- **A3 数值决策**：`getAttackFormula` 回退 `enhanceFlat: 1`（无 attackFormula 武器强化 +1/级）；`expValue` 新增 `eliteMultiplier: 2 / bossMultiplier: 10`（boss 经验配置化，集合体现 450）；盾牌 `defense.base + perEnhance × 强化等级` 计入玩家 def（防具强化真生效）；15 张事件背景图 3072×2048 → 1920×1280（93MB→45MB）。
- **A4 地牢低优先级清理**：工厂 fallback HP 同步现值 + 召唤工厂注入；`combatRoom.bossSize` 4096→1024 且 BossRewardSystem arena.size 改读配置（死配置盘活）；BOSS 战清理恢复地形/树木/世界尺寸 + syncTerrain；BOSS 墙补 height:60；`_restoreSceneState` 补 syncTerrain；退出按钮绘制/热区统一；`_entityHudTexts` type→role 字段修正；`_onEnemySpawn` rebuildCollider 守卫；iconMap 补 materials；事件完成 isActive 复位；`_calculateSpawnArea` margin 生效（与 minWallDistance 取大）。
- **B 阶段**：SKILL.md 新增 v2.9 变更记录；存档包含装备/背包（`game-ui-manager.js` 存档加 equipments/backpack，读档真正恢复并重算派生状态——此前 load 只 alert）；强化公式展示收敛为 `attack-formula.js` 的 `buildFormulaDisplay` 唯一实现（enhance/tooltip 两处委托，codex 硬编码 ×0.1 描述同步修正）。
- **C 阶段（技术债务）**：
  - **craft 配置迁 JSON**：`_WEAPON_CRAFT_CONFIGS` ~1200 行硬编码经脚本忠实导出为 `data/craft-config.json`（71KB，12 武器配置），`public/data/craft-config.json` 同步；craft-system.js 由 1461 → 922 行，拼接代码全部移除。
  - **registry 三角同步**：后坐 `recoilRecoveryDelta`（kick 衰减分母 max(20, 80+delta)）、散布 `shotSpreadDelta`（每发 kick 按最大散布角折算）、移速 `moveSpeedPercent` 非 PKM 武器通用化；新增永久检查 `scripts/test-craft-sync.mjs`（配置→收集→注册→消费四面校验，38 键全过）。
  - **死代码清理**：删除 boss-reward-system.js 的 DungeonBuffSystem（~200 行，与 dungeon-event-system 同名类重复且无调用方）及全部引用（实例/委托方法/window/导出/StatusBar 闲置导入）。
- **测试结果**：`npm run lint` ✅ 0 警告；`npx vite build` ✅；`node scripts/test-collider.mjs` ✅；`node scripts/test-craft-sync.mjs` ✅（38 键全同步）。
- **已知问题**：实机待验证——①奖励面板期间实体冻结；②暂停不刷波；③补给堆药水恢复量正常；④G18 改造格全部可用；⑤穿甲/后坐/移速改造实机手感；⑥读档恢复装备背包；⑦改造配置迁移后全部武器改造项正常。

## 2026-07-17（附魔/改造/强化审查 P0+P1 六项修复）

### 对话：按审查优先级修复附魔/改造/强化三系统问题（v0.198+）
- **P0-1 附魔 init 未调用（拖拽放回失效）**：`main.js` 新增 `EnchantSystem.init()`（注册 4 个 EventBus 监听：附魔槽拖回背包/装备栏、卷轴快捷放入）。
- **P0-2 魔法粉尘名称断链（附魔经济断裂）**：`enchant-config.js` `MagicDustItem.name` 魔法晶尘→**魔法粉尘**（与地牢事件奖励同一物品）；`enchant-system.js` 三处匹配点硬编码字面量改为引用 `MagicDustItem.name`（配置驱动）；相关 UI 文案同步。
- **P0-3 穿甲改造完全无效（生产端从不写入）**：`craft-system.js _applyModEffects` 增加 `armorPenetrationPercent` 收集变量 + 循环累加 + 写入 `_craftEffects`（与 magicPenetrationPercent 同模式），`damageable-entity.js` 既有消费端自此生效。
- **P0-4 强化 stats 平方级污染（实战数值漏洞）**：`enhance-system.js` 删除强化时改写 `item.stats` 显示值的整块逻辑——stats 不再被反复改写，基础值不再滚动累加；无 attackFormula 武器经 getAttackFormula 回退读取的 base 保持干净。**注意**：无 attackFormula 的 16 个武器（锈剑/符文剑/AKM/PKM 等）回退 `enhanceFlat: 0`，强化对它们现在无实战加成（此前靠污染生效），如需加成需改回退公式（数值改动待你确认）。
- **P1-1 沉重减速只在切枪时生效**：`subsystems.js _applyEnchantAttackInterval` 重写——空手/非武器时恢复全部已缓存基础冷却（防残留）；`_applySkillOverrides` 开头统一调用（覆盖所有装备/卸下路径）；`enchant-system.js` 附魔写回后立即刷新。
- **P1-2 强化石白扣**：`enhance-system.js` 消耗顺序改为先扣金币成功后再扣强化石（并合并重复金币检查）。
- **测试结果**：`npm run lint` ✅；`npx vite build` ✅；`node scripts/test-collider.mjs` ✅。
- **已知问题**：实机待验证——①附魔槽拖回背包/装备栏；②地牢获得粉尘可支付附魔；③穿甲配件（厚重钝化/钢芯穿甲弹）实际生效；④强化不再虚高；⑤沉重减速装备即生效、卸下不残留；⑥金币不足时石头不消耗。

## 2026-07-17（地牢审查 4 个高危问题修复）

### 对话：Boss 回调清空/软锁/宝箱 TypeError/召唤泄漏修复（v0.198+）
- **修复 1（Boss 完成回调永不触发）**：`boss-reward-system.js leaveBossBattle` 先取 `const onComplete = this._onCompleteCallback` 再 `cleanup()`（此前 cleanup 先把回调置 null，回调永远执行不到 → Boss 节点无法标记完成、奖励节点流程失效）。
- **修复 2（Boss 战中死亡后 active 卡死软锁）**：`dungeon-map-system.js shutdown()` 新增强制调用 `BossRewardSystem.cleanup()` 与 `CombatRoomSystem.cleanupRoom()`（此前全项目无调用方，下次 BOSS 战 `start()` 因 active===true 直接 return，玩家困死）。
- **修复 3（宝箱材料 25% TypeError）**：`dungeon-event-system.js:822` 材料分支改 `for (const item of (outcome.rewards || outcome.items || []))`（JSON 用 items、DEFAULTS 用 rewards，兼容两键）。
- **修复 4（召唤物战斗后泄漏）**：`game.js` 新增 `removeEntitiesByPrefix(...prefixes)`（经 removeEntity、跳过存活尸体）；`combat-room-system.js` 的 `cleanupMonstersOnly`/`cleanupRoom` 与 `boss-reward-system.js cleanup` 按前缀兜底清理（zombieDog_ / amalgam_fat_ / amalgam_zombie_）。
- **测试结果**：`npm run lint` ✅；`npx vite build` ✅；`node scripts/test-collider.mjs` ✅。
- **已知问题**：实机待验证——①击败 Boss 后节点变 empty、可进奖励节点；②Boss 战中死亡重进地牢 BOSS 战正常开启；③宝箱材料分支正常发奖；④召唤犬/集合体召唤物在战斗结束后不再残留。

## 2026-07-17（新增地牢：僵尸地牢-初级）

### 对话：第二个地牢接入出征系统 + 生成器节点数修正（v0.198+）
- **需求**：新增"僵尸地牢-初级"——22 房间、最短路线 ≥7 节点、起始 3 线路、7 节点最少 3 战斗、整体战斗 40%、精英 0%、boss 战为精英战斗独立副本、出征模式可选。
- **配置（data/dungeon-config.json，零硬编码）**：
  - `dungeonList`：两个地牢的出征展示元数据（名称/节点数/战斗比/等级/奖励），驱动出征界面选项与信息面板。
  - `zombieDungeonBeginner`：nodeCount 22/22、shortestCombatPath 7（boss 第 8 列）、mainRowMinCombat 3、typeRatios 0.40/0.60、eliteCombatChance 0、grid rows 3/mainRow 1、bossEncounter（1 波 × 精英1+普通5，精英遭遇独立副本）。
- **代码改动**：
  - `src/config/dungeon-config.js`：`_keyFor` 类型→配置键映射；`getZombieDungeonConfig/getZombieEncounterConfig/getEliteCombatChance` 支持按地牢类型读取；新增 `getBossEncounterConfig`、`getDungeonList`。
  - `src/world/zombie-dungeon.js`：`ZombieDungeonMapGenerator` 接受 dungeonType（读对应配置键）；新增 `mainRowMinCombat`（主通道随机 N 列强制战斗，缺省=shortestCombatPath 向后兼容）；精英概率按类型读取；`ZombieDungeonCombat` 第 3/4 参支持 encounterOverride 与 dungeonType。
  - **生成器修正**：第 1 列强制全行移到节点数调整**之前**（此前在之后，强制的补行使总数超出配置区间）；`_adjustNodeCount` 增删候选排除第 1 列（保证起始分支数恒定）。主地牢回归 1000 次通过（35~40/4 分支）。
  - `src/world/dungeon-map-system.js`：`dungeonName` 改读 dungeonList；新增 `_isZombieFamily()`（zombie/zombieBeginner 共享僵尸战斗波次体系）替换 3 处 `=== 'zombie'` 判断；`generateMap`/`_enterZombieCombat` 传 dungeonType；`_enterBoss` 对 zombieBeginner 走 `_enterBossCombat`（bossEncounter + 普通战斗/波次/传送门流程，完成→奖励节点→胜利）；`_markCurrentNodeCompleted` 移除 boss 排除（arena boss 不经此路径，无影响）。
  - `src/ui/expedition-system.js` + `src/ui/panels/hud-panels-expedition-quest-reward.js`：出征地牢选项与信息面板改由 dungeonList 驱动。
- **验证**：JSON 校验通过；生成器约束仿真 1000 次（22 节点/3 分支/主通道≥3 战斗/平均战斗占比 42.4%）全过；主地牢回归仿真 1000 次通过；`npm run lint` ✅；`npx vite build` ✅；`node scripts/test-collider.mjs` ✅。
- **过程备注**：初期复现测试曾报 2% 节点数异常，最终定位是复现脚本自身的内联随机 bug（`filter(r => r !== arr[rand()])` 每元素重掷），真实代码先取 `remove` 再过滤，无此问题。
- **已知问题**：实机待验证——①出征界面出现"☠ 僵尸地牢-初级"选项并可进入；②22 房地图布局/3 分支/事件背景图；③boss 节点刷出 精英1+普通5 战斗房，完成后奖励节点→胜利；④主地牢不受影响。

## 2026-07-17（集合体贴图与碰撞体积 ×3）

### 对话：集合体 spriteSize 220→660，碰撞同步放大（v0.198+）
- **修改文件**：`data/enemy-config.json` amalgamZombie——`size` 40→120、`collisionRadius` 40→120（footprint/阴影/分离/命中椭圆同源随动）、`render.spriteSize` 220→660、`render.collisionWidth/Height` 100×180→300×540、`render.footOffsetY` 103→309（随贴图比例）、`render.projectileHitbox` 120×190→360×570。
- **未动**：攻击 AOE 半径（投掷 45、砸地 100/200/500、触发 250、召唤 150）为用户此前明确设定的数值，不属"碰撞体积"，如需随体型放大请明示。
- **测试结果**：enemy-config.json 校验通过；`npm run lint` ✅；`npx vite build` ✅；`node scripts/test-collider.mjs` ✅。
- **已知问题**：实机待验证——660px 贴图在 1024 BOSS 场地中的视觉比例、投掷起始点（随 footOffsetY 309 上移）。

## 2026-07-17（集合体移动根因：falsy-0 速度回退 + 锚点钉死）

### 对话：集合体第三次报"还是会移动"——根因定位与系统级修复（v0.198+）
- **根因**：移动代码普遍使用 `maxSpeed || speed || 100` 逻辑或回退——`0` 是假值，speed 0 被当作"未配置"而回退到 **100**！集合体每帧实际以 ~100×accel 的速度被 `Enemy._updateMovement`（enemy.js:527）和 MovementSystem 七处路径驱动。前三次修复（锁 vx/knockback、noSeparation、_tryUnstuck 跳过、applyKnockback 空覆盖）都正确但都没堵住这条主通道。
- **修改文件**：
  - `src/systems/movement-system.js`：7 处 `enemy.maxSpeed || enemy.speed || 100` → `enemy.maxSpeed ?? enemy.speed ?? 100`（空值合并，0 被保留；仅 undefined/null 才回退——speed 字段在构造函数必有值，旧配置语义不变）。
  - `src/entities/enemy.js::_updateMovement`：同样 `||` → `??`（:527）。
  - `src/entities/enemy-types/amalgam-zombie.js`：新增出生点锚定——构造函数记录 `_anchorX/_anchorY`，`update()` 每帧强制 `this.x/y = 锚点`（强制显性编码的兜底保险，任何未来新增位移通道都无法让其离锚）。
- **教训（写入记忆）**：**speed 0 的语义陷阱**——一切 `xxx || fallback` 对数值 0 都会误回退；数值回退必须用 `??`。本次替换安全：speed/maxSpeed 在 Enemy 构造函数必被赋值，`||` 原本只在显式 0（或 NaN）时触发。
- **测试结果**：`npm run lint` ✅；`npx vite build` ✅；`node scripts/test-collider.mjs` ✅。
- **已知问题**：实机待验证——集合体彻底纹丝不动（本次为根因级修复）。

## 2026-07-17（集合体移动/投掷物/刷点三修复）

### 对话：集合体仍会移动 + 投掷物不可见 + 生成点错位（v0.198+）
- **问题1（集合体仍移动）**：非"40 最低速度"冲突（代码库无此钳制）。第四位移通道：`MovementSystem._tryUnstuck` 的触发条件是"有速度 或 有目标且距离 > attackRange"，集合体 speed 0 但目标在 120px 外 → 被判"尝试移动但 30 帧无位移"→ 周期性瞬移。修复：`_tryUnstuck` 开头跳过 speed/maxSpeed 均为 0 的站桩单位（通用机制）。另 `AmalgamZombie` 覆盖 `applyKnockback` 为空（击退永不累积，杜绝任何时序缝隙）。
- **问题2（投掷物不可见）**：`project.png` 是 512×512 帧中仅 81×79 的内容（15.8%），`setDisplaySize(48,48)` 缩放整帧 → 实际可见内容仅 ~7.6px。修复：用脚本将 `assets/enemies/amalgam/project.png` 裁剪至内容 bbox（81×79），配置 `projectileSize` 48→64。
- **问题3（生成点错位）**：`WallSystem.resolve` 真实签名为 `(x, y, nx, ny, r)` 五参，此前按三参调用 → ny/r 为 undefined → 返回错误坐标（且 `typeof NaN === 'number'` 绕过了旧守卫）→ 胖子僵尸/召唤僵尸刷到错误位置。修复：投掷落点与召唤落点统一改为 `canMoveTo` 校验 + `findSafeSpawn` 螺旋外推 + `Number.isFinite` 守卫。
- **修改文件**：`src/systems/movement-system.js`（_tryUnstuck 站桩跳过）、`src/entities/enemy-types/amalgam-zombie.js`（applyKnockback 空覆盖 + 两处生成点修正）、`data/enemy-config.json`（projectileSize 64）、`assets/enemies/amalgam/project.png`（裁剪）。
- **测试结果**：enemy-config.json 校验通过；`npm run lint` ✅；`npx vite build` ✅；`node scripts/test-collider.mjs` ✅。
- **已知问题**：实机待验证——①集合体有目标时纹丝不动（不再瞬移）；②投掷可见 64px 投射物抛物线飞行；③胖子僵尸/召唤僵尸刷在警示圈/集合体下方正确位置。

## 2026-07-17（集合体强制站桩锁死）

### 对话：修复集合体 speed 0 仍可移动（v0.198+）
- **根因**：speed 0 只关闭自驱移动，仍有三个位移通道——①实体分离（`game.js resolveCollisions` 对重叠双方各推一半位移，与 speed 无关，召唤的僵尸会把集合体挤走）；②击退速度 `vx/vy`；③击退累积 `knockbackX/knockbackY`（damageable-entity `applyKnockback`）。
- **修改文件**：
  - `src/entities/enemy-types/amalgam-zombie.js`：**强制显性编码**——构造函数锁死 `speed/maxSpeed/vx/vy/knockbackX/knockbackY = 0` 并设置 `noSeparation = true`；`update()` 每帧再将 `vx/vy/knockbackX/knockbackY` 归零。
  - `src/game.js resolveCollisions`：新增 `noSeparation` 语义——不可分离单位自身纹丝不动，由对方承担全部重叠位移；双方均不可动则跳过（通用机制，未来站桩单位可复用）。
- **测试结果**：`npm run lint` ✅；`npx vite build` ✅；`node scripts/test-collider.mjs` ✅。
- **已知问题**：实机待验证——集合体被打/被召唤僵尸挤时纹丝不动，僵尸环绕时由僵尸让位。

## 2026-07-17（集合体首领完整接入 + BOSS战重构）

### 对话：集合体精灵图/技能/BOSS战替代大块头/主神空间测试（v0.198+）
- **素材（规则 4 + 4.8 处理）**：`assets/enemies/amalgam/`——idle 14 帧 / attacking 32 帧（砸地）/ attacking-2 25 帧（投掷）/ melting 28 帧，经 `scripts/archive/prepare-amalgam-sprites.py`（隔离 venv `.venv-sprites` 装 Pillow 运行）统一内容高度 ~480px、底部对齐 496、水平居中、宽限 500px；`project.png`（投掷物）原样复制。
- **新增 `src/entities/enemy-types/amalgam-zombie.js`**（数值全部来自 enemy-config.json `attackSkills`/`deathAnim`/`render`，类内零硬编码）：
  - 站桩 Boss（speed 0 显式生效），面朝目标；`aiInterval = MAX_SAFE_INTEGER` 关闭通用近战（同 mutant-3 模式），攻击全由类自管。
  - 攻击状态一（throw 投掷）：25 帧动画 2s，第 16 帧（1.2s）向锁定落点抛出投射物（project.png，600ms 抛物线）；投掷前至落地在落点显示红色椭圆警示（45px，`AttackRangeEffect` 逐帧保活）；落地 GroundEllipse(45) 物理伤害（atk×1.0），并在落点生成一只胖子僵尸（工厂注入 `_createFatZombie`）。
  - 攻击状态二（slam 砸地）：32 帧动画 2s，第 7/12/17/20/24/27 帧分圈结算——100px→atk×1.2、200px→atk×0.7、500px→atk×0.2（GroundEllipse 各自判定，取目标所在最小圈，不叠加）；冷却 7s、触发距离 250px。
  - 特殊技能（summon 召唤）：冷却 15s，非攻击状态时于下方 150px 召唤 2 只僵尸（工厂注入 `_createBasicZombie`），播放 idle 动画不打断攻击。
  - 死亡：melting 2.8s + 停最后一帧（27）2s 后销毁；`_preserveCorpse` 驱动尸体更新链。
- **BOSS 战重构（`boss-reward-system.js`）**：
  - 集合体替代大块头：`_spawnBoss` 改用 `AmalgamZombie`（enemy-config 数值 + 永久警戒，注入两个生成工厂）；删除 `createBigBossClass`（~530 行）、`getBigBossClass`、`window.BigBoss`、`BOSS_REWARD_CONFIG.boss`、`Enemy`/`Renderer`/`CONFIG` 闲置导入。
  - 场地重构：`arena.size` 4096→**1024**，新增 `playerFromBottom: 300`（玩家生成于最下方中心上移 300px）与 `bossFromTop: 300`（集合体上方中心镜像对齐）；`_placePlayer` 去随机边改为固定下方中心；地板改用与战斗房相同的黑砖拼铺。
  - `zombie-dungeon.js`：`createFatZombie` 补 `export`（供 Boss 战注入）。
- **共享模块 `src/world/dungeon-floor-texture.js`（新）**：地板烘焙唯一实现（`bakeDungeonFloor` + `applyDungeonFloor`），`combat-room-system._generateTerrain` 重构为调用它——战斗房与 Boss 场地同一地板，规则 1 去重。
- **其他**：`BootScene` 加载/注册 5 张集合体贴图动画；`enemy-types.js` 导出 `AmalgamZombie`；`enemy-sprite-tool.js` 列表 bigBoss→amalgamZombie；`game.js` 新增 `spawnMainAmalgam()`（主神空间测试，注入两工厂）并在初始化与返回主神空间两处注册；`dungeon-map-system.js` 注释同步。
- **测试结果**：enemy-config.json 校验通过；`npm run lint` ✅（0 警告）；`npx vite build` ✅；`node scripts/test-collider.mjs` ✅。
- **已知问题**：实机待验证——①主神空间集合体 idle/投掷（警示圈/落点伤害/生成胖子）/砸地分圈伤害/15s 召唤；②地牢 BOSS 战 1024 场地、出生点镜像、黑砖地板；③死亡 melting 动画与尸体消失时机。投掷/砸地动画 2s 时长与 BootScene 注册 duration 为两处维护（既有约定，改动需同步）。

## 2026-07-17（新增首领僵尸「集合体」）

### 对话：新增 boss 级僵尸 amalgamZombie + 显式战斗属性机制（v0.198+）
- **需求**：首领级僵尸"集合体"，HP 5000、物理攻击 60、魔法攻击 0、防御/魔法防御与僵尸巫师差不多、移动速度 0。
- **关键发现**：
  - `enemy.js:37` 旧守卫 `if (this.speed < 1) this.speed = 45` 会把显式 speed 0 强制改 45。
  - matk=0 与 mdef≈巫师(58) 在六维公式下互斥（matk=floor((int+wis)×0.5)=0 要求 int+wis≤1，而 mdef 靠 wis×1.2 驱动）。
  - 僵尸巫师实际面板：def=48、mdef=58（combat-formulas.json enemy 段公式）。
- **修改文件**：
  - `src/entities/enemy.js`：
    - speed 守卫改 `if (this.speed > 0 && this.speed < 1) this.speed = 45`——显式 0 = 站桩单位生效，旧相对值（0.2 类）修正逻辑保留。
    - 构造函数新增显式战斗属性覆盖（仅 `atk/matk/mdef`，与现有 hp/maxHp 显式覆盖同模式）；**不含 def**——现有 3 条配置（胖子 25/僵尸 7/毒液 10）的 def 字段一直未生效（公式驱动），激活会改变旧怪平衡，故排除并注释说明。
  - `data/enemy-config.json`：新增 `amalgamZombie`（集合体）：rank boss、type 首领、family 僵尸；hp/maxHp 5000（显式覆盖公式）；speed 0；六维 str100/dex20/con12/int0/wis1/luck5——使 atk=60、def=48、matk=0 由公式自然得出；`mdef: 58` 显式覆盖（公式值仅 1）；attackRange/attackDistance 120、thrust cooldown 2000/dynamicRange 140/width 30/knockback 20；collisionRadius 40；level 7（公式值）。
- **数值验证（node 公式模拟）**：HP 5000 ✓ / atk 60 ✓ / matk 0 ✓ / def 48（=巫师）✓ / mdef 58（=巫师）✓ / speed 0 ✓；对照巫师 atk 15/matk 37。
- **测试结果**：enemy-config.json JSON 校验通过；`npm run lint` ✅；`npx vite build` ✅；`node scripts/test-collider.mjs` ✅。
- **已知问题/后续**：
  - 集合体目前仅有配置（图鉴可见），**不会在任何战斗中生成**——BOSS 节点战斗用的是 boss-reward-system 固定"大块头"类，boss rank 配置池未接入；如需让集合体成为僵尸地牢 BOSS，需要另做 boss 池接线（下次任务）。
  - 无精灵图素材，渲染回退 `enemy_circle` 占位；提供素材后按规则 4 建档接入。
  - 站桩单位仍可能受击退/分离位移（未做 immovable），需要的话后续加。
  - boss rank 的 `getExpValue` 无双倍（仅 elite×2），当前击杀经验 = 10+7×5 = 45。

## 2026-07-17（尸体保留修复 + 技能public副本同步 + 背景图cover）

### 对话：胖子尸体不被波次强清 + 技能经验第二断点 + 背景图 cover + 地牢机制汇报（v0.198+）
- **任务2 根因（尸体波次推进即消失）**：上一轮修复让 `cleanupMonstersOnly()` 波次切换时经 `removeEntity` 连实体带贴图一起删除，尸体被强制清除，违背"尸体保留持续造成伤害"的设计。
- **任务3 根因（技能经验仍不累积）**：运行时 `window.SKILL_DATA` 来自 `fetch('/data/skills.json')`，Vite 实际提供 `public/data/skills.json`——该副本是过期旧版（仅 11 技能，缺 dashAttackFire/shotgunMastery/iceSpike/shieldDefense/fireball/nightFlame，且全部无 expRewards）。上一轮修 `buildSkillFromJSON` 补字段正确，但数据源是旧副本故仍未生效。**钩稽提醒**：skills.json 与 equipment.json 一样存在 data/ ↔ public/data/ 双份，今后改技能数据必须双份同步。
- **修改文件**：
  - `src/game.js`：新增共享判定 `isPreservedCorpse(entity)`（与实体更新循环同口径：`_preserveCorpse && !active && (deathAnimTimer>0 || corpseTimer>0)`）。
  - `src/world/combat-room-system.js`：`cleanupMonstersOnly()`、`cleanupRoom()` 清理循环命中存活尸体时跳过删除。
  - `src/world/dungeon-map-system.js`：`_cleanupCombat()` 同样跳过。
  - `public/data/skills.json`：用 `data/skills.json` 覆盖同步（11 → 17 技能，expRewards 齐全，已校验两份一致）。
  - `src/world/dungeon-event-system.js`：`_createEventBgLayer` 的 `background-size: auto` 改为 `cover`（等比铺满全屏、不变形、无黑边，边缘少量裁切；用户已选此方案）。
- **效果**：
  - 胖子僵尸尸体不再被波次推进/离开房间强制清除，按自身计时器走完生命周期（腐蚀光环持续伤害、7.5s 自毁贴图、8s 扫描移除）；地图模式下计时器冻结、贴图随敌人组隐藏，进下一战斗房后继续。
  - 步枪精通等全部技能恢复经验累积；冰锥/火球/盾防/霰弹精通/冲刺攻击-火/夜与火 6 个曾缺失技能恢复出现。
  - 僵尸地牢及所有地牢事件背景图 cover 铺满（同一共享函数，强绑定全场景）。
- **bottom 固定像素审计（无改动）**：NPC 立绘（bottom:200/220px）、事件面板×2（bottom:88px）、事件背景层（bottom:0）、右下通知栈（bottom:20px）、dev toast（bottom:100px）均合规；场景标签（top:210px）/提示 toast（top:30%）/居中对话框属瞬态通知，设计豁免。
- **测试结果**：public/data/skills.json 与 data 版一致性校验通过；`npm run lint` ✅；`npx vite build` ✅；`node scripts/test-collider.mjs` ✅。
- **已知问题**：实机待验证——①多波次战斗胖子尸体波次切换后保留并持续腐蚀、7.5s 后消失；②步枪精通击杀/暴击经验累积升级、6 个曾缺失技能出现；③事件背景图 cover 铺满无黑边。

## 2026-07-17（配置全场景生效 + 事件面板/旧5事件图 + 经验与被动技能）

### 对话：毒液/胖子配置修复 + 事件背景图调整 + 经验翻倍/升级回满/被动技能修复（v0.198+）
- **任务1 根因**：①`enemy.js` 从未映射 `attackDistance`（死配置，胖子实际按 115 触发）；②`GameScene._configureEnemyBody` 无条件用矩形推导覆盖 `collisionRadius`（毒液实际 footprint 45，配置 7.07 从未生效；巫师 45/普通僵尸 25/突变体 45 同病）。
- **任务4 根因（被动技能无法升级）**：`DataLoader.buildSkillFromJSON` 构建技能对象漏拷 `expRewards` → 所有 `add*Exp` 计算 gained=0 → 全部技能（含所有武器精通）永不获得经验；skills.json 数据齐全、击杀/暴击路由正常，唯一断点即构建器。
- **修改文件**：
  - `src/entities/enemy.js`：构造函数新增 `this.attackDistance = config.attackDistance` 映射 → 胖子僵尸真正只在 100 攻击范围发动攻击；普通僵尸 attackDistance 100 同步激活。
  - `src/phaser/scenes/GameScene.js::_configureEnemyBody`：collisionRadius 改配置优先（仅未配置时矩形推导）→ 毒液 45→7.07、巫师 45→20、普通僵尸 25→15、突变体3 45→20（回归设计配置值；胖子 30/僵尸犬 40 不变）。
  - `spitter-zombie.js` / `zombie-wizard.js`：`_getPhaserOptions` 硬编码 30×90 改读 `config.render`（32×79 / 61×109，缺省兜底）。
  - `assets/scenes/dungeon-events/`：新增 5 张旧事件图（goddess-statue/trap/supply-pile/treasure-chest/demon-statue，复制自素材库，共 15 张）。
  - `dungeon-event-definitions.js`：`NEW_EVENT_BG_IMAGES` 重命名为 `EVENT_BG_IMAGES` 并追加 5 个旧事件键；`dungeon-event-system.js` 导入同步。
  - `dungeon-event-system.js`：背景层改为 `background-size: auto; position: center`（原图比例/大小不变居中平铺，其余纯黑）；事件/结果面板去硬编码宽度（`left:151px; right:151px; bottom:88px; height:243px` 固定像素、随视口全宽拉伸，2K 不再只占一半）；选择副标题简化为 `检定<属性>-成功率<xx>%`（省略属性点数与长说明）。
  - `data/combat-formulas.json`：`player.expPerLevel.globalMultiplier` 2→4（升级所需经验整体翻倍，maxExp 重算同步）。
  - `subsystems.js gainExp`：升级循环内 `updateMaxStats()` 后 `d.hp=d.maxHp; d.mp=d.maxMp`（每级回满血蓝，连升同样生效）。
  - `data-loader.js buildSkillFromJSON` + `subsystems.js` fallback 构建器：补 `expRewards` 字段 → 全部技能恢复击杀/暴击经验获取。
- **测试结果**：combat-formulas.json 校验通过（globalMultiplier=4）；`npm run lint` ✅；`npx vite build` ✅；`node scripts/test-collider.mjs` ✅。
- **已知问题**：实机待验证——①地牢毒液 footprint/阴影明显变小、胖子 100 范围外不抬手；②事件背景原比例居中、2K 面板全宽、选择栏新格式；③旧 5 事件背景图；④升级回满血蓝、步枪精通击杀获得经验。技能经验恢复后升级节奏明显变化（此前全技能经验恒为 0），属修复本意。

## 2026-07-17（胖子尸体残留修复 + 地牢枪口同步 + 强绑定规则）

### 对话：两个场景差异 Bug 修复 + 新增强绑定工作规则（v0.198+）
- **Bug 1 根因（胖子僵尸死后黄色贴图残留）**：多波次战斗中一波全灭 1.5s 后 `CombatRoomSystem.cleanupMonstersOnly()` 直接 `Game.entities.delete(key)` 不销毁 `_phaserSprite` → 尸体 Sprite 成孤儿，`_updateCorpse` 随实体删除永不执行，黄色尸体在后续波次永久残留（单波房间等够 7.5s 会正常自毁，主神空间因场景切换清理而不显现）。
- **Bug 2 根因（地牢子弹不从枪口射出）**：地牢路线图模式把 `weaponSprite.setActive(false)`（GameScene.js），进入战斗房后 `syncWeapon` 每帧只恢复 `setVisible(true)`，全代码无任何 `setActive(true)` 恢复（玩家贴图有、武器没有）→ `_getMuzzleWorldPosition` 的 `sprite.active` 守卫失败返回 null → 回退脚底相对算法。主神空间不进地图模式所以正常。`_spawnShellCasing` 同病。
- **修改文件**：
  - `src/game.js`：新增统一实体移除入口 `removeEntity(key)`——删除前销毁 `_phaserSprite`/`_phaserLabel` 并调用 `_destroyPhaserSprite()`（如有），强绑定、场景无关。
  - `src/world/combat-room-system.js`：`cleanupMonstersOnly()`（核心泄漏点）与 `cleanupRoom()` 改用 `Game.removeEntity(key)`。
  - `src/world/dungeon-map-system.js`：`_cleanupCombat()` 怪物清理改用 `Game.removeEntity(key)`。
  - `src/world/boss-reward-system.js`：小怪（onDeath）、Boss（cleanup）、出口传送门（leaveBossBattle/cleanup 两处）共 4 处改用 `Game.removeEntity(key)`。
  - `src/phaser/scenes/GameScene.js`：`update()` 非地图模式分支追加武器/副手贴图 `setActive(true)` 恢复（与 playerSprite 恢复同模式，可见性仍由 syncWeapon 控制）。
  - `src/entities/player/subsystems.js`：`_getMuzzleWorldPosition` 与 `_spawnShellCasing` 守卫去掉 `!sprite.active` 条件（保留 visible/texture 检查，双保险）。
  - `WORKING-GUIDELINES.md`：新增**原则 10：修改强绑定全场景生效** + 提交检查清单对应项。
  - `docs/work-rules.md`：第一节最高优先级规则追加**规则 5** 同内容。
- **测试结果**：`npm run lint` ✅；`npx vite build` ✅；`node scripts/test-collider.mjs` ✅。
- **已知问题**：实机待验证——①地牢多波次战斗第一波杀胖子僵尸，尸体贴图在波次切换时消失；②地牢战斗房开枪子弹/蛋壳从枪口射出；③主神空间开枪枪口与胖子尸体 7.5s 自毁回归正常。

## 2026-07-17（僵尸地牢事件背景图 + 地形贴图替换）

### 对话：10 张事件背景图接入 + 3 张地形图替换（v0.198+）
- **素材（规则 4：先复制进项目再开发）**：
  - 新建 `assets/scenes/dungeon-events/`，从素材库复制 10 张事件背景图（3072×2048）并按事件键重命名为英文：collapsed-archway / undead-scholar-notes / blood-altar / misty-crossroad / cursed-armor / poison-mushroom-circle / abyssal-gambler / blessed-fountain / locked-armory / phantom-mirror。
  - `assets/terrain/blackbrick.png`、`blackbrick2.png`、`blackbrick3.png` 用素材库 3 张 512×512 新图覆盖替换（旧 256×256 图即被删除）；BootScene 加载键/路径不变。
- **修改文件**：
  - `src/world/dungeon-event-definitions.js`：新增导出 `NEW_EVENT_BG_IMAGES` 映射表（事件键 → 背景图路径，配置驱动；旧 5 事件无对应图片未配置，保持原样）。
  - `src/world/dungeon-event-system.js`：新增 `_createEventBgLayer(eventType)`——全屏背景层（`position:fixed; left:0; bottom:0; 100vw×100vh; background-size:100% 100%` 平铺拉伸，bottom 固定像素定位符合规则 3）；`_showEventUI` 与 `_showResultUI`（经 `this._currentEventType` 查表）均在面板之下插入背景层，有背景图时面板背景由 0.98 调为 0.85 半透明透出底图。
  - `src/world/combat-room-system.js`：新增 `FLOOR_TILE_DRAW_SIZE`（32-2=30，四边各内缩 1px → 相邻小砖留 2px 纯黑缝隙）与 `FLOOR_TILE_RADIUS`（4，圆角矩形裁剪，小砖边缘圆滑，`roundRect` 缺失时回退直角）；32 切分、8 随机朝向、均匀概率、相邻不同块、64px 外圈黑渐变、灰黑 tint 均不变；新图 512×512 由现有逻辑自动推导为 16×16=256 子块/图（候选池 768）。
- **测试结果**：`npm run lint` ✅；`npx vite build` ✅（仅已知动态导入警告）；`node scripts/test-collider.mjs` ✅。
- **已知问题**：
  - 实机待验证：事件全屏背景图与半透明面板观感；地牢地板圆角砖 + 2px 黑缝视觉。
  - 10 张背景图共约 65MB 原图，如需瘦身可后续在隔离环境批量缩放至 1920 宽。

## 2026-07-17（毒液判定缩小/胖子攻击触发/近战动画锁/怪物HP/地牢地板32×32）

### 对话：四项战斗与地牢调整（v0.198+）
- **修改文件**：
  - `data/enemy-config.json`：
    - `spitterZombie.collisionRadius` 10 → 7.07（脚部 footprint 椭圆判定**面积**减少 50%：面积 ∝ r²，故 r × √0.5 ≈ 0.707；groundRadius 为阴影/分离/命中判定唯一来源，随动缩小）；`hp/maxHp` 150 → 120。
    - `fatZombie` 新增 `"attackDistance": 100`（= attackRange）：胖子僵尸只有目标进入攻击范围才发动攻击（原触发距离为 attackRange × 1.15 = 115）。
    - `zombieDog.hp/maxHp` 60 → 100；`zombie.hp/maxHp` 100 → 120；`zombieWizard.hp/maxHp` 500 → 600。
  - `src/entities/player/update.js`：近战普通攻击增加输入闸门——攻击动画未播放完（`weaponAnim.state === 'attacking'`，三条近战 Tween 路径全覆盖）时忽略左键输入：不重播攻击动画、不产生新的攻击判定；冲刺攻击/弓箭/枪械分支不受影响。
  - `src/world/combat-room-system.js`：僵尸地牢地板由 256×256 整图平铺改为将三张 blackbrick 源图切割为 32×32 子块（3 × 8 × 8 = 192 块候选池）随机拼铺；每块随机 8 种朝向（4 旋转 × 水平翻转，覆盖全部二面体群朝向），相邻（上/左）不使用同一子块；边缘黑渐变与灰黑 tint 逻辑不变，烘焙仍为一整张贴图（一次性开销）。
- **钩稽确认**：enemy-config.json 无 `public/` 副本（单源，Vite 打包导入）；地牢工厂 `zombie-dungeon.js` 与主神空间 `spawnMain*` 均展开 `...cfg` 继承配置，HP/判定改动自动生效；图鉴经 DataLoader 读同一配置自动同步。
- **测试结果**：enemy-config.json JSON 校验通过；`npm run lint` ✅；`npx vite build` ✅；`node scripts/test-collider.mjs` ✅。
- **已知问题**：
  - 毒液僵尸 collisionRadius 7.07 会同步缩小阴影/实体分离/近战地面判定（与 groundRadius 强绑定设计一致）；若只需缩小投射物椭圆判定需另提方案。
  - 实机待验证：胖子僵尸攻击触发距离手感、近战连点锁定手感、32×32 地板视觉。

## 2026-07-17（工作规则文档修订）

### 对话：删除过时规则 + 新增 4 条最高优先级规则
- **修改文件**：
  - `docs/work-rules.md`：整体重写。删除 legacy.js 单文件时代的全部过时内容（单文件架构禁令、legacy 备份命令、旧 DOM/CSS 限制、legacy 语境的对话迁移机制、旧命令速查）；保留仍有效的开发工作流、代码修改安全规则（数值保护/先注释后删/深拷贝/onmouseenter）、冒烟测试清单、沟通规则、质量门禁；备份命令更新为 `node scripts/backup.js`，验证三件套更新为 lint / build / test-collider。
  - `WORKING-GUIDELINES.md`：版本号更新为 V0.198+；新增原则 6-9；提交检查清单同步增加 4 项自查。
- **新增 4 条规则（与旧规则冲突时以新规则为准）**：
  1. 能不硬编码就不硬编码（数值/路径/坐标入配置，唯一真相源；改数值仍需用户确认）。
  2. 开发功能前注意冲突和钩稽关系（同步链路示例：equipment.json 双份、enemy-config ↔ 地牢工厂 ↔ 图鉴 ↔ BootScene、判定逻辑 ↔ 调试可视化）。
  3. 窗口贴图与实体生成固定显示统一使用 `bottom: 固定像素`。
  4. 素材先复制进项目 `assets/` 子文件夹再开展工作，禁止引用项目外路径。
- **测试结果**：纯文档改动，无代码变更，未触发 lint/build。
- **已知问题**：无。

## 2026-07-17（普通僵尸精灵图导入与主神空间测试生成）

### 对话：弹反恢复（旧木盾数据补全）+ 掉落物显示/拾取更新（v0.198+）
- **排查结论（弹反失效根因）**：ShieldSystem 代码、弹反窗口、角度判定、isMelee 传递、右键防御输入链路全部完好（WebBridge 运行时实测：有完整 defense 数据的盾牌可正常弹反——伤害归 0、眩晕 2000ms、击退）。真正缺陷是**装备数据**：`旧木盾`（初始盾牌）条目缺少 `weaponType: 'shield'` 和整个 `defense` 块，`checkEquipped()` 永远 false，盾系统完全不激活。与新体积判定无关。`小圆盾` 数据完整，工作正常。
- **排查结论（复活后子弹不从枪口射出）**：未复现。主神空间死亡与地牢死亡→switchScene 复活两条路径实测（手动泵游戏循环验证），武器贴图/可见性/枪口计算复活后全部完好，子弹路径（_fireRanged 贴图枪口）未被改动。暂停排查，待用户提供具体复现场景。
- **修改文件**：
  - `data/equipment.json` + `public/data/equipment.json`：`old_wooden_shield` 新增 `"weaponType": "shield"` 与 `defense` 块（base 15 / perEnhance 1.5 / damageReduction 0.5 / staminaCost 20 / parryWindow 1000 / parryStun 1000 / parryKnockback 100，数值与小圆盾一致，未改变任何弹反属性）。
  - `src/entities/drop-item.js`：掉落物贴图放大 50%（32→48 / 悬停 40→60），贴图保持上下浮动；装备文字固定在物品原位下方，**不再随贴图浮动**；悬停判定半径 35→52（×1.5 匹配）；`pickupRange` 30→45。
  - `data/game-config.json`：`interactionDistances.pickupHover` 35→52（点击/悬停拾取判定匹配）；`pickup.nearbyRange` 75→112（Z 键范围拾取匹配 ×1.5）。
  - `CHANGELOG.md`：本记录。
- **测试结果**：两份 equipment.json 与 game-config.json JSON 校验通过；`npm run lint` 通过；`npx vite build` 通过。
- **已知问题**：
  - 弹反实机验证：装备旧木盾，右键防御状态下被近战命中应触发"🛡️ 弹反！"+ 攻击者眩晕击退（弹反窗口 1 秒）。
  - 掉落物实机验证：贴图大小/浮动、文字静止、悬停拾取与 Z 键范围手感。
  - 复活枪口问题待复现线索（哪把枪、哪个场景、子弹出现位置截图）。

### 对话：地牢刷怪黑色粒子特效 + 删除金属/奔跑僵尸（v0.198+）
- **修改文件**：
  - `src/phaser/scenes/GameScene.js`：新增 `_ensureDungeonSpawnTexture()`（纯黑圆点 `dungeon_spawn_dot`）与 `playDungeonSpawnParticles(x, y)`——速度 30~90（更慢）、持续 1500ms（更久）、数量 16（多 30%）、纯黑 tint、NORMAL 混合（黑色在 ADD 下不可见）、gravityY −40 轻微上飘、1600ms 后销毁发射器。
  - `src/world/combat-room-system.js`：`spawnMonsters()` 每只怪生成后在最终脚底位置调用 `playDungeonSpawnParticles`（该方法仅被地牢 dungeon-map-system 调用）。
  - `data/enemy-config.json`：删除 `armoredZombie`（装甲/金属僵尸）、`runnerZombie`（奔跑僵尸）、`fastZombie`（"Runner Zombie" 遗留重复项）三条；图鉴经 DataLoader 读同一配置，自动同步删除。
  - `src/world/zombie-dungeon.js`：删除 `createArmoredZombie`、`createFastZombie`、`ZOMBIE_FACTORY_MAP` 对应两条；级联删除无人使用的 `createZombieFromConfig`；怪物池注释同步。
  - `src/ui/enemy-sprite-tool.js`：ENEMY_LIST 删除 fastZombie 条目。
  - `CHANGELOG.md`：本记录。
- **修改内容摘要**：
  1. 地牢战斗房刷新怪物时，每只怪脚下生成 1.5 秒纯黑粒子爆发特效。
  2. 金属僵尸（armoredZombie）与奔跑僵尸（runnerZombie/fastZombie）及其工厂、工厂映射、配置、精灵工具条目全部删除；地牢普通池现为：普通僵尸、僵尸犬、毒液僵尸、胖子僵尸。
  3. CHANGELOG / SKILL.md 历史记录未改动（保留历史事实）。
- **测试结果**：enemy-config.json JSON 校验通过（17 条）；全库无残留引用；`npm run lint` 通过；`npx vite build` 通过。
- **已知问题**：实机需验证刷怪粒子视觉（浓度/速度/上飘），数值在 `GameScene.playDungeonSpawnParticles` 可调。

### 对话：枪械蛋壳从贴图中心弹出并落至脚下（v0.198+）
- **修改文件**：
  - `src/effects/shell-casing.js`：构造/reset 新增可选 `groundY` 参数；传入时蛋壳先向上抛起（vy −120~−200）再受重力（1000 px/s²）落至脚下，未传入时保持旧贴地漂移行为（回退）。
  - `src/utils/effect-factory.js`：`createShellCasing` 透传 `groundY`。
  - `src/entities/player/subsystems.js`：`_spawnShellCasing` 新增 `hand` 参数，优先从对应武器贴图中心（`weaponSprite`/`offhandWeaponSprite`）弹出、落点为玩家脚底 `this.y`；无武器贴图时回退旧的脚底相对算法。4 个调用点（主手手枪/副手手枪/机枪/霰弹）同步更新。
  - `CHANGELOG.md`：本记录。
- **测试结果**：`npm run lint` 通过；`npx vite build` 通过。
- **已知问题**：实机需验证抛壳弧线手感（抛起高度/重力/侧向速度），数值在 `shell-casing.js` 的 `_initPhysics` 可调。

### 对话：六项战斗/视觉调整（v0.198+）
- **修改文件**：
  - `src/entities/enemy-types/fat-zombie.js`：`_updateLeanOffset()` 攻击分支归 0——胖子僵尸攻击时脚下阴影与 footprint 椭圆判定保持在脚底，不再前移（walk 前倾保留）。
  - `src/phaser/scenes/GameScene.js`：
    - `syncWeapon`（主手+副手）：远程武器贴图旋转改为 `atan2(鼠标世界坐标 − 武器位置)`，枪管精确穿过准心，消除手部锚点视差导致的固定角度偏移；近战不变。
    - `triggerZombieHitParticles`：受击绿色粒子锚点从脚底改为贴图中心（`y − footOffsetY`），保留朝向来源的侧向偏移。
  - `src/config/player-defaults.js`：`collisionRadius` 30 → 22.5，玩家脚下椭圆判定缩小 25%，阴影/分离/墙碰/被命中判定随动。
  - `src/entities/entity.js`：`groundRadius` 标注为阴影/footprint 椭圆/分离/墙碰与命中判定的**唯一来源**（强绑定约定注释）。
  - `src/physics/skill-shapes.js`：新增 `GroundSector`（地面扇形）与 `GroundDirectedRect`（地面有向矩形，含 backExtension）——只看目标 footprint，不查 Z，飞行单位免疫。
  - `src/combat/attack.js`：`SlashAttack` → `GroundSector`、`ThrustAttack.checkTriangleHit` → `GroundDirectedRect`，判定原点从"视觉身体中心"归回**攻击者脚底**（移除 footOffsetY 上移），范围可视化原点同步；推击/夜与火/冲刺技能/mutant-3 自定义攻击未动。
  - `scripts/test-collider.mjs`：新增 13 个地面形状用例。
  - `CHANGELOG.md`：本记录。
- **修改内容摘要**：
  1. 枪械（含双持副手）贴图朝向始终精准对准鼠标准心；弹道原本即朝准心，改后"贴图 = 弹道 = 准心"三者一致。
  2. 近战斩击/突刺判定从脚下椭圆出发平铺地面，判定与范围可视化、footprint 调试椭圆口径统一。
  3. 玩家 footprint 缩小 25%（30→22.5），阴影面积同步缩小（groundRadius 单一驱动）。
  4. 僵尸受击绿粒子从身体中心爆出，不再出现在脚下地面。
- **测试结果**：`node scripts/test-collider.mjs` 全部通过（累计 35 个用例）；`npm run lint` 通过；`npx vite build` 通过。
- **已知问题**：
  - 实机需验证：枪械各距离/垂直瞄准的贴图对准、近战范围圈与 footprint 的对齐手感、胖子攻击影子位置、粒子位置。
  - 近战判定原点下移后，攻击范围的屏幕位置整体下移一个 footOffsetY，若觉得"够不到上方目标"可再议 weaponOffset 前伸补偿。

### 对话：技能投射物接入躯干矩形判定（冰锥/火球/符文剑）（v0.198+）
- **修改文件**：
  - `src/physics/torso-hitbox.js`（新建）：躯干矩形**共享判定模块**——`getTorsoRect`（唯一推导口径：render.projectileHitbox，缺省 collisionWidth × 身高）、`segmentHitsTorso`（扫掠线段）、`pointHitsTorso`（逐帧点判定，FLYING 免疫与 GroundCircle 语义对齐）。
  - `src/combat/projectile.js`：`_hitTorsoRect` 改为调用共享模块，行为不变。
  - `src/entities/components/ice-spike-system.js`：冰锥飞行命中改为 GroundCircle ∪ 躯干矩形（r=12）。
  - `src/entities/components/fireball-system.js`：火球**飞行**命中改为 GroundCircle ∪ 躯干矩形（r=20）；爆炸 AOE（GroundCircle）未动。
  - `src/entities/components/rune-sword-system.js`：符文剑飞行命中改为 GroundCircle ∪ 躯干矩形（r=15）。
  - `src/phaser/scenes/GameScene.js`：绿色调试矩形改用共享模块推导，与判定口径一致。
  - `scripts/test-collider.mjs`：新增 10 个共享模块用例（推导/点判定/缺省/FLYING 免疫）。
  - `CHANGELOG.md`：本记录。
- **修改内容摘要**：
  1. 冰锥/火球/符文剑命中贴图身体位置（躯干高度）现在有效，与枪械同一判定口径。
  2. 判定推导集中在 torso-hitbox.js 一处，投射物/技能/调试可视化三方共用，无重复编码。
  3. 爆炸 AOE、近战判定未做任何改动。
- **测试结果**：`node scripts/test-collider.mjs` 全部通过（累计 22 个躯干用例）；`npm run lint` 通过；`npx vite build` 通过。
- **已知问题**：
  - 实机手感未验证：技能投射物躯干命中是否过宽，可用"范围"按钮绿矩形对照微调。
  - 无人机/旋风/推击/夜与光柱等 AOE 类技能维持原判定，未纳入（非投射物）。

### 对话：投射物新增躯干矩形判定（方案 B，仅投射物）（v0.198+）
- **修改文件**：
  - `src/physics/collision-3d.js`：新增 `segmentIntersectsExpandedRect`（Liang-Barsky 线段-膨胀矩形相交，零长线段退化为点包含）。
  - `src/combat/projectile.js`：新增 `_hitTorsoRect`——屏幕空间躯干矩形判定，锚定 collider 脚底中心，取 `render.projectileHitbox`（宽/高/offsetX/bottom），缺省为 `collisionWidth × 身高`，新怪物零配置自动获得；地面目标命中改为 **footprint 椭圆 ∪ 躯干矩形 ∪ 身体圆柱** 任一命中，飞行目标不变。**近战判定（attack.js/skill-shapes.js）未做任何改动**。
  - `data/enemy-config.json`：7 个精灵图怪物的 `render` 新增实测 `projectileHitbox`（zombie 31×103、fatZombie 44×137、spitterZombie 29×81、zombieWizard 46×112、mutant3 68×110、zombieDog 81×83、blackWolf 120×65），数值来自首帧内容边界按 spriteSize 换算。
  - `src/phaser/scenes/GameScene.js`："范围"调试层新增绿色描边矩形，实时显示每个实体的投射物躯干矩形。
  - `scripts/archive/measure-projectile-hitbox.py`（新增一次性测量脚本）、`scripts/archive/prepare-zombie-sprites.py`（前次归档）。
  - `scripts/test-collider.mjs`：新增 12 个躯干矩形判定用例。
  - `CHANGELOG.md`：本记录。
- **修改内容摘要**：
  1. 枪械瞄准敌人贴图身体（躯干/头部）现在可以命中，不再需要瞄脚下 footprint 椭圆。
  2. 判定仅作用于投射物（玩家枪械、毒液投射物等对玩家同样生效）；近战斩击/突刺的 Z 区间判定完全不变。
  3. 躯干矩形逐怪按贴图内容实测配置，未配置的实体使用缺省推导，无硬编码。
- **测试结果**：`node scripts/test-collider.mjs` 全部通过（含 12 个新用例）；`npm run lint` 通过；`npx vite build` 通过。
- **已知问题**：
  - 实机手感未验证：躯干命中区间是否过宽/过窄，可用"范围"按钮的绿色矩形对照贴图逐怪微调 `projectileHitbox`。
  - redWolfKing 无 render 配置，走缺省推导（collisionRadius×2），未实测。
  - 冰锥/火球/符文剑等技能投射物仍走各自 GroundCircle 地面判定，未纳入本次范围。

### 对话：僵尸攻击线性突进 + 地牢同步接入精灵图僵尸（v0.198+）
- **修改文件**：
  - `src/entities/enemy.js`：基类新增**配置驱动的通用线性突进机制**——构造函数初始化 `_lungeActive/_lungeDistance/_lungeApplied/_lungeAngle`；`triggerWeaponAnim()` 在 `config.attack.lungeDistance > 0` 时锁定朝目标（无目标用 rotation）的突进角度；`update()` 在眩晕检查后调用新增的 `_updateLunge()`，攻击动画期间按 `1 - _attackTimer/_attackDuration` 线性推进，增量式位移（不覆盖击退/分离等外部位移），每帧 `WallSystem.resolve` 撞墙校验。任何怪物只要在 enemy-config.json 配置 `attack.lungeDistance` 即在任何场景自动获得该行为，无硬编码。
  - `data/enemy-config.json`：`zombie.attack` 新增 `lungeDistance: 100`。
  - `src/world/zombie-dungeon.js`：`createBasicZombie` 从 `CircleEnemy` 圆形占位改用新 `Zombie` 类（仿 createFatZombie 工厂模式，含缺失配置 fallback），地牢普通僵尸同步获得精灵图动画与突进。
  - `CHANGELOG.md`：本记录。
- **修改内容摘要**：
  1. 僵尸攻击时，1 秒攻击动画期间向攻击开始时锁定的方向匀速突进 100px，撞墙沿墙滑/停下。
  2. 地牢普通僵尸与主神空间测试僵尸使用同一 `Zombie` 类 + 同一 JSON 配置，行为完全一致。
  3. 黑狼 pacing 冲刺机制（`_prepareDashAttack`/`_attackDashOffset`）未改动。
- **测试结果**：`npm run lint` 通过；`npx vite build` 通过；`node scripts/test-collider.mjs` 全部通过。
- **已知问题**：
  - 实机效果未验证：突进距离/时长手感、突进撞墙表现、贴脸后分离力推开表现需实机确认。
  - 地牢中的 `runnerZombie`（奔跑僵尸）与 `armoredZombie`（装甲僵尸）仍为 CircleEnemy 圆形占位，如需精灵图需各自接入。

### 对话：僵尸 idle/walking/attacking 精灵图接入（v0.198+）
- **修改文件**：
  - `assets/enemies/zombie/`（新建）：idle.png（1 帧）/ walking.png（15 帧）/ attacking.png（15 帧），统一 8×4 网格 512×512 帧；内容高度统一约 440px（hRatio≈0.86，与胖子僵尸/毒液僵尸/僵尸巫师一致），水平居中、底部对齐 y=496。
  - `scripts/archive/prepare-zombie-sprites.py`（新增一次性脚本）：素材重排与内容尺寸统一处理。
  - `data/enemy-config.json`：`zombie` 条目新增 `render`（spriteSize 120 / collisionWidth 30 / collisionHeight 50 / footOffsetY 56）、`textures`（含 idleSheetColumns: 8 图鉴截取）、`attackDistance: 100`；`attackRange` 90→100、`attack.cooldown` 800→2000、`attack.dynamicRange` 90→100、`collisionRadius` 10→15。
  - `src/phaser/scenes/BootScene.js`：加载 `enemy_zombie_idle/walk/attack` 三张 spritesheet（endFrame 0/14/14）并注册同名动画；攻击动画 `duration: 1000, repeat: 0`（1 秒）。
  - `src/entities/enemy-types/zombie.js`（新建）：`Zombie` 类继承 `Enemy`，仿 fat-zombie 模式；`_attackDuration = 1000`，`triggerWeaponAnim()` 调 super 保证 ThrustAttack 命中判定；显式 `animKey: enemy_zombie_${state}`。
  - `src/entities/enemy-types.js`：import 并导出 `Zombie`。
  - `src/game.js`：import `Zombie`，新增 `spawnMainZombie()`（主神原点 +250/+120，永久警戒），初始化时调用。
  - `src/world/scene-manager.js`：返回主神空间时调用 `spawnMainZombie()`。
  - `src/ui/enemy-sprite-tool.js`：`ENEMY_LIST` 新增 `{ key: 'zombie', name: '僵尸' }`。
  - `scripts/generate-sprite-offsets.js`：SHEETS 新增普通僵尸 3 条；重跑生成 `data/sprite-offsets.json` 并同步 `public/data/sprite-offsets.json`。
- **修改内容摘要**：
  1. 普通僵尸从圆形占位升级为精灵图动画（待机 1 帧 / 移动 15 帧 / 攻击 15 帧）。
  2. 攻击动画固定 1 秒、攻击间隔 2 秒、攻击距离判定 100px（走 CombatSystem 现有 `attackDistance` 逻辑，无硬编码）。
  3. 素材原始面向右，翻转逻辑与胖子僵尸一致（朝左时 flipX）。
  4. 主神空间生成一只普通僵尸用于测试（与胖子僵尸并列），返回主神空间时自动重生。
  5. 地牢普通僵尸生成工厂未改动，仍走旧 CircleEnemy 逻辑。
- **测试结果**：`npm run lint` 通过；`npx vite build` 通过；`node scripts/generate-sprite-offsets.js` 重跑成功（idle 1 帧 / walk 15 帧 / attack 15 帧）。
- **已知问题**：
  - 实机效果未验证：待机/移动/攻击切换是否自然、footOffsetY=56 与阴影对齐、攻击判定距离手感，需实机确认后可用 DevTool 微调。
  - 地牢中的普通僵尸仍是圆形占位，如需替换为精灵图需改 `zombie-dungeon.js` 的 `ZOMBIE_FACTORY_MAP.zombie`。

---

## 2026-07-12（怪物贴图兜底、僵尸犬动画、AI 与地牢问题排查）

### 对话：修复怪物显示问题并接入僵尸犬素材（v0.198+）
- **修改文件**：
  - `src/phaser/scenes/GameScene.js`：自动为缺失 Sprite 的敌人创建 `enemy_circle` 占位；`_configureEnemyBody` 碰撞半径翻倍；新增 `_syncEnemyAnimation` 同步敌人动画/翻转/纹理；`_syncEntityHud` 识别 `noNameLabel` 去重；限定动画同步只处理 `_faction === 'enemy'`，修复武器/中立实体被强制变圆的 Bug。
  - `src/phaser/scenes/BootScene.js`：加载僵尸犬精灵图并注册 `zombie_dog_walk/run/attack` 动画；`projectile_spit` 改为绿色实心圆。
  - `src/entities/enemy-types.js`：新增 `ZombieDogEnemy` 类。
  - `src/world/zombie-dungeon.js`：所有地牢怪物覆盖全图索敌参数。
  - `src/world/scene-manager.js`：回到主神空间时清理怪物并重新生成僵尸犬。
  - `src/game.js`：删除主神空间原 5 只测试圆形敌人，改为生成一只僵尸犬。
  - `src/combat/projectile.js`：毒液投射物显示尺寸缩小 30%。
  - `data/enemy-config.json`：毒液僵尸投射物速度 540 → 270。
  - `SKILL.md`、`CHANGELOG.md`、`.gitignore`：更新文档与忽略 `.venv/`。
- **修改内容摘要**：
  1. 所有怪物恢复为 `enemy_circle` 占位显示，碰撞体积扩大一倍。
  2. 毒液僵尸投射物速度再降 50%，并改为绿色实心小圆。
  3. 地牢怪物全局仇恨，不会丢失目标。
  4. 战后出口传送门名称不再重复显示。
  5. 接入僵尸犬外部素材，统一 512×512 帧并制作 walk/run/attack/idle 动画。
  6. 主神空间仅保留一只测试用僵尸犬，便于动画调试。
  7. 排查地牢怪物卡墙根因：出生带贴墙 + `WallSystem.resolve` 无脱困逻辑。
  8. 排查近战 AI 迂回根因：`separation` 排斥过强 + 攻击范围内摩擦与排斥冲突 + 路径跟随/墙体滑动问题。
- **测试结果**：`npx eslint src --max-warnings=0` 通过；`npx vite build` 通过。
- **已知问题**：
  - 地牢怪物卡墙与近战 AI 迂回尚未实际修复，已输出完整缺陷与改进方向，待后续实施。
  - 僵尸犬 idle 状态使用单帧图片，未注册 idle 动画。

---

## 2026-07-11（Phaser 迁移收尾 + Canvas 死代码清理）

### 对话：完成 Phaser 迁移并清理中优先级技术债务（v0.198）
- **修改文件**（15+ 个文件）：
  - `src/world/map-generator.js`：地形生成改为 Phaser Graphics API，删除手动 Canvas 创建。
  - `src/world/renderer.js`：删除 `MapGenerator` 导入、地形生成、`_bakeGridAndBorder`；保留 `terrainTexture` 作为特殊场景覆盖入口。
  - `src/phaser/scenes/GameScene.js`：`_syncTerrain()` 优先使用 `Renderer.terrainTexture` 覆盖，否则用 Phaser Graphics 生成；新增 `_drawGridAndBorder()`。
  - `src/game.js`：非地牢地图模式下隐藏 `gameCanvas`，停止无意义 `clear()`。
  - `src/entities/entity.js`：删除 `render(_ctx)`、`renderCollisionRadius(ctx)` 及 `Renderer` 导入。
  - `src/components/hitbox.js`：删除 `renderDebug(ctx)` 及 `Renderer` 导入。
  - `src/ai/enemy-fsm.js`：删除 `PhaseChangeEffect` 类及导出。
  - `src/entities/enemy.js`：删除 `PhaseChangeEffect` 引用与导入。
  - `src/ui/game-ui-manager.js` / `src/utils/dom-utils.js`：新增 `getElementIfExists`，简化 HUD 跳过逻辑，避免 DOM 缺失警告。
  - `src/game.js` / `src/ui/game-ui-manager.js`：删除 `showHitbox` 死代码。
  - `src/game.js`：删除对 `GameUIManager.initHitboxToggle()` 的调用，修复启动时报错。
  - `PHASER_MIGRATION_PLAN.md`、`PROJECT_STATE.md`、`CHANGELOG.md`：更新迁移状态。
- **修改内容摘要**：
  1. 主场景地形由 Phaser Graphics 直接生成 Texture，不再经过 `HTMLCanvasElement` 中间层。
  2. 保留 `Renderer.terrainTexture` 覆盖机制，兼容战斗场地、BOSS、雪地/火车等特殊场景。
  3. `Game.render` 仅在 `scene7` 地牢地图模式下显示并清屏 `gameCanvas`。
  4. 删除所有确认失效的 `render(ctx)` / 绘制辅助方法 / 调试渲染代码。
  5. `GameUIManager` 对缺失/隐藏的简单 HUD 元素使用静默查询，消除控制台警告。
- **测试结果**：`npx eslint src --max-warnings=0` 通过；`npx vite build` 通过。
- **已知问题**：
  - `scene3` 火车背景已删除 Canvas 实现，待后续重新设计。
  - `FloatingTextEffect` 等部分特效只剩 `update`、没有渲染，需后续 Phaser 化或删除。

---

## 2026-07-05（智能寻路系统：参考《环世界》预规划 + 局部修复）

### 对话：开发智能寻路系统（v0.198）
- **修改文件**（5 个文件）：
  - `src/ai/path-manager.js`：新建智能路径管理器，实现路径缓存、定期有效性检查（1.5-2.5秒）、局部修复（障碍物附近搜索替代路线）
  - `src/ai/pathfinder.js`：增强 A* 寻路器，增加地形权重（树木1.5x/拥挤1.3x）、区域连通性检查（Flood Fill）、全局路径缓存（3秒/50条上限）
  - `src/systems/movement-system.js`：主动预规划（有目标无路径时立即计算）、PathManager 集成、`_followPath` 使用 PathManager API、`_updateStuckDetection` 使用 PathManager fallback
  - `src/entities/enemy.js`：构造函数初始化 `_pathManager`（懒加载）、fallback `_updateMovement` 兼容 PathManager
- **修改内容摘要**：
  1. 主动预规划：单位看到目标时立即计算路径，而不是等卡住才反应
  2. 定期路径检查：PathManager 每 1.5-2.5 秒扫描路径节点，检测新障碍物
  3. 局部修复：路径被阻挡时，在障碍物前后 2 个节点范围内搜索替代路径，拼接回原路径；失败后从阻挡点重算到终点；连续3次失败清除路径
  4. 地形权重：A* 中树木附近移动成本 1.5x，拥挤区域 1.3x，单位自然绕行
  5. 区域连通性：findPath 前先用 Flood Fill 判断目标是否可达，避免无效 A* 计算
  6. 路径缓存：全局缓存计算结果，相同起点+终点+半径复用，3秒有效期，50条上限
  7. 向后兼容：旧 `enemy._path` 和 `enemy._pathIdx` 仍然保留，MovementSystem 和 Enemy fallback 模式自动回退
  8. **修复**：`isReachable()` Flood Fill 步数限制过死（`ceil(maxDist/step)+5` → `ceil(maxDist/step)*3+20`），导致路径计算完全失败，单位卡在树木边缘无法移动
- **测试结果**：node 语法验证通过（path-manager.js、pathfinder.js、movement-system.js 全部 OK）
- **已知问题**：PathManager 的 `_getMoveCost` 检查其他单位时，可能因 Game.entities 遍历量较大而性能开销增加，后续可考虑优化

---

## 2026-07-05（硬编码清理 + 碰撞体积优化）

### 对话：全面硬编码清理 + 黑狼碰撞体积缩小 + 树木碰撞优化（v0.198）
- **修改文件**（13 个文件）：
  - `data/enemy-config.json`：黑狼 `collisionRadius` 88→38（缩小一半以上）
  - `src/world/wall-system.js`：树木碰撞体分离（`collisionRadius = radius × 0.6`），`resolve()` 添加逐步缩减步长回退，避免大怪物卡树
  - `src/entities/damageable-entity.js`：新增 `_updatePoison`/`_updateBleed`/`_updateMagicVulnerability`/`_updateDroneVulnerability`，4种状态效果统一在 `update()` 中驱动
  - `src/entities/combatant.js`：补充缺失的状态效果属性初始化（`_bleedStacks`、`_magicVulnerabilityStacks` 等）
  - `src/entities/enemy.js`：删除 15 行冗余状态效果属性 + 删除 114 行重复 `_update*` 方法 + 新增 `_getDashOffset()` 统一接口 + 删除死代码 `anim.timer === 0`
  - `src/systems/combat-system.js`：删除 85 行重复状态效果代码 + 更新注释 + 删除死代码 `anim.timer === 0` + 修复 `class` 闭合括号缺失（Vite 500 错误）
  - `src/phaser/scenes/GameScene.js`：dash 偏移逻辑统一为 `entity._getDashOffset()`，替代 inline switch
  - `src/world/scene-manager.js`：删除未使用的战术小队类导入（`Commander`/`MachineGunner`/`Rifleman`/`FlankRifleman`/`ShieldBearer`）
  - `src/entities/components/shield-system.js`：修复 `const defense` 重复声明导致的语法错误
- **修改内容摘要**：
  1. 状态效果系统重构：4种伤害型状态效果（中毒/流血/易伤）统一提取到 `DamageableEntity` 基类，消除 `enemy.js` 和 `combat-system.js` 中的重复代码（共删 200+ 行）
  2. 消除重复执行 bug：之前状态效果每帧被更新两次（`Enemy.update` + `CombatSystem.update`），导致中毒/流血伤害翻倍
  3. dash 偏移统一：基类定义 `_getDashOffset()`，所有调用方（GameScene.js、BlackWolf）统一使用
  4. 树木碰撞优化：视觉半径和碰撞半径分离（60%），resolve() 添加滑动回退，大怪物（碰撞半径 38）在树木间移动更流畅
  5. 死代码删除：`anim.timer === 0` 永远不会触发（因为 `dt > 0`），删除两条重复代码
  6. 语法修复：shield-system.js `const defense` 重复声明修复；combat-system.js 类闭合括号缺失修复
- **测试结果**：node 语法验证全部通过，Vite 编译通过
- **已知问题**：humanoid-monster.js 武器配置仍有硬编码，战术小队未启用暂不处理

---

## 2026-07-05（补充）

### 对话：删除普通怪物 + 方案B渲染模板重构（v0.198）
- **修改文件**（12 个文件）：
  - `src/entities/enemy-types.js`：删除 14 个普通怪物类（Zombie/Spider/Skeleton/Necromancer/DeathKnight/BigBoss），仅保留 BlackWolf（254行→200行）
  - `src/entities/enemy.js`：重构 `render()` 为通用模板，新增 7 个可覆盖钩子方法（_getRenderPosition/_getTextureKey/_getPhaserOptions/_drawBody/_renderNameTag/_renderPoisonEffect/_renderHitFlash）
  - `data/enemy-config.json`：删除 14 个怪物配置，仅保留 blackWolf
  - `src/main.js`：删除对应 import 和全局挂载
  - `src/game.js`：怪物生成用 BlackWolf 替代，修复多余 `}` 语法错误
  - `src/world/scene-manager.js`：场景怪物池用 BlackWolf 替代
  - `src/world/dungeon-map-system.js`：地牢怪物池用 BlackWolf+战术小队替代
  - `src/ai/synergy-system.js`：删除涉及已删除怪物的协同规则
- **修改内容摘要**：
  1. 删除所有普通怪物代码（14个类），保留 BlackWolf 和战术小队（6个类）
  2. 方案B：提取通用渲染模板到 Enemy.render()，BlackWolf 使用钩子方法注入自身逻辑
  3. 新增怪物只需实现 4 个钩子方法（_getRenderPosition/_getTextureKey/_getPhaserOptions/_drawBody）
  4. 所有怪物属性统一通过 enemy-config.json 配置（攻击/防御/血量/速度等）
  5. 修复 Vite 500 错误：game.js 多余括号 + scene-manager.js 错误 import 路径
- **测试结果**：Vite 编译通过，语法检查通过
- **预期效果**：新增怪物开发效率大幅提升，只需配置 JSON + 实现钩子方法
- **已知问题**：战术小队（humanoid-monster.js）当前独立渲染，后续可改造为使用基类模板

## 2026-07-05

### 对话：黑狼贴图朝向调试 + 怪物贴图调整工具（v0.198）
- **修改文件**（9 个文件）：
  - `src/entities/enemy-types.js`：BlackWolf render 使用原始精灵图（不旋转），left 方向通过 flipX 水平镜像实现
  - `src/entities/enemy.js`：修复 `_renderPhaserSync` — 旋转同步通过 `this.rotation` 让 GameScene.update 处理；flip 通过 `setScale` 负值实现，避免与 `setFlipX/Y` 冲突
  - `src/ui/enemy-sprite-tool.js`：新建怪物贴图调整工具，支持选择怪物、方向、精灵图、大小、旋转、翻转，实时预览
  - `src/ui/dev-tool.js`：导入并初始化 EnemySpriteTool，挂载到 `window`
  - `index.html`：添加"怪物" Tab 和贴图调整界面
  - `game-style.css`：添加怪物贴图调整工具样式
  - `assets/enemies/black_wolf.png`：已重排为 2行×4列均匀网格
  - `assets/enemies/black_wolf_updown.png`：新建上下向精灵图
  - `src/phaser/scenes/BootScene.js`：加载黑狼精灵图
- **修改内容摘要**：
  1. 黑狼贴图朝向问题：原始精灵图是垂直方向（上下向），通过工具调试发现最佳方案是"不旋转，直接用原始贴图 + flipX 镜像区分左右"
  2. 修复 Phaser flip 陷阱：`setScale(scale)` 会覆盖 `setFlipX/Y` 的符号，正确做法是通过 `setScale(scaleX, scaleY)` 负值实现 flip
  3. 修复 Phaser 旋转同步：`_renderPhaserSync` 设置 `this.rotation = options.rotation - Math.PI/2`，让 `GameScene.update` 的 `setRotation(entity.rotation + Math.PI/2)` 正确工作
  4. 新建怪物贴图调整工具：用户自行调整参数，导出 JSON，代码读取应用，降低沟通成本
  5. 更新 `game-dev-workflow` SKILL.md：添加精灵图朝向调试经验章节
- **测试结果**：right/left 方向贴图朝向正确，水平镜像成功
- **预期效果**：黑狼左右移动贴图朝向正确，用户可通过工具自行调整其他怪物
- **已知问题**：
  - up/down 方向尚未调整（用户计划后续使用工具调整）
  - 其他 14 个怪物的朝向仍使用默认配置，需要逐个调整

## 2026-07-03

### 对话 2：AI系统重构 + 50+怪物性能优化（v0.197）
- **修改文件**（7 个核心文件）：
  - `src/game.js`：在实体 update 后集成 MovementSystem + CombatSystem + PerceptionSystem 调用
  - `src/entities/enemy.js`：精简 update，外部系统存在时跳过旧移动/攻击/状态效果逻辑，避免重复调用
  - `src/systems/movement-system.js`：添加寻路冷却（2000ms），SpatialPartitionSystem 范围查询替代全量遍历
  - `src/systems/combat-system.js`：复用 PerceptionSystem LOS 缓存，减少 WallSystem.blocked 调用
  - `src/ai/pathfinder.js`：grid 分辨率 20→40，减少 A* 网格数量 75%
  - `index.html`：版本号更新到 V0.197
  - `src/game.js`：版本号更新到 0.197
- **修改内容摘要**：
  1. 诊断场景2/4怪海卡顿根因：双重寻路触发（Enemy._updateMovement + MovementSystem）+ A*寻路风暴（100只僵尸×3600格子=500万次操作/500ms）+ O(n²)目标扫描
  2. 架构重构：game.js 统一调用 MovementSystem/CombatSystem/PerceptionSystem，enemy.js 改为外部系统驱动
  3. MovementSystem 性能优化：寻路冷却 2 秒、SpatialPartition 范围查询、grid 分辨率降低
  4. CombatSystem 视线缓存：复用 PerceptionSystem LOS 缓存，避免每帧射线检测
  5. 清理旧备份：删除 50+ 个旧备份文件，释放 18MB 硬盘空间
  6. 创建新备份：backup/v2026-07-03_23-16-19/
- **测试结果**：所有文件语法验证通过，Git 提交 e7da369
- **预期效果**：50-100 怪同屏从卡顿→流畅，总体性能提升约 100x
- **已知问题**：
  - 需实际测试场景2/4确认怪物行为正常
  - 如果 MovementSystem 有 bug，enemy.js 有 fallback 逻辑（当外部系统不存在时启用旧逻辑）

### 对话 1：战术小队武器系统 + 弹道渲染 + 无人机状态栏（v0.196）
- **修改文件**（41 个文件，+6647 -567 行）：
  - `src/entities/combatant.js`：新建 Combatant 基类，共享武器/弹药/散布/过热系统
  - `src/entities/humanoid-monster.js`：新建 HumanoidMonster 基类 + 5 个战术小队子类（Commander/MachineGunner/Rifleman/FlankRifleman/ShieldBearer）
  - `src/entities/enemy.js`：改为继承 Combatant，Enemy._updateMovement 支持 _tacticalTarget 和 _specialTacticalTarget
  - `src/entities/player.js`：导入 StatusBar；新增 applyDroneVulnerability / removeDroneVulnerability 状态栏集成（🛸 + 5秒倒计时）
  - `src/entities/combatant.js`：fireProjectile 中敌人使用 isTracer 曳光弹；修复 Projectile 参数顺序错误（noRender='physical' 导致弹道不可见）
  - `src/combat/projectile.js`：isTracer 曳光弹渲染（淡金色弹道线）
  - `src/ai/tactical-squad-ai.js`：共享视野 + 死追到底 + 附近搜索；指挥官无人机技能自动施加/移除；渲染红色虚线圆圈（800px）
  - `src/ai/battle-commander.js`：新建战场指挥 AI
  - `src/ai/synergy-system.js`：新建协同效应系统
  - `src/systems/combat-system.js`：新建 CombatSystem，双路径（_isHumanoid 走 fireProjectile / 传统走 attack.use）
  - `src/systems/perception-system.js`：新建感知系统
  - `src/systems/decision-system.js`：新建决策系统
  - `src/systems/movement-system.js`：新建移动系统
  - `src/systems/formation-system.js`：新建阵型系统
  - `src/systems/spatial-partition-system.js`：新建空间分区系统
  - `src/systems/tactical-squad-role-switch.js`：新建角色晋升系统
  - `src/world/scene-manager.js`：场景五 _loadScene5 战术小队生成；WallSystem.canMoveTo 墙壁检测防止卡墙
  - `src/world/renderer.js`：renderMinimap 使用 e._faction 和 e.itemData 替代 instanceof Enemy/DropItem（避免 ES 模块导入失效）
  - `data/humanoid-squad-config.json`：新建外部配置（武器 + 角色）
  - `data/humanoid-weapon-config.json`：新建武器回退配置
  - `src/main.js`：挂载所有新类到 window
  - `index.html`：版本号更新到 V0.196
  - `src/game.js`：版本号更新到 0.196
- **修改内容摘要**：
  1. 战术小队使用玩家同款真实武器系统（5种枪械 + 弹药/过热/散布）
  2. 修复弹道不可见：fireProjectile 参数顺序错误导致 noRender='physical'（truthy）→ 弹丸不渲染
  3. 修复 CombatSystem 重复 _updateAttack 覆盖导致战术小队无法开火
  4. 修复 renderer.js 小地图实体检测：Array.isArray 不支持 Map；instanceof Enemy 因未导入永远为 false
  5. 新增指挥官无人机技能：自动施加/移除无人机易伤；状态栏显示 🛸 图标 + 5秒倒计时
  6. 修复场景五卡墙：WallSystem.canMoveTo 墙壁检测，玩家和战术小队生成前检查安全位置
  7. 修复 Enemy 继承 Combatant 后数据字段覆盖：Object.assign 合并而非直接赋值
  8. 修复战术小队武器渲染：entity-local 坐标系 + Math.PI/2 旋转对齐 + 统一尺寸
- **测试结果**：游戏正常进入场景五，战术小队开火、弹道可见、玩家掉血、无人机状态栏显示
- **已知问题**：
  - 战术小队偶尔被复杂地形卡住，需进一步优化寻路
  - 无人机 debuff 在指挥官死亡后不会自动清除（应清理）
  - 指挥官红色范围圈在指挥官死亡后仍显示（应隐藏）

## 2026-07-04

### 对话：战术小队 AI 全面优化 + 自动追踪无人机（v0.199）
- **修改文件**（11 个核心文件，+538 -288 行）：
  - `src/ai/tactical-squad-ai.js`：自动追踪无人机系统（释放/追踪/回收/范围判定），机枪手跟随指挥官，盾位更贴身（120px），步枪手侧翼包抄，所有角色移动目标优先级统一
  - `src/systems/movement-system.js`：x/y 分解滑动（沿墙移动不卡死），卡住检测寻路目标与实际目标一致，单位间排斥，_specialTacticalTarget 最高优先级，寻路路径点被墙挡住时重新寻路
  - `src/systems/formation-system.js`：停止直接移动，只设置 _tacticalTarget
  - `src/combat/attack.js`：修复 `cooldown: 0` 被 `|| 1000` 误判为 1000 的 bug（`config.cooldown || 1000` → `config.cooldown !== undefined ? config.cooldown : 1000`）
  - `src/systems/combat-system.js`：遍历所有攻击类型更新冷却，修复 `_updateAttacks` 只更新 primary 的问题
  - `src/entities/humanoid-monster.js`：六维计算伤害（`data.atk`），不再硬编码 1；不再覆盖 `attackRange`（保持武器原始射程）；盾位 Canvas 小圆盾贴图；盾位速度 31.2→39
  - `src/entities/damageable-entity.js`：防御公式统一为 `def/(def+60)`（物理/魔法同步），10% 保底伤害
  - `src/entities/enemy.js`：`calculateCombatStats` 新增 `maxHp` 同步，删除旧覆盖公式和硬编码 hp/maxHp
  - `src/entities/player.js`：14 处硬编码子弹速度改为 1248；`droneVulnerability` timer 改为 999999（由范围判定控制移除）
  - `src/entities/combatant.js`：删除重复的 `createDamageText`
  - `src/main.js`：挂载 MovementSystem/CombatSystem/PerceptionSystem 到 window
- **修改内容摘要**：
  1. 战术小队卡墙修复：FormationSystem 停止直接移动 + MovementSystem 沿墙滑动 + 寻路目标一致
  2. 指挥官自动追踪无人机：释放→追踪玩家→300px 范围判定→敌我识别（排除友军）→离开范围立即移除 debuff
  3. 机枪手跟随指挥官（侧翼 100px），盾位贴身 120px（冲锋加速 20%），步枪手 500px 侧翼
  4. 修复战术小队不会开枪：attack.js cooldown 0 被误判 + combat-system 只更新 primary 攻击
  5. 修复子弹速度：player.js 14 处硬编码改为 1248
  6. 修复伤害：六维计算 atk + 武器配置，不再硬编码 1
  7. 修复防御公式：统一 `def/(def+60)`，物理/魔法同步
  8. 修复瞬移：fallback + _clampMoveDistance + dashTo 走 knockback 持续移动
  9. 防瞬移方案 A+B+C 全面实施：window 挂载 + _clampMoveDistance + dashTo 持续移动
- **测试结果**：所有文件语法验证通过
- **已知问题**：
  - 需实际测试障碍物边缘移动效果
  - 需验证无人机实体渲染和 debuff 效果

### 对话 6：武器横向生成
- **修改文件**：
  - `src/ui/equip-data-manager.js`：添加 `ENERGY_LMG_ITEM`
  - `src/game.js`：新增 `_WEAPON_SPAWN_LIST` 武器列表；新增 `spawnAllWeapons()` 方法；替换旧 `spawnWeapon` 调用
- **测试结果**：`vite build` 通过
- **已知问题**：无

### 对话 5：添加能量轻机枪（weapon15）
- **修改文件**：
  - `data/equipment.json`：添加能量轻机枪定义
  - `src/config/gun-ammo.js`：添加机枪类型、全自动、双手武器配置
  - `src/entities/player.js`：能量轻机枪攻击配置、伤害公式、射速线性提升、过热系统、无限子弹、亮绿色曳光弹
  - `src/combat/projectile.js`：亮绿色曳光弹渲染（isGreen）
  - `src/ui/craft-system.js`：weapon15 改造配置
  - `assets/sounds/`：添加音效文件
- **测试结果**：`vite build` 通过
- **已知问题**：无


## 2026-07-04

### 侧视角 2D 渲染迁移（P0-P3 全部完成）
- **修改文件**：11 个核心文件
- **任务 1 - Player 4方向朝向 + 阴影**：
  - `src/entities/player.js`：添加 `_getFacingDirection()` 从鼠标位置判断4方向；render 中反旋转+水平翻转；武器跟随朝向（左/右翻转，上/下偏移）；脚下阴影改为屏幕空间绘制
- **任务 2 - Enemy 4方向朝向 + 阴影**：
  - `src/entities/damageable-entity.js`：新增基类 `_drawShadow()` 通用阴影方法
  - `src/entities/enemy.js`：render 中从速度/目标方向判断4方向；scaleX 翻转；量化旋转角度；调用基类阴影
- **任务 3 - 战术小队 4方向朝向**：
  - `src/entities/humanoid-monster.js`：新增 `_getDirection4()`；render 取消自由旋转；盾位小圆盾位置根据4方向动态调整；武器根据4方向变换
- **任务 4 - 墙壁侧视渲染**：
  - `src/world/wall-system.js`：墙壁数据添加 `height: 60`；新增 `renderWalls()` 按 y 排序绘制立面+墙顶
  - `src/game.js`：渲染循环在 terrain 后、实体前调用 `WallSystem.renderWalls()`
- **任务 5 - 近战攻击判定**：
  - `src/entities/player.js`：update 中根据鼠标方向计算 `_facingDir`（4方向），射击仍用360° rotation
  - `src/combat/attack.js`：`ThrustAttack.checkTriangleHit` 改为4方向轴对齐矩形判定（right/left/down/up），保留击退和墙壁检测
- **任务 6 - 子弹 Y 缩放 + 树木侧视**：
  - `src/combat/projectile.js`：render 中根据 vy 做 Y 方向缩放（上70%/下130%/水平100%）
  - `src/world/wall-system.js`：`addTree()` 添加侧视数据（树干+树冠）；新增 `renderTrees()` 按 sortY 排序绘制
  - `src/game.js`：渲染调用从 `MazeGenerator.renderTrees` 改为 `WallSystem.renderTrees()`
- **任务 7 - 弹壳/血溅/特效**：
  - `src/effects/shell-casing.js`：重力增强约50%且改为时间缩放（`vy += 10.8 * dt/1000`）
  - `src/effects/blood-hit-effect.js`：构造函数支持可选 `angle` 参数，传入时粒子朝攻击方向扇形分布
  - `src/effects/effect-manager.js`：`render()` 添加 `this.effects.sort((a,b) => a.y - b.y)` 深度排序
- **验证**：所有11个文件语法通过 `node --check`
- **已实现的侧视角效果**：角色4方向显示/8方向移动、脚下阴影、墙壁立面高度、树木侧视、子弹远近缩放、弹壳重力下落、特效深度排序
- **已知问题**：上/下武器偏移在旋转坐标系下表现可能有偏差；Enemy 暂未添加 `_facingDir`（近战回退到 down）
