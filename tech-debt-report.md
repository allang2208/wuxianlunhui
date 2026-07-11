# 游戏项目技术债务审查报告

> **项目路径**: `C:/Users/allan/Documents/kimi/workspace/game-dev/src`  
> **审查日期**: 2026-07-11  
> **项目版本**: v0.198  
> **审查范围**: ~120个JS文件，核心模块15+个  
> **审查维度**: 硬编码数值、重复逻辑、未使用代码、错误处理、性能瓶颈

---

## 一、执行摘要

本次审查发现 **5大类技术债务**，涉及 **30+个严重问题**，主要集中在：

| 类别 | 严重程度 | 问题数量 | 影响范围 |
|------|----------|----------|----------|
| 硬编码数值 | 严重 | 60+ | 全局配置、战斗公式、坐标定位 |
| 重复逻辑 | 严重 | 15+ | NPC检测、AI状态机、伤害计算 |
| 缺失错误处理 | 中等 | 20+ | DOM操作、资源加载、场景切换 |
| 性能瓶颈 | 严重 | 8 | 渲染循环、实体遍历、寻路系统 |
| 未使用代码 | 轻微 | 10+ | 变量、导入、兼容别名 |

---

## 二、硬编码数值（最严重）

### 2.1 场景/世界坐标硬编码

**`game.js`** — 场景原点、生成位置全部硬编码：

```javascript
// 行51-72: 场景原点与物品生成位置
origin = { x: 3825, y: 1886 };          // 场景原点硬编码
origin.x + 120, origin.x + 160;         // 武器生成位置偏移
scrollBaseX = origin.x + 200;           // 卷轴基准位置
matBaseY + 40; i * 30;                  // 强化石生成间距

// 行91-95: 传送门位置
portalBaseX = 3478, portalBaseY = 2363; // 传送门坐标
portalSpacing = 100;                     // 传送门间距

// 行112-139: 靶子、测试目标位置
startX = 3821, startY = 2365;           // 训练靶位置
3244, 1879;                              // DPS测试靶位置
baseX = 4379, baseY = 2411;             // 测试目标位置
baseX = -1356, baseY = 3;               // 武器生成基准
```

**`renderer.js`** — 分辨率与渲染参数硬编码：

```javascript
// 行8-9: 默认分辨率
1920, 1080;                              // 默认分辨率
CONFIG.VIEW_WIDTH = 1920;
CONFIG.VIEW_HEIGHT = 1080;

// 行34: 回退原点
return { x: 3825, y: 1886 };            // 与game.js重复定义

// 行90-94: 准星参数
baseGap = 4, maxGapExtra = 16;          // 准星间隙
lineLen = 6, lineWidth = 2.5;           // 准星线条

// 行135: 小地图尺寸
minimapW = 150, minimapH = 150;         // 小地图大小
pad = 10, mx = pad, my = pad + 50;      // 小地图位置

// 行243-264: 枕木/地面滚动
railScroll = -(scroll % 60);            // 枕木间距60
for (let i = -1; i < w / 60 + 1; i++)  // 枕木间隔60
groundScroll = -(scroll * 1.0 % 150);   // 地面滚动速度150
```

**`world/scene-manager.js`** — 场景配置硬编码：

```javascript
// 行14-22: 所有场景参数硬编码
scenes = {
    main:   { origin: { x: 3825, y: 1886 }, ... },
    scene2: { width: 9000, height: 9000, origin: { x: 4500, y: 4500 }, ... },
    scene3: { width: 3000, height: 1200, origin: { x: 1500, y: 600 }, ... },
    scene4: { width: 9000, height: 9000, origin: { x: 4500, y: 4500 }, ... },
    scene5: { width: 6120, height: 3040, origin: { x: 3060, y: 1520 }, ... },
    scene7: { width: 1024, height: 1024, origin: { x: 512, y: 512 }, ... }
};
```

### 2.2 战斗公式与属性计算硬编码

**`entities/player/base.js`** — 所有战斗公式系数硬编码：

```javascript
// 行25-58: 属性计算公式（全部魔法数字）
d.atk   = Math.round(10 + (d.str + bonusStr) * 0.05 + (d.dex + bonusDex) * 0.1);
d.def   = Math.floor((d.con + bonusCon) * 1.2 + (d.str + bonusStr) * 0.3);
d.matk  = Math.floor(d.int * 1.5 + (d.wis + bonusWis) * 0.5);
d.mdef  = Math.floor((d.wis + bonusWis) * 1.2 + d.int * 0.3);
d.hit   = 80 + Math.floor((d.dex + bonusDex) * 0.5);
d.dodge = 5 + Math.floor((d.dex + bonusDex) * 0.3);
d.crit  = 2 + Math.floor(d.luck * 1.0);
d.aspd  = 1.0 + (d.dex + bonusDex) * 0.02;
d.speed = CONFIG.PLAYER_SPEED + (d.dex + bonusDex) * 0.05;
d.critRes = Math.floor(d.con * 1.0);

// 行136-142: 经验与生命值公式
d.maxHp = 100 + d.con * 10;
d.maxMp = 100 + d.wis * 10 + d.int * 5;
getExpForLevel(level) { return (20 + level * 20 + level * 12) * 2; }
```

**`entities/enemy.js`** — 敌人默认属性硬编码：

```javascript
// 行11-38: 敌人默认属性
hp: config.hp || 150, maxHp: config.maxHp || 150, size: config.size || 14;
speed: (config.speed || 0.3) * 3, accel: 0.7, friction: 0.82;
attackRange: config.attackRange || config.dashDistance || 70;
aiInterval = 300;
```

**`combat/attack.js`** — 攻击配置硬编码：

```javascript
// 行28-56: 攻击参数默认值
cooldown: config.cooldown || 1000;
cooldown: config.cooldown || 500, range: config.range || 100, arc: config.arc || Math.PI / 2.5;
rangeBonus = ... ?? 50;
const WEAPON_OFFSET = 0;                // 多处重复定义

// 行104-305: 各类攻击配置
cooldown: config.cooldown || 600, range: config.range || 117, width: config.width || 23;
if (Date.now() - pt.startTime > 500)   // 500ms硬编码
cooldown: config.cooldown || 800, projectileSpeed: config.projectileSpeed || 10, projectileRange: config.projectileRange || 625;
```

### 2.3 玩家状态与武器配置硬编码

**`entities/player/index.js`** — 玩家构造参数硬编码：

```javascript
// 行26-47: 物理属性
collisionRadius = 15, accel = 0.7, friction = 0.82;
_whirlwindDuration = 800;               // 旋风斩持续时间

// 行95-110: 武器攻击配置（冷却、速度、射程、伤害全部硬编码）
// 行116-126: 游戏开始冷却、初始数据全部硬编码
// 行131-145: 武器图片路径硬编码
```

**`entities/enemy-types.js`** — 敌人子类硬编码：

```javascript
// BlackWolf (行38-75)
_attackDuration = 1600;                 // 8帧 x 200ms/帧
_frameW = 250, _frameH = 215;           // 精灵图尺寸
_cols = 4, _rows = 2;                   // 帧行列数
_frameDurations = { idle: 200, walk: 120, run: 80, attack: 100, pacing: 160 };
_speedThresholds = { run: 1.2, walk: 0.1 };
_pacingInterval = 1000 + Math.random() * 1000;
_aiScanInterval = 200;

// RedWolfKing (行555-608) — 大量重复配置
_transformHpThreshold = transformConfig.hpThreshold || 0.5;
_transformDuration = transformConfig.duration || 2000;
_howlDuration = transformConfig.howlDuration || 2000;
_transformDamageMultiplier = transformConfig.damageMultiplier || 2;
```

### 2.4 修复建议

1. **创建 `data/game-config.json`** — 集中管理所有场景坐标、生成位置
2. **创建 `data/combat-formulas.json`** — 提取所有战斗公式系数
3. **创建 `data/animation-config.json`** — 统一动画帧率、时长配置
4. **使用 `CONFIG` 对象扩展** — 将硬编码值迁移到 `config/config.js`
5. **敌人配置完全JSON化** — 扩展 `enemy-config.json` 覆盖所有子类参数

---

## 三、重复逻辑（严重）

### 3.1 game.js — NPC点击检测重复3次

```javascript
// 行438-461: 第一次NPC检测（点击范围检测）
// 行465-484: 第二次NPC检测（几乎相同代码）
// 行665-690: 第三次拾取检测（与tryPickupItem逻辑重复）
```

**问题**: 三次检测逻辑几乎相同，应提取为统一的 `checkNPCInteraction()` 方法。

### 3.2 game.js — 重复调用

```javascript
// 行663: _checkNPCDistance() 第一次调用
// 行694: _checkNPCDistance() 第二次调用（重复）

// 行660: NPCDialogue.update() 第一次
// 行696: NPCDialogue.update() 第二次（重复）
```

### 3.3 enemy.js / enemy-types.js — AI状态机完全重复

**`BlackWolf._updateAIState()`** (行186-237) 与 **`RedWolfKing._updateAIState()`** (行810-857) 代码几乎完全相同：

```javascript
// 两者都包含：
// - 寻找最近玩家（完全相同的遍历逻辑）
// - pacing -> chasing 状态切换
// - chasing -> pacing 丢失计时
// - 相同的 _pacingInterval = 1000 + Math.random() * 1000
```

**`BlackWolf._executeAI()`** (行240-273) 与 **`RedWolfKing._executeAI()`** (行859-887) 也完全相同。

### 3.4 enemy-types.js — 冲刺/位移逻辑重复

```javascript
// BlackWolf._getDashOffset() (行315-330)
// RedWolfKing._getDashOffset() (行926-941)
// 完全相同的4方向switch逻辑

// BlackWolf._facingToAngle() (行332-339)
// RedWolfKing._facingToAngle() (行942-949)
// 完全相同的4方向角度映射

// BlackWolf._getDashWorldPos() (行342-344)
// RedWolfKing._getDashWorldPos() (行952-954)
// 完全相同

// BlackWolf.renderHealthBar() (行347-360)
// RedWolfKing.renderHealthBar() (行957-970)
// 完全相同的血条渲染

// BlackWolf.renderCollisionRadius() (行362-379)
// RedWolfKing.renderCollisionRadius() (行972-989)
// 完全相同的碰撞半径渲染

// BlackWolf._getRenderPosition() (行381-384)
// RedWolfKing._getRenderPosition() (行991-994)
// 完全相同
```

### 3.5 attack.js — 伤害计算逻辑重复

```javascript
// 行78-95: SlashAttack 伤害计算
// 行183-237: ThrustAttack.checkTriangleHit 动态距离判定
// 行243-287: ThrustAttack.checkTriangleHit 矩形判定
// 三段代码都包含：applyEnchantOnHit -> _onHitEntity -> takeDamage -> applyKnockback -> _triggerRuneSwordCooldownReduction
```

### 3.6 base.js — 祭品效果检查重复

```javascript
// 行43-54: 第一次检查大理石和石头
// 行60-65: 第二次检查石头
// 行68-74: 第三次检查大理石
```

### 3.7 修复建议

1. **提取 `AIStateMachine` 基类** — 将 `_updateAIState` / `_executeAI` 提升到 `Enemy` 基类
2. **提取 `DashMixin`** — 将冲刺相关方法提取为可复用mixin
3. **统一伤害计算管道** — 创建 `DamagePipeline` 类处理所有伤害流程
4. **合并祭品检查** — 使用单次遍历检查所有祭品类型

---

## 四、缺失的错误处理（中等严重）

### 4.1 DOM操作无null检查

**`game.js`**:
```javascript
// 行40: DOM元素获取无null检查
const menuLayer = document.getElementById('menuLayer');   // 可能为null
const uiLayer = document.getElementById('uiLayer');       // 可能为null
const gameLayer = document.getElementById('gameLayer');   // 可能为null
```

**`renderer.js`**:
```javascript
// 行6-7: Canvas获取失败只console.error
const canvas = document.getElementById('gameCanvas');
if (!canvas) { console.error('Canvas not found'); return; } // 无fallback
```

### 4.2 资源加载无错误处理

**`renderer.js`**:
```javascript
// 行22-35: _getSceneOrigin() 多层回退但无最终错误处理
_getSceneOrigin() {
    if (SceneManager.currentScene && SceneManager.scenes[SceneManager.currentScene]) {
        return SceneManager.scenes[SceneManager.currentScene].origin;
    }
    if (typeof CONFIG !== 'undefined' && CONFIG.SCENE_ORIGIN) {
        return CONFIG.SCENE_ORIGIN;
    }
    return { x: 3825, y: 1886 }; // 最终硬编码回退，无错误报告
}
```

### 4.3 场景切换错误处理不足

**`world/scene-manager.js`**:
```javascript
// 行64-158: switchScene() 有try-catch但内部大量操作无单独保护
// 行104-108: Phaser场景清理无null检查
const phaserScene = window.__phaserScene;
if (phaserScene && phaserScene.clearAllEntitySprites) {
    phaserScene.clearAllEntitySprites(); // 部分条件检查
}

// 行113-120: 无人机系统访问无保护
if (player && player.droneSystem && player.droneSystem.active) {
    player.droneSystem._deactivate();
    // QuickBar 和 player.skills 可能未定义
    QuickBar.cooldowns['droneSkill'] = (effect.cooldown || 15) * 1000;
}
```

### 4.4 数据解析安全风险

**`systems/data-loader.js`**:
```javascript
// 行73-81: parseSkillFormula() 使用 new Function() 无沙箱
parseSkillFormula(formula, level) {
    const fn = new Function('level', `return ${formula};`); // 可执行任意代码
    return fn(level);
}
```

### 4.5 寻路系统边界情况

**`ai/pathfinder.js`**:
```javascript
// 行462-465: A*超限时返回null，调用方可能未处理
maxIterations = cols * rows * 2;
// ...
if (iterations >= maxIterations) {
    return null; // 调用方可能未检查null
}
```

### 4.6 修复建议

1. **所有DOM操作添加null检查** — 使用可选链或提前返回
2. **资源加载添加重试机制** — 图片/JSON加载失败时重试3次
3. **替换 `new Function()`** — 使用安全的数学表达式解析器
4. **A*寻路添加路径近似回退** — 超限时返回最近路径而非null
5. **场景切换添加事务回滚** — 部分失败时恢复之前状态

---

## 五、性能瓶颈（严重）

### 5.1 game.js update() — 每帧8次实体遍历

```javascript
// 行512:    第1次遍历 — 实体更新          O(N)
this.entities.forEach(e => { if (e.active) e.update(dt, this.entities); });

// 行516-533: 第2次遍历 — 外部系统更新      O(N)
this.entities.forEach(e => { /* FormationSystem, TacticalSquadAI */ });

// 行537-540: 第3次遍历 — 阵型系统          O(N)
FormationSystem.update(dt, this.entities);

// 行543-545: 第4次遍历 — 空间分区          O(N)
SpatialPartitionSystem.update(this.entities);

// 行551-557: 第5次遍历 — 战斗指挥官收集    O(N)
this.entities.forEach(e => { if (e._faction === 'enemy') enemies.push(e); });

// 行567-610: 第6次遍历 — 金币自动拾取      O(N x M)
this.entities.forEach(item => { /* 遍历所有玩家检查距离 */ });

// 行612-617: 第7次遍历 — 清理死亡实体      O(N)
this.entities.forEach((e, key) => { if (!e.active) deadKeys.push(key); });

// 行625-655: 第8次遍历 — 传送门检测        O(N)
this.entities.forEach(e => { /* 检查传送门交互 */ });
```

**总计**: 每帧约 **8次完整遍历**，时间复杂度 **O(8N + N*M)**

### 5.2 renderer.js render() — 每帧排序+多次遍历

```javascript
// 行840: 每帧创建新数组并排序          O(N log N)
const sorted = Array.from(this.entities.values())
    .filter(e => e.active)
    .sort((a, b) => a.y - b.y);

// 行842:    第1次遍历 — 实体渲染          O(N)
sorted.forEach(e => e.render(Renderer.ctx));

// 行844-850: 第2次遍历 — 碰撞盒渲染        O(N)
sorted.forEach(e => { if (e.renderCollisionRadius) ... });

// 行866-876: 第3次遍历 — 受击效果渲染      O(N)
sorted.forEach(e => { if (e.hitFlash > 0) ... });
```

**总计**: 每帧 **O(N log N + 3N)**，且创建新数组产生GC压力

### 5.3 enemy.js — 每帧遍历所有树木

```javascript
// 行222-234: _getMoveCost() 每帧遍历所有树木
_getMoveCost(x, y) {
    for (const tree of trees) { // 每帧O(T)，T=树木数量
        const dist = Math.sqrt((tree.x - x)**2 + (tree.y - y)**2);
        if (dist < tree.radius + this.size) return 1000;
    }
    return 1;
}
```

**注释已指出**: "这是性能杀手"

### 5.4 pathfinder.js — 大场景迭代超限

```javascript
// 行340-367: _buildGrid() 每帧可能重建网格
_buildGrid() { /* O(cols x rows) */ }

// 行462: 大场景可能迭代数万次
maxIterations = cols * rows * 2; // 9000x9000场景 = 1.62亿次迭代
```

### 5.5 修复建议

1. **合并遍历循环** — 将8次遍历合并为2-3次
2. **使用空间哈希/四叉树** — 替代线性距离检测
3. **渲染排序缓存** — 仅在实体Y坐标变化时重新排序
4. **对象池复用** — 避免每帧创建新数组
5. **寻路分帧计算** — 大场景使用分帧或 hierarchical pathfinding
6. **树木使用空间索引** — R-tree 或均匀网格加速碰撞检测

---

## 六、未使用的变量/导入

### 6.1 已确认问题

| 文件 | 位置 | 问题 | 建议 |
|------|------|------|------|
| `main.js` | 行160 | `window.HitEffect = BloodHitEffect` | 检查是否仍需要兼容别名 |
| `game.js` | 行18 | `fpsTimer: 0` | 初始化但未充分使用 |
| `game.js` | 行26 | `_timerInterval: null` | GameUIManager已管理，重复定义 |
| `player/index.js` | 行168 | `this._poisonEffect = new PoisonEffect()` | update.js中可能重复创建 |

### 6.2 需要进一步检查

- 各文件中的 `import` 是否都被使用
- `typeof XXX !== 'undefined'` 的过度使用模式
- `Date.now()` 的频繁调用（可用时间戳缓存优化）

---

## 七、其他发现

### 7.1 全局变量依赖（架构债务）

```javascript
// 多处使用 typeof 检查全局变量
if (typeof WallSystem !== 'undefined' && WallSystem.resolve) { ... }
if (typeof Game !== 'undefined' && Game.spawnTargets) { ... }
if (typeof SoundManager !== 'undefined' && SoundManager.playFile) { ... }
if (typeof QuickBar !== 'undefined') { ... }
if (typeof RiftSystem !== 'undefined') { ... }
```

**问题**: 模块间通过全局变量耦合，难以单元测试和树摇优化。

### 7.2 混合渲染系统（Phaser + Canvas 2D）

```javascript
// weapon-anim.js 行201-215
const scene = window.__phaserScene; // 直接访问全局Phaser场景
if (scene) {
    this._playSwordAttackTween(scene, hand);
    if (scene.playerSprite) { ... }
}
```

**问题**: Canvas 2D 和 Phaser 两套渲染系统并存，增加维护复杂度。

### 7.3 console.log 残留

```javascript
// enemy-types.js 行623, 644, 684
console.log(`[${this.name}] 开始变身！`);
console.log(`[${this.name}] 变身动画完成，开始嚎叫！`);
console.log(`[${this.name}] 嚎叫完成！HP恢复，攻击力翻倍！`);

// scene-manager.js 行66, 182, 262, 302
console.log('[switchScene] sceneId=', sceneId, ...);
```

---

## 八、修复优先级矩阵

| 优先级 | 问题 | 影响 | 工作量 | 文件 |
|--------|------|------|--------|------|
| P0 | 合并game.js遍历循环 | 性能 | 中 | game.js |
| P0 | 硬编码坐标提取到JSON | 可维护性 | 中 | game.js, scene-manager.js |
| P0 | 战斗公式配置化 | 可维护性 | 中 | base.js, enemy.js |
| P1 | 提取AI状态机基类 | 重复代码 | 中 | enemy-types.js |
| P1 | 渲染排序缓存 | 性能 | 低 | renderer.js |
| P1 | 空间哈希加速碰撞 | 性能 | 高 | enemy.js, wall-system.js |
| P2 | DOM操作null检查 | 稳定性 | 低 | game.js, renderer.js |
| P2 | 替换new Function() | 安全性 | 低 | data-loader.js |
| P2 | 清理console.log | 代码质量 | 低 | 多处 |
| P3 | 全局变量依赖解耦 | 架构 | 高 | 全局 |

---

## 九、未检查文件清单

以下文件在本次审查中尚未深入检查，建议后续补充：

- `entities/player/update.js` / `render.js` — 文件过大，需分段读取
- `entities/humanoid-monster.js` / `combatant.js` / `entity.js`
- `world/wall-system.js` / `map-generator.js` / `maze-generator.js`
- `world/dungeon-*.js`（多个地牢相关文件）
- `effects/*.js`（约15个特效文件）
- `ui/*.js`（约20个UI文件）
- `systems/*.js`（约8个系统文件）
- `ai/*.js`（约8个AI文件）
- `items/*.js`

---

*报告生成时间: 2026-07-11*  
*审查工具: 静态代码分析 + 人工审查*
