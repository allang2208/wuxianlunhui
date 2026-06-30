# 项目状态

## 版本号
- 当前版本：0.7.3
- 备份计数：0
- 上次构建：2025-06-29

## 已完成的功能（不要重复做）

### 改造系统（CraftSystem）
- 基础改造栏：PKM(weapon6)、AKM(weapon7)、G18(weapon9)、沙漠之鹰(weapon10)
- 自定义布局：编辑模式可拖动格子和虚线，保存到内存（刷新丢失）
- 改造效果：rangeDelta、knockbackDelta、spreadTimeDelta、spreadStartDelta、reloadTimeDelta、magazineDelta、projectileSpeedPercent、moveSpeedPercent、maxSpreadAngleDelta、hideMuzzleFlash、highPowerScope、redDotScope、damagePercent、slugMode、flechetteMode、piercingBonus、magazineOverride、critChancePercent、slugRecoilRecovery、fastReload、attackIntervalDelta、recoilRecoveryDelta、shotSpreadDelta
- **新增（未完成）**：weapon2 改造配置已添加，但效果字段在 player.js/attack.js 等文件的实现可能已丢失，需要重新验证

### 夜与火之剑限制
- `player.js` 的 `switchWeaponMode` 已添加 `_specialAttackActive` 检查

### 流血效果
- `enemy.js` 已添加 `_updateBleed` 和 `applyBleeding`
- `status-bar.js` 已添加 `bleed` 状态
- 但改造触发流血的效果实现需要验证

## 已备份记录
暂无

## 当前问题
- 改造栏自定义布局未持久化（刷新丢失）
- 需要确认之前所有修改的集成效果是否完整

## 工作准则（强制执行）
1. 每次对话先读取此文件
2. 每次修改前运行 `node scripts/backup.js`
3. 修改后构建验证
4. 不要重复做"已完成"列表中的功能
5. 不要删除任何现有功能
6. 最小修改：只动目标功能
