# 游戏 Buff / Debuff 速查表

> 本文档汇总当前游戏中所有状态效果（buff/debuff），方便数值调整与设计查阅。新增或修改 buff 后请同步更新本表。

## 一、控制类 Debuff

| 类型键 | 名称 | 图标 | 效果 | 典型来源 | 关键代码位置 |
|--------|------|------|------|----------|--------------|
| `stun` | 眩晕 | 💫 | 无法移动、攻击、使用技能/物品、调整朝向；会**强制中断**正在进行中的动作（攻击/施法等），即使尚未进行伤害判定也回到 idle | 盾牌弹反、技能命中、怪物攻击 | `damageable-entity.js:applyStun`<br>`movement-system.js` / `player/update.js` / `player/subsystems.js` |
| `frozen` | 冻结 | 🧊 | **效果等同于眩晕**；额外使目标受到的非魔法伤害 +50%；视觉表现为一个半透明冰块覆盖目标 | 寒冷 20 层转化、特定改造/技能 | `damageable-entity.js:applyFreeze`<br>`damageable-entity.js` 伤害结算段<br>`phaser/scenes/GameScene.js:_syncFreezeEffects` |
| `bind` | 束缚 | ⛓️ | 无法移动；玩家束缚时不能闪避 | 部分技能/怪物 | `damageable-entity.js:applyBind`<br>`movement-system.js` / `player/subsystems.js` |
| `fear` | 恐惧 | 😱 | 强制朝恐惧源反方向逃跑；每层移速 -33%，最多 3 层（最高 -99%）；期间强制取消防御 | 特定怪物/技能 | `damageable-entity.js:applyFear`<br>`player/update.js` / `movement-system.js` |
| `slow` | 减速/致残 | 🐌 | 移动速度 ×50% | 怪物技能 | `damageable-entity.js:applyCripple`<br>`player/update.js` |

## 二、持续伤害 Debuff

| 类型键 | 名称 | 图标 | 效果 | 典型来源 | 关键代码位置 |
|--------|------|------|------|----------|--------------|
| `poison` | 中毒 | ☠️ | 每秒受到 `层数` 点毒素伤害；每层独立 5s 倒计时，到期减一层 | 毒液瓶、毒虫、沼泽事件、毒附魔 | `damageable-entity.js:applyPoison`<br>`player/update.js` / `subsystems.js` |
| `bleed` | 流血 | 🩸 | 每秒流失 `层数 × 1% 当前生命值` 的血量；持续 10s，到期减一层 | 工头僵尸、特工斧头、沼泽水蛭 | `damageable-entity.js:applyBleeding`<br>`player/update.js` |

## 三、易伤 Debuff

| 类型键 | 名称 | 图标 | 效果 | 典型来源 | 关键代码位置 |
|--------|------|------|------|----------|--------------|
| `magicVulnerability` | 魔力易伤 | 🔮 | 每层使受到的魔法伤害 +5% | 夜与火之剑、符文长剑、改造词条 | `damageable-entity.js:applyMagicVulnerability`<br>`damageable-entity.js` 伤害结算段 |
| `droneVulnerability` | 无人机易伤 | 🛸 | 每层使受到的所有伤害 +10%（基础），并 +10% 被暴击率；受无人机技能等级加成 | 无人机技能标记 | `damageable-entity.js:applyDroneVulnerability`<br>`player/subsystems.js` / `enemy.js` |
| `electrified` | 感电 | ⚡ | 每层使受到的电系伤害 +3%；**叠满 5 层触发过载**：眩晕 1.2s + 对周围 150px 敌方单位传导一次电击并清空全部层数 | 闪电、雷暴领域、雷神审判 | `damageable-entity.js:applyElectrified`<br>`damageable-entity.js` 伤害结算段 |

## 三点五、伤害输出 Debuff

| 类型键 | 名称 | 图标 | 效果 | 典型来源 | 关键代码位置 |
|--------|------|------|------|----------|--------------|
| `camelFright` | 骆驼惊吓 | 🐪 | 处于骆驼骑兵600px光环内时降低最终伤害输出；Lv.1为-10%，之后每级-2%，Lv.6为-20%；同类光环不叠加 | 沙漠官邸“骆驼惊吓”升级 | `hamster-camel-cavalry.js`<br>`combat/outgoing-damage-modifiers.js` |

## 四、增益 Buff

| 类型键 | 名称 | 图标 | 效果 | 典型来源 | 关键代码位置 |
|--------|------|------|------|----------|--------------|
| `haste` | 加速 | 💨 | 按层数叠加移速；每层默认 +10%，层数越多移速越高；持续时间内再次获得则层数+1、持续时间按来源追加；全部时间到期后所有层数一并消失 | P4040 轻量化快速板机命中、檀木握柄、净厄藤坠 | `damageable-entity.js:applyHaste`<br>`player/update.js` |
| `inspire` | 激励 | 📣 | 移速 ×1.33、物攻 ×1.5（数据层直接乘算，到期还原） | 僵尸工头号召 | `damageable-entity.js:applyInspire`<br>`damageable-entity.js:_onInspireEnd` |
| `statusImmune` | 状态免疫 | 🔰 | 免疫一切其他 buff/debuff 入库 | 特定技能/怪物 | `damageable-entity.js:applyStatusImmune` |
| `buff` | 增益 | ✨ | 通用占位，具体效果由调用方决定 | — | `damageable-entity.js:addStatusEffect` |
| `holyRenewal` | 圣光续疗 | 💚 | 每秒恢复最大生命值 1%×层数；获得新层时层数+1、持续时间追加 | 翠灵水晶杖头 | `damageable-entity.js:applyHolyRenewal` |
| `chainSpell` | 链式强化 | 🔗 | 每层使下次施法的魔法伤害 +2%、MP 消耗 +5%；施法后获得 1 层；持续时间到后全部清空 | 松木握柄 | `utils/magic-craft-helper.js:consumeChainSpellBonus`<br>`utils/magic-craft-helper.js:addChainSpellStack` |
| `chill` | 寒冷 | ❄️ | 每层降低 5% 移动速度；层数加法叠加、最终乘算；获得新层时层数+1、持续时间追加；**叠加到 20 层时转化为冻结并减少 10 层寒冷**；冻结期间不再叠加寒冷 | 冰魄吊坠尾坠 | `damageable-entity.js:applyChill`<br>`player/update.js`<br>`systems/movement-system.js` |
| `burn` | 灼伤 | 🔥 | 每 0.5 秒受到施法者魔法攻击×0.5 的魔法伤害；可叠加，每层独立追踪来源 | 烈焰吊坠尾坠 | `damageable-entity.js:applyBurn` |

## 五、地牢事件 Buff

| 类型键 | 名称 | 图标 | 效果 | 来源 | 关键代码位置 |
|--------|------|------|------|------|--------------|
| `goddessBless` | 女神祝福 | ✨ | 物攻/魔攻 +15%，持续 N 场战斗 | 女神雕像事件 | `world/dungeon-event-system.js:DungeonBuffSystem.applyGoddessBless` |
| `demonPrayer` | 恶魔祈祷 | 🔥 | 物攻/魔攻 +33%，永久；通常伴随 HP/MP 代价 | 恶魔雕像事件 | `world/dungeon-event-system.js:DungeonBuffSystem.applyDemonPrayer` |

## 六、祭品 Buff（本次地牢生效）

| 类型键 | 名称 | 图标 | 效果 | 关键代码位置 |
|--------|------|------|------|--------------|
| `tributeSnowLotus` | 雪莲祝福 | 🪷 | 本次地牢经验获取 +25% | `config/tribute-effects.js:SPECIAL_BUFFS` |
| `tributeGinseng` | 人参回气 | 🌿 | 击杀目标后 1s 内回复最大魔法值 5% | `config/tribute-effects.js` |
| `tributePeach` | 蟠桃续命 | 🍑 | 本次地牢死亡后 3s 以 30% 最大生命原地复活一次 | `config/tribute-effects.js` |
| `tributeDiamond` | 金刚不坏 | 💎 | 单次受到的伤害不超过最大生命值 15% | `config/tribute-effects.js` |
| `tributeMoonstone` | 月影庇护 | 🌙 | 进入战斗获得无敌；Boss/精英战中物攻/魔攻 +5% | `config/tribute-effects.js` |
| `tributePhilosopher` | 点石成金 | 🪨 | 获得随机传说祭品（传说祭品则额外再得一份） | `config/tribute-effects.js` |

## 七、击杀触发临时 Buff

| 类型键 | 名称 | 图标 | 效果 | 来源 |
|--------|------|------|------|------|
| `marbleHeal` | 大理石守护 | 🗿 | 击杀目标后 1s 内回复一定比例生命值 | 大理石祭品/改造 |
| `ginsengHeal` | 人参回气 | 🌿 | 击杀目标后 1s 内回复最大魔法值 5% | 人参祭品 |

## 八、新增 Buff 的标准流程

1. **状态栏显示**：在 `src/ui/status-bar.js` 的 `STATUS_CONFIG` 里增加条目（`icon`、`name`、`color`、`desc`）。
2. **实体层申请接口**：在 `src/entities/damageable-entity.js` 的 `STATUS_CONFIG` 里增加图标/名称/颜色，并新增 `applyXxx(duration, opts)` 方法。
3. **状态免疫拦截**：所有 `applyXxx` 方法开头应检查 `hasStatusEffect('statusImmune')`，免疫状态下拒绝入库（`statusImmune` 本身除外）。
4. **效果消费**：
   - 玩家效果在 `src/entities/player/update.js` 中消费（移速、扣血、禁用闪避等）。
   - 敌人效果在 `src/systems/movement-system.js` 或对应敌人类型文件中消费。
   - 伤害类效果在 `src/entities/damageable-entity.js` 伤害结算段消费。
5. **更新本文档**：将新 buff 填入对应分类表格。

## 九、常用效果参考值

| 效果 | 当前数值 | 备注 |
|------|----------|------|
| 恐惧移速削减 | 每层 -33%，上限 -99% | `getFearSpeedMul()` |
| 减速/致残 | 移速 ×50% | `slow` |
| 中毒伤害 | 每秒 `层数` 点 | `poison` |
| 流血伤害 | 每秒 `层数 × 1% 当前生命` | `bleed` |
| 魔力易伤 | 每层 +5% 魔法伤害 | `magicVulnerability` |
| 无人机易伤 | 每层 +10% 全伤害、+10% 被暴击率 | `droneVulnerability` |
| 感电 | 每层 +3% 电系伤害；叠满 5 层过载（眩晕 1.2s + 周围 150px 电弧传导） | `electrified` |
| 骆驼惊吓 | 600px内敌方伤害输出 -10%~-20%，同类不叠加 | `camelFright` |
| 激励 | 移速 ×1.33、物攻 ×1.5 | `inspire` |
| 加速 | 每层 +10% 移速，可叠加；到期全部层数清空 | `haste` |
| 圣光续疗 | 每秒恢复最大生命 1%×层数 | `holyRenewal` |
| 链式强化 | 每层 +2% 下次魔法伤害、+5% 下次魔法 MP 消耗 | `chainSpell` |
| 寒冷 | 每层 -5% 移速，可叠加；20 层转冻结并扣 10 层；冻结期间不叠加 | `chill` |
| 冻结 | 等同于眩晕；非魔法伤害 +50%；冰块视觉 | `frozen` |
| 灼伤 | 每 0.5s 受到施法者 matk×0.5 魔法伤害 | `burn` |
| 女神祝福 | 物攻/魔攻 +15% | 按场消耗 |
| 恶魔祈祷 | 物攻/魔攻 +33% | 永久，通常有代价 |

---

*最后更新：2026-08-23（新增骆驼惊吓伤害输出减益）*
