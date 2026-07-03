# game-dev 项目状态记忆

## 项目信息
- **路径**: `C:\Users\allan\Documents\kimi\workspace\game-dev`
- **架构**: Vite + ES6 模块化（32 个模块），版本 V0.140
- **启动**: `cd game-dev && npx vite`，访问 `http://localhost:5173`
- **刷新**: 每次修改后 **Ctrl + F5** 强制刷新（Vite 模块缓存问题）
- **工作规则**: 不删除现有代码，先注释再验证；深拷贝传递装备数据；事件绑定用 `element.onmouseenter = fn` 而非 `addEventListener`

## 已完成的修复（V0.140）

### 1. 坐标系统（renderer.js）
- `_getSceneOrigin` 回退逻辑：从 `{0,0}` 改为硬编码主场景原点 `{3825, 1886}`
- 优先 `window.SceneManager` → 导入的 `SceneManager` → 硬编码回退

### 2. 状态栏/无法升级（game-ui-manager.js + Enemy.js）
- **根因1**: `game-ui-manager.js` 中 `sp` 未定义，导致 `updateUI` 崩溃
- **修复**: `sp.bars` → `UI_DATA_CONFIG.statusPage.bars` 等5处
- **根因2**: `Enemy.js` 第23行 `this.data = { stamina: 9999, ... }` 覆盖六维属性
- **修复**: 合并 `this.data` 为一次赋值；`expValue` 使用实时计算出的等级

### 3. 黑狼动画（enemy-types.js）
- `BlackWolf` 构造函数接受 `config` 参数，`speed` 等配置正确传递到父类

### 4. G18 攻击力（player.js）
- `_fireRanged` 中手枪/弓伤害优先调用 `getCurrentWeaponAtk()`，包含强化加成

### 5. G18 贴图（player.js + equip-manager.js）
- `pistolImage.src = 'assets/weapons/G18equip.png'`
- 所有装备途径（拖拽/右键/卖出栏）同步更新 `pistolImage` 和 `muzzleFlashImg`

### 6. 191浮窗公式（equip-tooltip-manager.js）
- 新增 `weaponId === 'weapon8'` (QBZ191) 和 `weaponId === 'weapon9'` (G18) 公式分支

### 7. 强化面板（enhance-system.js）
- 删除原有攻击力/射程文字，只保留「预计强化效果」
- `_buildPredictedStats` 新增所有武器的强化后公式

### 8. 树木透视（maze-generator.js）
- 删除白圈特效（`rgba(255,255,255,0.18)` 填充 + 描边）
- 实体检测范围 `60 → 120`；树叶裁剪半径 `30 → 60`

### 9. 双持定义重构（player.js + equip-manager.js）
- **组合1**: weapon(主手1) + offhand(副手1)
- **组合2**: weapon2(主手2) + ring2(副手2)
- `_canEquipSlot`: 所有武器可装备到 offhand/ring2
- `checkDualWieldUnequip`: 同步卸下配对槽位
- `renderWeapon`: 副手G18在镜像对称位置渲染（`scale(-1, 1)`）
- 主手G18使用剑类武器渲染位置（待机+攻击）

### 10. 怪物等级（Enemy.js + codex-manager.js）
- `this.level = Math.round((str+dex+int+con+wis+luck)/2)`
- 图鉴实时计算：等级、六维属性、战斗属性（按 `calculateCombatStats` 公式）
- 不再显示固定数值

### 11. 图鉴标签（codex-manager.js）
- `slotLabel` 更新: weapon→主手1, weapon2→主手2, offhand→副手1, ring2→副手2

## 关键技术细节

### 装备槽位映射
- `weapon` = 主手武器1
- `weapon2` = 主手武器2
- `offhand` = 副手武器1
- `ring2` = 副手武器2

### 双持判定逻辑（player.js）
```javascript
if (this.weaponMode === 'weapon') {
    isDualWield = offhandItem && offhandItem.weaponId === 'weapon9';
} else if (this.weaponMode === 'weapon2') {
    isDualWield = ring2Item && ring2Item.weaponId === 'weapon9';
}
```

### 文件修改清单（V0.140）
- `src/world/renderer.js` - 坐标回退
- `src/ui/game-ui-manager.js` - 状态栏修复
- `src/ui/system-ui.js` - UI_DATA_CONFIG
- `src/ui/equip-tooltip-manager.js` - 191公式
- `src/ui/enhance-system.js` - 强化面板
- `src/ui/equip-manager.js` - 双持装备逻辑
- `src/ui/codex-manager.js` - 图鉴实时属性
- `src/entities/player.js` - 攻击/渲染/双持
- `src/entities/enemy.js` - 等级/数据修复
- `src/entities/enemy-types.js` - BlackWolf config
- `src/entities/enemy-data.js` - 敌人数据（静态参考）
- `src/game.js` - 版本号

## 待验证事项
- [ ] 版本号 0.140 显示在左上角
- [ ] 坐标显示非 0,0
- [ ] 状态栏 HP/MP 正常显示
- [ ] 击杀怪物后经验值增加
- [ ] 升级提示正常弹出
- [ ] G18 可装备到副手1/副手2
- [ ] 双持时显示两把G18贴图
- [ ] 图鉴中怪物等级和六维属性实时显示
- [ ] 191浮窗显示攻击力公式（非 `-`）
