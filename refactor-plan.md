# 硬编码改造计划

## 阶段一：武器攻击力公式（🔴 最高优先级）

**目标**：将 `player.js` 中 `getCurrentWeaponAtk()` 的按 `weaponId` 硬编码公式，迁移到 `EquipDataManager` 的通用配置。

**当前问题**：
- `player.js:252-327` 有 16 个 `weaponId` 条件分支，每个分支包含不同的攻击力公式
- 新增武器需要修改 `player.js`
- 强化等级系数分散在各分支中

**改造方案**：
1. 在 `EquipDataManager` 中每个武器定义添加 `attackFormula` 字段
2. `attackFormula` 包含：基础值、属性系数、强化系数、改造系数
3. `player.js` 中统一使用 `attackFormula` 计算，不再按 `weaponId` 分支

**验证**：
- 确保所有现有武器的攻击力与改造前一致
- 确保强化、附魔、改造效果仍正常叠加

---

## 阶段二：强化基础值（🔴 高优先级）

**目标**：将 `enhance-system.js` 中按 `weaponId` 硬编码的 `baseMin`/`baseMax`，迁移到 `EquipDataManager` 配置。

**当前问题**：
- `enhance-system.js:194-208` 硬编码了 12 个武器的强化基础值
- 新增武器没有默认值，强化显示可能错误

**改造方案**：
1. 在 `EquipDataManager` 中每个武器定义添加 `enhanceBase` 字段（包含 min/max）
2. `enhance-system.js` 直接从 `item.enhanceBase` 读取

---

## 阶段三：伤害判定形状（🟡 中优先级）

**目标**：将 `attack.js` 中按 `weaponId` 判断的 hitCheck，改为从武器配置读取。

**当前问题**：
- `attack.js:52-70` 中 `isRuneSword` 硬编码了范围加成
- `attack.js:120-123` 中 `isRuneSword` 再次硬编码范围
- `dash-system.js:131` 中 `isWeapon2` 硬编码了突刺范围加成

**改造方案**：
1. 已在 `EquipDataManager` 中添加了 `attack.rangeBonus`（已完成）
2. 清理 `attack.js` 中剩余的硬编码范围判断

---

## 阶段四：武器渲染参数（🟡 中优先级）

**目标**：将 `player.js` 中 `renderWeapon()` 的按 `weaponType` 硬编码的渲染偏移，改为从 `WeaponAnimConfig` 读取。

**当前问题**：
- `player.js:2763-3420` 有 300+ 行按 `weaponType` 分支的渲染代码
- 每种武器类型的偏移、旋转、缩放、动画参数都硬编码在代码中

**改造方案**：
1. 扩展 `WeaponAnimConfig` 为每种武器类型添加完整的渲染参数
2. `renderWeapon()` 中统一从配置读取参数，减少分支代码

---

## 阶段五：过热/换弹逻辑（🟡 中优先级）

**目标**：将按 `weaponType` 硬编码的过热/换弹参数，改为从 `weapon.heatParams` / `weapon.reloadParams` 读取。

**当前问题**：
- `player.js:1216-1267` 中按 `pkm`/`qjb201`/`energy_lmg` 分支处理过热参数
- 已在 `EquipDataManager` 中添加了 `heatParams`（已完成）
- 需要清理 `player.js` 中剩余的硬编码

**改造方案**：
1. 已在 `EquipDataManager` 中添加了 `heatParams`（PKM/QJB-201）
2. 统一 `player.js` 中从 `weapon.heatParams` 读取，保留 `energy_lmg` 的 `elp` 回退逻辑

---

## 阶段六：改造效果（🟡 中优先级）

**目标**：将 `craft-system.js` 中按 `weaponId` 硬编码的改造效果，改为按 `weaponType` + `craftType` 的通用系统。

**当前问题**：
- `craft-system.js:1000-1100` 中按 `weaponId` 硬编码改造效果
- 新增武器类型需要新增改造分支

**改造方案**：
1. 在 `EquipDataManager` 中定义 `craftEffects` 模板（按 `weaponType`）
2. `craft-system.js` 按 `weaponType` 和 `craftType` 通用处理

---

## 执行顺序

1. **阶段一**：攻击力公式（影响面最大，所有武器伤害）
2. **阶段二**：强化基础值（配合阶段一，影响强化显示）
3. **阶段三**：伤害判定形状（影响范围，已完成大部分）
4. **阶段五**：过热/换弹逻辑（已完成大部分，需清理）
5. **阶段四**：武器渲染参数（纯视觉，影响面较小）
6. **阶段六**：改造效果（与系统整体相关）
