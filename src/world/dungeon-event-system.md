# DungeonEventSystem 接口文档

## 文件位置
`game-dev/src/world/dungeon-event-system.js`

---

## 概述

DungeonEventSystem 目前实现 5 个通用事件、10 个僵尸限定事件与 15 个沼泽限定事件。通用事件包括：
1. **女神像** — 恢复/祝福(+15%攻击,3场)/奖励
2. **陷阱** — 解除(敏捷)/跨越(体质)，失败扣25%血
3. **补给堆** — 搜寻(精神)/探查(敏捷)
4. **宝箱** — 50%金币/25%材料/25%战斗
5. **恶魔雕像** — 扣50%血魔，+33%攻击或材料

限定事件配置位于 `dungeon-event-definitions.js`，通过 `scope + grade` 进入对应地牢的等级 ±1 池；抽取比例固定为通用30%、限定70%。沼泽限定事件的映射、等级和背景提示词见 `docs/swamp-dungeon-events-2026-08-27.md`。

---

## 配置对象

### `DUNGEON_EVENT_CONFIG`

所有事件数值均可通过此配置对象调整，无需修改代码逻辑。

```javascript
{
    // 属性检定
    attributeCheck: {
        baseSuccessRate: 20,      // 基础成功率20%
        attrMultiplier: 1,        // 每点属性+1%
        maxSuccessRate: 95,       // 最终安全上限95%
        minSuccessRate: 5,        // 最终安全下限5%
        softMaxStart: 80,         // 从80%开始进入上限软压缩区
        softMinStart: 20,         // 低于20%进入下限软抬升区
    },

    // 事件类型权重（等概率）
    eventWeights: {
        goddessStatue: 1,
        trap: 1,
        supplyPile: 1,
        treasureChest: 1,
        demonStatue: 1,
    },

    // 各事件详细配置...
}
```

### 各事件配置项

#### `goddessStatue` — 女神像
| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `healPercent` | 100 | 恢复百分比 |
| `blessAtkPercent` | 15 | 祝福攻击加成% |
| `blessDuration` | 3 | 祝福持续战斗场数 |
| `rewardMinGold` | 50 | 最小金币奖励 |
| `rewardMaxGold` | 150 | 最大金币奖励 |

#### `trap` — 陷阱
| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `failDamagePercent` | 25 | 失败扣血% |

#### `supplyPile` — 补给堆
| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `successRewards` | {...} | 成功奖励配置 |
| `failReward` | {...} | 失败安慰奖 |

#### `treasureChest` — 宝箱
| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `outcomes` | [...] | 结果概率分布 |

#### `demonStatue` — 恶魔雕像
| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `sacrificeHpPercent` | 50 | 献祭扣血% |
| `sacrificeMpPercent` | 50 | 献祭扣魔% |
| `demonBuffAtkPercent` | 33 | 恶魔祈祷攻击加成% |

---

## 核心API

### `DungeonEventSystem`

主事件系统，负责事件的触发、UI展示和结果处理。

#### `trigger(player, onComplete, forcedType)`

触发一个随机事件。

**参数：**
- `player` *(Player)* — 玩家对象，用于属性检定和奖励应用
- `onComplete` *(Function)* — 事件完成回调，接收 `EventResult` 对象
- `forcedType` *(string|null)* — 强制指定事件类型（用于测试），可选

**返回值：** `Object` — `{ type, config }` 事件对象

**示例：**
```javascript
import { DungeonEventSystem } from './dungeon-event-system.js';

DungeonEventSystem.trigger(player, (result) => {
    if (result.combat) {
        // 进入战斗
    } else {
        // 返回地图
    }
});
```

#### `handleChoice(choiceId, player)`

处理玩家的选择。

**参数：**
- `choiceId` *(string)* — 选择ID
- `player` *(Player)* — 玩家对象

**说明：** 通常由UI按钮自动调用，无需手动调用。

#### `cleanup()`

强制清理所有事件UI和状态。

#### `isActive()`

检查是否有活跃事件。

**返回值：** `boolean`

---

### `DungeonBuffSystem`

Buff管理系统，负责女神祝福和恶魔祈祷的添加/移除/消耗。

#### `applyGoddessBless(player, battles)`

为玩家添加女神祝福buff。

**参数：**
- `player` *(Player)* — 玩家对象
- `battles` *(number)* — 持续战斗场数，默认3

**返回值：** `boolean` — 是否成功

#### `applyDemonPrayer(player)`

为玩家添加恶魔祈祷buff（永久）。

**参数：**
- `player` *(Player)* — 玩家对象

**返回值：** `boolean` — 是否成功

#### `consumeGoddessBless(player)`

消耗一层女神祝福（战斗完成后调用）。

**参数：**
- `player` *(Player)* — 玩家对象

**返回值：** `boolean` — 是否还有剩余层数

#### `clearAllBuffs(player)`

清除玩家所有地牢buff。

**参数：**
- `player` *(Player)* — 玩家对象

#### `hasBuff(player, buffType)`

检查玩家是否有指定buff。

**参数：**
- `player` *(Player)* — 玩家对象
- `buffType` *(string)* — buff类型 `'goddessBless'|'demonPrayer'`

**返回值：** `boolean`

#### `getAtkBonusPercent(player)`

获取玩家当前攻击加成总百分比。

**参数：**
- `player` *(Player)* — 玩家对象

**返回值：** `number` — 总加成百分比

---

### `AttributeCheckSystem`

属性检定系统，用于陷阱、补给堆等需要属性检定的场景。

#### `getSuccessRate(player, attribute, baseRate)`

只计算并返回成功率，不掷骰、不消耗随机数。事件选项面板必须使用此入口预览概率，保证预览与实际检定采用同一公式且不改变后续随机序列。

#### `check(player, attribute, baseRate)`

执行属性检定。

**参数：**
- `player` *(Player)* — 玩家对象
- `attribute` *(string)* — 属性名 `'str'|'dex'|'con'|'int'|'wis'|'luck'`
- `baseRate` *(number)* — 基础成功率，默认20

**返回值：** `Object`
```javascript
{
    success: boolean,      // 是否成功
    rate: number,          // 实际成功率
    rawRate: number,       // 进入软边界前的线性成功率
    roll: number,          // 随机掷骰值
    attribute: string,     // 属性名
    attrValue: number,     // 属性值
}
```

**检定公式：**
```
rawRate = baseRate + 属性值 × attrMultiplier

20 <= rawRate <= 80：rate = rawRate
rawRate < 20：rate = 5 + 15 × exp((rawRate - 20) / 15)
rawRate > 80：rate = 95 - 15 × exp(-(rawRate - 80) / 15)

rate = clamp(rate, 5, 95) // 最终数值安全兜底
```

线性区保留当前事件的中期成长手感；进入两端后使用连续的指数软边界，使成功率逐渐逼近5%或95%，而不是在某个属性点突然硬截断。配置修改了上下限或软区起点时，公式会按新的区间跨度自动计算。

#### `getResultText(result)`

获取检定结果的描述文本。

**参数：**
- `result` *(Object)* — `check()` 返回的结果对象

**返回值：** `string` — 格式化文本

---

## 集成辅助函数

### `enterDungeonEvent(player, onComplete)`

DungeonMapSystem 集成入口。在 `_enterEvent()` 中调用。

### `onCombatComplete(player)`

战斗完成后调用，消耗女神祝福层数。

### `onDungeonEnd(player)`

地牢结束时调用，清理所有buff。

---

## 与现有系统集成

### 1. DungeonMapSystem 集成

已在 `dungeon-map-system.js` 中完成以下修改：

- **`_enterEvent()`** — 使用 `DungeonEventSystem.trigger()` 替代旧事件系统
- **`_cleanupCombat()`** — 战斗完成后调用 `onCombatComplete()` 消耗buff层数
- **`shutdown()`** — 地牢结束时调用 `onDungeonEnd()` 清理buff

### 2. Player 属性计算集成

已在 `entities/player/base.js` 中完成修改：

- **`calculateCombatStats()`** — 最后调用 `_applyDungeonBuffBonus()` 应用攻击加成
- **新增 `_applyDungeonBuffBonus()`** — 读取 `player._dungeonBuffs` 并应用攻击加成

### 3. 状态栏集成

Buff系统会自动调用 `StatusBar.addEffect()` / `removeEffectByType()` 管理状态栏显示。

---

## 事件结果对象

```javascript
{
    type: string,        // 结果类型：'success'|'fail'|'heal'|'bless'|'gold'|'material'|'combat'|'sacrifice'|'none'
    text: string,        // 结果描述文本
    rewards: {           // 奖励对象
        gold?: number,
        hpPotion?: number,
        mpPotion?: number,
        material?: { type: string, count: number },
        buff?: string,
    },
    combat?: boolean,    // 是否触发战斗
    checkResult?: Object, // 属性检定结果
    damage?: number,     // 失败扣血百分比
}
```

---

## 使用示例

### 触发随机事件
```javascript
import { DungeonEventSystem } from './dungeon-event-system.js';

// 在地图节点点击时触发
DungeonEventSystem.trigger(player, (result) => {
    console.log('事件结果:', result.text);
    if (result.rewards.gold) {
        console.log('获得金币:', result.rewards.gold);
    }
    if (result.combat) {
        // 进入战斗
    }
});
```

### 测试指定事件
```javascript
// 强制触发恶魔雕像事件
DungeonEventSystem.trigger(player, onComplete, 'demonStatue');
```

### 检查buff状态
```javascript
import { DungeonBuffSystem } from './dungeon-event-system.js';

if (DungeonBuffSystem.hasBuff(player, 'goddessBless')) {
    const bonus = DungeonBuffSystem.getAtkBonusPercent(player);
    console.log(`当前攻击加成: +${bonus}%`);
}
```

### 手动添加buff（调试/GM命令）
```javascript
DungeonBuffSystem.applyGoddessBless(player, 5);  // 5场女神祝福
DungeonBuffSystem.applyDemonPrayer(player);       // 永久恶魔祈祷
```

---

## 错误处理

系统已做好以下边界检查：

1. **玩家对象缺失** — 所有API在 `player` 为 null 时安全返回
2. **属性缺失** — 属性检定使用 `player.data[attribute] || 0`
3. **UI重复** — `cleanup()` 确保旧UI被移除后再创建新UI
4. **Buff重复** — 同类型buff会覆盖而非叠加（除了不同buff类型可共存）
5. **金币数据缺失** — 奖励应用时检查 `Game.player.data.gold` 是否存在

---

## 扩展指南

### 添加新事件类型

1. 在 `DUNGEON_EVENT_CONFIG` 中添加新配置
2. 在 `handleXxx()` 函数中添加处理器
3. 在 `DungeonEventSystem.handleChoice()` 的 switch 中添加分支
4. 在 `eventWeights` 中分配权重

### 添加新Buff类型

1. 在 `DungeonBuffSystem.BUFF_CONFIG` 中添加配置
2. 添加 `applyXxxBuff()` 方法
3. 在 `getAtkBonusPercent()` 中累加加成
4. 在 `clearAllBuffs()` 中清理

### 修改属性检定公式

修改 `DUNGEON_EVENT_CONFIG.attributeCheck` 中的参数即可：
```javascript
attributeCheck: {
    baseSuccessRate: 20,  // 选项未填写baseRate时的默认值
    attrMultiplier: 1,    // 每点属性+1%
    maxSuccessRate: 95,   // 最终安全上限
    minSuccessRate: 5,    // 最终安全下限
    softMaxStart: 80,     // 上限软压缩起点
    softMinStart: 20,     // 下限软抬升起点
}
```
