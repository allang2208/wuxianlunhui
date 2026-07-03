# 武器技能代码全面排查报告

## 表格一：硬编码影响强化/改造/附魔的地方

| 序号 | 文件 | 位置 | 硬编码内容 | 影响 | 建议 |
|------|------|------|------------|------|------|
| 1 | `player.js` | 250-350 | 按 `weaponId`（weapon2/weapon4/weapon5）硬编码不同攻击力公式 | **影响强化**：新武器无法自动套用公式；强化等级 `el` 系数分散在各分支中 | 将公式抽象为 `weapon.attackFormula` 配置，从 `EquipDataManager` 读取 |
| 2 | `player.js` | 949-1260 | 按 `weaponType`（pkm/akm/qbz191/qjb201/energy_lmg/shotgun）大量条件分支处理过热、换弹、攻击动画 | **影响改造**：新武器类型需新增代码分支；改造属性无法自动应用 | 使用 `weaponType` 配置表 + 通用属性覆盖系统，而非条件分支 |
| 3 | `enhance-system.js` | 195-200 | 按 `weaponId` 硬编码 `baseMin`/`baseMax`（weapon2=10, weapon4=8, weapon5=12） | **影响强化**：新武器无基础值；强化公式无法统一调整 | 从 `EquipDataManager` 的 `stats` 字段读取基础值 |
| 4 | `equip-tooltip-manager.js` | 354-355 | 按 `weaponId` 硬编码特殊攻击名称/图标（weapon5=夜与火，weapon4=符文，weapon2=骑士） | **影响所有新武器**：无特殊攻击信息展示 | 从 `skillOverrides` 或武器配置的 `specialAttack` 字段读取 |
| 5 | `attack.js` | 52-70 | 按 `weaponId === 'weapon4'` 硬编码符文长剑伤害公式（30+dex*1+wis*2） | **影响改造/附魔**：改造后的武器属性变化无法自动反映到伤害公式 | 将符文长剑公式移入 `EquipDataManager` 配置 |
| 6 | `dash-system.js` | 131 | 按 `weaponId === 'weapon4'` 判断突刺范围+50 | **影响改造**：范围改造与硬编码叠加可能冲突 | 使用 `skillOverrides` 中的 `hitCheck.length` 作为唯一来源 |
| 7 | `player.js` | 2763-3420 | `renderWeapon` 中按 `weaponType`（pistol/bow/shotgun/pkmOrAkm/melee）大量硬编码渲染偏移、缩放、动画参数 | **影响改造**：视觉偏移改造无法生效 | 将所有 `WeaponAnimConfig` 配置统一化，移除 `renderWeapon` 中的硬编码偏移 |
| 8 | `craft-system.js` | 1000-1100 | 按 `weaponId` 硬编码改造效果（如骑士长剑流血效果） | **影响改造**：新武器无法自动支持改造；改造效果与武器绑定死 | 改为按 `weaponType` + `craftType` 的通用改造系统 |
| 9 | `scene-manager.js` | 293-621 | 多处按 `weaponId === 'weapon4'/'weapon5'` 判断切换武器时的特殊处理 | **影响新武器**：新增特殊武器需改多处 | 使用 `weaponType` 或 `hasSpecialAttack` 标志统一处理 |
| 10 | `player.js` | 160 | 能量轻机枪参数硬编码，注释说明"实际从武器配置读取"但代码未实现 | **影响改造/强化**：能量轻机枪的过热/冷却参数无法通过改造调整 | 完成从 `weapon.params` 读取的实现 |
| 11 | `attack.js` | 264-265 | `piercingBonus` 硬编码在 `attack.js` 中累加，同时 `projectile.js` 也处理 `piercingBonus` | **影响附魔**：附魔穿透可能重复计算 | 统一 `getEffectivePiercing()` 调用，确保所有武器类型使用同一函数 |
| 12 | `player.js` | 630-720 | 技能系统中硬编码所有武器类型（剑/手枪/机枪/步枪/散弹/弓）的 `skillOverrides` 和 `getEffect` | **影响新武器**：新增武器类型需手动添加技能配置 | 使用 `weaponType` 配置表自动生成技能映射 |

---

## 表格二：可继续硬编码 vs 必须转变

### 可继续硬编码（视觉/体验常量）

| 类别 | 示例 | 理由 |
|------|------|------|
| 视觉特效参数 | 特效颜色 `#ffd700`、粒子数量 `24`、持续时间 `1600ms` | 这些是美术表现，不影响游戏平衡，可随时调整 |
| 动画时间常量 | 风车动画 `1500ms`、冲刺突刺 `600ms` | 动画时长属于设计决策，不需要动态配置 |
| UI 布局常量 | 按钮大小 `74px`、间距 `25px`、字体大小 `20px` | 视觉布局固定，不影响游戏逻辑 |
| 基础物理常量 | 玩家碰撞半径 `12px`、最大移动速度 `5px/帧` | 角色基础属性，不需要每武器配置 |
| 音效文件路径 | `assets/sounds/wood_thud_1s.wav` | 资源映射，可按类型分组管理 |
| 状态效果参数 | 眩晕时间 `2000ms`、中毒间隔 `1000ms` | 属于全局平衡参数，可集中管理 |

### 必须转变（影响可扩展性/平衡性）

| 类别 | 当前问题 | 转变目标 | 优先级 |
|------|----------|----------|--------|
| **武器攻击力公式** | 按 `weaponId` 分散在 `player.js` 中 | 从 `EquipDataManager` 的 `attackFormula` 字段读取，支持 `el`、`str`、`dex` 等变量 | 🔴 高 |
| **强化基础值** | 按 `weaponId` 硬编码 `baseMin`/`baseMax` | 从 `EquipDataManager` 的 `stats` 字段自动计算 | 🔴 高 |
| **特殊攻击触发逻辑** | 按 `weaponId` 判断（weapon2/weapon4/weapon5） | 使用 `weapon.skillOverrides` 或 `weaponType` 的通用 `specialAttack` 系统 | 🔴 高 |
| **改造效果** | 按 `weaponId` 硬编码在 `craft-system.js` | 按 `weaponType` + `craftType` 的通用改造效果表 | 🟡 中 |
| **武器渲染参数** | `renderWeapon` 中大量 `weaponType` 分支 | 所有武器渲染参数从 `WeaponAnimConfig[weaponType]` 读取，移除代码分支 | 🟡 中 |
| **过热/换弹逻辑** | 按 `weaponType` 硬编码不同参数 | 从 `weapon.heatParams` / `weapon.reloadParams` 读取 | 🟡 中 |
| **伤害判定形状** | 按 `weaponId` 硬编码（如 `isRuneSword`） | 从 `weapon.hitCheck` 配置读取（shape/width/length/arc） | 🟡 中 |

---

## 表格三：代码错误和冲突

| 序号 | 文件 | 位置 | 问题描述 | 严重程度 | 建议修复 |
|------|------|------|----------|----------|----------|
| 1 | `dash-system.js` | 131 | `weaponId === 'weapon4'` 用于突刺范围+50，但 `weapon4` 是**符文长剑**，`weapon2` 才是骑士长剑。骑士长剑的冲刺攻击错误地检查了符文长剑的 ID | 🔴 **高** | 改为 `weaponId === 'weapon2'` 或从 `skillOverrides` 读取范围加成 |
| 2 | `attack.js` | 52-70 | `isRuneSword = weaponId === 'weapon4'` 用于伤害公式，但 `weapon4` 符文长剑的伤害公式中 `30+dex*1+wis*2` 与 `player.js` 中 `weaponAtk = Math.round(30 + d.dex * 1 + d.wis * 2)` 重复定义 | 🔴 **高** | 删除 `attack.js` 中的硬编码公式，统一从 `player.js` 的 `getCurrentWeaponAtk()` 获取 |
| 3 | `player.js` | 1581-1593 | 特殊攻击系统冲突：`NightFlame`（weapon5）和 `RuneSword`（weapon4）共用 `_specialAttackActive` 标志，但互斥检查逻辑可能遗漏边界情况 | 🟡 中 | 统一为 `activeSpecialAttack` 枚举（'nightflame'/'runesword'/'none'），避免布尔标志冲突 |
| 4 | `player.js` | 2785 | `weaponId === 'weapon4'` 粒子效果只在 `weaponAnim.state === 'idle'` 时渲染，但符文长剑待机时可能实际处于攻击状态（`idle` 与 `attack` 状态混淆） | 🟡 中 | 使用 `!isAttacking` 或 `isSpecialAnim` 判断，而非 `state === 'idle'` |
| 5 | `dash-system.js` | 54 | `timer / totalMs * 2` 速度翻倍硬编码，但 `skillOverrides` 中 `dashAttackThrust.animation.totalMs` 已配置为 600，两者不一致 | 🟡 中 | 统一使用 `skillOverrides` 中的 `totalMs` 作为动画总时长，移除硬编码 `* 2` |
| 6 | `projectile.js` + `attack.js` | 264-265, 37 | `piercingBonus` 在 `attack.js` 和 `projectile.js` 中分别处理，可能导致远程武器附魔穿透重复计算 | 🟡 中 | `projectile.js` 已使用 `getEffectivePiercing()`，但 `attack.js` 中 SlashAttack 仍单独处理 `piercingBonus`，需统一 |
| 7 | `player.js` | 1225-1239 | 能量轻机枪过热参数硬编码，但注释说"从武器配置读取"，实际未实现。`qjb201` 和 `energy_lmg` 的过热参数可能混淆 | 🟡 中 | 完成从 `weapon.heatParams` 读取的实现，移除 `qjb201` vs `energy_lmg` 的硬编码区分 |
| 8 | `craft-system.js` | 690 | `weaponId` 映射表硬编码（`'weapon1': 'rusty_sword'`），新增武器时易遗漏 | 🟢 低 | 使用 `EquipDataManager` 中已有的 `weaponId` → `weaponType` 映射自动生成 |
| 9 | `player.js` | 110-117 | 武器图片预加载硬编码（`this.akmImage`、`this.pkmImage` 等），新增武器类型需新增字段 | 🟢 低 | 使用 `weaponImageCache` 字典，按 `weaponId` 动态缓存图片 |
| 10 | `dash-system.js` | 120-124 | `effectX = player.x - 50`, `effectY = player.y - 20` 特效偏移硬编码，不与武器实际位置同步（已修复为动态计算） | 🟢 低 | 已修复 ✅（本次修改） |

---

## 总结

**最紧急修复（建议立即处理）：**
1. `dash-system.js:131` 的 `weaponId === 'weapon4'` 应改为 `weaponId === 'weapon2'`（骑士长剑）
2. `attack.js` 中 `isRuneSword` 的硬编码伤害公式与 `player.js` 重复，应删除
3. `player.js` 武器攻击力公式应从 `EquipDataManager` 配置读取，而非按 `weaponId` 硬编码

**最影响扩展性：**
- `player.js` 的 `renderWeapon` 有 300+ 行按 `weaponType` 硬编码的渲染逻辑
- `enhance-system.js` 按 `weaponId` 硬编码强化基础值
- `craft-system.js` 按 `weaponId` 硬编码改造效果
