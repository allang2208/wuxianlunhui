# 变更日志

## 格式
每次对话结束时记录：
- 对话日期
- 修改的文件
- 修改内容摘要
- 测试结果
- 已知问题

## 2026-07-20（walking 瞬移正解：接入 sprite-offsets 运行时对齐系统）

### 对话：多版素材调整均不理想，查 SKILL.md 找现成方案
- **正解**：项目本有 `scripts/generate-sprite-offsets.js` 机制——生成每帧内容中心相对切分方格中心的偏移表（`data/sprite-offsets.json`），GameScene `_applySpriteFrameOffset` 按帧运行时校正贴图位置，**专治"精灵图各帧不在同一位置导致瞬移"，无需改素材**。
- **处理**：walking.png 恢复首次重排版（c8e7dca，原始网格 resize）；SHEETS 补蝇手 5 个动画（idle/walk/hammer/slam/grandSlam）；跑脚本生成偏移（walk 16 帧偏移 -98→+78 递增，正是帧内位移量）；双份同步 public/data/sprite-offsets.json。
- **教训**：遇到帧间对齐问题**先查项目既有机制**（sprite-offsets 偏移系统 + 生成脚本），不要直接改素材——素材保持原始，对齐交给运行时。
- **修改文件**：assets/enemies/flyhand/walking.png、scripts/generate-sprite-offsets.js、data/sprite-offsets.json、public/data/sprite-offsets.json、CHANGELOG.md。
- **测试结果**：lint ✅；vite build ✅；test-collider / test-craft-sync ✅。
- **已知问题**：实机待验证——移动动画贴图按帧校正后稳定不瞬移（浏览器需强刷/Disable cache）。

## 2026-07-20（walking 主体提取：手腕锚点统一）

### 对话：中心对齐后贴图仍前后瞬移，需主体提取统一位置
- **根因**：中心对齐用 bbox 中心作锚点，但各帧主体高 465~510 不一，底部（手腕支撑点）上下浮动 ±23px——视觉"有前有后"瞬移。
- **修复**：以**手腕底部中心**为统一锚点重做 16 帧——裁主体、超高帧（>450）等比缩小不裁切、底部中心 x 对齐帧中央、底部 y 统一 462（与攻击帧起手底部一致）。结果：15/16 帧底部 459~462、中心 x 255±2、高度 446~450。
- **修改文件**：assets/enemies/flyhand/walking.png、CHANGELOG.md。
- **测试结果**：vite build ✅；test-collider ✅。
- **已知问题**：实机待验证——贴图固定于手腕锚点，摆动自然无瞬移。

## 2026-07-20（walking 主体中心固定 + ping-pong）

### 对话：动画贴图位置不动、始终保持屏幕中央
- **处理**：walking 16 帧重做——逐帧裁主体后**中心对齐到 512×512 帧正中央**（水平/垂直均居中），各帧主体中心误差 ±2px；贴图显示中心即实体中心，帧内无任何位移。配合上一版 `yoyo: true` ping-pong 播放。
- **修改文件**：assets/enemies/flyhand/walking.png、CHANGELOG.md。
- **测试结果**：vite build ✅；test-collider ✅。
- **已知问题**：实机待验证——贴图固定屏幕中央，仅手掌张合摆动，无位移无回跳。

## 2026-07-20（walking 循环回跳修复：ping-pong 播放）

### 对话：动画播放完瞬移退回，原版是持续位移平滑移动
- **根因**：素材 16 帧的帧内主体位移呈两段递增（cx 158→336），循环点 15→0 时帧内位置回跳 -178px（屏幕上约 -90px）——"动画播完瞬移退回"即循环回跳，素材结构使然，与裁剪/对齐无关（帧内容逐帧目检完整，无切割错位）。
- **修复**：walking 动画加 `yoyo: true`（ping-pong 播放：0→15→0 正倒放）——循环衔接无回跳，帧内位移变为手掌前后摆动，配合实体移动视觉连续；frameRate 14 不变。
- **修改文件**：src/phaser/scenes/BootScene.js、CHANGELOG.md。
- **测试结果**：lint ✅；vite build ✅；test-collider ✅。
- **已知问题**：实机待验证——移动动画全程平滑无回跳；若 ping-pong 摆动感不符预期，备选方案为帧率匹配（frameRate 调至实体位移与帧内位移一致）。

## 2026-07-20（回退：walking 恢复至底部对齐修改前的版本）

### 对话：用户确认"两次修改前（调整底部对齐前）"的版本最合适
- **处理**：`walking.png` 再次恢复至 `c8e7dca`（新增蝇手时的首次重排：网格切分+resize 512×512，无任何对齐/缩放调整）——此后所有对齐类改动（077de9a/c5cc332/61d2933）均不再保留。
- **结论记录**：蝇手 walking 素材以**首次网格 resize 版**为准，帧率 14fps、底部不做对齐；底部统一诉求由 idle/攻击帧自身对齐承担（idle 已对齐 462，攻击帧起手 461~463）。
- **修改文件**：assets/enemies/flyhand/walking.png、CHANGELOG.md。
- **测试结果**：—（资源回退，无代码变更）。
- **已知问题**：无（用户确认的合适版本）。

## 2026-07-20（walking 动画：连贯与底部统一兼得）

### 对话：恢复后底部仍不齐，再排查优化
- **前因**：上一版恢复（c8e7dca 首次重排）动画连贯但底部不齐（467~510）；此前对齐版底部齐但裁主体居中破坏连贯。
- **正确方案**：整帧 resize（与首次一致，保留全部帧间自然位移）+ **逐帧仅垂直平移**（dy = 462 - 该帧主体底部），不裁剪、不缩放、不水平移动——动画连贯性与底部统一兼得。
- **踩坑记录**：大画布直接 paste 负 dy 时第二行帧内容溢出进第一行（前两次"第一行底部 512"误判均因此）；改先在 512×512 临时画布内合成再贴入大画布。最终各帧底部 460~462。
- **修改文件**：assets/enemies/flyhand/walking.png、CHANGELOG.md。
- **测试结果**：vite build ✅；test-collider ✅。
- **已知问题**：实机待验证——移动动画连贯且与攻击帧底部无跳变。

## 2026-07-20（回退：walking 动画恢复第一版）

### 对话：底部统一后移动动画不连贯，调回修改前的动画
- **处理**：`walking.png` 从 git 历史恢复至 c8e7dca 版本（首次重排：网格切分+resize 512×512，无 bbox 对齐/缩放）——用户确认该版本动画播放正常；idle（462 对齐）等其他文件不动。
- **备注**：此前两次"底部对齐"重排（077de9a/c5cc332）被本回退取代；若后续再做底部统一，需保留帧间自然位移（只平移整帧，不裁主体居中）。
- **修改文件**：assets/enemies/flyhand/walking.png、CHANGELOG.md。
- **测试结果**：vite build ✅；test-collider ✅。
- **已知问题**：无（恢复为用户确认的正常版本）。

## 2026-07-20（蝇手砸地红圈扩散特效）

### 对话：砸地攻击加手脑同款红圈扩散
- **实现**：`_fireSlamShockwave(range)` 复刻手脑/集合体冲击波模式——判定帧从蝇手中心释放红色椭圆圈（0xff3030 描边 8px + 闪烁 + 极淡填充），600ms 扩散到攻击影响范围（slam/grandSlam 的 range 300px），2:1 平面透视；hammer（单体锤击）不加。
- **清理**：`_slamGraphics` 数组管理 + `_destroyCustomEffects`（onDeath 统一入口，死亡即清）。
- **修改文件**：src/entities/enemy-types/fly-hand.js、CHANGELOG.md。
- **测试结果**：lint ✅；vite build ✅；test-collider ✅。
- **已知问题**：实机待验证——红圈扩散与 300px 判定圈视觉一致。

## 2026-07-20（蝇手全动画底部统一）

### 对话：walking 底部对齐三种攻击动画（上移）
- **基准测定**：三种攻击动画起手帧底部统一为 461~463（取 462）；walking 此前对齐在 492（低 30px）。
- **修复**：从原始素材（3902×982）重做 walking 16 帧——逐帧裁主体、**等比缩放至主体高 ≤450**（与攻击帧主体高 446~461 对齐，不再裁切内容）、水平居中、底部强制对齐 462；idle 主体同底部 462。验证：15/16 帧底部 461~462（帧 1 因原素材边缘羽化收至 444，播放不可见）。
- **修改文件**：assets/enemies/flyhand/walking.png、assets/enemies/flyhand/idle.png、CHANGELOG.md。
- **测试结果**：lint ✅；vite build ✅；test-collider ✅。
- **已知问题**：实机待验证——idle/walk/三攻击间切换无高度跳变。

## 2026-07-20（寻路"第一步反向"修复 + 蝇手碰撞微调）

### 对话：空地仍掉头（往左明显）继续排查 + 蝇手碰撞
- **根因（第二个反向源）**：A* 路径首点是**起点格子中心**（`_buildGrid` 节点 x/y 取 cell 中心）——怪物在格子内任意位置，重算后第一步要"先走回格子中心"，格子中心在行进方向身后时即瞬间掉头；重算时 minX 随起终点漂移导致格子对齐不稳定，往左走时 floor 对齐下位于格子右半部的概率高，故尤为明显。
- **修复**：`PathManager.setPath` 将 `path[0]` 对齐为怪物当前位置——路径跟随从脚下开始，消除格子中心折返；后续路点保持 A* 结果。
- **蝇手碰撞**：`render.colliderOffsetX: 10`（右移 10px，基类补 colliderOffsetX 读取，此前仅支持 Y）、`colliderOffsetY: 25`（下移 25px）、`collisionWidth` 80→100、`projectileHitbox.width` 90→110（水平左右各延伸 10px）。
- **修改文件**：src/ai/path-manager.js、src/entities/enemy.js、data/enemy-config.json、CHANGELOG.md。
- **测试结果**：JSON 校验 ✅；lint ✅；vite build ✅；test-collider ✅。
- **已知问题**：实机待验证——①空地往左/各方向追击不再掉头；②蝇手碰撞与贴图对齐。

## 2026-07-20（修复：寻路瞬间掉头反向——局部修复回退路径索引）

### 对话：近战怪寻路时一瞬间掉头往相反方向
- **根因**：`PathManager._repairPath` 在动态障碍图检测到路径节点被挡时，把 `pathIdx` **回退到阻挡点前 2 个节点**——怪物被迫折返已走过的路径点再前进，表现为"瞬间掉头"。动态障碍图 250ms 更新，修复频繁时反复反向。
- **修复**：局部修复改为**从怪物当前位置出发**搜索替代/完整路径（两种策略同改），不再回退索引；新路径首点即当前位置的下一节点，跟随方向连续。修复失败计数/无效标记逻辑不变。
- **修改文件**：src/ai/path-manager.js、CHANGELOG.md。
- **测试结果**：lint ✅（0 error）；vite build ✅；test-collider / test-craft-sync ✅。
- **已知问题**：实机待验证——近战怪（骑士/蝇手等）绕障追击不再折返；多怪混战时路径修复平滑。

## 2026-07-20（修复蝇手 walking 帧间"瞬移"）

### 对话：walking 精灵图不在一个水平上，移动状态频繁瞬移
- **诊断**：逐帧测主体 bbox——**图片问题非代码**。原素材帧间底部 y 从 467 跳到 510 再回 487（±43px），且帧 0-6 主体 x 坐标 0→165 递增（素材自带帧内位移），播放即上下跳+横移的"瞬移"感。
- **修复**：16 帧逐帧裁主体，水平居中 + 底部强制对齐到 y=492（与 idle/attacking 帧落点一致）重排；位移交给游戏内移动承担，动画原地踏步。精修后各帧底部 491~492（±1px）。
- **经验**：AI 生成的行走序列帧常自带帧内位移，**接入前必须逐帧验证 bbox 对齐**，不能假设素材规整（同手脑"4×8"教训）。
- **修改文件**：assets/enemies/flyhand/walking.png、CHANGELOG.md。
- **测试结果**：lint ✅；vite build ✅；test-collider ✅。
- **已知问题**：实机待验证——移动动画平稳无跳变。

## 2026-07-20（修复蝇群死亡音轨泄漏 + 蝇手攻击音效）

### 对话：蝇群死后音效不停 + 蝇手三种攻击判定音
- **蝇群死亡音轨泄漏根因**：死亡后 `active=false`，game loop `if (!e.active && !isCorpse) continue` 跳过 update——`_syncLoopSound` 里的"死亡即停"检查永远不执行（之前只修了场景切换路径，漏了死亡路径）。修复：`damageable-entity.onDeath()` 统一调用 `_destroyCustomEffects()`——所有怪的循环音轨/头部粒子/范围圈/投射物在死亡瞬间统一清理（一劳永逸，新怪特效自动受益）。
- **蝇手音效**：hitting-2.mp3 复制到 `assets/sounds/enemies/flyhand/`；配置 `sounds.attack`；`_dealHit` 判定帧三技能统一播放（`_playSound` 与手脑/骑士同工作流，支持数组随机）。
- **修改文件**：src/entities/damageable-entity.js、src/entities/enemy-types/fly-hand.js、data/enemy-config.json、assets/sounds/enemies/flyhand/hitting-2.mp3、CHANGELOG.md。
- **测试结果**：JSON 校验 ✅；lint ✅；vite build ✅；test-collider ✅。
- **已知问题**：实机待验证——①蝇群死亡瞬间音轨停止；②蝇手三技能判定音与帧同步。

## 2026-07-20（蝇手 idle 帧统一裁剪）

### 对话：idle 与 walking 切换时贴图大小跳变
- **根因**：idle 原图为 2048×2048 整幅单帧（主体满幅），walking/attacking 为 512×512 帧（主体仅占 ~60%×90%）——渲染按最长边等比缩放后 idle 显示主体大一圈，状态切换明显跳变。
- **修复**：idle.png 按 alpha 主体边界裁出（1538×2048），等比缩至主体高 450（与 walking/attacking 帧主体 446~467 对齐），居中重排到 512×512 画布；BootScene 加载帧尺寸 2048→512 同步，enemy-config textures 元数据同步。
- **修改文件**：assets/enemies/flyhand/idle.png、src/phaser/scenes/BootScene.js、data/enemy-config.json、CHANGELOG.md。
- **测试结果**：JSON 校验 ✅；lint ✅；vite build ✅；test-collider ✅。
- **已知问题**：实机待验证——idle/walk/攻击三态切换大小一致无跳变。

## 2026-07-20（主神空间清场：只留蝇手 + 拆除迷宫墙壁）

### 对话：删除其他怪物和迷宫墙壁，蝇手生成位置防卡墙
- **拆除迷宫**：`WallSystem.init` 的迷宫生成段（MazeGenerator 调用+三段边界墙）整段移除，主神空间变为开阔场地；`mazeEndY/_mazeOX` 等字段确认无外部引用；`maze-generator.js` 保留备用；清理未使用 import。
- **测试怪清场**：`spawnMainHubTestEntities` 只保留 `spawnMainFlyHand`（骑士/手脑/蝇群 spawn 方法保留备用）。
- **蝇手生成位置**：origin.x+400, origin.y+100（原 origin.x+350, y-320 位于迷宫区卡墙）。
- **修改文件**：src/world/wall-system.js、src/game.js、CHANGELOG.md。
- **测试结果**：lint ✅（0 error）；vite build ✅；test-collider ✅。
- **已知问题**：实机待验证——①主神空间无墙无其他怪物；②蝇手生成位置开阔、追击/技能无障碍。

## 2026-07-20（新怪物「蝇手」（领主，僵尸 family））

### 对话：按工作流新增蝇手——三技能+召唤蝇群
- **素材处理**：idle.png 为整幅 2048×2048 单帧（苍蝇组成的巨掌）；walking.png 实测 3902×982 不可整除（487.75×491/帧），**PIL 重排为 4096×1024 标准 512×512 帧**（8列×2行16格）；attacking/attacking-2/attacking-3 为 8列×4行 512×512（16/24/19 帧，与口述一致）。
- **配置**（enemy-config.json flyHand）：HP 1500、speed 160、rank lord、family 僵尸（lord 池自动纳入）；显式 atk 60 / def 75 / mdef 30 / crit 25（matk 随公式）；`attackSkills` 三技能全配置驱动：hammer（1.5s/16帧/第3帧/100px/击退75/CD4s）、slam（2s/24帧/第4帧/300px/×1.5/眩晕1s/CD8s）、grandSlam（2s/19帧/第6帧/300px/×2/眩晕1s/CD20s + summon 蝇群×3/散布50px）。
- **逻辑**（`src/entities/enemy-types/fly-hand.js`）：无默认普攻（aiInterval=MAX）；通用技能驱动 `_startAction/_updateAction`（帧判定对齐动画进度）；锤击单体近战+击退、砸地/重砸 GroundEllipse 范围判定+眩晕；**重砸判定帧无论命中与否**召唤 3 只蝇群（`_summoned` 标签无经验金币，脚下 `playDungeonSpawnParticles` 黑色粒子同款）；眩晕/恐惧中断；`_attackAnimTimer` 锁定 MovementSystem。
- **注册**：enemy-types.js、ZOMBIE_FACTORY_MAP.flyHand（lord 池可抽）、game.js `spawnMainFlyHand` 主神空间生成（origin 上方站位）。
- **修改文件**：src/entities/enemy-types/fly-hand.js（新）、src/entities/enemy-types.js、src/game.js、src/world/zombie-dungeon.js、src/phaser/scenes/BootScene.js、data/enemy-config.json、assets/enemies/flyhand/（5 png，walking 重排）、CHANGELOG.md。
- **测试结果**：JSON 校验 ✅；lint ✅（0 error）；vite build ✅；test-collider / test-craft-sync ✅。
- **已知问题**：实机待验证——①三技能帧判定与动画同步；②锤击击退方向；③重砸召唤蝇群位置/黑粒子；④贴图大小（spriteSize 260 初值）；⑤lord 掉落/经验结算。

## 2026-07-20（代币合成规则：代币只能合成代币）

### 对话：调整——代币合成产物为下一级代币而非随机祭品
- **规则实现**（fusion-system.js）：
  - 材料中含代币但**不全是代币** → 拦截并提示「代币只能与代币合成」；
  - 材料全为代币 → `_fusePair(rarity, isToken=true)`：产物为**下一级代币**（2F→1E、2E→1D…），传说级（A 代币）合成产物为同级 A 代币（对齐传说重随语义）；
  - 新增 `_pickTokenByRarity`（shopOnly 专属池取件）；全非代币材料维持原随机祭品逻辑。
- **修改文件**：src/ui/fusion-system.js、CHANGELOG.md。
- **测试结果**：lint ✅；vite build ✅；test-collider / test-craft-sync ✅。
- **已知问题**：实机待验证——①2 个 F 代币合成 1 个 E 代币；②代币+普通祭品混合被拦截提示；③2 个 A 代币合成 A 代币。

## 2026-07-20（确认：时空锚点代币允许作为合成材料）

### 对话：代币可放入合成栏合成——用户确认放行
- **链路审查结论（无需改代码）**：`placeFromBackpack` 仅过滤 `category === 'tribute'`（代币满足）；`fuse()` 仅按稀有度配对、不读材料 effects（代币无 effects 无影响）；一键放入按稀有度匹配（代币会被正确选中）；`_fusePair` 产物走 `pickTributeByRarity`——**产物池已排除 shopOnly，合成不会产出代币，只消耗代币**。A 级代币（传说）配对按既有规则销毁重随一件随机传说祭品。
- **设计语义**：代币获取仍仅限商店购买；合成是代币的消耗/转化渠道（2 个 F 代币 → 1 个随机优质祭品），不违反"只能购买获得"。
- **修改文件**：CHANGELOG.md。
- **测试结果**：代码路径审查 ✅（lint/build 无变更）。
- **已知问题**：实机待验证——2 个 F 代币合成出随机优质祭品、A 级代币重随传说。

## 2026-07-20（排查修复：循环音轨泄漏 + 玩家恐惧速度口径）

### 对话：回头看 bug 排查
- **循环音轨场景切换泄漏**：`switchScene` 直接 `Game.entities.clear()` 清实体，不走 `_destroyCustomEffects`——蝇群 `loop=true` 的音轨永不停止（切场景后怪没了声音还在）。修复：SoundManager 新增 `stopAllLoops()`，`switchScene` 清理段调用（一并兜底未来其他循环音轨）；补 scene-manager 的 SoundManager import（typeof 守卫在未 import 时永远跳过，差点又埋一颗）。
- **玩家恐惧速度口径**：恐惧逃跑速度原用 `this.data.speed`（面板值），与正常移动体系（`this.maxSpeed`）不一致——改 `this.maxSpeed || this.data.speed` × 层数倍率。
- **复核无问题项**：手脑嚎叫每跳叠层符合设计（0.5s 一跳、3 层封顶 -99%）；蝇群 noCollision 穿人/墙壁解析正常；代币合成栏放入为设计待定项（用户已知）；双份 JSON 一致。
- **修改文件**：src/ui/sound-manager.js、src/world/scene-manager.js、src/entities/player/update.js、CHANGELOG.md。
- **测试结果**：lint ✅；vite build ✅；test-collider / test-craft-sync ✅。
- **已知问题**：实机待验证——地牢↔主神空间切换后蝇群音轨停止；恐惧逃跑速度与平时跑路一致体感。

## 2026-07-20（蝇群循环音效：音量随距离 50%→150%）

### 对话：蝇群 idleing 持续循环，接近玩家音量提高
- **SoundManager 新增循环音轨 API**（WebAudio BufferSource+GainNode，音量可 >100%，HTMLAudio volume 上限 1 不可用）：`playLoop(id, path, volume)` / `setLoopVolume(id, volume)` / `stopLoop(id)`——通用能力，后续怪物环境音可复用。
- **蝇群接入**：`sounds` 配置块（loop 路径、loopVolumeBase 0.5、loopVolumeMax 1.5、loopNearDist 150、loopFarDist 600）；`_syncLoopSound` 每帧按与玩家距离线性插值音量（近 150px→150%，远 600px→50%）；死亡/移除经 `_destroyCustomEffects` 停止音轨。
- **素材**：idleing.mp3 复制到 `assets/sounds/enemies/flyswarm/`。
- **修改文件**：src/ui/sound-manager.js、src/entities/enemy-types/fly-swarm.js、data/enemy-config.json、assets/sounds/enemies/flyswarm/idleing.mp3、CHANGELOG.md。
- **测试结果**：JSON 校验 ✅；lint ✅；vite build ✅；test-collider ✅。
- **已知问题**：实机待验证——①循环播放与音量渐变；②死亡后音轨停止；③多只蝇群同时存在时各自音轨独立（id 随机）。

## 2026-07-20（手脑/蝇群归入僵尸 family）

### 对话：删除独立 family，归入僵尸
- **配置**：shounao.family '手脑' → '僵尸'；flySwarm.family '蝇群' → '僵尸'（enemy-config.json）。
- **联动**：
  - 蝇群（rank normal）**进入僵尸地牢普通怪物池**——补注册 `createFlySwarm` 工厂 + `ZOMBIE_FACTORY_MAP.flySwarm`（普通池筛选条件：family 僵尸 + rank 非 elite/lord/boss + 工厂已注册，三者齐备）；
  - 手脑（rank lord）已在跨 family 的 lord 池，family 归一无池变化；
  - 受击粒子此前已去 family 过滤，无影响；代码中无其他按 family 名字面量引用。
- **修改文件**：data/enemy-config.json、src/world/zombie-dungeon.js、CHANGELOG.md。
- **测试结果**：JSON 校验 ✅；lint ✅（0 error）；vite build ✅；test-collider ✅。
- **已知问题**：实机待验证——僵尸地牢普通战斗中刷出蝇群。

## 2026-07-20（怪物名字按等级着色）

### 对话：精英紫 / 领主橙 / 首领红
- **实现**：`_syncEntityHud` 普通敌人名字按 `entity.rank` 着色——`RANK_NAME_COLORS = { elite: '#c67affcc', lord: '#ffa500cc' }`（含原透明度 cc）；boss 走 bossName 样式（#ff5050 红）保持不变；普通怪维持米白默认。
- **修改文件**：src/phaser/scenes/GameScene.js、CHANGELOG.md。
- **测试结果**：lint ✅；vite build ✅；test-collider ✅。
- **已知问题**：实机待验证——骑士紫名、手脑橙名、集合体红名。

## 2026-07-20（手脑/蝇群删除默认普攻 + 蝇群碰撞下移）

### 对话：删除手脑多余普攻模式 + 蝇群仅保留触碰伤害
- **根因**：CombatSystem 按 `aiInterval` 周期性触发基类默认近战普攻（thrust）——手脑在 slam/howl 之外还有第三套普攻。
- **修复**：手脑/蝇群 constructor 设 `this.aiInterval = Number.MAX_SAFE_INTEGER`（集合体同款"攻击完全由本类自管"模式）——手脑只剩砸地/嚎叫，蝇群只剩三位一体触碰伤害。
- **蝇群碰撞区下移**：hitCircles 三圆 y 各 +25（中心 (0,25,r34)、左右 (±26,29,r22)）。
- **修改文件**：src/entities/enemy-types/shounao.js、src/entities/enemy-types/fly-swarm.js、data/enemy-config.json、CHANGELOG.md。
- **测试结果**：JSON 校验 ✅；lint ✅；vite build ✅；test-collider ✅。
- **已知问题**：实机待验证——①手脑不再出现 thrust 普攻；②蝇群仅触碰伤害；③碰撞区对齐。

## 2026-07-20（debuff「恐惧」+ Buff/Debuff 工作流）

### 对话：建立 buff/debuff 工作流 + 恐惧效果 + 手脑嚎叫附加
- **恐惧效果**（`applyFear(duration, source)`，基类 damageable-entity）：
  - 受影响单位朝恐惧源**相反方向**移动；玩家失控（输入全部无效、防御取消、墙壁解析不可穿墙）；
  - 移速 -33%/层，持续内再受恐惧 +1 层（上限 3 层 = -99%），`getFearSpeedMul()` 下限 0.01；
  - 持续时间**孰长刷新**（复用 addStatusEffect 内置 Math.max 语义）；层数独立叠加；
  - 状态栏显示：STATUS_CONFIG 注册 😱恐惧（紫色）；玩家自身中恐惧才进左上角 StatusBar（怪物不占玩家 UI）。
- **生效三层**：玩家 update.js 恐惧分支（失控反向跑）；MovementSystem 恐惧分支（怪物逃跑+墙壁解析）；Enemy 基类 + 骑士/手脑/蝇群各自 update 恐惧中断（技能/动作停摆）。
- **手脑嚎叫**：每跳伤害对目标 `applyFear(fearMs, this)`——`howl.fearMs: 3000` 配置化。
- **工作流入库**（SKILL.md）：STATUS_CONFIG 注册→apply 方法（孰长刷新/叠层/玩家UI分支/浮动文字）→三层生效点（玩家分支/MovementSystem 接管/基类+子类中断）→数值配置化→验证五步。
- **修改文件**：src/entities/damageable-entity.js、src/entities/player/update.js、src/entities/enemy.js、src/entities/enemy-types/{armored-knight,shounao,fly-swarm}.js、src/systems/movement-system.js、data/enemy-config.json、SKILL.md、CHANGELOG.md。
- **测试结果**：JSON 校验 ✅；lint ✅；vite build ✅；test-collider / test-craft-sync ✅。
- **已知问题**：实机待验证——①玩家被嚎叫命中后失控反向跑+状态栏图标；②3s 后再中恐惧层数+减速加深；③孰长刷新；④怪物中恐惧的逃跑表现（骑士/手脑被打断动作）。

## 2026-07-20（新怪物「蝇群」（普通））

### 对话：按工作流新增蝇群——虚化虫体+三位一体触碰伤害+远程减伤
- **素材**：idle.png（4096×2048，8列×4行=32 帧 512×512）复制至 `assets/enemies/flyswarm/`；BootScene spritesheet + 32 帧循环动画（frameRate 16）。
- **配置**（enemy-config.json flySwarm）：HP 80、speed 200、rank normal、family 蝇群（不进僵尸池）；显式 atk 20 / mdef 55 / crit 20（def/matk 随六维公式）；`noCollision: true`；`rangedDamageTakenMul: 0.5`；`hitCircles` 品字形三圆（中心 r34 + 左右 r22）；`contactDamage`（500ms / ×1 / 物理）。
- **逻辑**（`src/entities/enemy-types/fly-swarm.js`）：
  - **虚化虫体**：`noCollision` 常驻（碰撞体积为 0——实体互相穿过，骑士冲锋同款；墙壁仍由 WallSystem 解析不可穿墙）；collisionRadius 45 保留受击判定。
  - **触碰伤害**：每 500ms 对任一三位一体子圆（GroundEllipse 2:1 透视）内敌对目标结算 atk×1。
  - **远程减伤**：takeDamage 覆盖——isMelee=false 的伤害 ×0.5（物理/魔法远程统一），近战不受影响。
- **注册**：enemy-types.js import/export；game.js `spawnMainFlySwarm` 加入主神空间统一生成入口（origin 下方站位，永久警戒）。
- **修改文件**：src/entities/enemy-types/fly-swarm.js（新）、src/entities/enemy-types.js、src/game.js、src/phaser/scenes/BootScene.js、data/enemy-config.json、assets/enemies/flyswarm/idle.png、CHANGELOG.md。
- **测试结果**：JSON 校验 ✅；lint ✅；vite build ✅；test-collider / test-craft-sync ✅。
- **已知问题**：实机待验证——①蝇群穿人不穿墙；②三圆触碰区与贴图对齐（hitCircles 偏移可报数调）；③触碰 0.5s 伤害节奏；④远程伤害减半生效；⑤贴图大小（spriteSize 120 初值）。

## 2026-07-20（手脑碰撞下移 25 + 骑士粒子方向化）

### 对话：手脑下移 25px + 粒子按朝向偏移/冲锋近水平后喷
- **手脑**：`colliderOffsetY` 0 → 25（用户重新调整的第一档）。
- **骑士粒子方向化**（面朝右基准，朝左自动镜像）：
  - 发射点偏移：二连击 +10px（朝向侧）、冲锋 +20px（朝向侧，用冲锋死区朝向 `_chargeFaceDir` 防抖动）；
  - 冲锋喷出角由"向上+重力后拉"改为**直接近水平向后**（冲锋反方向 ±12°），gravityY 归 0、重力沿反方向后拉强化拖尾；角度变化超 15° 才重配（避免每帧 setConfig 的 GC 开销）。
- **修改文件**：src/entities/enemy-types/armored-knight.js、data/enemy-config.json、CHANGELOG.md。
- **测试结果**：lint ✅；vite build ✅；test-collider ✅。
- **已知问题**：实机待验证——①各朝向冲锋拖尾方向正确；②二连击粒子偏移；③手脑 25px 对齐。

## 2026-07-20（手脑碰撞复位 + 修复骑士粒子冲锋不跟随）

### 对话：手脑下移过多复位 + 粒子冲锋时在原地不动
- **手脑碰撞复位**：`colliderOffsetY` 140 → 0（基类修复后 140 首次真实生效即过大；归零由用户重新逐步调整）。
- **粒子冲锋不跟随根因**：`update()` 的动作分支（combo/charge/defend）**直接 return**——`_syncHeadParticles()` 在这些状态下从未执行，发射点停在冲锋起点；撞击结束回到常规路径后发射点才瞬移到骑士身边（与用户观测完全吻合）。
- **修复**：三个动作分支在 return 前补 `this._syncHeadParticles()`——冲锋全程发射点绑定贴图，拖尾正确拉在身后。
- **修改文件**：src/entities/enemy-types/armored-knight.js、data/enemy-config.json、CHANGELOG.md。
- **测试结果**：JSON 校验 ✅；lint ✅；vite build ✅；test-collider ✅。
- **已知问题**：实机待验证——①冲锋全程粒子跟随+身后拖尾；②手脑碰撞归零后对齐。

## 2026-07-20（修复：setGravity is not a function 游戏循环报错）

### 对话：game.js:741 Game loop error（骑士粒子冲锋拖尾）
- **根因**：Phaser 4 粒子发射器没有 `setGravity`——重力设置为 `setParticleGravity(x, y)`（Phaser 4 重命名，与 postFX 同类的 API 迁移坑）。
- **修复**：armored-knight.js 冲锋拖尾两处调用改名 `setParticleGravity`。
- **测试结果**：lint ✅；vite build ✅；test-collider ✅。
- **已知问题**：实机待验证——冲锋拖尾重力方向生效、无再报错。

## 2026-07-20（修复：手脑 colliderOffsetY 从未生效）

### 对话：手脑碰撞体积没有下移，是否圆/椭圆搞混
- **根因**：`render.colliderOffsetY` 的读取（`this.colliderOffsetY = config.render.colliderOffsetY`）此前只写在**集合体自己的构造器**里——基类 Enemy 从不读该配置，手脑的 50/80/110/140 四次调整全部落空。不是圆/椭圆混淆，是配置没被读取。
- **修复**：读取上移至 `enemy.js` 基类构造器——所有怪物配置即用（骑士/手脑/未来新怪）；集合体构造器内的重复赋值同值无害保留。
- **修改文件**：src/entities/enemy.js、CHANGELOG.md。
- **测试结果**：lint ✅；vite build ✅；test-collider ✅。
- **已知问题**：实机待验证——手脑判定圆心下移至 140px 后与贴图对齐（此前多次"下移"实际未生效，本次为首次真实生效，可能需要复核数值）。

## 2026-07-20（手脑碰撞微调 + 骑士粒子冲锋拖尾）

### 对话：手脑下移/矩形拉伸 + 粒子上移与冲锋身后扩散
- **手脑**：`colliderOffsetY` 110 → 140（再下移 30px）；投射物矩形 `projectileHitbox.width` 80 → 110（左右各 +15px）。
- **骑士头部粒子**：发射点上移 10px（100→90）；发射点每帧绑定贴图模型位置；**冲锋状态切换时重配粒子**——speed 15~40 → 60~130（加快）、频率 90→45ms（更密）、gravityY -40→-20 且每帧向冲锋反方向施加 110 重力（粒子向身后浮动扩散拖尾）；退出冲锋恢复原配置。
- **修改文件**：src/entities/enemy-types/armored-knight.js、data/enemy-config.json、CHANGELOG.md。
- **测试结果**：JSON 校验 ✅；lint ✅；vite build ✅；test-collider ✅。
- **已知问题**：实机待验证——①冲锋拖尾方向与速度观感；②平时粒子上移后位置；③手脑碰撞对齐。

## 2026-07-20（骑士粒子调整 + 手脑声音系统）

### 对话：头部粒子下移/加密/水平抖动 + 手脑全套音效
- **骑士头部粒子**：发射点下移 100px；频率 180→90ms（粒子数翻倍）；水平轴 ±5px 抖动生成。
- **手脑声音系统**（按骑士工作流）：
  - 素材 4 个 mp3 复制到 `assets/sounds/enemies/shounao/`；
  - enemy-config `sounds` 块：`walk` 为**数组**（walking.mp3 / walking-2.mp3 随机）、`walkInterval` 500、`slam`（hitting）、`howl`（howling）；
  - `shounao.js` 新增 `_playSound`（数组随机选一，配置驱动）；walk 状态按间隔播放脚步；`_dealSlamHit` 判定伤害时播放 hitting；`_startHowl` 播放 howling。
- **修改文件**：src/entities/enemy-types/armored-knight.js、src/entities/enemy-types/shounao.js、data/enemy-config.json、assets/sounds/enemies/shounao/（4 mp3）、CHANGELOG.md。
- **测试结果**：JSON 校验 ✅；lint ✅；vite build ✅；test-collider ✅。
- **已知问题**：实机待验证——①粒子位置/密度；②脚步随机交替与音量；③砸地/嚎叫音效同步。

## 2026-07-20（骑士头部蓝色浮动粒子）

### 对话：参考符文长剑蓝色粒子，骑士贴图头部持续向上浮动
- **实现**：`_syncHeadParticles`（骑士 update 每帧调用）——Phaser 粒子发射器，`impact_dot` 白色纹理 + `tint 0x3282ff`（符文长剑蓝同值），发射角 255°~285°（正上方 ±15°）、gravityY -40 持续上浮、lifespan 1400、180ms/颗、ADD 混合、缩放/透明度尾迹淡出；发射点每帧跟随贴图头顶（`sprite.y - displayHeight/2`）。
- **清理**：hp<=0 立即销毁（尸体不飘）；sprite 失效自动销毁；`_destroyCustomEffects` 接入 removeEntity 统一通道。
- **修改文件**：src/entities/enemy-types/armored-knight.js、CHANGELOG.md。
- **测试结果**：lint ✅；vite build ✅；test-collider ✅。
- **已知问题**：实机待验证——粒子颜色/密度/上浮速度观感。

## 2026-07-20（初级地牢最短战斗 4 + 仓库拖拽两项优化）

### 对话：长期存储暂缓 + 地牢/仓库调整
- **长期存储**：用户决定游戏开发完成后再做，当前不动。
- **僵尸地牢-初级**：`shortestCombatPath` 7 → 4 场。
- **仓库界面拖消耗品不再隐藏背包**：drag-drop-manager 的"消耗品拖拽隐藏面板"（服务于拖到快捷栏）在仓库打开时跳过（UIState.isOpen('warehouse') 判断），双面板保持可见。
- **拖拽按目标槽位放置**：
  - 背包→仓库格子：`storeFromBackpackAt(bpIdx, wSlot)`——空格直接放入指定槽；同名可堆叠合并（溢出按原规则落空位，满仓回滚提示）；不同物品交换（仓库原物回背包）。
  - 仓库→背包格子：`retrieveToBackpackAt(wSlot, bpSlot)` 同规则镜像；EventBus 桥接改传 `{ wSlot, bpSlot }`；双击/右键取出不传 bpSlot 时仍走原堆叠/空位逻辑（retrieveToBackpack）。
  - 仓库内互拖保持 `_swapSlots` 交换。
- **修改文件**：src/ui/warehouse-system.js、src/ui/equip/drag-drop-manager.js、data/dungeon-config.json、CHANGELOG.md。
- **测试结果**：JSON 校验 ✅；lint ✅；vite build ✅；test-collider / test-craft-sync ✅。
- **已知问题**：实机待验证——①消耗品拖到仓库格子面板不消失；②拖放落点精确到格；③交换场景双方物品归位正确；④初级地牢最短 4 战。

## 2026-07-20（时空锚点代币：商店专供的等级地牢钥匙）

### 对话：新增代币系列，只能从商店购买获得
- **代币数据**：equipment.json 双份新增 6 条（anchorTokenF~A），category tribute、稀有度 common~legendary 一一对应（F↔普通…A↔传说）、**无 effects**（无任何属性效果）、`price`=稀有度标准价（100~3200）、`shopOnly: true` 标记、maxStack 999。作祭品放入出征栏即满足对应地牢门槛（F 级代币→F 级地牢…）。
- **产出途径梳理（仅商店）**：
  - 掉落/奖励/合成/点石成金四池同源——`_pickTributeByRarity` 增加 `!it.shopOnly` 过滤（加无 effects 天然排除，双保险），代币永不进池；
  - 初始背包/仓库种子不含代币。
- **商店上架**：ShopSystem `_items` 加 6 条，`shopPrice`=标准价×2（200~6400）；`buy()` 支持 `shopPrice ?? item.price` 扣费；shopPrice 商品购买后**保留物品自身 price**（出售基准），普通商品维持原防套利行为（删 price）。
- **表格**：tributes-table.md 重新生成（48 件，代币标注"用途 X 级地牢钥匙"）。
- **修改文件**：data/equipment.json、public/data/equipment.json、src/config/tribute-effects.js、src/ui/shop-system.js、tributes-table.md、CHANGELOG.md。
- **测试结果**：JSON 双份一致 ✅；lint ✅；vite build ✅；test-craft-sync ✅。
- **已知问题**：实机待验证——①商店 6 档代币购买价与金币扣除；②代币放入出征栏解锁对应地牢；③地牢内不掉代币（掉落池无）；④代币卖店价格（标准价×0.5 通用规则）。

## 2026-07-20（僵尸地牢-中级（E 级）+ 地牢工作流与要素表）

### 对话：建立地牢工作流 + 新增中级地牢 + Boss 领主池 + 地牢表格
- **新地牢「僵尸地牢-中级」（zombieMid，E 级）**：30 房间、起始 3 条路线（startRows [0,1,2]）、战斗/事件 50%/50%、精英战斗 40%、最短路径 4 场战斗；Boss 战独立遭遇 `monsterComposition: { lord: 1 }`——**从领主池随机抽 1 只**（新增 `monsterPool.lord` getter：跨 family 按 rank='lord' 筛，当前=手脑；`ZOMBIE_FACTORY_MAP` 注册 shounao + createShounao 工厂）。
- **Boss 分支去硬编码**：`_enterBoss` 由按地牢名特判（'zombieBeginner'）改为配置驱动——`bossEncounter` 存在即走独立遭遇流程，新地牢零代码接入。
- **登记**：`_keyFor` 加 zombieMid→zombieDungeonMid 映射（工作流保留的唯一硬编码点）；dungeonList 展示元数据同步，出征选择器/说明栏自动出现。
- **地牢添加标准工作流入库**（SKILL.md）：展示元数据→配置块（房间/比例/精英/遭遇/grid/起始路线/bossEncounter）→_keyFor 登记→怪物池→验证五步；事件与奖励对应关系由 grade 驱动。
- **地牢要素表**：`scripts/generate-dungeons-table.mjs` 生成 `dungeons-table.md`（房间数/起始路线/战斗事件比/精英率/最短战斗/Boss 构成，一地牢一行）。
- **修改文件**：data/dungeon-config.json、src/config/dungeon-config.js、src/world/zombie-dungeon.js、src/world/dungeon-map-system.js、scripts/generate-dungeons-table.mjs（新）、dungeons-table.md（新）、SKILL.md、CHANGELOG.md。
- **测试结果**：JSON 校验 ✅；lint ✅；vite build ✅；test-collider / test-craft-sync ✅。
- **已知问题**：实机待验证——①出征界面出现中级并正确显示 E 级门槛（优质祭品）；②Boss 战刷出手脑且 lord 掉落/经验生效；③事件池 E±1（D~F 级限定）与 E 级奖励档。

## 2026-07-20（手脑碰撞再调 + 仓库拖拽系统接入）

### 对话：手脑下移/横拉 + 仓库拖拽防丢弃与仓到包失灵
- **手脑碰撞**：`colliderOffsetY` 80 → **110**（再下移 30px）；`collisionRadius` 39 → **59**（footprint 横向总宽 +40px，左右各约 +20）。
- **仓库拖拽修复与优化**：
  - **仓到包失灵根因**：仓库格子从未绑定拖拽（`_renderGrid` 只绑双击/右键）；且 drag-drop-manager 的 dragstart 类型判断把 wh-cell 误归为 `inventory`。
  - **接入拖拽**：仓库格子绑定 dragstart/dragend/ondrop——拖到背包格子经 `handleDrop` 新增 warehouse 分支 + `EventBus('warehouse:retrieveToBackpack')` 桥接取出（避免 drag-drop-manager ↔ warehouse 循环 import）；背包格子拖到仓库格子=存入（读取拖拽管理器 `_dragSrc`）；仓库格子互拖=交换槽位（`_swapSlots`）。
  - **防丢弃**：拖到仓库面板非格子区域标记 `_dropHandled`（物品原位保留）；warehouse 源在 `_doDiscard` 各分支均不匹配，拖到游戏区/遮罩也不会被丢弃；`.warehouse-panel` 加入拖拽安全元素列表。
- **修改文件**：src/ui/warehouse-system.js、src/ui/equip/drag-drop-manager.js、data/enemy-config.json、CHANGELOG.md。
- **测试结果**：JSON 校验 ✅；lint ✅（0 error）；vite build ✅；test-collider / test-craft-sync ✅。
- **已知问题**：实机待验证——①仓库↔背包双向拖拽；②拖到面板空白/游戏画面物品不丢；③仓库内换位；④手脑碰撞对齐。

## 2026-07-20（光晕重构：filters 改烘培纹理——修卡顿+不明显）

### 对话：光晕几乎看不到且游戏变卡
- **卡顿根因确认**：Phaser 4 `filters` 是每个 GameObject 一个独立 render-to-texture + shader pass——满地掉落物每帧几十个额外渲染通道，正是特效导致的掉帧。
- **不明显根因**：glow 沿贴图 alpha 边缘发光，贴图 512px 缩到 48px 显示时 10px 光晕被稀释至 ≈1px。
- **替代方案（烘培纹理）**：`bakeGlowTexture`——贴图首次加载时离屏 canvas 一次性生成"稀有度色外发光+原图"纹理：`shadowBlur` 24px 叠画 5 次累积浓郁光晕（由深至浅渐变），顶层画原图保证本体清晰；光晕按显示比例烘培（显示 48px 时约 10px 可见）；纹理按 贴图路径+稀有度 缓存复用，**渲染零开销**。filters 调用全部移除。
- **修改文件**：src/entities/drop-item.js、SKILL.md、CHANGELOG.md。
- **测试结果**：lint ✅；vite build ✅；test-collider ✅。
- **已知问题**：实机待验证——①各稀有度光晕浓度/宽度；②帧率恢复情况。

## 2026-07-20（骑士 footprint+15 / 玩家眩晕星星 / 骑士蓝色快粒子）

### 对话：骑士椭圆半径 + 玩家眩晕特效 + 骑士受击粒子定制
- **骑士脚下椭圆半径**：`collisionRadius` 29 → 44（+15px）。
- **玩家眩晕星星**：`_syncStunEffects` 原循环只认 `e._phaserSprite`——玩家贴图挂 `this.playerSprite`，被跳过。循环体抽为 `process(e, sprite)` 复用，玩家单独以 playerSprite 传入：被眩晕时头顶同款双星旋转，结束消失。
- **骑士受击蓝色快粒子**：粒子速度/距离参数化——`playZombieHitParticles` 新增 opts `{speedMul, distMul}`（速度 ×speedMul、存活 ×distMul=飞更远，发射器销毁延迟同步）；`triggerZombieHitParticles` 从 `target.config` 读取 `hitParticleSpeedMul/hitParticleDistMul` 传入。骑士配置：`hitParticleColor '#4a8aff'`、`hitParticleSpeedMul 1.5`、`hitParticleDistMul 1.3`。
- **修改文件**：src/phaser/scenes/GameScene.js、data/enemy-config.json、CHANGELOG.md。
- **测试结果**：JSON 校验 ✅；lint ✅；vite build ✅；test-collider / test-craft-sync ✅。
- **已知问题**：实机待验证——①玩家被骑士冲锋撞晕时头顶双星；②骑士受击蓝色粒子速度/距离体感；③骑士 footprint 扩大后近身判定。

## 2026-07-20（光晕修复：贴图被挖空 + 加宽 10px）

### 对话：光晕覆盖贴图不显示 + 太薄
- **根因**：`knockout: true` 的真实语义是"只画光晕、不画贴图本体"（only the glow is drawn, not the texture itself）——上一版把"轮廓外显示"误实现为挖空贴图。纠正 `knockout: false`：贴图完整显示，光晕从轮廓边缘向外自然渐变（即用户要的"轮廓外显示"效果）。
- **加宽**：distance 3 → 10px。
- **修改文件**：src/entities/drop-item.js、SKILL.md（knockout 语义纠正）、CHANGELOG.md。
- **测试结果**：lint ✅；vite build ✅；test-collider ✅。
- **已知问题**：实机待验证——贴图本体+10px 轮廓光晕同时正常显示。

## 2026-07-20（植物贴图主体统一居中）

### 对话：贴图不裁剪、调整比例使主体等大且居中
- **分析**：20 张植物贴图尺寸/主体占比不一（千年人参主体仅占 40%×84% 且偏左下，天山雪莲 54%×63%，其余多为全幅）。
- **处理**（PIL 批处理）：每张取 alpha 主体边界框（只裁透明边、主体完整不裁切）→ 等比缩放至最长边 360px → 居中贴到 512×512 透明画布，覆盖原文件。全部 20 张主体大小一致、居中。
- **验收**：contact sheet 拼图目检通过（原偏移的南瓜/人参/雪莲已居中，窄长主体如胡萝卜/黄瓜按比例同高）。
- **修改文件**：assets/items/tributes/plants/*.png（20 张重排）、CHANGELOG.md。
- **测试结果**：lint ✅；vite build ✅。
- **已知问题**：实机待验证——格子/掉落显示效果；洋葱类带细须主体的观感。

## 2026-07-20（修复：掉落物光晕完全未生效——Phaser 4 FX API 迁移）

### 对话：所有掉落物（武器/祭品）看不到光晕
- **根因**：Phaser 4 移除了 `sprite.postFX`（v3.60 API）——`sprite.postFX && ...` 短路静默失败，glow 从未挂上。Phaser 4 正确路径为 `sprite.enableFilters().filters.internal.addGlow(...)`；且 addGlow 参数顺序变化（第 4 位 scale、第 5 位 knockout）。
- **修复**：drop-item.js 改用 `enableFilters().filters.internal.addGlow(rarityColor, 3, 0, 1, true, 10, 3)`（knockout=true 仅轮廓外、distance 3px）。全仓 grep 确认无其他 postFX 残留。SKILL.md 入库 Phaser 4 FX API 陷阱。
- **修改文件**：src/entities/drop-item.js、SKILL.md、CHANGELOG.md。
- **测试结果**：lint ✅；vite build ✅；test-collider ✅。
- **已知问题**：实机待验证——各稀有度掉落物轮廓外光晕实际显示（此次必须眼见为实）。

## 2026-07-20（植物祭品贴图替换 + 仓库扩 5 页 + 植物种子）

### 对话：20 张植物贴图替换 + 仓库加 3 页 + 每样一件
- **贴图替换**：素材库 `道具/祭品/植物类` 20 张 png 复制到 `assets/items/tributes/plants/`；equipment.json 双份 20 个植物条目写入 `iconImage` + `dropImage`（文件名与游戏名全一致，无特例）。
- **仓库扩容**：`pageCount` 2 → 5（容量 40 → 100 格）。
- **种子扩展**：`seedOreTributes` 并入 20 种植物 key（共 41 件，矿石 21 + 植物 20 各一件）。
- **修改文件**：assets/items/tributes/plants/（20 png 新增）、data/equipment.json、public/data/equipment.json、src/ui/warehouse-system.js、CHANGELOG.md。
- **测试结果**：JSON 双份一致 ✅；lint ✅；vite build ✅；test-collider / test-craft-sync ✅。
- **已知问题**：实机待验证——①植物贴图格子/掉落显示；②仓库翻页 1~5 页与 41 件种子分布（植物类从第 3 页起）。

## 2026-07-20（掉落物轮廓光晕调整为轮廓外常驻）

### 对话：图层特效要在贴图轮廓外显示且持续不隐藏
- **调整**：`addGlow` 的 `knockout: false → true`——只渲染贴图轮廓**外**的光晕（挖掉源图像区域，贴图本体不再被发光覆盖）；`outerStrength 2→3`、`quality 0.1→0.25`（3px 轮廓更清晰）。光晕在 sprite 存续期间常驻，无 hover/条件开关。
- **修改文件**：src/entities/drop-item.js、CHANGELOG.md。
- **测试结果**：lint ✅；vite build ✅；test-collider ✅。
- **已知问题**：实机待验证——轮廓外光晕观感与各稀有度区分度。

## 2026-07-20（手脑受击粒子 + 碰撞再下移 30px）

### 对话：手脑受击绿色粒子 + 碰撞体积再下移
- **手脑受击无粒子根因**：`triggerZombieHitParticles` 硬过滤 `family !== '僵尸'`——非僵尸家族（手脑/骑士/狼等）全部跳过。移除 family 过滤，全怪物统一受击粒子（缺省绿色/僵尸同款；`hitParticleColor` 配置可覆盖，集合体落地黄不受影响）。
- **手脑碰撞体积再下移 30px**：`render.colliderOffsetY` 50 → 80（footprint/圆柱/投射物矩形同锚联动）。
- **修改文件**：src/phaser/scenes/GameScene.js、data/enemy-config.json、CHANGELOG.md。
- **测试结果**：lint ✅；vite build ✅；test-collider ✅。
- **已知问题**：实机待验证——①手脑受击绿色粒子位置（贴图中心）；②其他怪（骑士/狼）受击粒子观感是否正常；③下移后判定与贴图对齐。

## 2026-07-20（掉落物稀有度轮廓光晕）

### 对话：所有物品掉落物加 3px 稀有度色轮廓，由深至浅向外渐变
- **实现**：`drop-item.js` sprite 创建时 `postFX.addGlow(rarityColor, outerStrength 2, inner 0, knockout false, quality 0.1, distance 3)`——glow 外发光天然由深至浅向外衰减，距离 3px 即轮廓厚度；颜色按 `itemData.rarity` 取 `RARITY_COLORS`（hex 转 0x），与稀有度词条同色。每个 sprite 只挂一次（`_rarityGlowAdded` 防重）。
- **修改文件**：src/entities/drop-item.js、CHANGELOG.md。
- **测试结果**：lint ✅；vite build ✅；test-collider ✅。
- **已知问题**：实机待验证——①各稀有度掉落物轮廓观感（common 灰白可能偏淡）；②hover 高亮 tint 与 glow 叠加效果；③大量掉落物时的 FX 开销。

## 2026-07-20（骑士/手脑碰撞体积调整）

### 对话：圆柱判定过高 -50% + 手脑三项微调
- **圆柱判定高度（Collider.height）**：此前未配置时缺省取 `render.spriteSize`（骑士 293 / 手脑 220，远高于视觉身体）。enemy-config 顶层显式 `height`：骑士 293→**146**、手脑 220→**110**（各 -50%）。
- **手脑碰撞整体下移 50px**：`render.colliderOffsetY: 50`（footprint 圆心/圆柱/投射物矩形同锚联动下移）。
- **手脑绿色矩形（投射物躯干 projectileHitbox）向上 +50px**：height 110→160（bottom 锚脚不变，向上延伸）。
- **手脑脚下椭圆 +30%**：`collisionRadius` 30→39。
- **修改文件**：data/enemy-config.json、CHANGELOG.md。
- **测试结果**：JSON 校验 ✅；lint ✅；vite build ✅；test-collider ✅。
- **已知问题**：实机待验证——①近战/投射物命中手感（圆柱高度）；②手脑判定中心与贴图对齐；③绿色调试矩形范围。

## 2026-07-20（矿石祭品贴图全套替换 + 仓库种子 + 初始背包清理）

### 对话：21 张矿石贴图按工作流替换 + 仓库每样一件 + 删背包麦穗大理石
- **贴图替换**：素材库 `道具/祭品/矿石类` 21 张 png 复制到 `assets/items/tributes/ores/`（子目录归档）；equipment.json 双份 21 个矿石条目写入 `iconImage` + `dropImage`（格子贴图与地上掉落贴图同步）。特例对名：硫磺.png↔硫磺矿、金刚石_.png↔金刚石；其余按中文名一一对应。
- **仓库种子**：`WarehouseSystem.seedOreTributes()`——21 种矿石祭品从 ItemDatabase 取模板各放一件（stack 1）；game.js init 调用（贴图/效果验收用）。
- **初始背包**：删除麦穗（slot 3）、大理石（slot 4）条目，背包初始只留药水×2 + 金币。
- **修改文件**：assets/items/tributes/ores/（21 png 新增）、data/equipment.json、public/data/equipment.json、src/ui/warehouse-system.js、src/game.js、src/ui/equip-data-manager.js、CHANGELOG.md。
- **测试结果**：JSON 双份一致 ✅；lint ✅（0 error）；vite build ✅；test-collider / test-craft-sync ✅。
- **已知问题**：实机待验证——①格子/掉落贴图显示；②仓库 21 件种子（第 2 页 1 件）；③背包无麦穗大理石。

## 2026-07-20（修复：装备浮窗被仓库面板遮挡）

### 对话：装备栏/背包浮窗层级调到仓库之前
- **根因**：`equipTooltip` 挂在 `#uiLayer`（z-index:10，自成 stacking context）内——tooltip 的 z-index 99999 仅在 uiLayer **内部**生效；仓库面板是 body 直接子元素（z-index 4000），在 body 层级上整个盖过 uiLayer，浮窗被遮挡。
- **修复**：`hud-panels-misc.js` 创建 equipTooltip 时改挂 `document.body`——99999 全局生效，高于一切面板。经验入库：**z-index 只在同一 stacking context 内可比，跨容器比较的是父级层级**。
- **修改文件**：src/ui/panels/hud-panels-misc.js、CHANGELOG.md。
- **测试结果**：lint ✅；vite build ✅；test-collider ✅。
- **已知问题**：实机待验证——仓库/背包同时打开时悬停装备，浮窗完整显示在仓库面板之上。

## 2026-07-20（修复：仓库存入看不到物品——背包渲染器全文档误清仓库格子）

### 对话：右键存入仓库当前页看不到，翻页来回后才显示
- **根因**：`slot-renderer.js updateInventorySlots` 的选择器是**全文档** `queryAllElements('.inv-cell')`——仓库格子（`.warehouse-grid .wh-cell`）共享 `.inv-cell` 类。`_refreshAll` 顺序：先 `_renderGrid`（仓库正确渲染）→ 再 `EquipManager.updateInventorySlots()`——后者把**所有** .inv-cell 清空、改 `dataset.slot` 为背包索引、按背包数据重绘——仓库格子被当场抹掉。翻页走 `_switchPage`（只调 `_renderGrid`，不经过背包渲染），所以翻页后显示正常。这也解释了此前"取出/调整后页面混乱"的全部观感（格子内容被覆盖 + slot 编号污染）。
- **修复**：选择器收窄为 `.inventory-grid .inv-cell`（仅背包容器）；tooltip 的 `queryAllElements('.inv-cell')`（equip-tooltip-manager.js:538）是有意支持 wh-cell 的事件绑定且分支正确，不动。
- **连带收益**：仓库格子 `dataset.slot` 不再被背包索引污染——tooltip 取物（getItemAt）与格子事件的索引恢复正确。
- **修改文件**：src/ui/equip/slot-renderer.js、CHANGELOG.md。
- **测试结果**：lint ✅；vite build ✅；test-collider / test-craft-sync ✅。
- **已知问题**：实机待验证——右键/双击存入立即可见、取出后格子内容正确、tooltip 稀有度显示正常。

## 2026-07-20（手脑特效调整 + 嚎叫判定修正 + 仓库页码系统修复）

### 对话：砸地特效位置/嚎叫范围不符排查/仓库页码混乱
- **嚎叫范围与紫圈不符根因**：判定用圆形（Math.hypot），视觉画 2:1 椭圆——垂直方向判定 600px 但紫圈只画 300px，圈外也挨打。修复：砸地/嚎叫伤害判定统一改 `GroundEllipse`（集合体同款椭圆判定，含目标半径、2:1 透视），视觉=判定。
- **砸地特效调整**：锚点朝向偏移（朝右：右 50px + 下 25px，朝左镜像）；烟尘改绕落点四周 8 团扩散（轻微上浮）；白线长度 ×1.5。
- **仓库页码系统修复**：
  - 打开默认第一页（open() 重置 currentPage，此前残留上次页码）；
  - **存入优先落在当前页空位**（`_findFirstEmptySlot(preferPage)`）——右键/双击放入的物品立即可见，不再"要翻页才找到"；
  - **格子重建保持滚动位置**（`_renderGrid` 保存/恢复 scrollTop）——消除"取出/调整后页面跳走"的观感（innerHTML 重建导致滚动归零是主要元凶）；
  - 排序后明确回第一页展示结果（排序压缩槽位，此前停在原页面对空白/错位的物品）。
- **修改文件**：src/entities/enemy-types/shounao.js、src/ui/warehouse-system.js、CHANGELOG.md。
- **测试结果**：lint ✅（0 error）；vite build ✅；test-collider / test-craft-sync ✅。
- **已知问题**：实机待验证——①嚎叫圈边即判定边；②砸地特效朝左镜像；③存入当前页可见、取出后页面与滚动位置不动、排序回第一页。

## 2026-07-20（出征奖励栏 + 手脑特效强化 + 旧代码清除确认）

### 对话：出征界面奖励情况 + 嚎叫每跳冲击波/砸地烟尘白线 + 旧代码清除确认
- **出征说明栏奖励区块**：`_updateRulePanelRewards(grade)` 在出征条件下方按当前选中地牢实时显示——祭品掉落品质范围（`普通 ~ 该难度 maxRarity`，稀有度词条色）+ 精英/领主/首领必掉与普通怪掉率；精英宝箱武器稀有度（dungeon-config eliteChestReward 数据驱动）；Boss 奖励武器稀有度（BOSS_REWARD_CONFIG bonusCards）；事件构成（通用事件当前奖励档 + 限定事件 ±1 等级跨度）。切换地牢随 `_updateRulePanelCurrent` 同步刷新。
- **手脑特效**：
  - 嚎叫冲击波改为**每跳伤害判定播放一次**（_dealHowlTick 触发，3s/500ms 共 6 次脉冲扩散；移除 _startHowl 的单次调用避免重复）。
  - 砸地命中帧新增落点特效：4 团 DustEffect 烟尘（玩家奔跑同款，粒子自带向上漂浮分量）+ `_fireSlamImpactLines` 8 条白色放射冲击线（2:1 平面透视，280ms 扩散淡出）；`_slamGraphics` 纳入 `_destroyCustomEffects` 统一清理。
- **旧主神空间代码清除确认**：`spawnMainFatZombie` / `spawnMainZombie` / `spawnMainAmalgam` 全仓 grep 已无任何调用点（上一版 _loadMainScene 已切换到统一入口 spawnMainHubTestEntities）；方法本体按惯例保留在 game.js 备用。
- **修改文件**：src/ui/expedition-system.js、game-style.css、src/entities/enemy-types/shounao.js、CHANGELOG.md。
- **测试结果**：lint ✅（0 error）；vite build ✅；test-collider / test-craft-sync ✅。
- **已知问题**：实机待验证——①说明栏奖励区块排版与换地牢刷新；②嚎叫 6 连脉冲视觉密度；③砸地烟尘+白线打击感。

## 2026-07-20（手脑嚎叫冲击波 + 主神空间测试怪统一 + 祭品改名调整）

### 对话：嚎叫圆圈特效 + 复活场景排查 + 祭品六项调整
- **手脑嚎叫冲击波**：`_fireHowlShockwave()` 复刻集合体 `_fireSlamShockwave` 模式——Phaser graphics + tween 600ms 由中心扩散紫色椭圆（0xa060ff 魔法紫，区别集合体物理红）至 howl.range 600px，加粗描边+闪烁+淡出；`_startHowl` 释放一次；`_destroyCustomEffects` 接入 game.js removeEntity 统一清理约定，`_endHowl` 同步清理。
- **复活刷旧怪根因**：`scene-manager.js _loadMainScene` 旧四连调用（clearMainMonstersAndSpawnDog + spawnMainFatZombie/Zombie/Amalgam）——每次切回主场景（含地牢死亡复活）都清场并生成旧测试怪，与 game.js init"只保留骑士+手脑"的规则分叉。统一：`game.js` 新增 `spawnMainHubTestEntities()`（清场→骑士→手脑），init 与 _loadMainScene 共用同一入口；旧 spawn 方法保留备用；clearMainMonstersAndSpawnDog 补注释（命名遗留，仅清场）。
- **祭品调整**（equipment.json 双份 + 初始背包，已验证双份一致）：
  - 大理石：defPercent 25→2、killHpHealPercent 5→1（stats/desc/初始背包 slot 4 同步）
  - 煤矿石→**煤矿**（仅改名）
  - **石头删除**：双份条目（equipment.stone 键）+ 初始背包 slot 5 + 贴图 assets/items/石头.png
  - 磁铁矿→**锂矿石**：effects 改 matkPercent+5 / defPercent-3（弃用原 combatChanceDelta 耦合键），stats/desc 同步
  - 秘银矿→**铂金**、钛矿石→**钛合金**（仅改名，效果不变）
  - tributes-table.md 重新生成（42 件）
- **修改文件**：src/entities/enemy-types/shounao.js、src/game.js、src/world/scene-manager.js、data/equipment.json、public/data/equipment.json、src/ui/equip-data-manager.js、tributes-table.md、CHANGELOG.md；删除 assets/items/石头.png。
- **测试结果**：JSON 双份一致 ✅；lint ✅（0 error）；vite build ✅；test-collider / test-craft-sync ✅。
- **已知问题**：实机待验证——①嚎叫紫色扩散圈视觉效果；②地牢死亡复活后主神空间只刷骑士+手脑；③改名后各界面显示；④大理石新数值回血体感。

## 2026-07-20（修复：打开出征仍自动关背包——300ms 时序炸弹）

### 对话：出征界面打开时背包仍被自动关闭，排查功能冲突
- **完整证据链**：祭坛点"献祭出征"→ `NPCDialogue.openExpedition()` 调 `goodbye()` → goodbye 立即 `SystemUI.close()` + 挂 300ms 延迟 `this.close()`；`ExpeditionSystem.open()` 同步把背包打开（`SystemUI.open('equip')`）；**300ms 后** `NPCDialogue.close()` 里的"强制关闭背包 `SystemUI.close()`"执行——背包二次被关。上一版只恢复了 open 开背包，没挡住延迟关闭。
- **修复**：`openExpedition` 不走 goodbye——手动关互斥子页面（shop/enhance/craft/enchant，与 openFusion 同模式）后调 `this.close(true)`；`NPCDialogue.close` 新增 `keepBackpack` 参数（默认 false 保持"退出对话关背包"旧语义，仅出征路径传 true 跳过）。
- **排查排除项**：UIState 无互斥关闭逻辑；expeditionOverlay 与 panelOverlay 为兄弟节点无冒泡；scene-manager.js:881 出征入口本身先开背包无冲突。
- **修改文件**：src/ui/npc-dialogue.js、CHANGELOG.md。
- **测试结果**：lint ✅；vite build ✅；test-collider ✅。
- **已知问题**：实机待验证——祭坛点"献祭出征"后对话框关闭、背包与出征面板同时保持开启，300ms 后背包不再消失。

## 2026-07-20（四项修复：动作移动锁定/手脑CD与裁剪/仓库格子/出征背包联动）

### 对话：骑士普攻仍移动 + 手脑嚎叫CD与walking + 仓库格子叠压 + 出征背包预期不符
- **骑士"攻击时移动"根因**：`MovementSystem`（外部系统，在实体自身 update 之后运行）不读 `_animState`——combo/charge/block 期间 `_updateXxx` 设的 vx=0 随后被 MovementSystem 重算覆盖。修复：接入通用豁免通道 `_attackAnimTimer`（集合体/突变体-3/僵尸巫师同机制）——三技能 start 时设为动作时长、end 清零、update 递减；**冲锋期间 MovementSystem 双重驱动的隐患一并消除**。手脑 slam/howl 同款锁定同步补上。
- **手脑**：howl 冷却 10s → 30s；walking 切分再修正——PIL alpha 投影实测四张图统一为 **8列×4行（帧 512×512）**，walk 12 帧=8+4 占前两行（此前 8×2 判断错误）；四张图首帧内容 bbox 一致（~320×420），素材比例统一无缩放问题。
- **仓库格子叠压**：根因=基础 `.inv-cell` 带 `aspect-ratio:1`，仓库宽格（177px）被撑成正方形与 56px 行高冲突。按用户要求完全复制背包格子样式（`.gear-inventory-col` 三件套：`aspect-ratio: unset; height: 56px` + img 32px + inv-stack 微调）。
- **出征背包联动（回滚+真修）**：用户预期=打开出征自动**打开**背包（上一版误解为关闭，已回滚恢复 `SystemUI.open('equip')`）。"一进入背包就被关"的真根因：system-ui 遮罩 click 处理器排除列表缺 `expedition`——出征操作点击落在遮罩上触发背包关闭。排除列表补 `expedition`（连同 `fusion` 祭品合成同款场景）。
- **修改文件**：src/entities/enemy-types/armored-knight.js、src/entities/enemy-types/shounao.js、src/phaser/scenes/BootScene.js、src/ui/system-ui.js、src/ui/expedition-system.js、data/enemy-config.json、game-style.css、CHANGELOG.md。
- **测试结果**：JSON 校验 ✅；lint ✅（0 error）；vite build ✅；test-collider / test-craft-sync ✅。
- **已知问题**：实机待验证——①骑士二连击/格挡原地、冲锋不再被外部推走；②手脑走路动画正常、嚎叫 30s CD；③仓库格子不叠压；④出征打开背包保持开启、操作不误关。

## 2026-07-20（四项修复：骑士HUD/仓库整体/出征界面/手脑裁剪）

### 对话：骑士血条下移 + 仓库问题排查 + 出征界面调整 + 手脑 walking 裁剪
- **手脑 walking 裁剪**：目检素材发现真实网格与口述"4×8"不符——idle/slam/howl 为 8列×4行（帧 512×512），walking 为 8列×2行（帧 512×1024）。BootScene 切分全部修正；渲染层 `setDisplaySize` 改等比缩放（spriteSize=最长边，方形帧行为不变），解决非方形帧压扁变形。规则入库：拿到精灵图先目检行列再配切分。
- **骑士名字/血条下移 75px**：enemy-config `render.hudOffsetY: 75` 配置化（不改通用代码）；GameScene `_syncEntityHud` 应用 hudDy 于名字+血条，render 来源修为新怪 `config.render` / 老怪 `_animCfg.render` 双源回退（此前新怪 healthBar 配置全部落空）。工作流入库：名字/血条应在贴图上方 30px 区域，透明上沿用 hudOffsetY 校准。
- **仓库整体修复**：
  - 钱/消耗品存不进+3 件就满仓误报的根因：金币物品无 maxStack 字段（GoldManager 99999 是内部常量）→ 被当不可堆叠 → freeSlots(37) 与 stack(10000+) 比较误判满仓并中断全部存入循环。修复：`_maxStackOf` 回退（gold 99999）+ 不可堆叠物品空间语义修正（整件占 1 格，与 stack 数无关）。
  - 点击外部只关背包：遮罩层 click 只关 SystemUI——仓库在 `_buildPanel` 自挂 overlay 监听一并关闭（避免 system-ui↔warehouse 循环 import）；NPC 走远自动关闭链补 `WarehouseSystem.close()`。
  - 格子规格：一行 2 格、行高 56px、gap 2px，与背包格子（.gear-inventory-col）同规格。
  - 页码：存取链路确认保持 currentPage 不变（代码路径无误），实机复核。
- **出征界面**：open() 由主动打开背包改为自动关闭背包；说明弹窗重定位 left:4px / bottom:2px / 187×945px，拉伸占满左侧空白。
- **修改文件**：src/phaser/scenes/BootScene.js、src/phaser/scenes/GameScene.js、src/ui/warehouse-system.js、src/ui/expedition-system.js、src/game.js、data/enemy-config.json、game-style.css、SKILL.md、CHANGELOG.md。
- **测试结果**：JSON 校验 ✅；lint ✅（0 error）；vite build ✅；test-collider / test-craft-sync ✅。
- **已知问题**：实机待验证——①手脑走路/攻击贴图比例与大小；②骑士名字血条视觉位置；③仓库金币/药水存入与堆叠、翻页保持、遮罩一并关闭；④出征开启时背包自动关闭、说明栏拉伸效果。

## 2026-07-20（骑士冲锋沙尘/二连击去位移 + 新怪物「手脑」（首个领主怪））

### 对话：骑士两项调整 + 按工作流新增手脑
- **骑士冲锋沙尘**：`_updateCharge` 每 70ms（对齐玩家冲刺档）调 `EffectFactory.createDustEffect`（玩家同款入口，对象池复用），在移动反方向脚下生成，intensity 1.2。
- **骑士二连击去位移**：删除 `_comboLungeDx/Dy/Remaining` 全部突进插值代码（constructor/_startCombo/_updateCombo/_endCombo 四处）+ 配置死字段 `combo.lungeDistance/lungeSpeed`；二连击现在全程不可移动（原就有 vx=vy=0，突进是唯一的位移源）。
- **新怪物「手脑」（rank: lord，首个领主怪）**：
  - 素材：`素材库/怪物/手脑/` 4 张 png（4096×2048，4列×8行 → 帧 1024×256）复制至 `assets/enemies/shounao/`；BootScene 4 spritesheet + 4 动画（idle 1帧循环 / walk 12帧循环 / slam 26帧 2s / howl 28帧 3s，攻击动画时长=技能时长）。
  - 配置（enemy-config.json shounao）：HP 1500、speed 160、level 12、family 手脑（不进僵尸池）；显式面板覆盖 atk 50 / def 66 / matk 55 / mdef 65 / crit 30；`attackSkills`——slam（CD 6s、2s、14帧判定、300px、物理×2、triggerRange 300）、howl（CD 10s 暂定、3s、每 500ms 一跳、600px、魔法×0.5、triggerRange 600）。
  - 逻辑 `src/entities/enemy-types/shounao.js`：状态机 idle/walk/slam/howl；技能决策 slam（近）> howl（远）；范围伤害走 `_hostiles(entities)` 全体敌对判定（与集合体同语义）；眩晕中断全部动作；lord 联动自动生效（经验×4/金币×3/lord 祭品表）。
  - 注册：enemy-types.js import/export；game.js `spawnMainShounao()` 主神空间生成（骑士对面站位，永久警戒测试用）。
- **修改文件**：src/entities/enemy-types/armored-knight.js、src/entities/enemy-types/shounao.js（新）、src/entities/enemy-types.js、src/game.js、src/phaser/scenes/BootScene.js、data/enemy-config.json、assets/enemies/shounao/（4 png）、CHANGELOG.md。
- **测试结果**：JSON 校验 ✅；lint ✅（0 error）；vite build ✅；test-collider / test-craft-sync ✅。
- **已知问题**：实机待验证——①冲锋沙尘密度/位置；②二连击原地挥砍；③手脑贴图尺寸（spriteSize 220 初值，帧 1024×256 横长条，可能需调）；④slam 14 帧判定点与动画同步；⑤howl 每跳伤害与范围感；⑥lord 掉落/经验/金币实机首验。

## 2026-07-19（修复：冲锋命中瞬间贴图闪跳）

### 对话：实机反馈"即将撞到目标时贴图一瞬间消失/错误"
- **根因**：冲锋追踪步长 `min(speed*dt, d)` 允许骑士与目标圆心重合（d→0）；命中后 `_endCharge` 恢复实体碰撞（eee49ec 穿人设计），分离系统当帧把骑士从目标体内挤出数十 px——位置瞬移在 700px/s 冲锋末端看起来像贴图闪没/跳走。
- **修复**：`_updateCharge` 步长限制在接触面之前（`d - (selfR + targetR)`，不重合即不挤出）。数值核验安全：骑士 radius 29 + 玩家 ≈ 43 < 命中圈 60+targetR ≈ 74，接触面已进入命中判定，不会造成"够不着"死锁。
- **排查排除项**：sprite-offsets.json 无 knight 配置（偏移系统不干扰）；五段动画 key 均已正确定义；命中音效/特效链无渲染阻塞。
- **修改文件**：src/entities/enemy-types/armored-knight.js、CHANGELOG.md。
- **测试结果**：lint ✅；vite build ✅；test-collider ✅。
- **已知问题**：实机待验证——命中瞬间不再瞬移闪跳；若仍有视觉跳变，次嫌疑为 intro→loop 切换帧姿势差（待实机反馈再调）。

## 2026-07-19（骑士冲锋两段式动画 + 极速 700）

### 对话：冲锋动画 2s 一轮后循环 9~19 帧；最大速度 700
- **两段式冲锋动画**：BootScene 新增 `enemy_armored_knight_charge_loop`（帧 8~18/11 帧/repeat -1，时长 1158ms 与首段同帧率）；首段 `enemy_armored_knight_charge` 保持 19 帧单次（时长对齐 2s）。`_getTextureKey()` 按 `_chargeElapsed >= animIntroMs` 切换 loop key，渲染层 animKey 变化自动接续播放；退出冲锋即回 idle/walk 动画。
- **配置**：`charge.animIntroMs: 2000`（首段时长，可配）；`charge.maxSpeed` 400 → 700；技能描述同步。
- **修改文件**：src/phaser/scenes/BootScene.js、src/entities/enemy-types/armored-knight.js、data/enemy-config.json、CHANGELOG.md。
- **测试结果**：JSON 校验 ✅；lint ✅；vite build ✅；test-collider ✅。
- **已知问题**：实机待验证——首段 2s 后循环段衔接是否顺滑；700px/s 下命中判定（hitRange 60）是否因单帧步长过大漏判（700/60fps≈11.7px/帧，远小于 60，理论安全）。

## 2026-07-19（骑士冲锋观感修复 + 冲锋 4.5s + 格挡 0.5s 前摇）

### 对话：冲锋"到 400px 突然停止又重播"排查 + 两项调整
- **"停止又重播"根因**：非行为 bug。冲锋动画（19 帧/1.5s）配置 `repeat: -1` 无限循环，而线性加速恰好也在 1.5s 达到 maxSpeed 400px——动画在加速完成点从头重播，视觉上像"停顿后重新冲锋"。移动行为实际未中断。
- **修复**：BootScene 冲锋动画 `repeat: -1 → 0`（单次播放定格尾帧）；GameScene 渲染层 `isLoopAnim` 排除 `charge`（与 attack/death 同为一次性动作，防止播完被自动重启）。
- **冲锋超时**：`charge.maxDuration` 3500 → 4500（enemy-config.json）。
- **格挡前摇**：block 新增 `windup: 500`——`_startBlock` 先播 defending 动画，前摇 0.5s 内格挡判定**不生效**（takeDamage 弹反判定加 `_blockWindup <= 0` 条件），前摇结束后进入 1.5s 格挡（总时长 2s）。防御状态本就无法攻击/移动、不会被攻击动作打断（_decideSkills 仅在无动作时调用），语义确认保持。
- **描述同步**：冲锋技能描述修正过时"900px/s"为线性加速实际参数；格挡描述更新前摇语义。
- **修改文件**：src/phaser/scenes/BootScene.js、src/phaser/scenes/GameScene.js、src/entities/enemy-types/armored-knight.js、data/enemy-config.json、CHANGELOG.md。
- **测试结果**：JSON 校验 ✅；lint ✅；vite build ✅；test-collider / test-craft-sync ✅。
- **已知问题**：实机待验证——①冲锋全程动画只播一轮不再"重播"；②冲锋 4.5s 超时；③格挡前 0.5s 被打正常掉血，之后弹反生效。

## 2026-07-19（修复：铠甲骑士永不冲锋）

### 对话：实机反馈骑士不会冲锋攻击
- **根因**：b31b5f8 冲锋改线性加速时配置字段 `speed` 更名为 `maxSpeed`（+`accelDuration`），但 `_decideSkills()` 的发动条件仍检查 `cfg.charge.speed`——恒为 undefined，冲锋永远进不了。残留的旧字段引用，全仓 grep 确认仅此一处。
- **修复**：armored-knight.js:144 发动条件改查 `cfg.charge.maxSpeed`。
- **测试结果**：lint ✅；vite build ✅；test-collider ✅。
- **已知问题**：实机待验证——骑士进入 550px 触发范围后应瞬间举盾冲锋（0→400px 线性加速）。

## 2026-07-19（修复：地牢事件系统 TDZ 循环依赖）

### 对话：实机报错 `Cannot access 'NEW_EVENT_CONFIGS' before initialization`（dungeon-event-system.js:160）
- **根因**：`dungeon-event-system.js` import definitions（NEW_EVENT_CONFIGS 等），`dungeon-event-definitions.js:12` 又反向 import system 的 `AttributeCheckSystem`——system → definitions → system 循环。一旦模块图让 definitions 先求值（如 expedition-system.js 经 GRADE_ORDER 拉起 definitions），system 顶层 `createEventConfig()` 访问 `NEW_EVENT_CONFIGS` 时 definitions 还卡在自己的 import 行，TDZ 报错。该循环自 2fe371a 潜伏，此前靠加载顺序侥幸未触发。
- **修复**：`AttributeCheckSystem` 抽到独立文件 `src/world/attribute-check-system.js`（配置直读 `DungeonConfig.raw.events.attributeCheck` + 原 defaults 兜底，与 createEventConfig 同一数据链路）；definitions 改从独立文件 import；system 删除原定义改为 re-export（内部及外部既有 import 路径不变）。循环断开，不再依赖加载顺序。
- **修改文件**：src/world/attribute-check-system.js（新增）、src/world/dungeon-event-system.js、src/world/dungeon-event-definitions.js、CHANGELOG.md。
- **测试结果**：lint ✅（0 error）；vite build ✅；test-collider / test-craft-sync ✅；裸 node 冒烟验证 defs-first 加载顺序不再触发 TDZ（后续 JSON import attribute 报错为裸 node 环境限制，与本次修复无关）。
- **已知问题**：无。

## 2026-07-19（怪物新等级：lord 领主——精英与首领之间）

### 对话：新增 rank `lord`（领主），配齐全套联动，不添加任何怪物
- **经验**：combat-formulas.json `enemy.expValue.lordMultiplier = 4`（elite ×2 与 boss ×10 之间）；`enemy.js getExpValue()` 加 lord 分支。
- **金币**：原 elite ×2 硬编码收编为配置 `enemy.goldDrop.rankMultipliers`（elite:2、lord:3）；`damageable-entity.js` 击杀掉落改为查表驱动。
- **祭品掉落**：`tributes.dropTables` 六级（F~A）各新增 `lord` 子表（必掉，权重介于 elite 与 boss 之间，如 D 级 32/30/22/11/4/1）；`rollTributeDrop` 按 boss→lord→elite→normal 分派，lord 表缺失时回退 elite 表；isElite 判定含 lord（事件保底等沿用语义不变）。
- **Boss 血条**：仅 `rank === 'boss'` 触发（damageable-entity.js:176 + GameScene showBossHpBar），lord 不显示——按需求保持。
- **防呆**：zombie-dungeon.js normal 池过滤补 `rank !== 'lord'`，避免未来 lord 怪混入普通池。
- **未动**：地牢节点类型（combat/elite/boss 不变，无 lord 节点）；dungeon-event-system 事件奖励的 rollTributeDrop('elite') 调用保持不变。
- **修改文件**：data/combat-formulas.json（本文件仅 data/ 一份，经 import 打包，无双份同步问题）、src/entities/enemy.js、src/entities/damageable-entity.js、src/config/tribute-effects.js、src/world/zombie-dungeon.js、CHANGELOG.md。
- **测试结果**：JSON 校验 ✅；lint ✅（0 error）；vite build ✅；test-collider / test-craft-sync ✅。
- **已知问题**：尚无 rank=lord 的怪物，链路待首个领主怪实装后实机验证（经验 ×4 / 金币 ×3 / lord 掉落表）。

## 2026-07-18（SKILL.md 补记：v3.6~v4.0 九个提交的体系归档）

### 对话：今日计划收尾——SKILL.md 同步
- **背景**：SKILL.md 自 dfb397f（20矿石祭品）后落下 9 个提交未记录，补记 v3.6~v4.0：祭坛/合成/旧祭品迁移/定价、附魔稀有度化、地牢难度 FEDCBA 分级掉落、骑士冲锋穿人、随机事件分级（通用30%/限定70%+±1+奖励分级）、出征等级门槛+说明弹窗。
- **经验入库**：①根 `game-style.css` 才是全局样式表，`src/ui/` 新建 css 会成为无引用孤儿文件；②引用配置模块函数前确认导出存在（getTributeHpRegenFlat 断链教训）。
- **测试结果**：lint ✅ / build ✅（本次仅文档变更）。
- **已知问题**：无新增。

## 2026-07-18（出征等级条件：对应稀有度祭品门槛 + 说明弹窗）

### 对话：进入对应等级地牢至少放入一件对应稀有度祭品
- **门槛判定**：`expedition-system.js depart()` 新增 `_getRequiredRarity()`——按当前选中地牢的 `grade`（dungeonList，缺省 F）映射 RARITY_ORDER（F↔普通 … A↔传说），carried 中无该稀有度祭品则 `_showMessage('请根据提示放入对应等级祭品','error')` 拦截出征。
- **说明弹窗**：出征界面左侧固定面板（`.expedition-rule-panel`，position:fixed left:8px top:20vh，pointer-events:none 不挡操作）——列出 F~A 六级与所需祭品一一对应（文字色取 RARITY_COLORS 稀有度词条色），底部实时显示当前选中地牢的等级与所需祭品；随面板 open/close/切换地牢自动刷新，出征成功同样隐藏。
- **顺带修复**：`tribute-effects.js` 补导出缺失的 `getTributeHpRegenFlat()`（update.js / game-ui-manager.js 早已引用，此前 vite build 会报 Missing export；Flat 键加和、缺省 0，与模块既有 getter 同模式）。
- **修改文件**：src/ui/expedition-system.js、src/ui/game-style.css、src/config/tribute-effects.js、CHANGELOG.md。
- **测试结果**：`npm run lint` ✅（0 error）；`npx vite build` ✅；`test-collider` / `test-craft-sync` ✅。
- **已知问题**：实机待验证——①弹窗位置/遮挡；②选 D 级地牢只放普通祭品应被拦截；③切换地牢时底部当前要求刷新。

## 2026-07-18（事件分级体系：通用/限定/奖励分级/改名高级）

### 对话：随机事件 FEDCBA 分级 + 通用 30%/限定 70% + 奖励公式
- **事件两段判定**：rollEventType 改两段——先按 30%/70% 判定通用 vs 限定，再组内按权重抽取；限定池 = 同一大类 + 事件等级在「地牢等级 ±1」内（F 级 4 个、D 级 7 个、A 级 1 个幻影镜面，逻辑已验证）。
- **限定事件元数据**：`RESTRICTED_EVENT_META`（dungeon-event-definitions.js）——10 个新事件全部归入僵尸地牢大类并赋级（坍塌拱门/毒菇环 F，笔记/十字路口 E，血祭坛/诅咒铠甲/祝福喷泉 D，赌徒/军械库 C，幻影镜面 B）。
- **通用事件奖励分级**（combat-formulas.json `universalEventRewards`）：`getUniversalEventConfig` 按 dungeonList.grade 覆盖配置——女神祝福场次 2/2/3/3/4/5、馈赠粉尘 100~500；恶魔祈求 强化石/改造券/粉尘 1/1/200 ~ 4/4/1000；宝箱金币 300~1200、材料粉尘 100~500、D 级起 10% 祭品彩蛋（rollTributeDrop 按难度封顶，走 _applyRewards 发放）；补给堆恢复 20~60HP/15~50MP、药水 1~3 瓶；**检定成功率随难度每级 -2pp 下调**（trap/supplyPile 属性检定统一生效，下限沿用 minSuccessRate）。
- **改名**：僵尸地牢 → 僵尸地牢高级（dungeonList + 出征面板默认值 + scene-manager + dungeon-map-generator + ZOMBIE_DUNGEON_CONFIG 全部同步；内部键 zombie 不动）。
- **测试结果**：JSON 校验 ✅；`npm run lint` ✅；`npx vite build` ✅；`test-collider` / `test-craft-sync` ✅。
- **已知问题**：实机待验证——①30/70 两段判定分布；②±1 限定池（F 级不见 C+ 事件）；③通用奖励按难度变化；④陷阱/补给检定下调；⑤宝箱祭品彩蛋入包；⑥改名后各界面字样。

## 2026-07-18（地牢难度分级掉落体系）

### 对话：难度 FEDCBA × 祭品稀有度概率公式
- **难度字段**：`dungeon-config.json` dungeonList 增加 `grade`——僵尸地牢 D 级、僵尸地牢-初级 F 级。
- **分级掉落表**（combat-formulas.json `tributes.dropTables` 按 F/E/D/C/B/A 六档，精英/首领分表）：
  - 封顶规则：F=稀有封顶、E=史诗封顶、D+=传说全开（超限权重过滤后归一化抽取）；
  - 精英必掉权重随难度上移（F 55/30/15 → D 35/30/20/10/4/1 → A 12/20/26/24/13/5）；首领表整体比精英高一档（史诗+约 1.2~1.5 倍）；
  - 普通怪掉率按用户拍板：F 2%，逐级 +0.5%（E 2.5 / D 3 / C 3.5 / B 4 / A 4.5%），品质封顶稀有（A 开放史诗 3%）。
- **rollTributeDrop 改造**：按 `dungeonList.grade` 取分表 + `maxRarity` 封顶过滤归一化 + 掉率乘算（星光蓝宝 dropChancePercent 联动）；damageable-entity 传入当前 dungeonType（主神空间默认 D 级）。
- **测试结果**：JSON 校验 ✅；`npm run lint` ✅；`npx vite build` ✅；`test-collider` / `test-craft-sync` ✅；封顶归一化逻辑验证 ✅。
- **已知问题**：实机待验证——F 级地牢不掉史诗+、普通怪 2% 起步掉率、首领表优于精英表。

## 2026-07-18（骑士冲锋无视实体碰撞）

### 对话：冲锋穿人机制
- **冲锋期间无视实体碰撞**：`_startCharge` 置 `noCollision = true`——resolveCollisions 分离系统直接过滤，骑士可从玩家/怪物身上穿过；墙壁仍由冲锋自身的 WallSystem.resolve 逐帧解析（不可穿墙不变）。
- **结束恢复防卡死**：`_endCharge` 恢复 `noCollision`（存 `_prevNoCollision`）——与实体重叠时由分离系统逐帧挤出，且分离位移本就带 WallSystem 墙壁解析（game.js:1199），不会瞬移、不会挤进墙、不会卡死；眩晕中断同样经 _endCharge 恢复。
- **测试结果**：`npm run lint` ✅；`npx vite build` ✅；`test-collider` ✅。
- **已知问题**：实机待验证——冲锋穿人顺畅、撞墙照停、结束时贴人被自然挤出。

## 2026-07-18（附魔等级体系替换稀有度体系）

### 对话：附魔 F~S 等级 → 稀有度（普通~传说）
- **卷轴等级替换**（enchant-config.js，共 8 处）：沉重/锋利的 F→普通、狼蛛 E→优质、骷髅射手 D→稀有；后续新卷轴按 史诗/神话/传说 直接扩展。
- **消耗与分解**：粉尘消耗本就与新稀有度定价对齐（普通 100 / 优质 200 / 稀有 400），无需改动；分解返还维持 1/2（50/100/200），与消耗同档联动。
- **显示端**：enchant-system 卷轴槽与可用卷轴列表的等级标签改用 `RARITY_LABELS`（rarity.js 单一来源）；Boss 卡奖励 `grade: 'D'`→`'rare'`，文案同步「稀有附魔卷轴」。
- **测试结果**：`npm run lint` ✅；`npx vite build` ✅；`test-collider` / `test-craft-sync` ✅。
- **已知问题**：实机待验证——卷轴列表/槽位稀有度标签显示、Boss 卡稀有卷轴产出。

## 2026-07-18（合成槽堆叠整组放入 + 容量扩 20 + 祭品统一定价 + 附魔汇报）

### 对话：合成与定价调整 + 附魔卷轴汇报
- **堆叠整组放入**：`placeFromBackpack` 改为整组堆叠放入（直到堆空或合成栏满），修复拆空后可能复制品的循环终止问题；`CAPACITY` 10→20（支持 16/17 个批量合成）。
- **合成逻辑验证**：16 普通→8 优质、17 普通→8 优质+剩 1 普通（配对与留存语义正确）。
- **祭品统一定价**：43 个祭品全部按稀有度重设——普通 100 / 优质 200 / 稀有 400 / 史诗 800 / 神话 1600 / 传说 3200（双份 JSON 同步）。
- **附魔卷轴汇报**（enchant-config.js）：现有 4 种卷轴——沉重（F 前缀，剑类，攻击+60%/攻速降约26%）、锋利的（F 前缀，剑类，暴击率+50%）、狼蛛（E 后缀，全武器，攻击叠毒1层）、骷髅射手（D 后缀，枪械，穿透+2）；等级体系当前只用到 F/E/D 三级（原 F~S 七级映射 getGradeCost 已在死代码清理中移除）。
- **测试结果**：JSON 校验 ✅；`npm run lint` ✅；`npx vite build` ✅；`test-collider` / `test-craft-sync` ✅。

## 2026-07-18（三旧祭品迁移数据驱动）

### 对话：麦穗/石头/大理石同步迁移
- **迁移**：三旧祭品写入 equipment.json（数据驱动 effects + maxStack 999 + 原贴图路径）——麦穗 `goldPercent 25 + hpRegenFlat 1`、石头 `defPercent 5 + moveSpeedPercent -10`、大理石 `defPercent 25 + killHpHealPercent 5`；效果与旧硬编码完全等价（金币×1.25、恢复+1/s、防御×1.25/×1.05、移速×0.9、击杀回血5%）。
- **引擎扩展**：`hpRegenFlat` 固定值键（Flat 后缀按加和聚合，区别于百分比乘算）；`getTributeKillHpHealRatio()`（大理石击杀回血数据驱动）。
- **删除旧硬编码**：combat-formulas.json 的 marble/stone 配置与 goldDrop 的麦穗字段、base.js 大理石/石头乘算块、update.js 麦穗+1 特判、damageable-entity 金币麦穗块与大理石按名检查、status-tooltip-helper 的 hasWheatTribute。
- **初始背包兼容**：equip-manager init 将 TEST_BACKPACK_ITEMS 中的旧祭品按名映射到 ItemDatabase 数据驱动版本。
- **测试结果**：JSON 校验 ✅；`npm run lint` ✅；`npx vite build` ✅；`test-collider` / `test-craft-sync` ✅。
- **已知问题**：实机待验证——①三旧祭品效果与迁移前一致（金币/恢复/防御/移速/击杀回血）；②可堆叠 999；③进入掉落与合成池。

## 2026-07-18（植物祭品平衡 + 出征栏同名限制 + 祭坛/祭品合成）

### 对话：植物祭品工作流化 + 祭坛与合成系统
- **植物祭品数值平衡**：20 个农产品祭品按三档数值带调整（珍贵带 1/2/3/4/5/7——苹果移速 3→2、火龙果暴击 7→4、黑曜石式微调；廉价带 4/8/12/18/22/30——恢复类全面上调；标准带原区间），双份 JSON 同步；**全部 40 祭品 maxStack 设为 999**。
- **出征栏同名限制**：`_hasDuplicateTribute` 检查，放入同名祭品拒绝并提示「不可放入相同祭品！」（拖放与点击两路径均拦截）。
- **祭坛 NPC**：小鼠大王下方（npcs.altar 配置偏移），实心圆占位；点击走 NPC 对话（npcType 'altar' 分支），三选项按钮：献祭出征（ExpeditionSystem.open）、祭品合成（FusionSystem.open）、退出。
- **祭品合成栏**（`src/ui/fusion-system.js`）：面板尺寸/动画与其他栏位一致，格子与出征栏一致；4 按钮：合成/重置/一键放入/退出；放入取出双击/右键与拖放（含堆叠祭品每次取 1 个）；合成规则——同稀有度成对熔铸为高一级（传说对销毁生成随机新传说），混入不同稀有度提示「请放入相同稀有度的祭品」；奇数时按添加顺序留最后一个（一键放入按名称字母序编入 seq，自然剩下字母序最后者）；一键放入按稀有度子菜单批量放入（仅背包，不全局调用仓库）；重置/退出全部退回背包（背包满走场景式提示）；tooltip 对 fs-cell 感知；ESC 可关。
- **测试结果**：`npm run lint` ✅；`npx vite build` ✅。
- **已知问题**：实机待验证——①同名放入拦截提示；②两普通合成优质、传说对生成新传说；③奇数留存顺序；④一键放入各稀有度；⑤祭坛对话三选项。

## 2026-07-18（20 矿石祭品 + 怪物向效果 + 比例耦合 + 三新特效）

### 对话：矿石祭品体系（参考大理石，方案经两轮数值调整）
- **引擎扩展**（tribute-effects.js）：新增怪物向三键——`monsterDamageTakenPercent`（敌方承伤，damageable-entity 接入）、`monsterAtkDownPercent`（敌方攻击削减，玩家 takeDamage 接入）、`monsterMoveSlowPercent`（敌移速削减，enemy._updateMovement 接入）；比例键 `combatChanceDelta`/`eliteChanceDelta`（dungeon-config 生成时应用）；`dropChancePercent`（rollTributeDrop 乘算）、`staminaRegenPercent`（体力恢复乘算）。
- **比例耦合规则**：战斗+随机事件概率恒=100%，`combatChanceDelta` 一处调整两处联动（getZombieDungeonConfig 内 combat+delta/event=1−combat）；工作流已归档该规则。
- **20 矿石祭品**（双份 JSON，共 40 祭品）：普通 5/优质 5/稀有 4（1 增益+1 减益）、史诗 3/神话 2/传说 1（纯增益）；数值带按稀缺度三档——珍贵带（移速/暴击/怪物减速 1/2/3/4/5/7）、标准带（1~15 原带）、廉价带（恢复 4/8/12/18/22/30）。磁铁矿战斗+6pp（事件同步-6）、星光蓝宝事件+8pp（战斗同步-8）。
- **三新特效**（item.special + buff 栏）：
  - 金刚石「金刚不坏」：单次受到的伤害不超过最大生命值 15%（玩家 takeDamage 拦截，常驻）。
  - 月光石「月影」：进入战斗/精英/Boss 房间无敌 15s（战斗入口 _triggerMoonshadow + update 计时 + takeDamage 无敌闸）；精英/Boss 战中物理魔法伤害 +5%（_moonshadowBoostActive，离开战斗清除）。
  - 贤者之石「点石成金」：拾取祭品品质提升一级（tryPickupItem 入包前转换）；若为传说祭品则额外再获一件随机传说祭品。
- **工作流归档**：SKILL.md 新增「祭品添加标准工作流」（数据结构/效果键/数值带/特效模式/掉率表/验证），后续新增祭品按此开展。
- **测试结果**：JSON 校验 ✅（40 祭品、双份一致、特效参数正确）；`npm run lint` ✅；`npx vite build` ✅；`test-collider` / `test-craft-sync` ✅。
- **已知问题**：实机待验证——①怪物向三效果生效（承伤/减攻/减速）；②磁铁矿/星光蓝宝的比例耦合；③金刚不坏 15% 上限；④月影无敌 15s 与精英/Boss 增伤；⑤点石成金升级与传说额外掉落。

## 2026-07-18（日复盘：4 处隐患修复）

### 对话：回顾当日工作并排查 bug/隐患
- **仓库克隆丢 weaponAsset**：`_applyIntoWarehouse/_applyIntoBackpack` 的 JSON 克隆对拆分/移格的物品可能丢失 weaponAsset（含 framePrefix/muzzleImage 等渲染关键字段）——按附魔同口径防御性保留。
- **蟠桃复活比例硬编码**：`_reviveInPlace` 写死 0.3，改读 `getTributeReviveRatio()`（配置驱动）。
- **ESC 不关仓库面板**：input.js 的 Esc 子页面处理新增 warehouse 分支（与 shop/enhance/craft/enchant 同口径）。
- **卷轴从仓库取出后仓库面板不刷新**：`_equipScrollFromSource` 仓库来源移除后补 `WarehouseSystem._refreshAll()`。
- **当日主线回顾**：稀有度+神话/传说（rarity.js 收编）、物品栏优化 D2-D5（消耗品数据驱动/快捷栏 instanceId/equip-manager 拆分 1604→686/点击规则统一）、20 个农产品祭品（乘算引擎+精英必掉+三特效）、仓库全套（NPC/面板/材料全局调用/附魔卷轴列表/堆叠/一键存取/满仓提示/整理排序）。
- **测试结果**：`npm run lint` ✅；`npx vite build` ✅；`test-collider` / `test-craft-sync` ✅。

## 2026-07-18（仓库增强：堆叠/一键存取/满仓提示/整理排序）

### 对话：仓库五项增强
- **同品堆叠存取**：存入/取出时先填同名堆叠（maxStack 上限），超出另占新格；`_stackSpaceIn` 预判容量，整件放不下则不动并提示。
- **一键全部存入**：背包物品逐个堆叠入仓，遇仓库满即停；`⬇ 全部存入` 按钮。
- **一键取出同类**：仓库中与背包同名的物品取回背包堆叠（含溢出占新格），遇背包满即停；`⬆ 取出同类` 按钮。
- **满仓提示**：背包满/仓库满时调 `SceneManager.showTopNotification`（与进入场景提示语同格式/样式/颜色）+ 面板提示栏同步。
- **整理仓库**：`📦 整理仓库` 按钮弹子菜单——①按稀有度排列（传说→普通，再按种类、名称）；②按物品价值排列（price 降序）；③按物品种类排列（二级菜单选类别：选中类别置前+稀有度降序，其余按默认种类序）；类别顺序设计：近战>远程>盾>防具饰品>消耗品>强化材料>材料>祭品>货币>其他；排序后槽位压缩重编号。
- **测试结果**：`npm run lint` ✅；`npx vite build` ✅。
- **已知问题**：实机待验证——①堆叠入库（满堆+溢出占格）；②一键存入/取出同类的满仓中断与提示；③三种排序的呈现。

## 2026-07-18（仓库系统 + 材料全局调用 + 附魔卷轴列表）

### 对话：仓库全套功能
- **仓库 NPC**：主神空间小鼠大王旁新增 `npc_warehouse`（npcType 'warehouse'，实心圆替代贴图，game-config npcs.warehouse 可配偏移）；点击直接打开仓库面板（绕过 NPC 对话）。
- **仓库面板**（`src/ui/warehouse-system.js`）：右侧面板 + 与改造/附魔栏同款滑入滑出动画；每页 20 格 × 初始 2 页（页码按钮切换）；格子复用 `.inv-cell` 样式与稀有度/贴图/名称/堆叠显示；打开时联动打开装备背包便于双向搬运。
- **鼠标规则一致**：仓库格双击/右键取出→背包；背包格双击/右键（仓库打开时）存入→仓库（equip-manager 委托加 warehouse 分支，顺带补齐 dblclick 缺失的 craft 分支）；tooltip 浮窗规则一致（bindInventoryTooltip 对 `.wh-cell` 走 `WarehouseSystem.getItemAt` 感知解析）。
- **材料全局调用**：强化石（enhance-system）、改造券（craft-system）、魔法粉尘（enchant-system `_getDustCount/_consumeDust`）全部改为背包优先、仓库兜底——计数=背包+仓库合计，扣减先背包后仓库（`WarehouseSystem.countMaterial/consumeMaterial`）。
- **附魔栏卷轴列表**：附魔面板下方新增可用卷轴列示（背包+仓库，标注来源/等级/粉尘消耗）；双击/右键 `_equipScrollFromSource(type, slot)` 通用放入（原 _equipScrollFromBackpack 改为委托）；仓库来源卷轴退回时回仓库（满则走背包路径）。
- **测试结果**：`npm run lint` ✅；`npx vite build` ✅；`test-collider` / `test-craft-sync` ✅。
- **已知问题**：实机待验证——①仓库面板弹出收回动画；②双击/右键双向存取与页码切换；③tooltip 浮窗在仓库格上的显示；④强化/改造/附魔在背包空材料时从仓库扣料；⑤卷轴列表双击放入与退回路径。

## 2026-07-18（20 个农产品祭品 + 掉落 + 特效）

### 对话：祭品体系扩展（引擎乘算 + 20 物品 + 掉落 + 三特效）
- **引擎最终乘算**：`tribute-effects.js` 聚合改为每键 `Π(1+p/100)` 乘算倍率——面板/金币/生命恢复/魔法恢复全部按最终乘算应用（多祭品叠乘而非加和）。
- **20 个农产品/植物祭品**（equipment.json 双份同步，category 'tribute'，effects+stats+desc，无贴图先 emoji）：普通×5（1~2%）、优质×5（3~4%）、稀有×4（5~6%）均为 1 增益+1 减益；史诗×3（7~8%）、神话×2（9~10%）、传说×1（11~15%）纯增益。用户验收表通过后写入。
- **掉落**：`rollTributeDrop(rank)`（combat-formulas.json `tributes.dropTables` 配置驱动）——精英/首领必掉（普通35/优质30/稀有20/史诗10/神话4/传说1），普通怪 5% 掉且只出稀有及以下（80/15/5）；召唤物不掉（既有 `_summoned` 闸门）。
- **三特效**：
  - 蟠桃（revivePercent 30）：本次地牢死亡 3s 后以 30% 最大生命原地复活一次——`onDeath` 标记 `_peachRevivePending/Used`，update 死亡分支改走 `_reviveInPlace()`（保留地牢进程、不传送、清关键临时状态），生效后效果消失（buff 图标同步移除）。
  - 天山雪莲（expPercent 25）：`gainExp` 乘 `getTributeExpMultiplier()`，本次地牢经验 +25%。
  - 千年人参（killMpHealPercent 5）：击杀后 1s 内回复 5% 最大魔法——仿大理石守护实现（`_ginsengHealTimer/Total/PerTick` + update tick + 1s 临时 buff），数据驱动读取。
  - 三特效均在 buff 栏显示常驻图标（`syncTributeBuffs`，出征确认时挂载；地牢 shutdown `clearTributeBuffs` 清除并重置蟠桃标记）。
- **测试结果**：JSON 校验 ✅（20 祭品分布 5/5/4/3/2/1、双份一致、掉率表正确）；`npm run lint` ✅；`npx vite build` ✅；`test-collider` / `test-craft-sync` ✅。
- **已知问题**：实机待验证——①精英必掉祭品与品质分布；②普通怪 5% 掉率；③三特效全流程（复活计时与原地起身、经验加成数值、回蓝 tick）；④祭品面板合并显示；⑤贴图后续补。

## 2026-07-18（物品栏优化 D2-D5：数据驱动/绑定/拆分/一致性）

### 对话：背包栏系列优化（分阶段提交）
- **D2 消耗品数据驱动**：equipment.json 药水定义加 `useEffect: {hp:30}/{mp:25}`（双份同步）；新建 `config/consumable.js`（getConsumableEffect/applyConsumableEffect 统一结算，旧名回退兼容）；quick-bar 与 equip-manager 两处按名硬编码分支删除。
- **D4 快捷栏绑定 instanceId**：`itemAssignments` 增存 `instanceId`，查找 `_findAssignedItem`（instanceId 优先、同名消耗品回退）——背包槽位变动/物品删除后新物顶替不再错绑；消耗按实例引用移除。
- **点击规则一致性审查 + 修复**：
  - 强化栏 slot **单击即取回**与其他栏位（双击/右键取回）不一致且易误点——删除 onclick 取回，保留双击/右键。
  - **格子级消耗品三套公式 bug**：updateInventorySlots 渲染时给消耗品格子绑定的右键处理用 `maxHp×20%+con×2` 公式，与 quick-bar/equipFromBackpack 的 30/25 完全不同——拆分渲染时删除该格子级行为，统一由 document 委托 + useEffect 结算。
  - 审查确认其余一致：装备槽双击/右键卸下、背包双击/右键装备使用、改造/附魔右键取回、商店双击/右键买卖、祭品栏双击/右键装入取出（祭品格 stopPropagation 与 document 委托无重复触发）。
- **D3 equip-manager.js 拆分**：1604 → 686 行。新增 `ui/equip/drag-drop-manager.js`（775 行拖拽管理，工厂注入 EquipManager 防循环依赖）与 `ui/equip/slot-renderer.js`（updateEquipSlots/updateInventorySlots 纯渲染）；清理 3 个失效导入。外部 API（EquipManager.*、_dragDropManager._dragSrc 等）全部不变。
- **验证**：每阶段 lint/build 通过后提交；最终 lint ✅ build ✅ test-collider ✅ test-craft-sync ✅。
- **已知问题**：实机待回归——拖拽装备/换装、背包右键喝药（应与其他路径同为 30/25）、强化栏单击不再取回、祭品栏双击右键、快捷栏数量角标。

## 2026-07-18（暴击排查 + 冲锋加速 + 地牢占比 + 稀有度扩展）

### 对话：五项（暴击排查汇报/冲锋加速/地牢占比/稀有度+2级/背包债方案）
- **暴击失效排查（汇报，未改代码）**：非近期改坏——公式上玩家 crit=2+luck×1=12，敌方 critRes=con×1.0（僵尸15/毒液肥20/巫师30/突变体40/骑士46），finalCritRate 打多数目标=0%；怪物 crit=6~10 vs 玩家 critRes 10 ≤0%，且怪物无 criticalStrike 技能无暴击伤害路径。暴击伤害机制本身完好（lv1 ×1.55）。若要生效需改 combat-formulas.json 的 crit.base/luckMultiplier 或 critResist.conMultiplier（待拍板）。
- **骑士冲锋线性加速**：charge 配置 `speed:300` → `maxSpeed:400 + accelDuration:1500 + maxDuration:3500`；`_chargeElapsed` 计时，每帧速度 = maxSpeed × min(1, elapsed/1.5s)（0→400 线性）；停止条件：命中 / 超 1800px / 超 3.5s 未命中。
- **僵尸地牢占比**：typeRatios 战斗 0.7→0.5/事件 0.3→0.5，eliteCombatChance 0.2→0.35，shortestCombatPath 9→5（出征界面 battleRatio 文案同步 50%）。
- **稀有度+神话/传说**：新建 `src/config/rarity.js`（RARITY_LABELS/RARITY_COLORS/RARITY_ORDER/getRarityLabel 单一来源，含 mythic 神话/legendary 传说）；5 处 rarityLabelMap 重复定义全部收编引用（equip-tooltip-manager/equip-manager×2/shop-system/codex-manager，顺带完成技术债 D1）；game-style.css 四组稀有度色条（inv/slot/buy/sell-cell）追加 mythic 橙、legendary 红。
- **测试结果**：JSON 校验 ✅；`npm run lint` ✅；`npx vite build` ✅；`test-collider` / `test-craft-sync` ✅。
- **已知问题**：实机待验证——①冲锋 0→400 加速手感与 3.5s 超时；②地牢战斗/事件各 50%、精英 35%、最短 5 战；③新稀有度色条（暂无物品分配新等级，仅扩展显示能力）。

## 2026-07-18（快捷栏消耗品优化）

### 对话：快捷栏数量角标 + 用完保留 + 抖动警示 + 拖出移除
- **数量角标**：`_updateItemSlot` 数量常驻显示于图标上方，每帧 `_updateItemCounts` 按槽位实时刷新（仅变化时写 DOM）——可用数 >0 绿色、=0 红色（`.item-stack/.zero` 样式）。
- **用完不删图标**：最后一瓶用掉后背包物品移除，但快捷栏绑定保留（数量 0 红色）；同名消耗品补货回同槽位自动恢复计数。
- **0 数量点击抖动**：新增 `qb-shake` 动画类警示，不消耗、不解除绑定。
- **拖出移除**：物品槽 ondragend 检测 `dropEffect === 'none'`（未落在任何槽位）才解除绑定置空——唯一移除途径。
- **防顶替误判**：计数校验 `item.name === itemData.itemName && category === 'consumable'`，槽位被其他物品顶替时计 0 而不会误用。
- **测试结果**：`npm run lint` ✅；`npx vite build` ✅。
- **已知问题**：实机待验证——拖入药水数量绿色、用空变红、0 点击抖动、拖出快捷栏解除绑定、补货同槽恢复。

## 2026-07-18（骑士放大33% + 非手枪瞄准失效根因 + 手枪+盾规则）

### 对话：骑士缩放/瞄准二次排查/右键规则
- **骑士 +33%**：`enemy-config.json` armoredKnight——size 24→32、collisionRadius 22→29、spriteSize 220→293、collisionWidth 44→59、collisionHeight 100→133、footOffsetY 43→57、projectileHitbox 52×100→69×133（贴图与全部碰撞体积同步放大）。
- **非手枪瞄准失效（根因）**：`isGunWeapon(item)` 只认实例 `ammoConfig` 字段，而 equipment.json 里仅 G18/P4040 有该字段——PKM/AKM/霰弹等地牢掉落/JSON 来源枪械被误判为"非枪"，瞄准分支（以及弹药初始化）对它们不生效。修复：`isGunWeapon` 改为三级判定——实例 ammoConfig ∨ weaponId 命中 GUN_AMMO_CAP ∨ weaponType/rangedType 属枪械合集（新常量 GUN_WEAPON_TYPES，配置驱动）。
- **手枪+盾右键规则（长期）**：主手手枪+副手持盾 → 右键只触发盾格挡、无法进入瞄准（恢复盾防御，瞄准块原有的双持排除——盾为单手物品 isDualWield=true——天然屏蔽瞄准）；主手非手枪枪械 → 右键优先瞄准不进盾防御；近战/空手照旧盾防御。
- **测试结果**：enemy-config.json 校验 ✅；`npm run lint` ✅；`npx vite build` ✅；`test-collider` / `test-craft-sync` ✅。
- **已知问题**：实机待验证——①骑士放大后贴图/footprint/受击框对齐；②PKM/霰弹等右键出现镜头偏移；③手枪+盾右键只格挡。

## 2026-07-18（地牢地图机制确认 + 瞄准镜头失效修复）

### 对话：地图自适应/拖动边界排查 + 瞄准模式修复
- **地牢地图（排查确认，无需改动）**：自适应算法在位——`_centerRouteMap` 按节点包围盒计算 `mapScale = min(scaleX, scaleY, 1.5)` 并居中（褐色面板即地图画布背景 #1a1814）；拖动边界在位——`_clampMapOffset` 每次拖动后执行，地图画布始终覆盖显示区域，拖不出屏。
- **瞄准镜头失效（根因修复）**：主手为枪械且副手有盾时，右键先被盾防御状态管理拦截（enterDefense），随后"防御中跳过攻击输入"提前 return，瞄准分支永远执行不到。修复：盾防御状态管理加主手枪械判定 `_isMainGun`——主手是枪则右键优先瞄准模式（不进入盾防御，残留防御状态强制退出）；近战/空手右键照旧盾防御。瞄准偏移链路（update.js → Camera.aimOffset → camera.js 平滑 → GameScene scroll 同步）验证完好；瞄具改造（highPowerScope 900px/redDotScope 300px/无瞄具 100px）随 sparse `_craftEffects` 正常生效。
- **测试结果**：`npm run lint` ✅；`npx vite build` ✅；`test-collider` ✅。
- **已知问题**：实机待验证——①枪械+盾右键出瞄准镜头偏移；②近战+盾右键盾防御不回归；③三档瞄具偏移距离差异。

## 2026-07-18（诅咒铠甲事件必刷铠甲骑士 + 单波定制遭遇）

### 对话：事件强制怪物链路 + 单波构成
- **强制怪物链路**：cursedArmor（被诅咒的板甲）力量拆解失败结局 `forceMonsters: ['armoredKnight']` 经 handleNewDungeonEvent → node.forceMonsters → ZombieDungeonCombat 第 5 参，首波 unshift 插入（tier 'forced'）；`createArmoredKnight` 工厂登记入 ZOMBIE_FACTORY_MAP（family 骑士不进怪物池随机）。
- **单波定制遭遇**：结局配置 `encounter: { combatWaves: 1, monstersPerWave: 5, tierWeights: {normal:1, elite:0} }` → node.encounterOverride → 构造第 3 参（原 boss 战 override 机制复用）；`nextWaveMonsterClasses` 新增强制怪扣减（drawTarget = monstersPerWave − forcedCount）——诅咒铠甲战斗 = **1 波 × (1 铠甲骑士 + 4 普通池随机)**，composition/tierWeights 两分支均按扣减后名额抽取。
- **测试结果**：`npm run lint` ✅；`npx vite build` ✅；`test-collider` / `test-craft-sync` ✅。
- **已知问题**：实机待验证——诅咒铠甲战斗单波 5 只（1 骑士+4 普通）、无第二波；forceMonsters 仅僵尸系地牢生效。

## 2026-07-18（骑士冲锋朝向/二连击突进/格挡与玩家眩晕规则）

### 对话：铠甲骑士三项 + 玩家眩晕两项
- **冲锋回头根因**：追踪冲锋每帧 `flipX = cos(rotation) < 0`，目标贴近正上/下方时 cos 近 0 符号抖动、越过目标瞬间方向翻转 180°。修复：`_chargeFaceDir` 死区朝向——仅 `|dx| > 20px` 才更新水平朝向，冲锋期间 flipX 只读死区值，移动仍全量追踪。
- **二连击突进**：参考突变体-3 连击突进——`_startCombo` 向目标方向记录 `lungeDistance: 30` 总位移，`_updateCombo` 每帧按 `lungeSpeed: 500` 插值执行（WallSystem 碰撞，不瞬移）；新增 `combo.triggerRange: 75`（发动条件，伤害判定 range 仍 125），减少空挥。
- **格挡 1.5s**：`block.duration` 2000→1500，BootScene defend 动画 duration 同步 1500；格挡弹反眩晕 2s/击退 100px 与玩家盾基础弹反属性一致（此前已实现，本次确认）。
- **眩晕禁止技能/物品**：`QuickBar.useSlot` 加 `player.isStunned` 拦截（技能与物品同一入口）。
- **玩家眩晕终止所有动作**：`applyStun` 调用新 `_cancelAllActionsForStun()`——主副手攻击动画回 idle、闪避/冲刺(_dashState)/风车(含范围特效)/推击/特殊攻击/蓄力全部复位、四槽换弹中断（含单发装填）、退出无人机操控、速度清零——眩晕期间只播放 idle 精灵图（update 眩晕分支本就阻断移动/攻击输入）。
- **测试结果**：enemy-config.json 校验 ✅；`npm run lint` ✅；`npx vite build` ✅；`test-collider` / `test-craft-sync` ✅。
- **已知问题**：实机待验证——①冲锋全程不再回头；②二连击 30px 插帧突进观感与 75px 触发；③格挡 1.5s 动画对齐；④玩家被眩晕后动作全断、只播 idle、技能/物品禁用。

## 2026-07-18（七项修复与优化）

### 对话：换弹中断/按钮布局/无人机/初级地牢/骑士音效/清怪/冲锋速度
- **Super90 换弹切枪中断**：`switchWeaponMode` 成功后遍历四槽取消全部换弹状态（reloading/reloadTimer/singleReloadMode 清零），切枪立即中断换弹动作。
- **秒杀按钮遮挡修复**：根因=两按钮共用 `.invincible-toggle`（同坐标 left:124px）。game-style.css 新增 `#oneHitKillToggle { left: 180px; }`，无敌还原、秒杀居右。
- **无人机**：
  - 时长根因=skills.json duration 公式 `5+level×0.5`（lv1 仅 5.5s），按拍板改 `15+level×1`（lv1=16s/lv20=35s，双份 JSON 同步）；
  - 贴图根因=iconImage 指向从未存在的 drone_skill.png/shotgun_mastery.png（404→emoji 兜底），改为已存在的 `assets/skills/无人机.png`、`assets/icons/S12k-icon.png`（subsystems 兜底 3 处同步）；
  - 长按阈值 `input.skillLongPressMs` 300→1500；
  - 新增 `_holdPosition` 悬停：长按飞到鼠标点后原地停留、不再跟随玩家，再次长按飞往下一点，重新部署时重置；短按维持原 toggle（部署/操控/退出）。
- **僵尸地牢-初级精英混入**：根因=beginner 缺 `encounters` 键，普通战斗回退 DEFAULTS（20% 精英）。补 encounters：normal 全普通怪（3 波×5，tierWeights 1/0），elite 显式复制精英构成备用；boss 战 bossEncounter 不受影响。
- **铠甲骑士音效**（sounds 配置块驱动）：素材 3 个 mp3 复制到 `assets/sounds/enemies/armored_knight/`；walk 每 500ms 播 walking.mp3；combo 帧 6/17 播 attacking.mp3（与伤害帧 12/25 独立）；格挡每次受击播 defending.mp3（替换原通用 wood_thud）；冲锋每 300ms 播 walking.mp3、撞中目标播 defending.mp3。
- **主神空间清怪**：删除胖子僵尸/普通僵尸/集合体三个生成调用（方法保留备用），只留铠甲骑士与测试靶/DPS 靶。
- **冲锋速度**：charge.speed 900→300（配置）。
- **测试结果**：全部 JSON 校验 ✅（skills 双份同步一致）；`npm run lint` ✅；`npx vite build` ✅；`test-collider` / `test-craft-sync` ✅。
- **已知问题**：实机待验证——①切枪中断换弹手感；②两按钮不再重叠；③无人机 16s 时长/新图标/长按 1.5s 飞行+悬停；④初级地牢普通战斗不再出精英；⑤骑士音效各触发点；⑥300px 冲锋速度观感。

## 2026-07-18（新怪物：铠甲骑士）

### 对话：新增精英怪铠甲骑士（按添加怪物工作流）
- **素材**：`素材库/怪物/铠甲骑士` 5 张精灵图（8×4 网格 512×512）复制到 `assets/enemies/armored_knight/`——idle 1 帧 / walking 11 帧 / attacking 32 帧 / attacking-2 19 帧 / defending 14 帧。
- **配置**（`enemy-config.json` armoredKnight，全部配置驱动）：精英、HP 800、speed 187.5（同僵尸）、六维按突变体-3 ×1.15 取整（str58/dex35/con46/int6/wis12/luck7，公式派生 atk≈47/def≈86）、level 10（经验精英 ×2 = 120）、family 骑士（不进僵尸地牢怪物池）。`attackSkills` 块集中管理三技能数值。
- **技能**（`armored-knight.js`，自定义 AI 关闭通用近战）：
  - 二连击挥砍：32 帧 2s，第 12/25 帧各判定一次 atk×1（range 125），CD 4s；
  - 持盾冲锋：瞬间发动（无蓄力），900px/s 逐帧追踪目标，命中 atk×2 + 击退 200px + 眩晕 2.5s，撞停或超 1800px 止，CD 10s；**冲锋期间 `_parryImmune`**（集合体同机制，结束后还原）；目标弹反成功则不受伤不眩晕只保留击退（复用玩家盾 `_lastParried` 判定）；
  - 举盾格挡：玩家攻击动作临近（260px）时面对目标举盾 2s，期间不可移动/不可其他动作，`takeDamage` 覆写——玩家来源伤害全部按弹反处理（免伤 + 近战攻击者眩晕 2s 击退 100px，弹反免疫者除外），CD 6s；附 `shieldSystem._lastParried` 代理接入 DamagePipeline 抑制击退/craft 命中效果（与玩家盾同口径）。
- **注册**：BootScene 5 组精灵图 + 5 个动画（combo/defend 单次、charge 循环）；enemy-types.js 导入导出；`game.js spawnMainArmoredKnight` 主神空间生成 1 只测试（永久警戒）。
- **测试结果**：enemy-config.json 校验 ✅；`npm run lint` ✅；`npx vite build` ✅；`test-collider` / `test-craft-sync` ✅。
- **已知问题**：实机待验证——①三技能动画与帧判定同步；②冲锋追踪手感与 1800px 截停；③格挡弹反对玩家近战/枪械/技能各路径表现；④渲染比例（spriteSize 220/footOffsetY 43 按帧内容推算，可能需微调）。

## 2026-07-18（改造系统深化：registry 驱动聚合 + craft-system 拆分）

### 对话：技术债清理——三角机制重构 + craft-system.js 拆分
- **registry 三角重构**：新建 `src/ui/craft/craft-effects.js`——`aggregateCraftEffects` 按 `CRAFT_EFFECT_REGISTRY[key].applyMode` 聚合（flag=布尔 OR / override=后选覆盖 / add·multiply=求和），替代 `_applyModEffects` 中 44 行人工逐键收集；返回稀疏对象（与旧全量零值对象在消费端 falsy 判断下等价，语义抽样测试 PASS）。**新增改造效果只需 craft-config.json 加 effects + registry 注册条目，聚合自动生效**（`applyModEffectsToPlayer` 同迁弹药重初始化）。
- **craft-system.js 拆分**：891 → 741 行。贴图回退链抽为 `src/ui/craft/weapon-image.js`（`resolveWeaponImageSrc`，含 ItemDatabase.getByWeaponId 反查）；`_applyModEffects` 变为薄封装；删除已无用的 ItemDatabase 导入。DOM 拖拽/编辑模式/弹窗保留在 craft-system.js（UI 控制器），外部 API（open/close/_updateUI/_getCraftConfig 等）不变。
- **test-craft-sync.mjs 适配**：收集腿改为结构性断言（craft-effects.js 引用 CRAFT_EFFECT_REGISTRY+applyMode，收集≡注册），保留配置⊆注册、配置⊆消费两腿，新增 registry 条目结构校验（applyMode 合法 + display 存在）。
- **测试结果**：`node scripts/test-craft-sync.mjs` ✅（38 配置键/39 注册/聚合驱动✓/38 消费）；聚合语义抽样（flag/override/add）PASS；`npm run lint` ✅；`npx vite build` ✅；`test-collider` ✅。
- **已知问题**：实机待验证——改造面板装配/替换配件后效果与 tooltip 显示与重构前一致。

## 2026-07-18（无人机长按指挥飞行 + 易伤暴击修复）

### 对话：无人机操作优化 + 易伤 buff 暴击率排查
- **排查结论（两个真 bug）**：
  1. **易伤暴击率加成未进实际伤害判定**：`Combatant.takeDamage` 的真实暴击率只算 `source.crit + 附魔 - critRes`，漏加 `droneCritBonus`；`DamageableEntity` 里虽加了无人机暴击率，但那条 isCrit 只喂 criticalStrike 经验、不影响伤害。修复：`combatant.js` finalCritRate 补 `droneCritBonus`（与经验判定同口径）。
  2. **易伤伤害加成双重应用**：`Combatant.takeDamage` 与 `DamageableEntity.takeDamage` 各乘了一次 `(1 + droneBonus)`（Enemy 继承链两级都走），实际增伤高于描述（如 12% 变 25.4%）。修复：删除 Combatant 层的重复块，统一由 DamageableEntity 在防御计算后应用一次。
- **长按指挥飞行**：`game-config.json` 新增 `input.skillLongPressMs: 300`；input.js 对无人机技能键按下只记录、松开时交 `QuickBar.droneKeyUp` 按时长分流——短按维持原 toggle（部署/操控/退出），长按 `_droneMoveCommand` 调 `DroneSystem.commandFlyToMouse()`：`Renderer.screenToWorld` 取鼠标世界坐标设 `_moveTarget`，无人机自动飞往（撞墙用 WallSystem.resolve，0.5s 无进展放弃防卡死，到达 12px 内停止；操控模式 WASD 输入立即取消命令）。未部署时长按 = 先部署再飞行（部署等同施放，受冷却限制）。
- **测试结果**：game-config.json 校验通过；`npm run lint` ✅；`npx vite build` ✅；`test-collider` / `test-craft-sync` ✅。
- **已知问题**：实机待验证——①长按下无人机飞鼠标点、短按原行为不回归；②被易伤目标的暴击触发率上升；③易伤增伤数值与技能描述一致（不再双倍）。

## 2026-07-18（集合体投掷音效前置 + 首领经验确认）

### 对话：投掷音效再前移 1.5s + bossMultiplier 确认
- **投掷音效前置调度**：`attackSkills.throw` 配置 `soundPreMs`（当前 750）；`amalgam-zombie.js` 新增投掷预备机制——`_decideAttack` 命中投掷时立即播放 throwing 音效并置 `_throwPending = soundPreMs`（同时进入冷却防止重复触发），update 循环倒计时到点后 `_startAttack('throw')` 才开始攻击动作，`_throwSoundPlayed` 抑制攻击内重复播放。音效起点 = 攻击动作前 soundPreMs。预备期间目标丢失则自然取消。（初版 1500ms，实测后后移 750ms 对齐听感）
- **首领经验 ×10（确认无需改动）**：`enemy.js getExpValue()` 已按 `rank === 'boss'` 应用 `combat-formulas.json` 的 `bossMultiplier: 10`；amalgamZombie（rank boss、level 7、无 expValue 覆盖）击杀经验 = (10 + 7×5) × 10 = **450**，召唤物闸门不受影响。
- **测试结果**：enemy-config.json 校验通过；`npm run lint` ✅；`npx vite build` ✅。
- **已知问题**：实机待验证——音效起点与抬手/出手的听感对齐（不合适改 `soundPreMs`）；注意攻击动作整体后移 1.5s（玩家多 1.5s 反应时间）。

## 2026-07-18（集合体投掷音效）

### 对话：集合体投掷音效启用 throwing.mp3 + 音效前移
- `data/enemy-config.json` amalgamZombie `sounds.throw` 由占位 `idle.mp3` 改为 `assets/sounds/enemies/amalgam/throwing.mp3`（素材早已复制到项目，仅配置未接）。
- **音效前移（音画同步）**：`attackSkills.throw` 新增 `soundLeadMs: 2000`；`amalgam-zombie.js _updateThrowFire` 拆出独立音效触发点 `max(0, fireT - soundLeadMs)`（`_throwSoundPlayed` 标志，`_startAttack` 重置）——出手帧 16/25（1200ms）减去 2000ms 前移量后锚定到攻击动画起点，音头覆盖抬手过程，出手/落地与画面对齐。
- **测试结果**：enemy-config.json 校验通过；`npm run lint` ✅；`npx vite build` ✅。
- **已知问题**：实机听感待确认（如前移量不合适，改 `soundLeadMs` 即可）。

## 2026-07-17（遗留 bug 与技术债务分批清理）

### 对话：7 阶段 19 项清理（v0.198+）
- **文案/键值级（6 项）**：宝箱怪战斗文案与实刷 3 只一致；附魔成功音效由不存在的 `SoundManager.play('enchant_success')` 改为 `playFile(levelup_cyber_5s.wav)`；「沉重」文案改"攻击速度降低约26%"（×1.35 间隔的真实口径）；enchant-config 卷轴 weaponTypes 删死值 `'melee'`；符文重构文案 20px→40px（与实现一致，双份 craft-config.json 同步）；锐利符文文案删"右键特殊攻击"前缀（魔抗穿透作用于一切魔法伤害）。
- **附魔系（3 项）**：投射物发射时快照 `_enchantEffects/_craftEffects` 到 `_effectSnapshot`（projectile-factory 统一注入），命中按快照判定，杜绝飞行中切枪改效果；`_baseCooldowns` 首缓存污染修复——`Attack` 构造时固化 `baseMaxCooldown`，`_applyEnchantAttackInterval` 改读创建基准（能量轻机枪 ramp 运行时值不再被当基准缓存）；附魔界面从装备槽拖出武器补调 `_applySkillOverrides` + `_syncWeaponVisual`（沉重/冷却/贴图立即还原）。
- **改造系（5 项）**：次级格挡实现补 `isMelee` 判定（与描述一致），registry tooltip 同步；冲刺体力删 `staminaCostDelta` 双用（只吃 `skillStaminaCostDelta`）；基类 `combatant.js` `_startReload/_updateReload` 改读 state（`_initAmmoForSlot` 已计入改造），不再直读 ammoCfg 原值；`getCraftEffectDisplay` 透传聚合效果，`magicVulnerabilityOnHit` 显示真实层数、`magicVulnerabilityStacks` 不再渲染空行；craft-system 武器贴图 weaponIdMap 硬编码表删除，`ItemDatabase.getByWeaponId` 懒索引反查（新武器免登记，load/addItem 自动失效重建）。
- **地牢系（2 项）**：`_cleanupEventUI` 先调 `DungeonEventSystem._cleanupUI()` 销毁打字机再移除 DOM；地牢 buff 实体状态键 `'buff'` 改唯一键（`goddessBless`/`demonPrayer`/`buffCfg.id`），`consumeBattleBuffs/clearAllBuffs` 按同键移除，多 buff 不再互删图标。
- **死代码批删（逐条 grep 确认零调用）**：`node._combatCompleted` 只写不读；`ZOMBIE_DUNGEON_CONFIG` 残留 `combatWaves/monstersPerWave/tierWeights`（实际读 `DungeonConfig.getZombieEncounterConfig`）；`consumeGoddessBless`；`EnchantConfig.getGradeCost`；Player 空 `_onHitEntity` 覆盖（**注意**：`damage-pipeline.js` 的 `_onHitEntity` 调用保留——enemy.js 敌人实现是活的，毒伤/协同流血依赖它）；craft-system `_ticketCost`/`_modifications`/`getWeaponEffects`；registry 五个零调用函数（保留 `getCraftEffectDisplay`）；codex `_craftEffects` 展示死分支（图鉴为 DB 合并物品永无实例改造数据）；spitter-zombie 敌人端 `_craftEffects` 复制残留。
- **配置化（3 项）**：强化三常量（maxLevel 15/baseCost 100/costGrowth 1.5）移入 `data/game-config.json` 新增 `enhance` 节，`enhance-system.js` 统一 `_getEnhanceConfig()` 读取（`??` 回退）；强化石/改造券模板补 `id`（reward-system 模板 + 地牢事件奖励创建点注入 `id: configKey`），消耗匹配改 id 优先、无 id 旧实例名称兜底；`weapon-damage-formulas.js` 补注释标明最小回退定位（核查与 attack-formula.js 无重复，不合并）。
- **测试结果**：每阶段跑 `npm run lint` / `npx vite build` / `test-collider.mjs` / `test-craft-sync.mjs` 全部通过（registry 三角计数 38/39/39/38 不变，确认只删函数未动效果条目）。
- **已知问题**：待用户拍板——enhanceFlat 倍率、bossMultiplier、投掷音效（idle vs throwing）；椭圆分离手感需实机回归。

## 2026-07-17（受击粒子落地黄/眩晕双星/召唤物统一标签与闸门）

### 对话：集合体两项 + 召唤物系统性调整（v0.198+）
- **集合体受击粒子换落地黄色**：`enemy-config.json` amalgamZombie 新增 `hitParticleColor: "#b8860b"`；`triggerZombieHitParticles` 读取该配置，`playZombieHitParticles` 支持自定义 tint——自定义色用白色 `impact_dot` 纹理（tint 乘算准确显色），默认绿色沿用原绿色纹理不变（其他僵尸不受影响）。
- **眩晕双星动画特效**：`GameScene._ensureStunStarTexture`（四角星纹理）+ `_syncStunEffects`——眩晕实体头顶两颗星星以半径 26px 旋转（Y 按平面透视压缩、带上下浮动），眩晕持续时间内播放，结束或实体失效自动销毁，地图模式全部清理；update 循环接入。
- **召唤物统一 `_summoned` 标签（一劳永逸）**：集合体召唤僵尸/投掷胖子、僵尸巫师召唤犬统一打 `_summoned = true`（不影响地牢原有怪物）。
- **统一闸门（金币/经验/技能修炼全拦截）**：
  - `damageable-entity.js onDeath`：金币掉落+玩家经验跳过 `_summoned`；
  - 同文件 takeDamage：暴击经验、武器精通经验（kill/crit）、无人机经验三个分支全部加 `!this._summoned` 闸门；
  - 各技能击杀计数（attack.js ×2、whirlwind、ice-spike、dash ×2、push-strike、fireball 共 7 处）全部改为 `killed && !entity._summoned` 才计数。
  - 设计说明：`_summoned` 为唯一标签，未来任何召唤方打标即自动被全部闸门拦截；命中数（hitCount）仍照常计入（未被"杀死"的召唤物命中属于正常命中经验，与"杀死召唤物无收益"语义一致）。
- **测试结果**：`npm run lint` ✅；`npx vite build` ✅；`node scripts/test-collider.mjs` ✅。
- **已知问题**：实机待验证——①集合体受击为落地黄、其他僵尸仍为绿色；②被眩晕单位头顶双星旋转、醒后消失；③杀召唤犬/召唤僵尸/投掷胖子不掉金币经验、武器精通/各技能修炼不累积，原地牢怪正常。

## 2026-07-17（集合体弹反免疫 + 位移免疫确认）

### 对话：集合体弹反交互独立设置（v0.198+）
- **弹反免疫（配置驱动）**：`enemy-config.json` amalgamZombie 新增 `parryImmune: true`；`amalgam-zombie.js` 构造函数读入 `_parryImmune`；`shield-system.js triggerParry` 在弹反音效后对免疫单位直接 return——弹反对集合体**不再造成眩晕、击退、打断动作**（攻击动画/阶段照常进行）。玩家侧收益（免伤、免体力消耗、弹反音效、防御经验）全部不受影响、不做修改。
- **位移免疫（已确认在位）**：集合体已具备完整防位移链——speed 0 显性锁死、每帧 vx/vy/knockback 归零、`applyKnockback` 空覆盖（任何来源击退无效）、`noSeparation`（分离时对方承担全部位移）、出生点锚点钉死（每帧强制归位）。任何单位都无法推动集合体。
- **测试结果**：enemy-config.json 校验通过；`npm run lint` ✅；`npx vite build` ✅；`node scripts/test-collider.mjs` ✅。
- **已知问题**：实机待验证——①对集合体弹反：玩家不受伤害/不耗体力/有音效，但集合体不眩晕、不被击退、攻击不被打断；②集合体被任何方式攻击/挤压时纹丝不动。

## 2026-07-17（左下"秒杀"调试按钮）

### 对话：新增秒杀模式开关（v0.198+）
- **按钮**：`hud-panels-misc.js` 无敌按钮旁新增"秒杀"切换按钮（同款样式），点击切换 `window.Game._oneHitKill`，开启时显示"秒杀中"（active 高亮）。
- **秒杀判定**：`damageable-entity.js takeDamage` 在扣血前检查——`source._faction === 'player' && Game._oneHitKill` 时 `baseDamage` 提到 `max(baseDamage, this.hp)`，走正常伤害流程（死亡特效/掉落/经验照常触发，不会跳过结算）。
- **作用域**：全局生效（含地牢 BOSS 战），供快速测试。
- **测试结果**：`npm run lint` ✅；`npx vite build` ✅；`node scripts/test-collider.mjs` ✅。
- **已知问题**：实机待验证——按钮切换与秒杀生效（伤害数字、掉落、经验照常）。

## 2026-07-17（召唤 CD 15s 确认 + 召唤点黑色刷怪粒子）

### 对话：集合体召唤调整（v0.198+）
- **召唤 CD**：`attackSkills.summon.cooldown = 15000`（15s，配置已确认生效，首次召唤同样在生成 15s 后触发）。
- **召唤点黑色粒子**：`_updateSummon` 每只僵尸召唤成功时，在其脚下调用 `GameScene.playDungeonSpawnParticles(sx, sy)`（与地牢战斗房刷怪同款：纯黑、更慢、1.5s、NORMAL 混合）。
- **测试结果**：`npm run lint` ✅；`npx vite build` ✅。
- **已知问题**：实机待验证——召唤间隔 15s 与召唤点黑色粒子观感。

## 2026-07-17（血条再下移/冲击波加粗闪烁/footprint 270 上移 100）

### 对话：集合体三项微调（v0.198+）
- **血条再下移 100px**：`_syncEntityHud` boss 血条 `barY` 由 `topY + 88` → `topY + 188`（660px 贴图下进一步下移）。
- **冲击波加粗 + 闪烁**：`_fireSlamShockwave` 描边 4px → **8px**；透明度在淡出曲线上叠加高频正弦闪烁（`0.55 + 0.45 × sin(t×π×8)`），冲击波呈脉冲感。
- **footprint 椭圆优化**：`collisionRadius` 240 → **270**（+30）；`render.colliderOffsetY` -50 → **-100**（中心点再上移 50px，阴影/命中/分离同源随动）。
- **测试结果**：enemy-config.json 校验通过；`npm run lint` ✅；`npx vite build` ✅；`node scripts/test-collider.mjs` ✅。
- **已知问题**：实机待验证——①血条新位置；②冲击波加粗+脉冲闪烁观感；③270/-100 的椭圆与贴图对齐及可接近手感。

## 2026-07-17（落地粒子偏色根因/砸地区域 200-400-800/砸地冲击波）

### 对话：集合体三项调整（v0.198+）
- **落地粒子仍显绿色的根因**：`zombie_hit_dot` 纹理本身就是绿色（`fillStyle(0x55ff55)` 生成），Phaser tint 是**乘法**——深黄 tint × 绿色纹理仍偏绿。修复：新增白色粒子纹理 `impact_dot`（`_ensureImpactDotTexture`），`playTanImpactParticles` 改用白纹理，深黄 tint（0xb8860b）现在准确显色。
- **砸地伤害区域调整**（enemy-config.json `attackSkills.slam.zones`）：100/200/500 → **200px ×1.2 / 400px ×0.7 / 800px ×0.2**，各自区域判定不叠加，其他不变。
- **砸地范围提示改为冲击波动画（首版参考）**：删除静态三层红圈显示，改为每个伤害帧（7/12/17/20/24/27）从集合体中心释放一个红色椭圆冲击波——`_fireSlamShockwave`：椭圆由 0 扩散至最大伤害圈半径（800px），4px 描边随扩散淡出（alpha 0.9→0）+ 极淡填充，平面透视 2:1，600ms Cubic.easeOut；同时最多 6 个波并存，结束自动销毁；`_destroyCustomEffects` 统一清理在飞的波（死亡/战斗结束无残留）。
- **测试结果**：enemy-config.json 校验通过（zones 200/400/800）；`npm run lint` ✅；`npx vite build` ✅；`node scripts/test-collider.mjs` ✅。
- **已知问题**：实机待验证——①落地粒子正确显示深黄色；②冲击波扩散节奏/透明度/透视比例观感（首版供参考，参数在 `_fireSlamShockwave` 可调）；③200/400/800 三圈伤害手感。

## 2026-07-17（落地粒子深黄/砸地CD驱动+三圈显示/分离椭圆匹配/投掷预判）

### 对话：集合体四项调整（v0.198+）
- **落地粒子改深黄色**：`playTanImpactParticles` tint `0xc8a060`（黄褐）→ `0xb8860b`（深黄）。
- **砸地攻击放不出来的根因**：**不是 AI 问题，是判定范围问题**——footprint 半径翻倍到 240 后，玩家被分离边界挡在 ~262px 外，而 `_decideAttack` 要求 `dist <= triggerRange(250)` 才触发砸地，永远不满足。修复：砸地改为 **CD 一旦满足立即释放**（有目标即可，不再受 triggerRange 限制）；投掷攻击仍按自身 CD 独立进行，动画/阶段互不影响（`_attackKind` 互斥，一方进行中另一方等待）。
- **砸地范围显示**：`_createSlamZoneDisplay`——三圈按伤害深度分层红色（500px 浅红 `0xff8080` / 200px 中红 `0xd03030` / 100px 深红 `0x8a0a0a`，伤害最高圈最深），先大区后小区叠加绘制，椭圆 2:1 透视；砸地结束自动取消；新增 `_destroyCustomEffects`（清理警示圈/范围圈/飞行投射物），`onDeath` 与 `game.js removeEntity` 均调用，怪物死亡/战斗结束正确删除效果。
- **footprint 椭圆精准匹配（根因）**：`resolveCollisions` 分离判定此前用世界圆（r 沿 Y 全量），而 footprint 视觉/投射物判定是椭圆（ry=r×0.5 透视），沿 Y 方向物理边界比视觉椭圆远一倍——"视觉有空间却不能接近"。修复：分离判定加入逆透视变换（`dy × 1/PERSPECTIVE_SCALE_Y`，与 `projectile._hitFootprintEllipse` 同口径），位移量再变换回世界空间，分离体积与 footprint 椭圆完全一致。
- **投掷预判**：`_startAttack('throw')` 改用与其他远程怪物（僵尸巫师/毒液僵尸）相同的 `AimHelper.lead` 预判——延迟 = 出手帧时间（1.2s）+ 飞行时间（0.6s），落点与红色警示圈均按预判拦截点显示，不再锁定目标当前位置。
- **测试结果**：`npm run lint` ✅；`npx vite build` ✅；`node scripts/test-collider.mjs` ✅。
- **已知问题**：实机待验证——①深黄色落地粒子；②砸地 CD 到点即放、三圈红显示与结束取消；③接近集合体沿 Y 方向阻挡边界与椭圆视觉一致；④移动目标的投掷落点预判准确性。

## 2026-07-17（召唤物无奖励/集合体音效/血条去标签/footprint分离同源）

### 对话：集合体四项调整（v0.198+）
- **召唤物无经验金钱**：`amalgam-zombie.js` 召唤僵尸（`_updateSummon`）与投掷生成胖子僵尸（`_impactThrow`）打 `_noExpGold = true` 标记；`damageable-entity.js onDeath` 的金币掉落+经验分支跳过标记实体。**不影响地牢原有僵尸/胖子僵尸**（标记只打在集合体生成的实体上）。
- **集合体音效系统**：素材复制到 `assets/sounds/enemies/amalgam/`（规则 4）；`enemy-config.json` 新增 `sounds` 配置块（idle/throw/impact/slamHit/death/idleInterval，配置驱动）；`amalgam-zombie.js` 新增 `_playSound(key)` 助手（SoundManager.playFile）与五个触发点——待机环境音按 idleInterval 循环、投掷出手（fireFrame）、投射物落地、砸地 6 个命中帧、死亡。SKILL.md 新增「音效导入工作流」章节（素材建档→配置映射→事件播放三步）。**备注**：`throwing.mp3` 已入库未使用（投掷按用户指定用 idle.mp3），如需切换改配置一行即可。
- **世界内血条**：删除血条下方的 `Lv.X · 首领` 标签文字。
- **footprint 椭圆与实际分离不一致根因**：`game.js resolveCollisions` 的分离计算用实体 x/y，而 footprint 椭圆/阴影/命中判定用 `Collider` 偏移后坐标（colliderOffsetY=-50）——物理分离区比视觉椭圆低 50px，造成"视觉有空间却不能接近"。修复：分离计算统一取 `collider.x/y`（与命中椭圆/阴影同源）。
- **测试结果**：enemy-config.json 校验通过；`npm run lint` ✅；`npx vite build` ✅；`node scripts/test-collider.mjs` ✅。
- **已知问题**：实机待验证——①召唤僵尸/投掷胖子死亡不掉金币经验、地牢原有怪物正常掉落；②五个音效点（待机循环/投掷/落地/砸地帧/死亡）；③血条无首领标签；④集合体可接近距离与视觉椭圆一致。

## 2026-07-17（集合体判定圆/血条重做/警示圈销毁/落点粒子）

### 对话：集合体四项调整（v0.198+）
- **判定圆**：`enemy-config.json` amalgamZombie `collisionRadius` 120→**240**（半径翻倍）；新增 `render.colliderOffsetY: -50`（footprint 上移 50px，经 `Collider.syncPosition` 的 entity.colliderOffsetY 机制生效，阴影/命中/分离同源随动）。
- **生命值显示重做**（GameScene `_syncEntityHud` boss 分支）：
  - 世界内血条整体下移 100px（`topY - 12` → `topY + 88`），解决上浮过高；
  - 字段错开：名字（barY-34）/ HP 数值（barY-8）/ `Lv.X · 首领` 标签（血条下方 barY+barH+12）不再贴在一起；
  - 召唤阈值绿线改为仅在配置了 HP 阈值召唤的 Boss 才画（集合体定时召唤不画）。
- **新增 BOSS 专属血条（屏幕空间 DOM）**：`GameScene._ensureBossHpBar/showBossHpBar/_updateBossHpBar/_hideBossHpBar`——位于顶部状态栏下方 20px、520px 居中（首领名+渐变血条+数值）；`damageable-entity.js` 在 `rank==='boss' && source._faction==='player'` 受击时触发显示（只有玩家攻击到才显示），5 秒无新命中自动隐藏、Boss 死亡立即隐藏。
- **投掷警示圈落地不消失根因**：`AttackRangeEffect.update()` 只在 `life<=0` 时才销毁 Phaser 图形，而 `_destroyWarning` 置 `active=false` 后 EffectManager 在下一帧就把效果移除出列——life 永远到不了 0，graphics 永久残留。修复：`_destroyWarning` 现在**立即调用** `_destroyPhaserGraphics()` 销毁图形（落地事件即删除）。
- **落点黄褐色粒子**：`GameScene.playTanImpactParticles(x, y)`——参考僵尸受击粒子，黄褐色 tint、2.0 起始缩放（更大）、20 颗（更多）、lifespan 1500（1.5 秒）、重力下坠；在 `_impactThrow` 落点处触发。
- **测试结果**：enemy-config.json 校验通过；`npm run lint` ✅；`npx vite build` ✅；`node scripts/test-collider.mjs` ✅。
- **已知问题**：实机待验证——①判定圆 240/上移 50 的命中手感与阴影位置；②世界内血条下移/错开版式；③命中才显示的 BOSS 血条位置/渐变/隐藏时机；④投掷警示圈落地即消失；⑤黄褐色粒子大小/浓度/时长。

## 2026-07-17（清单全量收尾：地牢中低优先级/改造P2/数值决策/技术债务）

### 对话：按清单完成全部剩余工作（v0.198+）
- **A1 地牢中优先级 7 项**：`game.js` 拦截 `state='reward'`（奖励面板期间实体不更新）；波次切换改 `_scheduleNextWave`（暂停自动顺延，不再真实时间刷波）；商店轮询句柄存 `_shopCheckInterval` 并在 shutdown 清理 + `_returnToMap` 加 active 守卫；`_checkBossDefeated` 不再把 null boss 当战胜；补给堆药水=瓶数×单瓶恢复量（`POTION_HEAL/POTION_MP` 导出）且不再与旧 successRewards 双重发奖；事件结果按钮 300ms 延迟激活防双击穿透；负金币扣除钳制到持有量。
- **A2 改造 P2 六项**：G18 weapon9 完整改造选项复制移到 weapon10 完整赋值之后（四个死格修复）；`_getCraftConfig` 无配置返回 null 不再回退 PKM（UI 显示"该武器不可改造"，锈剑/弓/盾不能再装消音器）；同 id 配件不再白扣 4 券；拖入装备栏立即 `_initAmmoForSlot`；registry 补 `staminaCostDelta/skillStaminaCostDelta/dashDoubleHit`；tooltip 弹夹 magazineOverride 优先。
- **A3 数值决策**：`getAttackFormula` 回退 `enhanceFlat: 1`（无 attackFormula 武器强化 +1/级）；`expValue` 新增 `eliteMultiplier: 2 / bossMultiplier: 10`（boss 经验配置化，集合体现 450）；盾牌 `defense.base + perEnhance × 强化等级` 计入玩家 def（防具强化真生效）；15 张事件背景图 3072×2048 → 1920×1280（93MB→45MB）。
- **A4 地牢低优先级清理**：工厂 fallback HP 同步现值 + 召唤工厂注入；`combatRoom.bossSize` 4096→1024 且 BossRewardSystem arena.size 改读配置（死配置盘活）；BOSS 战清理恢复地形/树木/世界尺寸 + syncTerrain；BOSS 墙补 height:60；`_restoreSceneState` 补 syncTerrain；退出按钮绘制/热区统一；`_entityHudTexts` type→role 字段修正；`_onEnemySpawn` rebuildCollider 守卫；iconMap 补 materials；事件完成 isActive 复位；`_calculateSpawnArea` margin 生效（与 minWallDistance 取大）。
- **B 阶段**：SKILL.md 新增 v2.9 变更记录；存档包含装备/背包（`game-ui-manager.js` 存档加 equipments/backpack，读档真正恢复并重算派生状态——此前 load 只 alert）；强化公式展示收敛为 `attack-formula.js` 的 `buildFormulaDisplay` 唯一实现（enhance/tooltip 两处委托，codex 硬编码 ×0.1 描述同步修正）。
- **C 阶段（技术债务）**：
  - **craft 配置迁 JSON**：`_WEAPON_CRAFT_CONFIGS` ~1200 行硬编码经脚本忠实导出为 `data/craft-config.json`（71KB，12 武器配置），`public/data/craft-config.json` 同步；craft-system.js 由 1461 → 922 行，拼接代码全部移除。
  - **registry 三角同步**：后坐 `recoilRecoveryDelta`（kick 衰减分母 max(20, 80+delta)）、散布 `shotSpreadDelta`（每发 kick 按最大散布角折算）、移速 `moveSpeedPercent` 非 PKM 武器通用化；新增永久检查 `scripts/test-craft-sync.mjs`（配置→收集→注册→消费四面校验，38 键全过）。
  - **死代码清理**：删除 boss-reward-system.js 的 DungeonBuffSystem（~200 行，与 dungeon-event-system 同名类重复且无调用方）及全部引用（实例/委托方法/window/导出/StatusBar 闲置导入）。
- **测试结果**：`npm run lint` ✅ 0 警告；`npx vite build` ✅；`node scripts/test-collider.mjs` ✅；`node scripts/test-craft-sync.mjs` ✅（38 键全同步）。
- **已知问题**：实机待验证——①奖励面板期间实体冻结；②暂停不刷波；③补给堆药水恢复量正常；④G18 改造格全部可用；⑤穿甲/后坐/移速改造实机手感；⑥读档恢复装备背包；⑦改造配置迁移后全部武器改造项正常。

## 2026-07-17（附魔/改造/强化审查 P0+P1 六项修复）

### 对话：按审查优先级修复附魔/改造/强化三系统问题（v0.198+）
- **P0-1 附魔 init 未调用（拖拽放回失效）**：`main.js` 新增 `EnchantSystem.init()`（注册 4 个 EventBus 监听：附魔槽拖回背包/装备栏、卷轴快捷放入）。
- **P0-2 魔法粉尘名称断链（附魔经济断裂）**：`enchant-config.js` `MagicDustItem.name` 魔法晶尘→**魔法粉尘**（与地牢事件奖励同一物品）；`enchant-system.js` 三处匹配点硬编码字面量改为引用 `MagicDustItem.name`（配置驱动）；相关 UI 文案同步。
- **P0-3 穿甲改造完全无效（生产端从不写入）**：`craft-system.js _applyModEffects` 增加 `armorPenetrationPercent` 收集变量 + 循环累加 + 写入 `_craftEffects`（与 magicPenetrationPercent 同模式），`damageable-entity.js` 既有消费端自此生效。
- **P0-4 强化 stats 平方级污染（实战数值漏洞）**：`enhance-system.js` 删除强化时改写 `item.stats` 显示值的整块逻辑——stats 不再被反复改写，基础值不再滚动累加；无 attackFormula 武器经 getAttackFormula 回退读取的 base 保持干净。**注意**：无 attackFormula 的 16 个武器（锈剑/符文剑/AKM/PKM 等）回退 `enhanceFlat: 0`，强化对它们现在无实战加成（此前靠污染生效），如需加成需改回退公式（数值改动待你确认）。
- **P1-1 沉重减速只在切枪时生效**：`subsystems.js _applyEnchantAttackInterval` 重写——空手/非武器时恢复全部已缓存基础冷却（防残留）；`_applySkillOverrides` 开头统一调用（覆盖所有装备/卸下路径）；`enchant-system.js` 附魔写回后立即刷新。
- **P1-2 强化石白扣**：`enhance-system.js` 消耗顺序改为先扣金币成功后再扣强化石（并合并重复金币检查）。
- **测试结果**：`npm run lint` ✅；`npx vite build` ✅；`node scripts/test-collider.mjs` ✅。
- **已知问题**：实机待验证——①附魔槽拖回背包/装备栏；②地牢获得粉尘可支付附魔；③穿甲配件（厚重钝化/钢芯穿甲弹）实际生效；④强化不再虚高；⑤沉重减速装备即生效、卸下不残留；⑥金币不足时石头不消耗。

## 2026-07-17（地牢审查 4 个高危问题修复）

### 对话：Boss 回调清空/软锁/宝箱 TypeError/召唤泄漏修复（v0.198+）
- **修复 1（Boss 完成回调永不触发）**：`boss-reward-system.js leaveBossBattle` 先取 `const onComplete = this._onCompleteCallback` 再 `cleanup()`（此前 cleanup 先把回调置 null，回调永远执行不到 → Boss 节点无法标记完成、奖励节点流程失效）。
- **修复 2（Boss 战中死亡后 active 卡死软锁）**：`dungeon-map-system.js shutdown()` 新增强制调用 `BossRewardSystem.cleanup()` 与 `CombatRoomSystem.cleanupRoom()`（此前全项目无调用方，下次 BOSS 战 `start()` 因 active===true 直接 return，玩家困死）。
- **修复 3（宝箱材料 25% TypeError）**：`dungeon-event-system.js:822` 材料分支改 `for (const item of (outcome.rewards || outcome.items || []))`（JSON 用 items、DEFAULTS 用 rewards，兼容两键）。
- **修复 4（召唤物战斗后泄漏）**：`game.js` 新增 `removeEntitiesByPrefix(...prefixes)`（经 removeEntity、跳过存活尸体）；`combat-room-system.js` 的 `cleanupMonstersOnly`/`cleanupRoom` 与 `boss-reward-system.js cleanup` 按前缀兜底清理（zombieDog_ / amalgam_fat_ / amalgam_zombie_）。
- **测试结果**：`npm run lint` ✅；`npx vite build` ✅；`node scripts/test-collider.mjs` ✅。
- **已知问题**：实机待验证——①击败 Boss 后节点变 empty、可进奖励节点；②Boss 战中死亡重进地牢 BOSS 战正常开启；③宝箱材料分支正常发奖；④召唤犬/集合体召唤物在战斗结束后不再残留。

## 2026-07-17（新增地牢：僵尸地牢-初级）

### 对话：第二个地牢接入出征系统 + 生成器节点数修正（v0.198+）
- **需求**：新增"僵尸地牢-初级"——22 房间、最短路线 ≥7 节点、起始 3 线路、7 节点最少 3 战斗、整体战斗 40%、精英 0%、boss 战为精英战斗独立副本、出征模式可选。
- **配置（data/dungeon-config.json，零硬编码）**：
  - `dungeonList`：两个地牢的出征展示元数据（名称/节点数/战斗比/等级/奖励），驱动出征界面选项与信息面板。
  - `zombieDungeonBeginner`：nodeCount 22/22、shortestCombatPath 7（boss 第 8 列）、mainRowMinCombat 3、typeRatios 0.40/0.60、eliteCombatChance 0、grid rows 3/mainRow 1、bossEncounter（1 波 × 精英1+普通5，精英遭遇独立副本）。
- **代码改动**：
  - `src/config/dungeon-config.js`：`_keyFor` 类型→配置键映射；`getZombieDungeonConfig/getZombieEncounterConfig/getEliteCombatChance` 支持按地牢类型读取；新增 `getBossEncounterConfig`、`getDungeonList`。
  - `src/world/zombie-dungeon.js`：`ZombieDungeonMapGenerator` 接受 dungeonType（读对应配置键）；新增 `mainRowMinCombat`（主通道随机 N 列强制战斗，缺省=shortestCombatPath 向后兼容）；精英概率按类型读取；`ZombieDungeonCombat` 第 3/4 参支持 encounterOverride 与 dungeonType。
  - **生成器修正**：第 1 列强制全行移到节点数调整**之前**（此前在之后，强制的补行使总数超出配置区间）；`_adjustNodeCount` 增删候选排除第 1 列（保证起始分支数恒定）。主地牢回归 1000 次通过（35~40/4 分支）。
  - `src/world/dungeon-map-system.js`：`dungeonName` 改读 dungeonList；新增 `_isZombieFamily()`（zombie/zombieBeginner 共享僵尸战斗波次体系）替换 3 处 `=== 'zombie'` 判断；`generateMap`/`_enterZombieCombat` 传 dungeonType；`_enterBoss` 对 zombieBeginner 走 `_enterBossCombat`（bossEncounter + 普通战斗/波次/传送门流程，完成→奖励节点→胜利）；`_markCurrentNodeCompleted` 移除 boss 排除（arena boss 不经此路径，无影响）。
  - `src/ui/expedition-system.js` + `src/ui/panels/hud-panels-expedition-quest-reward.js`：出征地牢选项与信息面板改由 dungeonList 驱动。
- **验证**：JSON 校验通过；生成器约束仿真 1000 次（22 节点/3 分支/主通道≥3 战斗/平均战斗占比 42.4%）全过；主地牢回归仿真 1000 次通过；`npm run lint` ✅；`npx vite build` ✅；`node scripts/test-collider.mjs` ✅。
- **过程备注**：初期复现测试曾报 2% 节点数异常，最终定位是复现脚本自身的内联随机 bug（`filter(r => r !== arr[rand()])` 每元素重掷），真实代码先取 `remove` 再过滤，无此问题。
- **已知问题**：实机待验证——①出征界面出现"☠ 僵尸地牢-初级"选项并可进入；②22 房地图布局/3 分支/事件背景图；③boss 节点刷出 精英1+普通5 战斗房，完成后奖励节点→胜利；④主地牢不受影响。

## 2026-07-17（集合体贴图与碰撞体积 ×3）

### 对话：集合体 spriteSize 220→660，碰撞同步放大（v0.198+）
- **修改文件**：`data/enemy-config.json` amalgamZombie——`size` 40→120、`collisionRadius` 40→120（footprint/阴影/分离/命中椭圆同源随动）、`render.spriteSize` 220→660、`render.collisionWidth/Height` 100×180→300×540、`render.footOffsetY` 103→309（随贴图比例）、`render.projectileHitbox` 120×190→360×570。
- **未动**：攻击 AOE 半径（投掷 45、砸地 100/200/500、触发 250、召唤 150）为用户此前明确设定的数值，不属"碰撞体积"，如需随体型放大请明示。
- **测试结果**：enemy-config.json 校验通过；`npm run lint` ✅；`npx vite build` ✅；`node scripts/test-collider.mjs` ✅。
- **已知问题**：实机待验证——660px 贴图在 1024 BOSS 场地中的视觉比例、投掷起始点（随 footOffsetY 309 上移）。

## 2026-07-17（集合体移动根因：falsy-0 速度回退 + 锚点钉死）

### 对话：集合体第三次报"还是会移动"——根因定位与系统级修复（v0.198+）
- **根因**：移动代码普遍使用 `maxSpeed || speed || 100` 逻辑或回退——`0` 是假值，speed 0 被当作"未配置"而回退到 **100**！集合体每帧实际以 ~100×accel 的速度被 `Enemy._updateMovement`（enemy.js:527）和 MovementSystem 七处路径驱动。前三次修复（锁 vx/knockback、noSeparation、_tryUnstuck 跳过、applyKnockback 空覆盖）都正确但都没堵住这条主通道。
- **修改文件**：
  - `src/systems/movement-system.js`：7 处 `enemy.maxSpeed || enemy.speed || 100` → `enemy.maxSpeed ?? enemy.speed ?? 100`（空值合并，0 被保留；仅 undefined/null 才回退——speed 字段在构造函数必有值，旧配置语义不变）。
  - `src/entities/enemy.js::_updateMovement`：同样 `||` → `??`（:527）。
  - `src/entities/enemy-types/amalgam-zombie.js`：新增出生点锚定——构造函数记录 `_anchorX/_anchorY`，`update()` 每帧强制 `this.x/y = 锚点`（强制显性编码的兜底保险，任何未来新增位移通道都无法让其离锚）。
- **教训（写入记忆）**：**speed 0 的语义陷阱**——一切 `xxx || fallback` 对数值 0 都会误回退；数值回退必须用 `??`。本次替换安全：speed/maxSpeed 在 Enemy 构造函数必被赋值，`||` 原本只在显式 0（或 NaN）时触发。
- **测试结果**：`npm run lint` ✅；`npx vite build` ✅；`node scripts/test-collider.mjs` ✅。
- **已知问题**：实机待验证——集合体彻底纹丝不动（本次为根因级修复）。

## 2026-07-17（集合体移动/投掷物/刷点三修复）

### 对话：集合体仍会移动 + 投掷物不可见 + 生成点错位（v0.198+）
- **问题1（集合体仍移动）**：非"40 最低速度"冲突（代码库无此钳制）。第四位移通道：`MovementSystem._tryUnstuck` 的触发条件是"有速度 或 有目标且距离 > attackRange"，集合体 speed 0 但目标在 120px 外 → 被判"尝试移动但 30 帧无位移"→ 周期性瞬移。修复：`_tryUnstuck` 开头跳过 speed/maxSpeed 均为 0 的站桩单位（通用机制）。另 `AmalgamZombie` 覆盖 `applyKnockback` 为空（击退永不累积，杜绝任何时序缝隙）。
- **问题2（投掷物不可见）**：`project.png` 是 512×512 帧中仅 81×79 的内容（15.8%），`setDisplaySize(48,48)` 缩放整帧 → 实际可见内容仅 ~7.6px。修复：用脚本将 `assets/enemies/amalgam/project.png` 裁剪至内容 bbox（81×79），配置 `projectileSize` 48→64。
- **问题3（生成点错位）**：`WallSystem.resolve` 真实签名为 `(x, y, nx, ny, r)` 五参，此前按三参调用 → ny/r 为 undefined → 返回错误坐标（且 `typeof NaN === 'number'` 绕过了旧守卫）→ 胖子僵尸/召唤僵尸刷到错误位置。修复：投掷落点与召唤落点统一改为 `canMoveTo` 校验 + `findSafeSpawn` 螺旋外推 + `Number.isFinite` 守卫。
- **修改文件**：`src/systems/movement-system.js`（_tryUnstuck 站桩跳过）、`src/entities/enemy-types/amalgam-zombie.js`（applyKnockback 空覆盖 + 两处生成点修正）、`data/enemy-config.json`（projectileSize 64）、`assets/enemies/amalgam/project.png`（裁剪）。
- **测试结果**：enemy-config.json 校验通过；`npm run lint` ✅；`npx vite build` ✅；`node scripts/test-collider.mjs` ✅。
- **已知问题**：实机待验证——①集合体有目标时纹丝不动（不再瞬移）；②投掷可见 64px 投射物抛物线飞行；③胖子僵尸/召唤僵尸刷在警示圈/集合体下方正确位置。

## 2026-07-17（集合体强制站桩锁死）

### 对话：修复集合体 speed 0 仍可移动（v0.198+）
- **根因**：speed 0 只关闭自驱移动，仍有三个位移通道——①实体分离（`game.js resolveCollisions` 对重叠双方各推一半位移，与 speed 无关，召唤的僵尸会把集合体挤走）；②击退速度 `vx/vy`；③击退累积 `knockbackX/knockbackY`（damageable-entity `applyKnockback`）。
- **修改文件**：
  - `src/entities/enemy-types/amalgam-zombie.js`：**强制显性编码**——构造函数锁死 `speed/maxSpeed/vx/vy/knockbackX/knockbackY = 0` 并设置 `noSeparation = true`；`update()` 每帧再将 `vx/vy/knockbackX/knockbackY` 归零。
  - `src/game.js resolveCollisions`：新增 `noSeparation` 语义——不可分离单位自身纹丝不动，由对方承担全部重叠位移；双方均不可动则跳过（通用机制，未来站桩单位可复用）。
- **测试结果**：`npm run lint` ✅；`npx vite build` ✅；`node scripts/test-collider.mjs` ✅。
- **已知问题**：实机待验证——集合体被打/被召唤僵尸挤时纹丝不动，僵尸环绕时由僵尸让位。

## 2026-07-17（集合体首领完整接入 + BOSS战重构）

### 对话：集合体精灵图/技能/BOSS战替代大块头/主神空间测试（v0.198+）
- **素材（规则 4 + 4.8 处理）**：`assets/enemies/amalgam/`——idle 14 帧 / attacking 32 帧（砸地）/ attacking-2 25 帧（投掷）/ melting 28 帧，经 `scripts/archive/prepare-amalgam-sprites.py`（隔离 venv `.venv-sprites` 装 Pillow 运行）统一内容高度 ~480px、底部对齐 496、水平居中、宽限 500px；`project.png`（投掷物）原样复制。
- **新增 `src/entities/enemy-types/amalgam-zombie.js`**（数值全部来自 enemy-config.json `attackSkills`/`deathAnim`/`render`，类内零硬编码）：
  - 站桩 Boss（speed 0 显式生效），面朝目标；`aiInterval = MAX_SAFE_INTEGER` 关闭通用近战（同 mutant-3 模式），攻击全由类自管。
  - 攻击状态一（throw 投掷）：25 帧动画 2s，第 16 帧（1.2s）向锁定落点抛出投射物（project.png，600ms 抛物线）；投掷前至落地在落点显示红色椭圆警示（45px，`AttackRangeEffect` 逐帧保活）；落地 GroundEllipse(45) 物理伤害（atk×1.0），并在落点生成一只胖子僵尸（工厂注入 `_createFatZombie`）。
  - 攻击状态二（slam 砸地）：32 帧动画 2s，第 7/12/17/20/24/27 帧分圈结算——100px→atk×1.2、200px→atk×0.7、500px→atk×0.2（GroundEllipse 各自判定，取目标所在最小圈，不叠加）；冷却 7s、触发距离 250px。
  - 特殊技能（summon 召唤）：冷却 15s，非攻击状态时于下方 150px 召唤 2 只僵尸（工厂注入 `_createBasicZombie`），播放 idle 动画不打断攻击。
  - 死亡：melting 2.8s + 停最后一帧（27）2s 后销毁；`_preserveCorpse` 驱动尸体更新链。
- **BOSS 战重构（`boss-reward-system.js`）**：
  - 集合体替代大块头：`_spawnBoss` 改用 `AmalgamZombie`（enemy-config 数值 + 永久警戒，注入两个生成工厂）；删除 `createBigBossClass`（~530 行）、`getBigBossClass`、`window.BigBoss`、`BOSS_REWARD_CONFIG.boss`、`Enemy`/`Renderer`/`CONFIG` 闲置导入。
  - 场地重构：`arena.size` 4096→**1024**，新增 `playerFromBottom: 300`（玩家生成于最下方中心上移 300px）与 `bossFromTop: 300`（集合体上方中心镜像对齐）；`_placePlayer` 去随机边改为固定下方中心；地板改用与战斗房相同的黑砖拼铺。
  - `zombie-dungeon.js`：`createFatZombie` 补 `export`（供 Boss 战注入）。
- **共享模块 `src/world/dungeon-floor-texture.js`（新）**：地板烘焙唯一实现（`bakeDungeonFloor` + `applyDungeonFloor`），`combat-room-system._generateTerrain` 重构为调用它——战斗房与 Boss 场地同一地板，规则 1 去重。
- **其他**：`BootScene` 加载/注册 5 张集合体贴图动画；`enemy-types.js` 导出 `AmalgamZombie`；`enemy-sprite-tool.js` 列表 bigBoss→amalgamZombie；`game.js` 新增 `spawnMainAmalgam()`（主神空间测试，注入两工厂）并在初始化与返回主神空间两处注册；`dungeon-map-system.js` 注释同步。
- **测试结果**：enemy-config.json 校验通过；`npm run lint` ✅（0 警告）；`npx vite build` ✅；`node scripts/test-collider.mjs` ✅。
- **已知问题**：实机待验证——①主神空间集合体 idle/投掷（警示圈/落点伤害/生成胖子）/砸地分圈伤害/15s 召唤；②地牢 BOSS 战 1024 场地、出生点镜像、黑砖地板；③死亡 melting 动画与尸体消失时机。投掷/砸地动画 2s 时长与 BootScene 注册 duration 为两处维护（既有约定，改动需同步）。

## 2026-07-17（新增首领僵尸「集合体」）

### 对话：新增 boss 级僵尸 amalgamZombie + 显式战斗属性机制（v0.198+）
- **需求**：首领级僵尸"集合体"，HP 5000、物理攻击 60、魔法攻击 0、防御/魔法防御与僵尸巫师差不多、移动速度 0。
- **关键发现**：
  - `enemy.js:37` 旧守卫 `if (this.speed < 1) this.speed = 45` 会把显式 speed 0 强制改 45。
  - matk=0 与 mdef≈巫师(58) 在六维公式下互斥（matk=floor((int+wis)×0.5)=0 要求 int+wis≤1，而 mdef 靠 wis×1.2 驱动）。
  - 僵尸巫师实际面板：def=48、mdef=58（combat-formulas.json enemy 段公式）。
- **修改文件**：
  - `src/entities/enemy.js`：
    - speed 守卫改 `if (this.speed > 0 && this.speed < 1) this.speed = 45`——显式 0 = 站桩单位生效，旧相对值（0.2 类）修正逻辑保留。
    - 构造函数新增显式战斗属性覆盖（仅 `atk/matk/mdef`，与现有 hp/maxHp 显式覆盖同模式）；**不含 def**——现有 3 条配置（胖子 25/僵尸 7/毒液 10）的 def 字段一直未生效（公式驱动），激活会改变旧怪平衡，故排除并注释说明。
  - `data/enemy-config.json`：新增 `amalgamZombie`（集合体）：rank boss、type 首领、family 僵尸；hp/maxHp 5000（显式覆盖公式）；speed 0；六维 str100/dex20/con12/int0/wis1/luck5——使 atk=60、def=48、matk=0 由公式自然得出；`mdef: 58` 显式覆盖（公式值仅 1）；attackRange/attackDistance 120、thrust cooldown 2000/dynamicRange 140/width 30/knockback 20；collisionRadius 40；level 7（公式值）。
- **数值验证（node 公式模拟）**：HP 5000 ✓ / atk 60 ✓ / matk 0 ✓ / def 48（=巫师）✓ / mdef 58（=巫师）✓ / speed 0 ✓；对照巫师 atk 15/matk 37。
- **测试结果**：enemy-config.json JSON 校验通过；`npm run lint` ✅；`npx vite build` ✅；`node scripts/test-collider.mjs` ✅。
- **已知问题/后续**：
  - 集合体目前仅有配置（图鉴可见），**不会在任何战斗中生成**——BOSS 节点战斗用的是 boss-reward-system 固定"大块头"类，boss rank 配置池未接入；如需让集合体成为僵尸地牢 BOSS，需要另做 boss 池接线（下次任务）。
  - 无精灵图素材，渲染回退 `enemy_circle` 占位；提供素材后按规则 4 建档接入。
  - 站桩单位仍可能受击退/分离位移（未做 immovable），需要的话后续加。
  - boss rank 的 `getExpValue` 无双倍（仅 elite×2），当前击杀经验 = 10+7×5 = 45。

## 2026-07-17（尸体保留修复 + 技能public副本同步 + 背景图cover）

### 对话：胖子尸体不被波次强清 + 技能经验第二断点 + 背景图 cover + 地牢机制汇报（v0.198+）
- **任务2 根因（尸体波次推进即消失）**：上一轮修复让 `cleanupMonstersOnly()` 波次切换时经 `removeEntity` 连实体带贴图一起删除，尸体被强制清除，违背"尸体保留持续造成伤害"的设计。
- **任务3 根因（技能经验仍不累积）**：运行时 `window.SKILL_DATA` 来自 `fetch('/data/skills.json')`，Vite 实际提供 `public/data/skills.json`——该副本是过期旧版（仅 11 技能，缺 dashAttackFire/shotgunMastery/iceSpike/shieldDefense/fireball/nightFlame，且全部无 expRewards）。上一轮修 `buildSkillFromJSON` 补字段正确，但数据源是旧副本故仍未生效。**钩稽提醒**：skills.json 与 equipment.json 一样存在 data/ ↔ public/data/ 双份，今后改技能数据必须双份同步。
- **修改文件**：
  - `src/game.js`：新增共享判定 `isPreservedCorpse(entity)`（与实体更新循环同口径：`_preserveCorpse && !active && (deathAnimTimer>0 || corpseTimer>0)`）。
  - `src/world/combat-room-system.js`：`cleanupMonstersOnly()`、`cleanupRoom()` 清理循环命中存活尸体时跳过删除。
  - `src/world/dungeon-map-system.js`：`_cleanupCombat()` 同样跳过。
  - `public/data/skills.json`：用 `data/skills.json` 覆盖同步（11 → 17 技能，expRewards 齐全，已校验两份一致）。
  - `src/world/dungeon-event-system.js`：`_createEventBgLayer` 的 `background-size: auto` 改为 `cover`（等比铺满全屏、不变形、无黑边，边缘少量裁切；用户已选此方案）。
- **效果**：
  - 胖子僵尸尸体不再被波次推进/离开房间强制清除，按自身计时器走完生命周期（腐蚀光环持续伤害、7.5s 自毁贴图、8s 扫描移除）；地图模式下计时器冻结、贴图随敌人组隐藏，进下一战斗房后继续。
  - 步枪精通等全部技能恢复经验累积；冰锥/火球/盾防/霰弹精通/冲刺攻击-火/夜与火 6 个曾缺失技能恢复出现。
  - 僵尸地牢及所有地牢事件背景图 cover 铺满（同一共享函数，强绑定全场景）。
- **bottom 固定像素审计（无改动）**：NPC 立绘（bottom:200/220px）、事件面板×2（bottom:88px）、事件背景层（bottom:0）、右下通知栈（bottom:20px）、dev toast（bottom:100px）均合规；场景标签（top:210px）/提示 toast（top:30%）/居中对话框属瞬态通知，设计豁免。
- **测试结果**：public/data/skills.json 与 data 版一致性校验通过；`npm run lint` ✅；`npx vite build` ✅；`node scripts/test-collider.mjs` ✅。
- **已知问题**：实机待验证——①多波次战斗胖子尸体波次切换后保留并持续腐蚀、7.5s 后消失；②步枪精通击杀/暴击经验累积升级、6 个曾缺失技能出现；③事件背景图 cover 铺满无黑边。

## 2026-07-17（配置全场景生效 + 事件面板/旧5事件图 + 经验与被动技能）

### 对话：毒液/胖子配置修复 + 事件背景图调整 + 经验翻倍/升级回满/被动技能修复（v0.198+）
- **任务1 根因**：①`enemy.js` 从未映射 `attackDistance`（死配置，胖子实际按 115 触发）；②`GameScene._configureEnemyBody` 无条件用矩形推导覆盖 `collisionRadius`（毒液实际 footprint 45，配置 7.07 从未生效；巫师 45/普通僵尸 25/突变体 45 同病）。
- **任务4 根因（被动技能无法升级）**：`DataLoader.buildSkillFromJSON` 构建技能对象漏拷 `expRewards` → 所有 `add*Exp` 计算 gained=0 → 全部技能（含所有武器精通）永不获得经验；skills.json 数据齐全、击杀/暴击路由正常，唯一断点即构建器。
- **修改文件**：
  - `src/entities/enemy.js`：构造函数新增 `this.attackDistance = config.attackDistance` 映射 → 胖子僵尸真正只在 100 攻击范围发动攻击；普通僵尸 attackDistance 100 同步激活。
  - `src/phaser/scenes/GameScene.js::_configureEnemyBody`：collisionRadius 改配置优先（仅未配置时矩形推导）→ 毒液 45→7.07、巫师 45→20、普通僵尸 25→15、突变体3 45→20（回归设计配置值；胖子 30/僵尸犬 40 不变）。
  - `spitter-zombie.js` / `zombie-wizard.js`：`_getPhaserOptions` 硬编码 30×90 改读 `config.render`（32×79 / 61×109，缺省兜底）。
  - `assets/scenes/dungeon-events/`：新增 5 张旧事件图（goddess-statue/trap/supply-pile/treasure-chest/demon-statue，复制自素材库，共 15 张）。
  - `dungeon-event-definitions.js`：`NEW_EVENT_BG_IMAGES` 重命名为 `EVENT_BG_IMAGES` 并追加 5 个旧事件键；`dungeon-event-system.js` 导入同步。
  - `dungeon-event-system.js`：背景层改为 `background-size: auto; position: center`（原图比例/大小不变居中平铺，其余纯黑）；事件/结果面板去硬编码宽度（`left:151px; right:151px; bottom:88px; height:243px` 固定像素、随视口全宽拉伸，2K 不再只占一半）；选择副标题简化为 `检定<属性>-成功率<xx>%`（省略属性点数与长说明）。
  - `data/combat-formulas.json`：`player.expPerLevel.globalMultiplier` 2→4（升级所需经验整体翻倍，maxExp 重算同步）。
  - `subsystems.js gainExp`：升级循环内 `updateMaxStats()` 后 `d.hp=d.maxHp; d.mp=d.maxMp`（每级回满血蓝，连升同样生效）。
  - `data-loader.js buildSkillFromJSON` + `subsystems.js` fallback 构建器：补 `expRewards` 字段 → 全部技能恢复击杀/暴击经验获取。
- **测试结果**：combat-formulas.json 校验通过（globalMultiplier=4）；`npm run lint` ✅；`npx vite build` ✅；`node scripts/test-collider.mjs` ✅。
- **已知问题**：实机待验证——①地牢毒液 footprint/阴影明显变小、胖子 100 范围外不抬手；②事件背景原比例居中、2K 面板全宽、选择栏新格式；③旧 5 事件背景图；④升级回满血蓝、步枪精通击杀获得经验。技能经验恢复后升级节奏明显变化（此前全技能经验恒为 0），属修复本意。

## 2026-07-17（胖子尸体残留修复 + 地牢枪口同步 + 强绑定规则）

### 对话：两个场景差异 Bug 修复 + 新增强绑定工作规则（v0.198+）
- **Bug 1 根因（胖子僵尸死后黄色贴图残留）**：多波次战斗中一波全灭 1.5s 后 `CombatRoomSystem.cleanupMonstersOnly()` 直接 `Game.entities.delete(key)` 不销毁 `_phaserSprite` → 尸体 Sprite 成孤儿，`_updateCorpse` 随实体删除永不执行，黄色尸体在后续波次永久残留（单波房间等够 7.5s 会正常自毁，主神空间因场景切换清理而不显现）。
- **Bug 2 根因（地牢子弹不从枪口射出）**：地牢路线图模式把 `weaponSprite.setActive(false)`（GameScene.js），进入战斗房后 `syncWeapon` 每帧只恢复 `setVisible(true)`，全代码无任何 `setActive(true)` 恢复（玩家贴图有、武器没有）→ `_getMuzzleWorldPosition` 的 `sprite.active` 守卫失败返回 null → 回退脚底相对算法。主神空间不进地图模式所以正常。`_spawnShellCasing` 同病。
- **修改文件**：
  - `src/game.js`：新增统一实体移除入口 `removeEntity(key)`——删除前销毁 `_phaserSprite`/`_phaserLabel` 并调用 `_destroyPhaserSprite()`（如有），强绑定、场景无关。
  - `src/world/combat-room-system.js`：`cleanupMonstersOnly()`（核心泄漏点）与 `cleanupRoom()` 改用 `Game.removeEntity(key)`。
  - `src/world/dungeon-map-system.js`：`_cleanupCombat()` 怪物清理改用 `Game.removeEntity(key)`。
  - `src/world/boss-reward-system.js`：小怪（onDeath）、Boss（cleanup）、出口传送门（leaveBossBattle/cleanup 两处）共 4 处改用 `Game.removeEntity(key)`。
  - `src/phaser/scenes/GameScene.js`：`update()` 非地图模式分支追加武器/副手贴图 `setActive(true)` 恢复（与 playerSprite 恢复同模式，可见性仍由 syncWeapon 控制）。
  - `src/entities/player/subsystems.js`：`_getMuzzleWorldPosition` 与 `_spawnShellCasing` 守卫去掉 `!sprite.active` 条件（保留 visible/texture 检查，双保险）。
  - `WORKING-GUIDELINES.md`：新增**原则 10：修改强绑定全场景生效** + 提交检查清单对应项。
  - `docs/work-rules.md`：第一节最高优先级规则追加**规则 5** 同内容。
- **测试结果**：`npm run lint` ✅；`npx vite build` ✅；`node scripts/test-collider.mjs` ✅。
- **已知问题**：实机待验证——①地牢多波次战斗第一波杀胖子僵尸，尸体贴图在波次切换时消失；②地牢战斗房开枪子弹/蛋壳从枪口射出；③主神空间开枪枪口与胖子尸体 7.5s 自毁回归正常。

## 2026-07-17（僵尸地牢事件背景图 + 地形贴图替换）

### 对话：10 张事件背景图接入 + 3 张地形图替换（v0.198+）
- **素材（规则 4：先复制进项目再开发）**：
  - 新建 `assets/scenes/dungeon-events/`，从素材库复制 10 张事件背景图（3072×2048）并按事件键重命名为英文：collapsed-archway / undead-scholar-notes / blood-altar / misty-crossroad / cursed-armor / poison-mushroom-circle / abyssal-gambler / blessed-fountain / locked-armory / phantom-mirror。
  - `assets/terrain/blackbrick.png`、`blackbrick2.png`、`blackbrick3.png` 用素材库 3 张 512×512 新图覆盖替换（旧 256×256 图即被删除）；BootScene 加载键/路径不变。
- **修改文件**：
  - `src/world/dungeon-event-definitions.js`：新增导出 `NEW_EVENT_BG_IMAGES` 映射表（事件键 → 背景图路径，配置驱动；旧 5 事件无对应图片未配置，保持原样）。
  - `src/world/dungeon-event-system.js`：新增 `_createEventBgLayer(eventType)`——全屏背景层（`position:fixed; left:0; bottom:0; 100vw×100vh; background-size:100% 100%` 平铺拉伸，bottom 固定像素定位符合规则 3）；`_showEventUI` 与 `_showResultUI`（经 `this._currentEventType` 查表）均在面板之下插入背景层，有背景图时面板背景由 0.98 调为 0.85 半透明透出底图。
  - `src/world/combat-room-system.js`：新增 `FLOOR_TILE_DRAW_SIZE`（32-2=30，四边各内缩 1px → 相邻小砖留 2px 纯黑缝隙）与 `FLOOR_TILE_RADIUS`（4，圆角矩形裁剪，小砖边缘圆滑，`roundRect` 缺失时回退直角）；32 切分、8 随机朝向、均匀概率、相邻不同块、64px 外圈黑渐变、灰黑 tint 均不变；新图 512×512 由现有逻辑自动推导为 16×16=256 子块/图（候选池 768）。
- **测试结果**：`npm run lint` ✅；`npx vite build` ✅（仅已知动态导入警告）；`node scripts/test-collider.mjs` ✅。
- **已知问题**：
  - 实机待验证：事件全屏背景图与半透明面板观感；地牢地板圆角砖 + 2px 黑缝视觉。
  - 10 张背景图共约 65MB 原图，如需瘦身可后续在隔离环境批量缩放至 1920 宽。

## 2026-07-17（毒液判定缩小/胖子攻击触发/近战动画锁/怪物HP/地牢地板32×32）

### 对话：四项战斗与地牢调整（v0.198+）
- **修改文件**：
  - `data/enemy-config.json`：
    - `spitterZombie.collisionRadius` 10 → 7.07（脚部 footprint 椭圆判定**面积**减少 50%：面积 ∝ r²，故 r × √0.5 ≈ 0.707；groundRadius 为阴影/分离/命中判定唯一来源，随动缩小）；`hp/maxHp` 150 → 120。
    - `fatZombie` 新增 `"attackDistance": 100`（= attackRange）：胖子僵尸只有目标进入攻击范围才发动攻击（原触发距离为 attackRange × 1.15 = 115）。
    - `zombieDog.hp/maxHp` 60 → 100；`zombie.hp/maxHp` 100 → 120；`zombieWizard.hp/maxHp` 500 → 600。
  - `src/entities/player/update.js`：近战普通攻击增加输入闸门——攻击动画未播放完（`weaponAnim.state === 'attacking'`，三条近战 Tween 路径全覆盖）时忽略左键输入：不重播攻击动画、不产生新的攻击判定；冲刺攻击/弓箭/枪械分支不受影响。
  - `src/world/combat-room-system.js`：僵尸地牢地板由 256×256 整图平铺改为将三张 blackbrick 源图切割为 32×32 子块（3 × 8 × 8 = 192 块候选池）随机拼铺；每块随机 8 种朝向（4 旋转 × 水平翻转，覆盖全部二面体群朝向），相邻（上/左）不使用同一子块；边缘黑渐变与灰黑 tint 逻辑不变，烘焙仍为一整张贴图（一次性开销）。
- **钩稽确认**：enemy-config.json 无 `public/` 副本（单源，Vite 打包导入）；地牢工厂 `zombie-dungeon.js` 与主神空间 `spawnMain*` 均展开 `...cfg` 继承配置，HP/判定改动自动生效；图鉴经 DataLoader 读同一配置自动同步。
- **测试结果**：enemy-config.json JSON 校验通过；`npm run lint` ✅；`npx vite build` ✅；`node scripts/test-collider.mjs` ✅。
- **已知问题**：
  - 毒液僵尸 collisionRadius 7.07 会同步缩小阴影/实体分离/近战地面判定（与 groundRadius 强绑定设计一致）；若只需缩小投射物椭圆判定需另提方案。
  - 实机待验证：胖子僵尸攻击触发距离手感、近战连点锁定手感、32×32 地板视觉。

## 2026-07-17（工作规则文档修订）

### 对话：删除过时规则 + 新增 4 条最高优先级规则
- **修改文件**：
  - `docs/work-rules.md`：整体重写。删除 legacy.js 单文件时代的全部过时内容（单文件架构禁令、legacy 备份命令、旧 DOM/CSS 限制、legacy 语境的对话迁移机制、旧命令速查）；保留仍有效的开发工作流、代码修改安全规则（数值保护/先注释后删/深拷贝/onmouseenter）、冒烟测试清单、沟通规则、质量门禁；备份命令更新为 `node scripts/backup.js`，验证三件套更新为 lint / build / test-collider。
  - `WORKING-GUIDELINES.md`：版本号更新为 V0.198+；新增原则 6-9；提交检查清单同步增加 4 项自查。
- **新增 4 条规则（与旧规则冲突时以新规则为准）**：
  1. 能不硬编码就不硬编码（数值/路径/坐标入配置，唯一真相源；改数值仍需用户确认）。
  2. 开发功能前注意冲突和钩稽关系（同步链路示例：equipment.json 双份、enemy-config ↔ 地牢工厂 ↔ 图鉴 ↔ BootScene、判定逻辑 ↔ 调试可视化）。
  3. 窗口贴图与实体生成固定显示统一使用 `bottom: 固定像素`。
  4. 素材先复制进项目 `assets/` 子文件夹再开展工作，禁止引用项目外路径。
- **测试结果**：纯文档改动，无代码变更，未触发 lint/build。
- **已知问题**：无。

## 2026-07-17（普通僵尸精灵图导入与主神空间测试生成）

### 对话：弹反恢复（旧木盾数据补全）+ 掉落物显示/拾取更新（v0.198+）
- **排查结论（弹反失效根因）**：ShieldSystem 代码、弹反窗口、角度判定、isMelee 传递、右键防御输入链路全部完好（WebBridge 运行时实测：有完整 defense 数据的盾牌可正常弹反——伤害归 0、眩晕 2000ms、击退）。真正缺陷是**装备数据**：`旧木盾`（初始盾牌）条目缺少 `weaponType: 'shield'` 和整个 `defense` 块，`checkEquipped()` 永远 false，盾系统完全不激活。与新体积判定无关。`小圆盾` 数据完整，工作正常。
- **排查结论（复活后子弹不从枪口射出）**：未复现。主神空间死亡与地牢死亡→switchScene 复活两条路径实测（手动泵游戏循环验证），武器贴图/可见性/枪口计算复活后全部完好，子弹路径（_fireRanged 贴图枪口）未被改动。暂停排查，待用户提供具体复现场景。
- **修改文件**：
  - `data/equipment.json` + `public/data/equipment.json`：`old_wooden_shield` 新增 `"weaponType": "shield"` 与 `defense` 块（base 15 / perEnhance 1.5 / damageReduction 0.5 / staminaCost 20 / parryWindow 1000 / parryStun 1000 / parryKnockback 100，数值与小圆盾一致，未改变任何弹反属性）。
  - `src/entities/drop-item.js`：掉落物贴图放大 50%（32→48 / 悬停 40→60），贴图保持上下浮动；装备文字固定在物品原位下方，**不再随贴图浮动**；悬停判定半径 35→52（×1.5 匹配）；`pickupRange` 30→45。
  - `data/game-config.json`：`interactionDistances.pickupHover` 35→52（点击/悬停拾取判定匹配）；`pickup.nearbyRange` 75→112（Z 键范围拾取匹配 ×1.5）。
  - `CHANGELOG.md`：本记录。
- **测试结果**：两份 equipment.json 与 game-config.json JSON 校验通过；`npm run lint` 通过；`npx vite build` 通过。
- **已知问题**：
  - 弹反实机验证：装备旧木盾，右键防御状态下被近战命中应触发"🛡️ 弹反！"+ 攻击者眩晕击退（弹反窗口 1 秒）。
  - 掉落物实机验证：贴图大小/浮动、文字静止、悬停拾取与 Z 键范围手感。
  - 复活枪口问题待复现线索（哪把枪、哪个场景、子弹出现位置截图）。

### 对话：地牢刷怪黑色粒子特效 + 删除金属/奔跑僵尸（v0.198+）
- **修改文件**：
  - `src/phaser/scenes/GameScene.js`：新增 `_ensureDungeonSpawnTexture()`（纯黑圆点 `dungeon_spawn_dot`）与 `playDungeonSpawnParticles(x, y)`——速度 30~90（更慢）、持续 1500ms（更久）、数量 16（多 30%）、纯黑 tint、NORMAL 混合（黑色在 ADD 下不可见）、gravityY −40 轻微上飘、1600ms 后销毁发射器。
  - `src/world/combat-room-system.js`：`spawnMonsters()` 每只怪生成后在最终脚底位置调用 `playDungeonSpawnParticles`（该方法仅被地牢 dungeon-map-system 调用）。
  - `data/enemy-config.json`：删除 `armoredZombie`（装甲/金属僵尸）、`runnerZombie`（奔跑僵尸）、`fastZombie`（"Runner Zombie" 遗留重复项）三条；图鉴经 DataLoader 读同一配置，自动同步删除。
  - `src/world/zombie-dungeon.js`：删除 `createArmoredZombie`、`createFastZombie`、`ZOMBIE_FACTORY_MAP` 对应两条；级联删除无人使用的 `createZombieFromConfig`；怪物池注释同步。
  - `src/ui/enemy-sprite-tool.js`：ENEMY_LIST 删除 fastZombie 条目。
  - `CHANGELOG.md`：本记录。
- **修改内容摘要**：
  1. 地牢战斗房刷新怪物时，每只怪脚下生成 1.5 秒纯黑粒子爆发特效。
  2. 金属僵尸（armoredZombie）与奔跑僵尸（runnerZombie/fastZombie）及其工厂、工厂映射、配置、精灵工具条目全部删除；地牢普通池现为：普通僵尸、僵尸犬、毒液僵尸、胖子僵尸。
  3. CHANGELOG / SKILL.md 历史记录未改动（保留历史事实）。
- **测试结果**：enemy-config.json JSON 校验通过（17 条）；全库无残留引用；`npm run lint` 通过；`npx vite build` 通过。
- **已知问题**：实机需验证刷怪粒子视觉（浓度/速度/上飘），数值在 `GameScene.playDungeonSpawnParticles` 可调。

### 对话：枪械蛋壳从贴图中心弹出并落至脚下（v0.198+）
- **修改文件**：
  - `src/effects/shell-casing.js`：构造/reset 新增可选 `groundY` 参数；传入时蛋壳先向上抛起（vy −120~−200）再受重力（1000 px/s²）落至脚下，未传入时保持旧贴地漂移行为（回退）。
  - `src/utils/effect-factory.js`：`createShellCasing` 透传 `groundY`。
  - `src/entities/player/subsystems.js`：`_spawnShellCasing` 新增 `hand` 参数，优先从对应武器贴图中心（`weaponSprite`/`offhandWeaponSprite`）弹出、落点为玩家脚底 `this.y`；无武器贴图时回退旧的脚底相对算法。4 个调用点（主手手枪/副手手枪/机枪/霰弹）同步更新。
  - `CHANGELOG.md`：本记录。
- **测试结果**：`npm run lint` 通过；`npx vite build` 通过。
- **已知问题**：实机需验证抛壳弧线手感（抛起高度/重力/侧向速度），数值在 `shell-casing.js` 的 `_initPhysics` 可调。

### 对话：六项战斗/视觉调整（v0.198+）
- **修改文件**：
  - `src/entities/enemy-types/fat-zombie.js`：`_updateLeanOffset()` 攻击分支归 0——胖子僵尸攻击时脚下阴影与 footprint 椭圆判定保持在脚底，不再前移（walk 前倾保留）。
  - `src/phaser/scenes/GameScene.js`：
    - `syncWeapon`（主手+副手）：远程武器贴图旋转改为 `atan2(鼠标世界坐标 − 武器位置)`，枪管精确穿过准心，消除手部锚点视差导致的固定角度偏移；近战不变。
    - `triggerZombieHitParticles`：受击绿色粒子锚点从脚底改为贴图中心（`y − footOffsetY`），保留朝向来源的侧向偏移。
  - `src/config/player-defaults.js`：`collisionRadius` 30 → 22.5，玩家脚下椭圆判定缩小 25%，阴影/分离/墙碰/被命中判定随动。
  - `src/entities/entity.js`：`groundRadius` 标注为阴影/footprint 椭圆/分离/墙碰与命中判定的**唯一来源**（强绑定约定注释）。
  - `src/physics/skill-shapes.js`：新增 `GroundSector`（地面扇形）与 `GroundDirectedRect`（地面有向矩形，含 backExtension）——只看目标 footprint，不查 Z，飞行单位免疫。
  - `src/combat/attack.js`：`SlashAttack` → `GroundSector`、`ThrustAttack.checkTriangleHit` → `GroundDirectedRect`，判定原点从"视觉身体中心"归回**攻击者脚底**（移除 footOffsetY 上移），范围可视化原点同步；推击/夜与火/冲刺技能/mutant-3 自定义攻击未动。
  - `scripts/test-collider.mjs`：新增 13 个地面形状用例。
  - `CHANGELOG.md`：本记录。
- **修改内容摘要**：
  1. 枪械（含双持副手）贴图朝向始终精准对准鼠标准心；弹道原本即朝准心，改后"贴图 = 弹道 = 准心"三者一致。
  2. 近战斩击/突刺判定从脚下椭圆出发平铺地面，判定与范围可视化、footprint 调试椭圆口径统一。
  3. 玩家 footprint 缩小 25%（30→22.5），阴影面积同步缩小（groundRadius 单一驱动）。
  4. 僵尸受击绿粒子从身体中心爆出，不再出现在脚下地面。
- **测试结果**：`node scripts/test-collider.mjs` 全部通过（累计 35 个用例）；`npm run lint` 通过；`npx vite build` 通过。
- **已知问题**：
  - 实机需验证：枪械各距离/垂直瞄准的贴图对准、近战范围圈与 footprint 的对齐手感、胖子攻击影子位置、粒子位置。
  - 近战判定原点下移后，攻击范围的屏幕位置整体下移一个 footOffsetY，若觉得"够不到上方目标"可再议 weaponOffset 前伸补偿。

### 对话：技能投射物接入躯干矩形判定（冰锥/火球/符文剑）（v0.198+）
- **修改文件**：
  - `src/physics/torso-hitbox.js`（新建）：躯干矩形**共享判定模块**——`getTorsoRect`（唯一推导口径：render.projectileHitbox，缺省 collisionWidth × 身高）、`segmentHitsTorso`（扫掠线段）、`pointHitsTorso`（逐帧点判定，FLYING 免疫与 GroundCircle 语义对齐）。
  - `src/combat/projectile.js`：`_hitTorsoRect` 改为调用共享模块，行为不变。
  - `src/entities/components/ice-spike-system.js`：冰锥飞行命中改为 GroundCircle ∪ 躯干矩形（r=12）。
  - `src/entities/components/fireball-system.js`：火球**飞行**命中改为 GroundCircle ∪ 躯干矩形（r=20）；爆炸 AOE（GroundCircle）未动。
  - `src/entities/components/rune-sword-system.js`：符文剑飞行命中改为 GroundCircle ∪ 躯干矩形（r=15）。
  - `src/phaser/scenes/GameScene.js`：绿色调试矩形改用共享模块推导，与判定口径一致。
  - `scripts/test-collider.mjs`：新增 10 个共享模块用例（推导/点判定/缺省/FLYING 免疫）。
  - `CHANGELOG.md`：本记录。
- **修改内容摘要**：
  1. 冰锥/火球/符文剑命中贴图身体位置（躯干高度）现在有效，与枪械同一判定口径。
  2. 判定推导集中在 torso-hitbox.js 一处，投射物/技能/调试可视化三方共用，无重复编码。
  3. 爆炸 AOE、近战判定未做任何改动。
- **测试结果**：`node scripts/test-collider.mjs` 全部通过（累计 22 个躯干用例）；`npm run lint` 通过；`npx vite build` 通过。
- **已知问题**：
  - 实机手感未验证：技能投射物躯干命中是否过宽，可用"范围"按钮绿矩形对照微调。
  - 无人机/旋风/推击/夜与光柱等 AOE 类技能维持原判定，未纳入（非投射物）。

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
