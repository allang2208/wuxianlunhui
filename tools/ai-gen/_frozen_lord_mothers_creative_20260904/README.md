# 雪原五领主创意 V2（2026-09-04）

## 方向调整

用户指出领主不必完全沿用雪原旧怪同类。本批撤销“一条普通/精英生态链对应一只领主”的限制，只继承雪原材质、白底母图、右向 3/4 视角和可制作动画的项目契约。

- `futurePlanOnly: true`
- `runtimeIntegrationActive: false`
- `userApproved: true`（五个身份母题获准继续制作动画候选）
- `animationAuthorized: true`
- V1 已被本批独立创意方向取代，不再作为正式归档内容保留。
- 没有改 `enemy-config.json`、地牢池、怪物注册表或任何运行时代码。

## 五个独立母题

| Key | 名称 | 核心轮廓 | 战斗母题 |
| --- | --- | --- | --- |
| `snowSepulcherCarrier` | 雪冢驮城兽 | 六足活体雪山，背负并融合破败塔楼 | 移动堡垒、犁雪冲阵、塔垛坠落 |
| `auroraFateWeaver` | 极光织命母 | 腹部是织有极光膜的开放生物圆环 | 空间连线、读取历史位置、远距控场 |
| `whiteSilenceBellHart` | 白寂鸣钟鹿 | 高脚空腔骨架，腹中悬挂巨型冰钟 | 节拍预警、延迟回响、蹄击序列 |
| `permafrostChasmMaw` | 永冻地渊喉 | 环形巨口、六只掘雪足与三枚寒气背鳍 | 地上/地下切换、吸入吞噬、伏击 |
| `frozenSunCoreRelic` | 冻日核骸 | 冰壳包裹熔核，四足支撑锚定石环 | 冷壳防御与熔核暴露的冷热相变 |

## 文件

- `mother/`：五张创意 V2 母图。
- `design/frozen-lord-creative-combat-and-state-machines.md`：攻击、阶段与状态机规格。
- `prompts.md`：最终生成提示词归档。
- `manifest.json`：候选状态与路径。
- `animation/direction-reference.md`：朝向、运动参照和逐状态闸门。
- `animation/reference-source/`：不覆盖原母图的动作就绪方向修正版。
- `animation/references/`：等比放入 1024×576 白底的 H3 首帧。
- `animation/action-keyframes/`：通过身份与朝向门槛的动作专用首帧。
- `animation/action-references/`：等比放入 1024×576 白底的动作 H3 首帧与联系表。
- `animation/prompts/`：移动样片与签名动作的 H3 提示词。

本批已完成五条 MiniMax H3 移动样片并逐帧复核；这些移动样片仍停在候选素材层。驮城兽、织命母、鸣钟鹿通过基础方向/拓扑闸门并继续进入签名动作制作；地渊喉因三对足不可验证、冻日核骸因主体轴向转身而拒绝并冻结后续状态。详见 `animation/direction-reference.md`。

动作专用批次另生成 4 条 H3：鸣钟鹿 `double_toll_body` 通过本体动作门槛；驮城兽 `plow` 因偏航、织命母 `triangle_weave` 因生成外部技能几何、核骸 `cold_idle` 因擅自进入热相而拒绝。地渊喉没有越过上游拓扑门槛，因此未生成动作。鸣钟鹿在 2026-09-05 已继续制成正式本体表，仍未接入运行时。

v02 定向修正另生成 3 条 H3：驮城兽把完整冲撞拆为原地 `plow_prepare` 后通过并于 2026-09-05 制成正式本体表；织命母已去除外部技能几何，初审曾因极光膜中段消失而拒绝；核骸以 imagegen 冷蓝暗核首帧解决热相污染后，右侧尖突又发生大幅颚状运动，仍拒绝。

2026-09-05 用户复判织命母 v02 可用，并把膜消失解释为主动“抽膜—释放—重织”。现已将 `triangle_weave_body` 制成 41 张未插帧透明源键、一次性非回绕 RIFE 2× 的 81 帧正式表和 3.333 秒 GIF；正式 `f48` 为释放事件帧。产物与事件合同见 `animation/formal/aurora-fate-weaver/spritesheet-manifest.json`。这只解锁本体动作资产；三角织点/连线 VFX、伤害、AI 状态机与运行时接入仍未执行。核骸和地渊喉的冻结状态不变。

同日继续收口另外两条已过门的本体动作：

- 雪冢驮城兽 `plow_prepare`：源窗 `f8..f100`，47 张透明原生键，经一次非回绕 RIFE 2× 得到 93 帧、3833ms；正式 `f60` 达到完全压低姿态。图集 `3840x3072`，根点锁定。Collider 冲锋、雪犁轨迹、撞击与伤害仍冻结，见 `animation/formal/snow-sepulcher-carrier/spritesheet-manifest.json`。
- 白寂鸣钟鹿 `double_toll_body`：源窗 `f12..f84`，37 张透明原生键，经一次非回绕 RIFE 2× 得到 73 帧、3000ms；`f24` 触发无伤提示环，`f50` 触发伤害环，两事件相隔约 1083ms。两道环、伤害、第三回声和运行时状态机仍冻结，见 `animation/formal/white-silence-bell-hart/spritesheet-manifest.json`。

至此三条已通过的签名本体动作都有正式透明表与 GIF；这不等于三只领主的完整动作族或运行时实现已经完成。核骸和地渊喉的冻结状态不变。

## 2026-09-05 豆包：雪冢驮城兽 `advance`

- 开工前重新核对移动专用参考、H3 实际步态联系图与 `plow_prepare` 正式源帧，固定右向低三分之四体轴、六足三对职责、刚性融合塔楼和脚线。豆包 `--fill-only` 回读 875 个编辑器字符，SHA-256 为 `d3594a7dfed88acac0ad81085c36134bc06232739153ea2b8c739eb0d21d1559`，只提交 1 个 `Seedance 2.0 Mini` 候选。
- 原片 1280x720、24fps、121 帧。人工拒绝了全帧相似度给出的伪接缝后，按下半身脚相位选定半开循环窗 `[f25,f113)`；保留 44 张原生键，一次回绕 RIFE 2x 得到 88 帧。
- 正式单格 `448x256`，图集 `3584x2816`，3667ms、约 24fps、`repeat=-1`；Alpha 底边 `y=239..240`，无空帧、触边帧或透明区脏 RGB。正式包与可视 GIF 位于 `animation/formal/snow-sepulcher-carrier/advance/`。
- `plow_prepare` 与 `advance` 两表合计解码 RGBA `83.5000 MiB`，低于 Boss 128 MiB 目标。导航、世界位移、碰撞、攻击状态机和 `plow_move` 依赖没有进入素材，仍未运行时接入。

## 2026-09-05 豆包：雪冢驮城兽 `trample_body`

- 行走参考与 `plow_prepare` 都不具备清楚的单足踏地起势，因此使用内置 imagegen 从已认可移动图编辑出近侧前足抬起、其余五足承重的六足关键帧，再仅以等比缩放和白底补边制成 1024x576 豆包参考；没有横向拉伸。
- 豆包 `--fill-only` 回读 714 个编辑器字符，SHA-256 为 `8e398ac073b4ba07e36447eefa6b31e4946a7a8bc1056f649ce9defa704589b8`；只提交 1 个 `Seedance 2.0 Mini` 候选。原片 1280x720、24fps、121 帧，源 `f26` 是唯一首次踏地点。
- 正式动作取源 `f0..f84` 偶数帧，共 43 张原生键，经一次非回绕 RIFE 2x 得到 85 帧；单格 `480x256`、图集 `3840x2816`、3500ms。Alpha 底边全程 `y=239`，无空帧、触边帧或透明区脏 RGB。
- 0-based 接触事件为 `f26`。正式包和 GIF 位于 `animation/formal/snow-sepulcher-carrier/trample-body/`；三张驮城兽正式表合计 `124.7500 MiB`，仍低于 Boss 128 MiB 目标。210x160 前方矩形、伤害、击退、震波、接敌距离与运行时状态机仍未接入。

## 2026-09-05 雪冢驮城兽 `tower_drop_body`（正式表完成）

- 使用内置 imagegen 从已认可 `action-ready-v03` 精确编辑出六足宽距撑地、塔身竖直的动作母帧，并等比整理为 1024x576 豆包参考。动作仍只做本体承重；三处预测点、落石、伤害、每目标最多两次命中与状态机均留给运行时。
- v01 `--fill-only` 回读 768 字符、哈希 `a522a7562a4f144792a124ad94b0d4f7fe99b3bfffb0ba70457274e401bee166`。原片保住塔楼和六足大身份，但三拍间发生明显偏航与左右摆身，在原片方向/节拍门拒绝；预览为 `animation/videos/01-snow-sepulcher-carrier-tower-drop-body-doubao-v01_preview.gif`。
- v02 加入塔尖、头甲、身体中心和六个落脚点横坐标锁定；`--fill-only` 回读 869 字符、哈希 `ec8a35e5a79bfdfe12e33b07d394f2169add6508127d9f93cc1a098db07706d1`。朝向显著改善，但只生成两次长压低，没有三次完整下—上脉冲，因此仍在原片节拍门拒绝；预览为 `animation/videos/01-snow-sepulcher-carrier-tower-drop-body-doubao-v02_preview.gif`。
- v03 改成六个明确关键姿态，`--fill-only` 回读 723 字符、哈希 `9676382b089dff4ce16cec67048462bfb234b9200c80d5bc93dab6c26b7b4bc8`。生成请求最终停在“今日视频免费额度已用完、继续将消耗付费额度”的确认页；没有代用户确认付费、没有重复提交，也没有 v03 成片。
- 免费回退的 H3 v04 保住大体相机和塔楼，却把压震扩展为贯穿全片的多次大幅蹲伏；Ref2VA v05 虽跟随三拍轨迹，却把身份重画成悬空细腿龙和异形城市，分别在节拍门、身份/足锚/塔楼门拒绝。两条都没有进入抠图或正式表。
- 豆包 v02 五帧精确复用形成的 v06 曾通过结构门，但用户检查 GIF 后以“动作太僵硬”明确否决；该表只留作废案审计。H3 v07 让关节过渡变柔和，却把三拍融合成一次长下压，同样在动作语义门拒绝。
- H3 v08 将动作重设为一次自然的后足蓄力、前躯抬势、重压架势、稳定发射保持和完整回正；三枚塔垛改由运行时在保持窗触发，不再让六足机械重复蹲伏。原片使用已认可 `advance` 参考双锁首尾，六足、右向轴和融合塔楼通过动态门禁。
- 正式表取源 `f0,f2,...,f122` 共 62 张 BiRefNet 透明键，经一次非回绕 RIFE 2x 得到 123 帧 / 5083ms；单格 `448x256`、9 列 x 14 行、图集 `4032x3584`。外部事件拍为 0-based `f64/f72/f80`，相隔约 331ms；Alpha 底边均为 `y=239`，无空帧、触边帧或透明区脏 RGB，原生键保留在偶数索引。
- 驮城兽四张正式表合计解码 RGBA `179.8750 MiB`，按用户已知情继续并要求自然动作重生登记为超过 128 MiB 目标的例外，仍低于 256 MiB 硬停线。`plow_move`、三个预测落点、落石/VFX、120 半径命中、`1.45x` 伤害、同目标最多两次命中、11 秒冷却和运行时状态机继续冻结。

## 2026-09-05 豆包：极光织命母 `oldstep_body`

- 先用内置 imagegen 在已认可身份源上只收回两条织线臂，得到动作首帧 `animation/action-keyframes/02-aurora-fate-weaver-oldstep-prepare-v01.png`；相机、右向轴、六条承重步足、开放背环和极光膜保持不变。
- 豆包先执行 `--fill-only`，回读的 664 个编辑器字符与本地提示哈希一致；随后只提交 1 个 `Seedance 2.0 Mini`、16:9、5 秒候选，没有自动重抽。
- 原片为 `1280x720`、24fps、121 帧、约 5.056 秒。离线抽样确认三拍织臂依次落在源 `f24/f50/f66`，根点与镜头固定，无历史落点、攻击框或伤害特效；尾部 `f85..f120` 是长停留，不进入正式表。
- 正式动作取源 `f0..f84` 的偶数帧，共 43 张 BiRefNet 透明原生键；浅色六足、双织臂、开放背环和极光膜通过抠图探针。一次性非回绕 RIFE 2× 后得到 85 帧、3500ms，单格 `320x256`、8 列 x 11 行、图集 `2560x2816`。
- 0-based 相位为 `hold_prepare 0..12 -> lower_arm_beat 13..30 -> upper_arm_beat 31..56 -> dual_arm_beat 57..68 -> recover 69..84`；三次外部打击事件为 `f24/f50/f66`，1-based 消费者对应第 `25/51/67` 帧。
- 正式包见 `animation/formal/aurora-fate-weaver/oldstep-body/spritesheet-manifest.json`；与 `triangle_weave_body` 合计解码 RGBA 约 `55.3438 MiB`，见 `animation/formal/aurora-fate-weaver/family-sprite-budget-manifest.json`。历史位置快照、三段攻击区/VFX/伤害与运行时状态机仍冻结。

## 2026-09-05 豆包：极光织命母 `tether_body`

- 动作首帧采用内置 imagegen 精确编辑。首稿因落脚拓扑退化在上传前拒绝；v02 恢复身份源的六足职责和原脚位，只让两条织线臂上下张成宽 V 形，见 `animation/action-keyframes/02-aurora-fate-weaver-tether-prepare-v02.png`。
- 豆包先执行 `--fill-only`，编辑器回读 736 字符、提示哈希 `562ec7e64da27e6908936182d4c4f73494ffffc4c6c851db7f6172aa6a360f4c`；随后只提交 1 个 `Seedance 2.0 Mini` 候选，没有自动重抽。
- 原片为 `1280x720`、24fps、121 帧、约 5.056 秒。32 点联系图与 20 帧织臂近看表确认右向镜头/根点稳定，动作完成“张臂捕捉—合扣—回卷—恢复”，没有生成命线、目标或拉拽特效。
- 正式动作取源 `f0..f104` 的偶数帧，共 53 张 BiRefNet 透明原生键；排除 `f105..f120` 停留尾。一次性非回绕 RIFE 2× 后得到 105 帧、4333ms，单格 `384x256`、7 列 x 15 行、图集 `2688x3840`。
- 0-based 相位为 `hold_prepare 0..12 -> spread_and_lock 13..32 -> tension_hold 33..50 -> cross_and_reel 51..58 -> hold_pull 59..78 -> release 79..96 -> recover 97..104`。`f32` 触发外部命线，`f58` 复查 LOS 并触发外部拉拽，两事件相隔 1083ms；1-based 消费者对应第 33/59 帧。
- 正式包见 `animation/formal/aurora-fate-weaver/tether-body/spritesheet-manifest.json`。织命母目前三张正式本体表合计解码 RGBA 约 `94.7188 MiB`，仍低于 Boss 128 MiB 目标。至多三个目标的选择、命线 VFX、LOS 复查、140 单位位移和运行时状态机仍冻结。

## 2026-09-05 豆包：极光织命母 `cut_body`

- 直接复用已通过方向门的 `tether` 宽 V 首帧作为开放剪刃起势，没有重新生成母图；六条承重步足、两条较短织线臂、开放背环和环内极光膜的身份门保持不变。
- 豆包 `--fill-only` 回读 671 个编辑器字符，提示哈希 `0a4171d409b5e84f66fc9028eb7558b07863bff5c2aac2fcbfe653e11384ed79`；随后只提交 1 个 `Seedance 2.0 Mini` 候选，没有自动重抽。
- 原片为 `1280x720`、24fps、121 帧、约 5.056 秒。32 点联系图和闭合近看表确认两条织臂在源 `f20` 做唯一一次剪合；闭合时上下两根臂仍能分别追踪，镜头、根点、腿组、环体和极光膜稳定，没有攻击扇区或特效。
- 正式动作取源 `f0..f84` 偶数帧，共 43 张 BiRefNet 透明原生键；一次性非回绕 RIFE 2× 后得到 85 帧、3500ms，单格 `352x256`、8 列 x 11 行、图集 `2816x2816`。正式 0-based `f20` 为唯一接触事件。
- 正式包见 `animation/formal/aurora-fate-weaver/cut-body/spritesheet-manifest.json`。织命母四张正式本体表合计解码 RGBA 约 `124.9688 MiB`，仍低于 Boss 128 MiB 目标；正面 180 度扇形、物理伤害、35 击退、接敌距离和运行时状态机仍冻结。

## 2026-09-05 豆包：极光织命母 `reweave_body`（原片拒绝）

- 复用已通过身份/方向门的 `animation/action-references/02-aurora-fate-weaver-body-cast-v02-1024x576.png`，不重画母帧；豆包 `--fill-only` 回读 824 个字符，提示哈希 `edd5559cd146f440cce2acb6fb54e6119d9a850fd79d480dd41773d5f7001d6f`，随后只提交 1 个 `Seedance 2.0 Mini` 候选，没有自动重抽。
- 原片为 `1280x720`、24fps、121 帧、约 5.056 秒，已生成 32 点联系图、拓扑近看表和动态 GIF。外环、视觉根与承重足大体稳定，但动作中身体/镜头漂向近正面，一条织线臂穿入环心；源 `f58` 出现白紫爆点，`f62..f77` 变成填满圆环的紫色传送门盘。
- 该变化超出“固环、只在环内重排交叉极光膜”的本体合同，因此在原片方向/拓扑/VFX 门禁拒绝并冻结。没有运行 BiRefNet、RIFE，没有创建正式表，也没有接入半血触发、技能节奏变化、旧步第四历史点或运行时状态机。
- 四张已通过正式本体表不受影响，家族预算仍为 `124.9688 MiB`。若未来重做，需要从同一认可方向源单独提交新候选；本轮不自动重抽。

## 2026-09-05 豆包：极光织命母 `reweave_body` v02（重抽通过）

- 用户明确要求继续重抽直到合格。v02 把环内青紫交叉纹约束为固定平面纹理，只保留“六足压低—两条短臂校准—单次完成拍—恢复”的本体轮廓；`--fill-only` 回读 728 字符，提示哈希 `c19fbe5c7498c070d008db7a32185a9671b38608fa5843959120ccb63ba48218`，随后只提交这一条新候选。
- 原片为 `1280x720`、24fps、121 帧、约 5.056 秒。相机、右向体轴、根点、六足/双短臂职责、开放硬环和交叉织膜全部通过 32 点联系图、动态 GIF 与近看门禁，没有复现 v01 的正面漂移、臂穿环心、爆点或传送门盘。
- 正式动作取源 `f0,2,...,120` 共 61 张 BiRefNet 透明原生键；一次性非回绕 RIFE 2× 后得到 121 帧、5000ms，单格 `288x256`、11 列 x 11 行、图集 `3168x2816`。0-based `f84` 为唯一重织完成提示拍。
- 正式包见 `animation/formal/aurora-fate-weaver/reweave-body/spritesheet-manifest.json`。织命母五张正式本体表合计 `159.0000 MiB`，超过 Boss 128 MiB 目标但低于 256 MiB 硬停线，沿用用户已接受的目标线例外。半血触发、节奏变化、旧步第四历史点、外部 VFX 和运行时状态机仍冻结。

## 2026-09-05 豆包：极光织命母 `seek_band` 移动循环

- 复用移动专用方向图 `animation/references/02-aurora-fate-weaver-locomotion-1024x576.png`，并重新查看 H3 移动样片的真实抽样帧，锁定右向低三分之四、六条长承重步足、两条抬起短织线臂、开放硬环和环内交叉膜。豆包 `--fill-only` 回读 901 个编辑器字符，提示哈希 `ed798f70a5013d0ad279a621398fde0b9e41a4822bf488c2c920664c6c5ce65d`；随后只提交 1 个 `Seedance 2.0 Mini` 循环候选。
- 原片为 `1280x720`、24fps、121 帧、约 5.056 秒。32 点联系图、动态 GIF 与腿部近看确认镜头/根点/右向体轴稳定，六足完成交替大步，两条短臂不触地，环体和膜不生成技能表现。
- 循环相位扫描与首尾密查选择半开源窗 `[f6,f114)`，其中 `f114` 是与 `f6` 同相位的重复端点，不写入源表。保留 `f6,8,...,112` 共 54 张 BiRefNet 原生键，一次回绕 RIFE 2× 得到 108 帧、4500ms，单格 `416x256`、9 列 x 12 行、图集 `3744x3072`；原生键在偶数索引，尾到首的缺失半步由回绕插帧补齐。
- 正式包见 `animation/formal/aurora-fate-weaver/seek-band/spritesheet-manifest.json`。六张织命母正式表合计 `202.8750 MiB`，超过 Boss 128 MiB 目标但低于 256 MiB 硬停线，沿用用户已接受的目标线例外。该表只提供原地步态；寻路、世界位移、速度、碰撞和状态机接入仍冻结。

## 2026-09-05 H3：白寂鸣钟鹿 `antler_body`

- 开工前重新查看 `stride` 和 `double_toll_body` 的真实联系图，固定轻俯视、侧面占主导的右向低三分之四相机，以及喙状头、胸腔、胯、膝、蹄尖的共同动作轴。H3 首尾均锁定已通过的 `animation/references/03-white-silence-bell-hart-locomotion-1024x576.png`。
- v01 的动作语义获用户认可，但正式 GIF 被用户以“镜头有位移”否决；v02/v03 分别仍有约 67px/49px 后侧承重蹄滑动，均在原片层拒绝。失败原片、提示和 `animation/videos/03-white-silence-bell-hart-antler-body-camera-audit.json` 只保留为审计证据。
- v04 在原身份参考的空白区加入临时摄影棚注册外框、角标与基准线，角色像素不变。原片 1024x576、24fps、124 帧、约 5.167 秒；注册标记全程静止，三只支撑蹄在活动段相对开场约只漂 `-0.13..+1.08px`，近侧前蹄小幅抬落，动作仍是一次肩颈主导的原地前下刺扫。
- BiRefNet 完整移除了临时注册背景。正式表固定使用原片源锚 `x429`，不按帧重算中心；保留 `f0,2,...,100` 共 51 张原生键，一次非回绕 RIFE 2x 得到 101 帧 / 4167ms。单格 `352x256`、8 列 x 13 行、图集 `2816x3328`、脚点 `(176,240)`；无空帧、触边帧、透明区脏 RGB 或插帧脚线位移。
- 0-based `f60` 是唯一叉角接触事件。前方 230 窄扇区、物理 `1.25x`、1 秒跛行、命中判定和状态机保持外置。正式 GIF 位于 `animation/formal/white-silence-bell-hart/antler-body/previews/white-silence-bell-hart-antler_body.gif`。
- 鸣钟鹿两张活动正式本体表合计解码 RGBA `49.8125 MiB`，低于 Boss 128 MiB 目标；没有进行运行时接入。

## 2026-09-05 H3：白寂鸣钟鹿 `long_tone_body`

- 开工前重新核对 `stride`、`double_toll_body` 和固定镜头 `antler_body` 的真实帧，随后以内置 imagegen 从注册参考派生后摆蓄势关键帧；关键帧保持右向低三分之四、四足、刚性鹿角、单钟与恰好三枚垂饰，不含外部攻击表现。
- 本地 MiniMax H3 v01 为 1024x576、24fps、124 帧、5.17 秒，首尾同图。注册外框和基准线全程静止，后侧承重蹄相对开场约只漂 `-0.13..+1.51px`；主体在四蹄固定下完成一次后仰蓄势、一次强前摆、短保持、一次更弱的衰减回摆并回到原姿，没有第二次攻击读数。
- 正式表保留源 `f0,2,...,108` 共 55 张原生键，一次性非回绕 RIFE 2x 后为 109 帧 / 4500ms。单格 `320x256`、10 列 x 11 行、图集 `3200x2816`、脚点 `(160,240)`；固定源锚 `x439`，无逐帧重居中、空帧、触边、透明区脏 RGB 或插帧脚线位移。
- 唯一外部释放事件为 0-based `f56`。前方 `620x120` 共振矩形、魔法 `1.60x`、0.7 秒眩晕、12 秒冷却、VFX、命中判定与状态机保持外置。正式 GIF 位于 `animation/formal/white-silence-bell-hart/long-tone-body/previews/white-silence-bell-hart-long_tone_body.gif`。
- 鸣钟鹿三张活动正式本体表合计解码 RGBA `84.1875 MiB`，仍低于 Boss 128 MiB 目标；没有进行运行时接入。

## 2026-09-05 H3：白寂鸣钟鹿 `hoof_sequence_body`

- H3 v01 保住镜头和身份，但只读出三段主动抬腿，第二蹄缺拍且第一/第三蹄重叠悬空，故在原片层拒绝。v02 以更低抬蹄、每蹄回地后下一蹄才起的合同重制；四段峰值为源 `f16/f37/f53/f74`，回地为 `f22/f45/f60/f80`，四足顺序、注册框、一钟三坠均通过。
- 原片中立间隙偏长，正式表只从源 `f0..f108` 非均匀选取 29 张完整帧，将 4500ms 动作窗压为 2333ms；不做空间平移、缩放、拉伸或局部重画。一次非回绕 RIFE 后为 57 帧，单格 `256x256`、6 列 x 10 行、图集 `1536x2560`、脚点 `(128,240)`。
- 四次落地事件为 0-based `f16/f24/f32/f40`，相隔 8 帧约 333ms。四个 105 半径圆区、单次物理 `1.00x`、每目标最多两次、8 秒冷却、VFX、命中和状态机均外置。正式 GIF 位于 `animation/formal/white-silence-bell-hart/hoof-sequence-body/previews/white-silence-bell-hart-hoof_sequence_body.gif`。
- 鸣钟鹿四张活动正式本体表合计解码 RGBA `99.1875 MiB`，仍低于 Boss 128 MiB 目标；没有进行运行时接入。

## 2026-09-05 H3：白寂鸣钟鹿 `rhythm_shift_body`

- 开工前重新查看 `stride`、`double_toll_body`、固定镜头 `antler_body`、`long_tone_body` 与 `hoof_sequence_body` 的真实帧，锁定轻俯视右向低三分之四、四蹄接地、一钟三坠和固定摄影棚坐标。该动作只表达非伤害阶段变调，不重复长调释放。
- H3 v01 原片 1024x576、24fps、124 帧、约 5.167 秒。注册标记固定，后侧承重蹄相对开场约 `-0.22..+0.63px`；主体从后到前传递张力，在源 `f52..f68` 形成清楚胸颈锁定平台，四足、右向喙首、刚性鹿角、空腔胸架、一钟三坠均稳定。
- 正式表取源 `f0,2,...,108` 共 55 张原生键，一次非回绕 RIFE 2x 得到 109 帧 / 4500ms；单格 `256x256`、10 列 x 11 行、图集 `2560x2816`，固定源锚 `x429`。无空帧、触边帧、透明区脏 RGB，Alpha 底边全程 `y=239`。
- 唯一非伤害阶段事件为 0-based `f52`。低于 45% 生命的一次性触发、第三回声计数、第二响后 0.75 秒调度、窄彩环、`0.90x` 魔法伤害、VFX 与状态机均外置。正式 GIF 位于 `animation/formal/white-silence-bell-hart/rhythm-shift-body/previews/white-silence-bell-hart-rhythm_shift_body.gif`。

## 2026-09-05 H3：白寂鸣钟鹿 `stride` 正式循环

- 不重新生成身份，复用已通过方向/拓扑门的 H3 移动原片。原始帧相位扫描选择 `[f40,f93)` 为完整循环；`f93` 与 `f40` 同相位，仅用于闭环核对，不写入源表。活动窗躯干根代理约 `-12..+11px`，属于交替承重，不是镜头平移。
- 正式表保留 `f40,42,...,92` 共 27 张 BiRefNet 原生键，一次回绕 RIFE 2x 后得到 54 帧 / 2208ms；单格 `256x256`、6 列 x 9 行、图集 `1536x2304`、脚点 `(128,240)`，固定源锚 `x433`。尾到首由回绕半步衔接，没有重复首帧停顿。
- 四条完整承重腿连续交替迈步，右向喙首、鹿角、胸架、腹钟和三枚垂饰稳定；无空帧、触边、透明区脏 RGB，Alpha 底边全程 `y=239`，原生键逐像素保留在偶数索引。正式 GIF 位于 `animation/formal/white-silence-bell-hart/stride/previews/white-silence-bell-hart-stride.gif`。
- 鸣钟鹿六张正式本体表合计 `140.1875 MiB`，超过 Boss 128 MiB 目标但低于 256 MiB 硬停线；按用户要求补齐已认可动作登记目标线例外。寻路、世界位移、碰撞、所有攻击判定/VFX/伤害/减益、冷却和运行时状态机仍未接入。
- 六动作同屏检查 GIF 位于 `animation/formal/white-silence-bell-hart/previews/white-silence-bell-hart-all-formal-actions.gif`；每格按自身正式墙钟循环，原尺寸 GIF 仍保留在各动作目录。

## 2026-09-05 归档清理

- 保留五张获准母图、已通过门禁的正式动作包、正式源视频、主联系表/GIF和生成来源记录。
- 删除 manifest 已明确判废的全部动画批次及其派生预览、失败拓扑/方向参考、未进入生成的草案，以及 BiRefNet 探针、重复 RIFE 预览等可由保留源重建的中间产物。
- 拒绝原因仍保存在 `manifest.json` 的状态与审查文字中，并以 `rejectedMediaPruned` 标记对应实物已清理；地渊喉与冻日核骸继续冻结，不能因文件精简而越过动画门禁。
