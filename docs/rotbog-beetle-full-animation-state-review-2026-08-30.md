# 独角仙王全部动画与状态机审查 — 2026-08-30

> 归档说明：本文记录修复前的静态审查快照；所列问题已在 [全面修复说明](rotbog-beetle-full-repair-2026-08-30.md) 对应的后续实现中处理。以下行号、状态与资源预算均按审查时版本理解。

结论：8种动画、249个有效帧以及全部自管状态入口已完成静态审查。发现8类代码问题，素材缺陷另列，并有2项资源风险。**本轮没有修改运行时代码、配置或正式素材，也没有执行游戏测试。**

范围为当前开发工作区的 `RotbogRhinocerosBeetleKingEnemy`、直接父类与控制/伤害/渲染/资源调用链。不把其他会话的改动纳入本轮成果，不代表固定EXE的实际内容。以下“确认”指代码路径或离线像素证据成立，未声称实机复现。

## 1. 优先修复的代码问题

### F1 · P2：石化中断分支在正式主循环中不可达

- 位置：[src/entities/enemy-types.js:4139](<E:/无尽轮回/长期备份/2026-7-13-1/game-dev/src/entities/enemy-types.js:4139>)、[src/game.js:1511](<E:/无尽轮回/长期备份/2026-7-13-1/game-dev/src/game.js:1511>)、[src/entities/damageable-entity.js:599](<E:/无尽轮回/长期备份/2026-7-13-1/game-dev/src/entities/damageable-entity.js:599>)、[src/entities/damageable-entity.js:1583](<E:/无尽轮回/长期备份/2026-7-13-1/game-dev/src/entities/damageable-entity.js:1583>)。
- 独角仙在自己的 `update` 中检查石化并试图取消冲锋/召唤/开鞘，但主循环对石化敌人直接调用 `updateWhilePetrified` 后跳过子类update。
- `applyPetrify` 只作废普通近战并调用可选中断钩子；独角仙没有实现该钩子或石化专用更新。因此 `_chargeState/_summonActive/_phaseOpening` 及其剩余时间被保留下来。
- 结果：**石化期间不会继续结算这些技能，但石化结束后会恢复原动作，未释放的召唤也会继续释放**，与现有“控制打断未释放动作”的合同不符。
- 修复方向：在共用控制回调或石化入口取消逻辑动作，保留石化显示帧；继续调用公共状态/DoT更新，不重复发放冷却。

### F2 · P2：玩家突刺眩晕和束缚遗漏在自管冲锋门禁之外

- 位置：[src/entities/enemy-types.js:4139](<E:/无尽轮回/长期备份/2026-7-13-1/game-dev/src/entities/enemy-types.js:4139>)、[src/entities/enemy-types.js:4175](<E:/无尽轮回/长期备份/2026-7-13-1/game-dev/src/entities/enemy-types.js:4175>)、[src/entities/enemy-types.js:4348](<E:/无尽轮回/长期备份/2026-7-13-1/game-dev/src/entities/enemy-types.js:4348>)。
- 玩家突刺会直接设置 `_dashStunned`（[src/entities/components/dash-system.js:533](<E:/无尽轮回/长期备份/2026-7-13-1/game-dev/src/entities/components/dash-system.js:533>)），独角仙的控制判断与技能就绪判断都没检查该字段；它仍可能继续推进冲锋/召唤/开鞘。
- `bind` 只在外部 MovementSystem 阻止普通移动（[src/systems/movement-system.js:240](<E:/无尽轮回/长期备份/2026-7-13-1/game-dev/src/systems/movement-system.js:240>)）。独角仙在外部系统之前直接改写 `x/y`，所以已发动的冲锋仍能穿过束缚的移动限制。
- 修复方向：区分硬控和“只禁位移”的束缚，不要把束缚误改成不能攻击/召唤。

### F3 · P2：冲锋恢复阶段覆盖眩晕待机

- 位置：[src/entities/enemy-types.js:4150](<E:/无尽轮回/长期备份/2026-7-13-1/game-dev/src/entities/enemy-types.js:4150>)、[src/entities/enemy-types.js:4317](<E:/无尽轮回/长期备份/2026-7-13-1/game-dev/src/entities/enemy-types.js:4317>)、[src/entities/enemy-types.js:4380](<E:/无尽轮回/长期备份/2026-7-13-1/game-dev/src/entities/enemy-types.js:4380>)、[src/entities/enemy-types.js:4403](<E:/无尽轮回/长期备份/2026-7-13-1/game-dev/src/entities/enemy-types.js:4403>)。
- `controlled && state !== recovery` 特意放行恢复段，而 `_updateCharge` 入口无条件写回 `_animState='charge'`。
- 撞墙会先 `applyStun(600)` 再进入500ms恢复；弹反也先让公共入口切idle，随后 `result.hit` 又进入恢复。下一次更新会在仍眩晕时重新显示charge。
- 结果：出现“已被控制，却又播放冲锋姿态/重启冲锋片段”的视觉冲突；恢复中恐惧也会被重新置上的施法冻结挡住逃跑。
- 修复方向：恢复计时与受控视觉解耦，不让恢复状态覆盖公共控制姿态。

### F4 · P2：冲锋逻辑与动画使用独立时钟，提前命中截断收势

- 位置：[src/entities/enemy-types.js:4278](<E:/无尽轮回/长期备份/2026-7-13-1/game-dev/src/entities/enemy-types.js:4278>)、[src/entities/enemy-types.js:4321](<E:/无尽轮回/长期备份/2026-7-13-1/game-dev/src/entities/enemy-types.js:4321>)、[src/entities/enemy-types.js:4411](<E:/无尽轮回/长期备份/2026-7-13-1/game-dev/src/entities/enemy-types.js:4411>)、[src/entities/enemy-types.js:4421](<E:/无尽轮回/长期备份/2026-7-13-1/game-dev/src/entities/enemy-types.js:4421>)、[src/entities/enemy-types.js:4120](<E:/无尽轮回/长期备份/2026-7-13-1/game-dev/src/entities/enemy-types.js:4120>)。
- 逻辑使用准备900ms、冲锋1000ms、恢复500ms；视觉始终从0播放固定2400ms的Phaser动画，没有按当前逻辑阶段/累计时间选帧。
- 提前命中立即启动固定500ms恢复，结束后强制idle。例如约第1000ms命中，约第1500ms就切idle，视觉后约900ms的帧段没有机会播放；这500ms内仍可能在播奔跑段。
- 准备段跨界dt直接丢弃、下一段从完整时长重新计时，也会造成阶段误差。普通攻击/召唤/开鞘同样使用逻辑事件时钟配合独立Phaser时钟；资源迟到或视口外开始动作时无法恢复到当前进度。
- 修复方向：各动作以逻辑累计时间为唯一进度源，明确命中/撞墙/硬控对应的停止位移与收势规则，不修改伤害数值来掩盖时钟问题。

### F5 · P2：横扫被弹反后，仍继续结算同次范围攻击的其他目标

- 位置：[src/entities/enemy-types.js:4225](<E:/无尽轮回/长期备份/2026-7-13-1/game-dev/src/entities/enemy-types.js:4225>)、[src/entities/enemy-types.js:4236](<E:/无尽轮回/长期备份/2026-7-13-1/game-dev/src/entities/enemy-types.js:4236>)。
- `DamagePipeline.applyHit` 可以同步触发盾牌弹反，公共入口已将 `_pendingThrust` 作废/清空（[src/entities/components/shield-system.js:111](<E:/无尽轮回/长期备份/2026-7-13-1/game-dev/src/entities/components/shield-system.js:111>)）。
- 当前循环仍持有旧的 `pending`，返回后只检查 `result.hit`，不检查动作是否仍有效、攻击者是否受控，随后继续对后面的友军造成伤害。
- 触发条件：玩家在候选顺序中先被处理并成功弹反，横扫范围里还有后续友军。
- 修复方向：每次伤害回调后立即核对原动作身份和中断状态，终止剩余目标结算；保留已结算目标结果。

### F6 · P2：开鞘后的移动与技能素材状态不完整

- 位置：[src/entities/enemy-types.js:4103](<E:/无尽轮回/长期备份/2026-7-13-1/game-dev/src/entities/enemy-types.js:4103>)。
- `_phaseOpened` 只把idle/walk/run映射到 `enraged_idle`，该20帧素材主要是开翅待机，未提供与移动速度相符的腿部行走循环。
- attack、charge、summon、dying仍直接使用合翅素材。因此开鞘后移动会出现滑步，发动技能时突然合翅，技能结束又立即开翅；阶段标记实际始终为true。
- 修复方向：需要明确开鞘形态应有哪些动作。可复用的过渡与缺少的素材分别列出，不能仅把所有动作改名映射为idle。

### F7 · P2：动作切换时脚点迟一帧更新

- 位置：[src/entities/enemy-types.js:1730](<E:/无尽轮回/长期备份/2026-7-13-1/game-dev/src/entities/enemy-types.js:1730>)、[src/phaser/scenes/GameScene.js:3370](<E:/无尽轮回/长期备份/2026-7-13-1/game-dev/src/phaser/scenes/GameScene.js:3370>)、[src/phaser/scenes/GameScene.js:13367](<E:/无尽轮回/长期备份/2026-7-13-1/game-dev/src/phaser/scenes/GameScene.js:13367>)。
- 场景先按旧 `footOffsetY` 设置Sprite位置，随后 `_getPhaserOptions` 才根据新动作的 `footY` 更新偏移；尺寸同步不会重设位置。
- 独角仙各状态脚线差距较大：idle525、phase_open580、enraged_idle581、dying482。按420/640显示比例，进入开鞘可差约36个世界显示单位，开鞘转死亡可差约65个单位（屏幕值还要乘镜头缩放）。
- 结果：切换帧与下一帧存在垂直跳动风险。它独立于视频自身Y轨迹，不能用逐帧拉直视频来修。
- 修复方向：在本怪的状态切换入口先同步该动作的几何指标，再让场景定位。

### F8 · P2：死亡状态别名绕过“尸体不重播”判断

- 位置：[src/entities/enemy-types.js:4104](<E:/无尽轮回/长期备份/2026-7-13-1/game-dev/src/entities/enemy-types.js:4104>)、[src/phaser/scenes/GameScene.js:13473](<E:/无尽轮回/长期备份/2026-7-13-1/game-dev/src/phaser/scenes/GameScene.js:13473>)。
- 本怪渲染返回 `animState='dying'`，而共用播放分支仅对 `animState==='death'` 且死亡计时已结束时禁止重播。
- 死亡发生在视口外、素材迟到或Sprite重建后，如果尸体仍处于1400ms保留期，回到视口会从第0帧启动dying，而不是显示倒地末帧，随后还可能在播完前被尸体计时清除。
- 正常持续可见的死亡路径有1800ms动画+1400ms留尸和父类防重复死亡保护；问题集中在离屏/迟加载/重建分支。
- 修复方向：按实体死亡生命周期判断，保留期直接钳住最后一帧，不依赖单一状态名。

## 2. 全部素材检查

上面的F1～F8是8类代码问题。素材缺陷另列，不把“有249帧内容”误当画质通过。下面每行都已查看全部有效帧联系图；帧号统一0-based。

| 动作 | 有效帧/时长 | 离线素材发现 | 基础RGBA | 证据 |
|---|---|---|---:|---|
| idle 待机 | 30 / 2000ms循环 | 轮廓与腿部青紫边；源关键帧与中间帧锐度不同 | 50 MiB | [全部帧](<C:/Users/allan/.codex/visualizations/2026/08/30/01a052d0-236e-7bc3-80af-b53597574b8a/beetle-full-review/idle-all-frames.png>) |
| walk 移动 | 40 / 2000ms循环 | **5、9、13等中间帧出现黑色腿块/残影**，比相邻源帧明显更糊 | 62.5 MiB | [全部帧](<C:/Users/allan/.codex/visualizations/2026/08/30/01a052d0-236e-7bc3-80af-b53597574b8a/beetle-full-review/walk-all-frames.png>) |
| attack 横扫 | 29 / 1600ms一次 | 13帧角尖/腿部拉糊，前后姿态保留；边缘残色仍在 | 60 MiB | [全部帧](<C:/Users/allan/.codex/visualizations/2026/08/30/01a052d0-236e-7bc3-80af-b53597574b8a/beetle-full-review/attack-all-frames.png>) |
| charge 冲锋 | 31 / 2400ms一次 | 大片灰紫遮罩杂边；12～27段最明显；源关键帧就已污染 | 60 MiB | [全部帧](<C:/Users/allan/.codex/visualizations/2026/08/30/01a052d0-236e-7bc3-80af-b53597574b8a/beetle-full-review/charge-all-frames.png>) |
| summon 召唤 | 39 / 2200ms一次 | 多个中间帧触须/前腿/甲壳边缘紫色残块，开合甲壳有软化 | 75 MiB | [全部帧](<C:/Users/allan/.codex/visualizations/2026/08/30/01a052d0-236e-7bc3-80af-b53597574b8a/beetle-full-review/summon-all-frames.png>) |
| phase_open 开鞘 | 33 / 2200ms一次 | 1、3、5、11等中间帧有局部紫边；形态由合翅到开翅完整存在 | 87.5 MiB | [全部帧](<C:/Users/allan/.codex/visualizations/2026/08/30/01a052d0-236e-7bc3-80af-b53597574b8a/beetle-full-review/phase_open-all-frames.png>) |
| enraged_idle 开鞘待机 | 20 / 1333ms循环 | 主要维持开翅站姿，不能充当正常行走；有轻微轮廓紫边 | 52.5 MiB | [全部帧](<C:/Users/allan/.codex/visualizations/2026/08/30/01a052d0-236e-7bc3-80af-b53597574b8a/beetle-full-review/enraged_idle-all-frames.png>) |
| dying 死亡 | 27 / 1800ms一次 | 5、9、11等中间帧角与肢端出现紫黑拖影；倒地终帧存在 | 70 MiB | [全部帧](<C:/Users/allan/.codex/visualizations/2026/08/30/01a052d0-236e-7bc3-80af-b53597574b8a/beetle-full-review/dying-all-frames.png>) |

- 八张PNG均为RGBA，配置有效帧无空白、无触边；尾部未用网格未纳入动画。没有重新生成、修边、锐化或插帧。
- 脚线/透明度统计见[原始数据](<C:/Users/allan/.codex/visualizations/2026/08/30/01a052d0-236e-7bc3-80af-b53597574b8a/beetle-full-review/asset-review.json>)。开鞘等动作的Alpha最低点会随原动作变化，不能把其变化一律当作需拉平的错误。
- 这轮没有生成新的动画，因此没有把联系图或上轮的AI单帧试稿当作修复完成。
- 素材修复必须分别处理“原关键帧遮罩已污染”和“中间帧产生黑紫块”，不能只做整表去蓝或整体锐化。

## 3. 两项资源风险

### R1 · 需要优先处理的容量风险

独角仙王8动作共 **517.5 MiB** 基础RGBA；召唤的小独角仙4动作另占 **128 MiB**，两类同时驻留共 **645.5 MiB**。这是贴图解码尺寸乘4的预算值，不是GPU实测或PNG压缩大小。

[src/phaser/assets/runtime-asset-manager.js:957](<E:/无尽轮回/长期备份/2026-7-13-1/game-dev/src/phaser/assets/runtime-asset-manager.js:957>) 按整个资源族加载，不能只按当下那一个动作计费。当前共享软预算是640MiB（[data/performance-config.json:20](<E:/无尽轮回/长期备份/2026-7-13-1/game-dev/data/performance-config.json:20>)），还需要容纳其他怪物、友军、建筑与切场重叠。多个小独角仙共享同套纹理，不按每只重复加128MiB。

现有8张主怪表最长边5120～7168，空白画布占比高。优先评估全动作固定比例、动作统一透明紧裁与布局，保持角色世界体型；不提高全局软预算，也不改已批准动作帧数。**未做显存/帧率测试，不能据此断言某机器必然崩溃。**

### R2 · 首次召唤没有就绪等待

- [src/entities/enemy-types.js:4481](<E:/无尽轮回/长期备份/2026-7-13-1/game-dev/src/entities/enemy-types.js:4481>) 直接创建小独角仙，没有先等待该资源族。
- [src/phaser/assets/runtime-asset-manager.js:665](<E:/无尽轮回/长期备份/2026-7-13-1/game-dev/src/phaser/assets/runtime-asset-manager.js:665>) 从本怪配置里的实际资源路径收集资源族，不会把 `summonType` 字符串自动解析成另一套配置依赖。
- 小独角仙的4种贴图/动画已在Boot登记，生成后会走常规按需请求，所以不是永久无图；**但在这套资源之前未加载的场景，首次生成可能先出现占位图/迟显示**。
- 修复方向：在本怪获准进入场景时将召唤资源纳入依赖预热，或把第一次释放接入可取消的就绪流程，并保持冷却、上限和单次释放约束。

## 4. 状态覆盖与已有正确部分

| 状态/入口 | 当前路径与审查结果 |
|---|---|
| 普通待机、行走、追击 | 父类按速度阈值与80ms保持时间切换；run正确映射walk，布局尺寸归一化存在 |
| 普通横扫 | 配置29帧/1600ms；activeFrames15～18，首次有效窗口只结算一次；`rotbogSweepResolved/hitSet` 防重复存在；弹反后的循环退出见F5 |
| 冲锋预警 | lord走公共500ms预警，再进入自身900ms准备；合计不等于只有900ms，不应把公共预警误删 |
| 冲锋三段 | prepare→charge→recovery→idle路径齐全；墙体解析与轨迹扫掠存在，提前停止的视觉时钟问题见F3/F4 |
| 召唤 | 39帧/2200ms，20帧约1128.2ms释放；先置released，单次最多2只、存活上限4，安全落点检查存在 |
| 失去召唤目标 | 已开始召唤继续完成；不属于缺失目标校验的直接错误，当前技能不要求命中目标 |
| 半血开鞘 | 空闲后启动，完成才加25%移速并将以后冲锋冷却乘0.7；中断会清触发标记，允许重试；素材映射见F6 |
| 眩晕、冻结、恐惧 | 普通活跃技能有取消分支；冲锋recovery例外及其他控制遗漏见F1～F3 |
| 石化DoT致死 | 公共专用入口仍推进状态伤害；本怪onDeath清三种自管状态，调用父类死亡；不存在“石化期间还推进召唤计时”的判断 |
| 死亡、留尸 | 1800ms死亡+1400ms留尸，父类防重复死亡/奖励；召唤物独立存活是已声明规则，不应因首领死去强行删除 |
| 资源声明 | 双份独角仙配置当前一致；8种贴图和动画Boot登记齐全，循环/一次性repeat设置对应动作；仍有R1/R2风险 |

没有把“未看到独立蓝色特效调用”扩大成“所有蓝色现场均已解释”。当前已确认PNG污染；旧EXE、其他受击效果或现场渲染差异仍需实际场景证据。

## 5. 后续修复与用户验收顺序

1. 先修控制入口、弹反后中止范围结算、冲锋逻辑/动画同一时钟。
2. 修正开鞘形态动作映射、脚点刷新顺序、离屏尸体末帧恢复。
3. 从原关键帧修透明遮罩，单独处理异常中间帧；新增形态素材先确认动作，再按固定比例重建。
4. 处理纹理预算与召唤依赖预热，不动战斗数值、体型、碰撞和存档。

建议用户重点复现：冲锋刚开始命中/撞墙/被弹反；召唤释放前石化；开鞘中眩晕与石化；玩家突刺眩晕和束缚期间冲锋；玩家弹反时身后友军是否仍受横扫；开鞘后移动/普攻/冲锋/召唤/死亡；视口外死亡后在留尸期间移回镜头；首次召唤。

本轮仅新增本审查报告和离线证据文件，没有改动运行时代码或资源。**未运行测试、lint、构建、浏览器、游戏或性能验证，按约定由用户测试；未同步固定EXE。**
