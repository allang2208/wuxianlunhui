---
name: game-dev-lessons
description: >
  Reusable patterns for the Vite + Phaser 3 + Electron roguelike game-dev project.
  Use when implementing or tuning enemy AI, combat, movement, summoning, predictive
  aim, player dash/weapon-state fixes, boss/elite mechanics, or data-driven enemy
  configuration.
---

# game-dev 项目实战笔记

记录该项目中经过验证的设计模式、坑点和可复用实现。

## 1. 敌人攻击前必须面向目标

- `CombatSystem._isFacingTarget(enemy, tx, ty)` 用角度差 `≤ π/6`（±30°）判定。
- 若未对齐，先令 `enemy.rotation = Math.atan2(dy, dx)`，再执行攻击。
- 近战、远程、魔法统一遵守；避免“背对玩家仍出手”的违和感。

## 2. 攻击/施法期间禁止移动

- `MovementSystem.update` 开头检查：
  - `enemy._frozenForCast === true`（施法冻结，如 wizard 召唤、mutant-3 蓄力）
  - `enemy._attackAnimTimer > 0`（攻击动画持续期间）
- 满足任一条件时，将 `vx/vy` 置 0，`isMoving = false` 并直接返回。
- 注意：`MovementSystem` 先于 `CombatSystem` 运行，攻击帧触发的冻结会在**下一帧**生效，这是有意设计，避免循环依赖。

## 3. 召唤物的唯一键与墙体安全放置

- 多个召唤物若使用固定 `id`（如 `"zombieDog"`），会被 `Map` 覆盖，最终只剩一个。
- 生成时为每个召唤物分配唯一键：`zombieDog_${Date.now()}_${i}_${random}`。
- 召唤位置先用墙体检测 `WallSystem.canMoveTo` / `WallSystem.resolve` 预校验，并检查与其他已放置召唤物的重叠，避免“挤在一起”或卡在墙里。

## 4. 远程/魔法统一使用预判瞄准

- 提供 `AimHelper.lead(sx, sy, tx, ty, tvx, tvy, projectileSpeed, delayS=0)`，使用二次方程闭式解。
- 在真正的发射点调用：
  - `CombatSystem` 下游的 `RangedAttack`
  - `combatant.fireProjectile`
  - wizard 延迟射击
  - `IceSpikeSystem`
  - `FireballSystem`
- 无有效解时回退到目标当前位置。

## 5. 敌人游荡半径的数据源

- `data/enemy-config.json` 是 `ai.circleRadius` 的唯一真相源。
- 地下城工厂不再硬编码 `circleRadius`。
- 仅保留需要“风筝/绕圈”的远程敌人（如 `spitterZombie` 900、`zombieWizard` 650），近战敌人移除该字段。

## 6. 玩家体力恢复被武器动画状态阻塞

- `weaponAnim.state !== 'idle'` 会阻止体力恢复。
- 常见根因：Tweens 结束后未正确回到 `idle`。
- 修复点：
  - `weapon-anim.js` 的 `'attacking'` 状态主动过滤已停止的 Tweens，清空后回到 idle。
  - 增加 5 秒 stuck 保险，强制复位。
  - `DashSystem.trigger` 开始时调用 `player.clearAttackTweens()`，冲刺结束强制设置 `weaponAnim.state = 'idle'`、`isAttacking = false`。

## 7. 近战敌人被分离力推离目标的修复

- 在 `MovementSystem` 的 `_applyNormalMovement` / `_followPath` 中，当敌人在 `attackRange * 1.2` 范围内时：
  - 计算分离向量与指向目标移动向量的点积。
  - 若点积 < 0（分离力会把敌人推离目标），将分离力缩放为 10%。
- 保留少量分离效果防止完全重叠，同时消除“边打边逃跑”的现象。

## 8. 冲刺/扑击类技能的阶段拆分

- 以 mutant-3 为例：
  1. **prepare 阶段**：播放攻击动画前 8 帧，持续约 1s，`frozenForCast=true`，面向目标。
  2. **charge 阶段**：播放剩余帧，解除冻结，以固定速度（1200 px/s）向当前目标位置直线冲刺，最大距离 1200 px。
- 每帧重新计算 `_pounceDir` 指向目标，并同步 `rotation`，保证始终正对目标。
- 使用 `WallSystem.resolve` 处理撞墙，避免穿墙。

## 9. 帧动画与动画 Key 命名

- 同一攻击动作拆成多个动画 key（如 `enemy_mutant3_attack_prepare`、`enemy_mutant3_attack_charge`）。
- 在 `_getPhaserOptions()` 中根据当前 `_pounceAnimPhase` 返回对应 key，保持渲染与逻辑一致。

## 10. 动画素材与实现要点

- **工作前先复制素材**：把外部 `素材库/怪物/xxx/*.png` 复制到项目 `assets/enemies/xxx/` 再开始改代码，避免路径错乱和版本不一致。
- **`_getTextureKey()` 必须与动画源 spritesheet 一致**：`_syncEnemyAnimation` 每帧先 `setTexture(textureKey)` 再 `play(animKey)`。如果 `textureKey` 和动画实际引用的 spritesheet 不是同一张图，动画会卡在第一帧。
- **用 `_attackAnimTimer` 锁住 `MovementSystem` 的朝向覆盖**：特殊冲刺/飞扑阶段把 `_attackAnimTimer` 设为非 0，`MovementSystem` 会提前返回，不会把 `enemy.rotation` 重新指向当前目标。
- **Phaser 残影**：在特殊移动中每隔几十 ms 用当前 `textureKey`/`frame`/`displayWidth`/`displayHeight`/`flipX` 克隆一个 `scene.add.sprite()`，alpha 0.5，再用 tween 淡出销毁即可。对于侧视角精灵图，通常只需 flipX 表示左右，不需要设置 `rotation`，否则会倾斜。
- **新精灵图先扫空白帧再注册动画**：4×8 切割的 sheet 尾部/多余格可能是全空帧，按满格注册循环动画会周期性播空白帧 = 贴图"时常消失"（毒液僵尸 idle 24 格仅帧 0 有内容的实证）。用 PIL 按格扫 alpha>10 像素数核对注册帧区间；静态待机就注册单帧（0..0）。
- **`_getPhaserOptions` 不要硬编码 spriteSize/碰撞尺寸**：`_configureEnemyBody` 优先级 `options > config.render`，硬编码会让碰撞编辑器的调整完全不生效（突变体-3 教训）。统一 `const renderCfg = this.config?.render || {}; spriteSize: renderCfg.spriteSize || 默认值`。
- **黑色粒子特效必须 `blendMode: 'NORMAL'`**：`smoke_particle` 是白色软圆靠 tint 上色，ADD 加法混合下黑色 tint 完全不可见（矿洞绿烟用 ADD 是因为亮色发光；墓碑黑烟改用 NORMAL）。

## 11. 新增状态效果（debuff）流程

以“束缚”为例：
1. 在 `DamageableEntity.addStatusEffect` 的 `STATUS_CONFIG` 里加 `bind`。
2. 加 `applyBind(duration)` 方法，调用 `addStatusEffect('bind', ...)` 并显示 `StatusBar` / `FloatingText`。
3. 在 `MovementSystem.update` 早期判断 `hasStatusEffect('bind')`，直接 `vx=vy=0` 返回。
4. 在玩家 `update.js` 的速度计算处也把 `bind` 的 `targetSpeed` 置 0。
5. 实际调用时传入毫秒，例如 `target.applyBind(500)` 表示 0.5 秒。

**高频刷新的限时增益（如命中获得加速）不要走激励式数据层乘算**（maxSpeed 乘除会漂移）：参考 `applyHaste`——只记录 `_hasteSpeedMul` + `addStatusEffect`，玩家速度链按 `hasStatusEffect('haste')` 乘算，到期自动失效无需还原。

## 12. 攻击判定改为距离判定

- 在 `enemy-config.json` 中用 `attackDistance` 表示纯距离判定（不再乘 1.15、不再做扇形/矩形范围判定），例如 `"attackDistance": 200`。
- `CombatSystem._updateAttack` 优先读取 `enemy.attackDistance`，未配置时回退到 `enemy.attackRange * 1.15`。
- 特殊攻击（如飞扑、连击）内部也统一调用 `_getAttackDistance()`，只判断 `dist <= attackDistance`，不再做朝向、视线、碰撞体积判定。

## 13. 直冲型 AI（`chargeStraight`）

对于需要贴身爆发的怪物（如突变体-3），在 `enemy-config.json` 的 `ai` 里加 `"chargeStraight": true`，并确保 `Enemy` 构造函数把 `config.ai` 保存到 `this.ai`：

```js
this.ai = config.ai || {};
```

如果 `this.ai` 未保存，`MovementSystem` 里所有 `enemy.ai && enemy.ai.chargeStraight` 判断都会失效，导致摩擦、分离、路径、侧翼等逻辑全部回到默认行为。

`MovementSystem` 在 `chargeStraight` 生效后会：
1. 跳过侧翼包抄偏移。
2. 只在距离目标 ≤10px 时才减速，避免在 50px 处提前刹车导致无法发动攻击。
3. 卡住时不做侧向 reposition，防止瞬间反向调头。
4. 进入攻击范围后关闭单位分离；在范围外也把分离权重降到 0.1，避免被其他怪物推开而打不到玩家。
5. 忽略 `_tacticalTarget` / `_specialTacticalTarget` / `_battleCommander` 等阵型/战术目标，确保始终冲向玩家而不是被阵型拉走。
6. 有清晰视线时清空路径点，走直线而不是被寻路拐角拉偏。
7. 在攻击范围外给速度 ×1.3，帮助追上冲刺/高速目标。

## 14. 高速目标难以触发近战攻击：最终冲刺兜底

即使 `chargeStraight` 已生效，若玩家高速横向移动，怪物仍可能刚好滑出 50px 攻击窗口。可在怪物自身逻辑里加一个短距离“连击冲刺”兜底：
1. **关闭通用近战攻击**：若怪物使用完全自定义的连击/飞扑（如 Mutant-3），在构造函数里把 `this.aiInterval = Number.MAX_SAFE_INTEGER;`，防止 `CombatSystem` 每 1s 触发一次默认突刺，把玩家击退并抢走攻击窗口。
2. 当目标进入 `attackDistance`（命中距离）但还没进入 `attackRange`（触发距离）时，进入 `comboDash` 状态。
3. `comboDash` 期间把 `_attackAnimTimer` 设为短暂正值（如 200~250ms），让 `MovementSystem` 提前返回，由怪物自己高速贴近目标。
4. 冲刺目标每帧重新朝当前目标位置修正（高速追击），避免固定预测点导致冲过头；可把 `AimHelper.lead()` 的结果仅作为落点参考。
5. 冲刺速度设为 ~1200 px/s，每帧用 `WallSystem.resolve` 撞墙处理；冲到 ≤50px 或超时后启动连击。
6. `_startCombo()` 里再做一次校验/吸附：若目标已逃出 `attackDistance` 则取消连击；若仍略超 50px，把怪物移到目标面前 35~40px 处（用 `WallSystem.resolve` 防穿墙），确保第一下必中。

## 15. 一次性攻击动画不要循环重播 / 跨阶段连续播放

- **不要循环重播**：当 `_animState === 'attack'` 且动画已播完时，若同步逻辑无条件 `play(animKey)`，会导致攻击动画重复播放（典型表现：飞扑冲锋段播了两次）。在 `_syncEnemyAnimation` 中，只在 `animState !== 'attack'` 时才在动画停止后自动重播；攻击动画播完后停在最后一帧，等待逻辑状态切换。
- **跨阶段连续播放**：像飞扑这种“蓄力播前 N 帧、冲锋播后 M 帧”的动作，不要拆成两个动画 key 让冲锋阶段重新 `play` 一次，否则视觉上会明显“切了一下”。正确做法是注册一个覆盖完整动作的单一动画 key（如 `enemy_mutant3_attack_pounce`，0~20 帧 / 2000ms），在蓄力和冲锋阶段都让 `_getPhaserOptions()` 返回同一个 key，Phaser 会自动续播。
- **飞扑穿过目标并停在身后**：冲锋终点 = 目标位置 + 方向 × 300px；若超过 1200px 则限制在 1200px。冲锋阶段固定 1 秒，速度按 `distance / 1s` 自动调整，确保动画与位移同步。

## 16. 玩家/怪物受击体积改为矩形，攻击判定要包含目标体型，左下角“范围”可视化同步

- 排查发现：敌人对玩家的攻击原来只判断“中心点距离”，完全没考虑目标体型，导致视觉上明明贴在一起却打不中。
- 修复方式：
  1. **怪物**：在 `GameScene._configureEnemyBody()` 中把 `collisionShape` 设为 `'rect'`，`collisionWidth/Height` 设为 sprite 显示尺寸，`collisionRadius` 设为半宽作为圆形回退；Phaser 物理体也改为矩形。
  2. **玩家**：在 `_onPlayerSpawn()` 中通过 `_getFrameVisibleBounds()` 扫描 `player_idle` 帧的不透明像素，得到人物本体的包围盒，再按 sprite scale 换算成世界坐标。这样受击矩形只覆盖人物本体，而不是整个 512×512 的帧。
  3. 自定义攻击（如 Mutant-3 连击/飞扑）使用 `_isTargetInRange(target, range)`：目标是矩形时做“攻击范围圆 vs 目标矩形”相交判定；目标是圆形时回退到 `中心距 + 碰撞半径`。
- 左下角“范围”开关会同时画玩家和怪物的矩形/圆，保证可视化与实际受击体积一致。

## 17. 自定义近战攻击也要走盾牌弹反

- 盾牌弹反在 `ShieldSystem.onDamageTaken` 中触发，条件是 `isMelee === true` + 玩家持盾防御 + 在弹反窗口内 + 面朝攻击者。
- `Combatant.takeDamage` / `Player.takeDamage` 的第四个参数就是 `isMelee`。`DamagePipeline.applyHit` 对通用近战攻击会传入 `true`。
- **自定义攻击（如 Mutant-3 连击/飞扑）直接调用 `target.takeDamage(...)` 时必须手动传 `true`**，否则弹反不会触发，伤害/眩晕/束缚还会照样生效。
- 需要让自定义攻击知道是否被弹反：在 `ShieldSystem.onDamageTaken` 开头重置、弹反成功时设置 `this._lastParried = true`，调用方读取后跳过后续 debuff/击退/特效。
- 弹反效果（打断、眩晕、击退）由 `ShieldSystem.triggerParry` 统一处理；被弹反的敌人若处于连击/飞扑等自定义状态，其 `hasStatusEffect('stun')` 分支应主动中断动作并回到 idle 动画。

## 18. 贴墙弹道与位移通道：嵌墙"只出不进"与击退过墙

- **贴墙开不出枪（出膛嵌墙）**：枪口由武器贴图位置推导（含手部高度/扭转的屏幕偏移），贴墙时必然探入或探过墙体碰撞。**正解（V0.313）不是移动出弹点，也不是整墙免阻**：`WallSystem.detectEmbeddedWalls` 在工厂创建时记录被嵌入的墙（射手→出膛点跨过的 iso 面线 + 出膛点所在/穿过的真实矩形墙），投射物按"只出不进"判定——①任何墙都不能从外穿进内；②嵌墙子弹只许朝射手一侧越出，背向钻透（含"远侧未跨线但越飞越远"）即销毁；③越回射手侧后面线恢复普通判定，其阶梯碰撞块永久放行（iso 墙厚区），真实矩形墙按越出方位判定。iso 阶梯块只挂面线 linked 集合，不进矩形规则（否则未穿行的块会误杀）。
- **怪物靠墙瞬移/加速（位移通道漏墙）**：`MovementSystem._applyKnockback` 是全怪物唯一位移通道（dashTo/突进/击退统一走 knockback），漏掉 `WallSystem.resolve` 时怪物直接穿进墙体，下一帧正常移动的 resolve 又把它沿墙切向弹出——观感就是瞬移/加速。所有直接改写位置的通道（dash/击退/技能位移）都必须与玩家 dash 同口径过 `WallSystem.resolve`。
- **调试**：`window.WallSystem` 已挂载（main.js），控制台可直接查 `isoSegments/walls/blocked/detectEmbeddedWalls`；`scripts/test-wall-embed.mjs` 覆盖嵌墙 6 场景（挂入 npm test）。

## 19. 常用调试/验证清单

- 改完敌人数值后，确认 `data/enemy-config.json` 与 `BootScene` 中动画注册一致。
- 召唤/生成新实体后，检查 `entities` Map 中 key 是否唯一。
- 体力不恢复时，优先检查 `weaponAnim.state` 和 `_activeAttackTweens`。
- 敌人在近战范围内“倒退跑”时，检查 separation 与 target 方向的点积处理。
- 出现 `INEFFECTIVE_DYNAMIC_IMPORT` 是 `src/ui/codex-manager.js` 的已知构建警告，与本次改动无关。

## 20. 改造效果（craft-effect）配置：条件键、命中 Buff、音效覆盖

- `src/config/craft-effect-registry.js` 负责注册所有改造效果；`src/config/craft-effect-consumer.js`（或对应武器模板）负责在发射、命中等实际节点消费。
- **条件生效键**：改造效果里加 `condition: { fireModeOverride: 'fullAuto' }`，消费点先判断当前武器的 `fireModeOverride` 是否匹配；匹配才消费，不匹配就当没这条改造。例如 V0.354 P4040 的 `autoSpreadStart`、`autoSpreadMax`、`autoMaxRecoil` 只在切换为全自动模式后生效。
- **命中/事件 Buff 键**：`onHitSpeedBuff` 在命中时给自身加限时加速；不要直接改数据层 maxSpeed，而是调用 `applyHaste(duration, mul)` 并走状态系统（见第 21 条）。
- **音效覆盖键**：`fireSoundOverride` 在命中特定改造（如 P4040 锤击点弹药）后替换开火音效。消费点优先读取覆盖值，没有覆盖再回退到武器默认。
- **三角校验**：改完 `craft-config.json` 后，同步跑 `scripts/test-craft-sync.mjs`（或同类测试），确认 registry、consumer、数据文件三处一致，避免“数据写了但游戏没生效”。

## 21. 高频限时增益不要走数据层乘算

- 早期做法在命中时 `target.maxSpeed *= 1.1`、过期时 `/= 1.1`，高频刷新或 buff 叠加时容易漂移。
- **正确做法（V0.354）**：`applyHaste(duration, mul)` 只做两件事：
  1. 给目标加一个 `haste` 状态效果；
  2. 在玩家/怪物速度计算链里判断 `hasStatusEffect('haste')`，乘以固定 `speedMul`。
- 到期由状态系统自己清除，速度链自动失效，无需手动还原。

## 22. Iso 墙体深度遮挡：按“面线”几何仲裁，而不是按件端点

- 单块 iso 墙的深度排序不能简单取 sprite 四个角 world 坐标的 min/max，否则在 45° 斜墙或门墙拐角处，不同件之间的端点深度会互相穿插，导致“该挡的没挡、不该挡的遮挡”。
- **正确做法（V0.356）**：取每块墙朝向玩家的“最近面线”，计算玩家/怪物与这条面线的带符号距离；深度排序时只让“面线后方一定距离内”的对象被墙遮挡，面线前方永远不被该墙遮挡。
- 门墙、墙帽、拐角要分别提供自己的面线；T 形、L 形衔接处用单向钳制（只让靠近面的一侧受影响），避免远端墙体被错误拉高。
- 调试时打开左下角“范围/深度”可视化，检查各墙件的遮挡面是否与其视觉立面一致。

## 23. UI 布局持久化：出厂快照 + `_persistJson` 管道

- 对于允许玩家拖拽调整布局的面板（如 V0.357 改造栏布局），保存时不要直接改业务数据，而是走统一的 `_persistJson(relativePath, data)` 管道。
- 重置按钮依赖一份“出厂快照”文件，例如 `src/config/craft-default-slots.js`，里面保存默认 slot 坐标/尺寸。点击重置时把快照写回持久化文件并刷新 UI。
- 添加吸附线时，在拖拽过程中实时计算与其他格子的中心/边对齐偏移，达到阈值时给出视觉提示；吸附只影响拖拽释放后的位置，不要改出厂快照。
- 布局数据保存后，读取逻辑统一从持久化文件加载；若文件缺失再回退到出厂快照，保证新玩家和回退玩家都正确。

## 24. NPC 位置编辑器：offset 基准必须绑定配置世界尺寸，保存前深拷贝

- 主神空间 NPC（仓库、祭坛等）在 `data/game-config.json` 的 `npcs.*` 里以 `offset` 保存相对小鼠大王/世界中心的位置。
- `wall-editor.js` 的 NPC 编辑器计算 offset 时，基准点必须用 `GAME_CONFIG.world.main.width/height` 取世界中心，**不能依赖运行时 `CONFIG.WORLD_WIDTH/HEIGHT`**——`Renderer.generateWorld` 可能在 `SceneManager.currentScene` 设为主场景之前执行，把主神空间当成默认 7680×4320 尺寸，导致保存的 offset 在回城后 4096×4096 世界里整体漂移。
- 保存前用 `JSON.parse(JSON.stringify(GAME_CONFIG))` 深拷贝再传给 `_persistJson`，避免 Vite HMR 在异步写盘窗口替换 `GAME_CONFIG` 对象、导致写入未包含本次修改的旧数据。
- NPC 拖动边界统一用配置世界尺寸做钳制，防止拖到视野外。
- 发现 NPC"消失"先查 `data/game-config.json` 里对应 `offset` 是否被污染到世界边缘，而不是查渲染或实体删除逻辑。

## 25. 战斗房"墙壁突出/悬浮"排查与填充纪律（三房间竞技场教训）

- **先怀疑自家填充件，再怀疑预制件**：竞技场"墙壁突出通道"反复修不好，最后靠 `WallSystem._addSegPiece` 埋点重建抓到元凶是 `_sealPassageSides` 的"整瓦居中"填充——缺口只有几十 px 时，一整瓦（~476px）以缺口为中心向两侧各探 200+px 越线。预制件 `family/label` 元数据可快速区分来源（预制件有 label，`_addSegPiece` 产品没有）。
- **填充必须端点锚定**：向边界（房间边线/门侧）填充时，瓦端锚在边界 +8px，向既有覆盖区步进（覆盖区同纹理互盖无害）；绝不允许填充瓦越过边界。`_fillEdgeGaps`（门侧锚定）与 `_sealPassageSides.fillToEnd/fillFromStart` 是范式。
- **预制件越界要裁剪**：手摆预制（如「左右通道」）侧墙比门到门跨度长，60° 相接处会越过房间边线探入房内。放置时对直墙件按房间边线求交裁剪（`_clipPassagePieceToRooms`：越线端点裁回 +8px，整件在房内丢弃，中心/scaleX 折算）。
- **地板多边形绕向必须一致**：canvas `clip()` 默认 nonzero，反向绕向的子路径与菱形重叠区会抵消成洞（地板纯黑平行四边形）。拼接多边形裁剪前 shoelace 校验，反向则 reverse。
- **地板/墙体形状从实测几何推导**：通道两侧墙距轴不等（+184/-211），按轴居中展宽必歪——侧墙线、端线全部实测后求交，一块精确平行四边形胜过"居中块+补丁"拼接。

## 26. 图层遮挡唯一规则：depth = 地面锚线 y（max 底边端点 y）

- 全项目只有一套渲染机制（Phaser painter），出问题都是 depth 赋值规则不统一。定案：**墙/门/填充/转角/预制件 depth 一律 = max(底边两端点 y)**，唯一入口 `WallSystem.depthOf(piece)`。
- 规则成立的关键论证：墙贴图全部在底边线之上，底边线以下（室内/墙前）的实体与墙无像素重叠，depth 比较天然不生效；只有墙后实体（脚线 y < 底边 y）才被遮挡——max 对前墙/后墙/转角全成立。旧"后墙 min"和"底边-墙高"两套规则已废除。
- 文档化偏置仅 3 个：转角 +5、接缝 +0.1、门光晕 +0.5。审计：`window.WallSystem.__depthAudit()`；源码防回归：`scripts/test-wall-depth.mjs`（挂 npm test）。
- 新墙件/障碍物只要不自己发明 depth，自动正确遮挡；摆墙编辑器新放置件强制走 `depthOf`，手调旧值只在编辑器内兼容保留。
