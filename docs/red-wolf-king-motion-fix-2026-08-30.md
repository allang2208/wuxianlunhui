# 红狼王双形态动画与碰撞修复

2026-08-30，仅针对 `RedWolfKing`。保留 `RedWolfKing extends BlackWolf`、黑狼禁用飞扑、红狼王启用飞扑的边界；不改独立的 `WerewolfKing`。

## 定位与处理

- 狼人攻击此前沿用狼形1.2秒节拍，手动动画每次推进只加一帧并清空时间余量，帧间余量丢失会拖慢动作。红狼王改为按攻击逻辑计时器选帧；普通循环保留余量并按实际经过时间推进。狼人攻击单独设为0.9秒，狼形仍为1.2秒，原伤害倍率/冷却/单目标规则不变，命中窗口仍在动作42%～75%，跨过窗口的一次更新也不会漏掉结算。
- 狼形飞扑和狼人攻击快速轮廓的RGB/Alpha插帧不同步，产生中间帧形变、重影。已有原视频包含可用姿态，无须重出视频。狼形飞扑从源帧0～72加密到25个关键帧，最终49帧；狼人攻击从源帧0～60加密到21个关键帧，最终41帧。两个动作的全部中间帧使用源片中真实、不同的中间姿态，不用重复关键帧停顿兜底。
- 收尾接触表发现狼人跑步、飞扑、变身及死亡也有同类插帧重影，狼人整套动作及狼形死亡的中间帧一并回取对应原视频姿态，关键帧保持不动。狼人飞扑仍保留已确认的第34/37源帧替换和完整自然飞扑轨迹。死亡少数中间帧因去背前的背景杂点影响裁框，去背后按相邻关键帧的脚线做刚性平移，修正浮空而不缩放身体。
- 狼形飞扑腿部收拢会影响旧脚部水平锚点，导致身体跳位并挤到画布边缘。改按原片整体运动保留轨迹，增加固定安全留白，裁切后以`footX/footY`记录脚点。没有把已确认的自然运动改成直线，也没有逐帧按外框缩放。
- 两个形态共13套图集统一按源像素比例展示：基础`151/512`世界单位/像素，狼人额外乘1.8。中立体高约狼262px、狼人290px；下蹲、腾空、倒地的外框自然变化不作为缩放依据。所有图集仅裁透明空白，保留完整像素分辨率，按不超过4096的纹理边长重新排布。
- 矩形帧同步更新Phaser切帧参数、显示比例、水平镜像锚点、脚线以及Canvas回退绘制，不再按正方形格子处理。BootScene直接读取同一份动画配置；图鉴待机裁切尺寸/列数同步。
- 用户要求变身后贴图与碰撞一起放大，正式配置由视觉1.8/碰撞1.25改为两项均1.8。沿变身进度同步`collisionRadius/Width/Height`、`collisionBodyHeight`和实际`Collider`，相对变身前捕获的基础值计算，不累计相乘。普通配置半径45→81，高度以实际基础Collider高度×1.8为准。技能射程、伤害盒、伤害倍率和尸体时长不乘大。

## 素材与来源

当前完整布局/来源/采样帧记录：[manifest.json](../tools/ai-gen/_red_wolf_king_motion_fix_20260830/manifest.json)。全部13套离线素材记录：[delivery-report.json](../tools/ai-gen/_red_wolf_king_motion_fix_20260830/delivery-report.json)。

关键预览：

- [狼形飞扑GIF](../tools/ai-gen/_red_wolf_king_motion_fix_20260830/previews/pounce.gif) / [原视频](../tools/ai-gen/_red_wolf_king_style_refresh_20260827/videos/red-wolf-pounce-h3-v01.mp4) / [正式图集](../assets/enemies/red_wolf_king/pounce.png)
- [狼人攻击GIF](../tools/ai-gen/_red_wolf_king_motion_fix_20260830/previews/werewolfAttack.gif) / [原视频](../tools/ai-gen/_red_wolf_king_werewolf_doubao_20260827/videos/werewolf-attack-h3-v02.mp4) / [正式图集](../assets/enemies/red_wolf_king/werewolf_attacking.png)
- [两形态同倍率首姿态对照](../tools/ai-gen/_red_wolf_king_motion_fix_20260830/previews/form-scale-overview.png)

其余所有动作GIF保存在同一`previews/`目录，以manifest的`previewGif`逐项定位。GIF按动作时长制作，单次动作为了查看会循环播放，不代表游戏中会自动循环。

13套图集均无空帧、触边或透明像素残留RGB，原始关键帧裁切后逐像素保留。快速动作采用原生中间帧，其他动作保留RIFE精确半步插帧；生成中间帧的黑色离群检查最高19个零散像素，未出现此前的大块黑色形变，明细如实保留。旧`reports/`是插帧阶段记录，不应拿其中被原生帧替换前的中间结果冒充最终素材。

整套基础RGBA解码量约544.70→201.85MiB（约降低62.9%），未降采样。新管线：[rebuild.py](../tools/ai-gen/_red_wolf_king_motion_fix_20260830/rebuild.py)、[install.py](../tools/ai-gen/_red_wolf_king_motion_fix_20260830/install.py)、[delivery.py](../tools/ai-gen/_red_wolf_king_motion_fix_20260830/delivery.py)。完整重建需要既有ComfyUI Python/BiRefNet/RIFE；`--reuse-dense-keys --reuse-interpolation`仅用于已有完整缓存后的裁框/预览重新导出。安装脚本只替换红狼王13套PNG及两份动画/怪物JSON中的红狼王条目。

## 涉及文件与验收边界

- `src/entities/enemy-types.js`：红狼王选帧、双形态攻击节拍、碰撞同步、矩形图集绘制。
- `src/phaser/scenes/BootScene.js`：13套图集改读配置。
- `data/animation-config.json`、`public/data/animation-config.json`：布局、脚点、飞扑分段和狼人攻击时长。
- `data/enemy-config.json`、`public/data/enemy-config.json`：图鉴待机布局及狼人嚎叫帧数。
- `assets/enemies/red_wolf_king/`：13套正式图集；制作目录、两个历史来源索引及第09分卷同步指向当前布局。

已查看本次真实差异、必要局部调用链及离线素材预览。**未运行测试或运行时验证，按约定由用户测试；未构建或同步固定EXE。**

用户重点验收：两种形态的待机/跑动/攻击/飞扑/嚎叫/死亡切换是否同尺度、左右镜像脚点是否稳定；连续近战是否仍有长时间停顿；半血变身全程及结束后碰撞是否同步增大，狭窄通道接触是否符合增大体积；伤害只结算一次、变身中死亡和狼人死亡仍正常结束。碰撞从旧1.25增至1.8会改变狭窄位置的可通行性，这是本次要求的实际几何变化。
