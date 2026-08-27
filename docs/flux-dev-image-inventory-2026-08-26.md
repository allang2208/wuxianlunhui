# FLUX Dev 图片资产清单（2026-08-26 静态溯源快照）

## 结论与口径

- 当前仓库中，至少有 **71 个仍在正式资产目录中的根图片**，能由本地 manifest、`*_generation.json`、运行时 metadata、项目变更记录或管线文档追溯到 FLUX.2 Dev（`flux2-dev-depth` / `flux2-dev-fp8`）。
- 另有 **108 份可解析的 `flux2-dev-depth` 生成记录**，分布于 **34 个候选家族**。这些记录对应的 `*_raw.png`、`*_body.png`、`*_preview.png` 等大多位于 `tools/ai-gen/`，不是全部都在游戏中使用。
- 本清单把“需要替换的运行时根图”与“可晚些处理的候选/中间图”分开。缩略图、光照图、透明裁切图等确定性派生资产不重复计入 71 个根图；替换根图后应一起重建。
- “FLUX Dev 生成”包含：Dev 直接生图，以及保留 Dev 可见像素、但后来经过人工 Alpha、BiRefNet、裁切、合成或 Blender 贴材质的派生图。

## 第一批：正式建筑与交互物根图（53 个）

建议优先替换这一批。路径是当前正式资产路径，不是候选路径。

### 住房、仓储与兵营（17）

- [x] `assets/terrain/house_lv1.png`
- [x] `assets/terrain/house_lv2.png`
- [x] `assets/terrain/house_lv3.png`
- [x] `assets/terrain/house_lv4.png`
- [x] `assets/terrain/house_lv5.png`（保留 Klein 新增烟管，定点裁除地台外绿幕投影）
- [x] `assets/terrain/house_lv6.png`（用户确认重抽版本）
- [x] `assets/terrain/house_lv7.png`（保留未来住宅玻璃顶，定点裁除地台外绿幕投影）
- [x] `assets/terrain/warehouse_lv2.png`（原 Depth 与新主体不一致，改用边缘连通绿幕安全阈值）
- [x] `assets/terrain/warehouse_lv3.png`（用户确认重抽版本）
- [x] `assets/terrain/warehouse_lv4.png`（用户确认完整 Body Depth 重抽版本）
- [x] `assets/terrain/warehouse_lv5.png`
- [x] `assets/terrain/barracks.png`
- [x] `assets/terrain/hamster_barracks_lv2.png`
- [x] `assets/terrain/thatch_hut.png`（Klein + 原图低重绘，建筑专用绿幕抠图）
- [x] `assets/terrain/thatch_hut_lv2.png`
- [x] `assets/terrain/armory.png`（Klein + 原图低重绘，建筑专用绿幕抠图）
- [x] `assets/terrain/bakery.png`（Klein + 原图低重绘，建筑专用边缘连通绿幕抠图）

### 经济、科技与公共建筑（21）

- [x] `assets/terrain/royal_mint.png`
- [x] `assets/terrain/steam_power_plant.png`
- [x] `assets/terrain/wind_power_plant.png`（Klein 面板；场景使用无叶轮 body + 24帧 rotor 分层）
- [ ] `assets/terrain/solar_power_plant.png`
- [ ] `assets/terrain/tavern.png`
- [ ] `assets/terrain/chain_restaurant.png`
- [ ] `assets/terrain/grand_mall.png`
- [ ] `assets/terrain/stock_exchange.png`
- [ ] `assets/terrain/market.png`
- [ ] `assets/terrain/field_hospital.png`
- [ ] `assets/terrain/cheese_farm.png`
- [ ] `assets/terrain/mine.png`
- [ ] `assets/terrain/deep_drill.png`
- [ ] `assets/terrain/computing_center.png`
- [ ] `assets/terrain/university.png`
- [ ] `assets/terrain/research_institute.png`
- [ ] `assets/terrain/research_institute_lv2.png`
- [ ] `assets/terrain/research_institute_lv3.png`
- [ ] `assets/terrain/church.png`
- [ ] `assets/terrain/planar_resonator.png`
- [ ] `assets/terrain/weather_forecast_tower.png`

### 位面建筑、矿洞、宝箱与能源矿（15）

- [ ] `assets/terrain/portal.png`
- [ ] `assets/terrain/explorer_camp.png`
- [ ] `assets/terrain/jungle_temple.png`
- [ ] `assets/terrain/snow_castle.png`
- [ ] `assets/terrain/desert_mansion.png`
- [ ] `assets/enemies/mine_cave/mine_cave.png`
- [ ] `assets/terrain/chest_closed.png`
- [ ] `assets/terrain/chest_opened.png`
- [ ] `assets/terrain/wheat_windmill.png`
- [ ] `assets/terrain/energy_node_v3_1.png`
- [ ] `assets/terrain/energy_node_v3_2.png`
- [ ] `assets/terrain/energy_node_v3_3.png`
- [ ] `assets/terrain/energy_node_depleted_v3_1.png`（由对应 Dev 矿脉图确定性改色派生）
- [ ] `assets/terrain/energy_node_depleted_v3_2.png`（同上）
- [ ] `assets/terrain/energy_node_depleted_v3_3.png`（同上）

## 第二批：正式地形、植被、技能与防御塔根图（18 个）

### 地面与地牢（5）

- [ ] `assets/terrain/yellowmud-new1.png`
- [ ] `assets/terrain/ruinslab-1.png`
- [ ] `assets/terrain/ruinslab-2.png`
- [ ] `assets/terrain/demon_wall_straight.png`
- [ ] `assets/terrain/demonbrick1.png`

### 世界-124 林地（10）

- [ ] `assets/terrain/floor_grass_forest_seamless.png`
- [ ] `assets/terrain/deco_forest_grass_1.png`
- [ ] `assets/terrain/deco_forest_grass_2.png`
- [ ] `assets/terrain/deco_forest_grass_3.png`
- [ ] `assets/terrain/deco_forest_grass_4.png`
- [ ] `assets/terrain/obstacle_forest_pine_01.png`
- [ ] `assets/terrain/obstacle_forest_pine_02.png`
- [ ] `assets/terrain/obstacle_forest_pine_03.png`
- [ ] `assets/terrain/obstacle_forest_pine_04.png`
- [ ] `assets/terrain/obstacle_forest_pine_05.png`

### 防御塔与技能（3）

- [ ] `assets/terrain/obstacle_defense_tower.png`
- [ ] `assets/terrain/obstacle_defense_tower_arm.png`
- [ ] `assets/skills/陨星坠落.png`

## 替换根图时必须联动重建的派生资产

这些图片通常不是再次“生图”得到的，但含有根图的轮廓、颜色或像素。不要单独重新生图；根图替换后按现有确定性工具重建。

- 建筑缩略图：`assets/ui/building-thumbnails/<asset-id>.png`
- 环境光照：`assets/terrain/lighting/<asset-id>_{silhouette,projection,height,normal}.png`
- 风力电站分层：`assets/terrain/wind_power_plant_body.png`、`assets/terrain/wind_power_plant_rotor.png`
- 天气预测塔分层：`assets/terrain/weather_forecast_tower_panel.png`、`assets/terrain/weather_forecast_tower_vane.png`
- 防御塔旋转帧：`assets/terrain/obstacle_defense_tower_arm_frames.png`
- 能源矿枯竭态：若重做三个正常态，应从新正常态重新派生三个 `energy_node_depleted_v3_*`，不要保留旧派生图。

## Dev 候选与中间图：108 份生成记录 / 34 个家族

这一批集中在 `tools/ai-gen/`，不应与正式运行时图混为一谈。每份 `*_generation.json` 的同目录通常包含 Dev 输出的 `*_raw.png`，以及后续 `*_body.png`、`*_preview.png`、`*_keyed.png` 等派生图。

| 候选家族 | Dev 生成记录数 | 当前处理建议 |
| --- | ---: | --- |
| chain_restaurant | 1 | 正式根图替换后再清历史候选 |
| cheese_farm | 2 | 同上 |
| computing_center | 3 | 同上 |
| deep_drill | 2 | 同上 |
| desert_mansion | 2 | 同上 |
| dungeon_chest_closed | 2 | 与 `chest_closed.png` 同批替换 |
| dungeon_chest_open | 2 | 与 `chest_opened.png` 同批替换 |
| energy_vein_1 | 2 | 与能源矿正常/枯竭态同批替换 |
| energy_vein_2 | 2 | 同上 |
| energy_vein_3 | 2 | 同上 |
| explorer_camp | 2 | 正式根图替换后再清历史候选 |
| field_hospital | 8 | 同上 |
| grand_mall | 8 | 同上 |
| hamster_barracks_lv2 | 5 | 同上 |
| hamster_barracks_lv3 | 3 | **仅候选，尚无 `assets/terrain/hamster_barracks_lv3.png`** |
| house_lv4 | 2 | 正式根图替换后再清历史候选 |
| house_lv5 | 2 | 同上 |
| house_lv6 | 3 | 同上 |
| house_lv7 | 5 | 同上 |
| jungle_temple | 2 | 同上 |
| mine_cave | 2 | 同上 |
| royal_mint | 2 | 同上 |
| snow_castle | 2 | 同上 |
| solar_power_plant | 8 | 同上 |
| steam_power_plant | 8 | 同上 |
| stock_exchange | 2 | 同上 |
| tavern | 8 | 同上 |
| thatch_hut_lv2 | 2 | 同上 |
| university | 2 | 同上 |
| warehouse_lv2 | 2 | 同上 |
| warehouse_lv3 | 2 | 同上 |
| warehouse_lv4 | 3 | 同上 |
| warehouse_lv5 | 3 | 同上 |
| wind_power_plant | 2 | 与分层 body/rotor 一起复核 |

## 明确不要误算为当前 Dev 正式图

- `assets/terrain/thatch_hut_lv3.png`：当前来源是内置 ImageGen 概念图 + 确定性抠图，不是 FLUX Dev。
- `assets/terrain/obstacle_snow_pine_01.png` ～ `05.png`：当前版本已由内置 ImageGen 精修图覆盖，不是当前 Dev 图。
- `assets/terrain/blacksmith.png`、`assets/terrain/shooting_range.png`、`assets/terrain/warehouse.png`：当前正式图后来由素材库/用户来源覆盖；旧 metadata 或旧候选中即使出现“5080”，也不能据此把当前文件判成 Dev。
- 天气预测塔目录中的 3 份 `flux2-klein-4b-world122-building-body-depth` 记录，以及仓鼠军营 LV3 的 3 份 Klein 优化记录，不是 Dev。
- 仅写“5080”而未写具体模型的旧图，不纳入上面的 71 个确认根图；需要逐个对照原始生成日志后再决定。

## 建议替换顺序

1. 先换玩家高频可见、来源链最清楚的建筑：房屋 1～7、仓库 2～5、军营/草屋升级、经济建筑。
2. 再换玩法关键物：能源矿、宝箱、矿洞、传送门、地标建筑。
3. 再换大面积环境：林地地板/植被、黄色泥地、遗迹石板、恶魔洞窟墙地。
4. 最后换防御塔与技能图标，并重建所有缩略图、光照图和动画派生帧。
5. 每完成一个根图家族，再清理对应 `tools/ai-gen/` Dev 候选；不要先删生成记录，否则会失去提示词、seed、Depth 与最终来源映射。

## 主要本地证据

- `tools/ai-gen/world122-building-candidate-manifest.json`：建筑候选总清单，默认模型 `flux2-dev-depth`，并记录大量正式 `runtimeAsset`。
- `tools/ai-gen/_housing_generation_20260821/manifest.json`：房屋 Lv1～Lv3，模型 `flux2-dev-depth`，直接登记正式输出。
- `tools/ai-gen/_windmill_generation_20260821/manifest.json`：麦田风车，模型 `flux2-dev-depth`。
- `tools/ai-gen/_settlement_building_pack_20260821/**/_generation.json` 与 `*_runtime_metadata.json`：候选模型、正式来源和输出映射。
- `tools/ai-gen/_energy_vein_model_pipeline_20260825/**/_generation.json` 与 runtime metadata：三种能源矿及枯竭派生态。
- `skill/02-ai-asset-pipeline.md`、`skill/07-world122-defense.md`、`CHANGELOG.md`：旧管线和已入库资产的模型/文件名记录。

> 限制：PNG 本身通常没有可靠的模型元数据。本报告是“本地旁车元数据 + manifest + 运行时路径 + 版本记录”的静态溯源结果，不是对图片像素反推模型的结论。
