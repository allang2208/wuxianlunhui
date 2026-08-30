# 世界六边形地貌 V2

用户已要求在首版基础上增加随机感、细节并运用到游戏；本目录是本次晋级来源，首版只保留本版仍使用的几何脚本、305格布局与历史元数据。

- `build-hex-models.py`：Blender原生模型、变体、UV与PBR作者脚本；复用 `../_world_hex_map_20260830/build-hex-models.py` 的相机/基础几何及 `../environment-prop-materials.py` 材质库。
- `world-hex-models-v2.blend`：50个独立命名集合，项目贴图已打包；默认显示forest_04集合，其余集合隐藏，需单独显示编辑。55°正交，地面原点一致。
- `model-renders/`与`whitebox/`为可重建中间物，已清理；先运行建模命令生成，再运行导出。
- `export-world-map.py`：导出正式3200×1600图集、双份布局及离线美术预览；使用首版305格区域布局，只重排视觉变体。
- `manifest.json`：生成方式、材质来源、相机、随机种子、实际帧和容量；正式布局位于仓库`data/`与`public/data/`，制作目录重复副本已清理。
- `previews/world-map-v2.png`：地图美术概览；`hex-variants-v2.png`：50变体总览；`model-material-v2.png`：模型/材质对照。均不是游戏截图。
- 本任务旧备份、首版候选和中间渲染已清理，详见`../../../docs/world-strategy-source-cleanup.json`；没有还原或改动其他任务文件。

图集已晋级 `assets/ui/world-map/terrain-atlas.png`，无需再用首版候选图集。没有外传素材，没有远端AI调用，也没有测试或启动游戏。模型保存时出现本机Blender缩略图路径的OpenImageIO警告，但全部目标PNG和blend已保存、作者进程正常退出；不在本任务中修改用户Blender环境。

从仓库根目录重建（生产资产，不是游戏测试）：

```powershell
& 'E:/Program Files/Blender Foundation/Blender 5.1/blender.exe' --background --factory-startup --python 'tools/ai-gen/_world_hex_map_v2_20260830/build-hex-models.py'
& 'C:/Users/allan/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe' 'tools/ai-gen/_world_hex_map_v2_20260830/export-world-map.py'
```

游戏接入、资源估算与待用户检查事项见 `docs/world-map-panel.md`。有限变体仍会在远处复用；这次减少相邻重复、增加模型与材质差异，不声称每个格子都是唯一资产或已达到最终美术验收。
