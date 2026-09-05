# 雪原领主正式动画标准工作流审计（2026-09-05）

## 结论

按根 `SKILL.md` 动画索引、`skill/16b-animation-alignment-and-timing.md` 第 1.1–7 节、`tools/ai-gen/WORKFLOW.md` 第 3.6 节和 `game-dev-lessons` 62–65，对三只已通过上游门禁的领主共 16 个正式本体动作完成离线审计。

- 自动硬门：16/16 动作、3/3 家族通过，0 个错误。
- 本轮修正两项真实家族一致性问题：`double_toll_body` 从 224px 归一为 208px并改用固定源锚 `x417`；`plow_prepare` 从 224px 归一为 222px并改用固定源锚 `x317`。
- 补齐 `triangle_weave_body` 的来源供应方、provenance 与六足/双织线臂拓扑合同；不重建其已获认可的像素。
- 16 个源视频均可解码，所选源帧全部在真实范围内；来源、参考图、未插帧表、正式表、联系图、GIF 与处理报告均存在。
- 16 张正式 PNG 均为 RGBA，最长边不超过 4096px；无有效空帧、触边帧、尾部脏格或透明区脏 RGB，末行空格比例不超过 12.5%。
- 一次 RIFE 后所有原生键在偶数索引逐像素保留；处理报告没有可见暗色/红色/蓝色/青色异常，也没有 hold 回退。循环动作使用回绕插帧，单次动作不回绕。
- GIF 帧数与正式帧数一致，总时长只存在格式允许的 0–10ms 量化差；相位覆盖完整，无重叠/空档，0-based 事件与 1-based 消费者映射一致。
- 三族均超过 Boss 128 MiB 目标，但都有已记录的用户保留例外，并且均低于 256 MiB 硬停线；官方预算检查器 3/3 通过。

审计状态：`offline_formal_asset_audit_passed; runtime_integration_not_started`。

## 家族结果

| 领主 | 正式动作 | 族内有效高度 | 固定源锚动作 | 历史下半身注册动作 | 解码 RGBA | 预算结果 |
|---|---:|---:|---:|---:|---:|---|
| 雪冢驮城兽 | 4 | 222px | 1 | 3 | 179.875 MiB | 超 128 目标，有例外；低于 256，过硬门 |
| 极光织命母 | 6 | 224px | 0 | 6 | 202.875 MiB | 超 128 目标，有例外；低于 256，过硬门 |
| 白寂鸣钟鹿 | 6 | 208px | 6 | 0 | 140.1875 MiB | 超 128 目标，有例外；低于 256，过硬门 |

`skill/16b` 明确规定不能只因工作流更新而批量重做现有角色。雪冢驮城兽 3 条与极光织命母 6 条动作保留早期的下半身注册策略；本轮同步总览与关键帧总览未见身体跳位、朝向翻转或事件姿态错位，因此登记为历史策略提示，不判失败。今后若重抽或重制这些动作，必须先从原片核定固定源锚，不能继续逐帧重居中。

## 逐动作时钟与事件

| 领主 | 动作 | 正式帧 / 墙钟 | 0-based 外部事件 | 循环 |
|---|---|---:|---|---|
| 雪冢驮城兽 | `advance` | 88 / 3667ms | 无 | 是 |
|  | `trample_body` | 85 / 3500ms | `f26` | 否 |
|  | `plow_prepare` | 93 / 3833ms | `f60` | 否 |
|  | `tower_drop_body` | 123 / 5083ms | `f64/f72/f80` | 否 |
| 极光织命母 | `seek_band` | 108 / 4500ms | 无 | 是 |
|  | `triangle_weave_body` | 81 / 3333ms | `f48` | 否 |
|  | `oldstep_body` | 85 / 3500ms | `f24/f50/f66` | 否 |
|  | `tether_body` | 105 / 4333ms | `f32/f58` | 否 |
|  | `cut_body` | 85 / 3500ms | `f20` | 否 |
|  | `reweave_body` | 121 / 5000ms | `f84` | 否 |
| 白寂鸣钟鹿 | `stride` | 54 / 2208ms | 无 | 是 |
|  | `double_toll_body` | 73 / 3000ms | `f24/f50` | 否 |
|  | `antler_body` | 101 / 4167ms | `f60` | 否 |
|  | `hoof_sequence_body` | 57 / 2333ms | `f16/f24/f32/f40` | 否 |
|  | `long_tone_body` | 109 / 4500ms | `f56` | 否 |
|  | `rhythm_shift_body` | 109 / 4500ms | `f52` | 否 |

所有事件仍是运行时外部合同；正式表不烘入伤害、导航位移、攻击区或状态切换。未来接入必须让动画、动作锁、跨阈值事件、打断/死亡取消共用同一时钟，不得按“正好显示到某帧”重复结算。

## 朝向、拓扑与动作语义复核

- 雪冢驮城兽保持轻俯视、侧面占主导的右向低三分之四轴，六足按三对承重，塔楼/城垛/雪山壳体不重构。`plow_prepare` 只做原地蓄力，Collider 冲锋继续外置。
- 极光织命母保持右向体轴、六条承重步足与两条较短织线臂分工；开放圆环和膜层身份可追踪。`triangle_weave_body` 的抽膜—释放—重织属于用户已接受语义，外部三角与命中线仍由运行时绘制。
- 白寂鸣钟鹿保持右向低三分之四、四足、刚性鹿角、一只腹钟与恰好三枚垂饰。`double_toll_body` 归一化后动作幅度、73 帧、3000ms 和 `f24/f50` 双事件均未变化。

关键姿态总览：

- `audit-keyframes-20260905/snow-sepulcher-carrier-formal-keyframes.png`
- `audit-keyframes-20260905/aurora-fate-weaver-formal-keyframes.png`
- `audit-keyframes-20260905/white-silence-bell-hart-formal-keyframes.png`

同步动态总览：

- `snow-sepulcher-carrier/previews/snow-sepulcher-carrier-all-formal-actions.gif`
- `aurora-fate-weaver/previews/aurora-fate-weaver-all-formal-actions.gif`
- `white-silence-bell-hart/previews/white-silence-bell-hart-all-formal-actions.gif`

机器可读逐动作证据为 `standard-workflow-audit-20260905.json`。

## 两只冻结领主

- 永冻地渊喉仍冻结在上游方向/拓扑门：`crawl` 只有三条近侧腿稳定可读，无法验证完整三对足与背鳍数量；不得进入抠图、RIFE 或正式表。
- 冻日核骸仍冻结在原视频门：`cold_move` 出现整体轴向旋转与支撑点交换；`cold_idle` v01 越界进入橙红热相，v02 右侧小刺增生成大型关节钩。不得用后处理掩盖身份或视角问题。

因此，“三只已通过领主的 16 个正式本体动作”已经做完并通过本轮离线审计；“五只领主全部动画与运行时状态机”尚未完成，原因是两只仍被上游质量门挡住，且三只已通过领主的运行时导航、碰撞、VFX、伤害和状态机未在本素材任务中接入。

## 验证边界

本轮执行的是离线素材与预算审计，未运行游戏、构建、浏览器/CDP、运行时状态切换或战斗判定验证；这些不能由 PNG/GIF 结果代替。
