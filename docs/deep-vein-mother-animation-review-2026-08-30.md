# 深脉之母动画检查（2026-08-30）

> 后续用户已授权优化，下面保留的是修复前检查记录。当前实现、七套新版GIF、素材选择与剩余限制见 [优化交付说明](../tools/ai-gen/_deep_vein_mother_20260830/animations/INTEGRATION.md)；原现状GIF保留，不冒充修复后结果。

按当前矿洞怪物配置顺序，封井岩魇之后检查 `deepVeinMother`（深脉之母）。实际为**7套角色动画＋1张独立碎矿弹体图**，共299个动画帧。本轮只检查、导出现状证据和记录问题，未修改游戏代码、配置、正式PNG、源视频或原始制作清单。

## 结论

7套动作均查看了整套帧联系图、布局、脚点、播放方式与相关状态代码，另外查看了碎矿弹体图。未发现封井岩魇旧移动源那种整段横向拉伸；当前七套使用同一主体尺度、对称横向裁框，循环和一次性动作的帧数/末帧设置基本一致。

发现以下需要修复的问题。代码结论来自静态调用链，画面结论来自离线帧；没有进行游戏实测。

### 1. 高优先级：死亡流程会被通用3秒清理截断

本类倒地3400ms、停尸1800ms、淡出400ms，共5600ms，但 `onDeath` 没有覆盖 `_deathRemoveDelay`。基类默认写3000ms，`Game` 随后按墙钟删除死亡实体。因此在正常1倍时间下，尚未完成倒地就会离开实体集合，末段、停尸与淡出无法按本类的设计完整推进；暂停/变速时还存在游戏时钟与墙钟不同步的问题。

证据：[本类死亡入口与时钟](../src/entities/enemy-types/deep-vein-mother.js:349)、[基类默认删除延迟](../src/entities/damageable-entity.js:463)、[实体删除条件](../src/game.js:1617)。

建议沿用封井岩魇已经采用的边界：尸体生命周期由游戏dt完整推进，完成淡出后再允许通用清理，而不是仅延长一个固定墙钟数字。

### 2. 高优先级：石化时丢失当前姿态，石化中死亡仍可能卡帧

`_onCombatActionInterruptedByControl()` 和 `updateWhilePetrified()` 都直接执行 `_finishAction(false)`；该函数会清掉动作快照并切 `idle`。当前类没有保存受击帧/纹理/朝向，也没有石化脚点补偿钩子，无法保持“停在受击当刻姿态”的合同。

死亡入口没有清除 `petrified`，死亡分支不再推进正常状态计时；渲染同步遇到仍存在的石化状态会提前返回。纹理创建/切换路径可能先切到待机或死亡首帧，随后不再更新，造成跳姿态或死亡卡帧。具体画面尚未运行验证。

证据：[控制中断](../src/entities/enemy-types/deep-vein-mother.js:58)、[结束动作强制待机](../src/entities/enemy-types/deep-vein-mother.js:309)、[石化渲染返回](../src/phaser/scenes/GameScene.js:13374)、[状态查询不以active过滤](../src/entities/damageable-entity.js:556)。

建议分开“取消未释放技能事件”和“修改视觉姿态”：石化保存定格姿态；解除石化后恢复正常状态，死亡时明确解除渲染定格。

### 3. 中优先级：多套动作第20帧附近出现红绿噪色，部分插帧形体变软

现有联系图中，移动、重踏、喷矿、震脉、泄压、死亡在第20帧附近有突出的红绿细噪色。已从正式移动/重踏PNG抽出16—22帧相关局部，确认不是仅有旧联系图的显示问题。移动第17帧前腿也明显比相邻原生关键帧更糊。

重踏最终第20帧对应未插帧第10帧（源视频第60帧）。**未插帧输入中已经存在噪色，因此不能把它全部归为RIFE插帧错误，也不能只替换奇数帧。** 源视频第60帧已另存供后续沿“解码→抠图→缩放→插帧”定位；本轮没有重做或修改任何像素。

- [移动16—20帧原尺寸放大证据](reviews/deep-vein-mother-20260830/walking-suspect-frames.png)
- [重踏18—22帧证据](reviews/deep-vein-mother-20260830/stomp-suspect-frames.png)
- [重踏未插帧第10帧](reviews/deep-vein-mother-20260830/stomp-original-key10.png)
- [重踏源视频第60帧](reviews/deep-vein-mother-20260830/stomp-native-source-frame60.png)

这些噪色不等同于正常紫晶光效。修复应保留已接受的原生动作，不对整只怪物全局去紫/去绿，也不直接大量复制前一帧掩盖问题。

### 4. 中优先级：恐惧逃跑被锁成待机画面

本类把恐惧与眩晕/冻结等一起归入 `_controlled()`，控制分支固定切 `idle` 并返回。公共移动系统会让被恐惧的怪物逃离恐惧源，因而出现位置移动、身体仍是待机帧的代码路径。

证据：[本类控制分支](../src/entities/enemy-types/deep-vein-mother.js:82)、[恐惧逃跑移动](../src/systems/movement-system.js:259)。建议保留攻击中断，但在恐惧仍有位移时推进walking与朝向。

### 5. 中优先级：制作清单/旧GIF与当前攻击时序脱节，重导会回退调参

当前双份运行配置：重踏1550ms、接触约907ms、冷却3000ms；震脉2300ms、第20帧约1122ms。旧制作manifest及原预览仍是重踏2400ms、震脉3200ms。

`build-runtime-sprites.py` 的PLAN保留旧时长；`install-runtime.py` 从旧manifest重建本怪物完整配置，并硬编码重踏冷却4200ms。按现有“all→install”入口重导，可能覆盖本次并行任务的新节奏，而不只是更新图集布局。原GIF还以260像素主体预览，游戏实际是300像素，不能用于准确评估当前大小和清晰度。

证据：[旧制作时长](../tools/ai-gen/_deep_vein_mother_20260830/animations/build-runtime-sprites.py:25)、[安装器旧冷却](../tools/ai-gen/_deep_vein_mother_20260830/animations/install-runtime.py:36)、[整块替换配置](../tools/ai-gen/_deep_vein_mother_20260830/animations/install-runtime.py:79)、[旧预览260主体](../tools/ai-gen/_deep_vein_mother_20260830/animations/build-runtime-sprites.py:193)。

本轮另存了当前配置速度、300像素主体的现状GIF，未改写旧制作记录。建议后续让素材导入只负责布局与帧元数据，保留当前玩法参数，并同步正式清单和交付预览。

### 6. 清晰度限制：224像素主体放大到300像素

七套素材都以224px有效主体入库，游戏显示为300px，即约1.339倍放大。这是角色偏软、细碎矿石与升降架不够清晰的一个明确因素。它不是X/Y不等比拉伸。

制作记录给出的整族RGBA基础量为122.67MiB、最长边2800px，包含独立碎矿弹体；这一数值不是显存实测。本轮没有执行预算检查器。后续若要提高分辨率，应从保留的源视频/原生关键帧重做采样，并在boss档256MiB准入上限内重新安排预算，不能靠放大当前PNG恢复细节。保持世界内300主体及224×255碰撞不变。

## 逐动作覆盖与当前速度预览

下表GIF本轮从正式PNG生成，按当前配置duration选帧，主体显示300像素。它们是**未修复现状**，只展示贴图和时钟；没有模拟技能伤害、弹道、预警、受控、碰撞、离屏或死亡停尸/淡出。GIF循环便于观察，游戏中的攻击/泄压/死亡仍为一次性动作。

| 动作 | 帧数 | 当前时长 | 旧制作清单 | 现状GIF | 源与正式表 |
|---|---:|---:|---:|---|---|
| 待机 | 30 | 5000ms | 5000ms | [现状GIF](reviews/deep-vein-mother-20260830/idle-current.gif) | [源视频](../tools/ai-gen/_deep_vein_mother_20260830/animations/videos/idle-doubao-v01.mp4) / [正式PNG](../assets/enemies/deep_vein_mother/idle.png) |
| 行走 | 48 | 4000ms | 4000ms | [现状GIF](reviews/deep-vein-mother-20260830/walking-current.gif) | [源视频](../tools/ai-gen/_deep_vein_mother_20260830/animations/videos/walking-doubao-v01.mp4) / [正式PNG](../assets/enemies/deep_vein_mother/walking.png) |
| 矿足重踏 | 41 | 1550ms | 2400ms | [现状GIF](reviews/deep-vein-mother-20260830/stomp-current.gif) | [源视频](../tools/ai-gen/_deep_vein_mother_20260830/animations/videos/stomp-doubao-v02-single-foot.mp4) / [正式PNG](../assets/enemies/deep_vein_mother/stomp.png) |
| 高压喷矿 | 41 | 3000ms | 3000ms | [现状GIF](reviews/deep-vein-mother-20260830/pipe_blast-current.gif) | [源视频](../tools/ai-gen/_deep_vein_mother_20260830/animations/videos/pipe_blast-doubao-v02-three-recoils.mp4) / [正式PNG](../assets/enemies/deep_vein_mother/pipe_blast.png) |
| 绞盘震脉 | 41 | 2300ms | 3200ms | [现状GIF](reviews/deep-vein-mother-20260830/vein_resonance-current.gif) | [源视频](../tools/ai-gen/_deep_vein_mother_20260830/animations/videos/vein_resonance-doubao-v01.mp4) / [正式PNG](../assets/enemies/deep_vein_mother/vein_resonance.png) |
| 矿压泄尽 | 49 | 6000ms | 6000ms | [现状GIF](reviews/deep-vein-mother-20260830/pressure_release-current.gif) | [源视频](../tools/ai-gen/_deep_vein_mother_20260830/animations/videos/pressure_release-doubao-v01.mp4) / [正式PNG](../assets/enemies/deep_vein_mother/pressure_release.png) |
| 死亡 | 49 | 3400ms | 3400ms | [现状GIF](reviews/deep-vein-mother-20260830/dying-current.gif) | [源视频](../tools/ai-gen/_deep_vein_mother_20260830/animations/videos/dying-doubao-v01.mp4) / [正式PNG](../assets/enemies/deep_vein_mother/dying.png) |

- 待机：30帧循环，主体与附件整体稳定，未见明显横向拉伸或空帧；轻微体量变化属于已接受源片特征。
- 行走：48帧循环，四足运动存在；重点为异常噪色、中间帧前腿发软，以及恐惧状态不播放walking。
- 重踏：41帧，单前腿抬落合同保留，接触第24帧；素材噪色和旧时长记录需处理。
- 喷矿：41帧，一次性，代码第10/18/26帧逐次发射；源片后坐较弱已被接受，不应擅自重生成。已发射弹体在硬控时继续，死亡时统一清理，未见独立蓝色光效。
- 震脉：41帧，一次性，第20帧释放；紫晶发光是源片内容，绞盘动作偏弱属已接受差异，重点是噪色和时序来源脱节。
- 泄压：49帧、6000ms，第8至33帧前暴露核心，约3061ms；代码每三次实际释放后进入，完整结束清零，被打断保留待泄压。石化定格问题适用于此动作。
- 死亡：49帧、3400ms，末段保持倒地，无起身循环；尾部尘土/碎屑及边缘风险是此前已经接受的源片差异，本轮未擅自去除。重点修复3秒清理截断与石化死亡。
- 碎矿：独立静态小图，由代码旋转/飞行，使用本怪物自己的纹理键，不是第八套角色动画。已查看原图及发射/销毁接线；出膛位置和飞行观感未实测。

## 本轮交付边界

新增本报告及 `docs/reviews/deep-vein-mother-20260830/` 下现状GIF、问题帧证据与预览索引。**未修改或修复运行时代码/配置/素材；未运行测试或运行时验证，按约定由用户测试；未构建、启动游戏或同步EXE。**

优先顺序：死亡/石化生命周期→动作噪色与插帧→恐惧步态→制作与运行配置同步→清晰度预算。后续修复应沿用已认可的七段源视频，保留原生轨迹及用户已经接受的动作幅度差异。
