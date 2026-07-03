# 变更日志

## 格式
每次对话结束时记录：
- 对话日期
- 修改的文件
- 修改内容摘要
- 测试结果
- 已知问题

## 2025-06-30

### 对话 6：武器横向生成
- **修改文件**：
  - `src/ui/equip-data-manager.js`：添加 `ENERGY_LMG_ITEM`
  - `src/game.js`：
    - 新增 `_WEAPON_SPAWN_LIST` 武器列表（14把武器按顺序）
    - 新增 `spawnAllWeapons()` 方法：在(-874, -136)横向生成，间隔50px
    - 替换 `start()` 中的旧 `spawnWeapon` 调用
- **测试结果**：`vite build` 通过
- **已知问题**：无

### 对话 5：添加能量轻机枪（weapon15）
- **修改文件**：
  - `data/equipment.json`：添加能量轻机枪定义（weapon15，类型energy_lmg）
  - `src/config/gun-ammo.js`：添加机枪类型、全自动、双手武器配置
  - `src/entities/player.js`：
    - 添加能量轻机枪攻击配置和状态变量
    - 添加伤害公式（6 + 力量*(0.35+0.10*强化等级) + 精神*(0.35+0.15*强化等级)）
    - 实现射速线性提升（250ms→50ms，1.5s内完成）
    - 实现过热系统（4s过热，2.5s冷却）
    - 添加无限子弹、亮绿色曳光弹、apex音效
    - 更新所有武器类型检测包含energy_lmg
  - `src/combat/projectile.js`：添加亮绿色曳光弹渲染（isGreen）
  - `src/ui/craft-system.js`：添加weapon15改造配置
  - `assets/sounds/`：添加apex_shot_600ms.wav和apex_reload_4s_raw.mp3
- **测试结果**：`vite build` 通过
- **已知问题**：无

### 对话 4：更新技能图标
- **修改文件**：
  - 复制 `暴击.png` `风车.png` `冲刺攻击.png` 到 `assets/skills/`
  - `data/skills.json`：给 dashAttack 添加 `iconImage`、给 whirlwind 添加 `iconImage`、新增 `criticalStrike` 技能定义
  - `src/entities/player.js`：两处硬编码的 criticalStrike 兜底添加 `iconImage`
- **检查结果**：升级动画（level-up-queue.js + skill-manager.js）已使用 `iconImage`，无需修改
- **测试结果**：`vite build` 通过
- **已知问题**：无

### 对话 3：技能效果检查 + 风车半径调整
- **修改文件**：
  - `src/entities/components/dash-system.js`：突刺 damageMul 改为从 skills.json 获取；大马士革钢只在第一次判定触发双倍
  - `data/skills.json`：风车 radius 从 `150 + level * 5` 改为 `120 + level * 5`
- **检查结果**：
  - 突刺 damageMul 与 skills.json 描述不一致 → 已修复
  - 大马士革钢每次判定都触发双倍 → 已修复为只在第一次判定触发
  - 风车、推击、原始冲刺等参数与描述一致
- **测试结果**：`vite build` 通过
- **已知问题**：无

### 对话 2：更新骑士长剑改造栏坐标
- **修改文件**：
  - `src/ui/craft-system.js`：更新 `weapon2` 的 `slots` 坐标为游戏中保存的精确值
- **修改内容**：将剑刃、护手、握把、配重的位置和虚线端点更新为用户在游戏中拖动保存的坐标
- **测试结果**：`vite build` 通过
- **已知问题**：无

### 对话 1：修复改造栏系统
- **修改文件**：
  - `src/ui/craft-system.js`：恢复 `isCraftableWeapon`，添加 `weapon2` 配置，扩展效果字段
  - `src/config/gun-ammo.js`：添加 `isCraftableWeapon` 函数（保留）
  - `scripts/backup.js`：创建，保留最新3个版本
  - `scripts/bump-version.js`：创建，自动递增版本号
  - `package.json`：添加 `prebuild` 钩子
  - `PROJECT_STATE.md`：创建项目状态文件
- **修改内容**：修复了之前回滚导致剑类武器无法放入改造栏的问题，恢复了改造效果字段
- **测试结果**：`vite build` 通过
- **已知问题**：自定义布局数据已丢失，改造效果需在游戏中实际验证
- **备份版本**：`v2026-06-30_06-44-26`
