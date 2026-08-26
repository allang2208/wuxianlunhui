> 本文件为 game-dev 技能库分卷，主索引与目录见 ../SKILL.md
> 本节：9. 怪物与 NPC

## 9. 怪物与 NPC

### 流水线流程（以后每个新角色/怪物都走这套）

#### 步骤-1：怪物默认偏真实美术合同与提示词模板（2026-08-25）

以后新增或重做怪物美术时，除非用户明确指定像素、卡通、手绘、低多边形等其他方向，默认采用棕蛇这一批确立的**偏真实游戏资产风格**：解剖和运动可信，高细节 PBR 材质，色彩克制，轮廓清楚，画面是干净的生产级 3D 游戏渲染，而不是带环境的写实照片。

- **解剖可信**：骨骼、关节、肢体数量、身体连续性、重心和接地点符合该物种；不能靠夸张变形制造“动感”。
- **材质可信**：皮肤、毛发、鳞片、甲壳、布料和金属分别描述粗糙度、细微色差与表面结构，避免塑料玩具感。
- **设计克制**：普通动物默认写明 `ordinary non-magical`，不擅自增加盔甲、发光纹路、角、翅膀或魔法特效；奇幻怪物只保留需求明确的超自然特征，但身体重量、受力和材质仍要可信。
- **资产导向**：纯白无影背景、正交感锁定镜头、完整单体、安全留边、同一地面线，优先保证后续视频、抠图、切帧和运行时缩放稳定。
- **身份一致**：头部结构、眼睛、比例、花纹、材质和装备选取 3～6 个身份锚点；状态视频只能让同一个身份运动，不能重新设计怪物。
- **例外优先级**：用户对具体怪物明确指定的风格、体型和超自然特征高于本默认合同。本合同约束真实感与制作完整度，不要求所有怪物长成相似外形。

##### 母图提示词模板（先锁身份，再做状态）

将方括号内容替换为该怪物的真实需求；不要只写“realistic”，要把真实感拆成解剖、材质、重量与光照约束。

```text
Use case: stylized-concept
Asset type: production identity mother frame for a Phaser game monster animation pipeline

Primary request: Create exactly one [life stage] [monster/species] as a production-ready game monster identity, holding a calm, animation-friendly neutral [idle pose].

Subject identity: [ordinary/fantasy/undead] [species/body type]; [main and secondary colors]; [required head, eyes, fur/scales/chitin, clothing or equipment]; [forbidden unrelated organs or decorations].

Anatomy and material: physically plausible [biped/quadruped/reptile/insectoid/flying] anatomy, correct joint placement and continuous body topology, believable weight distribution, high-detail [skin/fur/scales/chitin/fabric/metal], realistic roughness and restrained color variation; no toy-like plastic surface.

Style and medium: high-detail realistic PBR 3D game render, grounded dark-fantasy production-asset polish, readable silhouette, controlled saturation, physically believable materials; not a photograph and not a cartoon illustration.

Pose: [exact body-segment relationships, facing direction, contact points and center of gravity]; calm neutral expression; all required limbs, tail, wings, equipment and contacts readable and ready to animate.

Composition and camera: [strict side / low three-quarter] facing [left/right], orthographic-style locked camera, [slight elevation only if required]; complete subject; at most [55–65]% of canvas width and [45–70]% of canvas height; centered or safely offset with generous margins; all contacts on one baseline.

Scene and lighting: flat pure white #FFFFFF background, no horizon or floor; soft flat diffuse ambient studio light only, no directional shadow.

Identity locks: exactly one subject; preserve [3–6 identity anchors]; correct continuous anatomy; full silhouette; clean edges.

Avoid: extra or missing limbs/heads, split tail, broken/fused/tangled anatomy, duplicate gear, cropping, front/top view, perspective distortion, cinematic lighting, rim halo, cast shadow, reflection, scenery, particles, text, logo, watermark, cartoon, anime, chibi, flat illustration, low-poly toy, glossy plastic.
```

提示词取舍：使用 `realistic PBR 3D game render` 比单独写 `photorealistic` 更稳定，后者容易生成摄影背景、强景深和电影光。参考图若只用于风格或构图，必须写明 `style/framing reference only; do not copy anatomy`。中立姿态要描述身体各段的拓扑关系，例如蛇的盘绕圈数、身体从哪一侧离开盘圈和腹部接地线，不能只写 `idle`。

##### 状态视频提示词模板（只让同一身份运动）

```text
The exact [monster identity] from the first frame performs exactly one [action] [cycle/action] [in place/toward right], then [returns to the starting pose / settles into the final corpse pose].

Action phases: first [anticipation]; then [the complete shared kinetic chain]; at contact [precise contact pose and body part]; finally [recovery or settling]. One action only.

Motion physics: believable body weight, joint limits, muscle compression and follow-through for this [body type]; every body segment remains connected; preserve the required contacts and root anchor; no skating, floating, rubber motion, body knots or morphing.

Identity locks: exact same head, eyes, proportions, markings, materials, gear and scale as the first frame; no identity drift.

Camera and framing: static locked orthographic [view]; no camera move, pan, zoom, tilt, rotation, crop, reframing or tracking; keep generous margins and the full silhouette visible.

Background: pure white, same soft diffuse light; no ground line, shadow, reflection, scenery, particles or text.

[Looping state] End in the exact same pose, position, scale, orientation and motion phase as the first frame; no freeze, snap or artificial slowdown.
[One-shot state] Do not loop or reverse; finish the intended recovery or final pose and hold it naturally.

Avoid: extra/broken anatomy, duplicated parts, scale change, root drift, camera motion, silhouette-erasing motion blur, cuts, dramatic lighting, cropping or background change.
```

状态动作补充合同：

- `idle`：只做呼吸、肌肉张力、耳尾或一次吐信等微动作；中心和 footprint 固定。蛇类必须锁定盘绕圈数、盘圈出口和向上伸出的身体段，不能在循环中打结或换拓扑。
- `walk/run`：完成一个符合物种的完整步态、波动或振翅周期；原地精灵图锁定根节点。走与跑应在步幅、腾空、身体压缩和受力上有真实区别，不能只改播放速度。
- `attack`：明确“预备 → 全身动力链 → 接触 → 回收”，接触姿态和实际伤害部位对应玩法；只攻击一次。保留源视频中的自然突进轨迹，用更宽帧格承接位移，禁止逐帧居中把攻击拉直。
- `dying`：单向失衡、倒地、松弛并稳定停尸；不回弹、不逆放、不恢复站姿，完整尸体始终在画面内。除非用户明确要求，不添加血腥内容。

美术验收顺序：

1. 先让用户确认母图的风格、身份、视角、姿态和安全构图，再生成状态视频；母图未确认不得批量扩状态。
2. 保存获准母图、实际提示词、参考图、视频、模型/种子等生成参数、接触表和 GIF；废弃候选不得冒充正式溯源。
3. 视频逐帧检查解剖、身份、背景、镜头、裁切和动作是否唯一；一处明显增肢、断体、变脸或镜头漂移即可退回。
4. 归一化按身体类别选尺度证据：两足看有效身体高度，四足看躯干体量与足线，蛇/长虫等细长体看局部身体粗细与腹部线；不得让武器、尾巴、盘圈宽度或极端姿势污染 Alpha 外框后统一缩放。
5. 循环动作只截一个自然真周期；攻击保留源位移；死亡逐帧贴地但不逐帧缩放。最终检查空白帧、边缘触碰、Alpha、透明 RGB、`frameCount` 和 `endFrame`。
6. 视频下载、去背、切帧、接触表、GIF、表单验收和 provenance 的技术命令继续以 `skill/02-ai-asset-pipeline.md` 为准；本节只定义怪物的默认美术与动作质量合同。

#### 步骤0: 新增两足人形怪先套矿工僵尸体量基准（2026-08-23）

从本规则生效后，所有**新添加的双脚站立人形怪物**，默认以当前正式 `minerZombie` 为统一导入基准；除非用户对该怪物明确指定巨型、矮小或其他特殊体型，不再按原图画布大小或每个怪物的主观观感各自定标。

基准真源为 `data/enemy-config.json#minerZombie`（并同步 `public/data/enemy-config.json`）：

- 视觉体量：`render.spriteSize = 260.7`（当前矿工僵尸为 512×512 帧格）。制作和标准化新素材时，应让**实际可见的站立人体高度**与同场同脚点的矿工僵尸一致；透明留白、武器伸出、攻击宽帧不得被误当成人物身高。
- 地面 footprint：`collisionRadius = 36.3`，圆心位于实体逻辑脚点；默认 `render.colliderOffsetX = 0`、`render.colliderOffsetY = 0`，不得用偏移掩盖素材脚线错误。
- 脚线：512×512 同规格素材以 `render.footOffsetY = 58` 为基准。若动作帧格高度不同，按源像素比例为各动作换算脚线，使待机、行走、攻击、受击和死亡始终落在同一逻辑脚点，禁止动作切换时上下跳位。
- 躯干判定初始参考：`render.collisionWidth = 57.5`、`render.collisionHeight = 158.8`。只有轮廓或机制明确需要时才单独调整躯干/投射物判定；调整不得改变上述地面 footprint 基准。

导入验收必须把新怪物与矿工僵尸放在同一场景、同一逻辑 `y`/脚点并排比较：可见人体高度一致、双脚贴合同一地面线、footprint 中心和半径一致，左右翻转及所有动作切换不漂移。配置仍须同时写入 `data/` 与 `public/data/` 两份真源。

**范围边界**：本规则只约束规则生效后新增的两足人形怪物，不追溯批量调整既有怪物。四足、飞行、爬行、骑乘、巨型/Boss，以及用户明确指定特殊体量的单位，继续按各自类别或明确需求设计。

#### 步骤0.1：怪物正式精灵表入库前强制 RIFE 插帧（2026-08-25）

- 所有新增或重做的怪物角色动画表，在母图/视频身份、自然周期或一次性动作窗口、BiRefNet Alpha、固定比例、
  脚线、主体体量和安全格宽通过后，必须使用 `tools/ai-gen/rife-spritesheet-interpolate.py` 再做一次 2× 插帧；
  未生成插帧正式表、GIF/联系图和量化报告的素材不得登记进 `BootScene` 或双份怪物配置。
- idle/walk/run 等循环动作必须插入尾→首中间帧，N→2N；attack/cast/hit/dying 等一次性动作禁止回绕，
  N→2N−1。RIFE 前先做透明 RGB 最近色填充，RGB/Alpha 分通道处理，插后清零透明 RGB，并把中间帧脚底
  整像素校准到相邻原帧底边均值。
- 原始关键帧必须逐像素保留在偶数索引；旧 `contactFrame/releaseFrame/soundFrame/freezeFrame` 先映射为
  `原索引×2`，有效窗口按总时长不变、帧率×2的墙钟重新核对。插帧不得改变攻击方向快照、自然突进、
  武器轨迹、死亡尸体终帧或身体体量；长武器只扩格，不参与缩放。
- RIFE 只用于平滑已确认动作。若中间帧出现断肢、双武器、长杆弯折、错手、黑边或拓扑穿插，该帧必须
  剔除或退回源帧重做，不能为了满足“已插帧”而带病入库。最终仍须检查空帧、触边、脚线、循环缝、
  透明 RGB 和偶数位关键帧保真。

#### 怪物配置、运行时与图鉴同源合同（2026-08-24）

- `data/enemy-config.json` 与 `public/data/enemy-config.json` 是怪物定义双份真源，必须同步；图鉴转换层应保留完整配置对象，只添加规范化别名，禁止用字段白名单形成会静默丢弃新机制的第二份数据模型。
- 怪物出生基础属性统一委托 `src/config/enemy-base-stats.js` 的纯函数口径，`Enemy`、图鉴和采用怪物公式的友军不得复制六维公式。当前只有 `atk/matk/mdef` 允许显式覆盖；`def/crit/critRes` 由六维派生，配置完整性检查应拒绝写入不会生效的旧字段。
- `enemy-config.json.level` 只表示地牢成长、经验结算和存档等级；图鉴横向比较使用 `combatLevel`，读取 `combat-formulas.json#enemy.calculateCombatStats.combatLevel` 实时派生。两者不得互相覆盖，新增战力维度也不能改变配置等级语义。
- 机制名称与行为说明写在 `skills`，可调数值写在 `attackSkills` 并由运行时代码和图鉴参数区共同读取；伤害、冷却、范围、节拍或持续时间发生变化时，禁止只改说明文本或在图鉴硬编码另一份数字。
- 图鉴贴图优先读取 `textures.idle` 及其直接/嵌套帧布局；缺少正式贴图时显示明确“缺图”占位，禁止用程序化红色圆圈伪装成已完成资源。删除怪物必须同时清理双份配置、AI 阶段、BootScene 资源/程序纹理、默认纹理回退及活代码引用；同名装备、附魔和历史日志按独立功能边界处理。
- 尚未标准化的 DPS、攻击距离、控制、召唤和阶段威胁等后续评分只登记到根目录 `TODO.md`；完成统一数据协议前，不为个别怪物追加硬编码战力分。

#### 步骤0.5: 先定义攻击方式与攻击时间轴（新增怪物必做，2026-08-25）

新增怪物在制作攻击代码和填写范围前，必须先把每一种攻击归入以下合同之一；同一怪物可以拥有多种攻击，但每种攻击只能有一个伤害真源：

| 攻击方式 | 适用场景 | 必须采用的合同 |
|---|---|---|
| 通用单体普通近战 | 啃咬、拳击、爪击、普通武器挥击 | `melee-attack-resolver.js` + `basicMelee` 攻击时间轴 |
| 自管单体普通近战 | 自定义动画类、分段动作、需要弹反后置处理 | 仍锁定 `primaryTarget/basicMeleeSnapshot`，只在自管接触帧结算一次 |
| 多段普通连击 | 一次攻击动作包含多个明确接触点 | 整段锁定同一目标/方向，每段用跨帧阈值结算；小推进只允许重锚 |
| 范围或位移攻击 | 砸地、扇形横扫、扑击、冲锋 | 专用状态机 + 地面形状/实际扫掠轨迹；不得伪装成放大的普通近战 |
| 远程或施法 | 投射物、射线、落点法术 | 独立 `releaseFrame`/发射点/最大射程/AOE，禁止复用近战 `impactReach` |

通用单体普通近战必须在双份 `enemy-config.json` 中显式填写完整配置，不得只写 `attackRange`：

```json
"attackRange": 92,
"attackDistance": 92,
"basicMelee": {
  "approachReach": 92,
  "impactReach": 80,
  "width": 26,
  "timeline": {
    "durationMs": 1000,
    "frameCount": 24,
    "contactFrame": 9,
    "activeFrames": [8, 10],
    "rebaseOnImpact": true
  }
}
```

配置与实现顺序固定如下：

1. **先看攻击精灵表**：逐帧找出手、爪、口器或武器第一次接触目标的 `contactFrame`，再围绕它定义窄 `activeFrames`；帧号统一 0-based。禁止按动画50%或通用武器摆动时间猜命中时刻。
2. **再定接敌距离**：`approachReach` 表示 AI 开始刹停并允许起手的距离；兼容字段 `attackRange/attackDistance` 必须与它同步，避免感知、分配和移动仍读取另一套旧范围。
3. **再定伤害盒**：`impactReach + width` 按接触姿态从攻击者 Collider footprint 中心量取，并包含目标 footprint。它通常短于 `approachReach`，禁止靠放大伤害盒补偿动画不贴合。
4. **最后处理推进与朝向**：默认锁定起手主目标和方向，目标退出就空挥。只有精灵确实前冲时才配置小幅逻辑推进；需要随脚点移动伤害盒时显式启用 `rebaseOnImpact`，仍不得重新瞄准或穿过近身目标。攻击音、冲击特效和受击反馈优先挂在 `contactFrame`。
5. **确认专属技能边界**：扑击、冲锋、连击和AOE各自保留专用距离、轨迹和范围，不能因为怪物已有 `basicMelee` 就静默继承普通攻击参数。

交付前必须使用碰撞编辑器“近战判定”观察起手框、命中框、失败原因与实际动画帧，并由运行时检查六种场景：贴脸、极限接敌距离、横向擦边、目标后撤空挥、墙/门/建筑隔断、一次长帧跨过有效窗口。验收目标是伤害发生在可见接触姿态附近，目标退出范围后不吸附命中，不伤害身后单位，不因低帧率漏判或重复结算。未完成这套配置与验收的近战怪物，不视为攻击系统接入完成。

##### 动画驱动的扇形近战 AOE 合同（2026-08-25，美杜莎甩尾）

当攻击动画明确表现横扫、甩尾或大范围挥砍时，应继续复用普通近战的起手、锁向、逐帧时长和接触帧，但伤害结算必须升级为专属地面扇形，不能让通用解析器静默退回单一 `primaryTarget`：

- 双份怪物配置在 `basicMelee.area` 写明 `shape: "sector"`、`range`、`arcDegrees`、`damageMultiplier` 和可选 `knockback`；`timeline.contactFrame/activeFrames/frameDurations` 仍以正式精灵表的真实扫掠姿态为准，配置、运行时和碰撞编辑器消费同一组范围与时序。
- 起手时快照 Collider footprint 中心与攻击方向，接触帧只结算一次；目标移动可以导致空挥或擦边，但攻击中途不得重新瞄准。每次动作维护命中集合，同一目标最多命中一次，长帧跨过接触帧也不得重复结算。
- 用 `GroundSector` 加目标 footprint 半径做扇形相交，并同时执行承载面高度与墙体/门 LOS 门禁；防御结构可沿用已定义的贴身例外，但不能因此穿透普通墙段。
- 每个命中目标单独通过 `DamagePipeline`，保留 `isMelee: true`、弹反、受击、死亡和经验口径；径向击退按“AOE 中心 → 当前目标”计算。范围攻击不是把单体伤害循环简单复制给所有实体，阵营、可命中状态和死亡门禁仍须逐目标检查。
- 调试扇形、技能说明和实际命中必须显示同一 `range/arcDegrees`。验收重点为：扇形两侧边缘、多目标同帧、身后不命中、隔墙不命中、盾牌弹反、长帧只触发一次。

##### 延迟警告后强制连招的动作预留合同（2026-08-26，紫蚀古树藤牢→投石）

当技能流程是“施法释放预警区 → 延迟结算 → 命中后等待一小段时间 → 强制衔接下一动作”时，预警和连招等待都属于同一业务动作，不能只在下一动作可开始时提高选择优先级：

- 从预警区生成到结算前，动作选择器必须保留该技能的控制权；施法动画可以按自身时长回到待机，但不得在预警未结算时插入普通攻击。预警落空后应在当帧解除预留。
- 命中后建立显式连招队列并锁住普通动作选择，倒计时结束才强制启动后续动作；若目标死亡、失效或不再可命中，应清空队列并恢复普通决策。死亡/场景清理必须同时销毁预警、投射物、特效和连招队列。
- 每帧先更新旧连招倒计时，再结算可能新建队列的预警，避免新队列在创建帧立即吃掉一个 `dt`。长帧跨过阈值时仍只启动一次后续动作。
- 强制后续动作可以无视“当前冷却是否可用”，但真正起手时必须按该次动作重新写入完整冷却，避免组合技后立刻再投一次。控制状态可以延后起手，不能让普通技能绕过队列抢占。
- 施法、预警生成和投射物脱手分别使用正式精灵表的 0-based `releaseFrame`；人工逐帧复核覆盖自动插帧映射时，要在 manifest 记录覆盖原因，配置、运行时和说明统一消费最终帧号。

#### 步骤1: 制作原始精灵图

在 Aseprite / Photoshop 中制作，帧大小固定（如 250×215）。

不要求内容精确对齐，因为步骤3会处理。

#### 步骤2: 运行标准化脚本

```bash
cd tools
python sprite-normalizer.py \
  --input ../assets/enemies/raw/black_wolf.png ../assets/enemies/raw/black_wolf_attack.png \
  --output ../assets/enemies/ \
  --frame-width 250 --frame-height 215 \
  --cols 4 --rows 2
```

脚本行为：
- 分析每个精灵图的所有帧内容边界
- 取所有输入中的**最大内容宽高**作为目标
- 缩放每帧内容（保持比例，fit 模式）
- 平移使内容中心对齐到帧中心
- 输出到 `--output` 目录

只输出报告不生成文件：
```bash
python sprite-normalizer.py --report ...
```

#### 步骤3: BootScene 加载

```javascript
this.load.spritesheet('enemy_black_wolf', 'assets/enemies/black_wolf.png', {
    frameWidth: 250, frameHeight: 215, endFrame: 7
});
```

**必须带 `endFrame`**，Phaserv4 即使图片高度差1像素也能正确加载。

#### 步骤4: 怪物代码无需手动调 spriteSize

标准化后所有精灵图内容大小一致，代码中统一 spriteSize，无需条件判断：

```javascript
_getPhaserOptions() {
    return {
        spriteSize: 216,  // 统一值，不再根据状态变化
        frame: this._animFrame,
        flipX: this._facing === 'left',
        // ...
    };
}
```

---

### 怪物共享基础件（2026-07-21 新增，新怪物优先复用）

新增怪物时**优先复用** `src/entities/enemy-types/_shared/` 下的共享模块，不要在类内重复实现：
- `enemy-utils.js`：`hostilesOf`（敌对目标枚举）、`isTargetMeleeStyle`（近战/远程风格判定）、`playSoundFrom`（按 sounds 配置播音）、`isFacingLeftFrom`（朝向判定）、`inMeleeRange`（历史自定义近战技能的圆形边缘距离工具；范围技能带地面椭圆圈视觉的仍用 GroundEllipse）。通用敌人普通近战改走 `src/combat/melee-attack-resolver.js` 的锁定方向单目标矩形；自定义近战技能 range 仍按 `skill.range ?? this.attackDistance ?? 默认值` 读取，逐类迁移，禁止把二者混为同一合同；
- `enemy-gun.js`：`setupGun`（枪械装配：装备实例/攻击绑定/伤害/击退/AI 散布/弹匣）、`tryEnemyFireGun`（开火一体化：枪口偏移/墙体回退/瞄准目标矩形上方区域/临时移位出膛/枪口火焰+开火火光+弹壳，支持防御姿态枪口下移）；
- `monster-anim.js`：`twoStageWalkKey`（移动动画首段→循环段切换）、`frameHitElapsed`/`ratioHitElapsed`（命中帧→触发时间换算）。

自管单体普通攻击同样复用 `melee-attack-resolver.js`：起手锁定主目标与方向，命中帧只复查该目标。已迁移范例包括黑狼/红狼王撕咬、蝇手锤击、时空突击特工斧砍、僵尸工头鞭击、提灯矿工砸击和矿工僵尸第17帧砸击；其中原先遍历近身所有敌对单位的斧砍、鞭击和砸击均恢复单体语义。鞭击特效也锁定起手点；弹反成功后禁止继续附加流血、致残、普通击退和命中特效。时空盾卫盾击、蝇手砸地/灭世重砸仍是范围技能，不纳入普通近战解析器。碰撞编辑器的怪物“近战判定”调试会按当前正式测试怪 ID 显示该解析器的起手快照与命中复查结果，不会采样场上其他怪物。

通用普通近战逐怪通过 `basicMelee` 声明两套距离与攻击时间轴：`approachReach` 只负责追击刹停/允许起手，`impactReach + width` 才是接触帧伤害盒；两者都从攻击者真实 Collider footprint 中心发出，不从透明画布中心或未经偏移的实体坐标发出。`timeline` 使用 0-based `contactFrame/activeFrames` 并与该动作的 `durationMs/frameCount` 同时钟推进。有效帧判定必须按“本次更新是否跨过或覆盖窗口”触发，不能等待恰好落在某个毫秒点；小幅攻击推进可显式 `rebaseOnImpact`，只按当前脚点重锚并保持起手方向和主目标锁定。碰撞编辑器会同时显示起手框、命中复查框和实际动画帧。首批接入：普通僵尸、胖子僵尸、僵尸犬、棕熊、熊德鲁伊变熊后的普通攻击；专属扑击、连击和范围技能仍保留自身合同。

借用通用 `Attack/ThrustAttack` 的冷却与起手调度、但由自定义动画帧结算伤害的混合怪物，必须复用 `_pendingThrust` 内的 `primaryTarget/basicMeleeSnapshot`，并在启动自定义动画时立即关闭该 pending 的通用命中。这样只保留自定义命中帧这一处伤害源，避免“通用突刺 + 自定义砸击”双重结算；矿工僵尸是该模式范例。

自管多段普通连击也复用 `melee-attack-resolver.js`：整段锁定主目标与起手方向；攻击者存在小幅突进时用 `rebaseBasicMeleeSnapshot()` 随脚点重锚，禁止重新瞄准绕后目标。命中时序按“跨过配置帧即补结算一次”处理，并在弹反/冻结后立即终止同帧剩余段。已迁移范例：Mutant-3 五连击、铠甲骑士二连击；它们的飞扑、持盾冲锋和格挡仍保持专用状态机。

范围/位移近战保持专用状态机，但预警、冲击视觉与伤害必须共享同一位置、方向和地面形状：圆形地面效果统一使用 `GroundEllipse + PERSPECTIVE_SCALE_Y`，正面推击使用 `GroundDirectedRect` 并锁定起手方向。手脑砸地现以触手前方落点作为唯一锚点，300px 椭圆预警、烟尘、放射线、冲击圈和伤害完全重合；时空盾位盾击为前方 `200×160px`，白色盾缘尾迹、命中四边形与判定同向，不再360°击中身后。范围技能逐目标结算后同样检查 `_lastParried`，弹反目标不得继续受到眩晕等后置控制。高速位移近战统一通过 `motion-melee-sweep.js` 扫过每帧经 `WallSystem.resolve` 后的实际轨迹，只能命中发动时锁定的目标；目标死亡/换层不回退到新目标，墙体把直冲裁短或改成滑墙时在实际落点终止。红狼王飞扑、Mutant-3飞扑和铠甲骑士冲锋均按此合同结算，拖尾/扬尘继续从解析后的实际位置生成。

已迁移范例：`time-agent-assault.js`（双形态+枪械+投掷+斧砍）、`time-agent-shield.js`（远程+盾击+防御弹反）。

---

### 怪物 AI 状态机（BlackWolf 示例）

#### 设计原则
- **不硬编码**：AI 参数从 `enemy-config.json` 或构造函数 `config.ai` 读取
- **外部系统驱动**：BlackWolf 的 `update()` 只设置目标属性（`target`、`_tacticalTarget`、`_lastKnownTargetPos`），`MovementSystem` 和 `CombatSystem` 在后续帧执行移动/攻击
- **状态机模式**：`pacing` → `chasing` → `lost` → `pacing`
- **普通撕咬判定**：黑狼与红狼王的自管动画仍通过 `melee-attack-resolver.js` 锁定起手目标和方向；`biteRange` 控制起手，`biteHitDistance` 控制命中容差，命中帧复查方向矩形、承载面与墙体。飞扑是位移技能，继续保留独立轨迹判定。

#### 状态定义

| 状态 | 速度 | 目标 | 行为 |
|------|------|------|------|
| `pacing` | `maxSpeed * 0.5` | `_tacticalTarget`（200px 内随机点） | 在踱步中心半径 200px 内慢速漫游 |
| `chasing` | `maxSpeed` | `target`（最近玩家） | 向玩家奔跑，进入攻击范围时触发攻击 |
| `lost` | 无（计时中） | 保留 `target` | 目标跑出 800px 后持续 2s 计时，超时回 pacing |

#### 参数配置（enemy-config.json）

```json
{
  "blackWolf": {
    "speed": 93.6,
    "dashDistance": 200,
    "ai": {
      "aggroRange": 800,
      "pacingRange": 200,
      "loseTimeout": 2000
    }
  }
}
```

#### 代码实现要点

```javascript
// 1. update() 中扫描 + 执行 AI
this._aiScanTimer += dt;
if (this._aiScanTimer >= this._aiScanInterval) {
    this._aiScanTimer = 0;
    this._updateAIState(dt, entities);  // 状态切换
}
this._executeAI(dt, entities);  // 设置 target / _tacticalTarget / maxSpeed

// 2. pacing 状态：设置 _tacticalTarget，让 MovementSystem 读取
this._tacticalTarget = this._pacingTarget;
this.maxSpeed = this._baseSpeed * 0.5;

// 3. chasing 状态：设置 target，让 CombatSystem 读取
this.target = nearestPlayer;
this.maxSpeed = this._baseSpeed;
this._tacticalTarget = null;
```

---

### 怪物 HUD 锚点工作流（2026-07-21 新增；2026-07-23 起为**新怪物必做项**）

**默认规则**：新增怪物的名字/血条锚定**圆柱体（胶囊）碰撞体积最上方**（胶囊顶 = footprint Y − `collider.height`），不再按贴图顶部定位。**自 2026-07-23 起，新增怪物必须设置 `"capsuleHudAnchor": true`（已补齐：poisonMaggot/minerZombie/lanternMinerZombie/foremanZombie）。**
**三套碰撞体积注意区分**：footprint 椭圆（地面分离/范围判定）、绿色矩形（`collisionWidth×collisionHeight`，近战判定）、圆柱体胶囊（`collider.height`，来自 `config.height` 或 `render.spriteSize`，投射物判定）。HUD 锚点用的是**圆柱体胶囊**，不是绿色矩形。
**启用方式**：`enemy-config.json` 该怪物 `render` 块加 `"capsuleHudAnchor": true`（GameScene 按此开关选择锚点；未配置的旧怪物保持贴图顶部锚点不动）。
**配套校准**：`render.collisionHeight` 只影响绿色矩形（近战判定），不影响 HUD 锚点；`render.hudOffsetY` 语义不变（在锚点基础上的额外偏移，默认为 0 即可）。
**常见陷阱：`colliderOffsetY/X` 必须写在 `render` 块内**——`enemy.js` 基类只读 `config.render.colliderOffsetY`；写在配置顶层是死配置不生效（2026-07-25 工头顶层 -75 一直未生效的根因；手脑/骑士也曾踩过，见 enemy.js:168 注释）。NPC 类相反，读顶层（npc.js:48）。

**Sprite 脚线与 footprint 中心必须同源（2026-08-24 普通僵尸）**：素材 Alpha 底线稳定但仍显得悬空时，先核对地面 footprint 是否以带 `colliderOffsetY/X` 的 Collider 中心绘制。Sprite 的脚点偏移需要扣除同轴 Collider 偏移，使双脚落到 footprint 中心；禁止反过来移动 Collider 迁就贴图，否则近战、投射物、寻路和调试体积会一起漂移。该校正只属于渲染锚点，不得改变碰撞半径、身体高度或攻击范围。

---

### 怪物 HUD（名字/血条）定位规则

- **统一规则**：怪物名字与血条位于**贴图上方 30px 区域**（血条 `healthBar.offsetY` 默认 -30，名字在其上方紧贴）。不要再放更高。
- **透明上沿校准**：AI 生成精灵图常有大片透明上沿，`topY` 按 displayHeight 算会远高于视觉头顶——在 enemy-config `render.hudOffsetY`（正数下移，如骑士 75）整体校准名字+血条，不要改通用代码。
- **渲染来源**：新怪配置走 `entity.config.render`，老怪走 `_animCfg.render`（GameScene `_syncEntityHud` 已做双源回退）。
- **非方形帧显示**：渲染层 `setDisplaySize` 按帧宽高比等比缩放（spriteSize=最长边），方形帧行为不变；素材帧尺寸不统一（如手脑 walk 512×1024 与其余 512×512）时无需特殊处理。

- v4.1 (2026-07-20) — 手脑裁剪修复/骑士HUD下移/仓库整体修复/出征界面调整
  - 手脑素材真实网格：idle/slam/howl 8×4（帧512×512）、walk 8×2（帧512×1024）——勿信口述"4×8"，**拿到精灵图先目检行列布局再配 frameWidth/Height**
  - 仓库：金币/消耗品无法存入+满仓误报根因=金币无 maxStack 字段（_maxStackOf 回退 gold 99999）+不可堆叠物品空间语义修正（整件1格与 stack 数无关）；overlay 点击一并关闭（warehouse 自挂监听避免循环 import）；NPC走远链补关闭；格子改一行2格×56px 对齐背包
  - 出征界面 open() 改自动关闭背包（原为主动打开）；说明弹窗重定位 left:4px bottom:2px 187×945 拉伸

---

### ⭐ 怪物渲染图层与构造铁律（2026-08-15 定稿，改怪物渲染/新建怪类必读）

#### 1. 贴图恒在脚下椭圆阴影之上（图层时序铁律）

- **`GameScene.update` 中 `_syncEntityShadows` 必须排在 `_updateDynamicDepths` 之后**——阴影深度 = 贴图**当前帧**仲裁后 depth − 0.1，任意帧恒有 `阴影.depth < 贴图.depth`。
- 旧顺序（阴影先跑、读上一帧 depth）：怪物跨过掩体/墙面线（世界-122 基地掩体、地牢墙）深度骤降时，阴影以旧深度盖在贴图上 1 帧；毒蛆 232×116 大椭圆（碰撞半径 116×透视 0.5）在掩体线反复压住虫身即此根因。
- 通配：新加任何"实体深度 ± 偏移"的附属视觉，都要么跟随本体**仲裁后** depth，要么自己过一遍 `junctionCorrectedDepth`（lessons #28）。

#### 2. `_getTextureKey()` 只能返回贴图键，绝不能返回纯动画键（骑士冲锋贴图丢失教训）

- `GameScene._syncEnemyAnimation` 每帧对 `_getTextureKey()` 的返回值做 `textures.exists` 判定，失败即回退 **`enemy_circle` 白胶囊占位**。
- 铠甲骑士冲锋两段式（首段 19 帧 → 9~19 帧循环段）曾返回动画键 `enemy_armored_knight_charge_loop`（BootScene 只有该名 anims、无同名贴图，两段共用 attacking-2.png 一张 sheet）→ 首段播完（2s）后到冲锋停止 ~1s 贴图"丢失"（白胶囊）。
- **同 sheet 多段动画**：贴图键返回 sheet 本身；段切换放在 `_getPhaserOptions()` 的 `animKey`（贴图键/动画键职责分离，参照 mutant-3 的 attack_pounce 写法）。
- 防御：GameScene 已加"贴图键缺失但同名动画存在 → 回退该动画首帧贴图"，但**怪类侧仍必须遵守本铁律**。

#### 3. 怪类构造器必须合并自身 enemyConfigData（「测试怪物」残留教训）

- 全项目怪类构造器都 `super(x, y, { ...enemyConfigData.xxx, ...config })`，**唯独曾漏了 `ZombieDogEnemy`**——世界-122 防守 `new Factory(pt.x, pt.y)` 无配置构造时，名字落到 `Enemy` 兜底「测试敌人」、贴图是僵尸犬、属性是默认值（hp150/speed45 而非 100/250），游戏内表现为一只"测试怪"。
- 新增怪类 checklist：① 构造器合并配置；② 无配置构造 = 完整可用（名字/属性/贴图）；③ 同怪多入口（防守池/地牢/召唤/主城）建议收敛到共享工厂（如 `createZombieDog(x, y, overrides)`，ai 深合并）。
- 排查经验：**"世界某处冒出不属于这里的怪/名字"先查构造路径是否漏配置**，grep `new Xxx(` 全部调用点 + 核对 `enemy-config.json` 兜底链（`config.name ?? defaults.name ?? '测试敌人'`）。

#### 4. 建筑图层统一口径（2026-08-16 定稿，世界-122 全建筑/新建筑必读）

- **唯一规则**：每个建筑在构造时注册「接地线」——`setupStructureDepth(entity, halfWidth)`
  （`src/world/structure-depth.js`）生成 `_faceLine`（脚底 y 处水平线段，跨度 = 贴图显示
  半宽）与 `_faceDepth`（= 接地线 max y + 12）。单位（玩家/敌人/侍从/友方单位）每帧经
  `WallSystem.junctionCorrectedDepth` 仲裁：脚线在接地线**之后** → 压到建筑之下；在
  **前/同线** → 抬到建筑之上（+0.5，消除同线 z-fight）。
- **现状**：掩体/铁闸门/仓鼠小屋/防御塔/基地核心/能源矿全部接入。**新增建筑只要构造里
  调一次 `setupStructureDepth(this, 贴图显示半宽)` 即可**，不再需要各自处理遮挡；新增
  单位自动走 junctionCorrectedDepth，无需改代码（"一劳永逸"）。
- **坑①（z-fight）**：建筑深度必须统一为 `_faceDepth`（接地线 y + 12）。塔旧实现用
  `e.y + 2`、基地/能源矿无锚线走 `sprite.y + footOffsetY + 10`——与单位自然深度
  （脚 y + 10）**同线时完全相等** → 谁盖谁取决于创建顺序（建筑盖仓鼠/仓鼠盖建筑随机，
  即"建筑遮挡友方单位"）。
- **坑②（面线别当墙段）**：`_faceLine` 现在是全建筑通用，`building-system.canPlace` 只对
  `_isDefenseCover || _isCoverGate` 走"线段+墙厚"重叠判定，其余紧凑建筑仍走圆心距离——
  否则塔/基地的面线会被当成 26px 厚墙段误判吸附/重叠。
- **坑③（面线过期）**：锚线在构造时按 x/y 生成；建筑不可移动（immovable），测试探针
  传送实体后必须重算锚线（真实场景不会发生）。
- **坑④（友军脚线被贴图配置污染）**：移动单位参与建筑仲裁的自然深度应来自逻辑脚底
  `entity.y - entity.z + 10`；`spriteOffsetY`、跨动作 `feetCorr` 和贴图中心只负责显示，
  不应成为排序真源。`GameScene._getDynamicDepthProfile()` 必须把 `logicalFootY = entity.y - entity.z`
  显式传给 `sprite-depth-profile`，后者的 alpha 扫描只负责可见宽高；禁止恢复
  `sprite.y + footOffsetY + 10` 作为自然 depth。新增仓鼠兵种同时校验
  `spriteOffsetY + footOffsetY === 0`，避免火枪手这类配置不配对造成建筑边缘错层。
- **验证**：`tools/cdp-layer-occlusion.mjs`——合成 36 组合（塔/基地/矿/小屋 × 无墙/墙前/
  墙后 × 后/同/前）+ 真实基地 4 类建筑同线抽查。新增/修改友军时不能只测单一射手和建筑
  中心线，还要覆盖全部显示规格、四个前缘/角点、前缘 ±1px、接地半径和各动画帧，规则始终为
  "单位盖建筑 iff 单位逻辑脚线在建筑之前"。

#### 5. 建筑地面 footprint / 安全出兵 / 4格门（2026-08-18，世界-122）

- 使用 `src/physics/iso-footprint.js` 作为地面旋转矩形唯一几何源。把屏幕 Y 按
  `PERSPECTIVE_SCALE_Y` 还原后旋转45°进入 u/v 地面坐标；放置判重、圆-建筑分离、
  出兵校验、攻击距离、范围显示和遮挡前缘必须复用该入口，禁止再写屏幕 AABB 近似。
- 统一占格：普通非墙建筑2×2、基地4×4、方块墙1×1。`entity.y` 表示贴图/footprint
  前缘，所以2×2中心固定 `offY=-64`、基地 `offY=-128`；方块墙以格心为中心、offset=0。
- **2026-08-19公式收口**：单格宽128，深度=`宽×PERSPECTIVE_SCALE_Y(0.5)`；
  `collisionRadius=宽/2`，u/v半径=`宽/(2√2)`。普通建筑默认固定该公式，alpha扫描仅校正
  视觉脚点/水平锚点；只有显式`autoFootprint:true`的异形建筑可调用像素四边形物理。
  墙/门/楼梯继续保留线段或自定义多边形，不受本规则覆盖。
- 建筑落点使用 `_snapBuildingGrid`：先求 N×N 格心平均位置，再把实体锚到菱形前顶点。
  边界、清障区和点击检测必须读取 collider 中心，不能把贴图前缘重新当中心。
- 长墙与门调用 `applyIsoFootprintFromSegment(faceA, faceB, halfThickness)`。4格门两柱占
  端点格，中间铁栅栏必须精确占 **2×1** 地面格，中心就是门 anchor，禁止恢复旧
  `anchor.y+32` 偏移；该偏移会导致转角门隔一柱、邻接墙无法放置。
- 门端柱吸附同时生成正/负方向候选；共享既有门柱时只忽略所属旧门的 `_gateSeg`，
  不要忽略旧门实体 footprint。几何正确后转角只贴边，真正门体重叠仍应拒绝。
- 生产建筑统一调用 `SpawnPlacement.findAndReserve`：固定出口槽位检查墙、建筑 footprint、
  动态单位和750ms预约。无出口时保持生产100%、每500ms重试，禁止使用未经校验的固定
  右侧 fallback；生成后先走 `_spawnEgress` 再恢复正常AI。
- 占格怪物生成器（如标准1×1矿洞）复用同一出口协议：探测半径必须覆盖实际召唤物
  footprint，调用端确认洞体外安全点后跳过共享召唤器从建筑中心再次 `WallSystem.resolve`；
  暂时无安全出口时延迟重试，禁止把单位强塞在洞体边缘或墙角死袋。
- 面板外点击使用捕获阶段 `mousedown`；空白处关闭主面板/详情，正在放置或点击建筑本体时
  不关闭，避免“能关闭但无法落地/无法点详情”的事件冲突。
- 回归运行 `test-world122-building-footprint.mjs`、`test-spawn-placement.mjs`、
  `test-gate4-snap.mjs`、`test-world122-build-regressions.mjs`，再跑完整 `npm test`
  与 Vite build。

---

#### 15. 仓鼠骑士、冲锋与动作贴图归一化（2026-08-19）

- **配置/生产**：`hamster-knight-config.json` + `hamster-knight.js` + `hamster-knight-ai.js`；骑兵学校只生产 knight，升级项目为 `cavalry_charge`。冲锋触发顺序优先于普攻，须同时满足有效敌人、冷却完成、距离严格大于 `minTriggerRange:300` 且不超过 `triggerRange + 目标半径`。
- **冲锋伤害**：`chargeDamage` 模块的 `effect:'chargeDamageMult'` 每级 +15%；`getUnitUpgradePatch`、新单位 spawn、`applyBarracksUpgrades` 和 `_dealChargeHit` 必须贯通。只改配置展示而漏接 `_dealChargeHit` 会造成“面板升级但伤害不变”。
- **渲染状态机**：骑士不能落入伊莉丝通用 `atkPlayed` 分支——多帧 idle 会让该锁无法复位。GameScene 必须有独立 attack/charge 分支：动作首次播放，正常结束定格末帧；离开状态清锁；异常打断未触发 `animationcomplete` 时下帧自愈重播。
- **精灵图量化**：所有动作保持 8×4、512 格；入场脚底统一，死亡动作额外按不透明面积（非仅 bbox 高度）缩到 running 基线，否则横向倒地姿势会视觉放大。使用 `tools/ai-gen/normalize-hamster-knight-sheets.py`；逐帧验证有效帧数、脚底线与 alpha 面积，再替换项目 asset。
- **轻骑体量对齐（2026-08-23）**：running 主体中位高度234px、脚底中位线353px，按轻骑基准换算为 `displaySize:393.333333`、`spriteOffsetY:-74.5`、`footOffsetY:74.5`；只校正不足1%的视觉差，不修改碰撞和战斗参数。

#### 16. 仓鼠轻骑（2026-08-19，高速近战友军）

- **素材/显示**：`assets/companions/hamster_light_cavalry/` 四套 8×4、512 格透明表；
  idle 8 帧、running 11 帧、attacking 12 帧、dying 11 帧。有效内容高约236px，
  与仓鼠骑士同屏体量取 `displaySize:390`；脚底约 y=375，配
  `spriteOffsetY:-91`、实体 `footOffsetY:91`、`hudOffsetY:190`。
- **骑兵默认视觉基准（2026-08-23）**：用户未特殊指定时，所有骑兵以仓鼠轻骑的
  running 主体屏幕高度为准，即 `236×390/512=179.765625px`。新骑兵先对移动表有效帧
  扫 `alpha>10` 的主体中位高度 `H` 与脚底中位线 `F`，再取
  `displaySize=179.765625×frameHeight/H`、
  `spriteOffsetY=-(F-frameHeight/2)×displaySize/frameHeight`，实体 `footOffsetY`
  取其相反数。禁止机械照抄 `displaySize:390`，也不得因此联动修改碰撞、属性或移速。
- **配置/六维**：`hamster-light-cavalry-config.json`，`statFormula:'enemy'`；
  力20/敏15/智3/体20/精3/幸5，派生物攻18/物防36/魔攻3/魔防4/暴击7/暴抗20，
  `baseMaxHp:250` 覆盖生命，移动速度230。
- **AI/伤害**：复用配置驱动的单次近战状态机，只选择最近 `_faction==='enemy'`
  且非能源矿点目标；12帧@12fps，第9帧（约667ms）结算60点物理近战伤害，
  攻击间隔2秒，无敌人时跟随玩家。
- **生产**：骑兵学校可切换 `knight` / `light_cavalry`；轻骑60秒生成，骑士改90秒。
  轻骑接入 BootScene/GameScene、友军仇恨优先级、全局兵种升级和世界122后台DPS结算。
- **升级适用性**：骑兵学校共用项目中的模块可声明 `unitKinds`；冲锋强化只对骑士显示/
  生效，轻骑显示机动强化，通用攻击/伤害/生命模块两者共享，禁止出现无效果升级按钮。

### NPC 添加标准工作流（2026-07-22 新增，新 NPC 一律按此开展）

#### 1. 素材（原则 9）
复制到 `assets/npc/<npc英文名>/`（如 `assets/npc/mouse_king/idle.png`、`walking.png`）；**先目检帧布局**（行列网格、有效帧数、内容边界），再配 `frameWidth/Height/endFrame`。

#### 2. 配置（data/game-config.json `npcs.<key>`，唯一真相源）
- `sprite`（可选，缺省保持纯色圆占位）：`{ idleKey, walkKey, size, footOffsetY, walkFps }`
  - `idleKey/walkKey`：BootScene 注册的动画键；`size`：显示边长（方形帧）；`footOffsetY`：逻辑脚底到贴图中心偏移（内容底边贴地校准）；`walkFps`：行走帧率
- `wander`（可选，缺省不动）：`{ radius, speed, idleMs, moveMinMs, moveMaxMs }`——以生成点为中心 radius 内随机选点移动，每次移动后停留 idleMs，移动时长 moveMinMs~moveMaxMs 随机
- `noSeparation`（可选）：固定不动，实体分离由对方承担全部位移
- `obstacle`（可选，**家具型静态 NPC 推荐**）：`{ width, height, offsetY, wallHeight? }`——底座矩形障碍。在 `_setupMainHubTerrain` 与边界墙同入口注册为 WallSystem 静态墙（`noVisual` 跳过墙面视觉），实体 `collisionRadius` 只留小半径（~20），阻挡交给矩形。**不要给家具型 NPC 套大圆 footprint**：圆 X/Y 对称，调大无法靠近、调小贴图错误遮挡；矩形底座宽=贴图底座、深=底座厚度，靠近/绕行/遮挡三者都自然

#### 3. BootScene 加载与动画注册
`spritesheet` 加载（**必须带 endFrame**），`anims.create` idle 单帧循环 + walk 循环（frameRate 读 sprite.walkFps）。

#### 4. 实体与渲染（已通用，无需改代码）
- `npc.js`：构造函数接收 `config.sprite`（→ `spriteCfg`）与 `config.wander`（→ `wanderCfg`）；游走由 `NPC._updateWander` 驱动（WallSystem.resolve 撞墙校验、`_pickWanderTarget` 可达性重试），`isMoving`/`_facingLeft` 供动画与翻转
- `GameScene._syncNeutralEntities`：检测 `e.spriteCfg` 自动创建贴图 Sprite（idle/walk 切换、flipX、名字标签贴图顶部）；无配置回退 `neutral_circle` 纯色圆
- 生成处（如 `game.js spawnNPC`）把 `shopCfg.sprite / shopCfg.wander` 透传进 NPC config
- NPC 接触阴影与玩家/怪物/友军统一读取 `Collider.radius` 的水平 2:1 地面 footprint，并以
  仲裁后的 NPC Sprite depth−0.1 绘制；`collisionShape:'rect'` 只描述躯干矩形，不能拉伸阴影。
  `colliderOffsetX/Y` 会通过 Collider 圆心同时作用于范围红圈与阴影。

#### 5. 验证
lint / vite build / test-collider / test-config-integrity；实机验证 idle/walk 切换、朝向翻转、游走范围与停留节奏、名字标签位置。

### 玩家友方单位添加工作流（2026-08-15 仓鼠矿工首航，世界-122 自动采矿）

> 新增「玩家阵营、可被怪锁定、自动执行任务（如采矿）」的非队员工时，一律走这套。
> 首航范例：仓鼠矿工（`data/hamster-miner-config.json` + `src/entities/hamster-miner.js` +
> `src/ai/hamster-miner-ai.js` + `src/world/hamster-miner-system.js`）。

#### 2026-08-25 友军正式精灵表强制 RIFE 插帧门禁
- 所有新增或重做的战斗友军、侍从、工人和纯视觉平民角色动画，在正式进入
  `assets/companions/<id>/` 并登记配置前，必须执行 `skill/02-ai-asset-pipeline.md` 的统一 2× RIFE 插帧流程；
  原未插帧表保存在任务溯源目录，正式目录只放通过检查的插帧表。
- 循环动作 N→2N 并包含回绕中间帧；攻击、施法、采集、装卸、受击和死亡等一次性动作 N→2N−1且禁止
  回绕。原关键帧固定在偶数索引，命中/出膛/施法/声音帧先×2映射，持续窗口按墙钟复核，播放帧率×2以
  保持原动作时长。
- 插帧前后的主体缩放、脚线和水平锚点合同不变：长柄武器、旗帜、法杖和携带物不参与主体体量；攻击/冲锋
  保留源位移，死亡保留原终帧。交付必须包含透明 GIF、联系图、空帧/触边/脚线/透明 RGB 报告和关键帧保真结果。
- 联系图还必须逐帧排除“仅插帧帧出现的不透明近黑块”。统一工具会把相邻关键帧暗部之外的近黑像素记入
  `middleFrameVisibleDarkPixelsRepaired` 并重建颜色；正式报告要求 `visibleDarkOutlierFrames={}`、
  `middleFrameHeldSourceKeyFallbacks=[]`。不得以复制前帧方式批量消除黑闪，避免插帧后仍呈现二连重复帧。

#### 2026-08-21 纯视觉平民动画尺寸统一（农民/银行家/工程师）
- 方案详情见独立分卷 `skill/08b-animation-smoothing.md` 第 4 节（alpha bbox 实测法 /
  scale+footRatio 归一化 / originY 脚底锚点修正 / 三个 play 接入点）。
- 关键教训：姿势性增高（工程师举锤）不是变大，不要缩放；以 idle 中位高度为基准。

#### 2026-08-23 步兵与施法友军默认体量（仓鼠牧师基准）
- **适用范围**：没有用户特殊说明时，所有非骑乘的军事友军都视为步兵，包括近战、远程、
  侦察/探险支援单位；所有地面施法友军同样适用。经济岗位单位（矿工）与骑兵不进入本标准：
  矿工保留岗位体量，骑兵继续使用仓鼠轻骑独立基准。
- **视觉真值不是 `displaySize:250`**：仓鼠牧师 running 有效帧的 Alpha 内容中位高度为
  155px，`155×250/512 = 75.684px` 才是游戏内目标可见高度。新素材必须用
  `tools/ai-gen/measure-friendly-unit-visuals.py` 量 running 全部有效帧，按
  `目标可见高度×frameHeight/本单位Alpha中位高度` 反算 `displaySize` 作为首轮候选；禁止机械照抄250。
- **全 Alpha 高度的例外**：长柄武器、竖向法杖、旗帜会把武器长度算进身高，低伏/前倾奔跑又会
  把姿态压缩误判成矮个；这两类素材必须按头部—躯干—脚部主体轮廓与基准同屏比较，已经由用户确认
  的人工体量优先，Alpha 工具只用于脚线和异常帧诊断。仓鼠民兵的草叉与仓鼠斥候的前倾跑姿属于
  明确例外。民兵旧 running 用 5px 形态学开运算仍会残留较粗杆件；2026-08-24 结合新 idle 复核后，
  使用 11px 开运算才完整剔除草叉，站立主体中位高度约 129px。对齐仓鼠战士约 79.029 世界像素的
  站立可见高度，标定为 `displaySize:313.664397`，不得回退到计入武器后的全 Alpha 高度算法。
- **脚线同步**：`footOffsetY = (Alpha中位底线-frameHeight/2)×displaySize/frameHeight`，
  `spriteOffsetY = -footOffsetY`。`render.hudOffsetY` 默认119；换尺寸时三项必须同批修改，
  禁止只缩贴图造成脚底、深度线和血条分离。
- **碰撞标准**：默认 `groundRadius=20`、`collisionRadius=20`、`bodyHeight=100`、`size=64`，
  且 `render.collisionWidth=40`、`render.collisionHeight=100`。配置是碰撞编辑器与运行时真源，
  实体构造器必须从 archive/render 读取，不能在子类另留一套不一致硬编码。
- **当前基准覆盖**：战士、盾卫、射手、火枪手、探险家、赏金猎人、
  美洲豹战士、仓鼠牧师、丛林祭司、沙漠祭司均按本规则标定。新增同类单位若确需更大/更小，
  必须由用户或设计配置明确声明特殊体型，并仍重新量化脚线与碰撞，不能隐式偏离；民兵、斥候
  按上一条主体轮廓例外处理，但碰撞继续使用同一20×100标准。

#### 2026-08-20 友军战斗与生命周期统一
- **六维必须真实生效**：配置 `attackDamage` 是初始六维下的基准伤害；运行时通过
  `Companion.getPhysicalAttackDamage()` 按“当前物攻/初始物攻”缩放，并结算
  `crit-目标critRes` 与1.5倍暴击。友军承伤统一走 `Companion.takeDamage()` 的
  物防/魔防减伤，兵种实体禁止再直接 `hp -= damage`。
- **激励只做临时修饰器**：`_inspireMul` 由移动系统和伤害入口动态消费，不直接乘除
  `data.atk/aiConfig/_attackDamage`；否则激励期间升级或重算属性，到期会把新基础值除低。
- **死亡必须解绑所属建筑**：单位移出 `Game.entities/friendlyUnits` 前调用
  `detachFromOwner()`，同步从 `_barracks.units` 或 `_hut.miners` 删除，禁止历史死亡引用
  持续堆积。
- **手动兵种名单必须覆盖全登记表**：仇恨分类、移动朝向、烟尘等若仍使用显式
  `_isHamsterXxx` 列表，新增兵种时必须同步；优先逐步收敛到 `getUnitKind()`。
- **高阶兵种继承低阶实体时先判子类身份（仓鼠方阵 2026-08-26）**：子类会同时持有父类标记，例如
  `HamsterPhalanx extends HamsterGuard` 同时满足`_isHamsterPhalanx`与`_isHamsterGuard`；`getUnitKind()`必须先判
  `phalanx`再判`guard`，否则升级、兵线、快照和后台编制都会静默记成低阶兵种。可复用父类AI、RTS、承伤和解绑，
  但动画时长不同的死亡流程应在子类调用`super._startDying()`后覆盖计时，避免父类常量提前删尸体。

#### 0. 六维属性公式源（2026-08-16：仓鼠单位一律怪物公式）
- 仓鼠友军单位 `statFormula: 'enemy'` → `Companion._enemyCombatStats` 分支：派生数值
  （atk/def/matk/mdef/crit/critRes）逐项走怪物同款公式（combat-formulas
  enemy.calculateCombatStats）：物攻 round(str×0.5+dex×0.5)、物防 floor(con×1.5+str×0.3)、
  魔攻 floor(int×0.5+wis×0.5)、魔防 floor(wis×1.2+int×0.3)、暴击 floor(2+luck)、
  暴抗 floor(con)。HP/等级不走此分支（HP 由 baseMaxHp/con 公式在 updateMaxStats 定，
  等级仍 baseLevel+经验）。
- 伙伴（伊莉丝/露娜，含凯斯/塞拉）无此标记，**按玩家公式**（2026-08-16 用户确认）：
  物攻 round(10+str×0.05+dex×0.1)、物防 Math.round(con×1.2+str×0.3)、
  魔攻 floor(int×1.5+wis×0.5)，且不产生怪物专属字段（mdef/crit/critRes）；
  test-hamster-guard.mjs 1.6 节已锁定——勿给 companion-config 加 statFormula。

#### 1. 素材与帧布局
- 精灵图入 `assets/companions/<id>/`（idle/walking/mining/dying 各一张），
  512×512 帧、8 列 × 4 行网格（先目检行列与有效帧数，再配 frameCount）。
- 动画帧配置放**独立** `data/<id>-config.json`，**不要**塞进 companion-config.json——
  那会让它出现在招募池/队员面板；世界-122 工人类单位用独立配置 + BootScene 显式注册。
- **视觉体量对齐（2026-08-23 统一）**：不能只比较 512×512 画布；先量 running 全部有效帧
  的 Alpha 内容，并用 `Alpha中位高度 × displaySize / frameHeight` 生成首轮候选。没有特殊说明且
  姿态直立、无突出长装备的步兵/施法友军，使用上文仓鼠牧师 **75.684px** 可见高度基准；长武器、
  旗帜、低伏或前倾素材必须按上文主体轮廓例外人工复核，不能直接采用整框 Alpha 候选，也不能
  机械照抄仓鼠牧师的250。确定 `displaySize` 后同步按
  `(bbox.bottom - frameHeight/2) × displaySize / frameHeight` 重算 `spriteOffsetY`
  （取负）与实体 `footOffsetY`（取正），并调整 `config.render.hudOffsetY`；禁止只放大
  `displaySize` 而不校准脚底/血条。
- **兵种 UI 图标（2026-08-22）**：正式图标统一放在 `assets/ui/unit-icons/`，兵种到路径的
  单一映射维护在 `src/config/hamster-unit-icons.js`；出兵面板、当前出兵摘要、RTS 编组与单位
  详情都只调用 `getHamsterUnitIcon(unitKind)`。未登记的特色兵种和敌军保留文字/符号兜底，
  禁止各面板复制路径表或用动画首帧临时充当图标。

#### 2. 数据（data/hamster-miner-config.json）
- `baseData.con` 控 HP（公式 base100 + con×10 + 每级10；con=10 → 200）。
  **2026-08-16 用户口径：baseMaxHp:100 覆盖（con=10 公式 200 → 100）**。
- `ai`：`walkSpeed/runSpeed`（80）、`miningRange`（**50**，采矿触发 = 50 + 节点半径45 =
  95px，矿工更贴近矿点）、`attackInterval`（2000）、
  `attackDamage`（100）、`decisionMs`（120）、`engageRange`（340，小屋防御交战半径）、
  `attackRange`（48，近战贴脸距离）。
- 显示/碰撞（2026-08-15 缩小 25%）：`displaySize` 99（132×75%）、`groundRadius`
  19.5 / `collisionRadius` 19.5 / `bodyHeight` 97.5 / `size` 63。
- `animations`：walk 两段式 `startFrames:[0,11]`（起步完整 12 帧，repeat 0）+
  `loopFrames:[2,11]`（循环第 3~12 帧，repeat -1）；mining 素材 19 帧
  `startFrames:[0,18]`（首次完整挥锄）+ `loopFrames:[4,18]`（后续第 5~19 帧，
  **repeat 0 单次**）——攻击触发才播，间隔定格 `waitFrame`（第 6 帧，索引 5，
  2026-08-15 用户口径）；dying `repeat:0` 只播一次。
  **walking 漂移归一化铁律**：AI 生成走路帧常水平漂移（质心跨度 >2px 即闪回）——
  `tools/ai-gen/hamster-walk-align.py` 按内容质心对齐到 256 + 脚底 FEET_Y=480，
  对齐后帧11→2 循环回跳剪影差异须与相邻帧同级。

#### 3. 实体（src/entities/hamster-miner.js）
- `extends Companion`（复用 data/六维/动画配置/运行时字段），`super(合成 archive)`。
- `_faction='companion'`（友方）；**`_enemyTargetable=true`** 让防守怪可锁定
  （2026-08-18 起正式玩家队友也统一开启）；补 `hp/maxHp` getter + `takeDamage` +
  死亡流程（`_animState='dying'` → 计时 → 从 entities/friendlyUnits 移除）。
- **隐藏背包**：`_energyCarried`（已携带能量）/ `_energyCapacity`（默认 500，
  读 `ai.backpackCapacity`）；`applyHutUpgrades` 同步背包扩容；死亡时携带能量全部
  丢失（飘字提示，不返还不掉落）。
- `update(dt, entities)` 交给 `HamsterMinerAI` 驱动（注册进 Game.entities 由主循环调）。

#### 4. AI（src/ai/hamster-miner-ai.js）
- 每 120ms tick：**只采矿**（2026-08-16 用户口径回归：只能对能源矿点攻击、不攻击
  其他单位）——`pickNearestNode`（只扫 `_isEnergyNode && active && !_depleted`）
  选最近矿点采矿；无交战分支（`_nearestEnemy`/`_tryAttackEnemy` 已移除），怪贴脸
  不还手、可被击杀。另有**路径振荡守卫**（航点跳变 >150px 且无进展 → 清路径重算）。
- 赶路：`_tacticalTarget = 矿点/敌人` + MovementSystem.update（移速 80）；
  到位（≤ miningRange + 节点半径）：站定 `_animState='mining'`（采矿与近战共用），
  每 attackInterval 调 `node.takeDamage(attackDamage, 自身, 'physical', true)`；
  **每次命中置 `m._miningSwing=true`** 通知渲染层播挥锄动画。
- **寻路/避障铁律（2026-08-15 审计）**：矿工与怪物共用 `MovementSystem`
  （A*/PathManager/墙碰撞/避障/卡住滑移）；**寻路目标禁止用障碍物中心**——
  采矿目标用矿点边缘可达点（`approachDist = max(miningRange, 节点半径+自身半径+40)`，
  并**钳制在采矿范围−15 内**——采矿距离 50 时 ≈80px，障碍外可到达且到位即采矿），
  回屋用小屋边缘接近点（64px，触发 70px）。AI 层再加卡死看门狗
  （500ms 位移<3px 累计 2 次 → 挖矿重选目标 / 返回 `WallSystem.findSafeSpawn` 传送）；
  满载用 `_returnTriggered` 防 work/return 振荡。
- **顶墙死循环根因（2026-08-15 实锤 + v2 根修）**：`_followPath` 的移动被
  `WallSystem.resolve` 判“完全阻挡”会每帧 `_clearPath()`（movement-system.js:1071）。
  实锤根因：起步/转向瞬间 vx≈0 产生**亚像素步长**，resolve 返回原地被误判为完全阻挡 →
  路径留不住 → 直线顶墙。v1 根修：**只有有效步长（≥1px）被阻挡才清路径**，亚像素抖动
  直接跳过、速度沿航点累积自然走通。
  **v2 根修（清路径 → 沿墙滑动）**：≥1px 真阻挡时不再清路径，改走
  `_applyNormalMovement` 同款 [SLIDE] x/y 轴向滑动（墙角才减速保留路径），
  交 `PathManager._checkValidity`（1.5~2.5s）定期修复/重算——否则清路径后怪物退回
  直线顶墙（顶到关门门闸/掩体），500ms×2 位移<3px 触发卡死看门狗 → 回屋偶发
  **300px 瞬移**（CDP J 阶段 maxJump 302 实锤）。v2 后 J 连跑 3 次 maxJump<60 全绿。
  接近点外扩到 `max(miningRange, 节点半径+自身半径+40)`（钳制在采矿范围内）；矿工
  卡死看门狗两段（原地脱困 → 传送矿点旁 95px）降级为罕见安全网。
- **背包物流三阶段**：`work`（采矿+自动拾取能量掉落进背包，150ms 节流）→
  背包满 `_startReturn` → 走回小屋 `_startUnload`（idle 2s，不移动不交战；
  小屋 `unloadMiner` 经 EnergyManager 进玩家背包，满则暂存小屋）→ 2s 后
  重新出发（2026-08-17 已删小屋开关门动画，不再调 closeDoor）。
- **挖矿直接入包**：`EnergyNode.takeDamage` 对 `source._isHamsterMiner` 攻击走
  `addMinedEnergy` 直接装隐藏背包（不产生地面掉落，其余来源仍掉落）；实体
  `addMinedEnergy` 按容量封顶，满载后下个决策 tick 即回屋。
- 小屋升级：`applyUpgrades(u)` 同步攻击间隔/伤害/移速/采矿效率；实体
  `applyHutUpgrades` 委托给 AI。

#### 5. BootScene / GameScene
- BootScene：加载 `companion_<id>_<动画>` 四张 sheet；动画注册沿用两段式
  startFrames/loopFrames 逻辑（mining_start 播一次 → mining 循环）。
- GameScene `_syncCompanionSprites`：渲染对象 = `PartySystem.members` +
  `Game.friendlyUnits`；动画分支：`dying`（防重播 data 标记）> `mining`（**攻击触发
  播一次挥锄**：`_miningSwing` + data 标记，首次 mining_start、后续 mining，
  animationcomplete 后定格 `waitFrame` `setTexture(miningKey, miningWaitFrame)`；
  间隔不干预挥锄播放）>
  spell/run > `walk`（**两段式**：`hamsterWalk` 标记，起步 walk_start 完整帧 →
  animationcomplete 切 walk 循环）> idle 停帧；**移动朝向铁律**：walk 时始终面朝
  vx 实际移动方向（`member._isHamsterMiner && moving` → `faceRight = vx > 0`），
  不面朝目标（否则寻路绕行/回小屋会倒退走路）；受击白闪 `hitFlash`；
  尺寸 `member.displaySize ?? PLAYER_DEFAULTS`；多实例共用素材键 `animId`。
- **名称/血条（2026-08-15）**：`_syncEntityHud` 对友方单位取
  `_companionSprites[entity.id]` 精灵锚定（贴图缩放后名字/血条自动跟随）；
  `hasOwnLabel` 含 `_neutralSprites.has(entity)`——已挂中立标签的建筑
  （仓鼠小屋/能源矿/掩体/静态 NPC）跳过 HUD 名字，防重复；以后加建筑自动生效。
  **2026-08-16 用户口径：友军一律不显示名称、只显示血条**——`_syncEntityHud`
  判 `_faction==='companion'` 进 `isFriendly`：血条常显（不再只在残血时画）、
  名字并入 hasOwnLabel 跳过。仓鼠单位与伊莉丝/露娜同规则。
- `_updateDynamicDepths` 的侍从深度查找也要带 friendlyUnits（墙后正常被遮挡）。

#### 6. 生成/仇恨/验证
- `src/world/hamster-miner-system.js`：保留 setup/teardown 兼容；**2026-08-15 起
  矿工由「仓鼠小屋」（`src/world/hamster-hut-system.js`，B 面板 1000 能源建造）生成**，
  `HamsterHut.spawnMiner()` 挂 `_hut` 并注册 entities/friendlyUnits，小屋升级模块
  同步矿工参数、矿工死亡 respawnMs 补员、小屋被毁矿工随拆。坑：`DamageableEntity`
  没有 `this.data`，别写 `this.data.def`（构造即崩）。
- 小屋职责（2026-08-15 扩展）：`unloadMiner` 卸货（玩家背包满 → `_storedEnergy`
  暂存，小屋被毁即丢失）；update 自动把暂存能量补入玩家背包；升级模块新增「背包扩容」
  （每级 +100，满级 10）。**2026-08-17 删除开关门动画**（原模型 16 帧滑门素材，
  小屋换新模型后移除——补员直接生成、卸货不再开门，BootScene 不再加载/注册门动画）。
- PerceptionSystem `_isValidTarget`：放行 `_faction==='companion' && _enemyTargetable`，
  防守怪 `_preferDefenseTargets` 按交战半径锁定（与玩家同链，免 LOS 口径不变）。
- **世界-122目标优先级（2026-08-18）**：统一走
  `src/ai/defense-target-priority.js`。先按128px距离档位，再按
  仓鼠→正式玩家队友→玩家→普通建筑→基地；同类再比真实footprint距离/威胁/残血。
  320px本地无目标时回退远处结构，结构全灭后才搜索远处单位。黑狼自管AI与开门追击
  必须复用同一选择器，禁止再写独立的“基地>玩家>单位”或只认`faction=player`分支。
- 正式玩家队友需同时具备 `_isPartyCompanion/_enemyTargetable/hittable` 与
  `hp/maxHp` 入口；否则会出现“能锁定但攻击判定因 !hittable 跳过”的假攻击。
- 回归运行 `scripts/test-defense-target-priority.mjs`：覆盖距离档位、类型顺序、结构容量、
  近仓鼠胜远基地、战略结构与远单位兜底、黑狼/开门统一接线。
- 验证：`scripts/test-hamster-miner.mjs`（数据+接线契约）+ `tools/cdp-hamster-miner.mjs`
  （实机 38 项：小屋生成/属性/最近节点/**A2 出生房内自动寻路出基地（pmValid 生效、
  无传送跳变、离开小屋>150px）**/**A3 基地门双向感应（感应中心=门洞物理中心、
  矿工站门外侧 100px 关门面自动开门，防门卡死回归）**/采矿挥锄+间隔定格第6帧/每2s-100/行走两段式/
  双向移动朝向（**探针按不变量采样：vx>0 必朝右、vx<0 必朝左，固定时刻采样会撞上
  寻路绕障转向瞬间**）/交战自卫生效/**J 真实回屋寻路（无传送，maxJump<60）**/
  **K 多矿工数量模块并发卸货（能量不丢）**/背包物流/小屋暂存面板/dying 移除）；
  eslint 0 error + vite build。

#### 7. 仓鼠战士（2026-08-16 战斗型友方单位，世界-122 自动近战）

> 首航矿工是"采矿型"，本条目是**战斗型**第二例：独立配置 + 实体 + AI + 世界-122 生成系统，
> 复用矿工整套接线（BootScene 加载/动画注册、GameScene 渲染分支、SceneManager 生成/拆除、
> PerceptionSystem `_enemyTargetable` 放行），差异只在 AI 决策与攻击动画口径。

- **数据（`data/hamster-warrior-config.json`）**：不入 companion-config.json（避免招募池）；
  `baseMaxHp: 225` 生命覆盖（`Companion._maxHpOverride`，镜像 `baseMaxMp`——con=15 公式
  250 → 225，升级仍 +10/级）；六维 力量20/敏捷12/智力3/体质15/精神3/幸运5；移速 120、
  攻击 50/2s、attackRange 55、engageRange 900、followOffset 140。
- **攻击动画两段式（用户口径）**：从待机/移动进入攻击 → 播放**完整 1~24 帧**一次；
  持续攻击中 → **第 6~24 帧循环**（`startFrames:[0,23]` + `loopFrames:[5,23]`，
  GameScene 新增 `hamsterAtk` data 标记分支，attack_start 播完自动切 attack 循环）；
  **帧率与攻击间隔对齐（2026-08-16 二修）**：起步 24 帧 @12fps = 2.0s、
  循环 19 帧 @9.5fps = 2.0s，两段周期均 = `attackInterval`（2000ms）——否则动画
  周期（1.2~1.5s）与 2s 伤害节拍越走越偏，实机表现为"挥砍和掉血对不上"。
  与矿工 mining 的"单次挥锄 + 定格 waitFrame"不同——战斗攻击是连续循环，直到 AI 切回
  idle/walk。**素材帧脚底不在 480**（约 356/512，内容高 ~190）时：用
  `displaySize`（放大到与矿工同屏体量）+ `spriteOffsetY`（脚底贴地）+
  `entity.footOffsetY`（深度线=逻辑脚底）+ `config.render.hudOffsetY`（名字/血条下拉）
  四件套补偿，不需要重排素材。
- **AI（`src/ai/hamster-warrior-ai.js`）**：最近 enemy 索敌（`_faction==='enemy'` 且跳过
  `_isEnergyNode`，**不攻击矿点**）→ 走位 walk（MovementSystem）→ 攻击范围站定 attack，
  每 2s `takeDamage(50)`；无敌人跟随玩家（到达必须清 `_tacticalTarget` + `_clearPath` +
  速度归零，见 lessons #46）；卡死看门狗复用矿工兜底。
- **生成（2026-08-16 改口径）**：~~世界-122 进入自动生成 1 只~~——用户要求删除
  默认在基地旁生成的战士/射手，单位改由**仓鼠兵营**（`hamster-barracks-system.js`，
  每 45s 一个、面板切战士/盾卫）生成；`hamster-warrior-system.js` 保留但主流程不再
  setup（文件供测试脚本引用）。
- **验证**：`scripts/test-hamster-warrior.mjs`（数据+接线契约 34 项）+
  `tools/cdp-hamster-warrior.mjs`（实机 22 项：自动生成/300HP/六维/移速 120/索敌
  最近敌人/50伤×2s/两段式动画/矿点贴脸不攻击/跟随玩家到位 idle/死亡 dying 移除）；
  npm test 全绿 + eslint 0 error + vite build。

#### 8. 仓鼠射手（2026-08-16 远程型友方单位，世界-122 自动射击）

> 战斗型第二例的远程版：复用矿工/战士整套接线（BootScene 加载、GameScene 渲染分支、
> SceneManager 生成/拆除、PerceptionSystem `_enemyTargetable` 放行），差异在
> 「远程 AI + 投射物渲染 + 第 10 帧出膛」。
> **素材**：5 张表（idle 1 / running 11 / attacking 13 / dying 11 / projective 1），512 格 8×4；
> running 前两帧底部有 1~4px 孤立噪点（把 bbox 撑到 y482/490），导入前按「距主体 bbox
> 外扩 40px 之外的 <12px 连通域」清理（attacking/dying 的弓弦/箭身碎段贴近主体，保留）。

- **数据（`data/hamster-shooter-config.json`）**：`baseMaxHp: 150`（con=10 公式 200 → 150）；
  六维 力量12/敏捷20/智力3/体质10/精神3/幸运10；移速 150、攻击 60/2s、attackRange 600、
  engageRange 900、projectileSpeed 600、attackAnimFps 12、attackLaunchFrame 10。
- **远程攻击（参考露娜）**：`AimHelper.lead` 提前量瞄准「目标贴图中心」（`_targetAimY` =
  `target._phaserSprite.y`，无精灵退回 `y - bodyHeight/2`）；攻击动画 13 帧 @12fps 单次
  （repeat 0，AI `_attackSwing` 触发重播），**第 10 帧出膛**：`_launchDelayMs =
  (launchFrame-1)/fps = 750ms`，AI 计时到点生成 `m._basic` 投射物（600px/s 直线飞行）；
  GameScene `_syncCompanionBasics` 迭代 `PartySystem.members + friendlyUnits`，射手用
  projective 贴图渲染箭矢（内容 146×40 尖头朝左，`setRotation(b.angle + Math.PI)`），
  露娜仍走 impact_dot。命中 60 物理伤害，按目标中心半径 28 判定。
- **AI（`src/ai/hamster-shooter-ai.js`）**：射程内站定射击（`_shotActive` 期间 attack 动画，
  动画播完回 idle 等下一发 2s）；敌人超出射程但 < 交战半径 → 走位拉近距离；矿点
  （`_isEnergyNode`）不攻击；无敌跟随玩家（到位清路径归零速度）；卡死看门狗同款。
- **验证**：`scripts/test-hamster-shooter.mjs`（38 项，含**仓鼠战士伤害类型=physical 复核**）
  + `tools/cdp-hamster-shooter.mjs`（实机 21 项：生成/150HP/六维/移速 150/第 10 帧出膛
  674ms/中心瞄准 aimY=贴图中心/箭矢贴图/60 物理×2s/弹道角=AimHelper.lead 重算/矿点不攻击/
  跟随到位 idle/死亡 dying 移除）；npm test 全绿 + eslint 0 error + vite build。

#### 9. 仓鼠军营（2026-08-23 已迁入通用出兵建筑，世界-122 每 45s 补员）

> 仓鼠军营不再拥有独立运行时类和系统；建造、生产、面板、升级、集结、快照及后台结算
> 全部走 `ProducerBuilding` / `ProducerBuildingSystem`。建筑实例持有自己的 `units`，复用战士、
> 盾卫既有实体与 AI。`HamsterHut` 是矿工营地/经济建筑，保持独立，不属于军事出兵建筑。

- **数据/配置（`data/producer-buildings.json#hamster_barracks`）**：
  cost 1500 能源 / hp 2000 / displayW×H 275×245 / footOffsetY 120 /
  spawnIntervalMs 45000 / spawnRadius 90；2026-08-23 起普通出兵建筑不再配置独立 `unitCap`，
  只受房屋容量派生的全局军事人口限制；单位基准值**实时读**
  `data/hamster-warrior-config.json` + `hamster-guard-config.json`
  （通用单位工厂映射，不硬编码 50/60 伤害）。旧 `data/hamster-barracks-building.json`
  与 `hamster-barracks-system.js` 只供遗留诊断工具兼容，不得再由游戏运行时导入。
- **单位类型切换**：`setUnitType('warrior'|'guard')`，面板两个按钮
  （战士近战 / 盾卫近战·第 10 帧判定；射手/民兵 2026-08-18 已迁靶场/草屋并清理死注册），
  切换后下一次生成生效且**重置 `_spawnTimer` 重新计时**（2026-08-18 口径，原「保留计时」作废）；`_findUnitSpawn` 兵营周围
  90px 内 WallSystem 校验合法落点（兜底兵营脚下）。

#### 10. 仓鼠盾卫（2026-08-16 战斗型第三例，兵营单位）

> 战斗型第三例：近战 + **攻击动画第 10 帧判定伤害**（区别于战士的"间隔出伤"、射手的
> "第 10 帧出膛"）。用户口述"4×8 裁剪"与实测不符——**素材实测 8 列 × 4 行、512² 格
> （4096×2048）**：idle 1 / running 17 / attacking 12 / dying 15 帧（目检铁律再次验证）。

- **数据（`data/hamster-guard-config.json`）**：`baseMaxHp: 300`（con=25 公式
  100+250=350 → 300，2026-08-16 用户口径）；`statFormula:'enemy'`（六维派生走怪物公式，见工作流
  第 0 条）；六维 力量13/敏捷10/智力3/体质25/精神3/幸运3；移速 100、
  攻击 30/2s、attackRange 55、engageRange 900、attackAnimFps 12、**attackDamageFrame 10**。
- **第 10 帧判定机制**：攻击动画 12 帧 @12fps 单次播放（repeat 0，1.0s）；AI 挥击
  （`_swingActive`，同射手 `_shotActive` 状态机）起手后 `_damageDelayMs =
  (attackDamageFrame-1)/fps = 750ms` 出伤一次，动画播完回 idle 等 2s 间隔；
  GameScene 攻击分支并入射手"单次播放 + 定格末帧"（`member._isHamsterShooter ||
  member._isHamsterGuard`），零新渲染分支。
- **AI（`src/ai/hamster-guard-ai.js`）**：最近 enemy 索敌（跳过 `_isEnergyNode` 矿点）
  → 走位 walk（MovementSystem）→ 攻击范围挥击站定；无敌人跟随玩家；卡死看门狗同款。
- **生成**：兵营 `unit.guard` + 面板第三按钮；升级同步映射
  `_isHamsterGuard → 'guard'`；`scripts/test-hamster-guard.mjs` 59 项全绿
  （含**四仓鼠单位怪物公式派生逐项校验** atk/def/matk/mdef/crit/critRes——
  盾卫 12/41/3/4/5/25，HP 350 不变）。
- **升级模块（复制仓鼠小屋口径）**：每级统一 1000 金币 + 500 能源——攻击加速
  （间隔 -6%/级）、攻击强化（伤害 +12%/级）、机动强化（移速 +5%/级）、
  生命强化（生命 +10%/级）；矿工专属的采矿效率/背包扩容不复制，数量模块也不设
  （兵营上限固定 5，初始即有，无需"仓鼠增援"）。`upgradeModule` 先扣资源再升级，升级后
  `applyUpgradesToUnits()` 让**现有单位实时生效**（不是只对新单位生效）。
- **升级同步两坑**：① 战士/射手 `applyBarracksUpgrades(u)` 必须同时写
  `_ai._attackInterval/_attackDamage/_attackRange` 与 `aiConfig`（AI 每帧从
  `_ai` 读间隔/伤害、渲染/契约从 aiConfig 读）；② 生命强化走
  `_maxHpOverride` + `updateMaxStats()`（Companion 构造后 hp 已按 con 公式算好，
  直接改 maxHp 不会重算当前血量比例）。
- **生命周期**：单位死亡 → `aliveUnitCount() < unitCount()` 计时补员（死亡后
  从下个 45s 节拍开始）；军营出售/被毁 → `_despawnUnits()` 同步拆单位（active=false
  + 移出 entities/friendlyUnits），面板自动关闭；teardown 离场同样拆干净。
- **面板（`ProducerBuildingPanel`）**：状态区（等级/耐久/存活数/下次生成秒数）、
  类型切换按钮、4 个升级按钮、出售（返还 50% 能源）；点击兵营开/关，
  玩家距离 >260px 不可交互。**出发进度条实时刷新（2026-08-16）**：面板打开期间
  `setInterval(100ms)` 只更新 `#hbSpawnBar` 宽度/百分比/剩余秒数（querySelector
  直改，不重建 innerHTML），CSS `transition: width 0.2s linear` 平滑增长；
  关闭面板 clearInterval 防泄漏；切换单位类型重置 `_spawnTimer` 重新计时
  （2026-08-18 口径，旧「不重置」说法作废——lessons #55 只保留进度条刷新模式）。
- **验证**：CDP 实机探针——贴图加载、默认战士生成（dmg 50/hp 300）、切射手
  （dmg 60/hp 150）、升 damage 模块后现有战士伤害 50→56 实时生效、
  面板标题/按钮/状态正常、单位死亡后 update 立即补员；eslint 0 error + vite build。

#### 11. 仓鼠民兵（2026-08-17 战斗型第四例，兵营/草屋单位）

> 战斗型第四例：近战 + **攻击动画第 8 帧判定伤害**（区别于战士"间隔出伤"、射手"第 10 帧
> 出膛"、盾卫"第 10 帧判定"）。素材 4096×2048（8 列 × 4 行 512² 格）：idle 1 /
> running 12 / attacking 15 / dying 14 帧（逐帧 bbox 目检 + GLM-4.6V 验收：同一角色、
> 草叉从左往右挥、脚底 ~350 统一）。running 质心漂移 17.5px →
> `hamster-walk-align.py --feet-y 350` 归一化（cx 跨度 0.9px）。

- **数据（`data/hamster-militia-config.json`）**：`baseMaxHp: 125`（con=6 公式
  100+60=160 → 125，2026-08-17 用户口径）；`statFormula:'enemy'`（六维派生走怪物公式：
  力量8/敏捷10/智力3/体质6/精神3/幸运7 → atk 9 / def 11 / matk 3 / mdef 4 / crit 9 /
  critRes 6）；移速 150、攻击 20/2s、attackRange 55、engageRange 900；
  **attackDamageFrame 8**（攻击动画 15 帧 @12fps 单次播放，出伤延迟
  (8-1)/12 = 583ms）；音效与战士/盾卫共用 `hamster_melee_attack.mp3`。
- **实体/AI**：`hamster-militia.js` + `hamster-militia-ai.js` 完全复用盾卫模式
  （`_swingActive` 站定挥击状态机、`MovementSystem` 移动、卡死看门狗、无敌跟随玩家、
  RTS 命令、`_isEnergyNode` 矿点不攻击）；dying 14 帧 @12fps = 1167ms。
- **渲染**：GameScene `_isHamsterMilitia` 并入射手/盾卫"单次播放 + 定格末帧"分支
  （`_attackSwing` 触发），移动朝向 vx、受击白闪同款；草叉显著拉高整框 Alpha，不能按整框
  身高归一，也不能把草叉长度算入主体。当前主体轮廓标定为 `displaySize:313.664397 /
  spriteOffsetY:-58.199449 / footOffsetY:58.199449 / hudOffsetY:119`。碰撞统一为20×100，攻击范围与数值不随贴图缩放。
- **生成**：草屋专属（`producer-buildings.json` unitTypes + PRODUCER_UNIT_CFG/CLASS/
  unitKindOf）；2026-08-18 兵营死注册已清理（unit.militia/导入/生成分支移除，
  旧档兵营 unitType 由 spawnUnit 纠正为战士）；升级同步走 `applyBarracksUpgrades`（复用战士/盾卫模块口径）。
  **顺手修产兵建筑既有 bug**：`applyUpgradesToUnits` 误从 `ai` 块读 `baseMaxHp`
  （恒 300）→ 改为从单位配置根读，民兵 125 等 HP 覆盖真正生效。
- **升级全局化（2026-08-17 用户口径）**：`src/world/unit-upgrade-store.js` 全局兵种升级
  登记表 `GLOBAL_UNIT_UPGRADES`——在任一产兵建筑/仓鼠兵营升级（作用于当前生成兵种）→
  该兵种全局等级 +1，场景内**所有该兵种单位（跨建筑）实时同步**，新生成单位也读全局等级；
  兵营/草屋/铁匠铺共用同一份等级（不叠加）；面板等级 = 当前兵种全局等级。
  仓鼠小屋（矿工）暂保持建筑级（经济模块为主）。等级通过
  `serializeUnitUpgrades/restoreUnitUpgrades/resetUnitUpgrades` 接入主存档：
  场景切换保留、读档恢复、新游戏重置。
- **验证**：`scripts/test-hamster-militia.mjs`（44 项：数据契约/怪物公式派生/
  AI 接线/兵营+草屋注册）+ test-hamster-guard 共享段补民兵派生校验（61 项全绿）；
  `tools/cdp-hamster-militia.mjs` 实机探针（生成/125HP/六维/移速 150/第 8 帧出伤
  583ms 窗口/单次播放无 _start/20 物理×2s/矿点不攻击/跟随到位 idle/死亡移除）；
  eslint 0 error + vite build + npm test 全绿。

#### 12. 仓鼠斥候（2026-08-17 远程第二例，草屋专属单位）

> 远程第二例（参考仓鼠射手）：**攻击动画第 11 帧出膛**、AimHelper.lead 提前量瞄目标
> 贴图中心、投射物 600px/s；**只能在仓鼠草屋生成**（unitTypes=[militia,scout]，
> 铁匠铺/兵营不生成斥候）。素材 4096×2048（8 列 × 4 行 512² 格）：idle 6（呼吸待机）/
> running 13（用户口述 15，实盘仅 13 个有效帧，帧 13/14 为空——配置按 13 修正，
> 否则奔跑循环每圈播 2 帧空白 → 贴图瞬间消失）/ attacking 18 / dying 11 /
> projective 1 帧；running 质心漂移 29px →
> `hamster-walk-align.py --feet-y 282` 归一化（cx 跨度 0.8px）。**2026-08-17 二修**：
> 首版 displaySize 260 用户反馈过小，与战士/盾卫/民兵对比后先调至340，后又调至460；
> 2026-08-23 复查确认其前倾横向跑姿不适合按整框 Alpha 身高归一，恢复用户此前确认的
> `displaySize:460 / spriteOffsetY:-23 / footOffsetY:23 / hudOffsetY:119`；后续必须按主体轮廓
> 比较，不能再用 Alpha 高度候选 `315.04065` 覆盖。

- **数据（`data/hamster-scout-config.json`）**：`baseMaxHp: 100`（con=7 公式
  100+70=170 → 100）；`statFormula:'enemy'`（力量8/敏捷13/智力3/体质7/精神3/幸运10 →
  atk 11 / def 12 / matk 3 / mdef 4 / crit 12 / critRes 7）；移速 150、
  攻击 25 物理/2.5s、射程 600、投射物 600px/s、**attackLaunchFrame 11**（18 帧 @12fps
  单次播放，出膛延迟 (11-1)/12 = 833ms）；出膛音效复用射手素材。
- **实体/AI**：`hamster-scout.js` + `hamster-scout-ai.js` 完全复用射手模式（`_shotActive`
  站定状态机、`AimHelper.lead`、`_targetAimY` 贴图中心、命中半径 28、MovementSystem、
  卡死看门狗、无敌跟随玩家、RTS 命令、`_isEnergyNode` 矿点不攻击）；dying 11 帧 ≈1000ms。
  **2026-08-17 二修（攻击动画）**：斥候攻击动画偶发不播放——AI 挥击计时与动画时长完全相等，
  最后一帧切 idle 时多帧待机分支会打断攻击动画，`animationcomplete` 不触发 → `shooterSwing`
  标记残留 → 下次攻击不再播。修复三件套：① AI 挥击结束主动清 `_attackSwing`；② 动画计时
  +60ms 余量（`_shotAnimMs`/`_swingAnimMs`，播完再切 idle）；③ 渲染层残留自愈分支
  （`member._attackSwing` 置位但 `shooterSwing` 卡 true → 重置下一帧重播）。
  射手/盾卫/民兵同步加 ①③ 修复。
- **渲染**：GameScene `_isHamsterScout` 并入射手"单次播放 + 定格末帧"分支；**多帧待机**——
  idle 6 帧（frameCount>1）循环播放（新增分支，伊莉丝/露娜 idle 1 帧不受影响）；
  投射物渲染 `_syncCompanionBasics` 扩展：斥候尖头朝右（内容宽 172，旋转 = 飞行角，
  与射手尖头朝左 +180° 区分），**帧随单位模型 displaySize 等比放大**；当前单位模型为
  `displaySize:460`，投射物继续读取当前模型比例，不能另存尺寸常量。移动朝向 vx、受击白闪、
  移动烟尘同款；`spriteOffsetY:-23 / footOffsetY:23 / hudOffsetY:119`。
- **生成**：仅仓鼠草屋 `producer-buildings.json` unitTypes=[militia, scout]（默认仍民兵），
  铁匠铺/兵营不含斥候；PRODUCER_UNIT_CFG/CLASS + 兵种升级表（scout 独立全局等级）已注册。

#### 13. 仓鼠火枪与靶场（2026-08-18）
- 素材统一为8列×4行、512×512帧：idle 9、running 11、attacking 21、dying 15；
  配置唯一源 `data/hamster-musketeer-config.json`，实体/AI分别为
  `hamster-musketeer.js` / `hamster-musketeer-ai.js`。
- AI：最近enemy、跳过能源矿；120px/s、80物理、2.5s间隔、650射程；
  AimHelper.lead瞄目标贴图中心，第10帧出膛并播放fire.mp3。
- 投射物不依赖图片，GameScene以Phaser Rectangle绘制54×4黄色ADD曳光弹，
  弹速1248（P4040同口径），AI负责飞行/墙阻挡/命中。
- 靶场配置在producer-buildings `shooting_range`：按兵种区分产出速度——
  musketeer 60s / shooter 45s（unitTypes 条目 spawnIntervalMs 覆盖建筑级，
  `ProducerBuilding._unitSpawnIntervalMs` 查询）、上限5，复用通用升级和进度条；
  切换兵种重置 `_spawnTimer` 重新计时（2026-08-18，兵营 45s/草屋同口径）。
  仓鼠兵营只允许warrior/guard，旧shooter实例兼容但禁止继续选择/生成。
- 新兵种必须同步BootScene加载/动画注册、GameScene仓鼠标记分支、
  PRODUCER_UNIT_CFG/CLASS、unit-upgrade-store和defense-target-priority。
- 回归：`scripts/test-hamster-musketeer.mjs`。
- **验证**：`scripts/test-hamster-scout.mjs`（数据契约/怪物公式派生/AI 接线/草屋专属断言）
  + test-hamster-guard 共享段补斥候派生；`tools/cdp-hamster-scout.mjs` 实机探针
  （生成/100HP/六维/移速 150/第 11 帧出膛 833ms 窗口/中心瞄准/箭矢贴图尖头朝右/
  25 物理×2.5s/矿点不攻击/多帧待机/跟随到位 idle/死亡移除）。

#### 13.1 仓鼠赏金猎人（2026-08-22）

- 独立配置 `data/hamster-bounty-hunter-config.json`，四张 8列×4行、512×512 帧表：
  idle 8、running 13、attacking 13、dying 11；BootScene 必须以独立 `animId`
  预载和注册，不能继续借用仓鼠火枪动画。
- 六维力量/敏捷/智力/体质/精神/幸运为 5/25/3/12/3/30，采用怪物属性公式，
  基础生命 150、移速 160、射程 600、攻击间隔 1.25 秒。
- 正式素材的 alpha 主体高度接近整张512px帧格，不能沿用主体仅约200px高的普通火枪素材尺寸；
  2026-08-23 已按仓鼠牧师 Alpha 实体高度基准重标为 `displaySize:103.058511 /
  spriteOffsetY:-38.445655 / footOffsetY:38.445655 / hudOffsetY:119`。
- 攻击动画固定 10.4fps，在第 9 帧（约 769ms）出膛；复用火枪 1248px/s 黄色曳光弹，
  但起点按朝向使用枪口偏移 `muzzleOffsetX=76`、`muzzleHeight=76`，墙阻挡与弹道计算也必须
  使用同一个枪口世界坐标。赏金猎人继承火枪武器入口，因此同样消费铁匠铺穿甲弹等级；命中后还与
  仓鼠斥候共用铁匠铺“标记”能力的概率、持续时间和 +15% 受伤标记效果。
- 专属开火音效由 `sounds.attack` 配置为
  `assets/sounds/friendly/hamster_bounty_hunter_attack.mp3`；继承的火枪 AI 只在第 9 帧真正创建投射物后播放，
  并走 `SoundManager.playWorld` 的位置衰减。禁止在攻击起手或逐帧动画同步中重复播放。
- 击杀金币奖励与怪物本次正常掉落共用同一个随机底数：先算不含祭品加成的默认地牢金币；探险家营地
  专属“赏金”升级 Lv.1 额外获得该底数的 1.25 倍，之后每级 +0.15，Lv.6 为 2 倍。Lv.0 不提供额外金币，
  怪物原本实际掉落及祭品金币倍率保持原结算顺序。
- 作为正式世界战斗单位，必须登记到 troop-line 军事兵种白名单，保证跨位面编队可序列化和重建。

#### 13.2 仓鼠兵种三分类与骆驼骑兵（2026-08-23）

- 仓鼠军事单位分类的唯一入口为 `src/config/hamster-unit-categories.js`：步兵、骑兵、法术。矿工不是军事单位，非仓鼠特色友军不得为了凑齐三类而强行登记。
- 只完成素材阶段的新单位使用独立 `data/<id>-visual.json`，允许 BootScene 预载并注册动画，但不得进入 `UNIT_KIND_CFG`、`PRODUCER_UNIT_CLASS`、生产建筑、后台模拟或存档兵种白名单；这些入口意味着已经存在属性和生命周期契约。
- 骆驼骑兵正式兵种键为 `camel_cavalry`，配置真源为 `data/hamster-camel-cavalry-config.json`，实体为 `HamsterCamelCavalry`。待机24帧、行走16帧、攻击16帧、死亡16帧，均为8列、512×512帧格；复现脚本与源帧索引保存在 `tools/ai-gen/camel-cavalry-video-rebuild.py` 和成品目录 `report.json`。
- 骆驼骑兵以仓鼠骑士为基准提高生命、伤害和物防15%：690生命、115普攻、45基础物防；基础移速按后续口径与仓鼠骑士保持一致为210。攻击间隔2秒，第9帧伤害结算；视频没有冲锋动作，所以复用轻骑的普通近战状态机但不登记骑士冲锋。
- 骆驼移动表主体中位高度310.5px、脚底中位线480px；按仓鼠轻骑默认体量换算为 `displaySize:296.425121`、`spriteOffsetY:-129.7`、`footOffsetY:129.7`，使实际屏幕主体高度同为约179.77px。碰撞、属性、移速和动画节拍保持不变。
- `desert_mansion` 是其唯一生产建筑，90秒/名、300粮食、上限5；独立升级项目 `desert_cavalry_standard` 提供伤害、生命、移速、防御四项通用倍率，并提供专属“骆驼惊吓”：600px持续光环，Lv.1降低敌方伤害输出10%，每级+2%，Lv.6为20%，同类不叠加。正式化时必须同步 BootScene、`PRODUCER_UNIT_CFG/CLASS/CONFIG_PATH`、`UNIT_KIND_CFG/getUnitKind`、troop-line 与世界后台模拟，避免出现前台可见但存档或离场结算丢失的半成品单位。

#### 13.3 美洲豹战士“丛林之王”（2026-08-23）

- `feature_unit_standard.jungleKing` 是美洲豹战士专属升级：Lv.1 伤害 +10%，之后每级 +2%，Lv.6
  为 +20%。通用伤害增幅继续折入 `attackDamageMult`，现存和后续单位消费同一升级补丁。
- 升级至少 1 级时，`JaguarWarrior.getPhysicalAttackDamage()` 通过 `getEnemyFamilies()` 读取目标全部
  分类标签；任一标签为“动物”时，最终物理伤害乘 2。黑狼、红狼王登记为动物，僵尸犬同时登记为
  “僵尸”和“动物”，因此既参与僵尸机制也承受动物特攻。
- **怪物多分类协议（2026-08-23）**：保留 `family` 作为主分类以兼容旧数据，新增可选 `families:string[]`
  表达多个归属；统一通过 `getEnemyFamilies/hasEnemyFamily` 查询，禁止新增 `config.family === ...` 单值判定。
  图鉴分类页和详情标签也必须消费完整标签集。同一机制命中多个 family 倍率时取最高值，不重复叠乘。

#### 13.4 丛林祭司专属魔法升级（2026-08-23）

- `feature_unit_standard.junglePower` 只覆盖丛林祭司：模块 Lv.1~6 映射三种技能实际等级 Lv.2~7，
  即相对基础 Lv.1 分别 +1~+6。闪电、冰锥、火球必须全部登记在祭司 `skills`，升级完成时同步技能对象；
  闪电保留旧基础伤害，只按 `lightningStrike` 配置公式相对 Lv.1 的成长比例放大，避免升级接入改变 Lv.0 基线。
- `feature_unit_standard.nimbleHaste` 只覆盖丛林祭司：冷却倍率依次为 0.90/0.85/0.80/0.75/0.70/0.65。
  倍率同时进入祭司轮换间隔与 `BoltSkillSystem` 冰锥/火球冷却；升级中已有剩余冷却按新旧倍率比例即时缩短。
  后台战斗按三种真实技能公式的平均等级成长比例和同一冷却倍率估算，禁止仅改前台施法。
- 两张卡使用独立 209×209 透明冷钢图标 `jungle-power.png`、`nimble-haste.png`，并遵守同类建筑
  唯一持续升级槽、全局等级存档与现存/后续单位实时同步协议。

#### 14. 仓鼠牧师、教堂与激励魔法（2026-08-18）

- **素材/数据**：独立配置 `data/hamster-priest-config.json`，4 张 8列×4行表：
  idle 10、running 13、dying 16、praying 17 帧。六维为 5/5/20/5/15/5，
  `statFormula:'enemy'`、`baseMaxHp:100`、移速120；初始 `skills:['holyLight']` 即 1 级圣光。
- **教堂生产**：`producer-buildings.json.church` 为唯一配置，90 秒补 1 名、上限 2 名，
  仅生产 `priest`；必须同步 `PRODUCER_UNIT_CFG/CLASS`、`unit-upgrade-store`、
  BootScene 贴图加载和 GameScene 友军动画分支。
- **不可打断施法状态机**：圣光与激励都进入 `HamsterPriestAI._startPrayerCast`，锁移动、
  锁决策、播放一次 `praying`，**第 8 帧**结算，完整 17 帧结束后才允许跟随/下一次施法；
  指令不能取消进行中的 praying，死亡是唯一允许中断。
- **圣光逻辑**：冷却就绪时优先选受伤比例最高的玩家/友军/自身；全员满血时才选择
  600px 内最近 enemy 造成圣光伤害。教堂升级 `castSpd` 为 CD 每级 -5%，
  `holyLight` 每级 +1 圣光等级；升级必须同时同步当前单位与后续生成单位。
- **铁匠铺研究「激励魔法」**：全局能力 `inspire_magic`，Lv.1 解锁后每位牧师各有
  30 秒 CD；在自身 300px 内对 player/companion 施加既有 `applyInspire`
  （移速×1.33、物攻×1.5）。持续时间 Lv.1=10 秒、Lv.10=20 秒；重复施加只刷新时间。
  `Companion` 需要具备 statusEffects 的计时、applyInspire 与到期还原，所有仓鼠 update
  和 PartySystem.updateCombat 都必须推进该计时，GameScene 的 inspire 光环还须遍历正式队友。

---

