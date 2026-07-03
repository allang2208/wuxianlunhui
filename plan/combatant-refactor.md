# Combatant 基类重构方案（方案A）

## 目标
将 `player.js` 中的武器/弹药/散布/过热系统抽象为通用 `Combatant` 基类，Player 和 Enemy 都继承它，实现武器、弹药、散布、过热的完全通用化。

## 架构设计

```
DamageableEntity
    └── Combatant（新增基类）
            ├── data（str/dex/int/con/wis/luck/stamina/hp/...）
            ├── attacks（melee/ranged/...）
            ├── equipments（weapon/offhand，武器对象）
            ├── weaponMode（当前武器槽位）
            ├── weaponAnim（武器动画状态机）
            ├── _ammoState（弹药状态：current/max/reloading/...）
            ├── _gunSpreadTimer / _gunSpreadWeapon（散布计时器）
            ├── _overheatValue / _overheatOverheated（过热系统）
            ├── getCurrentWeapon() → 返回当前武器对象
            ├── getWeaponImage() → 返回武器贴图 Image
            ├── canFire(slot) → 检查弹药/冷却/过热/体力
            ├── consumeAmmo(slot) → 扣弹药（怪物可覆盖为不扣）
            ├── startReload(slot) → 开始换弹
            ├── computeSpread(slot) → 计算散布角度
            ├── fireProjectile(targetX, targetY, entities, config) → 通用发射弹丸
            ├── renderWeapon(ctx) → 基础武器渲染（子类覆盖）
            ├── calculateCombatStats() → 计算攻防属性（基于装备+技能）
            └── getStamina() / consumeStamina() → 体力系统
        ├── Player（继承 Combatant，添加 Input/Skills/Systems）
        └── Enemy（继承 Combatant，添加 AI/FSM）
            └── HumanoidMonster（继承 Enemy，配置武器）
```

## 接口契约

### Combatant 核心接口

```javascript
class Combatant extends DamageableEntity {
    // 属性
    data = { str, dex, int, con, wis, luck, stamina, maxStamina, hp, maxHp, ... }
    attacks = {}
    equipments = { weapon: null, offhand: null, weapon2: null, ring2: null }
    weaponMode = 'weapon'
    weaponAnim = { state: 'idle', timer: 0, angle: 0, nextSpin: 0 }
    _ammoState = { weapon: null, offhand: null, weapon2: null, ring2: null }
    _gunSpreadTimer = 0
    _gunSpreadTimerOff = 0
    _gunSpreadWeapon = null
    _gunSpreadWeaponOff = null
    _overheatValue = 0
    _overheatOverheated = false
    _overheatWeaponType = null
    
    // 方法
    getCurrentWeapon() → { weaponType, equipImage, ... } | null
    getCurrentSlot() → 'weapon' | 'weapon2' | 'offhand' | 'ring2'
    getWeaponImage() → Image | null
    canFire(slot) → boolean  // 检查弹药/冷却/过热/体力
    consumeAmmo(slot, amount = 1) → boolean
    startReload(slot) → void
    isReloading(slot) → boolean
    interruptReload(slot) → void
    computeSpread(slot) → { factor, maxAngle }
    resetSpread(slot) → void
    fireProjectile(targetX, targetY, entities, config) → void
    getStamina() → number
    consumeStamina(amount) → boolean
    calculateCombatStats() → void
    renderWeapon(ctx) → void  // 基础渲染，Player/Enemy覆盖
}
```

## 阶段规划

### Phase 1：新建 Combatant 基类
**文件**：`src/entities/combatant.js`（新建）
**内容**：
- 继承 `DamageableEntity`
- 通用 `data` 对象（从 Enemy 提取）
- `equipments` / `weaponMode` / `weaponAnim`（从 Player 提取）
- 弹药系统：`_ammoState` + `_initAmmoForSlot` + `_hasAmmo` + `_isReloading` + `_startReload` + `_interruptReload` + `_getAmmoState`（从 Player 提取并简化）
- 散布系统：`_gunSpreadTimer`×2 + `_gunSpreadWeapon`×2 + `computeSpread` + `resetSpread`
- 过热系统：`_overheatValue` + `_overheatOverheated` + `_overheatWeaponType` + 更新逻辑
- `getCurrentWeapon()` / `getWeaponImage()` / `getCurrentSlot()`
- `canFire(slot)`：检查弹药+冷却+过热+体力
- `consumeAmmo(slot)`：扣弹药（默认 true，子类可覆盖）
- `fireProjectile(targetX, targetY, entities, config)`：通用发射弹丸方法
- `getStamina()` / `consumeStamina()`：体力系统（默认 stamina=9999，不消耗）
- `calculateCombatStats()`：计算攻防属性（从 Enemy 和 Player 提取通用部分）
- `renderWeapon(ctx)`：基础武器渲染（简单贴图+旋转）

**接口契约**：所有方法必须支持 Player 和 Enemy 两种场景

### Phase 2：Player.js 迁移到 Combatant 继承
**文件**：`src/entities/player.js`
**内容**：
- 将 `class Player extends Entity` 改为 `class Player extends Combatant`
- 删除已迁移到 Combatant 的字段：`data`（部分）、`equipments`、`weaponMode`、`weaponAnim`、`_ammoState`、散布字段、过热字段
- 保留 Player 专属：`Input` 处理、`skills`、`DashSystem`/`WhirlwindSystem`/`DroneSystem`/`ShieldSystem` 等子系统
- 保留 `renderWeapon()` 的覆盖版本（复杂渲染）
- 保留 `calculateCombatStats()` 的覆盖版本（技能加成）
- 弹药/散布/过热逻辑中调用 `super` 方法

### Phase 3：Enemy.js 继承 Combatant
**文件**：`src/entities/enemy.js`
**内容**：
- 将 `class Enemy extends DamageableEntity` 改为 `class Enemy extends Combatant`
- 删除已迁移的：`data`（部分）、`attacks` 的默认创建、`weaponAnim` 的默认创建
- 保留 Enemy 专属：`AI` 逻辑、`_updateAttack`、`_updateMovement`、`FSM`、寻路、中毒/流血
- `equipments` 默认只有 `{ weapon: null }`（单槽位）
- 覆盖 `consumeAmmo()` → 不扣弹药（怪物无限弹药）或按配置扣
- 覆盖 `getStamina()` → 返回 9999
- 覆盖 `renderWeapon()` → 简单渲染（武器贴图+旋转）
- `_updateAttack` 调用 `Combatant.canFire()` + `Combatant.fireProjectile()`

### Phase 4：attack.js + projectile.js 通用化
**文件**：`src/combat/attack.js`、`src/combat/projectile.js`
**内容**：
- `SlashAttack.execute()`：`source.equipments[source.weaponMode]` → `source.getCurrentWeapon()`
- `ThrustAttack.execute()`：同上
- `RangedAttack.execute()`：调用 `source.fireProjectile()` 替代直接创建 Projectile
- `projectile.js`：命中时 `source.equipments[source.weaponMode]` → `source.getCurrentWeapon()`
- 附魔效果 `applyEnchantOnHit` 使用 `source.getCurrentWeapon()` 获取武器
- 体力检查：`source.data.stamina` → `source.getStamina()` / `source.consumeStamina()`

### Phase 5：humanoid-monster.js 使用真实武器系统
**文件**：`src/entities/humanoid-monster.js`
**内容**：
- 每个子类设置 `this.equipments = { weapon: { weaponType: 'qjb201', equipImage: '...', ... } }`
- 调用 `Combatant._initAmmoForSlot('weapon')` 初始化弹药
- 覆盖 `renderWeapon()` 绘制真实武器贴图（带旋转和方向）
- 删除 `_setupWeaponAttack()` 的硬编码，改用 `Combatant` 的攻击配置
- 指挥官的无人机：使用 `Combatant` 接口发射无人机
- 盾卫的防御：使用 `Combatant` 的 `shieldSystem`（如果可行）或保持简化版

### Phase 6：验证修复
**内容**：
- 检查所有文件导入/导出
- 检查 `main.js` 挂载
- 验证语法（`node --check`）
- 场景五测试：战术小队显示武器、有弹药限制、有散布、能发射弹丸

## 文件传播路径

```
Phase 1 → combatant.js（新建）
    ↓
Phase 2 → player.js（修改：继承 Combatant，删除迁移字段）
Phase 3 → enemy.js（修改：继承 Combatant，添加弹药/散布）
    ↓
Phase 4 → attack.js + projectile.js（修改：通用化接口）
    ↓
Phase 5 → humanoid-monster.js（修改：使用真实武器系统）
    ↓
Phase 6 → 验证 + main.js 更新
```

## 关键注意事项

1. **向后兼容**：Player 的所有现有行为必须保持不变
2. **Enemy 默认**：弹药无限、体力无限、散布和过热默认不生效（除非子类覆盖）
3. **武器贴图**：Combatant 的 `renderWeapon()` 提供基础版本，Player 和 Enemy 分别覆盖
4. **阵营判断**：`attack.js` 中的 `source._faction === 'enemy'` 判断保留，确保怪物不攻击怪物
5. **经验系统**：Player 攻击获取经验保留在 Player 覆盖的方法中

## 预估工作量

| Phase | 文件 | 预估行数 | 难度 |
|-------|------|----------|------|
| 1 | combatant.js（新建） | 250-350 | 中 |
| 2 | player.js | 200-400 | 高 |
| 3 | enemy.js | 100-150 | 中 |
| 4 | attack.js + projectile.js | 50-80 | 低 |
| 5 | humanoid-monster.js | 100-150 | 中 |
| 6 | 验证 | - | 中 |
| **总计** | **7个文件** | **700-1100** | **高** |
