# 废弃矿洞三级地牢

## 生成规格

| 层级 | 类型 | 等级 | 节点 | 战斗/事件 | 普通/精英房 | Boss |
|---|---|---|---|---|---|---|
| 初级 | `abandonedMineBeginner` | F | 22—27 | 40% / 60% | 1 / 1 | 提灯僵尸或矿石蜘蛛精英遭遇 |
| 中级 | `abandonedMineMid` | E | 30—35 | 50% / 50% | 1 / 3 | 僵尸工头领主遭遇 |
| 高级 | `abandonedMine` | D | 45—50 | 50% / 50% | 3 / 5，两行蛇形 | 僵尸工头领主遭遇 |

三级逐级通关解锁，统一使用 `terrainProfile: "abandonedMine"`、`wallStyle: "abandonedMine"` 与 `wallConstruction: "worldBlock1x1"`。房间继续复用标准自动通道、波次门控、末房宝箱和出口流程。

## 独立场景美术

- 墙：`abandoned_mine_wall_block_a/b/c.png`。三种 Blender 墙柱共用 128×64 的 1×1 footprint、`groundCenter [512,761.9959]`、260×259 显示尺寸和 `wallH 132`；运行时按格坐标稳定选款，不随机位移、缩放或旋转。正式烘焙使用同一低频光照真源并关闭水平镜像，避免连续墙明暗跳块。
- 门：`abandoned_mine_gate.png`，640×640 单帧、4×4 共 16 帧。独立 `AnimatedGateLeaf` 只包含六格门叶，两端同款墙柱兼任门柱；帧 0 关闭、帧 15 完全升起。完全开启后门叶隐藏，关闭时从上方末帧重新出现并下落。六个门洞格分别裁片和排序，防止端部裁断及错误遮挡。
- 地面：`floor_abandoned_mine_seamless.png`，1024×1024 双轴连续母材，运行时按世界坐标铺贴并使用 `textureScaleY: 0.5774`。首尾行列最大 RGB 差均为 0。
- 小物：18 件 Blender 正交模型化地面装饰，按世界晶格和入场 seed 确定性散布；只进入地板视觉层，不创建碰撞、占格、寻路或快照实体。

结构真源、Depth、Alpha、门帧、拼接证明、12 步材质源和光照归一化报告位于 `tools/ai-gen/_abandoned_mine_wall_kit_20260828/`；地面源位于 `_abandoned_mine_20260828/`；18 件小物母版位于 `_abandoned_mine_terrain_20260828/`；五款障碍物模型、Body Depth、获批 V01 与运行时标定位于 `_world126_mine_obstacles_20260829/`。正式墙门不再使用早期连续墙位图实现。

## World-126 位面复用边界

`scene12`“世界-126·废弃矿洞”复用本地牢的连续地面规则与全部 18 件纯视觉小物，但不改变地牢战斗房合同；`ObstacleSpawnSystem`仍对地牢返回零生成。位面另由 `world126-environment.js` 按世界代际 seed 散布坍塌木支护、脱轨满载矿车、天然岩柱簇、手摇卷扬机和矿石分选料斗五款障碍物，共 50 件且按五款循环抽取。每件必须通过菱形内缩、玩家/传送门排除、最小中心距、footprint 间距和墙碰撞五点探针；碰撞取紧裁接地带矩形，遮挡深度取 footprint 前缘，不随机翻转或旋转。

## 怪物池拆分

废弃矿洞白名单为 `zombie`、`spitterZombie`、`minerZombie`、`mineCave`、`lanternMinerZombie`、`oreSpider`、`foremanZombie`，全部遭遇启用 `matchPoolRanks: true`。原“僵尸地牢”三级改名为“恐怖地牢”，并从其普通、精英与领主白名单移除上述矿洞生态；高级恐怖地牢的集合体专属 Boss 保持不变。

所有地牢入场统一经 `resolveDungeonEnemyPreloadTypes()` 展开普通/精英/Boss 池、事件强制怪、阶级回退、入侵怪及召唤链，并在扣钥匙和清主场景前以 `required: true` 完成资源预载。资源缺失时取消入场且不消耗钥匙，成功驻留到 `DungeonMapSystem.shutdown()`。

## 15 个限定事件

| 等级 | 事件键 | 事件名 |
|---|---|---|
| F | `collapsedMineShaft` | 坍塌的支护巷道 |
| F | `abandonedOreCart` | 脱轨的矿车 |
| F | `canaryCage` | 沉默的金丝雀笼 |
| F | `dampFuseBox` | 受潮的爆破箱 |
| F | `minersRationCache` | 矿工口粮窖 |
| E | `floodedLowerTunnel` | 被淹的下层巷道 |
| E | `exposedCrystalVein` | 裸露的晶矿脉 |
| E | `brokenMineLift` | 断索升降机 |
| E | `toxicGasPocket` | 有毒瓦斯囊 |
| E | `lanternCode` | 矿灯暗号 |
| D | `foremanLedger` | 工头的黑账本 |
| D | `dynamiteMagazine` | 炸药储藏库 |
| D | `oreSpiderNest` | 矿石蜘蛛巢 |
| D | `hauntedRockDrill` | 自鸣的凿岩机 |
| D | `sealedMainShaft` | 封死的主矿井 |

事件使用 `scope: "abandonedMine"` 隔离，继续遵守通用 30%、限定 70% 和当前等级 ±1 的抽取合同。每个事件提供两个属性检定和一个无检定叙事选项；事件战斗继承当前矿洞同阶白名单。15 张专属 1536×1024 背景均采用低噪约束，底部 25% 保持暗且安静以容纳决策面板；`lanternCode` 已按反馈重做为真实轨道岔口的远距信号灯构图。
