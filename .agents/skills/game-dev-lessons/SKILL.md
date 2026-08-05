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

## 11. 新增 Buff / Debuff 标准工作流

本项目所有限时状态效果（增益/减益/控制）统一走 `DamageableEntity` 状态系统：`addStatusEffect(type, duration, opts)` 登记效果，各子系统通过 `hasStatusEffect(type)` 消费，到期自动清除。Buff 与 Debuff 流程通用，唯一区别是消费点不同。

### 11.1 最小实现步骤

以新增 `frozen`（冻结）为例：

1. **状态配置（实体层）**
   在 `src/entities/damageable-entity.js` 的 `STATUS_CONFIG` 里增加类型键、图标、名称、颜色：
   ```js
   frozen: { icon: '🧊', name: '冻结', color: '#a0d8ff' },
   ```

2. **状态配置（UI 层）**
   如果玩家需要状态栏显示，在 `src/ui/status-bar.js` 的 `STATUS_CONFIG` 里增加条目（含 `desc` 悬浮说明）：
   ```js
   frozen: { icon: '🧊', name: '冻结', color: '#a0d8ff', desc: '无法移动、攻击...' },
   ```

3. **申请接口**
   在 `DamageableEntity` 中新增 `applyXxx(...)` 方法，必须：
   - 开头检查 `hasStatusEffect('statusImmune')`，免疫时直接 return（`statusImmune` 本身除外）。
   - 调用 `addStatusEffect(type, duration, opts)` 入库。
   - 用 `FloatingTextEffect` 做飘字提示。
   - 玩家还需同步 `StatusBar.addEffect(...)`。
   ```js
   applyFreeze(duration = 3000) {
       if (this.hasStatusEffect('statusImmune')) return;
       this.addStatusEffect('frozen', duration, { stacks: 1 });
       if (this._faction === 'player' && StatusBar) {
           this._freezeEffectId = StatusBar.addEffect('frozen', duration, { stacks: 1 });
       }
       if (EffectManager) {
           EffectManager.add(new FloatingTextEffect(this.x, this.y - this.size - 10, '🧊 冻结！', '#a0d8ff'));
       }
   }
   ```

4. **效果消费**
   根据效果类型在正确位置生效，不要直接修改数据层（见 11.3）：
   - **移速 / 禁止移动**：`MovementSystem.update`（敌人）与 `player/update.js`（玩家）。
   - **禁止攻击 / 技能**：`CombatSystem.update`、`DecisionSystem.update`、`ui/quick-bar.js`、各敌人 `update()`。
   - **伤害结算**：`DamageableEntity.takeDamage`。
   - **持续伤害 / 治疗**：`DamageableEntity.update` 内新增 `_updateXxx(dt)` 并在 `update()` 中调用。
   - **视觉特效**：`GameScene` 的 `_syncXxxEffects`（如 `_syncFreezeEffects`）。

5. **更新文档**
   改完后同步更新 `docs/buff-reference.md`，填入对应分类表格与参考数值。

### 11.2 可叠加层数型 Buff 的规范写法

需要“按层数叠加、持续时间到后全部清空”的效果（如 `haste`、`chill`、`chainSpell`），统一使用以下模式：

- 用 `_xxxStacks` 记录当前层数，`_xxxTimer` 记录剩余时间。
- `applyXxx` 中：已有效果时 `stacks += 新增层数`，`remaining += 新增持续时间`；无效果时初始化。
- `updateStatusEffects` 到期时调用 `_onXxxEnd()` 把 `_xxxStacks` 清零。
- 消费点直接读取当前 `_xxxStacks` 计算倍率，**不要**在获得/消失时 `*= /=` 改 `maxSpeed` / `atk` 等数据层。

示例：
```js
applyHaste(duration, opts = {}) {
    if (this.hasStatusEffect('statusImmune')) return;
    const perStackMul = opts.perStackMul ?? 0.10;
    const existing = this.statusEffects.find(e => e.type === 'haste');
    if (existing) {
        existing.stacks += 1;
        existing.remaining += duration;
        existing.duration += duration;
        this._hasteStacks = existing.stacks;
    } else {
        this._hastePerStackMul = perStackMul;
        this._hasteStacks = 1;
        this.addStatusEffect('haste', duration, { stacks: 1 });
    }
}
_onHasteEnd() { this._hasteStacks = 0; }
```

### 11.3 高频限时增益不要走数据层乘算

早期做法 `target.maxSpeed *= 1.1`、过期时 `/= 1.1` 会在高频刷新或叠加时漂移。正确做法：

1. 给目标加一个状态效果（如 `haste`）。
2. 在速度/伤害等计算链里判断 `hasStatusEffect('xxx')`，乘以固定 `speedMul` 或按层数计算。
3. 到期由状态系统自己清除，计算链自动失效，无需手动还原。

### 11.4 控制类效果要统一中断动作

眩晕、冻结、束缚等控制效果如果会打断攻击/施法，应在申请接口中调用 `_cancelActionsForStun()`（通用）或 `_cancelAllActionsForStun()`（玩家），统一清空：

- `weaponAnim` / `offhandWeaponAnim` 回到 `idle`
- `_attackTelegraphTimer` / `_attackTelegraphFire`
- `_attackAnimTimer`
- `_animState === 'attack'` 切回 `idle`
- `_frozenForCast`
- 玩家额外：施法 `_castState`、特殊攻击、换弹、无人机操控等

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
- **命中/事件 Buff 键**：`onHitSpeedBuff` 在命中时给自身加限时加速；不要直接改数据层 maxSpeed，而是调用 `applyHaste(duration, mul)` 并走状态系统（见第 11 条）。
- **音效覆盖键**：`fireSoundOverride` 在命中特定改造（如 P4040 锤击点弹药）后替换开火音效。消费点优先读取覆盖值，没有覆盖再回退到武器默认。
- **三角校验**：改完 `craft-config.json` 后，同步跑 `scripts/test-craft-sync.mjs`（或同类测试），确认 registry、consumer、数据文件三处一致，避免“数据写了但游戏没生效”。

## 21. 高频限时增益不要走数据层乘算

> 本节内容已整合到第 11 条《新增 Buff / Debuff 标准工作流》的 11.2 与 11.3 节，请统一查阅该条。

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

## 27. 实体级遮挡仲裁：多面线"被任一遮挡则遮挡"，别只取最近一条

- `WallSystem.junctionCorrectedDepth(x, y, depth)` 是实体（玩家/怪物）级遮挡仲裁的唯一入口，GameScene `_updateDynamicDepths` 每帧调用，参数是逻辑脚线 (x, y) + natural depth（sprite.y + footOffsetY + 10）。
- **教训（V0.364 门口通道侧漏遮挡）**：门口处多条面线共存（通道侧墙/门墙/房间墙），旧版只取**最近一条**仲裁，门跨长（~477px、y 差 ~238px）的深端会选中非门墙的面线而放行——玩家几何上在门墙后却完整显示。正解：收集脚线 ±60px 内**所有**面线，y<yLine 记遮挡源、y≥yLine 记前墙；**有任一遮挡源则压到其下（-0.5），否则有前墙则抬到其上（+0.5）**。
- **教训（V0.365 门墙左段时挡时不挡）**：多遮挡源共存时**遮挡源必须取最浅（min depth）**，实体压到所有遮挡线之下才算"被任一遮挡"——旧版取最深（max），门洞深端实体会被邻接 max 规则瓦片面线抬到门墙 depth 之上，门左段（RB 边深端）时挡时不挡；右侧浅端因脚底 y 天然浅于门洞中心 depth 一直正常。另：门墙面线 depth=门洞中心比深端浅 ~119px，±60px 收集窗覆盖不了深端墙后 60~119px 的实体（仲裁完全失效），收集窗要按"面线深端 y − depth"亏空加宽（普通 max 规则瓦片亏空为 0，行为不变）。
- **教训（V0.366 通道上墙"稍远离反被挡" + 墓碑被墙盖）**：**线后（遮挡源）与线前（前墙）的收集窗必须解耦**——线前窗口要按实体贴图"脚底→头顶"高度传入（`junctionCorrectedDepth` 第 4 参 `frontRange`，默认 60 兼容旧行为）。旧版两侧统一 60：实体站墙前 60~160px 时贴图仍与墙像素重叠，却收不到面线不抬升，被墙 flat depth（整条瓦最深端 y，斜瓦 y 跨 ~238px）盖住——呈现"贴墙正常→稍远离被挡→更远又正常"的非单调带。墓碑 INSET=80 恰好越窗，同根因。**两侧共存的优先级**：遮挡源只在"比所有前墙都深"时才压制（浅遮挡源贴图本身画在深前墙之下，实体在深前墙之前不可能被它真遮挡——门口 X 形楔形区：侧墙线前 + 门墙线后的实体应抬不应压）。已知代价：被抬实体会反超"站在它与墙之间"的其他实体（旧 60px 带内已有，窗口加宽只是带更宽，封顶 160 接受）。
- **教训（V0.366 二轮返工：frontRange 公式算错一半）**：脚底→头顶真实高度 = **`footOffsetY + displayHeight/2`**（`footOffsetY` 是 sprite **中心**→脚底的偏移，sprite origin 0.5）——写成 `displayHeight − footOffsetY` 只有真实值一半（玩家 72 vs 144），留下 72~144px 仲裁死带，一轮修复白做。**几何参数写下前先把每个量的参照系（锚点/原点/方向）在注释里钉死再推导**，位置/观感类修复必须实机复测才算完（见第 30 条 CDP 自验流程）。
- **门墙 depth = 门洞中心底边 y**（不是 max 端点）：`_createArenaGate`、宝箱房 `_placeGate`、`WallGate.placeAt` 共 4 处。这样门洞中的实体（脚线≈门洞中心）按前墙抬起可见，门后实体被压下遮挡。
- 门面线进仲裁缓存靠 `_getFaceSegCache` 主动收集实例（arena entryGate/passages gates、WallGate `_seg`、ChestRoom `_gate`），几何重建时失效；`wall-gate.js`/`chest-room-system.js` 末尾自挂载 `window` 避免环依赖。
- **验证套路**：四站位矩阵（门后走廊/门洞中心/房间侧/浅端）断言 `playerSprite.depth` 与门 depth 的大小关系 + 截图目检；别只看函数返回值——要确认帧循环里实际写入的 depth。
- **无头 CDP 调试坑**：`window.Game.scene` 不存在，GameScene 实例是 `window.PhaserGame.scene`；`tools/cdp-eval.mjs` 用 `Runtime.evaluate(returnByValue)` 打印的是**表达式返回值**，脚本要写成返回对象的 IIFE，`console.log` 只会得到 `undefined`。

## 28. 跟随件/特效必须继承本体的遮挡仲裁（V0.365 武器/阴影/烟尘穿墙）

实体本体被 `junctionCorrectedDepth` 压到墙下后，所有"跟着本体深度走"的贴图/特效如果不跟着压，就会浮在遮挡墙之上：

- **武器/盾牌（跟随 playerDepth +N）**：本体压到 `wall-0.5` 后 `+2/+1` 的常规偏移 = `wall+1.5`，必然穿墙。正解（GameScene `_updateDynamicDepths` 第 3 步）：先记录仲裁前 natural depth，`corrected < natural` 判定被压下，跟随件改用 **<0.5 的紧凑偏移**（武器 0.4 / 副手 0.3 / 盾 0.2），保持相对层级又不越过墙；未被压下时用原偏移。仲裁抬高（前墙分支）不算 occluded。
- **地面阴影（`_syncEntityShadows`）**：别再自己算 `e.y + 9`——直接 `实体 sprite.depth - 0.1`，遮挡/抬升全自动继承（`_syncEntityShadows` 比 `_updateDynamicDepths` 先跑，读到上一帧 depth，差一帧无感）。
- **定点特效（奔跑烟尘 DustEffect 等 graphics）**：生成位置固定，depth 用 `junctionCorrectedDepth(fx.x, fx.y, 自然 depth)` 过一遍仲裁（`window.WallSystem` 已挂载，效果类文件直接用全局引用即可），实体在墙后时烟尘同步压到墙下。
- 通则：**任何以"实体深度 ± 偏移"或"自身 y + 偏移"赋 depth 的附属视觉，在墙体遮挡场景都要么跟随本体仲裁后 depth，要么自己过一遍仲裁**；新增此类视觉时把这条当 checklist。

## 29. 新增阵营/实体类型先查 GameScene 渲染闸门清单（V0.365 特工动画消失）

- `GameScene` 多处按 `_faction === 'enemy'` 设闸：`_syncBodiesToPhysics` 的 sprite 创建、`_syncEnemyAnimation`、`_syncEntityShadows`、小地图红点。入侵特工 `markAsInvasion` 打成 `_faction='agent'` 后全被闸住——拿不到 `_phaserSprite`，动画链一次不执行，实机被 `_syncNeutralEntities` 画成 neutral_circle 占位圆。
- 该缺口藏了 10 天没被发现的原因：主神空间测试生成（`spawnMainTimeAgent`）不改 faction，素材/动画都在那里验收；入侵机制只做过状态机模拟，实机入侵战没人看过。**新机制验证必须包含实机目视**。
- 修复口径：渲染闸门放宽为 `'enemy' || 'agent'`（4 处）；**不要**反过来让 `markAsInvasion` 不改 faction——战斗逻辑按 `source._faction === entity._faction` 判友军豁免，agent↔enemy 互相敌对依赖这个区分。
- 新增阵营/实体类型时过一遍闸门清单：sprite 创建、动画同步、阴影、小地图、HUD、中立圆兜底（`_syncNeutralEntities` 有 `_phaserSprite` 会自动跳过，无需处理）。

## 30. 位置/观感类改动必须 CDP 实机自验（V0.366 三轮返工的教训）

本会话连续三次"代码逻辑对、视觉效果错"（火把没贴墙、通道遮挡参数错一半、石柱锚点偏 161px）——静态审查发现不了，必须实机验证。已验证可行的流程：

- **起实例**：`npm run dev`（vite 5173 + electron）；electron 加 `--remote-debugging-port=9222`（可隐藏窗口）。先查端口占用，**不要杀用户自己的游戏实例**。若 `npx electron` 报 "Electron failed to install correctly"：重建 `node_modules/electron/path.txt`（内容 `electron.exe`）。
- **CDP 调试**：`tools/cdp-eval.mjs` 用 `Runtime.evaluate(returnByValue)`，脚本写成**返回对象的 IIFE**（`console.log` 只得 undefined）；GameScene 实例 = `window.PhaserGame.scene`（`window.Game.scene` 不存在）；`window.WallSystem`/`window.CombatRoomSystem`/`window.DungeonMapSystem` 已挂载。
- **快捷进入目标场景**：不必手动玩，CDP 直接调内部函数（如 DungeonMapSystem 的节点/战斗入口）让竞技场/战斗房建出来。
- **验证方法**：量化断言优先（坐标/间距/depth 对比），像素级判定辅助（如遮挡 = 墙不透明带 ∩ 实体包围盒逐 x 扫描，21 点位矩阵实测 0 遮挡的判例），截图留证（`Page.captureScreenshot` 存 `tools/verify-shots/`）。
- **收尾**：关调试实例、删临时文件（截图保留），验证数据写进汇报。
- **headless 环境 rAF 冻结的泵帧法**：无头/隐藏窗口里 Phaser 的 rAF 不走，直接调实体 update 只能推进逻辑、视觉帧不动。双泵：逻辑帧手动 `Game.update(16.67)` + `scene.update` 推进；依赖真实 tween 的（抛物线投射物等）必须 `Page.captureScreenshot` 的 BeginFrame 泵真实帧。可复用脚本：`tools/cdp-arena-verify.mjs`、`tools/cdp-witch-*.mjs`（注释里有判例）。
- **杀进程只按命令行特征杀自己的实例**：调试中 `taskkill /F /IM msedge.exe` 会把用户的浏览器也杀掉——清理时按启动参数/端口过滤。
- **2026-08-02 起用户改为自行实机验证**：CDP 验证链路长、易失败（Edge 后台 rAF 冻结要泵帧、冷启动加载卡死、实例清理繁琐），用户明确"跳过验证阶段，我自行验证"。默认做到 eslint + node --check + vite build + npm test 绿即交付，CHANGELOG 标注"实机待用户复测"；仅当用户明确要求时才走本节 CDP 流程。另：浏览器 user-data-dir 不能放项目目录内（vite watcher 撞锁文件 EBUSY 崩溃），放系统 TEMP。

## 31. 本轮零散但可复用的教训（V0.365~V0.366）

- **缓存键必须包含全部渲染输入**：小地图静态层重绘缓存只看"墙数量"，地牢(2048)→主神空间(4096)切换后墙数量恰好相同 → 用错误世界尺寸画的放大层永久残留。任何"数量指纹"缓存都要把尺寸/比例等输入一并纳入键（`wallCount + WORLD_W×H`），场景切换完成处再显式失效一次双保险。
- **状态机守卫放在分支外面**：竞技场第三间房弹回路线选择——`waveSpawned` 守卫嵌在 `stage < 3` 分支里，stage=3 的关门窗口期漏保护，误排定时器清掉刚刷的怪。涉及"等待外部事件"的守卫要覆盖**所有**分支，定时回调里再防御一次（触发时状态已变迁则放弃）。
- **预生成内容的可达性校验锚点要用房内参考点**：陷阱改为房间生成时预生成后，`pathFinder` 到玩家的校验会把他房陷阱全拒（门关着不可达）。给校验加 `reachFrom` 参数，预生成锚房心/本房门点，运行时锚玩家，两条路径分开。
- **代码计算放置位置先确认贴图锚点**：`isoVisuals` 件 origin 0.5（x,y = 贴图中心），"石柱立在菱形中央"要写成 `y = cy − h·scale/2`（底座 = 中心）；把贴图中心放中心 = 底座偏南 h·scale/2（石柱 640×0.505 偏了 161px）。
- **波次/遭遇覆盖要有下限兜底**：事件 `combatWaves:1` 覆盖进三房间竞技场会软锁（房 1 清完即 isComplete、门不再开）——`forceArenaWaves(3)` 补足波次，强制怪压轴最后一波。容器有固定阶段数时，外部配置必须钳到阶段数下限。
- **fire-and-forget 加载要有 await 点**：`loadWallPrefabs()` 在 BootScene 无等待发起，进战斗时库可能未就绪 → 竞技场静默回退单房间。给加载器加 `_loadingPromise`（并发去重）+ `whenWallPrefabsLoaded()` 导出，关键路径（进战斗）未就绪时挂起重试而不是降级；resilience 回退保留但日志升级为 error。**凡是"启动时发起、运行时才消费"的资源，消费点都要有等待/重试机制**。
- **地面层物件的视觉遮挡阈值要实测量**：陷阱线（depth = y−998 地板层）延伸到前墙脚时，垂距 < ~160px（= 前墙瓦渲染高度）的陷阱被墙瓦完全盖住但**仍占用触发**——隐形伤害是 gameplay bug，不是视觉瑕疵。拍脑袋阈值（60~80）不够，按实测遮挡边界（160）+ 余量取 170；改完用"最小垂距 + 末端特写截图"复验。验证工具 `tools/cdp-arena-verify.mjs`（boot/traps/shot/cleanup 子命令）可复用。
- **粒子 emitter 默认都要登记清理**："火焰不随战斗房清理"的用户要求曾写成永不销毁 = 每场战斗泄漏几个 emitter。正确口径：登记进 `_decoSprites`（`window.CombatRoomSystem` 晚绑定），战斗内常驻、cleanupRoom 销毁。用户说"不清理"时先确认是"战斗内常驻"还是"永不销毁"。

## 32. 武器运动模糊 / 浮空投射物 / 防具属性挂接（V0.368 前后）

### 武器运动模糊（Phaser 4 Blur 滤镜）
- **三种方案对比**：① 残影幽灵副本（`_syncWeaponGhosts` 3 个半透明历史姿态，峰值 alpha 0.05~0.15）——实测肉眼几乎不可见，用户明确要"真实模糊"；② canvas 烘焙 `ctx.filter=blur(px)` 贴图变体——与开发工具观感一致但要缓存+换贴图；③ **Phaser 4 `sprite.enableFilters()` + `filters.internal.addBlur(quality,x,y,strength,color,steps)`（路线 A，最终采用）**——运行时实时、WebGL-only。
- **强度校准不能拍脑袋**：quality0 3-tap shader 感知强度远弱于 CSS blur 同半径（σ_1pass≈1.12×strength），quality2 7-tap 为 σ_1pass≈1.947×strength，steps 次卷积再 ×√steps。用户按观感迭代定到 `strength = max(blurX,blurY) × 1.6`（quality2/steps2，峰值 σ≈52px 观感合适）。**调参交给用户实机反馈，给单一系数旋钮**（如 `f.strength = m * K`）。
- **双同步函数共用资源会互相隐藏**：火球悬浮/飞行共用一组粒子发射器，`_syncFireball`（悬浮期）显示后同一帧 `_syncFlyingFireball`（未飞行 early-return）又隐藏 → 永远不可见。共用资源的多个管理函数必须**职责互斥**（谁显示谁隐藏约定清楚），实机采样 `visible` 排查这类"对象存在但看不见"。
- **粒子贴图用前先 ensure**：`add.particles('impact_dot')` 前必须 `_ensureImpactDotTexture()`（其它粒子代码都先 ensure，漏掉就静默无渲染）。

### 浮空投射物深度与环绕
- **抬升后的浮空件深度不能用 `sprite.y + 15`**：把投射物抬到圆柱体中心（y − bodyHeight/2）后 y 变小，按 y+15 排序会沉到施法者精灵（深度≈施法者 y+10）身后被遮挡。统一用 `_projectileDepth(caster)` = **施法者精灵 depth + 2**，深度排序段也按施法者键取深度。
- **发射前待机环绕**：`orbitAngle` 在系统 `update` 里按 `orbitSpeed` 推进，渲染取椭圆坐标 `(cos·orbitRx, sin·orbitRy)`（Rx≠Ry 成椭圆）；相邻投射物错速避免整体刚性转圈；**发射起点 = 当前环绕位置**（不能从初始角发射）。
- **投射物精确汇聚于瞄准点**：光"朝鼠标方向飞"不够——直线会**穿过准星继续飞**。`_launchAll` 记录 `tx/ty/targetDist`，`_updateFlying` 飞行距离达 `targetDist` 时**钳到目标点并 onImpact 结算**；飞行视觉高度随进度收敛 `elev×(1−progress)`，否则各投射物悬浮高度不同、视觉不落在鼠标点。maxRange 仍是射程上限（目标超射程时到上限停止）。
- **整圈投射物朝向**：统一朝向（施法者中心→鼠标，所有冰锥同角）vs 各自指向（每根从自身位置→鼠标）——按需求二选一，改回时要"参考调整前代码"按用户原话回滚。

### 防具/首饰属性挂接（本项目旧装备 stats 只是显示）
- **真正的属性汇总入口**：`src/entities/player/base.js` 的 `calculateCombatStats()`（战斗面板）+ `updateMaxStats()`（HP/MP/体力上限）——旧防具/饰品的 `stats` 数组从未接线到 `data.def/maxHp`，只有盾牌 defense 接了。新增装备系统必须在这两处挂接。
- **六维写入面板用差值法**：`d.str += eq.str − prevAttr.str`（记录上次装备加成，先减再加）——直接累加会在每次重算时翻倍；同时公式侧不能再加一遍（避免双重计入）。
- **强化成长**：防御 = `defense.base + defense.perEnhance × enhanceLevel`；首饰用 `bonusStats[k] + bonusPerEnhance[k] × enhanceLevel` 统一在 `_getEquipmentBonuses()` 汇总。
- **强化上限分档**：`_getItemMaxLevel(item)` 按武器（含盾，15 级）/ 其他（10 级）；强化成功、装备/卸下/切换后都要重算面板（`updateEquipSlots` 挂钩）。

## 33. 冰墙案例：写实 AI 素材管线 / 临时碰撞 / 魔法门槛 / 本轮坑（2026-08-02）

### 写实素材管线（Phaser 程序化绘制的写实天花板解）
- 用户两次否掉程序绘制（先蓝矩形后冰晶簇）：Phaser canvas 矢量渐变天花板是"精致手绘风"，到不了 AI 素材的写实感。正解 = 即梦出图（纯黑背景+右下水印）→ 程序化抠图 → 贴图加载，程序生成只留为加载失败回退。
- **抠图阈值先查亮度直方图找谷**（本批 5 张图在 22~35 有天然谷，定 24）；**全图近黑抠除优于边缘洪泛**——洪泛漏掉晶柱缝隙里不与边界连通的黑色区域（黑楔子），缝隙透明后露游戏地面反而真实。
- **连通域最大组件自动去水印**："即梦AI"水印是孤立于主体的白色小块，`scipy.ndimage.label` 只留最大组件即去，无需手框。
- 工具 `tools/process-icewall-sprites.py`（阈值/最大组件/羽化/裁剪/统一高度）；原图放 `backup/` 不进 `assets/`（copy-assets 会整个打进 dist）。
- 接入三件套：BootScene 预加载（key 与程序生成同名，exists 守卫自动跳过回退）→ 等比缩放（高度按配置、宽随纵横比，别 setDisplaySize 硬压）→ 变体池映射（池内可剔除单张，variant 存池索引）。

### 临时碰撞（限时障碍物挡移动+挡投射物）
- **一条通道全覆盖**：往 `WallSystem.isoSegments` push 线段（门闸同款），单位移动（MovementSystem/玩家 resolve）与投射物（Projectile.blocked / BoltSkillSystem.resolve）自动被挡，投射物系统零改动；到期 splice + `pathFinder.invalidateCache()`。
- **不要打 `_iso` 标记**（`rebuildIsoCollision` 会清掉所有 `_iso` 矩形）；段间碰撞线两端多探 2px 消缝。
- **弹开落点单位**：敌人走 `applyKnockback`；**玩家 knockback 字段无消费方**（Player.update 不调基类 update），必须直接位移过 `WallSystem.resolve`。站桩怪（煮锅/墓碑）覆写 applyKnockback 为空，天然弹不动。

### 魔法等级门槛 + 快捷栏灰化（新机制范式）
- `magic-categories.js` 加 `MAGIC_SKILL_TIERS`（数据驱动，未登记=初级）+ `meetsMagicWeaponReq`（中级+需当前武器组主/副手 weaponType==='staff'）；释放入口（技能系统 trigger）拦截 + `SceneManager.showTopNotification` 提示（魔法系统惯例，**别学 pushStrike 手写红 div**）。
- 快捷栏灰化：`_renderSkillRequirements()` 挂 updateCooldowns 节拍，槽位切 `qb-skill-disabled` 类（CSS `grayscale(1) brightness(0.55)`）——换装即时生效，无需事件挂钩。

### 本轮坑
- **懒生成辅助贴图被主贴图跳过**：`_ensureXxx()` 写成"主贴图已存在则整体 return"时，BootScene 预加载图片会让辅助贴图（霜斑/碎屑）永不生成 → Phaser 绿叉框。**ensure 无条件调用，内部各贴图块独立 exists 守卫**。
- **场景 stop/start 后 fx 池悬挂**：池内 sprite/emitter 已被 Phaser 销毁但引用还在，`create()` 里必须重置池与共享发射器字段。
- **重构删局部变量后必须 grep 残留引用**：bolt-skill-system 把 `const skill` 换成 `_getEffect()` 后 4 处仍传 `skill`，运行时才炸（冰锥一飞就崩）。改完变量重构先全文件搜变量名。
- **成长公式化后的规模降载**：段数写成 `"5 + (level-1)*2"` 后 L20=43 段，粒子发射器按比例降载（每 3 段一路），防高等级掉帧。
- **技能经验要接线才算数**：冰墙 expRewards 配了但没消费方 = 零经验（面板还写着不实的获取方式）。新技能必须同时写 `addXxxExp`（multiHit 惯例）+ 结算点调用 + 面板文案三方对齐（test-craft-sync 式三角校验）。
- **套装套效绑定整套**（三件齐才激活移速/法系/格挡）——防混搭白嫖特效；移速修正写 `this.maxSpeed`（实际移动读它，`d.speed` 只是面板）。
- **坑：`usePlayerSpeedConfig` 速度公式**：`formulas.speed` 无 base 时 `d.speed = speedFormula.base + …` 恒 NaN——实际移动靠 `this.maxSpeed || data.speed || 100` 兜底到 100。改速度相关面板先查这个公式。

## 34. 墙体类实体的深度锚线 + 遮挡仲裁接入（2026-08-05 掩体案例）

新增“墙体类实体”（如世界-122 的掩体 DefenseCover，不走 WallSystem isoVisuals 而是独立实体）时，
只做碰撞不做图层必踩遮挡坑：**怪物明明站在墙前却被墙盖住一部分**。

- **根因**：掩体精灵 depth 若用 `e.y + 12`（贴图显示框底边），而贴图内容（墙段）实际在框内偏上
  （接地线比 e.y 高 22~137px），深度锚点就比视觉底边深几十~上百 px——墙前实体
  （脚线在接地线之下、但仍在 e.y 之上）被错误排到墙后。实机复现：怪物 depth 2100 < 掩体 2121。
- **修复（三件套，缺一不可）**：
  1. 实体构造时算好 `_faceLine`（墙段底边线/接地线两端点）与 `_faceDepth`（= max 底边端点 y + 12，
     与 `WallSystem.depthOf` 的“max 底边端点 y”同规则）；
  2. `GameScene._updateDynamicDepths` 第 7 步“中立实体统一深度”（`sprite.y + footOffsetY + 10`）要认
     `_faceDepth`——它是**每帧覆盖**所有中立精灵深度的地方，`_syncNeutralEntities` 里设了也会被它盖掉；
  3. `WallSystem.junctionCorrectedDepth` 把动态实体的 `_faceLine` 逐帧并入面线集合（不能进
     `_getFaceSegCache` 缓存，实体可增删），否则斜墙高端前侧（自然深度 < 平面锚线深度）仍会被盖。
- **验证判例**：高端前侧（face 线浅端）实体自然深度 2000 < 锚线 2090，必须靠仲裁抬到 2090.5 才正确；
  无面线处仲裁返回值应原样不变（隔离测试）。
- **已知限制**：镜像（F）只翻贴图、不改逻辑朝向，`_faceLine` 跟随逻辑 orient（h/v），镜像摆放的掩体
  遮挡线可能与视觉有偏差，属可接受取舍。

## 35. 墙段贴图底边必须拉直成 30° 直线，否则端到端拼接“底部不平”（2026-08-05）

> 注：**路线 B（#36）已用 Blender 几何替代"AI 直出 + 拉直"**（零裁剪）。
> 本节保留两条仍然有效的原则：① 墙段贴图底边必须是 30° 直线（像素验收
> 斜率 0.49~0.57）；② 一图两向必须镜像派生（h=flip v）。拉直工具
> `straighten-cover-base.py` 仅作旧资产兜底，新资产走 #36 管线。

掩体/墙段类贴图即使提示词要求“底边 30° 直线”，模型也常画出**曲线底边**
（两端 30~40px 弧度 + 中段更陡，如 D_v 端点斜率 -0.51、中段 -0.62）。
端点贴合（face line 端点重合）时底边高度连续，但拼接点两侧斜率突变 → 底边线折角
~3°，用户感知为“拼接底部不在同一水平”。

- **像素级判据**：端到端拼接（吸附步长 209,-104）后，拼接点两侧墙段底边拟合线在
  拼接点处的 y 差应 < 1px；实测弯曲底边为 -17~-21px。
- **修复（工具 `tools/straighten-cover-base.py`）**：按 COVER_FACE 端点
  （世界空间 30° 直线，v 向 A=(-105,-33) B=(104,-137)）换算到每张贴图原图坐标
  （foot 原图 = (W/2, H)，显示缩放 sx=260/W、sy=sizeH/H），削除直线以下像素 +
  2px 羽化。修后拼接台阶收敛到 ±0.2px。备份 `.bak.straighten`。
- **一图两向的 grade 必须统一 aspect**：D 级 h = flip(v) 同一张贴图，但旧
  COVER_ASPECT 里 h=1.151（sizeH 226）、v=1.029（sizeH 253）——同一墙段两种显示
  高度，且分别拉直后镜像一致性（IoU）从 1.0 掉到 0.89。统一 aspect 后重新
  派生 h = flip(v)，IoU 恢复 1.0。
- **渲染/测量自验坑**：PIL 拼接渲染的 canvas 背景必须透明（alpha 0），否则
  alpha 掩码把背景全算成“墙”（trace 全落在画布底边）；测量用 alpha>128 且
  背景 (0,0,0,0)。拉直前/后各跑一次 `tools/render-join-test.py` 对比 gapAtJoin。

### 35.1 数据表化 + 一图两向（2026-08-05 二轮）

底边拉直只解决了 D 级：**D 级单点实测硬编码的 face 端点对其他级别无效**
（审计：E~A 级拉直后底边端点仍偏 5~31px、斜率偏 10~15%），每张新图都要手动调，
这就是“基底错误→每张图都修”的实锤。正源修复：

- **COVER_FACE 按 grade 数据表化**（audit-cover-geometry.py 自动标定每级 v 端点），
  吸附/碰撞/深度/拉直全部读表；每级吸附步长 = 该级 face 端点差（如 D 209,-97、
  A 244,-152），**严禁硬编码 209,-104**。
- **一图两向强制镜像派生**：h 贴图 = flip(v)（同尺寸同 aspect），COVER_ASPECT 的
  h/v 必须同值；严禁 h 独立渲染/独立标定（否则 h/v 拼接永远不对称，镜像 IoU 掉
  到 0.88）。straighten 只处理 v，h 由 v 翻转生成。
- **遗留代价**：每级斜率 = 该级内容底边实测（D -0.48、A -0.62），同 grade 拼接
  完美（端点重合 + 斜率相同），跨 grade 拼接端点重合但斜率差 4~12% 有折角——
  要彻底统一斜率需内容框归一化（重处理贴图），作为后续选项。
- **验证套路**：`straighten-cover-base.py --grade <g>` → 校验 h=flip(v) IoU=1.0 →
  `cdp-grade-join.mjs` 断言各 grade 吸附 same:true、placeable:true、endGap≈8。

## 36. 掩体/墙段资产完整管线（最终定稿，2026-08-05）

从生图到拼接、碰撞、吸附的完整闭环（世界-122 掩体 D 级等 6 档已按此入库）。

### 36.1 生图：Blender 几何 + AI 材质纹理（零裁剪）

几何由 Blender 精确控制（底边直线、端帽实心），AI 只生成材质纹理，渲染成品贴图
（透明背景，零抠图）。"AI 直出 + 拉直"是废弃的过渡方案（生成图底边参差，
拉直削贴图且每张图都要调）。

- **Blender 几何**：完整 box 230×52×150（长/厚/高），绕 Z 转 **44.8°**——用
  `iter-cover-depth.py` 按"**中段底边斜率**"（排除端帽凸起 20%）校准到 -0.4976。
  不能用"每列最低像素端点"校准（端帽凸起骗斜率，rot 52 假 -0.49、真中段 -0.635）。
- **相机**：正交、俯仰 30°、正面；底边落 y≈880（与深度管线同取景口径）。
- **材质**：AI 生成 1024×668（墙段正面比例 1.53:1，避免横向拉伸）无缝纹理；
  Principled BSDF + **bump 0.42**（0.12 太平面 = 纸片感）+ 无影平光。
  **坑**：EEVEE 的 AO/Mix 节点输出不稳定会把 Base Color 刷成纯色（"统一颜色无贴图"），
  Base Color 必须**纹理直连**。
- **材质细节（2026-08-05 用户反馈"贴图太简单生硬"后重做）**：prompt 强调
  "highly detailed, rich natural irregular pattern (stones vary in size/color/
  orientation, not repetitive), moss and lichen in crevices, chipped and weathered"；
  steps 24→32（多步更饱满）；生成 3 候选 GLM+暗色占比选优。
  bump 0.42→0.25、环境光更亮更平（SUN 1.6→0.9、fill 30→60）——0.42 太深显生硬。
- **障碍物取消阴影（用户要求）**：贴图生成已 no shadows（无投影，像素检测主体
  下方无暗区）；游戏内脚底阴影来自 `_syncEntityShadows`（中立实体黑色圆影 alpha
  0.35）——掩体/防御塔/基地等贴图自带接地底座的障碍物设 `_noShadow = true` 跳过。
- **输出**：`film_transparent=True` + RGBA（透明背景，零抠图）。
- **工具链**：`gen-cover-textures.py`（AI 材质）→ `render-cover-real.py`（Blender 渲染）→
  `render-cover-batch.py`（批量）→ `prep-cover-render.py`（标定+入库）。旧资产备份 `.bak.renderB`。

### 36.2 几何标定

- **face 用正面底边（中段直线端点），不是端帽角点**：v A(-88,-25) B(88,-112)，h 镜像
  （6 级统一）。face 决定吸附步长/深度锚线/遮挡仲裁，必须与贴图底边一致。
- **sizeH = round(260×|原图斜率|/0.4976)**：显示 260×sizeH 非等比，世界斜率 =
  原图像素斜率×sizeH/260；不能按内容框宽高比定。
- **aspect = 260/sizeH**；h = flip(v)（一图两向，IoU=1.0，h/v aspect 必须同值）。
- **几何统一**：6 级同一 box 只换材质 → face/aspect 完全一致，同向/跨级拼接天然共线，
  彻底消灭"每张图调"。

### 36.3 拼接（端帽叠合 + 吸附方向）

- **完整 box 实心端帽**：端帽凸起是墙段标准形态（参考 `wall_straight` 端部斜率
  ±1.6~2.8），不可怕；可怕的是 face 标错/端帽不对称。
- **SNAP_OVERLAP = 40**（≥ 端帽宽 52）：吸附后新件沿走向向既有件回退 40px，
  两端帽完全叠合互盖（skill #25"只叠不缺、覆盖区互盖无害"）。**8px 不够** →
  端帽 V 形开口透空（实机放大实测底部 ~48px 缝，用户反馈"明显间隙"）。
- **吸附回退方向**：`dir = dot >= 0 ? -1 : 1`（dot = (e.x-best.x)·ax + (e.y-best.y)·ay）。
  **旧实现取反** → 左外接被推离 40px 大间隙（用户反馈"默认吸附有很大间隙"），
  SNAP_OVERLAP 加大后立刻暴露。
- **验证**：40px 重叠拼接点最小 alpha 241px（实心）、底边拟合斜率 -0.489、
  残差 **0.5px**（连续直线）；CDP 断言 v-v/h-h 两端 `_faceLine` 端点世界重合。

### 36.4 碰撞（底部面积 + WallSystem.isoSegments）

旧碰撞 46×300 轴对齐矩形（中心脚底）只有斜向墙段视觉的 26% 宽且偏下，怪物可穿墙段
大部分（用户反馈"障碍物根本没碰撞体积"）。修复：

- **COVER_FOOT**：`{w:198, d:133, offY:-68, thick:26}`（face 线 AABB + 墙厚一半），
  `colliderOffsetY` 让矩形中心对准墙段主体。**thick 独立于碰撞 rect**。
- **face 线段注册进 WallSystem.isoSegments**：`{x1,y1,x2,y2, halfThick:26, _cover:true}`，
  销毁 `removeFromCollision()` splice。怪物移动/投射物（Projectile.blocked）/寻路自动被挡
  （skill #33 冰墙同管线）；场景切换 WallSystem.init 自动清。
- **线段碰撞（_canPlace）必须用 thick（26）**，不能用
  `min(collisionWidth, collisionHeight)`（133/140 会成空气墙，吸附右侧被拒）。
- **注意**：防御塔在房内开火弹道出墙会被自家墙挡（嵌墙弹道"只出不进"见 #18）。

### 36.5 验证纪律与历史坑位

- **拼接/接缝类改动必须实机放大截图**（CDP zoom 2.2 对准接缝）+ 像素/GLM 双重确认；
  透明背景渲染模拟测不出端帽开口，必须实机放大（GLM-4.6V 放大才看得出）。
- 像素判据：拼接点每列 alpha 连续（无 0）、底边拟合残差 < 1px。
- **勿重走的坑**：楔形薄片端部（底边共线但端部太薄 → 透空缝隙，伪解）；
  三棱柱手建网格（正面被背面遮挡/UV 缺失，渲染异常）；bump 0.12（纸片感）；
  AO/Mix 刷纯色；碰撞高当墙厚（空气墙）；吸附回退方向取反（单侧大间隙）。
## 37. 改造图标批量生成（craft mod icons，2026-08-05 实测 95 张入库）

给 craft-config.json 的武器改造选项配 `assets/icons/craft/<key>.png` 的标准流程，
细则是 `game-dev/tools/ai-gen/WORKFLOW.md §3.8`，这里只留可复用的骨架与坑位：

- **共享映射先行**：同名同 id 全武器共用一张；同名不同 id 合并（`shotgun_suppressor`→
  `suppressor`、`light_extended_mag`→`light_extended`、`light_pommel`→`light_blade_body`）；
  跨类复用已有图（剑类 `eagle_eye_rune` 用法杖那张）。写脚本扫 data/craft-config.json
  生成 key 清单并校验覆盖，防漏/防孤儿。
- **提示词**：equipment-icon.md 模板 + `(exactly one <key>:1.5)` + `(isolated single
  object:1.3)` + 负面 `no second object, no detached pieces, no whole weapon`；长条件加
  `completely inside the frame with generous white margins`。黑金属件白底出图（BiRefNet 抠得净）。
- **生成**：远程 5080 `flux2-dev-fp8`，`--prompt-file` + 递增 seed，4 并发；客户端超时后图
  仍会落盘，按"文件存在且 >10KB"判成功（调度器 `_gun_gen.js`/`_sword_gen.js`）。
- **硬筛**：BiRefNet 抠图（ComfyUI venv python + `birefnet-cutout.py`）→ alpha>60 连通域
  `components==1`（等价 check-components.py 的"禁止多余元素"）+ 边缘半透白 <0.5%
  （`_gun_filter.py`）。
- **验收**：GLM-4.6V **单张+具体问题**（多图会串扰）；长短/圆平头等几何以 alpha bbox 实测。
- **易错形态**（重抽修复过的）：多室制退器/收束器易被画成鸟笼开长槽；auto/burst/competition/
  lightweight 扳机易带出整枪或画成刀；无护手必被画护手；短管易画成长管；锤击点弹头圆头；
  斜握把变垂直握把。修法：sub 里显式 `no long slots / standalone part only / absolutely no
  crossguard / much shorter than full barrel / flat wadcutter meplat`。
- **入库**：craft-config.json data+public 双份同步（`JSON.stringify(cfg,null,2)+'\n'`），
  校验双份一致 + 引用文件全存在；lint/test/vite build 三绿。
- **路径坑**：Y: NAS 中文路径 Node fs 会 ENOENT 乱码 → 提示词用 PowerShell 写；抠图/筛选
  走 `%TEMP%` 本地中转。`--suffix ""` 空串参数会被 shell 吞，用默认后缀再改名。
