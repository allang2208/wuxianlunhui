# 游戏项目坐标系全面排查报告

> 排查范围：`src/ui/dev-tool.js`、`src/entities/player.js`、`src/phaser/scenes/GameScene.js`、`src/combat/weapon-transform.js`、`src/items/weapon-anim-config.js`、`COORDINATE_SYSTEM.md`

---

## 一、严重问题（需立即修复）

### 问题 1：WeaponTransform 主手计算缺少 mainBaseX 偏移

| 项目 | 内容 |
|------|------|
| **文件** | `src/combat/weapon-transform.js` |
| **行号** | 28–34 |
| **问题描述** | `getMeleeLocalOffset(false)` 返回 `x = swordCfg.holdOffsetX + ms * 0.85 = -26 + 59.06 = 33.06`，但在 `player.js` 的 Canvas 渲染中，实际变换链包含了 `mainBaseX = -7` 的偏移，因此正确的局部 X 应为 `mainBaseX + holdOffsetX + ms * 0.85 = -7 + (-26) + 59.06 = 26.06`。两者相差 **7 像素**。 |
| **影响** | Phaser 渲染层（`GameScene.js` 的 `syncWeapon`）调用 `WeaponTransform.getMeleeWorldPosition()` 时，主手近战武器位置与 Canvas 渲染不一致，导致双端显示错位。 |
| **修复建议** | 将 `mainBaseX` 和 `mainBaseY` 纳入 `WeaponTransform` 计算： |

```javascript
// weapon-transform.js 修正
static getMeleeLocalOffset(isOffhand = false) {
    const ms = WEAPON_SIZE_BASE * MELEE_SCALE;
    const swordCfg = WeaponAnimConfig.sword;
    if (isOffhand) {
        const offBaseX = -5;
        const offBaseY = -16.5;
        return {
            x: offBaseX + ms * 0.85,  // 正确：副手已验证
            y: offBaseY,
            size: ms,
            scale: swordCfg.idleScale || 1
        };
    }
    // 主手：必须包含 mainBaseX = -7, mainBaseY = 0
    const mainBaseX = -7, mainBaseY = 0;
    return {
        x: mainBaseX + swordCfg.holdOffsetX + ms * 0.85,
        y: mainBaseY + swordCfg.holdOffsetY,
        size: ms,
        scale: swordCfg.idleScale || 1
    };
}
```

---

### 问题 2：GameScene.js 中 pistol 的 Phaser 位置与 Canvas 不一致

| 项目 | 内容 |
|------|------|
| **文件** | `src/phaser/scenes/GameScene.js` |
| **行号** | 262–264 |
| **问题描述** | Phaser 中 pistol 的世界坐标计算为 `wx = player.x - sin(rot)*20, wy = player.y + cos(rot)*20`。但在 Canvas 的 `renderWeapon` 中，pistol 的变换链是：`translate(-15, 16.5) → rotate(π/2) → translate(0, -20)`，等价于局部坐标约 **(5, 16.5)**。Phaser 的硬编码偏移 `(0, 20)` 与 Canvas 的 `(5, 16.5)` 不一致。 |
| **影响** | 双端 pistol 显示位置不同。 |
| **修复建议** | 将 pistol 的偏移提取到配置（如 `WeaponAnimConfig.pistol`），并在 Phaser 和 Canvas 中共享同一配置。 |

---

### 问题 3：GameScene.js 中其他非近战武器的 Phaser 位置与 Canvas 不一致

| 项目 | 内容 |
|------|------|
| **文件** | `src/phaser/scenes/GameScene.js` |
| **行号** | 266–269 |
| **问题描述** | 非 pistol/melee 武器使用 `offsetDist = 20` 的硬编码：`wx = player.x + cos(rot)*20, wy = player.y + sin(rot)*20`。但在 Canvas 中，PKM 的偏移是 `mainBaseX = 8, mainBaseY = 0` + `rotate(π/2)` + `translate(0, -s*0.42)`，等价于局部坐标约 **(52, 0)**。Phaser 的 `(20, 0)` 与 Canvas 相差甚远。 |
| **影响** | 所有非 pistol 枪类武器在 Phaser 中显示位置与 Canvas 不一致。 |
| **修复建议** | 为每种武器类型定义统一的 `PhaserOffset` 配置，或让 Phaser 直接复用 `WeaponTransform` / `renderWeapon` 的变换链。 |

---

### 问题 4：GameScene.js 中副手 pistol 的 Phaser 位置与 Canvas 不一致

| 项目 | 内容 |
|------|------|
| **文件** | `src/phaser/scenes/GameScene.js` |
| **行号** | 378–380 |
| **问题描述** | 副手 pistol 的 Phaser 偏移为 `wx = player.x + sin(rot)*20, wy = player.y - cos(rot)*20`。Canvas 中副手 pistol 的 `offBaseX = -5, offBaseY = -16.5`，然后 `rotate(π/2)` + `translate(0, 20)`，等价于局部坐标约 **(15, -16.5)**。Phaser 的 `(0, -20)` 与 Canvas 不一致。 |
| **影响** | 双持 pistol 时副手位置错位。 |
| **修复建议** | 同问题 2，使用统一配置。 |

---

## 二、中等问题（建议修复）

### 问题 5：dev-tool.js 初始化默认值与 _reset 不一致

| 项目 | 内容 |
|------|------|
| **文件** | `src/ui/dev-tool.js` |
| **行号** | 17–22（初始化） vs 684（`_reset`） |
| **问题描述** | `weaponParams` 初始化时 `offsetX: 0, offsetY: -30`，但 `_reset()` 设置为 `offsetX: Math.round(ms*0.85 - 7) ≈ 60, offsetY: 30`。两者完全不一致。如果用户未交互直接点击保存，会得到与预期不符的配置。 |
| **影响** | 开发工具用户体验不一致，保存的数据可能不对应任何实际游戏位置。 |
| **修复建议** | 统一初始值和 `_reset` 值，使 `_reset` 成为唯一真实来源。建议：删除初始化时的 `offsetX/offsetY` 默认值，改为在 `init()` 中调用 `this._reset()`。 |

---

### 问题 6：dev-tool.js 的 _reset 默认位置与 Canvas 中 sword 默认位置不匹配

| 项目 | 内容 |
|------|------|
| **文件** | `src/ui/dev-tool.js` |
| **行号** | 684 |
| **问题描述** | `_reset` 设置 `offsetX ≈ 60, offsetY = 30`，经转换后得到 `holdOffsetX ≈ 0, holdOffsetY = -30`。但 `WeaponAnimConfig.sword` 的实际值为 `holdOffsetX = -26, holdOffsetY = 15`。两者对应的武器位置相差约 **26px X 方向** 和 **45px Y 方向**。 |
| **影响** | 开发工具"重置"后的位置并非游戏中剑的默认位置，调试时产生困惑。 |
| **修复建议** | 将 `_reset` 的默认值改为与 `WeaponAnimConfig.sword` 对应的屏幕坐标。计算如下： |

```javascript
// 从 holdOffsetX = -26, holdOffsetY = 15 反推屏幕偏移
const ms = 105 * 0.75; // 78.75
const offsetX = -26 + ms * 0.85 - 7; // ≈ 33.9
const offsetY = -15; // 因为 holdOffsetY = -screenOffsetY
this.weaponParams = { offsetX: Math.round(offsetX), offsetY: Math.round(offsetY), rotation: -20, scale: 1.0 };
```

---

### 问题 7：player.js 中 pistol 的 -20 硬编码

| 项目 | 内容 |
|------|------|
| **文件** | `src/entities/player.js` |
| **行号** | 2468, 2482 |
| **问题描述** | pistol 待机/攻击中 `ctx.translate(0, -20)` 是硬编码像素值，没有基于 `WEAPON_ANIM.size` 的比例。其他武器（PKM、shotgun、melee）使用 `s * 0.42` 或 `ms * 0.85` 等比例值。 |
| **影响** | 如果修改 `WEAPON_ANIM.size`，pistol 的相对位置不会自动调整。 |
| **修复建议** | 改为 `ctx.translate(0, -s * ratio)`，定义 `WeaponAnimConfig.pistol` 的 `centerOffset` 比例。 |

---

### 问题 8：player.js 中副手 melee 没有使用 swordCfg.holdOffsetX/Y

| 项目 | 内容 |
|------|------|
| **文件** | `src/entities/player.js` |
| **行号** | 2927–2933 |
| **问题描述** | 副手 melee 渲染直接 `ctx.translate(0, -ms * 0.85)`，没有应用 `swordCfg.holdOffsetX` 和 `swordCfg.holdOffsetY`。而主手 melee 使用了 `swordCfg.holdOffsetX = -26, holdOffsetY = 15`。 |
| **影响** | 副手剑的位置与主手剑的相对位置不正确。 |
| **修复建议** | 在副手 melee 分支中添加 `ctx.translate(swordCfg.holdOffsetX || wa.holdX, swordCfg.holdOffsetY || wa.holdY)`，确保主副手共享同一配置。 |

---

### 问题 9：主手/副手基础偏移的硬编码分散

| 项目 | 内容 |
|------|------|
| **文件** | `src/entities/player.js` |
| **行号** | 2430–2445 |
| **问题描述** | `mainBaseX/mainBaseY`、`offBaseX/offBaseY` 的硬编码值分散在 `renderWeapon` 中，且未在任何配置文件中定义。例如：pistol 主手 `(-15, 16.5)`，副手 `(-5, -16.5)`，双手枪械 `mainBaseX = 8` 等。 |
| **影响** | 修改武器位置时需要在 `player.js` 和 `dev-tool.js` 中分别修改，易遗漏。 |
| **修复建议** | 将 `mainBaseX`、`mainBaseY`、`offBaseX`、`offBaseY` 提取到 `WeaponAnimConfig` 的各武器类型中，或统一为 `WeaponBaseOffset` 配置对象。 |

---

### 问题 10：GameScene.js 中 melee 使用错误的 WeaponTransform

| 项目 | 内容 |
|------|------|
| **文件** | `src/phaser/scenes/GameScene.js` |
| **行号** | 258 |
| **问题描述** | 由于问题 1（`WeaponTransform` 计算错误），`syncWeapon` 中调用 `WeaponTransform.getMeleeWorldPosition()` 得到的位置本身就是错误的。即使修复了问题 1，还需要验证 `getMeleeRotation` 是否完全匹配 Canvas 的 `Math.PI / 2 + anim.angle + idleRotation` 变换链。 |
| **影响** | Phaser 中近战武器位置与 Canvas 错位。 |
| **修复建议** | 先修复问题 1，然后验证 `getMeleeRotation` 是否包含 `idleRotation` 和 `anim.angle`（呼吸/移动摆动）。 |

---

## 三、轻微问题 / 文档缺失

### 问题 11：COORDINATE_SYSTEM.md 缺少 mainBaseX/mainBaseY 的说明

| 项目 | 内容 |
|------|------|
| **文件** | `COORDINATE_SYSTEM.md` |
| **问题描述** | 文档只提到 `holdOffsetX/Y`，没有说明 `renderWeapon` 中 `mainBaseX = -7` 和 `offBaseX = -5` 的存在。这些偏移是变换链的一部分，但不属于 `WeaponAnimConfig`。 |
| **修复建议** | 在文档中添加 "变换链完整公式" 一节： |

```
Canvas 主手剑完整变换链：
  T(mainBaseX, mainBaseY) → T(holdOffsetX, holdOffsetY) → R(π/2) → T(0, -ms*0.85)
  其中 mainBaseX = -7, mainBaseY = 0（单持 melee）
  其中 ms = WEAPON_ANIM.size * 0.75 = 78.75
  等价局部坐标 = (mainBaseX + holdOffsetX + ms*0.85, mainBaseY + holdOffsetY)
```

---

### 问题 12：COORDINATE_SYSTEM.md 缺少副手坐标系统说明

| 项目 | 内容 |
|------|------|
| **文件** | `COORDINATE_SYSTEM.md` |
| **问题描述** | 文档完全没有提到副手武器的位置计算，包括 `offBaseX`、`offBaseY` 和副手 melee 的变换链差异。 |
| **修复建议** | 添加副手坐标系统说明，包括单持/双持时的区别。 |

---

### 问题 13：COORDINATE_SYSTEM.md 缺少 Phaser 与 Canvas 的映射说明

| 项目 | 内容 |
|------|------|
| **文件** | `COORDINATE_SYSTEM.md` |
| **问题描述** | 文档提到了 Canvas 和 Phaser，但没有说明两者之间的坐标映射关系，也没有指出 GameScene.js 中的硬编码偏移需要与 Canvas 保持一致。 |
| **修复建议** | 添加 "Phaser 渲染同步" 一节，说明：
  1. `syncWeapon` 的 `wx/wy` 必须与 `renderWeapon` 的最终世界坐标一致
  2. 所有武器类型（pistol、PKM、shotgun、bow、melee）都有独立的偏移公式
  3. 禁止在 Phaser 中使用与 Canvas 不匹配的硬编码值 |

---

### 问题 14：COORDINATE_SYSTEM.md 中 "holdOffsetY = offsetY" 的说法不严谨

| 项目 | 内容 |
|------|------|
| **文件** | `COORDINATE_SYSTEM.md` |
| **行号** | 35 |
| **问题描述** | 文档说 `holdOffsetY = offsetY`（直接对应），但代码中 `holdOffsetY = -wp.offsetY`（因为 Canvas Y+ 向下）。`holdOffsetY` 在 `rotate(π/2)` 后影响的是武器左右方向，而非上下方向。 |
| **修复建议** | 改为：
```
holdOffsetY = -offsetY（因为 Canvas 坐标系 Y+ 向下，与开发工具 Y+ 向上相反）
注意：rotate(π/2) 后，holdOffsetY 的实际影响方向变为左右偏移
```

---

### 问题 15：weapon-anim-config.js 中非 sword 武器缺少 idleRotation

| 项目 | 内容 |
|------|------|
| **文件** | `src/items/weapon-anim-config.js` |
| **问题描述** | 只有 `sword` 和 `bow` 有 `idleRotation` 配置，`pistol`、`deagle`、`pkm`、`akm` 等没有。但 dev-tool 支持所有武器的 `rotation` 调整。如果未来需要为枪类武器添加旋转角度，无法通过配置实现。 |
| **修复建议** | 为所有武器类型添加 `idleRotation: 0` 的默认值，保持配置一致性。 |

---

### 问题 16：weapon-anim-config.js 中缺少武器中心偏移比例

| 项目 | 内容 |
|------|------|
| **文件** | `src/items/weapon-anim-config.js` |
| **问题描述** | 各种武器在 Canvas 中的中心偏移（pistol: -20, PKM: -s*0.42, melee: -ms*0.85）没有统一配置在 `WeaponAnimConfig` 中，而是硬编码在 `player.js` 中。 |
| **修复建议** | 为每种武器添加 `centerOffset` 或 `pivotRatio` 配置，例如： |

```javascript
pistol: { holdOffsetX: 0, holdOffsetY: 0, centerOffset: -20, idleScale: 0.5, ... },
pkm: { holdOffsetX: 0, holdOffsetY: 0, centerOffsetRatio: -0.42, ... },
sword: { holdOffsetX: -26, holdOffsetY: 15, centerOffsetRatio: -0.85, ... },
```

---

### 问题 17：player.js 中 _fireRanged 的 holdX/holdY 对枪类武器无实际效果

| 项目 | 内容 |
|------|------|
| **文件** | `src/entities/player.js` |
| **行号** | 1913–1915 |
| **问题描述** | 枪类武器（pistol、PKM、shotgun）的 `WeaponAnimConfig` 中 `holdOffsetX = 0, holdOffsetY = 0`。`_fireRanged` 中 `holdX = wac.holdOffsetX` 和 `holdY = wac.holdOffsetY` 实际取值都是 0，后续 `gunLX = this.size + 24` 等硬编码才是真正决定枪口位置的因素。 |
| **影响** | 代码逻辑上存在冗余，枪类武器的 `holdOffset` 配置没有实际作用。 |
| **修复建议** | 要么将枪口偏移统一到 `WeaponAnimConfig` 中（例如 `muzzleOffsetX`、`muzzleOffsetY`），要么删除枪类武器的 `holdOffsetX/Y` 配置，避免误导。 |

---

## 四、坐标系一致性验证表

以下表格对比了 **主手 melee（剑）待机** 在各文件中的计算结果：

| 文件 | 计算方式 | 局部 X（面朝方向） | 局部 Y（垂直方向） | 是否一致 |
|------|----------|-------------------|-------------------|----------|
| `player.js` Canvas | `mainBaseX(-7) + holdOffsetX(-26) + R(π/2) → (0, -59.06)` | **26.06** | **15** | ✅ 基准 |
| `dev-tool.js` `_reset` | `offsetX = 60, offsetY = 30 → holdOffsetX ≈ 0, holdOffsetY = -30` | **59.13** | **-30** | ❌ 不一致 |
| `weapon-transform.js` | `holdOffsetX + ms*0.85 = -26 + 59.06` | **33.06** | **15** | ❌ 差 7px |
| `GameScene.js` | `WeaponTransform.getMeleeWorldPosition()` | **33.06** | **15** | ❌ 继承问题 |

---

## 五、修复优先级

| 优先级 | 问题编号 | 描述 | 修复工作量 |
|--------|----------|------|------------|
| **P0** | 1 | WeaponTransform 主手缺少 mainBaseX | 小 |
| **P0** | 2 | GameScene.js pistol 位置与 Canvas 不一致 | 中 |
| **P0** | 3 | GameScene.js 其他武器位置与 Canvas 不一致 | 中 |
| **P0** | 4 | GameScene.js 副手 pistol 位置不一致 | 中 |
| **P1** | 5 | dev-tool 初始化与 _reset 不一致 | 小 |
| **P1** | 6 | dev-tool _reset 与游戏默认不匹配 | 小 |
| **P1** | 7 | pistol -20 硬编码 | 小 |
| **P1** | 8 | 副手 melee 缺少 holdOffset | 小 |
| **P1** | 9 | 主手/副手基础偏移硬编码分散 | 中 |
| **P1** | 10 | GameScene 使用错误 WeaponTransform | 小（依赖 P0） |
| **P2** | 11–17 | 文档和配置缺失 | 小 |

---

## 六、建议的长期重构

1. **统一武器变换模块**：将 `renderWeapon` 中所有武器类型的变换链提取为 `WeaponTransform` 的工厂方法，如 `getWeaponTransformChain(type, isOffhand)`，返回完整的变换矩阵，供 Canvas 和 Phaser 共享。
2. **武器配置中心化**：将所有与武器位置相关的参数（`holdOffsetX/Y`、`centerOffset`、`mainBaseX/Y`、`idleRotation`、`idleScale`）集中到 `WeaponAnimConfig` 中，`player.js` 和 `GameScene.js` 只读取配置，不硬编码。
3. **开发工具与游戏实时同步**：考虑让 dev-tool 直接读取当前 `WeaponAnimConfig` 的值作为初始值，或提供"加载当前配置"按钮，避免默认值不一致。

---

*报告生成完毕。建议先修复 P0 级别问题，再处理 P1 级别问题。*
