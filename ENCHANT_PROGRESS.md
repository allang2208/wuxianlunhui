# 附魔系统开发进度记录 V0.184

## 状态：暂停开发，待恢复
## 最后更新：V0.184（含开发工具重写）

## 已完成部分

### 1. 配置数据 (src/config/enchant-config.js) ✅
- 4种附魔卷轴配置：
  - 沉重(F): 近战武器，攻击力+60%，攻击间隔×1.35
  - 锋利的(F): 剑类，暴击率+50%
  - 狼蛛(E): 所有武器，攻击叠加中毒
  - 骷髅射手(D): 枪械类，穿透+2
- 魔法晶尘消耗：F=100，每升一级翻倍（E=200, D=400, C=800, B=1600, A=3200, S=6400）
- 转换晶尘：等级需求的一半

### 2. NPC对话集成 (src/ui/npc-dialogue.js) ✅
- 新增"✨ 附魔装备"按钮
- 关闭/再见/goodbye 已集成 EnchantSystem
- 点击外部关闭已排除 EnchantSystem

### 3. 附魔UI界面 (index.html + game-style.css) ✅
- 附魔面板HTML结构：左卷轴槽、右装备槽、中间箭头、预览区、操作按钮
- 全CSS样式（面板、槽位、拖放状态、按钮、提示信息）
- 附魔浮窗样式（ttEnchant）

### 4. 核心逻辑模块 (src/ui/enchant-system.js) ✅
- 打开/关闭面板（协作关闭SystemUI）
- 拖放系统：背包→槽位、槽位→背包
- 右键取出物品
- 重置按钮：退回所有物品到背包
- 进行附魔：检查晶尘→扣除→销毁卷轴→应用效果→返回装备
- 转换晶尘：销毁卷轴→返还晶尘
- 兼容性检测：不匹配时退回并提示"不符合附魔条件"

### 5. 效果应用到游戏系统 ✅
- 攻击力加成：已集成到 `getWeaponAttack()`（附魔后伤害×1.6）
- 暴击率加成：已集成到 `takeDamage()`（finalCritRate + enchantCritBonus）
- 攻击间隔加成：已集成到 `switchWeaponMode()` + `_applyEnchantAttackInterval()`
- 穿透加成：已集成到 `combat/attack.js` RangedAttack.execute()
- 中毒效果：player.js `_onHitEntity()` + enemy.js `applyPoison()` + `_updatePoison()`

### 6. 浮窗显示 (src/ui/equip-tooltip-manager.js) ✅
- 左侧新增 ttEnchant 面板
- 显示前缀+后缀名称（如"沉重的 狼蛛"）
- 显示效果详情
- 位置计算已包含 enchantW

### 7. 物品生成 (src/game.js) ✅
- 出生点右侧生成4种附魔卷轴
- 生成魔法晶尘供测试
- 导入 EnchantScrollItems

### 8. 魔法晶尘系统 (src/entities/player.js) ✅
- 新增 `player.magicDust` 属性（初始值0）
- 晶尘消耗、转换逻辑

### 9. 全局挂载与快捷键 (src/main.js + src/ui/input.js) ✅
- `window.EnchantSystem = EnchantSystem`
- ESC键关闭附魔面板
- NPC对话框点击外部关闭已排除 EnchantSystem

### 10. 敌人中毒系统 (src/entities/enemy.js) ✅
- 新增 `_poisonStacks`, `_poisonTimer`, `_poisonTickTimer`, `_poisonEffectId`
- `applyPoison(stacks)` 方法
- `_updatePoison(dt)` 每帧更新
- 绿色浮动文字 + 状态栏效果

## 已知问题（待修复）

### 🔴 1. 附魔栏无法打开（最高优先级）
- 现象：NPC对话框中点击"附魔装备"无反应，"再见"和ESC也无法关闭对话框
- 排查步骤：
  1. 确认浏览器控制台是否有 JavaScript 错误
  2. 检查 EnchantSystem 是否正确挂载到 window
  3. 检查 enchantPanel HTML 的 display 状态
- 已修复：移除了 HTML 中 `style="display:none;"` 内联样式，由 CSS class 控制

### 🔴 2. 构建警告：可能缺少素材文件
- `assets/sounds/enchant_success.wav` 音效文件可能不存在
- 如果构建报错，需要替换为现有音效或创建空文件

### 3. 攻击间隔效果未全面测试
- `_applyEnchantAttackInterval()` 已添加，但只处理了 sword/pistol/pkm/akm/qbz191/qjb201/shotgun/bow
- 需要确认所有武器类型的 attackKey 映射正确
- 需要确认基础冷却值保存逻辑（_baseCooldowns）在武器切换时正确恢复

### 4. 物品类别过滤
- 当前只检查 `category === 'weapon_melee'` 或 `'weapon_ranged'`
- 弓的 category 可能需要确认是否匹配

### 5. 背包已满处理
- 当前退回物品时找空位，如果背包满则物品丢失（无提示）
- 需要添加"背包已满"提示和掉落地上逻辑

### 6. 附魔覆盖逻辑
- 当前新附魔会覆盖旧附魔，但不会清理旧 `_enchantEffects` 残留
- 需要清理旧效果再应用新效果

### 7. 装备栏附魔标签
- CSS 中准备了 `.equip-enchant-tag` 但未在 EquipManager 中实现
- 需要在装备栏图标上显示附魔前缀/后缀标签

### 8. 图鉴同步
- CodexManager 中未添加附魔卷轴信息
- 图鉴中无法查看附魔卷轴数据

## 恢复开发步骤
1. 先测试"附魔栏能否打开"（按 F5 刷新后，与NPC对话→点击附魔装备）
2. 如果无法打开，查看浏览器控制台错误日志
3. 测试拖放功能（背包→卷轴槽、背包→装备槽）
4. 测试附魔效果应用（沉重、锋利、狼蛛、骷髅射手）
5. 测试浮窗显示
6. 完善背包已满处理
7. 添加装备栏附魔标签
8. 同步图鉴数据

## 修改文件清单（12个文件）
| 文件 | 状态 | 说明 |
|------|------|------|
| src/config/enchant-config.js | 新建 | 附魔卷轴配置 |
| src/ui/enchant-system.js | 新建 | 附魔面板核心逻辑 |
| src/ui/npc-dialogue.js | 修改 | 新增附魔按钮+关闭逻辑 |
| src/ui/input.js | 修改 | ESC关闭附魔面板 |
| src/ui/equip-tooltip-manager.js | 修改 | 浮窗附魔效果显示 |
| src/entities/player.js | 修改 | 攻击力/暴击率/攻击间隔/穿透/中毒效果 |
| src/entities/enemy.js | 修改 | 新增敌人中毒系统 |
| src/combat/attack.js | 修改 | 穿透加成 |
| src/game.js | 修改 | 生成附魔卷轴和晶尘 |
| src/main.js | 修改 | 导入+挂载+初始化 |
| index.html | 修改 | 附魔面板+按钮HTML |
| game-style.css | 修改 | 附魔面板样式 |

## 测试数据
- 4种附魔卷轴在出生点右侧生成（坐标约 x+200, y）
- 魔法晶尘在出生点右下方生成（x+200, y+40）
- 玩家初始 magicDust = 0
- 沉重附魔消耗：100 晶尘（F级）
- 狼蛛附魔消耗：200 晶尘（E级）
- 骷髅射手附魔消耗：400 晶尘（D级）
