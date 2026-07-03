# 游戏项目代码审查诊断报告

## 审查范围
基于用户提供的所有条件分支进行全面检查，覆盖：
- 双持散布修复 (dual-wield-spread)
- 武器贴图修复 (weapon-textures)
- 任务系统修复 (quest-system)
- 技能系统修复 (skill-system)
- 全面硬编码排查 (hardcoded-values)
- Phaser 纹理系统 (phaser-textures)

---

## 一、双持散布修复 (dual-wield-spread) — 检查结果

### 1.1 散布计时器逻辑（行 1153-1164）
**代码：**
```javascript
const _currentWep2 = this.equipments[this.weaponMode];
const _isGun = _currentWep2 && isGunWeapon(_currentWep2);
const _offSlot = this.weaponMode === 'weapon' ? 'offhand' : 'ring2';
const _offItem = this.equipments[_offSlot];
const _isDual = _offItem && _offItem.name && !_offItem.isTwoHanded;
const _shouldTrackSpread = _isGun && (Input.mouse.leftDown || (_isDual && Input.mouse.rightDown));
if (_shouldTrackSpread) {
    this._gunSpreadTimer += dt;
} else {
    this._gunSpreadTimer = 0;
}
```
**状态：✅ 正确修复**
- 已同时检查 `leftDown` 和 `rightDown`（当双持时）
- 双持判断 `_isDual` 使用 `!_offItem.isTwoHanded` 与 `isOneHanded` 等价（经 `gun-ammo.js` 第66行确认）

### 1.2 isDualWield 判断一致性
| 位置 | 代码 | 判断条件 | 状态 |
|------|------|----------|------|
| 行 1158 | `_isDual` | `_offItem && _offItem.name && !_offItem.isTwoHanded` | ✅ |
| 行 1425 | `isDualWield` | `offhandItem && offhandItem.name && !offhandItem.isTwoHanded` | ✅ |
| 行 1464 | `offhandHasAmmo` | `isDualWield ? this._hasAmmo(offhandSlot) : false` | ✅ |
| 行 1482 | 副手开火 | `isDualWield && offhandHasAmmo...` | ✅ |
| 行 1538 | PKM右键副手 | `offhandItem && offhandItem.name && isOneHanded(offhandItem)` | ✅ 等价 |

**状态：✅ 一致**

### 1.3 ⚠️ 遗漏：主武器非枪时的副手散布
**问题描述：** 散布计算基于 `this.equipments[this.weaponMode]`（主武器槽）。如果主武器是近战武器（如剑），副武器是手枪：
- `_isGun = false`（剑不是枪）
- `_shouldTrackSpread = false`
- 右键副手开火时，`this._currentSpreadFactor` 为 0

**影响：** 当主手装备剑、副手装备手枪时，右键副手射击没有散布增长。

**修复建议（player.js）：**
```javascript
// 在行 1153-1164 附近，将散布判断改为同时检查主武器和副武器
const _currentWep2 = this.equipments[this.weaponMode];
const _isGun = _currentWep2 && isGunWeapon(_currentWep2);
const _offSlot = this.weaponMode === 'weapon' ? 'offhand' : 'ring2';
const _offItem = this.equipments[_offSlot];
const _isDual = _offItem && _offItem.name && !_offItem.isTwoHanded;
const _offIsGun = _offItem && isGunWeapon(_offItem);
const _shouldTrackSpread = (_isGun && Input.mouse.leftDown) || 
                           (_offIsGun && _isDual && Input.mouse.rightDown);
```

---

## 二、武器贴图修复 (weapon-textures) — 检查结果

### 2.1 weapon-texture-map.js 映射与预加载一致性

**getWeaponTextureKey 特殊映射：**
| weaponId | 映射结果 | 预加载 | 状态 |
|----------|----------|--------|------|
| weapon1 | weapon_rusty_sword | ✅ | 正常 |
| weapon2 | weapon_knights_sword | ✅ | 正常 |
| weapon4 | weapon_rune_sword | ✅ | 正常 |
| weapon5 | weapon_night_flame | ✅ | 正常 |
| weapon9 | weapon_g18 | ✅ | 正常 |
| weapon10 | weapon_deagle | ✅ | 正常 |
| weapon18 | weapon_p4040 | ✅ | 正常 |
| weapon12 | weapon_super90 | ✅ | 正常 |
| weapon13 | weapon_saiga12k | ✅ | 正常 |
| weapon6 (PKM) | weapon_pkm (fallback) | ✅ | 正常 |
| weapon7 (AKM) | weapon_akm (fallback) | ✅ | 正常 |
| weapon8 (QBZ191) | weapon_qbz191 (fallback) | ✅ | 正常 |
| weapon11 (QJB201) | weapon_qjb201 (fallback) | ✅ | 正常 |
| weapon14 (训练弓) | weapon_bow (fallback) | ✅ | 正常 |
| weapon15 (能量机枪) | weapon_energy_lmg (fallback) | ✅ | 正常 |
| weapon16 (边境长弓) | weapon_bow (fallback) | ✅ | 正常 |
| **weapon17 (小圆盾)** | **weapon_shield (fallback)** | **❌ 缺失** | **问题** |

### 2.2 ⚠️ 缺少的预加载：weapon_shield

**问题：** 小圆盾（weapon17）的 weaponType 为 `'shield'`，`getWeaponTextureKey` 会返回 `weapon_shield`，但 `getWeaponTextureLoadList` 中没有预加载 `weapon_shield`。

**修复建议（weapon-texture-map.js）：**
```javascript
export function getWeaponTextureLoadList() {
    return [
        // ... 现有条目 ...
        { key: 'weapon_shield', path: 'assets/weapons/woodshied-equip.png' },
    ];
}
```

### 2.3 equip-data-manager.js canvasImageProp 检查

| 武器 | canvasImageProp | Image对象预加载 | 状态 |
|------|-----------------|----------------|------|
| 生锈的长剑 | meleeImage | ✅ 行127 | 正常 |
| 骑士长剑 | meleeImage | ✅ (共用) | ⚠️ 共用 |
| 符文长剑 | meleeImage | ✅ (共用) | ⚠️ 共用 |
| 夜与火之剑 | meleeImage | ✅ (共用) | ⚠️ 共用 |
| G18 | pistolImage | ✅ 行132 | 正常 |
| 沙漠之鹰 | deagleImage | ✅ 行133 | 正常 |
| P4040 | p4040Image | ✅ 行134 | 正常 |
| PKM | pkmImage | ✅ 行135 | 正常 |
| AKM | akmImage | ✅ 行136 | 正常 |
| QBZ191 | qbz191Image | ✅ 行137 | 正常 |
| QJB201 | qjb201Image | ✅ 行138 | 正常 |
| Super90 | super90Image | ✅ 行139 | 正常 |
| SAIGA-12K | saiga12kImage | ✅ 行140 | 正常 |
| 能量机枪 | energyLmgImage | ✅ 行141 | 正常 |
| 小圆盾 | 无 | shieldImage 行142 | 正常（非武器渲染） |
| 训练用弓 | 无 | bowEquipImage 行131 | 正常 |
| 边境长弓 | 无 | bowEquipImage 行131 | 正常 |

### 2.4 ⚠️ 共用 prop 问题：meleeImage

**问题：** 生锈的长剑、骑士长剑、符文长剑、夜与火之剑全部共用 `canvasImageProp: 'meleeImage'`。

在 Player 构造函数中（行127），只有一个 `this.meleeImage` 对象。当切换武器时（如行1778），代码会更新 `this.meleeImage.src`，这意味着同一 Image 对象被多个武器共享。虽然 Canvas 渲染在切换时会重新加载图片，但如果在加载过程中切换武器，可能导致纹理闪烁或显示错误的武器贴图。

**修复建议：** 为每把剑分配独立的 Image 属性，或在 switchWeaponMode 中创建新的 Image 对象（代码已经在部分情况下这样做了，但构造函数中的预加载仍是单一对象）。

---

## 三、任务系统修复 (quest-system) — 检查结果

### 3.1 硬编码 'explore_rift_1' 和 'scene2' 一致性

| 文件 | 位置 | 硬编码内容 | 问题 |
|------|------|----------|------|
| quest-system.js | 行4 | `_selectedQuest: 'explore_rift_1'` | 任务选择器默认选中 |
| quest-system.js | 行9 | 任务定义键 | 正常 |
| quest-system.js | 行25 | `scene: 'scene2'` | 场景配置 |
| quest-system.js | 行156 | `this.activeQuest = 'explore_rift_1'` | 状态初始化 |
| quest-system.js | 行166-222 | 多处引用 | 任务状态管理 |
| quest-system.js | 行308 | 追踪栏引用 | 任务追踪 |
| **npc-dialogue.js** | **行340** | `QuestSystem.QUESTS['explore_rift_1']` | **硬编码任务ID** |
| **npc-dialogue.js** | **行350** | `QuestState.startQuest('scene2', 'quest')` | **❌ 硬编码场景ID！** |

### 3.2 ⚠️ 严重问题：teleportToQuest 硬编码场景ID

**代码（npc-dialogue.js 行338-350）：**
```javascript
teleportToQuest() {
    const quest = QuestSystem.QUESTS['explore_rift_1'];
    if (!quest || !quest.accepted) {
        // ... 提示未接受任务
        return;
    }
    QuestState.startQuest('scene2', 'quest'); // ❌ 硬编码！应为 quest.scene
}
```

**问题：** 虽然 `quest-system.js` 中已将场景配置为 `scene: 'scene2'`，但 `npc-dialogue.js` 中直接硬编码了 `'scene2'`。如果任务配置改为 `scene: 'scene3'`，teleportToQuest 仍会传送到 scene2。

**修复建议（npc-dialogue.js 行350）：**
```javascript
QuestState.startQuest(quest.scene, 'quest'); // 使用 quest.scene 而非硬编码 'scene2'
```

### 3.3 acceptQuest 和 acceptQuestAndTeleport

**acceptQuest（行64）：** ✅ 正确——只接受任务，不传送，设置 `quest.accepted = true`

**acceptQuestAndTeleport（行76）：** ✅ 正确——使用 `quest.scene` 进行传送，不硬编码

```javascript
acceptQuestAndTeleport() {
    const quest = this.QUESTS[this._selectedQuest];
    if (quest) {
        quest.accepted = true;
        if (typeof QuestState !== 'undefined') {
            QuestState.startQuest(quest.scene, 'quest'); // ✅ 使用 quest.scene
        }
    }
}
```

### 3.4 QuestSystem._fromNPC 使用

**状态：✅ 正确**
- `npc-dialogue.js` 行316：打开任务时设置 `QuestSystem._fromNPC = true`
- `quest-system.js` 行42：关闭时重置 `_fromNPC = false`

---

## 四、技能系统修复 (skill-system) — 检查结果

### 4.1 skills.json 中的 iconImage 配置

| 技能 | iconImage | 状态 |
|------|-----------|------|
| iceSpike | `assets/skills/Icearrow-skill.png` | ✅ |
| fireball | `assets/skills/fireball_icon.png` | ✅ |
| shieldDefense | `assets/skills/Meshy_AI_Shield Block Sword Warrior.png` | ✅ |
| dashAttackFire | `assets/skills/冲刺攻击-火.png` | ✅ |
| dashAttackThrust | `assets/skills/冲刺突击.png` | ✅ |

### 4.2 player.js 兜底配置与 skills.json 一致性

**JSON 加载成功时的兜底（行541-611）：**
- 所有兜底技能的 iconImage 与 skills.json 一致 ✅
- 但 **whirlwind** 的 radius 参数不一致：
  - skills.json: `"radius": "120 + level * 5"`
  - player.js 兜底: `radius: 188 + level * 6`

**JSON 加载失败时的硬编码兜底（行614-743）：**
- 所有兜底技能的 iconImage 与 skills.json 一致 ✅
- 但 **whirlwind** 的 radius 和 knockback 参数不一致：
  - skills.json: `"radius": "120 + level * 5"`, `"knockback": "250"`
  - player.js 兜底: `radius: 188 + level * 6`, `knockback: 312`

**⚠️ 数据不一致：** 如果 JSON 加载失败，风车技能的半径和击退距离会显著不同（188 vs 120，312 vs 250）。

**修复建议（player.js 行653）：**
```javascript
getEffect(level) { return { damageMul: 1.5 + level * 0.10, strBonus: level, cooldown: 10 - level * 0.2, staminaCost: 20 + level * 1, radius: 120 + level * 5, knockback: 250 }; }
```

### 4.3 ice-spike-system.js 和 fireball-system.js 调试代码

**ice-spike-system.js 中的 console.log：**
- 行11: `console.log('[IceSpike] trigger called...')`
- 行14: `console.log('[IceSpike] launching existing spikes')`
- 行67: `console.log('[IceSpike] _spawnSpikes called...')`

**fireball-system.js：** ✅ 没有 console.log 调试代码

**状态：⚠️ ice-spike-system.js 有未清理的调试代码**

---

## 五、全面硬编码排查 (hardcoded-values) — 检查结果

### 5.1 quest-system.js

| 类型 | 位置 | 硬编码值 | 严重程度 |
|------|------|----------|----------|
| 任务ID | 行4, 156, 166, 200, 212, 221, 308 | `explore_rift_1` | 中 |
| 场景ID | 行25 | `scene: 'scene2'` | 低（配置项） |
| 奖励数值 | 行241 | 提升1级 | 低 |
| 奖励数值 | 行252 | 500金币 | 低 |
| 奖励数值 | 行20-21 | 随机优质武器 | 低 |

### 5.2 npc-dialogue.js

| 类型 | 位置 | 硬编码值 | 严重程度 |
|------|------|----------|----------|
| 任务ID | 行340 | `explore_rift_1` | 中 |
| **场景ID** | **行350** | **`'scene2'`** | **高** |
| 对话文本 | 行125-142 | 大量中文对话 | 低（剧情文本） |
| 提示文本 | 行321, 330 | 信息/帮助提示 | 低 |
| 高亮文本 | 行263 | `不能再进行更改` | 低 |

### 5.3 player.js

| 类型 | 位置 | 硬编码值 | 严重程度 |
|------|------|----------|----------|
| 武器类型判断 | 行971, 991, 1417, 1494 | 武器类型列表 | 中 |
| 散布参数 | 行1176-1178 | 500ms, 4000ms, 25° | 低（有配置覆盖） |
| 动画配置 | 多处 | WEAPON_ANIM 常量 | 低 |
| 能量机枪参数 | 行182 | 硬编码默认值 | 中（有配置覆盖） |
| 场景尺寸 | 行456 | `MAIN_SCENE_WIDTH = 7650` | 中 |
| 重生位置 | 行457 | 固定坐标偏移 | 低 |
| 冷却时间 | 行111 | `gameStartCooldown = 500` | 低 |
| 冲刺触发时间 | 行1112 | `333ms` | 低 |
| 中毒数值 | 行473, 497 | 5000ms, 1000ms | 低 |
| 弩攻击参数 | 行1381 | 蓄力时间1500ms | 低（有配置覆盖） |

### 5.4 weapon-texture-map.js

| 类型 | 位置 | 硬编码值 | 严重程度 |
|------|------|----------|----------|
| 武器ID映射 | 行12-22 | weapon1-weapon18 映射 | 中 |
| 文件路径 | 行34-50 | 贴图文件路径 | 低 |

### 5.5 data/skills.json

| 类型 | 位置 | 硬编码值 | 严重程度 |
|------|------|----------|----------|
| 技能ID | 所有键 | swordMastery, dashAttack 等 | 低（数据配置） |
| 文件名 | 多处 | 贴图和音效文件路径 | 低 |
| 数值 | 多处 | 公式和数值 | 低（数据配置） |

### 5.6 gun-ammo.js

| 类型 | 位置 | 硬编码值 | 严重程度 |
|------|------|----------|----------|
| weaponId | 行3-11 | weapon9, weapon10 等 | 中（已弃用） |
| 武器类型 | 行26-31 | 武器分类列表 | 中（已弃用） |
| 射击模式 | 行41-43 | 半自动/全自动列表 | 中（已弃用） |
| 单手/双手 | 行60-62 | 武器类型列表 | 中（已弃用） |

---

## 六、Phaser 纹理系统 (phaser-textures) — 检查结果

### 6.1 weapon-texture-map.js 预加载完整性

**getWeaponTextureLoadList 返回15个纹理：**
- `weapon_rusty_sword` 到 `weapon_bow` 共15项
- **缺少：`weapon_shield`**（小圆盾使用）

### 6.2 BootScene.js 加载逻辑

**状态：✅ 正确**
```javascript
const weaponTextures = getWeaponTextureLoadList();
for (const { key, path } of weaponTextures) {
    this.load.image(key, path);
}
```
- 正确调用 `getWeaponTextureLoadList()` 并遍历加载

### 6.3 GameScene.js 纹理 fallback 缺失

**syncWeapon（行206-280）：**
```javascript
let texture = getWeaponTextureKey(currentItem);
// ...
if (!this.weaponSprite) {
    this.weaponSprite = this.add.sprite(0, 0, texture);
} else if (this.weaponSprite.texture.key !== texture) {
    this.weaponSprite.setTexture(texture);
}
```

**⚠️ 问题：** 没有检查纹理是否已加载。如果 `texture` 不存在（如 `weapon_shield` 未预加载），Phaser 会显示绿色缺失纹理框。

**syncOffhandWeapon（行285-362）：** 同样没有 fallback 处理。

**修复建议（GameScene.js）：**
```javascript
// 在 syncWeapon 和 syncOffhandWeapon 中添加纹理检查
let texture = getWeaponTextureKey(currentItem);
if (!this.textures.exists(texture)) {
    console.warn('[GameScene] Texture missing:', texture, 'for item:', currentItem.name);
    texture = 'weapon_rusty_sword'; // fallback 到默认纹理
}
```

---

## 七、修复优先级汇总

| 优先级 | 问题 | 文件 | 位置 | 修复操作 |
|--------|------|------|------|----------|
| **P0** | teleportToQuest 硬编码场景ID | npc-dialogue.js | 行350 | `'scene2'` → `quest.scene` |
| **P1** | 缺少 weapon_shield 预加载 | weapon-texture-map.js | 行34 | 添加 `weapon_shield` |
| **P1** | Phaser 纹理无 fallback | GameScene.js | 行216, 318 | 添加 `textures.exists` 检查 |
| **P2** | 主武器非枪时副手无散布 | player.js | 行1153-1164 | 修改 `_shouldTrackSpread` 逻辑 |
| **P2** | 风车技能参数不一致 | player.js | 行653 | radius 188→120, knockback 312→250 |
| **P3** | ice-spike 调试代码 | ice-spike-system.js | 行11,14,67 | 移除或注释 console.log |
| **P3** | gun-ammo.js 弃用硬编码 | gun-ammo.js | 行3-62 | 清理或彻底移除 |
| **P3** | meleeImage 共用问题 | equip-data-manager.js | 多处 | 为不同剑分配独立 canvasImageProp |

---

## 八、结论

本次审查发现的主要问题：
1. **teleportToQuest 中硬编码 `scene2`**（最严重）—— 导致任务场景配置无法生效
2. **缺少 `weapon_shield` 预加载** —— 小圆盾在 Phaser 中可能显示缺失纹理
3. **Phaser 纹理无 fallback 保护** —— 任何未预加载的武器纹理都会显示绿色错误框
4. **主武器非枪时副手散布不计算** —— 双持剑+手枪时右键射击无散布
5. **风车技能兜底参数与 JSON 不一致** —— JSON 加载失败时行为差异
6. **ice-spike-system.js 残留调试代码** —— 生产环境应移除
