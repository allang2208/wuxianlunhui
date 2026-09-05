# 新1号局部返修

**当前状态：不采用。** 用户在2026-08-31查看对比后表示“还是原图好”，最终保留左侧V3新1号原图及其原有管路、标记。本目录仅保留返修历史，不是当前选稿来源；以下推荐和生成结果均为该决定之前的记录。

2026-08-31，用户明确同意将选中的新1号原稿及局部蒙版，连同此前授权的Depth和提示词，发送到`192.168.3.142:8188`进行局部返修。只修前景接管与门上三道热浪，不接入游戏或覆盖原稿；没有授权或启用Edge上传。

## 输入与范围

- 原稿：`../structure_correction_v3_12step/geothermal_power_plant/geothermal_power_plant_structure_v01_raw.png`。
- 结构源：`../model_correction_v2/geothermal_power_plant_depth.png`及对应可编辑V2模型。
- 蒙版：`geothermal_local_repair_mask.png`，红通道白色允许修改、黑色保留；共16,857个非零像素，占1024²画面的约1.61%，内收羽化4px。
- `mask_review.png`只用红色显示编辑区域，不作为生图底图上传。井口阀轮、筒体、屋顶、主机、外轮廓与底座边缘在修改区外。
- 管路意图：修正右前井口通往左换热器的连接，移除井口间多余的低矮青色桥管；保留左井口现有曲管。
- 标记意图：原四道改为三道独立竖向热浪，旧黄铜、不发光；维持原平板位置和立面透视。

## 生成与保留

通过统一`generate-world122-building-candidates.py`读取本目录`candidate-manifest.json`；FLUX.2 Dev＋Depth、World-122 v5、1024²、48步局部返修、默认2张、Depth 0.75、denoise 0.30、CFG 3.5、Euler/simple，种子128861～128862。未改变共享生成器或全局候选配置。

`generated/geothermal_power_plant/`保留原始返回图、完整提示词、同源Depth副本和逐图元数据。统一生成器在本地派生的Edge仅作历史流程辅助文件，实际提交未带Edge控制。

`prepare-and-compose.mjs`首先生成局部蒙版及红区预览；生成结束后以`compose`和返回原稿路径为参数，仅把蒙版区的返回像素合回原图，并冻结源Alpha。蒙版为0的区域直接使用原图，避免VAE往返改变已选中的其他材质；生成返回图仍单独保留，不冒充未经处理的原稿。

本轮仅进行请求所需的美术制作和图片查看；未运行测试或游戏运行时验证，按约定由用户测试。结果状态另在完成后记录。

## 局部重绘强度调整

标准0.30两张已完成（56.3/66.3秒），但均保留四道标记和井口间桥管，未达到修改目标。遵循局部结构返修例外，在相同原图、相同蒙版、相同V2 Depth和同一提示词下，仅将蒙版内denoise提高到0.72，显式使用`--allow-nonstandard`，另存`strong_d072/`；仍为48步、默认2张、Depth 0.75，种子128871～128872。该批是有记录的局部纠错例外，不伪装成标准整图精修通过；原0.30返回图不覆盖。

## 已完成结果

- 128871：166.6秒。三道热浪数量正确，右井口棕色管路连向换热器区域，前侧多余桥管已移除。推荐其局部合成版`geothermal_power_plant_refine_v01_local_locked.png`，保留原1号其余画面。
- 128872：158.7秒。仍出现四道热浪，前景管末端断开；不推荐。服务raw和派生文件保留为本次拒选证据，不进入正式资产。
- 推荐版直接生成源为`strong_d072/geothermal_power_plant/geothermal_power_plant_refine_v01_raw.png`，完整提示词为同目录`geothermal_power_plant_refine_prompt.txt`；两张元数据均明确`nonstandardOverride:true`、`localMaskedRefine:true`、`edgeControl:false`。
- `comparison/page_01.png`左为原图、右为推荐版；为了复用标准联系图工具，原图复制为本目录`00_before_local_locked.png`，仅作对照输入，不替代来源链。
- 四张服务raw、推荐合成版及前后联系图均已实际打开查看。合成仅按蒙版将生成像素回填，蒙版为0处RGB直接来自原图，Alpha逐像素沿用源图。没有缩放、抠绿、裁地台或把其他局部重新画进来。

当前只确认本次两处视觉返修有改善，不等于全部管路与模型逐像素重合，也不等于透明边界或运行时验收。原图的地台外投影及蒙版外细节保持原样；等待用户确认后再按后续阶段处理。
