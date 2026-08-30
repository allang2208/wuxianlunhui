# 大战略地图：城市与据点模型 V1

**归档状态（2026-08-31）**：本次发布正式图集、双份元数据和最小可编辑来源；地图显示/战略玩法代码仍只在本地开发源码，未随素材发布。用户认可的“四角塔楼、三组楼梯”是另一个战场实体预设，不改变本图集模型。发布限制见`docs/strategic-siege-publication.md`，清理清单见`docs/strategic-siege-cleanup-20260831.json`。

来源：用户明确要求敌方城市、据点经过建模、渲染后加入游戏。本目录为原生 Blender 建模与渲染来源，不使用战场建筑截图或生成图代替模型。接入开发源码；尚未经用户实机验收，不更新固定EXE。

## 内容与表现边界

- 沙漠、雪原、森林、遗迹、矿区各一座城市与据点，共10款；另有城市和据点两款共用废墟。
- 城市采用围墙、门楼、主堡与附属房屋；据点采用瞭望塔、营帐、围栏与补给。雪原积雪、森林木栅、遗迹石构、矿区井架与矿轨在模型阶段制作。
- 共用 `world-map-camera.py` 的55°正交相机，南侧向北、零滚转；`orthoScale=5.4`、目标`(0,0.05,0.85)`只用于统一画幅。模型根朝向18°用于同时展示正面和侧面，渲染后不旋转、镜像或压扁。
- 复用 `environment-prop-materials.py` 的石板、木材、旧铁、帆布等哑光程序材质及地图灯组。模型不烘焙固定阵营旗，攻占后保持原建筑，通过现有主题字标表示归属。
- 地面原点投影得到统一锚点；256px帧按元数据等比缩放。按用户反馈缩小城市与据点：画幅均为地图格半径的1.1倍，城市最多92px、据点最多80px，取消固定像素下限，缩远时跟随六边格继续缩小。两类原图底座大小不同，城市仍比据点大；原图、锚点和相机不改。建筑热区沿用显示后的Alpha外接范围与下方字标，军团仍优先点选。
- 只替换现有 `town/outpost` 战略标记的美术，真实位面入口 `kind=world` 保留原标记。摧毁显示废墟，普通受损与修复均保留原地貌模型；不新增废墟重建能力，不改战场建筑、逻辑占格、耐久、资源、保存结构或战争规则。

## 来源与成品

| 文件 | 用途 |
|---|---|
| `build-settlements.py` | 原生几何、材质、相机、渲染和源模型生成 |
| `world-settlements-v1.blend` | 12组可编辑模型和灯光；默认显示沙漠城市，其余在Collection中启用 |
| `manifest.json` | 用户授权、源相机、材质库、模型类型、导出容量和运行时验收状态 |
| `export-settlements.py` | 透明PNG打包、接地锚点与帧范围、元数据和离线预览 |
| `settlements-model-preview.jpg` | 两种代表模型的白模与材质成品 |

唯一正式图集：`assets/ui/world-map/settlements.png`，4×3帧，每帧256px，合计1024×768 RGBA，基础解码容量 **3 MiB**。帧与显示元数据为 `data/world-map-settlements.json`，同步 `public/data/` 镜像。此容量不等于新增总显存实测值，不含浏览器纹理副本与缓存。

运行时只载入图集，通过已有Canvas按脏标记绘制，不加载Blender模型、不增加每格实体或定时器。关闭地图释放图片回调与引用；图片加载失败时仍保留可点选的原字标。

## 重建

在仓库根目录运行素材生产命令：

```powershell
& 'E:/Program Files/Blender Foundation/Blender 5.1/blender.exe' --background --factory-startup --python-exit-code 1 --python tools/ai-gen/_world_settlements_v1_20260830/build-settlements.py
& '../ComfyUI/.venv/Scripts/python.exe' tools/ai-gen/_world_settlements_v1_20260830/export-settlements.py
# 在授权接入正式素材时，为最后一条命令追加 --install。
```

本轮用户已授权建模、渲染并接入，因此实际使用 `--install`。建模器可用 `-- --only desert_town forest_outpost` 重渲染指定模型；全量导出前应先生成全部12张渲染。`renders/`、`whitebox/` 为可重新生成的中间PNG，不纳入最终归档；保留可编辑blend、生产脚本、manifest和结构/材质对照图；缩小前的两张比例预览与渲染缓存已清理。重建必须先运行全量建模器，再导出；不要直接从空renders目录导出。

仅进行了素材生产与离线成品查看。**未运行测试或运行时验证，按约定由用户测试**：缩放时的大小、深色地貌可读性、建筑/军团重叠点选、占领变色、摧毁后显示废墟、受损据点修复和地图反复开关。
