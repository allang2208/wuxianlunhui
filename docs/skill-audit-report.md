# 技能系统技术排查报告

## 一、本次已修复的问题

### 1. 风车（whirlwind）技能
- **问题**：无眩晕效果；持续时间、剑类半径加成等硬编码在代码中。
- **修改**：
  - `data/skills.json` 中 `whirlwind.effectFormula` 新增 `stunDuration: 2500`、`duration: 800`、`swordRadiusBonus: 80`。
  - `src/entities/components/whirlwind-system.js` 从技能 effect 读取上述参数；命中目标时调用 `entity.applyStun(stunDuration)`。
  - `src/entities/player/subsystems.js` 中兜底 `whirlwind` 对象同步为与 JSON 一致的公式。
- **效果**：风车现在可使受影响目标眩晕 2.5 秒，且关键参数由数据驱动。

### 2. 无人机（droneSkill）在地牢不生效
- **问题**：
  1. `data/skills.json` 中 `droneSkill.effectFormula` 只定义了 `damageBonus`（小数形式），而代码期望 `damageBonusPercent`、`critBonusPercent`、`moveSpeed`、`radius`，导致易伤加成计算为 `undefined/100` → `NaN`，伤害异常。
  2. 进入 `CombatRoomSystem` 战斗房时玩家被传送，但无人机停留在原世界坐标，无法覆盖新刷新的怪物。
- **修改**：
  - `data/skills.json` 中 `droneSkill.effectFormula` 改为 `damageBonusPercent`、`critBonusPercent`、`duration`、`moveSpeed`、`radius`。
  - `src/entities/components/drone-system.js` 非操控模式下无人机跟随玩家，自然适配战斗房传送。
  - `src/entities/damageable-entity.js`、`src/entities/combatant.js`、`src/entities/player/subsystems.js` 中对 `damageBonusPercent`/`critBonusPercent` 增加默认值保护，防止旧存档/兜底数据产生 NaN。

### 3. 事件金币未进背包
- **问题**：女神馈赠、宝箱馈赠、地牢普通战斗奖励直接写入 `player.data.gold`，而商店读取 `GoldManager` 背包中的金币，导致金币无法消费。
- **修改**：`src/world/dungeon-event-system.js` 和 `src/world/dungeon-map-system.js` 中改用 `GoldManager.addGold()`。

### 4. 推击（pushStrike）技能数据化
- **问题**：120° 扇形、50ms 命中延迟、300ms 动画、1500ms 眩晕、范围提示生命期/alpha 等硬编码在代码中。
- **修改**：
  - `data/skills.json` 中 `pushStrike.effectFormula` 新增 `hitArc`、`hitCheckDelay`、`animationDuration`、`stunDuration`、`rangeEffectLife`、`rangeEffectAlpha`。
  - `src/entities/components/push-strike-system.js` 全部改为从 `skill.getEffect()` 读取。
  - `src/entities/player/subsystems.js` 兜底 `pushStrike` 同步。

### 5. 冲刺攻击（dashAttack / dashAttackFire / dashAttackThrust）数据化
- **问题**：总时间 800/600ms、charge 时间、冲刺距离 188、移动阶段比例 0.4、速度倍率 0.75、反弹比例 0.3、挥砍窗口 400ms、击退/范围加成公式、眩晕 500ms、暴击倍率、火焰轨迹间隔等硬编码。
- **修改**：
  - `data/skills.json` 中为三种冲刺变体补齐 `effectFormula`（`totalMs`、`chargeMs`、`dashDist`、`movePhaseRatio`、`speedMul`、`bounceRatio`、`slashWindowMs`、`knockbackBonus`、`rangeBonusBase/LevelBonus/Flat`、`hitArc`、`stunDuration`、`critMul`、`rangeEffectLife/Alpha`、`goldenConvergeDuration` 等）。
  - `src/entities/components/dash-system.js` 全面从技能 effect 读取，同时保留 `_getSkillParam` 武器覆盖作为默认值来源。
  - `src/entities/player/subsystems.js` 兜底对象同步。

### 6. 夜与火之剑特殊攻击（nightFlame）数据化
- **问题**：`data/skills.json` 无该技能条目，冷却、光束长度/宽度/持续时间、伤害间隔、伤害公式、tick 伤害倍率等全部硬编码。
- **修改**：
  - `data/skills.json` 新增 `nightFlame` 技能，包含 `cooldown`、`mpCost`、`beamLength`、`beamDuration`、`beamWidth`、`tickInterval`、`damageBase`、`strMul`、`intMul`、`tickDamageMul`、`magicVulnStacks`、`resetOffset`、`recoverMs`、`rangeEffectAlpha/Shape/Filled/Life`。
  - `src/entities/components/special-attack-system.js` 全部改为从 `skills.nightFlame.getEffect()` 读取。
  - `src/entities/player/subsystems.js` 兜底对象同步。

### 7. 冰锥（iceSpike）/ 火球（fireball）数据化
- **问题**：伤害公式、飞行速度、最大射程、冷却、MP 消耗、悬浮时长等与 `data/skills.json` 重复或未读取。
- **修改**：
  - `src/entities/components/ice-spike-system.js` / `fireball-system.js` 改为从 `skill.getEffect()` 读取 `damageBase`、`magicMul`、`intMul`、`flySpeed`、`maxRange`、`cooldown`、`mpCost`、`duration`、`spikeCount`/`explosionRadius`。
  - 经验获取改为调用 `SkillManager.addIceSpikeExp` / `addFireballExp`，读取 `expRewards`。

### 8. 技能经验数值数据化
- **问题**：所有技能经验值（命中、多命中、击杀、暴击等）为硬编码魔法数。
- **修改**：
  - `data/skills.json` 为每个技能新增 `expRewards` 字段。
  - `src/ui/skill-manager.js` 中 `addMeleeExp`、`addDashExp`、`addDashThrustExp`、`addWhirlwindExp`、`addPushStrikeExp`、`addCriticalStrikeExp`、各枪械/弓精通、盾防、无人机、冰锥、火球经验方法全部改为读取 `skill.expRewards`。

### 10. 技能公式解析器支持数值/布尔常量
- **问题**：`DataLoader.parseSkillFormula` 对非字符串的 `effectFormula` 值直接返回 `0`，导致 `cooldown`、`mpCost`、`flySpeed`、`rangeEffectFilled` 等数值/布尔字段在 JSON 驱动技能中失效。
- **修改**：`src/systems/data-loader.js` 中 `parseSkillFormula` 增加对 `number` 与 `boolean` 类型的直接返回。

### 9. 玩家技能兜底对象对齐
- **问题**：`_initSkills()` fallback 中多项公式与 `data/skills.json` 不一致（如 `iceSpike.flySpeed` 800 vs 1600、`droneSkill` 属性不一致、缺少 `nightFlame` 等）。
- **修改**：
  - `src/entities/player/subsystems.js` 中所有兜底 `getEffect()` 与 JSON 完全一致。
  - 新增 `shotgunMastery` JSON 定义，并同步兜底对象。
  - 为 `dashAttackFire`、`dashAttackThrust`、`nightFlame` 补齐兜底。

## 二、保留的纯表现/视觉硬编码（ intentionally 保持现状）

| 技能/系统 | 保留的硬编码内容 | 原因 |
|---|---|---|
| 推击 | 无额外保留 | — |
| 冲刺攻击 | 武器位移动画阈值（0.25/0.75）、视觉偏移常量、复位动画使用 `WeaponAnimConfig.stab.recoverMs` | 纯视觉表现，不影响战斗判定 |
| 夜与火 | 武器贴图本地偏移 `localCenterX/localCenterY`、障碍物截断逻辑 | 与渲染坐标系耦合，属于视觉/碰撞表现 |
| 冰锥 | 身后偏移 `(-30 - row*30, side*30)`、摇摆幅度/频率、破碎粒子数量 | 纯视觉排布 |
| 火球 | 身前视觉偏移 30px、动画帧数 73、帧间隔 100/50ms、爆炸粒子数量 | 纯视觉表现 |

## 三、仍然存在的硬编码项（建议后续逐步数据化）

| 技能/系统 | 硬编码内容 | 位置 |
|---|---|---|
| 暂无高优先级战斗参数 | — | — |

## 四、本次未改动但需注意的点

- 药水类事件奖励（`hpPotion`/`mpPotion`）当前为直接恢复 HP/MP，未作为物品进入背包。若后续需要保留为物品，需额外设计。
- `data-loader.js` 仍使用 `new Function()` 解析技能公式（`src/systems/data-loader.js` 中已改为安全表达式求值，但项目内可能还有其他位置）。
- 冰锥/火球系统已在前序计划中改为通用 `source` 驱动，可供玩家与敌人复用。
