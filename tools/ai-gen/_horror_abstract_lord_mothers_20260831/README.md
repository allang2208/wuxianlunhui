# 恐怖地牢抽象领主母图候选

2026-09-01完成两只恐怖地牢抽象领主接入。百褶噬团为四动作60/52/81/81帧、58.22MiB，使用锁向重压与褶甲收势弱点；空腔之卵为五动作62/62/83/61/83帧、54.81MiB，使用真空汲引与壳脉冲。两者均已登记正式图集、实体、双份配置、Boot资源和恐怖地牢候选池，尚未运行测试或游戏验收。[百褶接入设计](../../../docs/pleat-devourer-integration-2026-09-01.md) · [百褶发布记录](animations-pleat-v03-20260831/sprite-production-v01/runtime-integration.json) · [空腔发布记录](animations-hollow-v01-20260901/sprite-production-v01/runtime-integration.json)。

[四动作透明动画预览](animations-pleat-v03-20260831/sprite-production-v01/preview.md) · [图集、源帧与预算说明](animations-pleat-v03-20260831/sprite-production-v01/README.md)

[空腔之卵五动作透明预览](animations-hollow-v01-20260901/preview.md) · [朝向、大小与形变报告](animations-hollow-v01-20260901/audit/report.md)

| 名称 | 当前候选 | 提示词 |
|---|---|---|
| 百褶噬团 | [右向动画母图 v03](mother/pleat-devourer-mother-v03-animation-right.png) | [镜头修订提示词](prompts/pleat-devourer-mother-v03-animation-camera.txt) |
| 空腔之卵 | [白底母图 v02](mother/hollow-ovum-mother-v02-white.png) | [初次生成](prompts/hollow-ovum-mother-v01.txt)、[白底编辑](prompts/hollow-ovum-mother-v02-white-edit.txt) |

两只分别突出低伏褶皱体和悬浮空腔壳体，均无头部、眼睛和四肢。使用内置 image_gen；空腔之卵的首次输出为 RGBA，白底版通过 image_gen 编辑，直接源图保留在 references/。

百褶噬团v02按用户要求，参考现有裹尸囚徒、棺板卫尸和缚钟侍者的母图：采用灰褐干皮、脏白殓布、粗缝线及少量锈铁固定件，将原先密集黑亮褶皱改为有前后方向的非对称匍匐噬囊。仍保留非人形身份，不借用参考怪物的头脸、四肢、盾牌或钟体。参考图片副本保存在references/；原v01及提示词作为本次直接编辑输入保留，不再作为当前候选。空腔之卵本轮没有修改。

v03保留v02外形，参考僵尸犬v04与刽子手右向v06，将身体轴向改为横向朝右并保留轻俯视，使用1672×941宽画幅、纯白背景及动作留白。v02及其来源清单继续保留为直接编辑祖先。[视频制作记录](animations-pleat-v03-20260831/README.md)包含不可变提示词、制作合同、上传授权和成片来源，[原视频预览](animations-pleat-v03-20260831/preview.md)保留历版偏差记录。此前攻击v03/v04各单次免费提交；本次只处理已有源片，没有新增视频请求、覆盖原片或确认付费。

活动记录与来源见 [task-index.json](task-index.json)。正式图集分别位于`assets/enemies/pleat_devourer/`和`assets/enemies/hollow_ovum/`。获准母图、直接编辑祖先、正式源片、未插帧关键图集、最终图集/GIF、提示词和来源报告继续保留；逐帧抠图缓存、重复预览及已判退视频共486个文件、264.38MiB已删除，逐文件记录见[清理清单](cleanup-manifest-20260901.json)。未运行测试或游戏运行时验证，按约定由用户重点验收体量/碰撞、命中时机、控制打断、墙体遮挡和死亡淡出。
