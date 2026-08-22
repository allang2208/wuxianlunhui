> 本文件为 game-dev 技能库分卷，主索引与目录见 ../SKILL.md
> 本节：12. 常见陷阱与调试手册

## 12. 常见陷阱与调试手册

### 常见问题

#### 精灵图加载时报 "has no frame X"

原因：图片高度不是 `frameHeight` 的整数倍，Phaser 只识别了整数行数。
解决：
1. 短期：在 `load.spritesheet` 中加 `endFrame: N`
2. 长期：运行 `sprite-normalizer.py` 自动填充到正确尺寸

#### 切换动画时贴图忽大忽小

原因：不同精灵图的内容大小/中心位置不一致，Phaser 按整帧缩放导致内容大小差异。
解决：运行 `sprite-normalizer.py` 统一所有精灵图的内容大小和中心位置。

---

### 常见陷阱：显卡占用高（Phaser 全屏 WebGL 排查，2026-08-16 只诊断未改码）

#### 现象
游戏运行时任务管理器里浏览器（或 Electron）GPU 进程占用很高。

#### 根因排序（按影响）
1. **全屏 WebGL 每帧重绘 + 透明合成**（最大固定成本）：`PhaserGame.js` 用 `type: AUTO`
   （Chrome 必选 WebGL）、画布取 `window.innerWidth/innerHeight` 全窗口尺寸、
   `transparent: true`，且未设 `resolution`/`antialias`/`powerPreference` → 全屏 MSAA +
   每帧与 DOM alpha 合成，分辨率越高越贵。
2. **场景渲染对象多**：世界-122 约 100 棵散布树 + 边界墙/基地菱形房/掩体 + 每座防御塔
   3 层贴图（基座/臂/武器）+ 能源矿点 + 仓鼠小屋 + 敌人波次 + 每实体 1 个阴影 Sprite；
   HUD（worldHudGraphics/screenHudGraphics）与小地图动态层每帧 clear 重绘，小地图动态层
   每帧遍历全部实体。
3. **ADD 混合粒子**：受击/地面血迹（10s 寿命）/火球双发射器全用 `ADD` 混合，战斗激烈时
   像素过度绘制大。
4. **双 rAF 循环**：game.js 自建循环 + Phaser 循环同时 60fps 跑（CPU 侧为主，维持每帧
   忙碌）。
5. **4096×4096 地形整图纹理**（约 64MB 显存，一次性上传，每帧 1 次绘制，影响中等）。

#### 验证方法
- DevTools → Performance 录制 10 秒战斗，看 GPU 任务占比。
- 窗口缩到 1280×720 对比：GPU 骤降 = 分辨率/填充率主导。
- 临时关小地图/粒子对比。

#### 可优化方向（按性价比，本次用户确认暂不实施）
- `antialias: false`（关全屏 MSAA，观感损失最小）；
- 小地图动态层降频（10Hz 或脏标记），静态层已有缓存；
- 粒子降频/总量上限、ADD 改 NORMAL 或缩短血迹寿命；
- 非战斗场景 Phaser fps target 降到 30。

---

### 常见陷阱：功能失效优先查数据/配置完整性（弹药初始化同款两连）

#### 模式
"系统逻辑完好的功能失效"——控制台诊断先沿数据链查状态，别先改逻辑：
- v2.7 弹反失效：装备条目缺 `weaponType: 'shield'` + `defense` 块，`checkEquipped()` 恒 false。
- 2026-07-26 AKM 无法开枪：实例缺 `ammoConfig`（equipment.json 该条目本就无此键，靠 main.js 启动合并补齐，但该实例走了未合并的获取旁路），`_initAmmoForSlot` 无回退 → `_hasAmmo` 恒 false。

#### 修复原则
启动时合并（main.js → ItemDatabase）只覆盖一条获取路径；**消费端回退才是全路径兜底**——`_initAmmoForSlot` 已改用 `getAmmoConfig(item)`（`item.ammoConfig || GUN_AMMO_CAP[weaponId]`，与 combatant/图鉴/tooltip 同口径）。新枪械：EquipDataManager 配 `ammoConfig` + `GUN_AMMO_CAP` 加 weaponId 条目，双写。

---

### 常见陷阱：anim.timer === 0（死代码）

#### 问题
`enemy.js` 和 `combat-system.js` 的 swing 阶段都有：
```javascript
if (anim.timer === 0 && this._pendingThrust) this._pendingThrust.active = true;
```

这条代码**永远不会触发**：`anim.timer += dt` 后 `dt > 0`，`anim.timer` 不可能为 0。

#### 正确做法
`ThrustAttack.execute()` 在创建 `_pendingThrust` 时已经设置 `active = true`：`triggerWeaponAnim()` 没有覆盖 `_pendingThrust`，所以 `active` 始终保持 `true`，无需重新设置。

直接删除这条死代码即可。

---

### 常见陷阱：const 重复声明

#### 问题
`shield-system.js` 的 `onDamageTaken` 方法中：
```javascript
const defense = shieldData.defense;  // 行53
// ... 弹反逻辑 ...
const defense = shieldData.defense;  // 行81 ← 重复声明！
```

在块级作用域中（`if` 块内部是 `const` 的作用域），同一个函数中两次 `const defense` 会导致语法错误。

#### 解决
弹反逻辑中直接使用行53声明的 `defense` 变量，不再重复声明。或者在弹反块内部改声明为 `const defense = shieldData?.defense || {}`（如果外层 `defense` 不在作用域内）。

---

### 常见陷阱：ES Module 循环依赖触发 TDZ（`Cannot access ... before initialization`）

- **报错行不等于根因**：错误常落在 `class Combatant extends DamageableEntity`，实际闭环可能跨越
  `Game / SceneManager / UI / EffectManager / PartySystem / DungeonMapSystem` 多层模块。必须从尚未初始化的
  binding 出发，沿全部静态 `import` 画出完整回路；只看最后两三个文件会漏掉第二条回边。
- **禁止用顺序掩盖**：恢复无调用的 import、调整 import 排序或让某个子类“碰巧先初始化”，只能暂时改变
  ESM 求值顺序，后续删除死代码就会复发，不能作为修复。
- **两种标准断环**：共享判定/常量抽到无反向依赖的叶子模块；底层基类确实需要高层服务时，使用无任何
  import 的运行时桥，由 `main.js` 组合根在模块完成求值后注入真实服务。门面转发对象方法时必须保留
  `this` 和返回值，不能把方法解构成裸函数。
- **继承链方向不可反转**：`DamageableEntity` 这类底层基类不得为了 `instanceof Enemy` 反向 import 子类；
  改由子类在构造期声明稳定契约标记（当前为 `_isEnemyEntity`），基类只消费该契约。伤害、掉落、经验和
  状态结算仍留在基类统一入口，不因断环拆散业务语义。
- **当前实现**：`src/entities/damageable-runtime.js` 是 import-free 叶子桥；`src/main.js` 注入掉落、渲染、
  特效、队伍、技能与祭品服务；地牢类型读取已有叶子状态 `getCurrentDungeonType()`。静态复核应确认
  `DamageableEntity` 的每个直接依赖都无法再到达 `Game / Enemy / Combatant`。

---

### 常见陷阱：四方向 facing 但仅有两方向精灵图时的翻转逻辑

#### 问题
怪物只有侧面精灵图（原始面向右），但 facing 逻辑按移动方向分 4 方向（right/left/up/down）。当目标在左上方或左下方时：
- `|vy| > |vx|`，`_facing` 被设为 `up` 或 `down`
- `flipX` 逻辑只处理 `left`/`right`，`up`/`down` 不翻转
- 结果：sprite 始终面向右，但单位实际在向左移动 → 视觉方向与运动方向相反

#### 基础修复（v1.6）
`up`/`down` 时，根据 `vx` 符号判断水平运动方向来决定是否翻转：

```javascript
// _getPhaserOptions（Phaser 渲染）
if (this._facing === 'left') {
    flipX = true;
} else if (this._facing === 'right') {
    flipX = false;
} else {
    // up/down：没有上下精灵图，根据 vx 判断水平方向
    flipX = this.vx < 0;
}

// _drawBody（Canvas 渲染）
const shouldFlip = this._facing === 'left' ||
    ((this._facing === 'up' || this._facing === 'down') && this.vx < 0);
if (shouldFlip) ctx.scale(-1, 1);
```

#### 优化修复（v1.7）
基础修复有两个问题：
1. **攻击期间**：`_facing` 锁定为 `_dashStartFacing`，但 `up`/`down` 时的 flip 仍依赖 `vx`（攻击前的速度），而非实际冲刺方向 `_dashAngle`
2. **纯垂直移动/idle**：`vx = 0` 时 `flipX = false`，狼永远朝右，无法保持之前的水平朝向

**优化方案**：
- 新增 `_lastHorizontalFacing` 属性，在每次 `_facing` 更新为 `left`/`right` 时保存
- `up`/`down` 时的 flip 优先级：攻击期间用 `_dashAngle` → 移动期间用 `vx` → 静止/纯垂直用 `_lastHorizontalFacing`

```javascript
// 构造函数初始化
this._lastHorizontalFacing = 'right';

// update() 中保存水平朝向
if (this._facing === 'left' || this._facing === 'right') {
    this._lastHorizontalFacing = this._facing;
}

// _getPhaserOptions / _drawBody 中的 flip 逻辑
if (this._facing === 'left') {
    flipX = true;
} else if (this._facing === 'right') {
    flipX = false;
} else {
    // up/down：没有上下精灵图
    if (this._attackTimer > 0 && this._dashAngle !== undefined) {
        // 攻击期间使用冲刺方向决定水平朝向
        flipX = Math.cos(this._dashAngle) < 0;
    } else if (Math.abs(this.vx) > 0.1) {
        flipX = this.vx < 0;
    } else {
        // 纯垂直移动/idle：保持上次水平朝向
        flipX = this._lastHorizontalFacing === 'left';
    }
}
```

---

### 常见陷阱：Phaser 4 的 FX API 不是 postFX

- Phaser 3.60 的 `sprite.postFX.addGlow(...)` 在 **Phaser 4 已移除**——`sprite.postFX` 为 undefined，静默失败不报错。
- Phaser 4 正确用法：`sprite.enableFilters().filters.internal.addGlow(color, outerStrength, innerStrength, scale, knockout, quality, distance)`（Camera 上为 `camera.filters.internal/external`）。
- addGlow 参数顺序与 v3 不同（第 4 位是 scale，第 5 位才是 knockout），迁移时逐位核对。
- knockout=true 会把贴图本体完全隐藏只留光晕（"only the glow is drawn, not the texture itself"）——要"贴图正常+轮廓外光晕"必须用 knockout=false，光晕会自然从贴图边缘向外渐变。
- 粒子发射器重力：v3 `emitter.setGravity(x, y)` 在 Phaser 4 改名为 `setParticleGravity(x, y)`，旧名调用报 "is not a function"。

---

### 常见陷阱：Phaser 4 filters 是 per-object 渲染通道（数量多即卡）

- `enableFilters().filters` 每个 GameObject 一个独立 render-to-texture + shader pass——满地掉落物时几十/上百个额外通道，帧率雪崩。**实体特效一律不用 filters**。
- 替代：离屏 canvas 烘培纹理（`ctx.shadowBlur` 多次叠画出外发光渐变，`textures.addImage` 缓存复用），渲染零开销。
- 光晕宽度要按显示尺寸比例烘培：原图 512px 显示 48px 时，10px 光晕需按 ≈20% 画布比例烘，否则被缩放稀释到不可见。

---

### 遭遇导演（2026-07-28 移除：零调用的预留抽象）

`encounter-director.js` 的 `start/registerKind/encounter-table.json` 自 2026-07-21 引入起**始终零调用**（地牢遭遇由 DungeonConfig.getZombieEncounterConfig 承担且工作良好），已删除；唯一有消费方的构成解析（角色键数组→工厂数组）已内联进 `agent-invasion-system.js`（ROLE_FACTORIES + resolveComposition）。**教训：预留抽象如果没有第二个真实消费方，先不要建；需要时按 GroundZone/combat-fx 的"先有 3 处重复再抽"模式来。**

---

### 工具文件

- `tools/sprite-normalizer.py` — 精灵图标准化脚本
- `tools/sprite-meta.json` — 脚本输出元数据（记录目标参数）

---

## 常见陷阱：footOffsetY 兜底 ≠ 脚底基线（2026-08-21）
- `_getFootOffsetY` 无显式配置时回退 `displayHeight*0.5`（格底边），但 v2 出图管线
  （elise-sprite-align / luna 系）脚底基线钉在 **0.9375×格高**——兜底会把锚点（阴影/深度）
  掉到真实脚底下 6.25%×显示高。需要真实脚底时：显式配置 footOffsetY，或用
  `GameScene._getVisibleFrameBottomRatio(sprite)` 实测帧内容底边（按帧缓存）。
