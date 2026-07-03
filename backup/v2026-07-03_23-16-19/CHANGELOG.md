# 变更日志

## 格式
每次对话结束时记录：
- 对话日期
- 修改的文件
- 修改内容摘要
- 测试结果
- 已知问题

## 2026-07-03

### 对话 1：战术小队武器系统 + 弹道渲染 + 无人机状态栏（v0.196）
- **修改文件**（41 个文件，+6647 -567 行）：
  - `src/entities/combatant.js`：新建 Combatant 基类，共享武器/弹药/散布/过热系统
  - `src/entities/humanoid-monster.js`：新建 HumanoidMonster 基类 + 5 个战术小队子类（Commander/MachineGunner/Rifleman/FlankRifleman/ShieldBearer）
  - `src/entities/enemy.js`：改为继承 Combatant，Enemy._updateMovement 支持 _tacticalTarget 和 _specialTacticalTarget
  - `src/entities/player.js`：导入 StatusBar；新增 applyDroneVulnerability / removeDroneVulnerability 状态栏集成（🛸 + 5秒倒计时）
  - `src/entities/combatant.js`：fireProjectile 中敌人使用 isTracer 曳光弹；修复 Projectile 参数顺序错误（noRender='physical' 导致弹道不可见）
  - `src/combat/projectile.js`：isTracer 曳光弹渲染（淡金色弹道线）
  - `src/ai/tactical-squad-ai.js`：共享视野 + 死追到底 + 附近搜索；指挥官无人机技能自动施加/移除；渲染红色虚线圆圈（800px）
  - `src/ai/battle-commander.js`：新建战场指挥 AI
  - `src/ai/synergy-system.js`：新建协同效应系统
  - `src/systems/combat-system.js`：新建 CombatSystem，双路径（_isHumanoid 走 fireProjectile / 传统走 attack.use）
  - `src/systems/perception-system.js`：新建感知系统
  - `src/systems/decision-system.js`：新建决策系统
  - `src/systems/movement-system.js`：新建移动系统
  - `src/systems/formation-system.js`：新建阵型系统
  - `src/systems/spatial-partition-system.js`：新建空间分区系统
  - `src/systems/tactical-squad-role-switch.js`：新建角色晋升系统
  - `src/world/scene-manager.js`：场景五 _loadScene5 战术小队生成；WallSystem.canMoveTo 墙壁检测防止卡墙
  - `src/world/renderer.js`：renderMinimap 使用 e._faction 和 e.itemData 替代 instanceof Enemy/DropItem（避免 ES 模块导入失效）
  - `data/humanoid-squad-config.json`：新建外部配置（武器 + 角色）
  - `data/humanoid-weapon-config.json`：新建武器回退配置
  - `src/main.js`：挂载所有新类到 window
  - `index.html`：版本号更新到 V0.196
  - `src/game.js`：版本号更新到 0.196
- **修改内容摘要**：
  1. 战术小队使用玩家同款真实武器系统（5种枪械 + 弹药/过热/散布）
  2. 修复弹道不可见：fireProjectile 参数顺序错误导致 noRender='physical'（truthy）→ 弹丸不渲染
  3. 修复 CombatSystem 重复 _updateAttack 覆盖导致战术小队无法开火
  4. 修复 renderer.js 小地图实体检测：Array.isArray 不支持 Map；instanceof Enemy 因未导入永远为 false
  5. 新增指挥官无人机技能：自动施加/移除无人机易伤；状态栏显示 🛸 图标 + 5秒倒计时
  6. 修复场景五卡墙：WallSystem.canMoveTo 墙壁检测，玩家和战术小队生成前检查安全位置
  7. 修复 Enemy 继承 Combatant 后数据字段覆盖：Object.assign 合并而非直接赋值
  8. 修复战术小队武器渲染：entity-local 坐标系 + Math.PI/2 旋转对齐 + 统一尺寸
- **测试结果**：游戏正常进入场景五，战术小队开火、弹道可见、玩家掉血、无人机状态栏显示
- **已知问题**：
  - 战术小队偶尔被复杂地形卡住，需进一步优化寻路
  - 无人机 debuff 在指挥官死亡后不会自动清除（应清理）
  - 指挥官红色范围圈在指挥官死亡后仍显示（应隐藏）

## 2025-06-30

### 对话 6：武器横向生成
- **修改文件**：
  - `src/ui/equip-data-manager.js`：添加 `ENERGY_LMG_ITEM`
  - `src/game.js`：新增 `_WEAPON_SPAWN_LIST` 武器列表；新增 `spawnAllWeapons()` 方法；替换旧 `spawnWeapon` 调用
- **测试结果**：`vite build` 通过
- **已知问题**：无

### 对话 5：添加能量轻机枪（weapon15）
- **修改文件**：
  - `data/equipment.json`：添加能量轻机枪定义
  - `src/config/gun-ammo.js`：添加机枪类型、全自动、双手武器配置
  - `src/entities/player.js`：能量轻机枪攻击配置、伤害公式、射速线性提升、过热系统、无限子弹、亮绿色曳光弹
  - `src/combat/projectile.js`：亮绿色曳光弹渲染（isGreen）
  - `src/ui/craft-system.js`：weapon15 改造配置
  - `assets/sounds/`：添加音效文件
- **测试结果**：`vite build` 通过
- **已知问题**：无
