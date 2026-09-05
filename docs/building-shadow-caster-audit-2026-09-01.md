# 建筑主体影根离线审计（2026-09-01）

> 该报告由 `tools/generate-building-shadow-casters.mjs` 生成。只审计并派生视觉阴影低模；不修改逻辑占格、碰撞、寻路、`visualFootprint` 或建筑贴图。

- 审计视觉项：90
- 语义模型多段影根：5
- Body Depth 主体影根：23
- 配置显式影根：1
- 保守回退旧影根：61
- 运行时清单条目：28

## 已生成主体影根

| ID | 纹理 | 来源 | 地基外环占用 | 主体/地基面积 | 点数/部件 |
|---|---|---|---:|---:|---:|
| hamster_barracks | barracks | body_depth_v1 | 42.1% | 84.3% | 12/1 |
| hamster_barracks_level_2 | hamster_barracks_lv2 | body_depth_v1 | 36.6% | 67.2% | 12/1 |
| hamster_barracks_level_3 | hamster_barracks_lv3 | body_depth_v1 | 44.6% | 54.7% | 12/1 |
| blacksmith_level_2 | blacksmith_lv2 | body_depth_v1 | 41.5% | 71.6% | 12/1 |
| blacksmith_level_3 | blacksmith_lv3 | body_depth_v1 | 42.2% | 63.1% | 11/1 |
| weather_forecast_tower | weather_forecast_tower | body_depth_v1 | 82.2% | 65.9% | 4/1 |
| high_energy_laboratory | university | body_depth_v1 | 64.7% | 67.8% | 12/1 |
| high_energy_research_laboratory | high_energy_laboratory | body_depth_v1 | 48.3% | 86.0% | 12/1 |
| planar_observation_array | planar_observation_array | body_depth_v1 | 58.4% | 41.8% | 12/1 |
| interplane_research_hub | interplane_research_hub | body_depth_v1 | 48.4% | 67.3% | 12/1 |
| shooting_range_level_2 | shooting_range_lv2 | body_depth_v1 | 55.0% | 59.1% | 11/1 |
| shooting_range_level_3 | shooting_range_lv3 | body_depth_v1 | 44.3% | 64.0% | 12/1 |
| cavalry_school_level_2 | cavalry_school_lv2 | body_depth_v1 | 41.3% | 30.7% | 12/1 |
| cavalry_school_level_3 | cavalry_school_lv3 | body_depth_v1 | 45.3% | 32.7% | 12/1 |
| royal_mint | royal_mint | body_depth_v1 | 81.2% | 78.4% | 12/1 |
| grand_mall | grand_mall | body_depth_v1 | 65.6% | 43.8% | 4/1 |
| trading_company | trading_company | semantic_shadow_proxy_v2 | - | 71.6% | 12/4 |
| stock_exchange | stock_exchange | body_depth_v1 | 52.0% | 55.1% | 4/1 |
| computing_center | computing_center | body_depth_v1 | 80.6% | 97.1% | 12/1 |
| desert_cookhouse | desert_cookhouse | semantic_shadow_proxy_v2 | - | 67.2% | 12/6 |
| frost_smokehouse | frost_smokehouse | semantic_shadow_proxy_v2 | - | 56.8% | 12/10 |
| cannery | cannery | semantic_shadow_proxy_v2 | - | 64.9% | 12/9 |
| chain_restaurant | chain_restaurant | body_depth_v1 | 35.1% | 72.4% | 12/1 |
| corn_farm | corn_farm | body_depth_v1 | 48.6% | 87.1% | 12/1 |
| oil_power_plant | oil_power_plant | semantic_shadow_proxy_v2 | - | 62.9% | 12/6 |
| solar_power_plant | solar_power_plant | body_depth_v1 | 40.1% | 59.7% | 12/1 |
| geothermal_power_plant | geothermal_power_plant | body_depth_v1 | 24.7% | 25.8% | 3/1 |
| deep_drill | deep_drill | body_depth_v1 | 41.9% | 86.1% | 12/1 |

## 显式配置影根

- portal（portal_structure_occluder）

## 继续保守回退

### body-contact-geometry-out-of-bounds

- thatch_hut（thatch_hut）：外环=39.1%，面积=62.4%，边界=±101.3,-169.3..-41.3
- thatch_hut_level_2（thatch_hut_lv2）：外环=40.4%，面积=98.1%，边界=±103.6,-183.4..-40.6
- thatch_hut_level_3（thatch_hut_lv3）：外环=42.9%，面积=95.9%，边界=±104.2,-188.5..-38.3
- research_institute（research_institute）：外环=41.0%，面积=118.1%，边界=±123.3,-191.3..-41.8
- market（market）：外环=53.0%，面积=108.1%，边界=±127.7,-162.0..-34.6
- steam_power_plant（steam_power_plant）：外环=91.8%，面积=124.9%，边界=±147.3,-137.1..-0.2
- tavern（tavern）：外环=72.7%，面积=111.2%，边界=±138.2,-145.9..-4.6
- hamster_hut（mine）：外环=45.6%，面积=96.7%，边界=±122.8,-176.7..-28.7

### body-depth-crop-mismatch

- wind_power_plant（wind_power_plant_body）

### body-depth-foundation-exclusion-unproven

- mining_guild（mining_guild）：外环=62.4%

### missing-aligned-runtime-metadata

- wall_tower（wall_tower_sand）
- wall_tower_level_2（wall_tower_brick）
- wall_tower_level_3（wall_tower_black_brick）
- wall_tower_level_4（wall_tower_concrete）
- wall_tower_level_5（wall_tower_rune）
- thatch_hut_industrial（thatch_hut_industrial）
- hamster_barracks_industrial（hamster_barracks_industrial）
- blacksmith_industrial（blacksmith_industrial）
- plane_altar（defense_base）
- city_hall_industrial（city_hall_industrial）
- snow_castle（snow_castle）
- shooting_range_industrial（shooting_range_industrial）
- cavalry_school_industrial（cavalry_school_industrial）
- engineer_camp（engineer_camp）
- engineer_camp_level_2（engineering_workshop）
- engineer_camp_industrial（engineer_camp_industrial）
- engineer_camp_level_3（vehicle_factory）
- house（house_lv1）
- wheat_windmill（wheat_windmill_body）
- bank（bank）
- explorer_camp（explorer_camp）
- dungeon_candle（obstacle_candle）
- desert_mansion（desert_mansion）
- economic_workshop（economic_workshop）
- cheese_farm（cheese_farm_structure_occluder）
- mushroom_farm（mushroom_farm）
- house_lv1（house_lv1）
- house_lv2（house_lv2）
- house_lv3（house_lv3）
- house_lv4（house_lv4）
- house_lv5（house_lv5）
- house_lv7（house_lv7）

### missing-body-depth

- expedition_camp（command_post）
- command_post_level_2（military_headquarters）
- command_post_level_3（defense_ministry）
- blacksmith（blacksmith）
- church（church）
- church_level_2（church_lv2）
- church_level_3（church_lv3）
- city_hall（city_hall_lv1）
- city_hall_level_2（city_hall）
- city_hall_level_3（city_hall_lv3）
- warehouse（warehouse）
- shooting_range（shooting_range）
- cavalry_school（cavalry_school）
- jungle_temple（jungle_temple）
- planar_resonator（planar_resonator）
- armory（armory）
- field_hospital（field_hospital）
- bakery（bakery）
- house_lv6（house_lv6）

## 验证边界

- 裁切元数据必须直接指向正式 PNG，或其输出与正式 PNG 逐字节一致；模型代理或 Body Depth 身份必须与建筑 ID、纹理键精确相同，不跨等级借用。
- 优先采用 `.blend` 导出的语义多段代理；生成器会复核源模型 SHA-256、地基排除对象和几何边界，任一不匹配即拒绝陈旧代理。
- 生成器只接受模型清单或专用构建脚本明确排除地基的 Body Depth；外环占用仅作诊断，不用像素猜测地基语义。
- 未命中可靠来源的建筑继续使用现有 `visualFootprint` 影根，不做猜测性缩放。
- 本报告不是游戏运行时验收；正午、晨昏和建筑升级换图仍需玩家实机检查。
