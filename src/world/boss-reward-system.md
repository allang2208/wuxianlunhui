# BossRewardSystem 接口文档

## 文件位置
`game-dev/src/world/boss-reward-system.js`

## 概述
BossRewardSystem 是地牢模式重构 Stage 4 的核心模块，负责：
1. **Boss 战管理**：4096 固定场地的大块头 Boss 战斗
2. **奖励节点**：复用现有 RewardSystem 的雪地奖励界面
3. **Buff 系统**：女神祝福（+15%攻击，3场）和恶魔祈祷（+33%攻击，永久）

---

## 导出对象

### 1. `BOSS_REWARD_CONFIG` — 配置对象

所有数值均可通过此配置对象调整，无需修改代码。

```javascript
{
    // Boss 场地配置
    arena: {
        size: 4096,           // 场地大小（正方形）
        wallThickness: 40,    // 边界墙壁厚度
        margin: 60,           // 生成边距
        playerOffset: 80,     // 玩家从边界向内偏移
    },

    // Boss（大块头）属性配置
    boss: {
        name: '大块头',
        hp: 160000,           // 总生命值
        size: 160,            // 渲染大小
        collisionRadius: 80,  // 碰撞半径
        speed: 45,
        level: 20,
        // 六维属性
        str: 153, dex: 30, con: 114, int: 10, wis: 20, luck: 15,
        // 攻击配置
        attack: { cooldown: 1200, dynamicRange: 200, width: 40, damageMin: 45, damageMax: 75, knockback: 25 },
        // 技能配置
        skills: {
            fanSlash: { range: 150, angle: 120, damageMultiplier: 2, cooldown: 6000, windupTime: 1500 },
            charge: { speed: 400, damageMultiplier: 3, cooldown: 25000, minDistance: 800, windupTime: 1000 },
            summon: { count: 2, cooldown: 60000, summonHpPercent: 0.5 },
        },
    },

    // 奖励配置
    reward: {
        baseGold: 2000,
        goldVariance: 500,
        bonusCards: [ /* 3张Boss奖励卡牌 */ ],
    },

    // Buff 配置
    buffs: {
        goddessBlessing: { atkBonusPercent: 15, matkBonusPercent: 15, maxBattles: 3 },
        demonPrayer: { atkBonusPercent: 33, matkBonusPercent: 33, hpCostPercent: 50, mpCostPercent: 50 },
    },
}
```

### 2. `BigBoss` — Boss 实体类

继承自 `Enemy`，实现大块头 Boss 的完整战斗逻辑。

#### 构造函数
```javascript
new BigBoss(x, y, config = {})
```
- `config` 会与 `BOSS_REWARD_CONFIG.boss` 合并，可覆盖任意属性

#### 技能系统
| 技能 | 触发条件 | 效果 |
|------|----------|------|
| 蓄力扇形斩 | 近距离 + CD | 150px/120°范围，2倍伤害 |
| 蓄力冲锋 | 远距离(≥800px) + CD | 400px/s冲锋，3倍伤害，撞墙自晕 |
| 召唤小僵尸 | HP≤50% + 只触发一次 | 召唤2只小僵尸 |

#### 自定义渲染
- 2.5倍大型火柴人
- 红色威胁光环（蓄力时增强）
- 80px 宽血条 + 召唤阶段标记线
- 蓄力时显示红色虚线警告圈

### 3. `BossBattleManager` — Boss 战斗管理器

管理 4096 场地的完整战斗流程。

```javascript
const manager = new BossBattleManager();

// 开始战斗
manager.start(player, () => {
    console.log('Boss 战完成！');
});

// 更新（每帧）
manager.update(dt);

// 检查状态
manager.isActive(); // boolean

// 手动清理
manager.cleanup();
```

### 4. `DungeonBuffSystem` — Buff 系统

管理地牢模式专属 Buff。

```javascript
const buffSys = new DungeonBuffSystem();

// 女神祝福：+15%物攻/魔攻，3场战斗
buffSys.applyGoddessBlessing(player);

// 恶魔祈祷：+33%物攻/魔攻，永久，但扣50% HP/MP
buffSys.applyDemonPrayer(player, 'attack'); // choice: 'attack' | 'materials'

// 战斗结束后减少层数（自动处理）
buffSys.onBattleEnd(player);

// 移除所有 Buff（地牢结束时）
buffSys.removeBuff(player);
buffSys.clearAllBuffs();

// 查询
buffSys.getBuff(player); // { type, remainingBattles, atkBonus, ... }
```

### 5. `RewardNodeManager` — 奖励节点管理器

复用现有 `RewardSystem` 界面，追加 Boss 奖励卡牌。

```javascript
const rewardMgr = new RewardNodeManager();

// 打开奖励界面
rewardMgr.enterRewardNode(player, () => {
    console.log('奖励选择完成');
});

// 直接发放奖励
rewardMgr.giveReward(player, [
    { type: 'gold', count: 3000 },
    { type: 'stone', count: 5 },
]);
```

### 6. `BossRewardSystem` — 主入口（推荐）

组合以上所有子系统的便捷入口。

```javascript
// 进入 Boss 战
BossRewardSystem.enterBossBattle(player, () => {
    // Boss 击败后自动调用
    BossRewardSystem.enterRewardNode(player, () => {
        // 奖励选择完成后返回地图
        DungeonMapSystem._returnToMap();
    });
});

// 每帧更新
BossRewardSystem.update(dt);

// 应用 Buff
BossRewardSystem.applyGoddessBlessing(player);
BossRewardSystem.applyDemonPrayer(player, 'attack');

// 战斗结束
BossRewardSystem.onBattleEnd(player);

// 地牢结束清理
BossRewardSystem.cleanup();
```

---

## 与现有系统集成

### 1. dungeon-map-system.js 集成

在 `_enterBoss()` 方法中：

```javascript
_enterBoss(node) {
    if (this.dungeonType === 'zombie') {
        this._enterZombieCombat(node);
        return;
    }
    
    // 使用新的 BossRewardSystem
    import('./boss-reward-system.js').then(mod => {
        mod.BossRewardSystem.enterBossBattle(this.player, () => {
            // Boss 击败后，标记节点为已访问并返回地图
            this.visitedNodeIds.add(node.id);
            this._returnToMap();
        });
    });
}
```

### 2. 奖励节点集成

在 `_enterNode()` 中处理 `reward` 类型：

```javascript
_enterNode(node) {
    // ... 其他类型
    case "reward": 
        import('./boss-reward-system.js').then(mod => {
            mod.BossRewardSystem.enterRewardNode(this.player, () => {
                this._returnToMap();
            });
        });
        break;
}
```

### 3. 战斗结束 Buff 处理

在 `_checkCombatComplete()` 中：

```javascript
_checkCombatComplete() {
    // ... 原有逻辑
    
    // 战斗完成后减少 buff 层数
    if (typeof BossRewardSystem !== 'undefined') {
        BossRewardSystem.onBattleEnd(this.player);
    }
}
```

### 4. main.js 导入

在 `main.js` 中添加导入和全局挂载：

```javascript
// 导入
import { BossRewardSystem, BigBoss, BossBattleManager, RewardNodeManager, DungeonBuffSystem } from './world/boss-reward-system.js';

// 全局挂载（在 initModules 中）
window.BossRewardSystem = BossRewardSystem;
window.BigBoss = BigBoss;
window.BossBattleManager = BossBattleManager;
window.RewardNodeManager = RewardNodeManager;
window.DungeonBuffSystem = DungeonBuffSystem;
```

---

## 错误处理和边界检查

1. **Boss 生成**：如果 `Game.entities` 不可用，Boss 不会生成，但会记录错误日志
2. **玩家位置**：如果 `WallSystem.canMoveTo` 可用，会确保玩家生成在安全位置
3. **Buff 叠加**：同一玩家只能持有一种地牢 Buff，新的会覆盖旧的并恢复原始属性
4. **奖励发放**：背包满时自动将物品掉落在地上
5. **场地边界**：冲锋技能撞墙会提前结束并触发屏幕震动

---

## 扩展建议

1. **调整 Boss 难度**：修改 `BOSS_REWARD_CONFIG.boss` 中的属性值
2. **新增技能**：在 `BigBoss._updateSkills()` 中添加新技能逻辑
3. **自定义奖励**：修改 `BOSS_REWARD_CONFIG.reward.bonusCards`
4. **新增 Buff**：在 `BOSS_REWARD_CONFIG.buffs` 中添加配置，在 `DungeonBuffSystem` 中实现
