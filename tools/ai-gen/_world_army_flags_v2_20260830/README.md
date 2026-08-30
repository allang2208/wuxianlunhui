# 世界地图兵旗 V2：地图材质统一与纹章精修

**当前正式版本**：用户比较V2/V3后选择本版，认为旗面更直观、展示更全面。已恢复原图集，约16.7°前倾作为辨识优先的姿态保留；55°相机与地图一致。V3转为未选用记录，旧图、模型及导出器已清理。

来源：用户反馈第一版画风不统一、旗帜图标粗糙，要求细节刻画和明确的位面特点。只调整兵旗美术，不修改世界地图UI、行军、战争、敌军编成或存档。

## 调整方向

- 与现有地图共用`environment-prop-materials.py`的石板、磨损木构和旧铁材质；55°正交相机、左上柔光和冷色填光保持原地图参数。降低亮金属面积，旗座换为低矮粗石与铁套。
- 重做向前鼓起的布面、窄布包边、独立缝线、皮扣、少量破边；徽记直接进入布料材质，随布面投影和光照变化，不再把粗线条浮雕悬在旗上。
- 纹章分别为：我方翼刃罗盘、沙漠狼首、雪原霜冠熊首、森林古树面具、遗迹断门守望、矿区矿镐晶簇。雪原毛皮领、森林枝杈旗冠、矿区小灯与锻铁横梁是独立模型细节。
- 纹章通过内置`image_gen`生成，原始PNG直接保留；不改写原图。Blender材质将其映射为哑光织物油墨色阶，与底布共用细织纹法线，没有发光或金属浮雕。`emblem-sources.json`保留全部提示词、原输出路径和使用文件。

## 文件与重建

- `build-army-flags.py`：独立可重建模型/UV/材质脚本。使用世界地图现有小物材质库与`world-map-camera.py`；共享相机重构保留原相机数值与旗布姿态，本次未重新渲染。
- `emblems/*.png`：六张原始生成纹章，作为建模阶段贴图源；**不会直接装入游戏**。
- `world-army-flags-v2.blend`：六组模型、UV、灯光和材质；纹章已打包进入blend。默认显示我方，其它Collection可分别启用。
- `whitebox/*.png`、`renders/*.png`：建模命令重新生成的1024px中间渲染，不纳入最终归档。
- `export-army-flags.py`：生成图集、帧坐标、接地锚点、Alpha范围和离线素材预览。仅`--install`更新游戏图集与配置。
- `army-flags-preview.jpg`：白模/材质/88px尺寸总览。
- `army-flags-terrain-preview.jpg`：与现有五个位面地貌组合，**不是游戏截图**。

```powershell
& 'E:/Program Files/Blender Foundation/Blender 5.1/blender.exe' --background --factory-startup --python-exit-code 1 --python tools/ai-gen/_world_army_flags_v2_20260830/build-army-flags.py
& '../ComfyUI/.venv/Scripts/python.exe' tools/ai-gen/_world_army_flags_v2_20260830/export-army-flags.py
# 明确替换正式资产时：在最后一条命令追加 --install
```

正式资产仍是`assets/ui/world-map/army-flags.png`及`data/world-map-army-visuals.json`，3×2帧、每帧256px，基础RGBA解码容量仍为1.5 MiB；地图和名册共用原有载入与选择代码。V1/V3废案及逐张渲染、重复图集已清理；重建须依次运行建模渲染和导出命令。当前正式PNG是唯一安装成品，原始纹章、可编辑模型及最终两张预览保留。正式安装状态看本目录`manifest.json`；旧安装器遇到更高版本配置时阻止覆盖。

本轮只运行素材生产工具并查看离线美术。未运行测试或运行时验证，按约定由用户测试；未构建或同步固定EXE。最终仍需用户查看游戏中缩小状态的纹章辨识、深色地貌上的对比度和脚点位置。

恢复记录：恢复时从本目录原PNG直接复制回正式目录（该重复源图集现已清理），没有重新编码或修改纹章；同步配套JSON并补充相机/展示姿态说明。画布只调整脚底圈的地面投影，已有预览不含这项UI变化。未运行测试或运行时验证，按约定由用户测试；未同步EXE。
