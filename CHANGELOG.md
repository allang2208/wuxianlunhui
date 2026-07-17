# 变更日志

## 格式
每次对话结束时记录：
- 对话日期
- 修改的文件
- 修改内容摘要
- 测试结果
- 已知问题

## 2026-07-17（普通僵尸精灵图导入与主神空间测试生成）

### 对话：投射物新增躯干矩形判定（方案 B，仅投射物）（v0.198+）
- **修改文件**：
  - `src/physics/collision-3d.js`：新增 `segmentIntersectsExpandedRect`（Liang-Barsky 线段-膨胀矩形相交，零长线段退化为点包含）。
  - `src/combat/projectile.js`：新增 `_hitTorsoRect`——屏幕空间躯干矩形判定，锚定 collider 脚底中心，取 `render.projectileHitbox`（宽/高/offsetX/bottom），缺省为 `collisionWidth × 身高`，新怪物零配置自动获得；地面目标命中改为 **footprint 椭圆 ∪ 躯干矩形 ∪ 身体圆柱** 任一命中，飞行目标不变。**近战判定（attack.js/skill-shapes.js）未做任何改动**。
  - `data/enemy-config.json`：7 个精灵图怪物的 `render` 新增实测 `projectileHitbox`（zombie 31×103、fatZombie 44×137、spitterZombie 29×81、zombieWizard 46×112、mutant3 68×110、zombieDog 81×83、blackWolf 120×65），数值来自首帧内容边界按 spriteSize 换算。
  - `src/phaser/scenes/GameScene.js`："范围"调试层新增绿色描边矩形，实时显示每个实体的投射物躯干矩形。
  - `scripts/archive/measure-projectile-hitbox.py`（新增一次性测量脚本）、`scripts/archive/prepare-zombie-sprites.py`（前次归档）。
  - `scripts/test-collider.mjs`：新增 12 个躯干矩形判定用例。
  - `CHANGELOG.md`：本记录。
- **修改内容摘要**：
  1. 枪械瞄准敌人贴图身体（躯干/头部）现在可以命中，不再需要瞄脚下 footprint 椭圆。
  2. 判定仅作用于投射物（玩家枪械、毒液投射物等对玩家同样生效）；近战斩击/突刺的 Z 区间判定完全不变。
  3. 躯干矩形逐怪按贴图内容实测配置，未配置的实体使用缺省推导，无硬编码。
- **测试结果**：`node scripts/test-collider.mjs` 全部通过（含 12 个新用例）；`npm run lint` 通过；`npx vite build` 通过。
- **已知问题**：
  - 实机手感未验证：躯干命中区间是否过宽/过窄，可用"范围"按钮的绿色矩形对照贴图逐怪微调 `projectileHitbox`。
  - redWolfKing 无 render 配置，走缺省推导（collisionRadius×2），未实测。
  - 冰锥/火球/符文剑等技能投射物仍走各自 GroundCircle 地面判定，未纳入本次范围。

### 对话：僵尸攻击线性突进 + 地牢同步接入精灵图僵尸（v0.198+）
- **修改文件**：
  - `src/entities/enemy.js`：基类新增**配置驱动的通用线性突进机制**——构造函数初始化 `_lungeActive/_lungeDistance/_lungeApplied/_lungeAngle`；`triggerWeaponAnim()` 在 `config.attack.lungeDistance > 0` 时锁定朝目标（无目标用 rotation）的突进角度；`update()` 在眩晕检查后调用新增的 `_updateLunge()`，攻击动画期间按 `1 - _attackTimer/_attackDuration` 线性推进，增量式位移（不覆盖击退/分离等外部位移），每帧 `WallSystem.resolve` 撞墙校验。任何怪物只要在 enemy-config.json 配置 `attack.lungeDistance` 即在任何场景自动获得该行为，无硬编码。
  - `data/enemy-config.json`：`zombie.attack` 新增 `lungeDistance: 100`。
  - `src/world/zombie-dungeon.js`：`createBasicZombie` 从 `CircleEnemy` 圆形占位改用新 `Zombie` 类（仿 createFatZombie 工厂模式，含缺失配置 fallback），地牢普通僵尸同步获得精灵图动画与突进。
  - `CHANGELOG.md`：本记录。
- **修改内容摘要**：
  1. 僵尸攻击时，1 秒攻击动画期间向攻击开始时锁定的方向匀速突进 100px，撞墙沿墙滑/停下。
  2. 地牢普通僵尸与主神空间测试僵尸使用同一 `Zombie` 类 + 同一 JSON 配置，行为完全一致。
  3. 黑狼 pacing 冲刺机制（`_prepareDashAttack`/`_attackDashOffset`）未改动。
- **测试结果**：`npm run lint` 通过；`npx vite build` 通过；`node scripts/test-collider.mjs` 全部通过。
- **已知问题**：
  - 实机效果未验证：突进距离/时长手感、突进撞墙表现、贴脸后分离力推开表现需实机确认。
  - 地牢中的 `runnerZombie`（奔跑僵尸）与 `armoredZombie`（装甲僵尸）仍为 CircleEnemy 圆形占位，如需精灵图需各自接入。

### 对话：僵尸 idle/walking/attacking 精灵图接入（v0.198+）
- **修改文件**：
  - `assets/enemies/zombie/`（新建）：idle.png（1 帧）/ walking.png（15 帧）/ attacking.png（15 帧），统一 8×4 网格 512×512 帧；内容高度统一约 440px（hRatio≈0.86，与胖子僵尸/毒液僵尸/僵尸巫师一致），水平居中、底部对齐 y=496。
  - `scripts/archive/prepare-zombie-sprites.py`（新增一次性脚本）：素材重排与内容尺寸统一处理。
  - `data/enemy-config.json`：`zombie` 条目新增 `render`（spriteSize 120 / collisionWidth 30 / collisionHeight 50 / footOffsetY 56）、`textures`（含 idleSheetColumns: 8 图鉴截取）、`attackDistance: 100`；`attackRange` 90→100、`attack.cooldown` 800→2000、`attack.dynamicRange` 90→100、`collisionRadius` 10→15。
  - `src/phaser/scenes/BootScene.js`：加载 `enemy_zombie_idle/walk/attack` 三张 spritesheet（endFrame 0/14/14）并注册同名动画；攻击动画 `duration: 1000, repeat: 0`（1 秒）。
  - `src/entities/enemy-types/zombie.js`（新建）：`Zombie` 类继承 `Enemy`，仿 fat-zombie 模式；`_attackDuration = 1000`，`triggerWeaponAnim()` 调 super 保证 ThrustAttack 命中判定；显式 `animKey: enemy_zombie_${state}`。
  - `src/entities/enemy-types.js`：import 并导出 `Zombie`。
  - `src/game.js`：import `Zombie`，新增 `spawnMainZombie()`（主神原点 +250/+120，永久警戒），初始化时调用。
  - `src/world/scene-manager.js`：返回主神空间时调用 `spawnMainZombie()`。
  - `src/ui/enemy-sprite-tool.js`：`ENEMY_LIST` 新增 `{ key: 'zombie', name: '僵尸' }`。
  - `scripts/generate-sprite-offsets.js`：SHEETS 新增普通僵尸 3 条；重跑生成 `data/sprite-offsets.json` 并同步 `public/data/sprite-offsets.json`。
- **修改内容摘要**：
  1. 普通僵尸从圆形占位升级为精灵图动画（待机 1 帧 / 移动 15 帧 / 攻击 15 帧）。
  2. 攻击动画固定 1 秒、攻击间隔 2 秒、攻击距离判定 100px（走 CombatSystem 现有 `attackDistance` 逻辑，无硬编码）。
  3. 素材原始面向右，翻转逻辑与胖子僵尸一致（朝左时 flipX）。
  4. 主神空间生成一只普通僵尸用于测试（与胖子僵尸并列），返回主神空间时自动重生。
  5. 地牢普通僵尸生成工厂未改动，仍走旧 CircleEnemy 逻辑。
- **测试结果**：`npm run lint` 通过；`npx vite build` 通过；`node scripts/generate-sprite-offsets.js` 重跑成功（idle 1 帧 / walk 15 帧 / attack 15 帧）。
- **已知问题**：
  - 实机效果未验证：待机/移动/攻击切换是否自然、footOffsetY=56 与阴影对齐、攻击判定距离手感，需实机确认后可用 DevTool 微调。
  - 地牢中的普通僵尸仍是圆形占位，如需替换为精灵图需改 `zombie-dungeon.js` 的 `ZOMBIE_FACTORY_MAP.zombie`。

---

## 2026-07-12（怪物贴图兜底、僵尸犬动画、AI 与地牢问题排查）

### 对话：修复怪物显示问题并接入僵尸犬素材（v0.198+）
- **修改文件**：
  - `src/phaser/scenes/GameScene.js`：自动为缺失 Sprite 的敌人创建 `enemy_circle` 占位；`_configureEnemyBody` 碰撞半径翻倍；新增 `_syncEnemyAnimation` 同步敌人动画/翻转/纹理；`_syncEntityHud` 识别 `noNameLabel` 去重；限定动画同步只处理 `_faction === 'enemy'`，修复武器/中立实体被强制变圆的 Bug。
  - `src/phaser/scenes/BootScene.js`：加载僵尸犬精灵图并注册 `zombie_dog_walk/run/attack` 动画；`projectile_spit` 改为绿色实心圆。
  - `src/entities/enemy-types.js`：新增 `ZombieDogEnemy` 类。
  - `src/world/zombie-dungeon.js`：所有地牢怪物覆盖全图索敌参数。
  - `src/world/scene-manager.js`：回到主神空间时清理怪物并重新生成僵尸犬。
  - `src/game.js`：删除主神空间原 5 只测试圆形敌人，改为生成一只僵尸犬。
  - `src/combat/projectile.js`：毒液投射物显示尺寸缩小 30%。
  - `data/enemy-config.json`：毒液僵尸投射物速度 540 → 270。
  - `SKILL.md`、`CHANGELOG.md`、`.gitignore`：更新文档与忽略 `.venv/`。
- **修改内容摘要**：
  1. 所有怪物恢复为 `enemy_circle` 占位显示，碰撞体积扩大一倍。
  2. 毒液僵尸投射物速度再降 50%，并改为绿色实心小圆。
  3. 地牢怪物全局仇恨，不会丢失目标。
  4. 战后出口传送门名称不再重复显示。
  5. 接入僵尸犬外部素材，统一 512×512 帧并制作 walk/run/attack/idle 动画。
  6. 主神空间仅保留一只测试用僵尸犬，便于动画调试。
  7. 排查地牢怪物卡墙根因：出生带贴墙 + `WallSystem.resolve` 无脱困逻辑。
  8. 排查近战 AI 迂回根因：`separation` 排斥过强 + 攻击范围内摩擦与排斥冲突 + 路径跟随/墙体滑动问题。
- **测试结果**：`npx eslint src --max-warnings=0` 通过；`npx vite build` 通过。
- **已知问题**：
  - 地牢怪物卡墙与近战 AI 迂回尚未实际修复，已输出完整缺陷与改进方向，待后续实施。
  - 僵尸犬 idle 状态使用单帧图片，未注册 idle 动画。

---

## 2026-07-11（Phaser 迁移收尾 + Canvas 死代码清理）

### 对话：完成 Phaser 迁移并清理中优先级技术债务（v0.198）
- **修改文件**（15+ 个文件）：
  - `src/world/map-generator.js`：地形生成改为 Phaser Graphics API，删除手动 Canvas 创建。
  - `src/world/renderer.js`：删除 `MapGenerator` 导入、地形生成、`_bakeGridAndBorder`；保留 `terrainTexture` 作为特殊场景覆盖入口。
  - `src/phaser/scenes/GameScene.js`：`_syncTerrain()` 优先使用 `Renderer.terrainTexture` 覆盖，否则用 Phaser Graphics 生成；新增 `_drawGridAndBorder()`。
  - `src/game.js`：非地牢地图模式下隐藏 `gameCanvas`，停止无意义 `clear()`。
  - `src/entities/entity.js`：删除 `render(_ctx)`、`renderCollisionRadius(ctx)` 及 `Renderer` 导入。
  - `src/components/hitbox.js`：删除 `renderDebug(ctx)` 及 `Renderer` 导入。
  - `src/ai/enemy-fsm.js`：删除 `PhaseChangeEffect` 类及导出。
  - `src/entities/enemy.js`：删除 `PhaseChangeEffect` 引用与导入。
  - `src/ui/game-ui-manager.js` / `src/utils/dom-utils.js`：新增 `getElementIfExists`，简化 HUD 跳过逻辑，避免 DOM 缺失警告。
  - `src/game.js` / `src/ui/game-ui-manager.js`：删除 `showHitbox` 死代码。
  - `src/game.js`：删除对 `GameUIManager.initHitboxToggle()` 的调用，修复启动时报错。
  - `PHASER_MIGRATION_PLAN.md`、`PROJECT_STATE.md`、`CHANGELOG.md`：更新迁移状态。
- **修改内容摘要**：
  1. 主场景地形由 Phaser Graphics 直接生成 Texture，不再经过 `HTMLCanvasElement` 中间层。
  2. 保留 `Renderer.terrainTexture` 覆盖机制，兼容战斗场地、BOSS、雪地/火车等特殊场景。
  3. `Game.render` 仅在 `scene7` 地牢地图模式下显示并清屏 `gameCanvas`。
  4. 删除所有确认失效的 `render(ctx)` / 绘制辅助方法 / 调试渲染代码。
  5. `GameUIManager` 对缺失/隐藏的简单 HUD 元素使用静默查询，消除控制台警告。
- **测试结果**：`npx eslint src --max-warnings=0` 通过；`npx vite build` 通过。
- **已知问题**：
  - `scene3` 火车背景已删除 Canvas 实现，待后续重新设计。
  - `FloatingTextEffect` 等部分特效只剩 `update`、没有渲染，需后续 Phaser 化或删除。

---

## 2026-07-05（智能寻路系统：参考《环世界》预规划 + 局部修复）

### 对话：开发智能寻路系统（v0.198）
- **修改文件**（5 个文件）：
  - `src/ai/path-manager.js`：新建智能路径管理器，实现路径缓存、定期有效性检查（1.5-2.5秒）、局部修复（障碍物附近搜索替代路线）
  - `src/ai/pathfinder.js`：增强 A* 寻路器，增加地形权重（树木1.5x/拥挤1.3x）、区域连通性检查（Flood Fill）、全局路径缓存（3秒/50条上限）
  - `src/systems/movement-system.js`：主动预规划（有目标无路径时立即计算）、PathManager 集成、`_followPath` 使用 PathManager API、`_updateStuckDetection` 使用 PathManager fallback
  - `src/entities/enemy.js`：构造函数初始化 `_pathManager`（懒加载）、fallback `_updateMovement` 兼容 PathManager
- **修改内容摘要**：
  1. 主动预规划：单位看到目标时立即计算路径，而不是等卡住才反应
  2. 定期路径检查：PathManager 每 1.5-2.5 秒扫描路径节点，检测新障碍物
  3. 局部修复：路径被阻挡时，在障碍物前后 2 个节点范围内搜索替代路径，拼接回原路径；失败后从阻挡点重算到终点；连续3次失败清除路径
  4. 地形权重：A* 中树木附近移动成本 1.5x，拥挤区域 1.3x，单位自然绕行
  5. 区域连通性：findPath 前先用 Flood Fill 判断目标是否可达，避免无效 A* 计算
  6. 路径缓存：全局缓存计算结果，相同起点+终点+半径复用，3秒有效期，50条上限
  7. 向后兼容：旧 `enemy._path` 和 `enemy._pathIdx` 仍然保留，MovementSystem 和 Enemy fallback 模式自动回退
  8. **修复**：`isReachable()` Flood Fill 步数限制过死（`ceil(maxDist/step)+5` → `ceil(maxDist/step)*3+20`），导致路径计算完全失败，单位卡在树木边缘无法移动
- **测试结果**：node 语法验证通过（path-manager.js、pathfinder.js、movement-system.js 全部 OK）
- **已知问题**：PathManager 的 `_getMoveCost` 检查其他单位时，可能因 Game.entities 遍历量较大而性能开销增加，后续可考虑优化

---

## 2026-07-05（硬编码清理 + 碰撞体积优化）

### 对话：全面硬编码清理 + 黑狼碰撞体积缩小 + 树木碰撞优化（v0.198）
- **修改文件**（13 个文件）：
  - `data/enemy-config.json`：黑狼 `collisionRadius` 88→38（缩小一半以上）
  - `src/world/wall-system.js`：树木碰撞体分离（`collisionRadius = radius × 0.6`），`resolve()` 添加逐步缩减步长回退，避免大怪物卡树
  - `src/entities/damageable-entity.js`：新增 `_updatePoison`/`_updateBleed`/`_updateMagicVulnerability`/`_updateDroneVulnerability`，4种状态效果统一在 `update()` 中驱动
  - `src/entities/combatant.js`：补充缺失的状态效果属性初始化（`_bleedStacks`、`_magicVulnerabilityStacks` 等）
  - `src/entities/enemy.js`：删除 15 行冗余状态效果属性 + 删除 114 行重复 `_update*` 方法 + 新增 `_getDashOffset()` 统一接口 + 删除死代码 `anim.timer === 0`
  - `src/systems/combat-system.js`：删除 85 行重复状态效果代码 + 更新注释 + 删除死代码 `anim.timer === 0` + 修复 `class` 闭合括号缺失（Vite 500 错误）
  - `src/phaser/scenes/GameScene.js`：dash 偏移逻辑统一为 `entity._getDashOffset()`，替代 inline switch
  - `src/world/scene-manager.js`：删除未使用的战术小队类导入（`Commander`/`MachineGunner`/`Rifleman`/`FlankRifleman`/`ShieldBearer`）
  - `src/entities/components/shield-system.js`：修复 `const defense` 重复声明导致的语法错误
- **修改内容摘要**：
  1. 状态效果系统重构：4种伤害型状态效果（中毒/流血/易伤）统一提取到 `DamageableEntity` 基类，消除 `enemy.js` 和 `combat-system.js` 中的重复代码（共删 200+ 行）
  2. 消除重复执行 bug：之前状态效果每帧被更新两次（`Enemy.update` + `CombatSystem.update`），导致中毒/流血伤害翻倍
  3. dash 偏移统一：基类定义 `_getDashOffset()`，所有调用方（GameScene.js、BlackWolf）统一使用
  4. 树木碰撞优化：视觉半径和碰撞半径分离（60%），resolve() 添加滑动回退，大怪物（碰撞半径 38）在树木间移动更流畅
  5. 死代码删除：`anim.timer === 0` 永远不会触发（因为 `dt > 0`），删除两条重复代码
  6. 语法修复：shield-system.js `const defense` 重复声明修复；combat-system.js 类闭合括号缺失修复
- **测试结果**：node 语法验证全部通过，Vite 编译通过
- **已知问题**：humanoid-monster.js 武器配置仍有硬编码，战术小队未启用暂不处理

---

## 2026-07-05（补充）

### 对话：删除普通怪物 + 方案B渲染模板重构（v0.198）
- **修改文件**（12 个文件）：
  - `src/entities/enemy-types.js`：删除 14 个普通怪物类（Zombie/Spider/Skeleton/Necromancer/DeathKnight/BigBoss），仅保留 BlackWolf（254行→200行）
  - `src/entities/enemy.js`：重构 `render()` 为通用模板，新增 7 个可覆盖钩子方法（_getRenderPosition/_getTextureKey/_getPhaserOptions/_drawBody/_renderNameTag/_renderPoisonEffect/_renderHitFlash）
  - `data/enemy-config.json`：删除 14 个怪物配置，仅保留 blackWolf
  - `src/main.js`：删除对应 import 和全局挂载
  - `src/game.js`：怪物生成用 BlackWolf 替代，修复多余 `}` 语法错误
  - `src/world/scene-manager.js`：场景怪物池用 BlackWolf 替代
  - `src/world/dungeon-map-system.js`：地牢怪物池用 BlackWolf+战术小队替代
  - `src/ai/synergy-system.js`：删除涉及已删除怪物的协同规则
- **修改内容摘要**：
  1. 删除所有普通怪物代码（14个类），保留 BlackWolf 和战术小队（6个类）
  2. 方案B：提取通用渲染模板到 Enemy.render()，BlackWolf 使用钩子方法注入自身逻辑
  3. 新增怪物只需实现 4 个钩子方法（_getRenderPosition/_getTextureKey/_getPhaserOptions/_drawBody）
  4. 所有怪物属性统一通过 enemy-config.json 配置（攻击/防御/血量/速度等）
  5. 修复 Vite 500 错误：game.js 多余括号 + scene-manager.js 错误 import 路径
- **测试结果**：Vite 编译通过，语法检查通过
- **预期效果**：新增怪物开发效率大幅提升，只需配置 JSON + 实现钩子方法
- **已知问题**：战术小队（humanoid-monster.js）当前独立渲染，后续可改造为使用基类模板

## 2026-07-05

### 对话：黑狼贴图朝向调试 + 怪物贴图调整工具（v0.198）
- **修改文件**（9 个文件）：
  - `src/entities/enemy-types.js`：BlackWolf render 使用原始精灵图（不旋转），left 方向通过 flipX 水平镜像实现
  - `src/entities/enemy.js`：修复 `_renderPhaserSync` — 旋转同步通过 `this.rotation` 让 GameScene.update 处理；flip 通过 `setScale` 负值实现，避免与 `setFlipX/Y` 冲突
  - `src/ui/enemy-sprite-tool.js`：新建怪物贴图调整工具，支持选择怪物、方向、精灵图、大小、旋转、翻转，实时预览
  - `src/ui/dev-tool.js`：导入并初始化 EnemySpriteTool，挂载到 `window`
  - `index.html`：添加"怪物" Tab 和贴图调整界面
  - `game-style.css`：添加怪物贴图调整工具样式
  - `assets/enemies/black_wolf.png`：已重排为 2行×4列均匀网格
  - `assets/enemies/black_wolf_updown.png`：新建上下向精灵图
  - `src/phaser/scenes/BootScene.js`：加载黑狼精灵图
- **修改内容摘要**：
  1. 黑狼贴图朝向问题：原始精灵图是垂直方向（上下向），通过工具调试发现最佳方案是"不旋转，直接用原始贴图 + flipX 镜像区分左右"
  2. 修复 Phaser flip 陷阱：`setScale(scale)` 会覆盖 `setFlipX/Y` 的符号，正确做法是通过 `setScale(scaleX, scaleY)` 负值实现 flip
  3. 修复 Phaser 旋转同步：`_renderPhaserSync` 设置 `this.rotation = options.rotation - Math.PI/2`，让 `GameScene.update` 的 `setRotation(entity.rotation + Math.PI/2)` 正确工作
  4. 新建怪物贴图调整工具：用户自行调整参数，导出 JSON，代码读取应用，降低沟通成本
  5. 更新 `game-dev-workflow` SKILL.md：添加精灵图朝向调试经验章节
- **测试结果**：right/left 方向贴图朝向正确，水平镜像成功
- **预期效果**：黑狼左右移动贴图朝向正确，用户可通过工具自行调整其他怪物
- **已知问题**：
  - up/down 方向尚未调整（用户计划后续使用工具调整）
  - 其他 14 个怪物的朝向仍使用默认配置，需要逐个调整

## 2026-07-03

### 对话 2：AI系统重构 + 50+怪物性能优化（v0.197）
- **修改文件**（7 个核心文件）：
  - `src/game.js`：在实体 update 后集成 MovementSystem + CombatSystem + PerceptionSystem 调用
  - `src/entities/enemy.js`：精简 update，外部系统存在时跳过旧移动/攻击/状态效果逻辑，避免重复调用
  - `src/systems/movement-system.js`：添加寻路冷却（2000ms），SpatialPartitionSystem 范围查询替代全量遍历
  - `src/systems/combat-system.js`：复用 PerceptionSystem LOS 缓存，减少 WallSystem.blocked 调用
  - `src/ai/pathfinder.js`：grid 分辨率 20→40，减少 A* 网格数量 75%
  - `index.html`：版本号更新到 V0.197
  - `src/game.js`：版本号更新到 0.197
- **修改内容摘要**：
  1. 诊断场景2/4怪海卡顿根因：双重寻路触发（Enemy._updateMovement + MovementSystem）+ A*寻路风暴（100只僵尸×3600格子=500万次操作/500ms）+ O(n²)目标扫描
  2. 架构重构：game.js 统一调用 MovementSystem/CombatSystem/PerceptionSystem，enemy.js 改为外部系统驱动
  3. MovementSystem 性能优化：寻路冷却 2 秒、SpatialPartition 范围查询、grid 分辨率降低
  4. CombatSystem 视线缓存：复用 PerceptionSystem LOS 缓存，避免每帧射线检测
  5. 清理旧备份：删除 50+ 个旧备份文件，释放 18MB 硬盘空间
  6. 创建新备份：backup/v2026-07-03_23-16-19/
- **测试结果**：所有文件语法验证通过，Git 提交 e7da369
- **预期效果**：50-100 怪同屏从卡顿→流畅，总体性能提升约 100x
- **已知问题**：
  - 需实际测试场景2/4确认怪物行为正常
  - 如果 MovementSystem 有 bug，enemy.js 有 fallback 逻辑（当外部系统不存在时启用旧逻辑）

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

## 2026-07-04

### 对话：战术小队 AI 全面优化 + 自动追踪无人机（v0.199）
- **修改文件**（11 个核心文件，+538 -288 行）：
  - `src/ai/tactical-squad-ai.js`：自动追踪无人机系统（释放/追踪/回收/范围判定），机枪手跟随指挥官，盾位更贴身（120px），步枪手侧翼包抄，所有角色移动目标优先级统一
  - `src/systems/movement-system.js`：x/y 分解滑动（沿墙移动不卡死），卡住检测寻路目标与实际目标一致，单位间排斥，_specialTacticalTarget 最高优先级，寻路路径点被墙挡住时重新寻路
  - `src/systems/formation-system.js`：停止直接移动，只设置 _tacticalTarget
  - `src/combat/attack.js`：修复 `cooldown: 0` 被 `|| 1000` 误判为 1000 的 bug（`config.cooldown || 1000` → `config.cooldown !== undefined ? config.cooldown : 1000`）
  - `src/systems/combat-system.js`：遍历所有攻击类型更新冷却，修复 `_updateAttacks` 只更新 primary 的问题
  - `src/entities/humanoid-monster.js`：六维计算伤害（`data.atk`），不再硬编码 1；不再覆盖 `attackRange`（保持武器原始射程）；盾位 Canvas 小圆盾贴图；盾位速度 31.2→39
  - `src/entities/damageable-entity.js`：防御公式统一为 `def/(def+60)`（物理/魔法同步），10% 保底伤害
  - `src/entities/enemy.js`：`calculateCombatStats` 新增 `maxHp` 同步，删除旧覆盖公式和硬编码 hp/maxHp
  - `src/entities/player.js`：14 处硬编码子弹速度改为 1248；`droneVulnerability` timer 改为 999999（由范围判定控制移除）
  - `src/entities/combatant.js`：删除重复的 `createDamageText`
  - `src/main.js`：挂载 MovementSystem/CombatSystem/PerceptionSystem 到 window
- **修改内容摘要**：
  1. 战术小队卡墙修复：FormationSystem 停止直接移动 + MovementSystem 沿墙滑动 + 寻路目标一致
  2. 指挥官自动追踪无人机：释放→追踪玩家→300px 范围判定→敌我识别（排除友军）→离开范围立即移除 debuff
  3. 机枪手跟随指挥官（侧翼 100px），盾位贴身 120px（冲锋加速 20%），步枪手 500px 侧翼
  4. 修复战术小队不会开枪：attack.js cooldown 0 被误判 + combat-system 只更新 primary 攻击
  5. 修复子弹速度：player.js 14 处硬编码改为 1248
  6. 修复伤害：六维计算 atk + 武器配置，不再硬编码 1
  7. 修复防御公式：统一 `def/(def+60)`，物理/魔法同步
  8. 修复瞬移：fallback + _clampMoveDistance + dashTo 走 knockback 持续移动
  9. 防瞬移方案 A+B+C 全面实施：window 挂载 + _clampMoveDistance + dashTo 持续移动
- **测试结果**：所有文件语法验证通过
- **已知问题**：
  - 需实际测试障碍物边缘移动效果
  - 需验证无人机实体渲染和 debuff 效果

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


## 2026-07-04

### 侧视角 2D 渲染迁移（P0-P3 全部完成）
- **修改文件**：11 个核心文件
- **任务 1 - Player 4方向朝向 + 阴影**：
  - `src/entities/player.js`：添加 `_getFacingDirection()` 从鼠标位置判断4方向；render 中反旋转+水平翻转；武器跟随朝向（左/右翻转，上/下偏移）；脚下阴影改为屏幕空间绘制
- **任务 2 - Enemy 4方向朝向 + 阴影**：
  - `src/entities/damageable-entity.js`：新增基类 `_drawShadow()` 通用阴影方法
  - `src/entities/enemy.js`：render 中从速度/目标方向判断4方向；scaleX 翻转；量化旋转角度；调用基类阴影
- **任务 3 - 战术小队 4方向朝向**：
  - `src/entities/humanoid-monster.js`：新增 `_getDirection4()`；render 取消自由旋转；盾位小圆盾位置根据4方向动态调整；武器根据4方向变换
- **任务 4 - 墙壁侧视渲染**：
  - `src/world/wall-system.js`：墙壁数据添加 `height: 60`；新增 `renderWalls()` 按 y 排序绘制立面+墙顶
  - `src/game.js`：渲染循环在 terrain 后、实体前调用 `WallSystem.renderWalls()`
- **任务 5 - 近战攻击判定**：
  - `src/entities/player.js`：update 中根据鼠标方向计算 `_facingDir`（4方向），射击仍用360° rotation
  - `src/combat/attack.js`：`ThrustAttack.checkTriangleHit` 改为4方向轴对齐矩形判定（right/left/down/up），保留击退和墙壁检测
- **任务 6 - 子弹 Y 缩放 + 树木侧视**：
  - `src/combat/projectile.js`：render 中根据 vy 做 Y 方向缩放（上70%/下130%/水平100%）
  - `src/world/wall-system.js`：`addTree()` 添加侧视数据（树干+树冠）；新增 `renderTrees()` 按 sortY 排序绘制
  - `src/game.js`：渲染调用从 `MazeGenerator.renderTrees` 改为 `WallSystem.renderTrees()`
- **任务 7 - 弹壳/血溅/特效**：
  - `src/effects/shell-casing.js`：重力增强约50%且改为时间缩放（`vy += 10.8 * dt/1000`）
  - `src/effects/blood-hit-effect.js`：构造函数支持可选 `angle` 参数，传入时粒子朝攻击方向扇形分布
  - `src/effects/effect-manager.js`：`render()` 添加 `this.effects.sort((a,b) => a.y - b.y)` 深度排序
- **验证**：所有11个文件语法通过 `node --check`
- **已实现的侧视角效果**：角色4方向显示/8方向移动、脚下阴影、墙壁立面高度、树木侧视、子弹远近缩放、弹壳重力下落、特效深度排序
- **已知问题**：上/下武器偏移在旋转坐标系下表现可能有偏差；Enemy 暂未添加 `_facingDir`（近战回退到 down）
