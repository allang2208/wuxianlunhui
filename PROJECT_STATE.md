# 项目状态

## 版本号
- 当前版本：0.198
- 当前日期：2026-07-11
- 最近工作：Phaser 迁移收尾 + Canvas 渲染路径清理

## 最近完成（2026-07-11）

### Phaser 迁移完成
- **主世界渲染**：地形、网格、边界、墙壁、树木、敌人、玩家、投射物、掉落物、训练靶、NPC 全部由 Phaser 接管。
- **HUD 迁移**：计时器、HP/MP/体力条、经验条、武器信息、操作提示迁移到 `HudScene`；复杂面板保留 DOM overlay。
- **屏幕特效迁移**：crit 闪光、受击红屏、玩家/敌人受击白光、长弓蓄力满闪光改为 Phaser 实现。
- **小地图/准星优化**：静态内容烘焙、状态变化时才设置 `body.cursor`。
- **实体渲染去重**：`Game.render` 不再遍历实体 Canvas 循环，避免双重渲染。

### Canvas 死代码清理
- 删除所有不再被主循环调用的 `render(ctx)` 方法及辅助方法（projectile、drop-item、portal、drone-system、enemy 绘制辅助、combatant 武器渲染、entity hitbox 调试等）。
- 删除 `PhaseChangeEffect`、`showHitbox` 等已失效代码。
- 保留合理 Canvas 路径：地牢地图 `DungeonMapSystem.render(ctx)`、特殊场景地形 Canvas 覆盖。

### 技术债务处理
- `MapGenerator` 主场景改为 Phaser Graphics 直接生成 Texture，不再手动创建 `HTMLCanvasElement`。
- `Game.render` 非地牢模式下隐藏底层 `gameCanvas`，停止无意义 `clear()`。
- `GameUIManager.updateUI()` 使用静默查询，避免对已删除/隐藏 DOM 元素的 `console.warn`。

### 构建验证
- `npx eslint src --max-warnings=0`：通过
- `npx vite build`：通过，产物 `index.js` 约 2.26 MB（gzipped ~587 KB）

## 已知遗留
- `scene3` 火车背景 Canvas 实现已删除，待后续重新实现。
- 部分特效（如 `FloatingTextEffect`）只剩 `update`、没有 Phaser 渲染，需后续处理。

---

## 已完成的功能（不要重复做）

### 彻底方案：px/秒 + dt/1000（2026-06-30）
- 备份计数：3（v2026-07-01_03-44-02 / v2026-07-01_03-17-33 / v2026-07-01_03-01-52）
- 上次备份：2026-07-01 03:44:02（药水系统+属性修复）

## 已完成的功能（不要重复做）

### 彻底方案：px/秒 + dt/1000（2026-06-30）
- **目标**：将速度单位从"px/帧"彻底改为"px/秒"，缩放因子从 `dt/16.67` 改为 `dt/1000`
- **修改内容**：
  1. **缩放因子替换**：所有 `dt / 16.67` → `dt / 1000`
     - 涉及文件：projectile.js, blood-hit-effect.js, effect-manager.js, floating-text.js, particle-effects.js, poison-effect.js, shell-casing.js, slash-effect.js, thrust-effect.js, weapon-effect.js, enemy.js, player.js（共12个文件，约40处）
  2. **位置速度常数 ×24**（当前已×2.5，需达到×60，60/2.5=24）
     - `config.js`：PLAYER_SPEED 2.1875→52.5, PLAYER_SPRINT 3.75→90, DODGE_SPEED 30→720
     - `enemy-data.js`：14个敌人 speed ×24
     - `enemy-types.js`：13个敌人 speed ×24, 2个 projectileSpeed ×24
     - `player.js`：12个 RangedAttack projectileSpeed ×24
     - `equip-data-manager.js`：10个 weapon projectileSpeed ×24
     - `shop-system.js`：7个 weapon projectileSpeed ×24
     - `equip-tooltip-manager.js`：speedMap 硬编码值 ×24
  3. **非位置速度常数 ×24/×60**（未经过×2.5的常数需×60）
     - `effect-manager.js`：critFlash 衰减率 0.08→1.92
     - `particle-effects.js`：alpha 衰减率 0.03→0.72, 0.008→0.192, 0.006→0.144；粒子速度常数 ×24
     - `blood-hit-effect.js`：speed 1.5→36
     - `poison-effect.js`：speed 0.1→2.4
     - `shell-casing.js`：speed 2.5→60
     - `dash-effects.js`：speed 0.15→3.6, 0.02→0.48
     - `slash-effect.js`：swingSpeed arc/6→arc*10（×60）
     - `thrust-effect.js`：speed 0.12→7.2（×60）
     - `weapon-effect.js`：floatSpeed 0.3→18（×60）
- **效果**：60fps 下行为与原来完全一致；速度常数语义正确（px/秒），新增代码无需额外记忆缩放规则
- **构建验证**：通过

### 速度常数×2.6调整（2026-06-30）
- **原因**：用户反馈当前速度仍偏慢，需要整体再加快2.6倍
- **修改范围**：16个文件，全部速度常数 ×2.6
  - `config.js`：PLAYER_SPEED 52.5→136.5, PLAYER_SPRINT 90→234, DODGE_SPEED 720→1872
  - `enemy-data.js`：14个敌人 speed ×2.6
  - `enemy-types.js`：13个敌人 speed ×2.6, 2个 projectileSpeed ×2.6
  - `player.js`：12个 RangedAttack projectileSpeed ×2.6
  - `equip-data-manager.js`：10个 weapon projectileSpeed ×2.6
  - `shop-system.js`：7个 weapon projectileSpeed ×2.6
  - `equip-tooltip-manager.js`：speedMap 硬编码值 ×2.6
  - `effects/*`（8个文件）：所有粒子速度、alpha衰减率、swingSpeed、floatSpeed ×2.6
- **效果**：整体速度为原始 px/帧 基准的 6.5 倍（2.5×2.6），手感更快
- **构建验证**：通过

### 能量轻机枪散布改造修复（2026-06-30）
- **问题**：装备特制制退器（-10°）+ 重型后握（-5°）后，浮窗显示散布角度为0°，但实际射击仍有散布
- **原因**：`_fireRanged` 中能量轻机枪的散布计算硬编码 `maxSpreadAngle = 15`，**没有应用改造效果** `craftEffects.maxSpreadAngleDelta`
- **修复**：`player.js` 行 2123：`maxSpreadAngle = 15 + (craftEffects?.maxSpreadAngleDelta || 0)`，添加负数保护（`<0` 时设为0）
- **构建验证**：通过

### 帧率问题修复（2026-06-30）
- **问题**：帧率影响游戏速度（30fps慢、120fps快）
- **原因**：所有位置更新使用"px/帧"单位，没有 `dt` 缩放
- **修复方案**：将所有 `this.x += speed` 改为 `this.x += speed * (dt / 16.67)`
- **修改文件**：
  - `game.js`：回滚 dt 限制，恢复标准可变 dt；`EffectManager.update(dt)` 传递 dt
  - `src/combat/projectile.js`：`update(dt)`，子弹飞行、射程、墙壁碰撞全部乘 dt 缩放
  - `src/entities/player.js`：闪避位移、普通移动（`this.x += this.vx * scale`）
  - `src/entities/enemy.js`：敌人移动（路径跟随 + 直接追踪）
  - `src/effects/effect-manager.js`：`update(dt)`，传 dt 给所有子特效
  - `src/effects/*.js`（14个文件）：所有特效添加 `update(dt)`，位置/生命/alpha 全部乘 dt 缩放
    - blood-hit-effect.js, shell-casing.js, poison-effect.js, weapon-effect.js
    - floating-text.js, particle-effects.js, muzzle-flash.js, smoke-effect.js
    - dash-effects.js, sweep-effect.js, slash-effect.js, thrust-effect.js
    - attack-range-effect.js, nightflame-effect.js
- **效果**：60fps 为基准，120fps 速度不变，30fps 速度不变
- **注意**：速度常数（CONFIG.PLAYER_SPEED 等）保持"px/帧"单位，通过 `(dt / 16.67)` 缩放实现帧率无关
- **速度倍率调整**（2026-06-30）：所有速度常数统一 ×2.5，恢复高帧率下的手感
  - 修改文件：
    - `config.js`：PLAYER_SPEED 0.875→2.1875, PLAYER_SPRINT 1.5→3.75, DODGE_SPEED 12→30
    - `enemy-data.js`：14个敌人 speed ×2.5
    - `enemy-types.js`：13个敌人 speed ×2.5, 2个 projectileSpeed ×2.5, config.speed || 1.0→2.5
    - `player.js`：12个 RangedAttack projectileSpeed ×2.5
    - `equip-data-manager.js`：10个 weapon projectileSpeed ×2.5
    - `shop-system.js`：7个 weapon projectileSpeed ×2.5
  - 总计约 59 个常数修改，构建验证通过

### 训练用弓动画修复（2026-06-30）
- **问题**：9帧动画只播放8帧（`Math.min(7, Math.floor(attackProgress * 8))` 硬编码），第9帧永远跳过；攻击间隔1000ms比动画总时长1500ms短，动画被下一次攻击打断，提前结束
- **修复**：
  - `player.js` `renderWeapon`：帧索引计算从硬编码8帧改为 `Math.min(frameCount - 1, Math.floor(attackProgress * frameCount))`，支持任意帧数
  - `player.js` `_getAnimMs`：弓类动画使用武器配置中的 `attackInterval`（`currentItem.attack.attackInterval`），而不是固定 `WeaponAnimConfig.bow.attackInterval`
  - `player.js` `_applyEnchantAttackInterval`：弓类攻击冷却使用武器配置中的 `attackInterval` 作为基础冷却，不同弓可以独立设置攻击间隔
  - `player.js` `_fireRanged`：弓类箭矢速度从武器配置 `currentItem.attack.projectileSpeed` 获取，覆盖通用 `ranged` 配置的默认值
  - `equip-data-manager.js` / `shop-system.js`：训练用弓 `attackInterval` 1000→1500，与动画 windup(500)+swing(1000)+recover(0)=1500ms 匹配
- **效果**：训练用弓9帧完整播放，动画不被攻击打断，箭矢速度使用武器配置值（75）

### 能量轻机枪（weapon15）
- 已添加定义：类型机枪，双手武器，**独立贴图** `devotion-icon.png` / `devotion-equip.png`
- 攻击模式：按住鼠标持续开火，射速线性提升（**333ms**→50ms，**2.5s**内）
- 伤害公式：6 + 力量*(0.35+0.10*强化等级) + 精神*(0.35+0.15*强化等级)
- 射程1200px，子弹速度1800px，亮绿色曳光弹，无限子弹
- 过热系统：4s过热，**4s**冷却（停止开火后恢复）
- **移动速度惩罚**：-50%（与其他机枪一致），改造效果可抵消
  - `player.js`：`isPkmEquipped` 添加 `energy_lmg`，开火时禁止冲刺
- **浮窗攻击力公式修复**：`equip-tooltip-manager.js` 添加 `weaponId === 'weapon15'` 和 `weaponType === 'energy_lmg'` 分支
- **改造配置**：7个改造位（枪口、枪管、瞄具、弹夹、子弹、握把、后托）
  - 新增改造效果字段：`overheatTimeDelta`, `overheatRecoverDelta`
  - 枪口：特制制退器（散布时间+0.5s，散布角度-10°）、边境散热器（过热+1s）
  - 枪管：短枪管（射程-200，散布开始+0.5s，移速+10%）、长枪管（射程+200，弹速+20%，散布开始+1s，最大散布+1s）
  - 弹夹：能量扩容弹箱（过热+2s，移速-10%）、快速能量弹夹（过热-1s，移速+10%）
  - 子弹：高能量子弹（射程+200，伤害+5%，散布开始-0.5s）、强穿透子弹（穿透+2）
  - 握把/后托：复制 PKM 配置
  - 瞄具：复制 PKM 红点/三倍镜
  - 过热改造效果在 `player.js` 中实时应用（最小值保护：过热时间≥1s，恢复时间≥0.5s）
- 散布：即时开始，2.5s达到最大，最大±15°
- 音效：apex_shot_600ms.wav（开火），apex_reload_4s_raw.mp3（过热）
- 改造配置：已添加（复制QJB-201配置）
- **图鉴/浮窗**：新增过热时间、达到最大射速时间显示；攻击力公式已添加
- **浮窗武器参数**：`equip-tooltip-manager.js` 已加入 `energy_lmg` 到 `isGun` 判断，显示完整武器参数区块
  - 弹速：speedMap 添加 `weapon15: 45`
  - 散布参数：spreadBaseMap 添加 `energy_lmg: { start: 0, max: 2500, angle: 15 }`
  - 子弹数：显示"无限"，不显示换弹时间
  - 特殊参数：过热时间（4s+改造）、过热恢复时间（4s+改造）、达到最大射速时间（2.5s）
  - 武器特效：过热时间支持改造效果动态计算
- **WeaponTransform**：已添加 `energy_lmg` 配置，Phaser持有位置正确
- **WeaponAnimConfig**：已添加 `energy_lmg` 配置（timingMul: 0.25, recoilAmount: 0.10）

### 子弹碰撞修复（2026-06-30）
- `projectile.js`：修复 `for-of Map` 遍历错误（`Array.from(this.entities.values())`）
- `projectile.js`：新增墙壁碰撞检测（`WallSystem.blocked`）
- 原因：Phaser迁移后 `this.entities` 从 `Array` 改为 `Map`，`for-of` 遍历的是 `[key, value]` 对而非实体

### 商店修复
- `shop-system.js`：新增能量轻机枪到商店列表（价格2000）
- `game-style.css`：`.shop-section` 添加 `min-height: 0`，确保滚动条正常显示

### 改造系统（CraftSystem）
- 基础改造栏：PKM(weapon6)、AKM(weapon7)、G18(weapon9)、沙漠之鹰(weapon10)
- 自定义布局：编辑模式可拖动格子和虚线，保存到内存（刷新丢失）
- 改造效果：rangeDelta、knockbackDelta、spreadTimeDelta、spreadStartDelta、reloadTimeDelta、magazineDelta、projectileSpeedPercent、moveSpeedPercent、maxSpreadAngleDelta、hideMuzzleFlash、highPowerScope、redDotScope、damagePercent、slugMode、flechetteMode、piercingBonus、magazineOverride、critChancePercent、slugRecoilRecovery、fastReload、attackIntervalDelta、recoilRecoveryDelta、shotSpreadDelta
- **weapon2 改造配置**：已添加 slots + options，但效果实现待测试验证
- **isCraftableWeapon**：已恢复，剑类武器可放入改造栏

### 夜与火之剑限制
- `player.js` 的 `switchWeaponMode` 已添加 `_specialAttackActive` 检查

### 流血效果
- `enemy.js` 已添加 `_updateBleed` 和 `applyBleeding`
- `status-bar.js` 已添加 `bleed` 状态
- `attack.js` 和 `whirlwind-system.js` 已添加 `bleedingOnHit` 触发

### 防御穿透/暴击/体力/格挡等效果
- `damageable-entity.js`：暴击率改造效果
- `player.js`：防御力、次级格挡、攻击间隔
- `attack.js`：体力消耗、攻击距离
- `dash-system.js`：冲刺体力、距离、双倍伤害
- `quick-bar.js`：风车体力消耗

## 已备份记录
- `v2026-06-30_11-14-32`：完整备份（速度常数统一×2.6，构建验证通过）
- `v2026-06-30_11-02-07`：完整备份（px/秒 + dt/1000 彻底方案 + 能量轻机枪散布修复）
- `v2026-06-30_10-06-12`：完整备份（帧率无关修改后，所有位置更新改为 dt 缩放）
- 保留最新 3 个版本，自动清理旧版本

## 当前问题（待排查）
- ~~**帧率问题修复**：已将 px/帧 彻底改为 px/秒，缩放因子改为 dt/1000，构建验证通过~~
- 改造栏自定义布局未持久化（刷新丢失，只保存到内存）
- 改造效果实现已添加到代码中，但需要在游戏中实际测试验证
- ~~自定义布局数据（之前拖动保存的坐标）已丢失~~ → 已恢复为游戏中保存的坐标
- **技能检查**：突刺 damageMul 已修复；大马士革钢已修复为只在第一次判定触发；风车半径从 150 改为 120
- **技能图标**：暴击、风车、冲刺攻击图标已更新，升级动画同步替换
- **能量轻机枪**：已添加，在(-874, -136)横向生成所有武器（含新武器），间隔50px
- ~~武器横向生成坐标~~ → **已修复**：`spawnAllWeapons()` 改为使用相对于主神空间中心（origin）的坐标

### 坐标系统统一（2026-06-30）
- **问题**：游戏中使用3种坐标系，混乱且武器生成位置在视野外
  - 世界坐标：player.x, player.y — 游戏内部逻辑使用
  - 显示坐标：worldToDisplay() = world - origin — 原 uiPos 使用
  - 屏幕坐标：worldToScreen() = world - Camera + VIEW_CENTER — 渲染使用
- **修改**：
  - `system-ui.js`：`uiPos` 直接显示世界坐标（`player.x, player.y`），不再使用 `worldToDisplay()`
  - `game.js`：`spawnAllWeapons()` 改为使用相对于主神空间中心（origin）的坐标
    - 旧：`baseX = -874`（世界坐标，在视野外）
    - 新：`baseX = origin.x + (-874)`（相对于 origin，在玩家附近）
  - 生成日志：显示实际世界坐标和 origin 参考点
- **效果**：武器现在在玩家附近可见，坐标显示统一为绝对世界坐标

## 工作准则（强制执行）
1. 每次对话先读取此文件
2. 每次修改前运行 `node scripts/backup.js`
3. 修改后构建验证
4. 不要重复做"已完成"列表中的功能
5. 不要删除任何现有功能
6. 最小修改：只动目标功能
7. 版本号在 build 时自动递增（运行 `npm run build`）
8. Git 已跟踪所有 src 文件，可回滚到任意提交

## 回滚指令
如果功能被破坏，回滚到当前备份：
```bash
cd game-dev && git checkout HEAD -- src/ui/craft-system.js
# 或恢复完整备份：
# 从 backup/v2026-06-30_07-45-36/src/ 复制到当前目录
```

---

## 2026-06-30 更新：符文长剑/夜与火之剑改造 + 无人机技能

### 符文长剑（weapon4）改造配置
- **slots**：剑刃、护手、握把、剑身×2、配重（6个格子）
- **剑刃选项**：
  - 轻量化剑刃：攻击间隔-50ms
  - 淬火硬化刃口：暴击率+10%
  - 厚重钝化：防御穿透+20%
  - 魔力刀刃：攻击时附加1层魔力易伤（持续5s）
- **护手选项**：
  - 小型圆盘护手：攻击间隔-50ms
  - 宽十字护手：次级格挡（50%概率减伤50%）
  - 无护手：攻击间隔-100ms，体力消耗-5，防御力-25%
- **握把选项**：
  - 缠绳附加长柄：攻击/技能体力消耗-5
  - 短柄紧凑型握把：攻击间隔-50ms
- **剑身选项（×2）**：
  - 符文重构：特殊攻击额外生成2把魔法剑（向外20px）
  - 锐利符文：特殊攻击魔法防御穿透+20%
  - 鹰眼符文：特殊攻击魔法剑攻击距离+150px
  - 毁灭符文：特殊攻击击中后附加2层魔力易伤
- **配重选项**：
  - 轻量化剑身：攻击间隔-50ms
  - 配重锤增重：体力消耗+5，攻击+8%
  - 镂空小球：体力消耗-5

### 夜与火之剑（weapon5）改造配置
- **slots**：与符文长剑相同（6个格子）
- **剑刃选项**：
  - 轻量化剑刃：攻击间隔-50ms
  - 淬火硬化刃口：暴击率+10%
  - 厚重钝化：防御穿透+20%
  - 易伤刀刃：攻击时附加1层魔力易伤
  - 附魔刀刃：攻击命中时附加武器攻击力的魔法伤害
- **剑身选项（×2）**：
  - 符文重构：特殊攻击持续时间+0.5s，期间持续计算伤害
  - 锐利符文：特殊攻击魔法防御穿透+20%
  - 鹰眼符文：特殊攻击攻击距离+200px
  - 毁灭符文：特殊攻击每次击中后附加2层魔力易伤

### 新效果系统
- **魔力易伤（Magic Vulnerability）**：
  - 叠层 debuff，每层+5%魔法伤害（加法）
  - 持续时间5s，层数逐层衰减
  - 应用于 `damageable-entity.js`：魔法伤害 * (1 + stacks * 0.05)
  - 状态栏：`StatusBar` 类型 `magicVulnerability`
  - 敌人：`enemy.js` 添加 `_updateMagicVulnerability` 和 `applyMagicVulnerability`
- **魔法防御穿透（Magic Penetration）**：
  - `craftEffects.magicPenetrationPercent`
  - `damageable-entity.js` `takeDamage` 中魔法伤害分支应用
- **附魔刀刃（Enchanted Blade）**：
  - `craftEffects.enchantedBlade`
  - `attack.js` 命中后额外调用 `takeDamage(weaponAtk, source, 'magic')`
- **符文重构（Rune Restructure）**：
  - 符文长剑：`rune-sword-system.js` 根据 `runeRestructureCount` 生成额外剑（依次向外20px）
  - 夜与火：`special-attack-system.js` 根据 `specialDurationDelta` 延长持续时间

### 无人机技能（droneSkill）
- **技能定义**：`skills.json` + `player.js` fallback，maxLevel 20
- **技能图标**：`assets/skills/无人机.png`（召唤图标 `assets/skills/drone.png`）
- **效果**：
  - 基础持续时间 30s，每级+2s
  - 无人机易伤：受到伤害+10%（每级+2%），暴击率+10%（每级+2%）
  - 每5级：移速+50px/s，范围+100px
- **状态机**：
  - 第1次点击快捷键：释放无人机（人物前方50px）
  - 第2次点击：进入操控模式（WASD控制，镜头跟随）
  - 第3次点击：退出并回收无人机
- **实现文件**：`drone-system.js`（新文件）
- **集成**：
  - `player.js`：导入、初始化、update、render、复活重置
  - `quick-bar.js`：`_updateSlot` 支持 `iconImage`，`useSlot` 支持 `droneSkill`
  - `skill-manager.js`：经验获取（`addDroneExp`）、升级显示、技能列表
- **经验获取**：击杀被无人机影响的敌人 +10 经验

### 快捷栏图标修复
- `quick-bar.js` `_updateSlot`：支持 `skill.iconImage` 显示图片图标

### 修改文件汇总
- `src/ui/craft-system.js`：weapon4/weapon5 改造配置 + 新效果汇总
- `src/combat/attack.js`：魔力易伤、附魔刀刃触发
- `src/entities/components/rune-sword-system.js`：符文重构、鹰眼、毁灭符文
- `src/entities/components/special-attack-system.js`：符文重构、鹰眼、锐利、毁灭符文
- `src/entities/drone-system.js`：新增（无人机系统）
- `src/entities/player.js`：无人机集成、复活重置、_initSkills fallback
- `src/entities/damageable-entity.js`：魔力易伤、魔法防御穿透、无人机易伤
- `src/entities/enemy.js`：魔力易伤/无人机易伤更新
- `src/ui/quick-bar.js`：图标支持、无人机快捷键
- `src/ui/skill-manager.js`：无人机经验、详情显示
- `src/ui/status-bar.js`：magicVulnerability / droneVulnerability 状态
- `data/skills.json`：droneSkill 配置
- `assets/skills/无人机.png` + `drone.png`：技能图标

### 构建验证
- 通过（2026-06-30）

### 备份
- `v2026-06-30_11-24-52`：本次修改前的完整备份

### 盾牌系统优化（2026-07-01 02:23）
- **图层顺序**：Phaser `playerSprite.setDepth(100)`, `weaponSprite.setDepth(150)`, `offhandWeaponSprite.setDepth(149)`；Canvas 渲染顺序 body → `renderWeapon` → shield → defense glow → direction arrow，确保所有装备在玩家之上
- **盾牌位置**：`player.js` `ctx.translate(20, -20)`（右上方，Canvas 坐标系）
- **浮窗防御参数**：`equip-tooltip-manager.js` 盾牌分支显示防御力公式（基础 + 强化等级 × 每级加成）、防御减少伤害、防御受击体力、弹反眩晕时间；新增防具特效（暂无）
- **强化公式**：`totalDef = baseDef + enhanceLevel × perEnhance`，与数据文件 `equipment.json` 中 `defense` 结构一致

### 构建验证
- 通过（2026-07-01 02:23:58）

### 备份
- `v2026-07-01_02-23-58`：本次修改的完整备份

---

## 2026-07-01 更新

### 小鼠侍从NPC + 任务系统
- **文件**：`src/entities/npc.js`, `src/ui/npc-dialogue.js`, `src/ui/quest-system.js`, `src/quest/rift-system.js`, `src/ui/reward-system.js`, `src/game.js`, `src/world/scene-manager.js`, `index.html`, `game-style.css`
- **NPC**：小鼠大王左侧100px生成小鼠侍从（黄色圆圈，size 20），10句侍从随机对话，4按钮（开始任务/了解信息/获取帮助/再见）
- **任务界面**：左栏场景选择（雪地/列车上/古堡），右上模式选择（主线任务/自由探索），右下任务详情
- **主线任务一**：寻找时空裂隙 → 雪地场景3个时空裂隙（相距≥2000px），浅蓝圆+绿色圈，90秒进度条累积，完成后生成返回传送门
- **奖励结算**：黑背景3张307×523卡牌（附魔之礼/强化之礼/改造之礼），三选一，提升一级
- **任务模式雪地**：15秒后首次生成僵尸，每15秒5只（普通60%精英30%首领10%），无区域BOSS，无传送门
- **死亡处理**：任务中死亡回主神空间，重置任务状态，需重新对话

### 小圆盾（weapon17）系统
- **数据**：`equip-data-manager.js` / `shop-system.js` / `data/equipment.json` / `drop-item.js` 四处同步
- **装备规则**：`isOneHanded('shield')` 返回 true，装备到副手栏（offhand/ring2），双手武器主手自动卸下
- **防御机制**：`shield-system.js` — 长按右键进入防御，移动速度-50%，禁止攻击/技能/奔跑；减伤50%扣20体力；弹反（防御1秒内受近战攻击）→ 攻击者眩晕1秒+击退100px
- **渲染**：`player.js` 添加 `shieldImage` 加载 `woodshied-equip.png`，在 `render` 中绘制于 `(0, 20)`，防御状态红光闪烁特效

### 大块头 Boss（BigBoss）
- **数据**：`enemy-types.js` — HP 8000×20, size 40×4, atk 51×3, def 91×1.25, mdef 6×1.25
- **技能**：蓄力扇形斩（150px/120°，×2伤害，6秒CD）、蓄力冲锋（400px/s，×3伤害，25秒CD，800px优先）、召唤小僵尸（2只，60秒CD）
- **生成**：雪地场景距离主角2000px，小地图红色❌标记

### 怪物状态栏系统（独立）
- **文件**：`src/entities/damageable-entity.js`, `src/entities/enemy.js`
- **系统**：每个怪物拥有独立的 `statusEffects` 数组（{ type, duration, remaining, icon, name, color, stacks }）
- **方法**：`addStatusEffect()` / `hasStatusEffect()` / `removeStatusEffect()` / `updateStatusEffects(dt)`
- **眩晕**：`applyStun()` 通过 `addStatusEffect('stun', duration)` 添加，敌人 `update` 中 `hasStatusEffect('stun')` 检测
- **支持类型**：stun, poison, slow, buff, shield, bleed, magicVulnerability, droneVulnerability

### 蜘蛛攻击修复
- **修复**：`attack.js` 中 `source.equipments[source.weaponMode]` 对怪物抛出 `TypeError`，改为安全访问 `source.equipments && source.weaponMode ? source.equipments[source.weaponMode] : null`
- **攻击范围颜色**：`AttackRangeEffect` 从白色 `#ffffff` 改为红色半透明，雪地背景可见

### 构建验证
- 通过（2026-07-01 00:18:03）

### 备份
- `v2026-07-01_00-18-03`：本次修改的完整备份

---

## 2026-07-01 02:39 更新

### 剑类武器攻击力公式调整
- **文件**：`src/entities/player.js` (`getCurrentWeaponAtk` 方法)
- **生锈的长剑 (weapon1)**：`6 + 强化 + 力量×0.5 + 敏捷×0.5` → `12 + 强化 + 力量×(0.8+强化×0.2) + 敏捷×(0.8+强化×0.2)`
- **骑士长剑 (weapon2)**：`10 + 强化 + 力量×1 + 敏捷×0.5` → `20 + 强化×2 + 力量×(2+强化×0.35) + 敏捷×(1.5+强化×0.25)`
- **符文长剑 (weapon4)**：`8 + 强化 + 力量×0.6 + 智力×1` → `16 + 强化×2 + 智力×(2+强化×0.4) + 力量×(1.2+强化×0.2)`
- **夜与火之剑 (weapon5)**：`12 + 强化 + 力量×1.2 + 智力×1` → `24 + 强化×2.2 + 智力×(2+强化×0.5) + 力量×(1.2+强化×0.2)`

### 特殊攻击伤害公式与浮窗更新
- **文件**：`src/entities/components/rune-sword-system.js`, `src/entities/components/special-attack-system.js`, `src/ui/equip-tooltip-manager.js`, `public/data/equipment.json`, `data/equipment.json`
- **符文长剑 (weapon4)**：伤害 = `⌊魔法攻击 × 1.2 + 武器攻击力⌋`；4把悬浮剑，右键发射；30秒持续；5秒冷却
- **夜与火之剑 (weapon5)**：伤害 = `⌊(60 + 力量×1.5 + 敏捷×1.25) × 0.25⌋`；每200ms判定一次；3秒持续；5秒冷却
- 浮窗特殊攻击栏目已更新显示伤害类型、伤害公式、持续时间、冷却时间

### 手枪+盾双持规则调整
- **文件**：`src/entities/player.js`
- **瞄准模式**：手枪+盾时不可进入瞄准模式（`isDualWield` 包含盾，已自动生效）
- **防御中攻击**：修改防御状态提前返回逻辑，主手为手枪时防御状态下仍允许攻击（左键射击）
- **换弹时间**：双持模式下（副手为手枪或盾）换弹时间 +50%（`Math.round(reloadTime × 1.5)`）
- **副手影响**：修复原代码只处理主手换弹的bug，现在副手手枪换弹时也会正确检查主手并应用惩罚

### 构建验证
- 通过（2026-07-01 02:39:10）

### 备份
- `v2026-07-01_02-39-10`：本次修改的完整备份

---

## 2026-07-01 03:01 更新

### UI改造：右侧栏目图标
- **文件**：`index.html`, `game-style.css`, `src/config/config.js`, `src/ui/input.js`
- **图标缩小**：`99px→74px`，透明度 `50%`
- **图标替换**：5个自定义图片（人物状态/背包/技能/图鉴/任务）
- **Hover效果**：放大 `1.25` 倍 + 金色高亮 `drop-shadow`
- **快捷键文字**：图标下方金色闪烁文字（`keyHintBlink` 动画）
- **快捷键调整**：图鉴 `L→O`，新增任务栏 `L`

### 任务日志系统
- **文件**：`src/ui/quest-system.js`（重写）
- **界面**：类似图鉴栏，左栏任务列表（带滚动条），右栏任务详情（带滚动条）
- **第一个任务**：「探索时空裂隙」— 收集3个时空裂隙线索 + 从181世界撤离
- **状态显示**：未接受/进行中/已完成（灰色+删除线+绿色勾）

### 任务追踪栏
- **文件**：`game-style.css`, `src/game.js`
- **位置**：左上角（地图栏下方）
- **显示**：进行中的任务名称 + 具体目标进度（如 `0/3`）
- **更新**：裂隙完成/撤离时自动刷新

### 雪地场景联动 + 奖励机制
- **文件**：`src/quest/rift-system.js`, `src/game.js`
- **裂隙完成**：调用 `QuestState.completeRift(index)` 更新进度
- **撤离完成**：传送门使用 → `QuestState.completeEvacuation()` → `QuestState.finishQuest()`
- **奖励**：提升一级 + 500金币 + 随机优质武器（背包满则放地上）

### 等级提升机制（保留经验值）
- **文件**：`src/ui/quest-system.js`（`LevelUpSystem`）
- **逻辑**：记录当前经验值 → 等级+1 → 经验值加到新等级的经验条中

### 构建验证
- 通过（2026-07-01 03:01:52）

### 备份
- `v2026-07-01_03-01-52`：本次修改的完整备份

---

## 2026-07-01 03:17 更新

### Bug 修复
- **QuestState.isInQuest**：`src/ui/quest-system.js` 中添加 `isInQuest()` 方法，修复任务模式进入雪地报错

### 右侧栏目图标调整
- **文件**：`game-style.css`, `index.html`
- **透明度**：默认 `100%`（去掉 `0.5` 透明度）
- **间隔**：`12px → 50px`
- **图片拉伸**：`object-fit: cover` 占满整个格子
- **背景透明**：去掉 `background: linear-gradient(...)`，改为 `transparent`

### 快捷键调整
- **状态栏**：`I → CapsLock`
- **背包**：`C → Tab`
- **提示更新**：菜单界面和帮助界面的快捷键提示已同步更新

### 任务追踪栏位置
- **文件**：`game-style.css`
- **位置**：`top: 12px → 100px`（向下移动，避免与顶部状态栏重叠）

### 构建验证
- 通过（2026-07-01 03:17:33）

### 备份
- `v2026-07-01_03-17-33`：本次修改的完整备份

---

## 2026-07-01 03:44 更新

### 背包快捷键 TAB 修复
- **文件**：`src/ui/input.js`
- **原因**：`CONFIG.KEYS.INVENTORY` 和 `CONFIG.KEYS.BACKPACK` 都指向 `'Tab'`，导致同一按键被处理两次，面板打开后立即关闭
- **修复**：合并为 `if (code === CONFIG.KEYS.INVENTORY || code === CONFIG.KEYS.BACKPACK)` 一行处理

### 治疗/魔力药水重做
- **文件**：`public/data/equipment.json`, `src/ui/quick-bar.js`, `src/ui/equip-manager.js`, `src/ui/equip-tooltip-manager.js`
- **图标**：新贴图（`assets/items/health_potion.png` / `mana_potion.png`）
- **治疗药水**：恢复 `⌊最大生命×20% + 体质×2⌋` 生命值
- **魔法药水**：恢复 `⌊最大魔法×20% + 智力×10% + 精神×10%⌋` 魔法值
- **使用方式**：右键背包中使用 / 拖入快捷栏（1-4）快捷键使用
- **浮窗**：显示恢复类型、恢复公式、使用方式

### 生命/魔法回复属性
- **文件**：`src/entities/player.js`, `src/ui/system-ui.js`, `src/ui/game-ui-manager.js`, `index.html`
- **hpRegen**：每秒生命回复，基础值 `1`（1秒1点）
- **mpRegen**：每3秒魔法回复，基础值 `1`（3秒1点，即 1/3点/秒）
- **状态栏**：详细信息中添加「生命回复」和「魔法回复」显示

### 构建验证
- 通过（2026-07-01 03:44:02）

### 备份
- `v2026-07-01_03-44-02`：本次修改的完整备份
