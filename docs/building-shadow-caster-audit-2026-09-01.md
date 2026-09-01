# 建筑主体影根离线审计（2026-09-01）

> 该报告由 `tools/generate-building-shadow-casters.mjs` 生成。只审计并派生视觉阴影低模；不修改逻辑占格、碰撞、寻路、`visualFootprint` 或建筑贴图。

- 审计视觉项：61
- 语义模型多段影根：0
- Body Depth 主体影根：13
- 配置显式影根：0
- 保守回退旧影根：48
- 运行时清单条目：13

## 已生成主体影根

| ID | 纹理 | 来源 | 地基外环占用 | 主体/地基面积 | 点数/部件 |
|---|---|---|---:|---:|---:|
| thatch_hut_level_2 | thatch_hut_lv2 | body_depth_v1 | 52.4% | 66.4% | 12/1 |
| hamster_barracks | barracks | body_depth_v1 | 42.1% | 84.3% | 12/1 |
| hamster_barracks_level_3 | hamster_barracks_lv3 | body_depth_v1 | 44.6% | 54.7% | 12/1 |
| weather_forecast_tower | weather_forecast_tower | body_depth_v1 | 82.2% | 65.9% | 4/1 |
| high_energy_laboratory | university | body_depth_v1 | 81.0% | 68.1% | 12/1 |
| interplane_research_hub | interplane_research_hub | body_depth_v1 | 51.9% | 55.7% | 4/1 |
| cavalry_school_level_2 | cavalry_school_lv2 | body_depth_v1 | 41.3% | 30.7% | 12/1 |
| cavalry_school_level_3 | cavalry_school_lv3 | body_depth_v1 | 45.3% | 32.7% | 12/1 |
| royal_mint | royal_mint | body_depth_v1 | 81.2% | 78.4% | 12/1 |
| stock_exchange | stock_exchange | body_depth_v1 | 51.9% | 55.7% | 4/1 |
| chain_restaurant | chain_restaurant | body_depth_v1 | 43.6% | 76.8% | 12/1 |
| solar_power_plant | solar_power_plant | body_depth_v1 | 66.5% | 59.6% | 12/1 |
| deep_drill | deep_drill | body_depth_v1 | 42.0% | 86.3% | 12/1 |

## 显式配置影根

- 无

## 继续保守回退

### body-contact-geometry-out-of-bounds

- hamster_barracks_level_2（hamster_barracks_lv2）：外环=52.4%，面积=129.8%，边界=±130.6,-162.1..-3.8
- research_institute（research_institute）：外环=88.3%，面积=105.3%，边界=±116.5,-140.9..-0.2
- grand_mall（grand_mall）：外环=86.3%，面积=124.3%，边界=±139.5,-147.2..-0.4
- computing_center（computing_center）：外环=46.9%，面积=95.2%，边界=±255.7,-320.2..-52.7
- market（market）：外环=52.4%，面积=106.0%，边界=±123.0,-162.3..-19.5
- steam_power_plant（steam_power_plant）：外环=42.3%，面积=119.2%，边界=±149.8,-170.4..-35.1
- wind_power_plant（wind_power_plant_body）：外环=33.2%，面积=131.1%，边界=±171.5,-132.1..33.7
- tavern（tavern）：外环=100.0%，面积=108.0%，边界=±132.7,-120.9..18.2
- hamster_hut（mine）：外环=43.0%，面积=99.7%，边界=±118.6,-177.0..-28.7

### body-depth-crop-mismatch

- thatch_hut_level_3（thatch_hut_lv3）

### missing-aligned-runtime-metadata

- wall_tower（wall_tower_sand）
- wall_tower_level_2（wall_tower_brick）
- wall_tower_level_3（wall_tower_black_brick）
- wall_tower_level_4（wall_tower_concrete）
- wall_tower_level_5（wall_tower_rune）
- plane_altar（defense_base）
- portal（portal_structure_occluder）
- snow_castle（snow_castle）
- high_energy_research_laboratory（high_energy_laboratory）
- planar_observation_array（planar_observation_array）
- house（house_lv1）
- wheat_windmill（wheat_windmill_body）
- bank（bank）
- explorer_camp（explorer_camp）
- dungeon_candle（obstacle_candle）
- desert_mansion（desert_mansion）
- economic_workshop（economic_workshop）
- cheese_farm（cheese_farm_structure_occluder）
- house_lv1（house_lv1）
- house_lv2（house_lv2）
- house_lv3（house_lv3）
- house_lv4（house_lv4）
- house_lv5（house_lv5）
- house_lv7（house_lv7）

### missing-body-depth

- thatch_hut（thatch_hut）
- blacksmith（blacksmith）
- church（church）
- church_level_2（church_lv2）
- church_level_3（church_lv3）
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
