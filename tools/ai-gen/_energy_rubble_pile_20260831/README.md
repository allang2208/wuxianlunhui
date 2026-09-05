# 1×1矿石堆砌能量矿脉模型 v2

2026-08-31，按用户要求重新建模。用户先确认v2模型与局域网ComfyUI出图，随后选定矮堆3号并生成五款矿脉分布，最后明确要求“接入游戏”。本目录记录V3阶段；当前运行时已由`../_energy_rubble_pile_v4_20260901/`的五种独立轮廓替换，但矮堆v03仍是V4的材质、相机与光照风格真源。生成与存档边界见[接入说明](../../../docs/energy-rubble-clusters-2026-08-31.md)。

## 定稿归档清理（2026-09-01）

按用户要求清理废案后，已移除首批偏高的`candidates_dev_s12/`、未形成有效分布差异的`vein_variations_v1/`与`vein_variations_v2/`、对应旧联系图、`.blend1`和`__pycache__`。这些历史路径不再是活动输入；失败原因和移除范围保存在`cleanup-manifest.json`。继续保留矮堆v03完整raw、模型/Depth、V3五分布正式源链、运行时记录和V4实际引用的风格真源。

- 按最新反馈彻底去掉连续地表平面：底部改为49块独立低矮矿石，与上方24组碎石叠放。模型没有地基、托盘、连续底板或隐藏的填底平面。
- 200×200模型坐标作为约1×1占地基准。共用建筑组件库的材质、场景、正交相机和Depth导出，相机30°、根旋转44.8°；外缘由石块自身自然咬合形成锯齿，不再用平面描出菱形。
- 大小、切面和高度不同的矿石形成中央稍高、周围低矮的堆砌。所有散石在模型阶段限制于占地内部，不靠裁透明边或改变相机来修正越界。
- 其中4组石块带分裂断面，蓝青矿物是断面之间的扁平不规则内嵌面；不使用圆管、连接帽、直立水晶、投影平面或外部泛光。
- `surface_deposit / foundationStyle:none`只描述这份新模型的候选用途，不意味着已更新共享候选manifest。

## 文件

- `energy_rubble_pile_model.blend`：可编辑模型，上层碎石、断面、矿物面、底层矿石均独立命名；打开后为材质预览场景。
- `energy_rubble_pile_model_preview.png`：Blender原生1024×1024透明预览。
- `energy_rubble_pile_model_approval_preview.png`：同内容模型交付图。
- `energy_rubble_pile_body_depth.png`：与材质预览同相机、同画幅的完整Depth。
- `energy_rubble_pile_review_board.png`：主体、标准方形占地投影参考和128px宽缩小示意。金线仅存在于说明图，不是模型组成部分；缩小示意不是游戏截图。
- `manifest.json`：当前候选身份、模型坐标、相机、地基角点投影及来源登记。
- `build-model.py` / `present-model.py`：本资产专用建模及展示脚本，复用公共组件库，不改变共享工具。
- 首批偏高候选及其专用manifest/联系图已在定稿归档时清理；以下小节只保留参数和拒绝原因，不再提供活动文件链接。

## 12步出图

- 标准入口：`tools/ai-gen/generate-world122-building-candidates.py`。
- FLUX.2 Dev + 完整v2 Depth，1024×1024，12步，3张，CFG 3.5，Euler/simple，Depth强度0.78，不启用Edge Control；种子131831、131832、131833。
- 共享生成器新增仅由`surface_deposit + surfaceDepositForm:stacked_rubble`启用的提示词分支，防止旧矿脉的“完整浅菱形矿床”要求把底部重新变成连续平板。其余资产分支保持原样。
- 候选采用`--raw-only`：保留生成的绿底原图、Depth、提示词和参数，暂不裁切、锚点调整或安装；用户选定后才进入48步精修。
- 网络授权：首次上传被自动安全审查拦截后，用户已明确同意向`http://192.168.3.142:8188`发送本模型Depth、生图提示词与工作流参数，并下载3张Dev 12步候选；随后使用同一标准入口提交成功。未上传游戏代码，未抢占或清空共享队列。

本批执行命令：

```powershell
& 'E:/无尽轮回/长期备份/2026-7-13-1/ComfyUI/.venv/Scripts/python.exe' -B tools/ai-gen/generate-world122-building-candidates.py --manifest tools/ai-gen/_energy_rubble_pile_20260831/candidate-manifest.json --out tools/ai-gen/_energy_rubble_pile_20260831/candidates_dev_s12 --only energy_rubble_pile --stage structure --variants 3 --raw-only
```

## 首批结果与建议

3张已全部生成，标准生成器正常完成。每张均保留`*_raw.png`和对应`*_generation.json`，同目录保留实际提交的Depth与完整提示词；Edge派生图只作管线输出，本批未启用Edge Control。

| 候选 | Seed | 原图 |
|---|---|---|
| 1号 | 131831 | 已清理；偏高拒稿 |
| 2号 | 131832 | 已清理；偏高拒稿 |
| 3号 | 131833 | 已清理；偏高拒稿 |

实际查看三张原图后的判断：

- 底部均由石块构成，没有重新出现地台或连续平板。大块灰色切面的材质比原先写实碎石更简洁，画风方向可以继续使用。
- 三张都明显偏离了已确认模型：中央被合并、拔高为少数大岩块，缺少原模型低矮而分散的堆砌层次；3号的中央高峰尤其明显。
- 能量矿脉的饱和度和亮度偏高，也由零星内嵌面延展成较连续的亮蓝线。
- **不建议本批直接进入48步。** 后续应先让12步结果忠实保留模型的低矮多石块结构，并压低矿脉亮度。若用户更喜欢本批增高造型，应先明确接受这一几何变化，再选择精修源。

本批只生成已授权的3张；没有自动追加批次，没有启动48步，也未将任一张登记为已接受结构。没有用Depth硬裁来掩盖超出模型的中央高岩块。

## 用户确认后的矮堆纠偏批

用户随后确认“同意，可以稍微矮一些，这个堆砌太高了”。本轮沿用已确认的低矮v2模型、相机和完整Depth，不改1×1占地，也不把首批成图做纵向压缩。

- `candidate-manifest-low.json`与`candidates_dev_s12_low/`保存本轮配置及输出；首批原图与提示词保留不变。
- 标准参数仍为Dev 12步、3张、Depth 0.78、CFG 3.5、1024²；新种子131841～131843。
- 提示词明确低矮、横向铺开、多个分散的小石峰，取消对大块上层岩石的重复强调；矿脉改为较暗的低饱和灰蓝内嵌面。
- 仅精简矿堆专用提示词分支，没有改其他建筑类别或公共v5画风。复用`present-candidates.py`的可选批次参数，避免覆盖首批联系图。

本轮命令：

```powershell
& 'E:/无尽轮回/长期备份/2026-7-13-1/ComfyUI/.venv/Scripts/python.exe' -B tools/ai-gen/generate-world122-building-candidates.py --manifest tools/ai-gen/_energy_rubble_pile_20260831/candidate-manifest-low.json --out tools/ai-gen/_energy_rubble_pile_20260831/candidates_dev_s12_low --only energy_rubble_pile --stage structure --variants 3 --raw-only
```

三张矮堆候选已全部生成并逐张查看。共享显卡排队使首张和末张等待较久；未干预其他任务或重复提交。

| 本轮候选 | 结果 | 原图 |
|---|---|---|
| 1号 · 131841 | 已明显压低，底部保留散石；矿物偏向嵌入式小晶矿露头 | [矮堆v01](candidates_dev_s12_low/energy_rubble_pile/energy_rubble_pile_structure_v01_raw.png) |
| 2号 · 131842 | 比首批低，但仍偏高，底层有平铺石板的倾向，不推荐 | [矮堆v02](candidates_dev_s12_low/energy_rubble_pile/energy_rubble_pile_structure_v02_raw.png) |
| 3号 · 131843 | **推荐**：低矮宽展、石块层次自然，矿物呈不规则表面露头 | [矮堆v03](candidates_dev_s12_low/energy_rubble_pile/energy_rubble_pile_structure_v03_raw.png) |

- [本轮三张联系图](energy_rubble_pile_dev_s12_low_candidates.png)：全部保留完整原始画幅，未抠图、裁主体或改变宽高比例。
- 首批与矮堆批的旧高度比较图已在定稿归档时清理；它不属于获准来源链。
- 1号与3号已经满足本轮降低堆高的方向，但蓝色仍偏亮，矿物也没有逐一保留模型中的四条内嵌矿缝。推荐3号供用户选择，不能把推荐写成已接受结构；下一阶段仍需收敛矿物表现。
- 未启动48步精修，未替换运行时资产。用户确认的模型v2、Depth、相机和逻辑占格均未改变。

## 已选矮堆3号与五种矿脉分布

用户明确确认“同意，以3号为基准，生成5个不同蓝色矿脉分布的图片”。该确认选中的是矮堆批`candidates_dev_s12_low/.../energy_rubble_pile_structure_v03_raw.png`，覆盖前文“仅推荐、尚未确认”的阶段状态，不是首批偏高的3号。

- 本批在[vein_variations_v3](vein_variations_v3/README.md)制作五种分布：左侧集中、右侧集中、中部串联、前沿散点、对角分布。
- 使用`vein-variations.py`准备位置引导与局部蒙版，再由标准建筑生成入口完成Dev 48步精修。实际局部denoise 0.55、Depth 0.75，非标准重绘强度明确记录。
- 只在矿点及附近石面采纳生成像素，其余区域来自选定3号；模型、石堆高度、外轮廓、底边及整个运行时均不变。
- `vein_variations_v1`的1张标准尝试和`vein_variations_v2`的2张加强重绘尝试未形成足够明确的位置差异，已在定稿归档时删除，只在`cleanup-manifest.json`保留失败原因。
- 五张已全部完成并逐张查看，最终文件见本批README和manifest；[五种矿脉分布联系图](vein_variations_v3/mineral-distribution-candidates.png)同时展示五张局部合成候选和原始基准。本次是候选制作，不表示用户已选择其中一张替换正式贴图。

## 矿洞紫色高能矿脉接入

在五款蓝矿获准接入后，按用户要求新增矿洞专属紫色版本。由`export-high-energy.py`仅调整矿物颜色，保留正式图的石堆、尺寸和Alpha；不重新调用生图。五款紫图已加入加载与矿洞新生成入口，初始储量为普通矿2倍，耗尽共用原灰岩态。来源、预览及存档适用边界见[high_energy/README.md](high_energy/README.md)。

## 边界

建模只修改本目录；出图准备另在标准生成器加入上述矿堆专用提示词分支。旧16格拼接模型与正常/枯竭图集、旧三形态兜底贴图、游戏代码、逻辑占格、碰撞、采集和存档均未改动。将来如选用这个单体矿堆，需要另行确定如何接入现有16格系统，不能直接把单张图覆盖到图集中。

已完成建模出图、首批3张及矮堆修正版3张Dev候选生成和交付所需的图片查看；未运行测试、构建、游戏、浏览器或运行时验证，按约定由用户测试。`*_model_preview.png`仍是Blender预览，`*_structure_vNN_raw.png`才是对应批次的Dev生成结果。
