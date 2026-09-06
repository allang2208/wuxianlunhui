# 位面观测阵列标准化闭环（2026-09-01）

## 目标与边界

- 建筑稳定 ID 保持 `planar_observation_array`，仍为科研 Tier 4、每个位面最多1座、需要控制3个位面。
- 基础岗位保持6名位面观测员，满员基础科研保持3点/秒；建造价、4×4逻辑占格、碰撞、寻路和正式模型不在本轮调整。
- 本轮只补齐该建筑的标准化科技、四项本栋升级、前后台/快照结算、详情卡和独立图标；不接入 Tier 5 跨位面中枢。

## 科技与升级数值

`planar_observation_standardization`（位面观测标准化）基础科研成本3200，按当前最高成本带4.5倍折算为14400；要求先完成位面观测学并控制至少3个位面。它是可选本栋强化支线，不增加跨位面科研协同的前置，因此v67旧档不补完成状态或研究进度。

| 升级 | Lv.0 | 满级 | 等级 | 作用 |
| --- | ---: | ---: | ---: | --- |
| 孔径合成阵列 | 3.00点/秒 | 4.00点/秒 | 10 | 本栋满员基础科研，每级+0.10 |
| 多谱段自动观测 | 16.67%/人 | 20%/人 | 4 | 5人即可达到100%发挥，岗位容量仍为6 |
| 阵列基线延展 | 640px | 1440px | 10 | 本栋科研产业集群识别半径，每级+80px |
| 预警解析链 | 3格 | 5格 | 2 | 至少1名观测员上岗时的基地战略入侵侦察半径 |

十级通用项目费用由 `building-upgrades.json#planar_observation_array_economy.moduleUpgrade` 给出；自动观测与预警解析使用各自的短等级费用表。四项全满合计435500金币、661200能源，累计读条4875秒（81分15秒），全部只对当前这栋阵列生效。

## 前后台与存档合同

- 前台通过 `PopulationEconomySystem` 的通用高级科研模块读取等级、扣费、读条和科研效果；开工门禁按建筑自身 `upgradeProject` 解析，不再限定高能实验室。
- 详情面板按建筑名和首项升级的科技门禁生成标题，显示基础科研、岗位、集群半径以及阵列专属战略预警半径；每张卡显示独立图标、等级、费用和读条。
- `world122-snapshot.js` 继续复用 `advancedResearchModules / advancedResearchUpgrade` 成对捕获和恢复。旧档缺少模块字段时四项均按Lv.0恢复。
- `world122-sim.js` 在后台升级完成边界按结构配置的 `upgradeProject` 查模块，完成后再以新等级分段结算科研。
- `StrategicInvasionMarch` 对当前位面读取实体 `modules`，对后台位面读取快照 `advancedResearchModules`；岗位不足1人时仍不产生建筑侦察源。

## 图标资产

- 四项升级正式图标：`assets/ui/building-upgrades/planar-*.png`（256×256），并生成 `assets/ui/runtime-icons/ui/building-upgrades/` 下128×128轻量副本。
- 标准化科技图标：`assets/ui/technology-icons/planar_observation_standardization.png`（1024×1024）。
- 原图、来源、提示词、透明几何归一化脚本与Alpha边界记录保存在 `tools/ai-gen/_planar_observation_array_icons_20260901/`。

## 验证边界

本轮只做实现所需的配置、调用链、真实diff和图标透明边界核对；未运行测试、构建、浏览器、游戏或EXE运行时验证，按项目约定由用户测试。
