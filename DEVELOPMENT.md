# 无限轮回 — 模块化重构后开发文档

## 📊 当前项目状态

### 模块化成果

`legacy.js`（原 6282 行，394KB）已全部拆分为 **32 个 ES6 模块**：

| 层级 | 模块数量 | 文件 |
|------|----------|------|
| Config | 2 | `config.js`, `math-utils.js` |
| World | 5 | `renderer.js`, `camera.js`, `map-generator.js`, `maze-generator.js`, `wall-system.js` |
| Effects | 13 | `effect-manager.js`, `slash-effect.js`, `thrust-effect.js`, `blood-hit-effect.js`, `smoke-effect.js`, `attack-range-effect.js`, `dash-effects.js`, `sweep-effect.js`, `nightflame-effect.js`, `particle-effects.js`, `floating-text.js`, `muzzle-flash.js`, `shell-casing.js` |
| Items | 3 | `item-factory.js`, `item-database.js`, `weapon-anim-config.js` |
| Combat | 2 | `attack.js`, `projectile.js` |
| Entities | 6 | `entity.js`, `damageable-entity.js`, `target-dummy.js`, `player.js`, `enemy.js`, `drop-item.js` |
| UI | 7 | `input.js`, `skill-manager.js`, `quick-bar.js`, `equip-manager.js`, `codex-manager.js`, `system-ui.js`, `sound-manager.js` |
| Core | 1 | `event-bus.js` |
| Game | 1 | `game.js` |

**`legacy.js` 当前仅保留全局兼容性层**（14 行）：
- 缓动函数：`easeInQuad`, `easeOutQuad`, `easeInCubic`, `easeInOutCubic`
- 武器动画常量：`WEAPON_ANIM`
- 烟雾图片预加载：`smokeImagesLegacy`

### 模块依赖关系

```
index.html
  └── src/main.js (module, 挂载所有模块到 window)
        ├── legacy.js (script, 全局工具函数)
        └── src/*.js (32个模块, 通过 export/import 组织)
```

**关键规则**：`main.js` 在模块作用域中导出，然后挂载到 `window.*` 作为全局变量。所有模块在代码中引用的是 `window.*` 上的全局变量，因此模块间的交叉引用不依赖 ES6 模块的 import 链，而是依赖运行时的全局挂载顺序。

---

## 🗺️ 后续开发路线图

### 阶段 1：消除全局依赖（当前 → 1-2 周内）

**目标**：将 `window.*` 全局挂载改为真正的 ES6 模块导入链，提升代码可维护性和 Tree-shaking 能力。

**具体工作**：
1. 每个模块在顶部添加 `import` 语句，显式声明依赖
2. 移除 `main.js` 中的 `window.X = X` 挂载
3. 移除 `legacy.js` 全局兼容性层
4. 将缓动函数迁移到 `src/config/math-utils.js`
5. 将 `WEAPON_ANIM` 迁移到 `src/items/weapon-anim-config.js`
6. 将 `smokeImagesLegacy` 迁移到 `src/effects/smoke-effect.js`

**优先级：高**。当前全局挂载是技术债务，越早消除越好。

### 阶段 2：数据驱动重构（2-3 周）

**目标**：将硬编码的装备、技能、敌人数据全部改为 JSON 数据表 + 配置驱动。

**具体工作**：
1. 创建 `data/equipment.json` — 所有装备数据迁移出 JS 代码
2. 创建 `data/skills.json` — 所有技能数据迁移出 JS 代码
3. 创建 `data/enemies.json` — 所有敌人数据迁移出 JS 代码
4. 创建 `src/systems/loot-system.js` — 掉落表配置
5. 创建 `src/systems/progression-system.js` — 等级/经验曲线配置

**优先级：中**。当前装备数据在 `ItemDatabase` 和 `EquipManager` 中有两份，需要统一。

### 阶段 3：玩法系统扩展（3-4 周）

**目标**：添加 Roguelike 核心循环。

| 系统 | 说明 |
|------|------|
| 关卡生成器 | 随机房间布局、Boss 房间、商店房间 |
| 敌人 AI 系统 | 状态机（Idle → Chase → Attack → Flee） |
| 技能树系统 | 被动天赋 + 主动技能组合 |
| 属性系统 | 装备词缀（前缀/后缀，如「锋利的」「+火焰伤害」） |
| 任务系统 | 主神空间任务板 |
| 存档系统 | 多存档槽 + 云同步结构 |

### 阶段 4：性能优化（4-5 周）

| 优化项 | 方案 |
|--------|------|
| 对象池 | 特效、投射物、敌人复用 |
| 空间分割 | 四叉树 / 网格加速碰撞检测 |
| 脏矩形渲染 | 只重绘变化区域 |
| 资源预加载 | 按关卡按需加载资源 |
| Web Worker | 将地图生成移入 Worker |

---

## ⚔️ 添加新装备的标准流程

### 当前方式（硬编码）

需要修改 **4 个文件**：

1. **`src/items/item-database.js`** — 添加基础数据
```js
my_new_sword: {
    weaponId: 'weapon6',
    name: '我的新剑', type: '单手剑', icon: '⚔',
    category: 'weapon_melee', rarity: 'epic', level: 15,
    weaponType: 'sword',
    equipImage: 'assets/weapons/my_sword.png',
    stats: [{ name: '物理攻击', value: '80-100' }],
    desc: '描述文本',
    equipSlot: 'weapon'
}
```

2. **`src/ui/codex-manager.js`** — 在 `attackAnimation` 中添加攻击/动画参数
```js
my_new_sword: {
    attack: { range: 165, knockback: 8, attackInterval: 500, hitType: '突刺', damageType: '物理' },
    animation: { type: 'thrust', totalMs: '1100ms', windupMs: 200, swingMs: 500, recoveryMs: 400 }
}
```

3. **`src/items/weapon-anim-config.js`** — 如果有特殊动画需求

4. **`src/game.js`** — 在 `start()` 中添加 `this.spawnWeapon(EquipManager.MY_NEW_SWORD_ITEM)` 或类似的测试数据

### 建议的新方式（数据驱动）

**目标**：只需修改 **1 个 JSON 文件**。

创建 `data/equipment.json`：
```json
{
    "my_new_sword": {
        "weaponId": "weapon6",
        "name": "我的新剑",
        "type": "单手剑",
        "category": "weapon_melee",
        "rarity": "epic",
        "level": 15,
        "stats": [{"name": "物理攻击", "value": "80-100"}],
        "attack": {"range": 165, "knockback": 8, "attackInterval": 500},
        "animation": {"type": "thrust", "windupMs": 200, "swingMs": 500, "recoveryMs": 400}
    }
}
```

然后在 `ItemDatabase` 加载时自动读取 JSON 文件并注册。

---

## ✨ 添加新技能的标准流程

### 当前方式（硬编码）

需要修改 **2 个文件**：

1. **`src/entities/player.js`** — 在 `initSkills()` 中定义技能数据
```js
myNewSkill: {
    id: 'myNewSkill', name: '我的新技能', icon: '🔥', level: 1, maxLevel: 10,
    exp: 0, maxExp: 100,
    tags: [{ type: 'active', name: '主动' }],
    getEffect(level) {
        return { damageMul: 1.0 + level * 0.2, cooldown: 10 - level * 0.5, staminaCost: 20, radius: 100 + level * 10 };
    }
}
```

2. **`src/ui/skill-manager.js`** — 在 `renderSkillDetail()` 中添加 UI 渲染逻辑

### 建议的新方式

创建 `data/skills.json`：
```json
{
    "myNewSkill": {
        "id": "myNewSkill",
        "name": "我的新技能",
        "icon": "🔥",
        "maxLevel": 10,
        "tags": [{"type": "active", "name": "主动"}],
        "effectFormula": {
            "damageMul": "1.0 + level * 0.2",
            "cooldown": "10 - level * 0.5",
            "staminaCost": "20",
            "radius": "100 + level * 10"
        }
    }
}
```

---

## 🎯 Prompt 优化建议（重点）

### 当前问题

从你的截图和报错来看，当前模块化流程中容易出现以下问题：

1. **全局变量遗漏**：`easeInCubic` 等函数原本在 `legacy.js` 中定义，清空后导致模块报错
2. **加载顺序依赖**：`main.js` 模块加载和 `legacy.js` 脚本加载顺序不同，导致 `Game` 未定义
3. **缓存问题**：浏览器缓存导致修改不生效，需要反复强制刷新
4. **404 资源**：不存在的图片路径导致控制台红字，虽然不影响运行但干扰判断

### 优化后的标准 Prompt 模板

当你需要我添加新功能时，请使用以下格式：

```
## 任务类型
[ ] 添加新装备  [ ] 添加新技能  [ ] 添加新敌人  [ ] 系统重构  [ ] Bug修复

## 具体需求
- 名称：
- 类型：
- 属性/效果：
- 稀有度：
- 等级要求：
- 特殊机制：

## 关联系统
- 是否需要新的动画效果？
- 是否需要新的音效？
- 是否影响现有平衡？

## 测试要求
- [ ] 浏览器能正常加载
- [ ] 无控制台报错
- [ ] 功能正常运作
```

### 模块化开发的 Prompt 原则

**1. 永远先问"依赖在哪里"**

在添加任何新代码前，检查：
- 这个函数/类依赖哪些全局变量？
- 哪些模块引用了这个函数/类？
- 修改后会不会破坏其他模块？

**2. 数据优先于代码**

添加新内容时，优先问：
- 这是新机制还是新数据？
- 如果是新数据，能不能做成配置而不是硬编码？
- 当前数据表在哪里？

**3. 渐进式重构**

不要一次性修改太多文件。每次任务聚焦：
- 最多修改 3-5 个文件
- 每修改一步就验证（浏览器测试）
- 确认无报错后再进行下一步

**4. 明确的验证标准**

每次任务结束时，必须验证：
```
✅ 浏览器强制刷新后正常加载
✅ 控制台无红色报错
✅ 功能按需求正常运作
✅ 没有新增 404 资源（除非是已知缺失的资源）
```

### 示例：添加新装备的正确 Prompt

```
请添加一把新武器「雷霆之怒」：

基础信息：
- 类型：单手剑
- 稀有度：史诗（epic）
- 等级：20
- 物理攻击：90-110
- 特殊效果：攻击时有30%概率触发闪电链，对附近敌人造成50%溅射伤害

资源：
- 图标：assets/icons/thunder_sword.png（已存在）
- 装备贴图：assets/weapons/thunder_sword_equip.png（已存在）
- 使用标准突刺动画（复用现有 sword 动画配置）

测试要求：
1. 在 `game.js` 的 `start()` 中生成该武器作为测试掉落
2. 拾取后正常显示在武器栏
3. 攻击时触发正常伤害
4. 控制台无报错

注意事项：
- 不要修改 `legacy.js` 中的全局兼容性层
- 所有改动在模块中完成
- 需要修改的文件请明确列出
```

### 避免的错误 Prompt

❌ **模糊**："帮我加把新武器"
❌ **范围过大**："重构整个装备系统"
❌ **没有验证**："改完就行不用测试"
❌ **忽略上下文**："只改这个文件"（不考虑依赖关系）

---

## 📁 推荐的项目结构（最终目标）

```
game-dev/
├── index.html                  # 入口 HTML
├── legacy.js                   # 全局兼容性层（逐步消除）
├── src/
│   ├── main.js                 # 模块入口（挂载全局变量）
│   ├── config/
│   │   ├── config.js           # 游戏常量
│   │   └── math-utils.js       # 数学工具 + 缓动函数
│   ├── core/
│   │   └── event-bus.js        # 事件总线
│   ├── data/                   # 数据表（JSON 配置）
│   │   ├── equipment.json
│   │   ├── skills.json
│   │   └── enemies.json
│   ├── systems/                # 游戏系统
│   │   ├── loot-system.js
│   │   ├── progression-system.js
│   │   └── quest-system.js
│   ├── world/
│   │   ├── renderer.js
│   │   ├── camera.js
│   │   ├── map-generator.js
│   │   ├── maze-generator.js
│   │   └── wall-system.js
│   ├── entities/
│   │   ├── entity.js
│   │   ├── damageable-entity.js
│   │   ├── player.js
│   │   ├── enemy.js
│   │   ├── target-dummy.js
│   │   └── drop-item.js
│   ├── combat/
│   │   ├── attack.js
│   │   ├── projectile.js
│   │   └── combat-system.js   # 战斗计算（伤害公式、暴击等）
│   ├── effects/
│   │   ├── effect-manager.js
│   │   └── ...                 # 各种特效
│   ├── items/
│   │   ├── item-factory.js
│   │   ├── item-database.js   # 加载 JSON 数据表
│   │   └── weapon-anim-config.js
│   ├── ui/
│   │   ├── input.js
│   │   ├── skill-manager.js
│   │   ├── quick-bar.js
│   │   ├── equip-manager.js
│   │   ├── codex-manager.js
│   │   ├── system-ui.js
│   │   └── sound-manager.js
│   └── game.js                 # 游戏主循环
├── assets/
│   ├── effects/
│   ├── icons/
│   ├── items/
│   └── weapons/
└── styles/
    └── game-style.css
```

---

*文档生成时间：2026-07-05*
*版本：V0.198 怪物渲染模板重构完成版*

---

## 怪物渲染系统（方案B）

### 设计目标
- 新增怪物只需配置 JSON + 实现 4 个钩子方法
- 所有通用渲染逻辑（血条、阴影、名字标签、中毒、受击白光）由基类统一处理
- 子类只关注自身绘制逻辑（精灵图帧动画、自定义形状等）

### 基类通用模板（Enemy.render）

```javascript
render(ctx) {
    const pos = this._getRenderPosition();   // 1. 位置
    const x = pos.x, y = pos.y;
    this.renderHealthBar(ctx);               // 2. 血条
    const textureKey = this._getTextureKey();
    const phaserOptions = this._getPhaserOptions();
    if (this._renderPhaserSync(ctx, x, y, textureKey, phaserOptions)) {
        return;                              // 3. Phaser 同步
    }
    this._drawShadow(ctx, x, y, this.size);  // 4. 阴影
    ctx.save(); ctx.translate(x, y);
    this._drawBody(ctx);                     // 5. 子类绘制
    ctx.restore();
    this._renderNameTag(ctx, x, y);           // 6. 名字
    this.renderCollisionRadius(ctx);       // 7. 碰撞半径
    this._renderPoisonEffect(ctx, x, y);    // 8. 中毒
    this._renderHitFlash(ctx, x, y);        // 9. 受击白光
}
```

### 子类扩展方式

```javascript
class NewMonster extends Enemy {
    constructor(x, y, config) {
        super(x, y, { ...enemyConfigData.newMonster, ...config });
        // 加载精灵图...
    }
    _getTextureKey() { return 'enemy_new_monster'; }
    _getPhaserOptions() { return { spriteSize: 200, frame: 0, textOffsetY: -100 }; }
    _drawBody(ctx) {
        // 精灵图帧动画或自定义绘制
    }
}
```

### 属性配置（enemy-config.json）

```json
{
  "newMonster": {
    "hp": 150, "maxHp": 150, "size": 14, "collisionRadius": 12,
    "speed": 62.4, "level": 5, "color": "#2a2a2a",
    "attackRange": 100, "aiInterval": 300,
    "attack": {
      "type": "thrust", "cooldown": 1000, "range": 100, "width": 25,
      "damageMin": 13, "damageMax": 22, "knockback": 13
    },
    "str": 23, "dex": 30, "con": 23, "int": 6, "wis": 6, "luck": 10
  }
}
```

### 当前怪物系统状态

| 怪物类型 | 数量 | 渲染方式 | 说明 |
|---------|------|---------|------|
| 黑狼（BlackWolf） | 1 | 精灵图帧动画 | 使用基类模板，8帧攻击动画 |
| 战术小队 | 6 | 独立渲染 | 继承自 Enemy，但覆盖完整 render() |

### 未来扩展

新增怪物时，推荐流程：
1. 准备精灵图（spritesheet，2行×4列=8帧移动 + 2行×4列=8帧攻击）
2. 在 `enemy-config.json` 中添加配置
3. 在 `enemy-types.js` 中创建类，实现 4 个钩子方法
4. 在 `BootScene.js` 中加载纹理
5. 在生成逻辑中注册新怪物

*战术小队（humanoid-monster.js）当前独立渲染，后续可改造为使用基类模板*
