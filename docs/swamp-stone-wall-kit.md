# 沼泽地牢单格石柱墙

> 当前墙体按用户最新反馈仅保留细碎枯枝，删除粗根、横木与大扭结并采用四个固定随机版本，现行入口见 [沼泽细碎枯枝墙说明](swamp-living-wall-kit.md)。本页保留石柱阶段来源及仍有效的藤蔓门合同；旧整套石柱安装入口已限制，门单独更新不会覆盖现行枯枝墙。

2026-08-30：用户确认采用当前双向藤蔓生长/回缩版本，保留现有模型与动画轨迹；实机验收仍待进行。当时未发布或更新固定 EXE；后续首次发布见 [测试版说明](exe-test-release.md)。

## 结构与范围

- 新建四款可编辑 Blender 石柱：A 湿蚀、B 苔藓、C 裂隙、D 缠根。共用 2.12×2.12×3.04 模型核心、倒角、周期接缝、相机与灯组；区别为表面材质和浅层细节。
- 参考废弃矿洞、雪原现有世界单格墙契约，沿等距轴 `(+64,+32)` / `(-64,+32)` 铺设；转角共享一根柱，禁止位移、缩放和镜像随机化。
- 沼泽初、中、高三级统一 `wallStyle: swampStone`、`wallConstruction: worldBlock1x1`、`gateCells: 6`、`passageCells: 8`。覆盖普通、精英、Boss 房和通道；未启用矿洞专属随机房/模板。
- 配套六格双向生长藤蔓门，独立门叶，不重复制作门柱。参考旧 `assets/terrain/swamp_gate.png` 的交织藤蔓和少量绿叶外观；参考图不直接裁入新帧。按最新反馈取消整体沉降，根部固定左右两端，藤梢逐段伸长/卷曲回缩，叶片在藤梢经过后展开；关门时向中央交织，开门时退回两侧。16帧中帧0关闭、帧15门叶清空；沿用原沼泽门声、既有开关门碰撞时机与六片深度排序。
- 沼泽末房沿用实体宝箱围墙语义，转用同款石柱的标准12格宝箱房。未改怪物、波次、奖励、地板或地牢路线；单格化后的墙线和宝箱房尺寸需实机验收。
- 旧 `swamp` 连续墙样式、贴图及预制件保留，供旧预制件与编辑器引用；其他地牢的墙选款规则不变。

## 运行时文件

| 文件 | 用途 |
|---|---|
| `assets/terrain/swamp_living_block_a.png` 至 `_d.png` | 现行四款细碎枯枝；废弃石柱PNG已清理 |
| `assets/terrain/swamp_stone_gate.png` | 2560²图集，4×4排列640²门帧 |
| `data/swamp-stone-wall-kit.json`、`public/data/swamp-stone-wall-kit.json` | 同源预载与几何登记 |
| `src/world/wall-system.js` | 注册几何与 `swampStone` 样式 |
| `src/world/combat-room-system.js` | 支持按样式指定散列右移位数；仅沼泽使用8 |
| `src/world/dungeon-map-system.js` | 沼泽单格墙保留实体宝箱房 |
| `src/phaser/scenes/BootScene.js` | 从新几何清单预载墙图和门帧 |
| `data/dungeon-config.json`、`public/data/dungeon-config.json` | 三档切换墙体结构 |

墙源画布1024²，脚点 `[512,761.9959]`，显示画布260×259，footprint128×64，结构墙高132、碰撞半厚13。可见高度按 `(groundY-alphaTop)×259/1024` 为167.438px，与现有单格墙基准相当。

原世界坐标按64/32步进时，散列低两位固定，直接 `%4` 会只选中一款。新样式单独设 `blockVariantHashShift:8`，用 `(hash >>> 8) % 4` 选款；未改变旧样式的散列。离线样张使用相同世界坐标公式、脚点和邻接半墙段深度，不用样张屏幕位置决定款式。

## 可编辑来源和重建

来源目录：`tools/ai-gen/_swamp_stone_wall_kit_20260830/`。

- `swamp_stone_wall_kit.blend`：四个墙集合、独立门叶集合、墙/门相机、PBR节点及门叶1～16帧动画。
- `geometry.json`、门Depth、门图集与 `gate_frames/`：保留有效门几何及16帧动画合成输入。
- `manifest.json`：当前仅藤蔓门有效，旧墙已退役；`runtime-wall-kit.json` 同步现行枯枝墙登记。
- 最终预览在 `_swamp_deadwood_wall_kit_20260830/deadwood-wall-vine-gate.gif`；旧石柱版预览/PNG/Alpha/Depth与绿植墙候选已经移入忽略目录，清单见 `swamp-delivery-cleanup-20260830.json`。

生长动画由左右各16根原生曲线逐帧重建控制点/半径，并对叶片展开比例设关键帧；两端根部世界X固定为±2.84，各藤蔓有少量进度差。没有整张贴图横向压缩或竖直平移；模型内保留完整1～16帧曲线/叶片关键帧。`geometry.json` 的 `animation` 和 `motion` 保存双向生长说明与逐帧生长参数，不再使用 `sinkWorld`。运行时继续正反播放同一图集，不新增 `leafMotion` 的整片升降分支。

全部是本次原生模型与程序PBR材质，没有外部贴图、AI生成图或视频来源。仅复用 `abandoned-mine-wall-kit-blender.py` 中基础建模、相机和渲染函数，不修改或覆盖矿洞模型。

离线重建命令（不是游戏测试或EXE发布命令）：

```powershell
& 'E:/Program Files/Blender Foundation/Blender 5.1/blender.exe' --background --factory-startup --python tools/ai-gen/build-swamp-stone-wall-kit.py
& 'E:/无尽轮回/长期备份/2026-7-13-1/ComfyUI/.venv/Scripts/python.exe' tools/ai-gen/compose-swamp-stone-wall-kit.py --install --gate-only
```

省略 `--install` 只合成门图集和派生清单；不会安装。旧脚本现在始终只更新藤蔓门，不再读取/输出/安装淘汰石柱PNG；`--gate-only` 为兼容参数。当前墙门拼接预览使用 `compose-swamp-living-wall-kit.py`。模型中仍保留旧石柱集合和墙相机，因为此可编辑源同时保存已确认门动画；共用建模和拼装函数仍被现行枯枝墙制作入口依赖，不可按文件名删除。

仅重新合成预览不会把已安装或已确认外观记录改回“未安装/待确认”。本轮清理没有运行Blender、合成脚本、游戏测试或EXE发布。

## 离线结果与待验收项

### 左上/右下门口接线核对

按第06卷“门口系统”第10条双轴源图裁片合同核对当前接线，未发现沼泽绕过既有修复的分支，因此本轮不改运行时逻辑或重渲已确认素材。

- **LT/RB（左上/右下）镜像**：不是把门精灵位置反射，也不是给切片直接叠加 `flipX + setCrop`。入口/通道的 `_createArenaGate`、出口的 `WallGate.placeAt`、宝箱的 `_placeGate` 及出口轮廓均使用 `bindGateSourceCrop`，视觉改用负scaleX、flipX=false，源图列不变，切帧后重新应用crop。逻辑门件仍保留原几何镜像值，用于底线/碰撞映射。
- **位置和跨度**：单格入口/通道从端墙真实接缝重建门件；出口使用 `fitSpan`。门件按上端→下端统一端点顺序、从底边推导朝向，不反射门精灵中心；本次提交复用主线现有门口实现，不夹带并行任务的通用门口重构。宝箱门消费已归一化的开口端点。六格跨度与1×1端墙保持原登记。
- **门端遮挡**：沼泽明确配置 `depthSlices:6`、`tuckEndSlices:true`；各入口均逐段登记面线。首尾片取各自门洞外端点Y+3.9，端墙为底线maxY+4；高亮仅再加0.05，不越过端墙。
- **生长动画**：沼泽没有矿洞刚性升降的 `leafMotion`，仍正反播放16帧藤蔓图集；左右生长轨迹不再做额外镜像或平移。完全开启帧清空，保留既有碰撞时机。

离线GIF的“先裁源图列、后镜像整画布”与上述变换口径一致，但不是Phaser实机方向正确的证明。用户实测重点为LT入口、RB出口及宝箱门：关闭/半开/完全开启时门端错片、压墙、位置偏移和残留高亮。

四款Alpha包围框均为 `[212,100,812,912]`；主体中位亮度最大差0.00281、平均亮度最大差0.00163。12×12世界格样本四款计数为36/38/35/35。门帧15的Alpha为空。这些仅是离线素材数据，不代表游戏验证通过。

未运行测试、构建、lint或运行时验证，按约定由用户测试。需重点观察：三档新进入战斗时墙体加载；长墙/四角/门端接缝；角色靠墙前后遮挡；门关闭阻挡与开启通行；Boss后宝箱围墙及离场清理。固定EXE只在用户明确要求同步时另行发布；本次Git整理不改变已有测试包。
