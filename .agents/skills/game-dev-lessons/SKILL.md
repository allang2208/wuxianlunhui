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

## 11. 新增状态效果（debuff）流程

以“束缚”为例：
1. 在 `DamageableEntity.addStatusEffect` 的 `STATUS_CONFIG` 里加 `bind`。
2. 加 `applyBind(duration)` 方法，调用 `addStatusEffect('bind', ...)` 并显示 `StatusBar` / `FloatingText`。
3. 在 `MovementSystem.update` 早期判断 `hasStatusEffect('bind')`，直接 `vx=vy=0` 返回。
4. 在玩家 `update.js` 的速度计算处也把 `bind` 的 `targetSpeed` 置 0。
5. 实际调用时传入毫秒，例如 `target.applyBind(500)` 表示 0.5 秒。

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

## 18. 常用调试/验证清单

- 改完敌人数值后，确认 `data/enemy-config.json` 与 `BootScene` 中动画注册一致。
- 召唤/生成新实体后，检查 `entities` Map 中 key 是否唯一。
- 体力不恢复时，优先检查 `weaponAnim.state` 和 `_activeAttackTweens`。
- 敌人在近战范围内“倒退跑”时，检查 separation 与 target 方向的点积处理。
- 出现 `INEFFECTIVE_DYNAMIC_IMPORT` 是 `src/ui/codex-manager.js` 的已知构建警告，与本次改动无关。
