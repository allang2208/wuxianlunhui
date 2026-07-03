# 怪物AI自定义开发工具设计方案

## 一、需求分析

用户希望创建一个**浏览器内的怪物AI可视化开发工具**，整合进现有交互开发工具（左下角）。核心目标：
- 不同阶段的应对策略（Boss战阶段切换、低血量行为改变等）
- 不同怪物之间的协同效应（狼群包围、远程+近战配合等）

要求：**100%可实际落地**，不是纸上谈兵。

---

## 二、技术约束

- 技术栈：Phaser 4 + Canvas 2D Hybrid，Vite + Electron
- 游戏类型：2D俯视角动作RPG（类幸存者）
- 现有AI：每个怪物有独立 `aiInterval` 计时器，在 `Enemy.update()` 中执行简单寻路+攻击
- 现有开发工具：`dev-tool.js`（Canvas拖动）模式已验证可行

---

## 三、全网调研结论

| 方案 | 优点 | 缺点 | 落地难度 |
|------|------|------|----------|
| **行为树（Behavior Tree）** | 图形化、模块化、易于组合 | 需要节点编辑器、运行时树遍历开销 | 高（需UI编辑器） |
| **有限状态机（FSM）** | 简单、直观、性能好 | 状态爆炸、难以表达并行 | 低（已有基础） |
| **强化学习+行为树混合** | 智能度高、可自适应 | 需要训练数据、复杂度高 | 极高 |
| **指挥AI+单体FSM** | 分层清晰、易于扩展 | 需设计通信协议 | 中 |
| **HTN（层次任务网络）** | 规划能力强 | 实现复杂、调试困难 | 高 |

**推荐方案**：**分层FSM + 指挥AI + 协同标记系统**
- 分层FSM：每个怪物有状态机（空闲→警戒→追击→攻击→受伤→撤退）
- 指挥AI：一个轻量级"战场指挥官"，每N帧分配战术给所有活跃怪物
- 协同标记：怪物通过共享标记（如"包围目标"）实现简单协同

---

## 四、核心架构设计（三层模型）

### 4.1 第一层：指挥AI（BattleCommander）

**职责**：不控制单个怪物的具体动作，只决定**整体战术**。

```javascript
class BattleCommander {
    // 战术决策（每1秒执行一次）
    decideTactic(player, enemies) {
        const count = enemies.length;
        const playerHp = player.hp / player.maxHp;
        
        // 根据战场态势选择战术
        if (count >= 5) return 'swarm';      // 5+怪物：蜂群战术
        if (count >= 3) return 'pincer';    // 3+怪物：钳形攻势
        if (playerHp < 0.3) return 'press'; // 玩家残血：压制追击
        return 'harass';                     // 默认：骚扰战术
    }
    
    // 分配目标点给每个怪物
    assignTargets(tactic, player, enemies) {
        // swarm: 所有怪物直接扑向玩家
        // pincer: 怪物分两路包抄
        // press: 切断玩家退路方向
        // harass: 轮流攻击，保持威胁
    }
}
```

**可配置参数**（在开发工具中调整）：
- 决策间隔（ms）
- 战术触发条件（怪物数量阈值、玩家血量阈值）
- 每种战术的权重

### 4.2 第二层：怪物状态机（EnemyFSM）

**职责**：每个怪物独立运行，根据指挥AI的指令和自身状态切换行为。

```javascript
class EnemyFSM {
    states: {
        idle:      { onEnter, onTick, onExit },     // 空闲/巡逻
        alert:     { onEnter, onTick, onExit },     // 警戒（发现玩家但未进入战斗）
        chase:     { onEnter, onTick, onExit },     // 追击
        attack:    { onEnter, onTick, onExit },     // 攻击
        hurt:      { onEnter, onTick, onExit },    // 受伤（被击晕/击退）
        retreat:   { onEnter, onTick, onExit },     // 撤退（低血量）
        // --- 阶段专属状态 ---
        phase2:    { onEnter, onTick, onExit },     // Boss第二阶段
        enraged:   { onEnter, onTick, onExit },     // 狂暴状态
    }
    
    // 状态切换条件（由AI配置文件定义）
    transitions: [
        { from: 'idle', to: 'alert', condition: 'playerInSightRange' },
        { from: 'alert', to: 'chase', condition: 'playerInAggroRange' },
        { from: 'chase', to: 'attack', condition: 'playerInAttackRange' },
        { from: 'attack', to: 'chase', condition: 'playerOutOfAttackRange' },
        { from: 'any', to: 'hurt', condition: 'isStunned' },
        { from: 'any', to: 'retreat', condition: 'hpBelow30' },
        // --- 阶段切换 ---
        { from: 'any', to: 'phase2', condition: 'hpBelow50' },
        { from: 'any', to: 'enraged', condition: 'hpBelow20' },
    ]
}
```

**阶段策略示例**（Boss 黑狼）：
| 阶段 | 触发条件 | 行为变化 |
|------|----------|----------|
| 阶段1 | 100%~70% HP | 普通近战，偶尔嚎叫（召唤2只小狼） |
| 阶段2 | 70%~30% HP | 攻击速度+30%，新增冲锋技能 |
| 阶段3 | 30%以下 | 进入狂暴，攻击力翻倍，攻击范围扩大 |

### 4.3 第三层：协同效应系统（SynergySystem）

**职责**：定义怪物之间的互动规则，无需指挥AI参与。

```javascript
const SYNERGY_RULES = {
    // 同类型协同：狼群
    'wolfPack': {
        types: ['blackWolf', 'wolfSpider'],
        trigger: 'count >= 3 within 300px',
        effect: '所有狼类移动速度+20%，攻击有20%概率附加流血'
    },
    // 远近配合：骷髅射手+骷髅战士
    'skirmishLine': {
        types: ['skeletonArcher', 'skeletonWarrior'],
        trigger: '1 archer + 1 warrior within 200px',
        effect: '战士获得护盾（吸收弓箭手伤害的50%），弓箭手射程+15%'
    },
    // 首领召唤：育母蜘蛛+小蜘蛛
    'broodmother': {
        types: ['broodmotherSpider'],
        trigger: 'hp < 50%',
        effect: '每10秒召唤2只babySpider，最多同时存在6只'
    },
    // 毒性协同：狼蛛+黑狼
    'toxicMiasma': {
        types: ['wolfSpider', 'blackWolf'],
        trigger: 'both alive within 200px',
        effect: '两者攻击附加的中毒层数+1'
    }
};
```

---

## 五、开发工具UI设计（整合进dev-tool）

参考现有 `dev-tool.js`（Canvas拖动）+ `craft-system.js`（SVG虚线）的交互模式：

### 5.1 工具面板布局

```
┌────────────────────────────────────────────────────┐
│  🐺 AI 开发工具                              [✕]   │
├────────────────────────────────────────────────────┤
│  [怪物选择] [状态机] [协同规则] [战术配置] [测试]  │
├────────────────────────────────────────────────────┤
│                                                    │
│  ┌──────────┐  ┌────────────────────────────┐     │
│  │ 怪物列表  │  │     Canvas 预览区           │     │
│  │ ○ 黑狼   │  │  (显示当前怪物的状态机图)    │     │
│  │ ○ 狼蛛   │  │                             │     │
│  │ ○ 骷髅   │  │  [Idle] → [Alert] → [Chase] │     │
│  │ ...      │  │    ↓        ↓        ↓      │     │
│  │          │  │  [Retreat]  [Hurt]  [Attack]│     │
│  └──────────┘  └────────────────────────────┘     │
│                                                    │
│  ┌────────────────────────────────────────────┐   │
│  │ 参数调整面板                                │   │
│  │ 血量阈值: [====●====] 50%  → 进入阶段2     │   │
│  │ 攻击速度: [====●====] 1.3x                   │   │
│  │ 协同范围: [====●====] 200px                 │   │
│  │ 召唤间隔: [====●====] 10s                   │   │
│  └────────────────────────────────────────────┘   │
│                                                    │
│  [💾 保存配置]  [📋 导出JSON]  [🔄 重置默认]     │
└────────────────────────────────────────────────────┘
```

### 5.2 状态机可视化（Canvas绘制）

参考 `craft-system.js` 的 SVG 虚线连接：
- 状态节点 = 圆形/矩形，可点击选中
- 状态连线 = 虚线箭头，显示切换条件
- 选中节点后，右侧参数面板显示该状态的具体配置

### 5.3 实时测试模式

- 点击"测试"按钮，在预览区生成1个玩家和N个怪物
- 怪物按配置的行为运行
- 可手动调整参数，实时观察行为变化

---

## 六、数据存储格式（JSON）

```json
{
  "enemyAI": {
    "blackWolf": {
      "states": {
        "idle": { "sightRange": 300, "patrolSpeed": 1.0 },
        "alert": { "alertDuration": 2000, "speedMul": 1.2 },
        "chase": { "speedMul": 1.5, "loseRange": 500 },
        "attack": { "attackCooldown": 1000, "attackRange": 95 },
        "retreat": { "hpThreshold": 0.3, "speedMul": 1.8 }
      },
      "phases": [
        { "name": "普通", "hpMin": 0.7, "hpMax": 1.0, "attackSpeedMul": 1.0 },
        { "name": "愤怒", "hpMin": 0.3, "hpMax": 0.7, "attackSpeedMul": 1.3, "newSkill": "charge" },
        { "name": "狂暴", "hpMin": 0.0, "hpMax": 0.3, "attackSpeedMul": 2.0, "attackRangeMul": 1.5 }
      ]
    },
    "wolfSpider": {
      "states": { ... },
      "phases": []
    }
  },
  "synergies": [
    { "id": "wolfPack", "types": ["blackWolf", "wolfSpider"], "count": 3, "radius": 300, "effects": { "speedMul": 1.2, "bleedChance": 0.2 } },
    { "id": "skirmishLine", "types": ["skeletonArcher", "skeletonWarrior"], "count": 2, "radius": 200, "effects": { "warriorShield": 0.5, "archerRangeMul": 1.15 } }
  ],
  "commander": {
    "decisionInterval": 1000,
    "tactics": {
      "swarm": { "minEnemies": 5, "target": "player" },
      "pincer": { "minEnemies": 3, "target": "player", "flankAngle": 60 },
      "press": { "playerHpThreshold": 0.3, "cutoffRetreat": true }
    }
  }
}
```

---

## 七、实现路线图（分3个阶段）

### Phase 1：基础状态机（可立即落地）
**时间估算：2-3天**

1. **创建 `src/ai/enemy-fsm.js`**
   - 定义 FSM 基类和状态基类
   - 实现状态切换逻辑（`transition()` 方法）
   - 每个状态有 `onEnter`, `onTick(dt)`, `onExit` 三个钩子

2. **修改 `src/entities/enemy.js`**
   - 用 FSM 替换现有的 `aiInterval` 简单逻辑
   - 保留原有寻路、攻击、动画系统
   - 添加 `phases` 配置支持（根据血量切换阶段）

3. **创建 `data/ai-config.json`**
   - 每个怪物的状态机配置
   - 阶段切换参数

4. **测试**：确保现有所有怪物行为不变（兼容性验证）

### Phase 2：协同效应 + 指挥AI（1-2周）

1. **创建 `src/ai/synergy-system.js`**
   - 扫描场上怪物，检测协同条件
   - 应用协同效果（速度加成、额外效果等）
   - 可视化光环效果（如狼群协同时怪物周围有红色光晕）

2. **创建 `src/ai/battle-commander.js`**
   - 每1秒执行一次战术决策
   - 根据怪物数量和玩家状态选择战术
   - 给每个怪物分配目标位置（不直接控制行为）

3. **测试**：组合不同怪物，验证协同效果

### Phase 3：开发工具UI（1-2周）

1. **创建 `src/ui/ai-dev-tool.js`**
   - 状态机可视化（Canvas绘制节点+连线）
   - 参数滑动条调整
   - 实时测试模式（在工具内生成测试场景）

2. **整合进 `dev-tool.js`**
   - 添加"AI"选项卡
   - 共享工具面板基础设施

3. **导出/导入配置**
   - 保存到 `data/ai-config.json`
   - 导出为 JSON 文件供用户备份

---

## 八、与现有代码的兼容性分析

| 现有文件 | 影响程度 | 修改内容 |
|----------|----------|----------|
| `enemy.js` | 中等 | 用FSM替换简单AI逻辑，保留路径和攻击系统 |
| `enemy-types.js` | 低 | 添加 `phases` 配置，原有构造函数不变 |
| `enemy-data.js` | 无 | 只读取数据，行为逻辑移出 |
| `pathfinder.js` | 无 | FSM内部调用，接口不变 |
| `attack.js` | 无 | 攻击命中回调不变 |
| `dev-tool.js` | 低 | 添加AI选项卡入口 |

**关键设计原则**：每个怪物仍独立运行自己的 `update(dt)`，FSM只是将原有逻辑封装成可配置的状态。不引入任何外部依赖。

---

## 九、为什么这个方案可以100%落地

1. **基于现有架构**：不引入新框架，现有 `Enemy.update()` 已经有 aiInterval 和状态判断，只是将其封装成 FSM
2. **渐进式升级**：Phase 1 只改状态机，不改变任何游戏行为（兼容测试）
3. **数据驱动**：所有AI参数从 JSON 读取，不需要改代码就能调整行为
4. **可视化调试**：开发工具可以实时看到状态机运行，快速定位问题
5. **参考成熟方案**：暗区突围的多斯小队AI就是"强化学习指挥+行为树单体"的混合模式，我们的分层FSM是其简化版

---

## 十、下一步建议

如果这个方案被采纳，我建议从 **Phase 1** 开始：
1. 先给一个怪物（如黑狼）添加完整的FSM+阶段配置
2. 验证现有行为不变
3. 逐步推广到所有怪物

用户确认后，我可以开始实现 Phase 1。
