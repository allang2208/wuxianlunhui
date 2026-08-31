# 七栋近代建筑定稿来源

本目录按 `archive.json` 保存七栋已采用建筑的有效来源；各阶段JSON只记录生成历史，未选兄弟raw和旧联系图已经移出活动目录。正式源、直接编辑祖先、模型和Depth均保留，未改像素。

这是独立素材归档。共享开发工作区已有v63接线，但它依赖的市政厅、工程营地基础功能尚未合入远端；本次未发布运行时接线。详情见 [发布边界](../../../docs/industrial-era-publication-2026-08-31.md)，9种单位计划见 [TODO](../../../TODO.md)。

| 建筑 | 定稿透明图 | 可编辑模型 |
|---|---|---|
| 近代侦察营地 | [PNG](../../../tools/ai-gen/_industrial_recruitment_materials_20260831/recon_camp/shadow_soften_v01/recon_camp_industrial_shadow_softened_transparent.png) | [Blender](../../../tools/ai-gen/_industrial_recruitment_materials_20260831/recon_camp/recon_camp_material_model.blend) |
| 近代步兵军营 | [PNG](../../../tools/ai-gen/_industrial_recruitment_materials_20260831/infantry_barracks_tent_v2/refine_s48_b02/cutout/transparent.png) | [Blender](../../../tools/ai-gen/_industrial_recruitment_materials_20260831/infantry_barracks_tent_v2/industrial_barracks_model.blend) |
| 近代射击学校 | [PNG](../../../tools/ai-gen/_industrial_recruitment_materials_20260831/rifle_range/refine_s48_b03/cutout/transparent.png) | [Blender](../../../tools/ai-gen/_industrial_recruitment_materials_20260831/rifle_range/rifle_range_material_model.blend) |
| 近代骑兵学院 | [PNG](../../../tools/ai-gen/_industrial_support_buildings_20260831/cavalry_academy_industrial/refine_s48_b01/cutout/transparent.png) | [Blender](../../../tools/ai-gen/_industrial_support_buildings_20260831/cavalry_academy_industrial/cavalry_academy_industrial_model.blend) |
| 近代炮兵工坊 | [PNG](../../../tools/ai-gen/_industrial_support_buildings_20260831/artillery_workshop_industrial/refine_s48_b01/cutout/transparent.png) | [Blender](../../../tools/ai-gen/_industrial_support_buildings_20260831/artillery_workshop_industrial/artillery_workshop_industrial_model.blend) |
| 蒸汽军工厂 | [PNG](../../../tools/ai-gen/_industrial_support_buildings_20260831/steam_arsenal_industrial/refine_s48_b01/cutout/transparent.png) | [Blender](../../../tools/ai-gen/_industrial_support_buildings_20260831/steam_arsenal_industrial/steam_arsenal_industrial_model.blend) |
| 近代市政大厅 | [PNG](../../../tools/ai-gen/_industrial_city_hall_20260831/cutout_s48_v02/city_hall_industrial_s48_v02_cutout_balcony_fix_v2.png) | [Blender](../../../tools/ai-gen/_industrial_city_hall_20260831/city_hall_industrial_model.blend) |

- `archive.json`：逐栋模型、Depth、12/48步raw、编辑祖先、制作记录和精确发布清单。
- `cleanup.json`：48个清理项及原因；本地可恢复目录 `tools/.trash-industrial-era-20260831/` 不进Git。
- 历史生成器的整批候选表不再是重建输入白名单；后续使用实际保留源和当前项目生成管线。图标RGB候选仍在本地待透明化，不包含在本批正式源列表中。
- 未运行测试或运行时验证，按约定由用户测试；未构建、未同步EXE。
