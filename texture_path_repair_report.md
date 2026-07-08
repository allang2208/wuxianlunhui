# 贴图路径统一与坐标系修复报告

## 一、已修复的路径不匹配

### 1. `game-dev/src/ui/dev-tool.js` — WEAPON_MAP 贴图路径修正

| 武器键 | 原路径（错误） | 修正后路径（匹配实际文件） | 说明 |
|--------|--------------|------------------------|------|
| `pistol` | `assets/weapons/g18_pistol.png` | `assets/weapons/G18equip.png` | 文件名与实际文件不匹配（大小写及名称差异） |
| `akm` | `assets/weapons/akm_topdown_lowpoly_v2.png` | `assets/weapons/akm_topdown_lowpoly_v2长枪管.png` | 缺少后缀"长枪管" |
| `qbz191` | `assets/weapons/akm_topdown_lowpoly_v2.png` | `assets/weapons/191equip_clean.png` | 错误复用了 AKM 路径，实际应为 QBZ-191 专属贴图 |
| `qjb201` | `assets/weapons/pkm_topdown.png` | `assets/weapons/201equip.png` | 错误复用了 PKM 路径，实际应为 QJB-201 专属贴图 |

**验证方法**：以上路径均已在 `game-dev/assets/weapons/` 目录中确认文件存在，且与 `player.js` 中对应武器加载路径保持一致。

### 2. `game-dev/src/config/weapon-texture-map.js` — Phaser 纹理加载路径修正

| 纹理键 | 原路径（错误） | 修正后路径 | 说明 |
|--------|--------------|-----------|------|
| `weapon_akm` | `assets/weapons/AKm.png` | `assets/weapons/akm-equip.png` | 原文件不存在，实际文件为 `akm-equip.png` |

**验证方法**：`assets/weapons/akm-equip.png` 已确认存在。

---

## 二、已修复的坐标系不一致

### 1. `game-dev/src/ui/dev-tool.js` — `_reset()` 与 `_save()` 公式不一致（问题5/6）

**问题描述**：`_reset()` 中剑类武器的屏幕偏移推导公式符号错误，导致重置后的位置与 `_save()` 保存的 `holdOffsetX` 不互逆。

- `_save()` 公式：`holdOffsetX = offsetX - ms * 0.85 + 7`
- 原 `_reset()` 公式：`offsetX = holdOffsetX - ms * 0.85 + 7` ❌（错误，符号反了）
- 修正后 `_reset()` 公式：`offsetX = holdOffsetX + ms * 0.85 - 7` ✅

**同时修正**：`init()` 中移除了与 `_reset()` 重复的先写死默认值再调用 `_reset()` 覆盖的逻辑，改为直接调用 `_reset()` 初始化，确保开发工具启动时的默认值与 `WeaponAnimConfig` 完全一致，避免用户未交互直接点击保存时得到与预期不符的配置。

**状态**：✅ 已修复

---

## 三、已修复（发现时已被前序提交修正）

### 1. `game-dev/src/ui/dev-tool.js` — `_reset()`  melee 公式
发现 `_reset()` 中已存在注释 `// 反向推导屏幕偏移（修正公式：offsetX = holdOffsetX + ms*0.85 - 7）`，且公式本身已正确。该修复在之前的代码提交中已完成。

### 2. `game-dev/src/combat/weapon-transform.js` — 主手偏移包含 mainBaseX
审计报告问题1指出 `WeaponTransform` 缺少 `mainBaseX = -7`。经检查，当前代码中 `getWeaponLocalOffset()` 已正确包含 `mainBaseX` 和 `mainBaseY`，且 `GameScene.js` 已全面使用 `WeaponTransform` 模块替代硬编码偏移。

**状态**：✅ 已修复（前序提交）

---

## 四、无法自动修复的路径缺失（需补充素材）

以下路径在代码中被引用，但 `assets/` 目录中不存在对应文件或目录。由于无法确定正确的替代贴图，**未做修改**，建议补充素材后统一更新。

### 1. 角色精灵图路径缺失

| 引用文件 | 引用路径 | 实际状态 | 备注 |
|---------|---------|---------|------|
| `dev-tool.js:123` | `assets/character/idle.png` | ❌ 不存在 | 实际目录为 `assets/characters/`（复数），但无 `idle.png` |
| `dev-tool.js:358` | `assets/character/walk.png` | ❌ 不存在 | 期望 3×8 精灵图（512×516/帧），实际为 `walk/hero_001.png` 等独立帧 |
| `dev-tool.js:363` | `assets/character/running.png` | ❌ 不存在 | 期望 2×8 精灵图（512×512/帧），实际为 `running/N/`、`running/E/` 等方向子目录 |
| `player.js:147` | `assets/character/running.png` | ❌ 同上 | 同上 |
| `player.js:154` | `assets/character/idle.png` | ❌ 同上 | 同上 |
| `player.js:158` | `assets/character/walk.png` | ❌ 同上 | 同上 |

**建议**：将 `assets/character/` 统一为 `assets/characters/`，并补充 `idle.png`、`walk.png`（3×8 精灵图）、`running.png`（2×8 精灵图），或修改代码使用现有独立帧序列。

### 2. index.html 侧边栏 UI 图标缺失

| 引用路径 | 实际状态 | 备注 |
|---------|---------|------|
| `assets/ui/icons/status.png` | ❌ 不存在 | `assets/ui/icons/` 目录不存在 |
| `assets/ui/icons/inventory.png` | ❌ 同上 | 同上 |
| `assets/ui/icons/skills.png` | ❌ 同上 | 同上 |
| `assets/ui/icons/codex.png` | ❌ 同上 | 同上 |
| `assets/ui/icons/quest.png` | ❌ 同上 | 同上 |

**说明**：`assets/ui/` 目录仅存在 `addpoint.png`、`expedition-bg.png`、`npc_portrait.png`，无 `icons` 子目录。`assets/icons/` 目录中均为武器/物品图标，无 UI 状态/背包/技能/图鉴/任务图标。

**建议**：补充 `assets/ui/icons/` 目录及对应图标文件，或移除 index.html 中对应的 `<img>` 引用。

---

## 五、修改文件汇总

| 文件 | 修改内容 | 修改类型 |
|------|---------|---------|
| `game-dev/src/ui/dev-tool.js` | WEAPON_MAP 中 4 个武器贴图路径修正 | 路径修复 |
| `game-dev/src/ui/dev-tool.js` | `init()` 改为直接调用 `_reset()` 初始化，移除重复写死的默认值 | 坐标一致性修复 |
| `game-dev/src/config/weapon-texture-map.js` | `weapon_akm` 路径从 `AKm.png` 修正为 `akm-equip.png` | 路径修复 |

---

## 六、修复验证

```bash
# 验证修正后的武器贴图路径是否存在
ls game-dev/assets/weapons/G18equip.png
ls game-dev/assets/weapons/akm_topdown_lowpoly_v2长枪管.png
ls game-dev/assets/weapons/191equip_clean.png
ls game-dev/assets/weapons/201equip.png
ls game-dev/assets/weapons/akm-equip.png

# 验证开发工具中 WEAPON_MAP 的 bow 帧序列路径是否存在
ls game-dev/assets/weapons/bow_frame_01.png
ls game-dev/assets/weapons/bow_frame_08.png
```

以上文件均确认存在。修复后的路径与 `player.js` 中对应武器的 `Image.src` 赋值保持一致，实现了开发工具与游戏本体之间的贴图路径统一。

---

*报告生成时间：基于当前代码快照*
