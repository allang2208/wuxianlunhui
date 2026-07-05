# Sprite Pipeline 技能文档

## 版本: 1.3

## 核心规则

1. **Phaser `spritesheet` 加载时必须带 `endFrame`** — 防御性配置，防止图片高度差1像素导致帧数错误
2. **所有精灵图在入代码前必须跑标准化脚本** — 统一内容大小和中心位置，避免代码手动调 spriteSize
3. **精灵图尺寸必须严格是 `frameSize × cols × rows`** — 不足时脚本自动填充透明行

---

## 流水线流程（以后每个新角色/怪物都走这套）

### 步骤1: 制作原始精灵图

在 Aseprite / Photoshop 中制作，帧大小固定（如 250×215）。

不要求内容精确对齐，因为步骤3会处理。

### 步骤2: 运行标准化脚本

```bash
cd tools
python sprite-normalizer.py \
  --input ../assets/enemies/raw/black_wolf.png ../assets/enemies/raw/black_wolf_attack.png \
  --output ../assets/enemies/ \
  --frame-width 250 --frame-height 215 \
  --cols 4 --rows 2
```

脚本行为：
- 分析每个精灵图的所有帧内容边界
- 取所有输入中的**最大内容宽高**作为目标
- 缩放每帧内容（保持比例，fit 模式）
- 平移使内容中心对齐到帧中心
- 输出到 `--output` 目录

只输出报告不生成文件：
```bash
python sprite-normalizer.py --report ...
```

### 步骤3: BootScene 加载

```javascript
this.load.spritesheet('enemy_black_wolf', 'assets/enemies/black_wolf.png', {
    frameWidth: 250, frameHeight: 215, endFrame: 7
});
```

**必须带 `endFrame`**，Phaserv4 即使图片高度差1像素也能正确加载。

### 步骤4: 怪物代码无需手动调 spriteSize

标准化后所有精灵图内容大小一致，代码中统一 spriteSize，无需条件判断：

```javascript
_getPhaserOptions() {
    return {
        spriteSize: 216,  // 统一值，不再根据状态变化
        frame: this._animFrame,
        flipX: this._facing === 'left',
        // ...
    };
}
```

---

## 常见问题

### 精灵图加载时报 "has no frame X"

原因：图片高度不是 `frameHeight` 的整数倍，Phaser 只识别了整数行数。  
解决：
1. 短期：在 `load.spritesheet` 中加 `endFrame: N`
2. 长期：运行 `sprite-normalizer.py` 自动填充到正确尺寸

### 切换动画时贴图忽大忽小

原因：不同精灵图的内容大小/中心位置不一致，Phaser 按整帧缩放导致内容大小差异。  
解决：运行 `sprite-normalizer.py` 统一所有精灵图的内容大小和中心位置。

---

## 工具文件

- `tools/sprite-normalizer.py` — 精灵图标准化脚本
- `tools/sprite-meta.json` — 脚本输出元数据（记录目标参数）

---

## 怪物 AI 状态机（BlackWolf 示例）

### 设计原则
- **不硬编码**：AI 参数从 `enemy-config.json` 或构造函数 `config.ai` 读取
- **外部系统驱动**：BlackWolf 的 `update()` 只设置目标属性（`target`、`_tacticalTarget`、`_lastKnownTargetPos`），`MovementSystem` 和 `CombatSystem` 在后续帧执行移动/攻击
- **状态机模式**：`pacing` → `chasing` → `lost` → `pacing`

### 状态定义

| 状态 | 速度 | 目标 | 行为 |
|------|------|------|------|
| `pacing` | `maxSpeed * 0.5` | `_tacticalTarget`（200px 内随机点） | 在踱步中心半径 200px 内慢速漫游 |
| `chasing` | `maxSpeed` | `target`（最近玩家） | 向玩家奔跑，进入攻击范围时触发攻击 |
| `lost` | 无（计时中） | 保留 `target` | 目标跑出 800px 后持续 2s 计时，超时回 pacing |

### 参数配置（enemy-config.json）

```json
{
  "blackWolf": {
    "speed": 93.6,
    "dashDistance": 200,
    "ai": {
      "aggroRange": 800,
      "pacingRange": 200,
      "loseTimeout": 2000
    }
  }
}
```

### 代码实现要点

```javascript
// 1. update() 中扫描 + 执行 AI
this._aiScanTimer += dt;
if (this._aiScanTimer >= this._aiScanInterval) {
    this._aiScanTimer = 0;
    this._updateAIState(dt, entities);  // 状态切换
}
this._executeAI(dt, entities);  // 设置 target / _tacticalTarget / maxSpeed

// 2. pacing 状态：设置 _tacticalTarget，让 MovementSystem 读取
this._tacticalTarget = this._pacingTarget;
this.maxSpeed = this._baseSpeed * 0.5;

// 3. chasing 状态：设置 target，让 CombatSystem 读取
this.target = nearestPlayer;
this.maxSpeed = this._baseSpeed;
this._tacticalTarget = null;
```

---

## 状态效果系统（DamageableEntity 统一驱动）

### 设计原则
- **单一来源**：所有伤害型状态效果（中毒、流血、魔法易伤、无人机易伤）的 `_update*` 方法**只存在于 DamageableEntity 基类**
- **子类不重复**：`enemy.js` 和 `combat-system.js` 不再包含 `_updatePoison`/`_updateBleed` 等方法
- **统一入口**：`DamageableEntity.update(dt)` 调用 `updateStatusEffects(dt)` + 4 个 `_update*` 方法

### 属性初始化链
```
Combatant 构造函数 → DamageableEntity 构造函数
  _poisonStacks, _poisonTimer, _poisonTickTimer, _poisonEffectId
  _bleedStacks, _bleedTimer, _bleedTickTimer, _bleedEffectId
  _magicVulnerabilityStacks, _magicVulnerabilityTimer
  _droneVulnerabilityStacks, _droneVulnerabilityTimer

Enemy 构造函数只保留特有属性：
  this._poisonEffect = new PoisonEffect();  // 粒子效果（基类没有）
```

### 为什么之前重复？
`enemy.js` 和 `combat-system.js` 各自维护了一套 `_updatePoison`/`_updateBleed`/`_updateMagicVulnerability`/`_updateDroneVulnerability`。
这意味着：当 `CombatSystem.update()` 和 `Enemy.update()` 都被调用时，**状态效果每帧被更新两次**，导致中毒/流血伤害翻倍。

### 重构后调用链
```
Enemy.update() → DamageableEntity.update() → updateStatusEffects() + _updatePoison() + ...
CombatSystem.update() → 不再调用状态效果更新（只负责战斗：眩晕、攻击、武器动画）
```

---

## Dash 偏移计算（_getDashOffset 统一接口）

### 问题
`GameScene.js` 的 `_syncBodiesToPhysics` 中有一段 12 行的 switch 逻辑，用于根据 `_dashAngle` 或 `_dashStartFacing` 计算冲刺偏移量。这段逻辑在 `enemy-types.js`（BlackWolf）中也存在。

### 解决
在 `Enemy` 基类定义 `_getDashOffset()` 方法：
```javascript
_getDashOffset() {
    if (this._attackDashOffset <= 0) return { x: 0, y: 0 };
    if (this._dashAngle !== undefined) {
        return {
            x: Math.cos(this._dashAngle) * this._attackDashOffset,
            y: Math.sin(this._dashAngle) * this._attackDashOffset
        };
    }
    switch (this._dashStartFacing || this._facing) {
        case 'right': return { x: this._attackDashOffset, y: 0 };
        case 'left':  return { x: -this._attackDashOffset, y: 0 };
        case 'down':  return { x: 0, y: this._attackDashOffset };
        case 'up':    return { x: 0, y: -this._attackDashOffset };
        default:      return { x: 0, y: 0 };
    }
}
```

`GameScene.js` 和 `enemy-types.js` 统一调用 `entity._getDashOffset()`，不再重复 switch 逻辑。

---

## 树木碰撞体优化（大怪物卡树问题）

### 问题
黑狼碰撞体积 38 虽然不大，但在树木（视觉半径 25，碰撞半径 25）间移动时仍会被卡住。因为 `canMoveTo` 判定的是 `tree.radius + entity.radius < distance`，视觉半径和碰撞半径未分离。

### 解决
1. **视觉半径和碰撞半径分离**：每棵树的 `collisionRadius = radius × 0.6`（主神空间树木从 25 降到 15）
2. **滑动回退**：`WallSystem.resolve()` 在标准 X/Y 轴滑动都失败后，尝试按 75%/50%/25% 步长找到可移动的最远位置，避免完全卡住

### 新增属性
```javascript
addTree(x, y, radius, ...) {
    const collisionRadius = radius * 0.6;  // 碰撞半径仅为视觉的60%
    // ...
}
```

所有使用 `t.radius` 的位置（`canMoveTo`、`blocked`、Phaser 同步）统一使用 `t.collisionRadius || t.radius * 0.6`。

---

## 常见陷阱：anim.timer === 0（死代码）

### 问题
`enemy.js` 和 `combat-system.js` 的 swing 阶段都有：
```javascript
if (anim.timer === 0 && this._pendingThrust) this._pendingThrust.active = true;
```

这条代码**永远不会触发**：`anim.timer += dt` 后 `dt > 0`，`anim.timer` 不可能为 0。

### 正确做法
`ThrustAttack.execute()` 在创建 `_pendingThrust` 时已经设置 `active = true`：`triggerWeaponAnim()` 没有覆盖 `_pendingThrust`，所以 `active` 始终保持 `true`，无需重新设置。

直接删除这条死代码即可。

---

## 常见陷阱：const 重复声明

### 问题
`shield-system.js` 的 `onDamageTaken` 方法中：
```javascript
const defense = shieldData.defense;  // 行53
// ... 弹反逻辑 ...
const defense = shieldData.defense;  // 行81 ← 重复声明！
```

在块级作用域中（`if` 块内部是 `const` 的作用域），同一个函数中两次 `const defense` 会导致语法错误。

### 解决
弹反逻辑中直接使用行53声明的 `defense` 变量，不再重复声明。或者在弹反块内部改声明为 `const defense = shieldData?.defense || {}`（如果外层 `defense` 不在作用域内）。

---

## 变更记录

- v1.4 (2026-07-05) — 硬编码清理：状态效果统一化、树木碰撞体优化、dash 偏移统一
  - DamageableEntity 基类新增 `_updatePoison`/`_updateBleed`/`_updateMagicVulnerability`/`_updateDroneVulnerability`，4种状态效果统一在基类 `update()` 中驱动
  - Enemy 构造函数删除 15 行冗余属性初始化（已在 Combatant 中初始化）
  - `combat-system.js` 删除 85 行重复状态效果代码 + 1 处死代码 `anim.timer === 0`
  - GameScene.js dash 偏移逻辑统一：使用 `entity._getDashOffset()` 替代 inline switch 逻辑
  - wall-system.js 树木碰撞体优化：视觉半径和碰撞半径分离（collisionRadius = radius × 0.6），resolve() 添加逐步缩减步长回退
  - shield-system.js 修复 `const defense` 重复声明语法错误
  - 黑狼碰撞体积从 88 缩小到 38

- v1.3 (2026-07-05) — 增加 Sprite Pipeline 标准化流程，新增 `sprite-normalizer.py` 工具
- v1.2 (2026-07-05) — 怪物渲染模板系统，提取 `Enemy.render()` 通用模板 + 7个钩子方法
- v1.1 (2026-07-04) — 怪物统一配置（enemy-config.json），删除双系统
