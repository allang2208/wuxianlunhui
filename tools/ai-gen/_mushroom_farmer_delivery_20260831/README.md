# 蘑菇农场仓鼠送仓动画（2026-08-31）

> 后续运行时标定已按用户要求与奶酪/玉米统一为约78px主体高度；运输scale与脚点以 `data/population-economy.json` 和 `docs/farm-warehouse-workers-unification-2026-08-31.md` 为准。下文100px及本目录旧GIF记录初次制作时的显示规格，源PNG/帧序未改。最新尺寸GIF在 `../_farm_worker_unification_20260831/after-mushroom-animation.gif`；24fps是80px/s、人口效率100%时的基础播放速度，运输升级后按每精灵倍率加速。

## 来源与实际制作

- 身份沿用玉米农场仓鼠农夫母图：`references/farmer-master.png`，其源为现有农夫 `idle.png` 首格。草帽、黄白毛色、米色衬衣、橄榄绿马甲、棕裤与侧包不改。
- 本次 H3 输入保存在 `references/`：小主体母图与原农夫跑步动作参考。通过 `ai-asset.py video generate --provider h3 --reference-mode reference`，使用局域网 RTX 5080 的 MiniMax H3 Ref2VA，不使用豆包或其他生成模型。
- 新源视频 `videos/mushroom-loaded-running-v01.mp4`：1024×576、124帧、24fps，20步，seed 831031。完整提示词、实际模型、输入/输出来源记录在同名 `.mp4.json`；提示词快照在 `prompts/`。
- H3 生成了四枚棕色菌盖、浅色菌柄的食用蘑菇，并误生细长鼠尾。透明派生时只清理身体后方、避开侧包与双脚的远端长尾，保留短尾根；不改原MP4。H3实际生成浅蓝背景，透明处理使用 BiRefNet Alpha和邻近主体颜色回填，清理蓝/青边缘，不改变绿马甲主体或Alpha轮廓。
- 采用新视频 `[42,72)` 帧，每2帧取1帧，排除重复端点72；15张原关键帧经RIFE v4.6插为30帧。单一仿射变换和固定0.398比例保留原始离散步态及腾空变化，不逐帧缩放或拉直轨迹。
- 空手返程复用玉米已采用的H3视频。原MP4及原来源记录另存 `videos/empty-running-reused.mp4`、`empty-running-original-provenance.json`，后者路径保留原始生成时的位置。本次从玉米正式30帧表提取15张偶数原生关键帧，以0.5比例生成专用副本，再RIFE插帧；玉米原图、代码和播放速度不变。

## 正式规格与资源预算

工人用途档位 `crowd`；正常镜头主体约100px，256格中主体约199px，适用于现有128px显示画布。相同角色世界尺寸不变，返程与抱蘑菇使用各自声明的脚点。

| 动作 | 表尺寸 | 有效帧/格 | 播放 | 脚点 | 基础RGBA |
|---|---|---|---|---|---|
| idle（创建用首格） | 256×256 | 1 / 256×256 | 单帧 | footRatio 0.7988 | 0.25MiB |
| mushroom_loaded_running | 1280×1536，5×6 | 30 / 256×256 | 24fps，1250ms，循环 | (128,224)，0.875 | 7.5MiB |
| empty_running | 1536×1280，6×5 | 30 / 256×256 | 24fps，1250ms，循环 | (128,210)，0.8203125 | 7.5MiB |

完整专用纹理族 `hamster_mushroom_farmer` 合计15.25MiB，低于32MiB目标；无专属投射物或召唤依赖，末行无空格。一次场景内各农场共享这三个纹理键，不随农场数复制。双场景完整重叠上界为本族30.5MiB，不是整场景或显卡实测承诺；既有其他农夫纹理预算未修改。源分辨率降采样会改变像素，高倍放大清晰度由用户判断。

`manifest.json` 为本次成品参数/缩放/索引/预算记录，`video-sheets/*-report.json` 为RIFE生产报告。生产报告未发现空帧、贴边帧或可见蓝/青溢色、黑块，原关键帧保留在偶数索引；最终透明表尾首步幅/普通步幅中位数约为1.050（抱蘑菇）、0.933（空手）。这些是离线素材制作数据，不代表游戏测试通过。

## 接入与播放规则

- `data/population-economy.json`：只替换蘑菇农场的 `workerVisual` 为独立ID和三张专用表；`displaySize=128`、岗位数与其他生产参数不变。
- `src/world/hamster-cowherd-visual-system.js`：蘑菇 `to_deposit` 播放 `mushroom_loaded_running`，`waiting_deposit` 保持抱蘑菇第12帧，`to_farm` 播放空手跑步；`processing` 仍完全隐藏。停路时冻结对应动作，不原地跑。
- `assets/companions/hamster_mushroom_farmer/`：三张正式PNG。沿已有统一平民加载/注册入口，不增加Boot常驻清单或新结算系统。
- 生产结算时间到才生成待送货物，真正进入仓库且全部存完才切空手返程；部分存入、满仓或目标变化仍由现有农场任务处理。回到农场后进入下一轮生产并隐藏。
- 本次不修改 `cheese-farm-system.js`、产量、日照加成、移动速度、道路、入口、寻路、存档或玉米/奶酪流程。

## 可直接查看的交付

- `../_farm_worker_unification_20260831/after-mushroom-animation.gif`：两状态并排，统一脚点、24fps、2倍显示预览；方向仅用于展示，不是游戏截图。
- `previews/mushroom_loaded_running.gif`、`previews/empty_running.gif`：各自完整循环，GIF按40/50ms交替时间片累计保持1.25秒一轮。
- `videos/mushroom-loaded-running-v01.mp4`：新H3原视频；`videos/empty-running-reused.mp4`：复用返程源视频。
- `video-sheets/`：保留当前未插帧base表和RIFE报告；最终表唯一位于assets。逐帧抠图和重复成品已回收。

## 重建与归档边界

默认重建入口为 `rebuild-retained.py --rife <rife-ncnn-vulkan.exe绝对路径>`：只读取现存两张未插帧base表，调用本目录冻结producer，输出到被忽略的 `_rebuild/`，不调用H3/BiRefNet，不覆盖正式资源或配置。`build-sheets.py`保留原始制作算法；其`--prepare-return`只用于重新制作，依赖未在本归档发布的玉米正式表，不是默认重建步骤。最终待机单帧保留在assets，正常物流不播放它。

当前78px体量与步频配置快照见 `worker-visual-config.json`，实际本地data仍为游戏真源。远端尚缺玉米/蘑菇基础建筑与物流接线，本次只发布素材档案，未将共享代码夹带提交。见[发布范围](../../../docs/animation-publication-2026-08-31.md)与[清理清单](cleanup-manifest.json)。

未运行测试或运行时验证，按约定由用户测试；未同步EXE。
