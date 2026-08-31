# 经济面板净收支与扩展接口

本文记录本地工作区实现，随知识档案归档；核心运行时代码依赖尚未合入的共享接口，本次不随文档发布，详见 [Git交付边界](population-economy-publication-2026-08-31.md)。

金币、能源、食物统一显示 **每秒净收支 = 每秒收入 − 每秒消耗**，并分别列出收入、消耗；正值绿色、负值红色。原仓容、实际人口与住房、250px面板宽度及向下展开布局保留。

## 两类来源

- **周期经营均摊**：人口口粮直接使用实际居民数 × `populationGrowth.foodPerPopulation` × 1000 ÷ `foodIntervalMs`（毫秒换算为每秒）；风车、四类能源建筑、银行、皇家铸币局、商场、证券交易所和算力中心复用各自现有运行时快照。岗位、升级、天气、工坊、酒馆、祭品及开工条件沿现有公式，不在面板复制数值。仓满时不把连续能源/粮食的未入库产能当收入。资本类建筑的快照已经包含其专用经营公式，不额外叠乘其他建筑的生产倍率。
- **实际收支均值**：农场/面包屋/餐厅/蒸汽电站/酒馆等带运输的批次、矿工与采集、交易、建造、升级、军事招募及其他通过资源入口发生的收支，按实际成功入库或支付金额统计。配置 `resourceAccounting.observationWindowMs` 默认60000游戏毫秒；窗口未满时按已观察时间计算，至少使用1秒分母。每游戏秒聚合一次，窗口边界误差不超过1秒；这部分会随运输与临时开销波动，不伪称稳定的理论产能。

面板明确标注“周期均摊 / 近60秒实收支”，悬停每种资源可看周期来源、物流与临时收支的拆分及已观察时长。它是当前经营预算与实际其他收支的合计，不是库存每帧导数，也不是全位面总收入：后台位面金币结算不会混进当前位面的速率。

居民口粮按**足额需求**列为消耗，即使库存不足也保留缺口，不把“付不起”显示为不再需要食物。其他周期经营遵循自身开工条件，缺原料/能源停工时停止计入该项计划收支。真正库存扣费、短缺与人口变化仍由原系统执行。

例如30人口、基础4名农夫正常开工且没有其他业务/增益时：食物收入6/秒，居民口粮消耗30×3÷20=4.5/秒，净值+1.5/秒。20秒结算扣掉90食物时不再重复扣算一次。

## 后续功能如何接入

`src/world/economy-flow-system.js` 不持有资源、不执行付款，只有两种接口：

1. 普通入库/消费继续调用 `EnergyManager.depositEnergy/depositFood/deductEnergy/deductFood`、指定仓库的入库/取粮接口，或 `GoldManager.depositGold/deductGold`。这些入口自动记录成功数量；失败付款、未入库余量不记录。未来沿这些入口增加消费，无需修改HUD。
2. 有明确持续周期的模块注册只读来源，复用自己的业务快照：

```js
const unregister = EconomyFlowSystem.registerRateProvider('my-production', () => [{
    resource: 'food',
    label: '我的生产模块',
    income: currentBatch.outputFood,
    expense: currentBatch.inputFood,
    intervalMs: currentBatch.intervalMs,
}]);
```

省略 `intervalMs` 时金额即每秒速率。来源负责检查是否开工、当前岗位与实际倍率；不把未营业建筑的满配参数当实际产出。注销函数只移除自己注册的回调，避免覆盖后续同名替代来源。

该来源对应的**实际经营结算**必须传入同一标识，防止周期值与实扣金额重复：

```js
const options = { accounting: { providerId: 'my-production' } };
EnergyManager.deductFood(input, options);
EnergyManager.depositFood(output, options);
// 指定仓库接口为第三个参数：
EnergyManager.deductFoodFromWarehouse(warehouse, input, options);
// 金币路由覆盖背包和主神空间仓库，只记一次：
routeProducedGold(gold, options);
```

只给业务周期结算打这个标识，**建造、升级、招募和临时交易不要打**，否则会漏掉一次性消耗。只有已注册来源才会排除对应实收支；未注册标识仍按真实金额统计。

存档恢复、跨容器内部搬运和后台位面入账应使用 `{ accounting: { ignore: true } }` 排除；绕过资源管理器直接修改数据的新模块，须在成功提交后调用 `EconomyFlowSystem.record(resource, signedAmount, accounting)`，不得在预检或失败回滚前虚记。金币生产应走 `routeProducedGold`，避免只统计背包、漏掉主神空间仓库分流。

## 生命周期和交付范围

- 统计上下文由当前场景与人口视图版本组成，使用 `EnvironmentLightingSystem` 游戏时钟；切场、读档和时间回退重建观察窗口，暂停不按现实时间稀释速率。加载、战略地图与后台入账不向当前现场统计。
- 统计记录不入存档，不修改资源余额、费用、生产时钟或人口状态。旧存档无需迁移，恢复的历史余额不作为新收入。
- 某个来源读取异常时只跳过统计并明确标记部分来源不可用，不让统计中断真实资源结算。
- 修改：`data/population-economy.json`、`src/world/economy-flow-system.js`、`src/systems/energy-manager.js`、`src/systems/gold-manager.js`、`src/world/economy-gold-routing.js`、`src/world/population-economy-system.js`、`src/world/world-sim-driver.js`、`src/world/world122-snapshot.js`、`src/ui/game-ui-manager.js`、`src/ui/panels/hud-panels-misc.js`、`ui/panel-theme-backpack.css`及`CHANGELOG.md`。
- 未运行测试或运行时验证，按约定由用户测试；重点确认30人口/4农夫的净值、20秒扣粮不双算、铸币/商场开停工、运输批次、升级/招募费用、暂停及切换位面、金币入主神空间仓库。未构建或同步EXE。
