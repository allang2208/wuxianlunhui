# 世界-122 经济建筑进度条 / 效率条拆分审计（2026-08-29）

## 统一显示合同

- `岗位安排`：只显示已分配岗位数占岗位容量的比例。
- `业务效率`：显示权威业务快照中的实际发挥率及真实每秒/每批产出，不读取循环结算余数。
- `任务进度`：仅在存在有界、可解释的业务任务时显示；阶段名称必须随任务状态变化。
- 持续收益、周期入账、手动交易和并行服务没有单一任务进度，不生成伪造倒计时。
- 蒸汽电站的两条锅炉物流独立显示，禁止把最大值、最小值或平均值合成一条进度。

## 逐建筑审计矩阵

| economyType | 建筑 | 业务分类 | 效率条真源 | 任务条 |
|---|---|---|---|---|
| `research` | 研究所 | stable_output | 实际/配置科研点每秒 | 隐藏 |
| `weather_forecast` | 天气预测塔 | stable_output | 气象科研实际/配置；无科研时为监测资格 | 隐藏 |
| `advanced_research` | 大学及上位科研设施 | stable_output | 实际/配置科研点每秒 | 隐藏 |
| `windmill` | 麦田风车 | stable_output | 实际/配置粮食每秒 | 隐藏 |
| `bank` | 银行 | stable_output | 岗位、人口效率与有效覆盖人口共同形成的收益效率 | 隐藏 |
| `royal_mint` | 皇家铸币局 | stable_output | 资源可支付时的岗位与人口效率、真实三资源每秒速率 | 隐藏 |
| `grand_mall` | 大商场 | stable_output | 可营业时的岗位与人口效率、真实金币/能源每秒速率 | 隐藏 |
| `stock_exchange` | 证券交易所 | stable_output | `operatingFactor` 与真实金币/能源每秒速率 | 隐藏 |
| `computing_center` | 算力重心 | stable_output | `operatingFactor` 与真实金币/能源每秒速率 | 隐藏 |
| `market` | 市场 | stable_output（手动服务） | 有效商人人效/岗位容量 | 隐藏 |
| `workshop` | 经济工坊 | stable_output（持续服务） | 实际/配置增效 | 隐藏 |
| `planar_resonator` | 位面谐振塔 | stable_output | 实际/配置能源每秒 | 隐藏 |
| `armory` | 军械库 | parallel_jobs（多目标维护） | 维护岗位发挥与实际减耗 | 隐藏 |
| `field_hospital` | 战地医院 | parallel_jobs（多患者治疗） | 实际/配置治疗率与患者占用 | 隐藏 |
| `bakery` | 面包屋 | single_bounded_phase | 本批加权岗位效率、当前岗位效率和预计每批产出 | 取粮/返坊/加工/待存/送仓 |
| `chain_restaurant` | 连锁餐馆 | single_bounded_phase | 本批加权岗位效率、当前岗位效率和预计每批产出 | 取粮/返店/加工/待存/送仓 |
| `cheese_farm` | 奶酪农场 | single_bounded_phase | 本批加权岗位效率、当前岗位效率和预计每批产出 | 熟成/待存/送仓/返场 |
| `corn_farm` | 玉米农场 | single_bounded_phase | 本批加权岗位效率、当前岗位效率和预计每批产出 | 生长/待存/送仓/返田 |
| `steam_power_plant` | 蒸汽电站 | parallel_jobs | 本批岗位效率×人口效率及真实能源/批 | 锅炉线1、锅炉线2各自独立 |
| `wind_power_plant` | 风力电站 | stable_output | 实际/配置能源每秒 | 隐藏 |
| `solar_power_plant` | 光伏电站 | stable_output | 实际/配置能源每秒 | 隐藏 |
| `deep_drill` | 深钻井 | stable_output | 实际/配置采掘每秒 | 隐藏 |
| `tavern` | 三层酒馆 | single_bounded_phase | 岗位对配置增效的实际发挥 | 待命/取粮/返店/服务 |

## 无岗位建筑

`warehouse` 与 `housing` 不进入岗位控件：仓库继续显示本仓与位面总容量条，房屋只显示人口容量和等级升级；二者不伪装成生产效率或任务进度。

## 本轮修正

- 原共用“第二条”已拆为独立效率条与任务条，首次渲染和 100ms 面板刷新读取同一函数族。
- 证券交易所与算力重心补齐显式效率分支，不再落入“待接权威数据”。
- 蒸汽电站快照新增只读的逐锅炉任务阶段与进度投影，不修改锅炉任务状态机。
- 效率条使用蓝青绿色，任务条使用金色，岗位安排继续使用原危险度色带。

未运行测试、构建、lint、浏览器探针或游戏运行时验证，按项目约定由用户进行运行时验收。
