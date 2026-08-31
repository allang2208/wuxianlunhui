# 市政大厅正式素材

> 2026-08-31归档收口：本目录三个`*_body.png`为可再生中间物，已清理；安装器从保留raw重建它们。三档正式PNG、标定/预览和来源不变。此次Git仅发布素材与制作来源，基地/科技/详情接线仍在本地，见`docs/city-hall-closeout-2026-08-31.md`。

2026-08-31，按用户后续“使用LV1默认，随着科技推进逐步升级LV2、LV3”的指令，完成三时代正式素材及科技接入。LV1采用现有B/v02（由助手在本次直接接入指令下选择），LV2保留阳台精修02，LV3采用此前用户选择的结构02；没有追加48步精修或新生成。

| 等级 | 来源 | 正式文件 | 显示尺寸 / 脚偏移 |
| --- | --- | --- | --- |
| LV1默认 | `../candidates_dev_s12_v1/city_hall_lv1/city_hall_lv1_structure_v02_raw.png` | `assets/terrain/city_hall_lv1.png`，875×603 | 517.321016×354.868966 / 174.491954 |
| LV2住房优化 | 既有阳台R01精修02 | `assets/terrain/city_hall.png`，876×711，原文件不变 | 517.314879×414.615034 / 204.974943 |
| LV3现代住宅体系 | `../candidates_dev_s12_v1/city_hall_lv3/city_hall_lv3_structure_v02_raw.png` | `assets/terrain/city_hall_lv3.png`，873×677 | 517.932793×400.258661 / 197.17321 |

- LV2来源：`../lv2-balcony/refine-r01/candidates/city_hall_lv2/city_hall_lv2_refine_v02_raw.png`，48步、seed 831302；三档原生成参数、完整raw、Depth与可编辑模型均保留。
- `install-assets.py`复用项目抠图与正式素材入口，去除绿底和主体外投影；保留门窗、旗帜及护栏间孔隙，不用旧Depth剪切精修图轮廓。
- 三档逻辑占地均为4×4，地面投影512×256，`visualFootprint.scaleMode=strict`，分别量取各自地台而非共用尺寸。元数据为`city_hall_lv1_runtime_metadata.json`、`city_hall_runtime_metadata.json`、`city_hall_lv3_runtime_metadata.json`。新增两档以3px内缘RGB处理收掉绿边，保留Alpha与植物，不改变LV2。
- 各档`*_preview.png`为浅底预览、`*_footprint.png`为4×4标定图，`city_hall_three_eras.png`为同尺度三时代总览；已查看素材预览，不作为游戏运行时验证。
- 仅更新`city_hall`、`city_hall_level_2`、`city_hall_level_3`三条ground-fit记录，新增LV1/LV3各四张环境光辅助图。该建筑不可手动建造，不额外生成建造菜单缩略图。

素材重建入口：项目Python运行`tools/ai-gen/_city_hall_20260830/runtime/install-assets.py --tiers 1 3`只处理新增两档；省略`--tiers`时重建全部三档。光照用项目Python运行`tools/ai-gen/build-lighting-maps.py city_hall city_hall_lv1 city_hall_lv3`；只重建本族，同时更新光照登记表，执行后须单独审阅该表，不能全量覆盖共享清单。这些是显式素材制作命令，不包含测试、构建或发布。

ground-fit配置与运行时接线暂未合入本次归档，当前主线不要直接运行对应ID的预览命令。待依赖与三条配置合入后，再按元数据同步尺寸、用`node tools/generate-building-preview-assets.mjs --only <上述三条id>`制作。既有标定图与元数据保留作参考。

接入行为与文件清单见`docs/player-base-city-hall.md`。未运行测试或运行时验证，按约定由用户测试；未同步固定EXE。
