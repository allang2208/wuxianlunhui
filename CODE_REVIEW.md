# 无限轮回 RPG - 代码审查报告

## 一、严重 Bug（需立即修复）

### 1. 武器系统数据不一致 - 弓 vs G18 双路径问题

**症状**: G18 可以正常切换，弓不行。弓的状态初始化后丢失。

**根因**: 弓和 G18 使用完全不同的状态加载路径：

- 弓: `bowFrames[]` 数组 → 直接创建 Image 数组 → `equippedBowFrames`
- G18: `weaponAsset` 对象 → `loadWeaponAssets()` → `equippedRangedType = 'pistol'`

**代码位置**: `EquipManager.init()` 第1762行 vs `handleDrop()` 第1933行

**修复状态**: 已添加自动修复机制在 `switchWeaponMode()` 中（第1049行），但**治标不治本**。

**建议修复**: 统一所有武器为 `weaponType` + `weaponAsset` 方案，移除 `bowFrames` 的特判路径。

---

### 2. `Object.assign` 浅拷贝导致装备数据共享

**代码**: 第1758行 `Object.assign(player.equipments, this.TEST_EQUIPMENTS)`

**问题**: 浅拷贝使得 `player.equipments.weapon2` 和 `TEST_EQUIPMENTS.weapon2` 指向同一对象。后续任何对 `TEST_EQUIPMENTS` 的修改都会影响所有玩家。

**修复**: 使用深拷贝：
```javascript
player.equipments = JSON.parse(JSON.stringify(this.TEST_EQUIPMENTS));
```

---

### 3. `loadWeaponAssets()` 弓图片路径缺少 `assets/weapons/` 前缀

**代码**: 第1085行
```javascript
const img = new Image(); img.src = wa.framePrefix + num + '.png';
```

弓的 `framePrefix` 是 `'assets/weapons/bow_frame_'`，这看起来正确。但需要确认实际的图片文件位置。

---

### 4. `_getAnimMs` 已修复但仍有隐患

**代码**: 第1112行

**状态**: 已修复 - 现在根据 `weaponMode` 选择配置。

**潜在问题**: `WeaponAnimConfig.pistol.timingMul = 0.06` 导致 G18 动画极快，如果 `weaponMode` 判断失误，近战动画也会受影响。

---

### 5. 调试日志未清理

**代码**: 第1049行、1074行、1080行等多处

**问题**: `console.log` 在生产环境输出调试信息，影响性能。

---

## 二、架构问题

### 6. 单文件 2807 行 - 严重违反模块化原则

**问题**: 整个游戏逻辑在一个 `legacy.js` 文件中，包含：
- 配置系统
- 数学工具
- 渲染器
- 相机系统
- 地图生成器
- 迷宫生成器
- 墙壁碰撞系统
- 事件总线
- 输入管理器
- 效果管理器 + 12个效果类
- 3个攻击类
- 玩家类（350+行）
- 敌人类
- 目标假人类
- 掉落物品类
- 物品工厂
- 装备管理器（400+行）
- UI系统
- 快速栏
- 游戏主循环

**建议**: 按之前迁移的模块化架构拆分，已通过 Vite + ES6 modules 支持。

---

### 7. 全局命名空间污染

**问题**: 所有对象都在全局作用域（`const CONFIG`, `const Game`, `const Player` 等），存在命名冲突风险。

---

### 8. 循环依赖（部分已修复）

**已修复**: Player → Game 通过 EventBus 解耦。

**仍存在的问题**:
- `WallSystem` 被 Player、Enemy、Projectile 直接引用
- `EffectManager` 被几乎所有类引用
- `CONFIG` 被所有类引用

---

### 9. Player 类 God Object（350+行）

**问题**: Player 类包含：
- 移动/冲刺/闪避逻辑
- 3种武器攻击逻辑
- 武器动画系统
- 武器渲染系统
- 属性计算
- 碰撞检测

**建议**: 拆分为 `PlayerMovement`, `PlayerCombat`, `PlayerAnimator` 等子系统。

---

## 三、性能问题

### 10. 每帧创建大量临时对象

**代码**: 第980行 `EffectManager._acquire('DustEffect')` 未命中时创建新对象。

**问题**: 移动时每秒创建多个 `DustEffect` 和 `BloodEffect` 实例，即使使用了对象池，频繁 GC 仍会影响帧率。

**建议**: 使用预分配的粒子池，而非每次创建新对象。

---

### 11. UI 更新每帧执行 DOM 操作

**代码**: 第2732行 `updateUI()`

**问题**: 每帧更新 HP/MP/体力条宽度、文字内容，触发重排重绘。

**建议**: 使用脏标记，只在数值变化时更新 UI。

---

### 12. `updateEquipSlots` 重复绑定事件

**代码**: 每次调用都会 `document.querySelectorAll('.diablo-slot').forEach(... this.bindDragToCell(slot))`

**问题**: 每次更新装备栏都会重新绑定所有 drag 事件，导致事件堆积。

---

### 13. 迷宫墙壁去重算法 O(n²)

**代码**: 第196行 `dedup(walls)`

**问题**: 双重循环比较所有墙壁，迷宫越大性能越差。

---

## 四、潜在 Bug

### 14. `dt` 未限制最大帧间隔

**代码**: 第2715行 `const dt = timestamp - this.lastTime`

**问题**: 标签页切换回来后 `dt` 可能达到几千毫秒，导致一次更新大量逻辑。

**修复**: 
```javascript
const dt = Math.min(timestamp - this.lastTime, 100); // 最大100ms
```

---

### 15. 存档系统不完整

**代码**: 第2785行 `load()` 和 第2790行 `save()`

**问题**: 
- 只保存玩家数据，不保存：装备状态、背包内容、敌人状态、掉落物品
- 使用 `JSON.stringify` 会丢失 Image 对象和方法
- 没有版本兼容处理

---

### 16. `tryPickupItem` 遍历所有实体

**代码**: 第2688行

**问题**: 每次拾取检查遍历 `this.entities` 中所有实体，O(n) 复杂度。

---

### 17. 武器切换按钮事件重复绑定

**代码**: 第2801行 `setupWeaponSwitchButtons()`

**问题**: 每次 `Game.start()` 都调用，返回主菜单再开始会导致事件重复绑定。

---

### 18. 玩家死亡无处理

**问题**: `player.data.hp <= 0` 时没有任何死亡逻辑（Game Over、重生等）。

---

### 19. 敌人 `onDeath` 中硬编码掉落 G18

**代码**: Enemy.onDeath 总是掉落 `G18_PISTOL_ITEM`，不会根据敌人类型掉落不同物品。

---

### 20. 输入系统 `leftPressed` 每帧重置

**代码**: 第1108行 `this.mouse.leftPressed = false`

**问题**: 快速点击可能错过（在 update 和 render 之间被重置）。

---

## 五、优化建议

### 21. 状态管理重构建议

**当前问题**: 武器状态分散在多个变量中：
- `weaponMode` ('melee' | 'ranged')
- `equippedRangedType` (null | 'bow' | 'pistol')
- `equippedBowFrames` (Image[] | null)
- `hasMeleeWeapon` (boolean)

**建议**: 统一为状态机：
```javascript
const WeaponState = {
    mode: 'melee',      // 'melee' | 'ranged'
    rangedType: null,   // null | 'bow' | 'pistol'
    assets: {           // 当前武器资源
        frames: null,   // Image[] for bow
        image: null,    // Image for pistol
        icon: '⚔'      // display icon
    }
};
```

---

### 22. 动画系统重构建议

**当前**: `_getAnimMs` 根据武器类型动态计算动画时长，导致武器间互相影响。

**建议**: 每个武器实例持有自己的动画配置，而非全局查找：
```javascript
class Weapon {
    constructor(config) {
        this.cooldown = config.cooldown;
        this.animConfig = config.animConfig; // { windupMs, swingMs, recoverMs, timingMul }
    }
}
```

---

### 23. 添加武器基类

**当前**: 弓用 `bowFrames[]`，G18 用 `rangedType`，代码路径分叉。

**建议**: 统一武器基类：
```javascript
class Weapon {
    name, type, icon, equipSlot, stats, desc
    getIconImage() {}  // 为UI提供图片
    getAttackAnim() {}  // 为战斗提供动画
}

class BowWeapon extends Weapon {
    frames = []         // 8帧弓动画
    projectileSpeed, range
}

class PistolWeapon extends Weapon {
    image              // 手枪贴图
    fireRate, muzzleFlash
}
```

---

### 24. 代码质量改进清单

| # | 改进项 | 优先级 |
|---|--------|--------|
| 1 | 清理所有 `console.log` | 高 |
| 2 | 拆分 `legacy.js` 为模块 | 高 |
| 3 | 使用 `const/let` 统一规范 | 中 |
| 4 | 添加 JSDoc 类型注释 | 中 |
| 5 | 统一错误处理（try-catch） | 中 |
| 6 | 添加单元测试 | 低 |
| 7 | 使用 TypeScript 类型检查 | 低 |

---

## 六、安全审查

### 25. `innerHTML` 使用用户数据

**代码**: 第2078行
```javascript
iconEl.innerHTML = `<img src="${item.iconImage}" ...>`;
```

**风险**: `item.iconImage` 如果来自用户输入，存在 XSS 风险。

**修复**: 使用 `document.createElement('img')` 替代 `innerHTML`。

---

### 26. `JSON.parse` 存档无验证

**代码**: 第2787行 `JSON.parse(save)`

**风险**: 存档数据损坏时会抛出异常。

---

## 七、总结

### 已修复问题
1. ✅ 击退穿墙 - 已添加 WallSystem 碰撞
2. ✅ 丢弃武器不同步 - 已添加 `_clearWeaponState`
3. ✅ G18 动画影响近战 - 已修复 `_getAnimMs`
4. ✅ F 键切换弓失效 - 已添加自动修复机制
5. ✅ MathUtils 缺失 - 已补充
6. ✅ 迷宫入口封死 - 已修复边界生成

### 仍需修复（按优先级）

| 优先级 | 问题 | 影响 |
|--------|------|------|
| 🔴 高 | 清理调试日志 | 生产环境性能 |
| 🔴 高 | 统一弓/G18 武器加载路径 | 维护性 |
| 🔴 高 | `Object.assign` 浅拷贝 | 数据完整性 |
| 🟠 中 | 拆分 2807 行文件 | 可维护性 |
| 🟠 中 | 限制 dt 最大帧间隔 | 稳定性 |
| 🟠 中 | UI 脏标记优化 | 性能 |
| 🟡 低 | 存档系统完整实现 | 功能 |
| 🟡 低 | TypeScript 迁移 | 质量 |
