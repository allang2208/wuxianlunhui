# 百褶噬团：动画视频候选

最新进展（2026-09-01）：用户已要求导入游戏，四动作透明图集、单时钟状态机、领主数值和恐怖地牢领主池已接入。总解码58.22MiB，原片/选段/固定根点不变；[发布记录](sprite-production-v01/runtime-integration.json)与[透明动画预览](sprite-production-v01/preview.md)为当前交付。未运行测试或游戏验证，按约定由用户测试。以下文字是视频制作阶段的来源和返工归档，其中“未接入/待选”仅描述当时状态。

四动作均已定稿并接入。攻击返工过程先生成v03，仍掀开前端；随后改为闭合前块整体推移并采用v04。此前死亡受拦截后，按用户要求改为无受伤表现的柔性材料收拢静置，并采用dying-v02。

直接查看[定稿预览与判退记录](preview.md)。当前保存4条正式源MP4；3个历史攻击视频已删除，提示词、供应方JSON和判退原因保留。原dying-v01被拦截，没有MP4。

## 当前动画输入与输出

同一[右向母图v03](../mother/pleat-devourer-mother-v03-animation-right.png)：1672×941、RGB，未缩放或抠图。由内置image_gen从v02重绘视角，对照僵尸犬v04和刽子手右向v06，身体沿左右展开、前端朝右、轻俯视。灰褐材质、米白布带、缝线和铁件身份延续。v03已随正式动画和运行时接入获准，v02及直接编辑祖先继续保留。

| 动作 | 当前源片 | 提示词 | 当前观察 |
|---|---|---|---|
| 待机 | [idle-v01](videos/idle-v01.mp4) | [idle-v01](prompts/idle-v01.txt) | 保持右向，缓慢鼓缩，待选自然循环 |
| 蠕行 | [crawling-v01](videos/crawling-v01.mp4) | [crawling-v01](prompts/crawling-v01.txt) | 前端张合较明显，需用户判断 |
| 攻击 | [attack-v04](videos/attack-v04.mp4) | [闭合前块推移v04](prompts/attack-v04-closed-front-slide.txt) | 联系图中前端闭合推压、未见前版明显张口/抬身；节奏仍偏慢，后部略收缩 |
| 收拢静置 | [dying-v02](videos/dying-v02-fold-settle.mp4) | [柔性材料收拢v02](prompts/dying-v02-fold-settle.txt) | 主体完整、方向稳定，收拢幅度偏轻；作为结束姿态候选 |

攻击首版因兽口/牙齿增生不采用；v02有张缝和后部抬起，v03约1.9秒仍掀开前端。三个旧版的MP4、提示词、来源JSON与联系图保留在previousCandidates对应路径。原死亡拒绝记录保留在dying.previousAttempts和logs/dying-v01-status.txt；平台曾提示“疑似侵权 / 违规内容，生成额度未扣除”，不代表项目已确认存在侵权或违规。

## 本轮生成与来源

统一使用tools/ai-gen/ai-asset.py video generate，后端为豆包Seedance 2.0 Mini，每条请求5秒、16:9。逐条先运行标准helper的fill-only，回读真实Tiptap提示词、模型和参数，再单次上传提交；fill-only本身不上传或消费额度。

本轮attack-v03和attack-v04均已下载，未使用付费确认。实际提交字符数、哈希、模型和生成时间保存在各MP4旁的同名JSON；提示词均为不可变版本，旧版没有覆盖。相应preflight和生成日志保存在logs/。本轮只连接现有9333自动化客户端，未擅自关闭该客户端。v04预填曾回报模型由页面管理，正式提交与来源JSON明确记录Seedance 2.0 Mini；原始日志如实保留。

| 修订提示词 | 回读字符数 | 来源JSON字符数 | 提示词SHA256 |
|---|---:|---:|---|
| dying-v02-fold-settle | 444 | 446 | 8793e7cb6ddfc3156dedb466097c0a3301ee92667c2e8b2c49f04983f11abd88 |
| attack-v02-closed-fold-press | 557 | 560 | c99e078f0a99cb5bbaf15aaa30eab6181932bed34237eb2c97f35f1ac17af498 |
| attack-v03-grounded-fold-press | 436 | 438 | 52791224ab1bd1138ab180548d763a16c2ce04dcbe21d2cc4a892468eeb2f346 |
| attack-v04-closed-front-slide | 455 | 458 | ce4ed5ea1d1ac358db7af3eb30cd438c4ab01214464b0a032c8e21c8e8558286 |

字符数按helper的编辑器归一化和源文件统计分别保留，不篡改实际来源数据；相应哈希与回读日志一致。

## 预览与后续制作边界

源片均为1280×720、24fps、121帧，视频轨约5.0417秒。任务内build-video-previews.py用ComfyUI虚拟环境Python产出全源帧GIF及24点联系图；GIF按累计时间戳量化约5.04秒，未裁段、调速或改写MP4。循环动作仅重复整段供观看，不代表自然循环已选定；攻击与收拢静置预览只播一次、保持末帧。源片灰底、投影和平台角标保留，未抠图或去除。

四动作透明图集已使用同一0.35源缩放与固定支撑点，保留自然局部形变；最终60/52/81/81帧，共58.22MiB，低于specialist的64MiB目标及128MiB准入线。攻击与收拢保持完整原片时钟，未标定世界尺寸、实际伤害接触、碰撞或游戏播放效果；具体布局、时长、关键帧映射及限制见sprite-production-v01/README.md。

本轮只制作和查看离线资产，没有运行测试、构建或游戏运行时验证，按约定由用户测试。空腔之卵、游戏代码和配置未改，攻击v04源片已认可，透明图集等待用户选择，不自动晋级正式assets。
