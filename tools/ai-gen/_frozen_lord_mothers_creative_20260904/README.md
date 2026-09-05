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

## 2026-09-05 归档清理

- 保留五张获准母图、已通过门禁的正式动作包、正式源视频、主联系表/GIF和生成来源记录。
- 删除六组 manifest 已明确判废的动画及其派生预览、两张失败拓扑参考、已被新版替代的方向源、BiRefNet 探针缓存和重复 RIFE 工具预览；这些内容均为拒绝稿或可由保留源重新生成的中间产物。
- 拒绝原因仍保存在 `manifest.json` 的状态与审查文字中，并以 `rejectedMediaPruned` 标记对应实物已清理；地渊喉与冻日核骸继续冻结，不能因文件精简而越过动画门禁。
