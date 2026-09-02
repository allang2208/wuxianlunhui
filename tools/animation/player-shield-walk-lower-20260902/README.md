# 持盾防御步行：恢复初版人体结构（2026-09-02）

本版以修改前的初版持盾姿态为基线，不再使用 `gun_idle_torso.png`、`gun_walk_legs_v2.png`，也不再把双臂拆成六个旋转关节。

- 头、胸、腰、胯、左右大腿、膝、小腿和脚全部来自同一帧原生 walking；
- walking 摆臂已从连续躯干中清除，不存在静态上身/动态骨盆的横向裁线；
- 主手使用 `assets/player/idle.png` 的初版整臂像素，只挂到逐帧 walking 肩点；
- 盾手继续使用初版 `PlayerShieldRig` 上臂/前臂骨链与掌点，根点同样跟随逐帧肩点；
- 大腿与骨盆没有重画，双臂也不会遮盖腰胯或重复出现。

正式文件：

- `source-original-walk-lower.png`：从初次修改阶段保留下来的已核对下身真源；
- `assets/player/shield_walk_body.png`：运行时21帧连续原生躯干图集，512×516、8×3、24FPS；
- `shield-walk-restored-hands-no-equipment.gif`：隐藏近战武器和盾牌，直接检查双手与胯腿；
- `shield-walk-small-round-perspective-standard.gif`：隐藏近战武器，以小圆盾 `weapon17` 展示正式中段握点和0.74水平透视基准；
- `shield-walk-oak-garrison-corrected.gif`：红盾防御水平握点修正后的21帧步行预览；
- `shield-standing-small-round-perspective-standard.png`：小圆盾站立举稳基准；
- `shield-standing-oak-garrison-corrected.png`：橡木卫戍盾防御水平握点修正特写；
- `shield-all-standing-guard.png`：7面盾牌按各自正式透视参数渲染的站立举稳总览；
- `shield-walk-small-round-perspective-contact.png`：0/5/10/15/20帧小圆盾基准双排联系图；
- `build-report.json`：帧网格、Alpha包围盒与来源记录。

用户澄清“太浅”是持盾手伸得过长，而不是盾面角度：格挡步行的盾面倾角恢复通用 `-0.14rad`；经三次小幅收拢，步行专属上臂最终由原始 `-12°` 收到 `+8°`，前臂由 `-110°` 屈到 `-132°`。骨段贴图不缩放，手掌与盾脐继续共用同一末端点，只通过肘部弯曲把整只持盾手进一步向身体、向上带回；待机、攻击和手枪持盾姿态不受影响。

全部7面盾牌新增独立 `defenseOriginY`，按各自正式手持图的有效Alpha上下边界取垂直中点；原 `originY` 保留给普通放盾、攻击和其他非防御状态。站立举盾新增与步行相同的 `+8°/-132°` 收拢臂姿，举盾与收盾期间使用既有 `lift` 在常态握点和中段握点之间平滑过渡，不发生贴图跳位。

水平握点同样拆为常态 `originX` 与防御 `defenseOriginX`。橡木卫戍盾的旧 `originX=0.279296875` 对应背带/左缘，只保留给非防御状态；四档静态图再结合21帧动态遮挡统计后，防御采用满足“掌部完全遮住、头肩零侵入”的最小值 `0.42`。其他六盾显式登记与各自常态相同的 `defenseOriginX`，因此本次不会改变其位置；左右镜像仍由运行时统一换算。

持盾透视另以小圆盾为正式基准：近正面手持图在举稳时使用 `defensePerspectiveScaleX=0.74`，与同一 `lift` 从1平滑插值到0.74；高度、掌点和人物身体不缩放。橡木卫戍盾 `weapon57` 与后四面 `weapon58`—`weapon61` 已使用真实斜视手持图，因此登记为1，避免再次压扁；其中后四面的正面 `equipImage` 保留给物品/改造展示，预览和Phaser手持层改读 `shieldVisual.guardImage`。

离线GIF与联系图改用固定宽画布完整容纳独立盾面，避免长盾右缘被516×516方形预览误裁；这只改变评审图的取景，不改变运行时图集、世界坐标或盾牌层。

`build.py` 还分别逐帧统计小圆盾、红盾与头肩核心像素的重叠，并统计红盾后仍可见的掌部像素；正式预览21帧两项最大值都必须为0。脚本只发布派生素材和离线预览，不运行游戏、测试、构建或浏览器探针。
