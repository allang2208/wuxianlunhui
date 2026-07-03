# 装备专属技能替换系统（Skill Override System）

> 文档版本: 2025-07-08  
> 最后更新: 创建系统修复记录  
> 适用场景: 为特定武器绑定专属冲刺攻击技能变体（如夜与火之剑→冲刺攻击-火）

---

## 1. 设计目标

允许特定武器装备时，将默认的通用技能替换为该武器专属的变体技能：

| 武器 | 默认技能 | 替换为 |
|------|---------|--------|
| 骑士长剑 | 冲刺攻击 | 冲刺攻击-突刺（dashAttackThrust） |
| 夜与火之剑 | 冲刺攻击 | 冲刺攻击-火（dashAttackFire） |

**核心原则**：
- 替换是**被动的** — 装备即生效，无需额外操作
- 经验值**共享** — 所有变体共享同一套等级/经验值（基础 dashAttack）
- 技能栏**自动切换** — 根据当前武器显示对应的技能图标

---

## 2. 实现原理（三层架构）

### 2.1 数据层：武器配置

在 `src/ui/equip-data-manager.js` 中为武器定义 `skillOverrides`：

```javascript
NIGHT_FLAME_SWORD_ITEM: {
    name: '夜与火之剑',
    // ... 其他属性
    skillOverrides: {
        dashAttackFire: true   // 装备时激活 dashAttackFire 替换
    }
}
```

> ⚠️ `skillOverrides` 的值是布尔 `true`，不是字符串。这用于让 `_getActiveDashSkillId()` 检查存在性即可。

### 2.2 逻辑层：Player 技能覆盖系统

```
装备武器 → _applySkillOverrides(item) → this._skillOverrides = { dashAttackFire: true }
                                    → SkillManager.renderSkillGrid() 刷新技能栏
```

**关键方法**（`src/entities/player.js`）：

```javascript
_applySkillOverrides(item) {
    if (!item || !item.skillOverrides) {
        this._clearSkillOverrides();
        return;
    }
    this._skillOverrides = JSON.parse(JSON.stringify(item.skillOverrides));
    console.log(`[SkillOverride] 应用 ${item.name} 的技能覆盖:`, this._skillOverrides);
}

_getActiveDashSkillId() {
    // 第一层：优先使用 _skillOverrides（内存中，响应最快）
    if (this._skillOverrides.dashAttackFire) return 'dashAttackFire';
    if (this._skillOverrides.dashAttackThrust) return 'dashAttackThrust';
    
    // 第二层：回退检查装备物品属性（兼容旧数据/异常场景）
    const currentItem = this.equipments[this.weaponMode];
    if (currentItem && currentItem.skillOverrides) {
        if (currentItem.skillOverrides.dashAttackFire) return 'dashAttackFire';
        if (currentItem.skillOverrides.dashAttackThrust) return 'dashAttackThrust';
    }
    
    return 'dashAttack';
}
```

> 🔑 **关键教训**：必须优先检查 `this._skillOverrides`（内存副本），而不是直接从装备对象读取。装备对象可能通过 JSON 序列化/反序列化后丢失属性。

### 2.3 表现层：UI 自动切换

```
renderSkillGrid() → 检测 player._skillOverrides / currentWeapon.skillOverrides
                → 决定显示 dashAttack / dashAttackThrust / dashAttackFire
                → 经验条同步到基础 dashAttack（共享等级）
```

---

## 3. 技能初始化（JSON + 兜底双保险）

### 3.1 JSON 配置（`data/skills.json`）

```json
{
  "skills": {
    "dashAttackFire": {
      "id": "dashAttackFire",
      "name": "冲刺攻击-火",
      "icon": "🔥",
      "effectFormula": {
        "damageMul": "1.5 + level * 0.05",
        "cooldownReduction": "level * 0.02"
      }
    },
    "dashAttackThrust": {
      "id": "dashAttackThrust",
      "name": "冲刺攻击-突刺",
      "icon": "⚔",
      "effectFormula": {
        "damageMul": "0.80 + level * 0.03",
        "cooldownReduction": "level * 0.02"
      }
    }
  }
}
```

### 3.2 硬编码兜底（`player.js _initSkills()`）

> ⚠️ 重要：JSON 可能被浏览器缓存，导致运行时加载到旧版本。必须在 `_initSkills()` 中兜底：

```javascript
_initSkills() {
    if (typeof window !== 'undefined' && window.SKILL_DATA) {
        const skills = {};
        // 从 JSON 加载 ...
        
        // 兜底：确保专属技能始终存在（即使 JSON 被缓存了旧版本）
        if (!skills.dashAttackFire) {
            skills.dashAttackFire = { /* 硬编码定义 */ };
        }
        if (!skills.dashAttackThrust) {
            skills.dashAttackThrust = { /* 硬编码定义 */ };
        }
        return skills;
    }
    // 兜底：JSON 加载失败时返回完整硬编码技能集
}
```

### 3.3 缓存破坏（`data-loader.js`）

```javascript
async loadJSON(path) {
    const response = await fetch(path + '?t=' + Date.now());  // 添加时间戳
    // ...
}
```

---

## 4. 经验值共享机制

所有冲刺攻击变体共享 `dashAttack` 的等级和经验：

```javascript
// skill-manager.js
addDashExp(player, hitCount, killCount) {
    if (player.skills.dashAttack) {
        SkillLevelSystem.addExp(player, player.skills.dashAttack, hitCount, killCount, 'dashAttack');
    }
}

// UI 显示时同步
if (skill.id === 'dashAttackThrust' && player.skills.dashAttack) {
    displaySkill = player.skills.dashAttack;  // 使用 dashAttack 的等级/经验
}
```

---

## 5. 效果实现（冲刺攻击-火）

### 5.1 火焰轨迹（dash-system.js）

在 `update()` 的 `slash` 阶段每帧生成火焰粒子：

```javascript
// 进入 slash 状态时首次生成
if (this.player._dashState !== 'slash') {
    this.player._dashSlashPos = { x: this.player.x, y: this.player.y };
    if (isFire) {
        this._spawnFireTrail();  // 首次生成
    }
}
this.player._dashState = 'slash';

// 在 slash 状态持续期间持续生成
if (isFire) {
    this._spawnFireTrail();  // 每帧调用，内部有 50ms 冷却
}
```

### 5.2 火焰粒子效果（DashFireTrailEffect）

```javascript
class DashFireTrailEffect extends CanvasEffect {
    constructor(x, y, dirX, dirY, parent) {
        super(x, y, 800);  // 持续800ms
        this.particles = [];
        // 生成10-15个火焰粒子，带有随机扩散和上升动画
    }
    
    update(dt) {
        super.update(dt);
        // 粒子生命周期：3秒内渐隐，带随机漂移
    }
}
```

### 5.3 伤害公式

```javascript
if (isFire) {
    const physAtk = this.player.getCurrentWeaponAtk();
    const magicAtk = this.player.data.matk || 0;
    const fireMul = 1.5 + skillLevel * 0.05;
    damage = Math.floor((physAtk + magicAtk) * fireMul);
}
```

---

## 6. 添加新武器的复用步骤

要为新武器添加专属技能替换，只需三步：

1. **定义技能**（`data/skills.json` + `player.js _initSkills()` 兜底）
2. **武器配置**（`equip-data-manager.js` 添加 `skillOverrides: { newSkillId: true }`）
3. **效果实现**（`dash-system.js` 或新建效果类）

---

## 7. 踩坑记录

| 问题 | 原因 | 解决方案 |
|------|------|---------|
| 装备后技能栏不切换 | `_getActiveDashSkillId()` 直接读装备对象，但装备被JSON反序列化后丢失属性 | 优先检查 `this._skillOverrides`（内存副本） |
| `player.skills.dashAttackFire` 不存在 | `skills.json` 被浏览器缓存，加载到旧版本 | `fetch` 加时间戳 + `_initSkills()` 兜底 |
| 火焰特效不生成 | `_spawnFireTrail()` 只在进入 slash 时调用一次，计时器从未积累到50ms | 在 `update()` 的 slash 阶段每帧调用 |
| 技能栏显示旧图标 | `renderSkillGrid` 未被调用 | 在 `_applySkillOverrides` 后主动调用 `SkillManager.renderSkillGrid()` |

---

## 8. 相关文件路径

| 文件 | 作用 |
|------|------|
| `src/entities/player.js` | `_getActiveDashSkillId()`, `_applySkillOverrides()`, `_initSkills()` |
| `src/ui/equip-data-manager.js` | 武器定义（`skillOverrides`） |
| `data/skills.json` | 技能 JSON 配置 |
| `src/systems/data-loader.js` | JSON 加载（带缓存破坏） |
| `src/ui/skill-manager.js` | 技能栏渲染、经验同步 |
| `src/entities/components/dash-system.js` | 冲刺攻击逻辑、效果触发 |
| `src/effects/dash-effects.js` | 火焰粒子效果（`DashFireTrailEffect`） |
| `src/items/item-factory.js` | 物品创建（确保 `skillOverrides` 被复制） |

---

## 9. 控制台诊断命令

```javascript
// 检查当前激活的冲刺技能
Game.player._getActiveDashSkillId();

// 检查技能覆盖状态
Game.player._skillOverrides;

// 检查当前武器的 skillOverrides
Game.player.equipments[Game.player.weaponMode].skillOverrides;

// 检查 dashAttackFire 是否存在
Game.player.skills.dashAttackFire;

// 手动刷新技能栏
SkillManager.renderSkillGrid();
```
