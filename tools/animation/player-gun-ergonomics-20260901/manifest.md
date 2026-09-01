# 玩家长枪 ADS 托枪手重排（2026-09-01）

## 当前结论：双臂腕口连续 v7（最终收口）

- 用户确认后握把与护木接触已经精准后，最后缺口定位为独立后手与主臂的腕口断层：v5为清除旧张掌手型，沿肩—主手方向一次裁去握把前27源像素；但实际前臂以斜线进入腕部，末帧因此在前臂末端与独立抓握手之间留下12源像素空隙。后握把、护木、枪械位置和两套已获准手型本轮均不再改动。
- `build-firing-hand-layer.mjs`现保留原27px旧掌指清除面，同时逐帧从真实前臂不透明末端向同一`aimFrames.hands`握把原点恢复一条7px收窄的源像素腕桥，并略过原点3px；旧张开掌指仍被清除，独立v5抓握手继续随枪身旋转。主臂腕桥与手掌共享同一不透明握把原点，因此向右上下瞄准、朝左镜像及枪身/主臂不同旋转角都不会再拉开。
- 新增`audit-firing-wrist-connection.mjs`：主握枪臂14/14帧均从握把原点连回原前臂连通分量，握把点距主臂最近不透明像素最大0.707源像素；步枪/机枪与散弹枪托举臂共28/28帧均从逐帧掌缘接触点连回肩点。复用当前42条枪械/方向变换覆盖14帧过渡共588组，失败为0；角度与过渡近景为`firing-wrist-angle-audit.png`和`firing-wrist-transition-audit.png`，机器报告为`firing-wrist-contact-audit.json`。
- 本轮重新生成正式`assets/player/gun_aim_arm_frames.png`及后手拆层预览，没有重新出图、没有改变两份配置或运行时代码，也没有制作换弹。仅完成确定性离线贴图与连通审计；未启动游戏、浏览器、构建或测试，未同步EXE，按约定由用户实机复测最终腕口遮挡和人物躯干接肩观感。

## 当前结论：托举掌缘真实接触 v6（覆盖下文旧托举结论）

- 用户实机复查确认后握把已经正确，但托举手在多种枪械/阶段仍会离开枪体。根因不是`supportGrip`缺失，而是旧运行时把骨架解算用的`supportHands`当作可见接触点：卷指中间帧该点会落在掌内负空间，散弹枪末帧该点也是透明像素；此外旧代码又按`_aimEase`把手从素材轨迹二次插值到护木，150ms抬枪/退枪过程必然出现阶段性悬空。
- `build-corrected-aim-arms.mjs`现在在两套14帧托举图集中逐帧搜索骨架端点下侧最近的不透明掌缘/指缘，写入通用`supportContacts`与散弹枪独立`supportContactVariants.shotgun`。28个接触帧的源Alpha均不低于96；完整ADS末帧步枪/机枪接触Alpha为255，散弹枪为144。
- `_syncGunArm()`保留`supportHands`作为解算骨架端点，但接触变换改用上述可见接触像素。原150ms抬枪/退枪仍保留“伸手去托枪”的动作；若从第0帧强行锁住护木，AKM托举层会被拉长到约2.26倍。完整ADS坐稳后则严格保持“掌缘—护木下缘”接触；枪械仍只以`grip`为主轴，未改变武器位置、枪口或弹道。
- 旧`right-grip-contact-closeups-*.png`只是把同一条AKM母版托举臂原样叠到所有枪上，没有复现逐枪运行时IK，现降级为历史记录。正式离线证据改为`runtime-support-contact-rifles.png`、`runtime-support-contact-shotguns.png`和`runtime-support-contact-machine_guns.png`；`runtime-support-contact-audit.json`按运行时同一肩点缩放/旋转公式复算11把步枪、12把散弹枪、11把机枪，34把接触误差均为0，武器接触点距不透明枪体最大0.329源像素，`pass=true`。
- 本轮没有重新生成手掌美术：问题属于接触锚点和过渡绑定，不是现有开放托举轮廓不足。没有启动游戏、浏览器、构建或测试，也未同步EXE；离线审计不能替代用户实机复测。

## 当前结论：向右后手包握 v5（覆盖下文旧后手结论）

- 用户复查指出旧版后手虽然数学上落在`grip`，轮廓仍像张掌/拳头贴枪，不能证明手指真正抓住后握把。当前正式方案把后手从主臂图集中完全拆出：`assets/player/gun_aim_arm_frames.png`只保留到腕部，`assets/player/gun_aim_firing_hand_frames.png`是14帧独立后手层；运行时先画主臂、再画枪、最后把后手前景层钉到已渲染`_gunGripWorld`。枪柄因此从虎口和回扣手指之间穿过，而不是漂在手掌上方。
- 向右人体工学按“拇食虎口坐高、拇指与中/无名/小指包住后握把、食指单独朝右贴扳机护圈”执行；左手仍为开放承托，分别读取34把长枪现有逐贴图`supportGrip`，落在护木、前托或泵动护木下缘。该口径参考美国陆军`FM 3-22.9`与美国海军陆战队`MCRP 3-01A`，但美术轮廓按本项目骨骼线稿和俯视侧视比例压缩。
- 后手资产使用Codex内置`image_gen`迭代生成。v3为对角腕试稿，v4仍可能读成开放C形，均已在归档收口时作为废案删除；正式源只保留`hand-poses-firing-grip-v5-raw.png`，提示明确要求横向入腕、三指回扣、仅食指前伸。`build-firing-hand-layer.mjs`确定性去除浅色底和荧光绿握把导引、保留最大连通骨骼轮廓，输出128×128×14图集，并从保留的`assets/player/gun_aim_frames.png`重建去手主臂，避免重复运行时自引用。
- `build-corrected-aim-arms.mjs`继续只负责主臂母版与两套托举臂，不再允许覆盖去手运行图；正式重建顺序为先运行该脚本，再运行`build-firing-hand-layer.mjs`，然后运行`build-support-grip-audit.ps1`与`build-runtime-support-contact-audit.mjs`。
- 后手形状仍可参考旧`right-grip-contact-closeups-*.png`；托举手逐枪接触必须以上文v6的`runtime-support-contact-*.png`为准。`corrected-support-grip-audit.json`仍要求34把后握把距不透明枪体不超过6源像素、托举点不超过2源像素。
- 下文“运行时截图复核”记录的是上一轮托举臂版本，不能作为本次v5后手资产的运行时验收。本轮没有启动游戏、浏览器、构建或测试，也未同步EXE；这里只完成实现和离线贴图/坐标复核，按项目约定由用户进行实机测试。

## 范围与基准

- 范围：11 把自动步枪、12 把散弹枪、11 把机枪；只修复瞄准模式下的双手人体工学和接触坐标。
- 正确基准：AKM 的原始屏显位置与最初获准的 `aimFrames.hands` 轨迹。武器变换仍以 `grip` 为唯一逻辑轴心；主握枪手实际追随叠加 `spriteOffset` / `aimSpriteOffset` 后的已渲染握把点，`supportGrip` 则只驱动独立托举臂的掌心目标，不能反向驱动枪的位置或旋转。
- 不制作换弹，不改变腰射、伤害、弹药、射速、后坐力、枪口或弹道。朝左与 360° 继续复用原局部坐标、逐帧镜像和 `flipY` 路径。

## 动画开工方向记录

- 动作参考：`gun_aim_frames-original.png` 的0-based第0、6、13帧；配置参考：`public/data/player-anim-config.json` 的 `gun_idle.twist.aimFrames`，武器参考：AKM正式侧视装备图与`public/data/weapon-anim-config.json`的`akm`。
- 身份/身体层不重绘：相机俯视感、头胸胯、脚尖、腿部步轴和人物根点全部继承已认可的`gun_idle`躯干/腿层；本文件只重排独立手臂条，因此不存在新的人物朝向候选。
- 动作局部轴为源画布向右（+X）：主手保持原14帧轨迹，托枪掌心从腰侧抬到枪管/护木下缘。源画布肩点为局部根，运行时再围绕同一肩点旋转并生成朝左镜像；素材本身不伪造14套方向帧。
- 离线核对结论：第0帧保持腰侧自然张手，第6至9帧完成翻腕/收指，第13帧闭合AKM双手接触；原检测在第7至9帧的分量跳变不得作为动作真源，已改用连续首末端点轨迹。该结论只覆盖素材方向和几何，不等同实机验收。

## 已否决的上一方案

- 上一版曾把约 `(204.6,99.2)` 的肩/根部区域误判为后手，并在 ADS 中把武器轴心由 `grip` 插值到 `supportGrip`；对应的`support-grip-geometry.json`、`support-grips-*.png`与`aim-composite-*.png`错误产物已从正式归档删除。
- 该方案会让枪身整体偏移一个错误的双手间距，且破坏原来已认可的主手—枪轴心。这里只保留结论供复盘：武器始终围绕后握把，托举点不得反向驱动枪体。

## 正式动作资产

- 原始图：`gun_aim_frames-original.png`；正式运行时拆为主握枪臂 `assets/player/gun_aim_frames.png`、步枪/机枪托举臂 `assets/player/gun_aim_support_frames.png` 与散弹枪托举臂 `assets/player/gun_aim_support_frames_shotgun.png`，均为 14×(512×516)；`corrected-aim-combined-frames*.png` 仅用于离线合成预览。
- `analyze-aim-arm-components.mjs` 将每帧主握枪手与另一只手分量分离，并输出 `aim-arm-components.json/png` 及 Alpha 可视化。
- `build-corrected-aim-arms.mjs` 保留主握枪手全部原像素；从原第0帧提取另一只手的上臂和前臂，以肩—肘97.94px、肘—掌心118.96px为基础做两段式IK重排。掌心端点读取已获准静态手臂配置的`(240,221)`，避免把指尖误当握持中心；肩点连续插值，掌心以35%跟随主手漂移并在线性14帧路径上前伸。为达到AKM真实护木点，两段机械骨在不改变线稿粗细的前提下逐帧纵向延展，末帧为1.20倍并保留轻微弯肘，避免最后一帧突然锁肘。
- 托枪手掌使用Codex内置`image_gen`按原骨骼线稿风格重做两套5关键姿势：步枪/机枪为张手→翻腕→V形承托→四指上包→拇指沿护木前伸，散弹枪为掌心更低、包覆更粗泵把的版本。正式生成源为`hand-poses-rifle-lmg-v2-raw.png`与`hand-poses-shotgun-v2-raw.png`；脚本从外边界清除浅色预览底并保留黑色轮廓内的掌骨白区，透明源为对应`*-clean.png`。旧张开手掌的1187个源像素被替换，腕部到掌心仍为31px；末帧保留护木穿过虎口的负空间，不再画成紧凑拳头或双手手枪式抓握。
- 生图采用内置编辑模式。步枪/机枪输入参考为旧5姿势原图与`palm-review/support-frame13-4x.png`，提示重点为“掌心在护木下、四指向上包覆、拇指沿护木向前、不得握拳”；散弹枪再参考新步枪手型与旧泵把手型，提示重点为“从下方包住更粗的水平泵把”。没有生成枪械、人物身份或整臂替代图。
- `corrected-aim-arm-geometry.json`保留14帧连续抬臂与翻腕轨迹，逐帧`reachError`均为0；完全瞄准后不再强迫所有武器复用AKM的一条固定双手向量，而是由运行时把托举掌心解到当前贴图上逐枪测量的真实护木/泵把接触点。
- 连续性记录：最大相邻肩点位移1.1525源像素、肘点19.566源像素、掌心24.133源像素；末帧肘点为`(315.18,153.13)`，没有回到近直臂位置。相较原检测驱动的约12.45px肩根突跳，肩根已连续化；自然离散帧仍按原14帧节奏保留。
- `corrected-aim-arm-poses.png`与`corrected-aim-arm-poses-shotgun.png`是两套正式14帧离线动作预览。运行时不再把两只手烘焙在同一刚性旋转层：后手围绕主握把保持原轨迹，托举肩随躯干扭转，托举掌缘按武器 Sprite 的实际 origin、缩放、旋转和左右镜像独立解到逐枪护木点。v6仍由`_aimEase`保留抬臂、翻腕和接近护木的自然过渡，完整ADS则以真实掌缘像素锁定；`supportVariants.shotgun`同时切换手掌图集和独立接触序列。

## 逐枪接触与运行时契约

- `apply-corrected-gun-support-config.mjs` 同步双份武器配置。34把枪的 `supportGrip` 已改为逐贴图像素测量，全部落在真实不透明护木、前托或泵把上，不再使用固定屏显距离推导的空画布点；S686、虚空葬潮、RPD、Ultimax 100与墓契唱诗班机枪的主握把也一并从透明区校回枪身。静态Alpha接触审计中，主握把距最近枪体像素最大为2.725源像素，托举点最大为0.329源像素。
- `corrected-support-grip-geometry.json`与`corrected-support-grip-audit.json`覆盖34把枪；AKM是离线手臂母版，其余武器由运行时围绕同一肩点缩放/旋转托举层到各自目标。散弹枪继续使用逐贴图`textureSupportGrips`，不再假设34把枪具有同一双手间距。
- Alpha尺寸复查发现PKM的`idleScale:1.25`与QJB-201的`0.9375`是归一化贴图上的二次缩放；两者顶层/idle/walk现统一为AKM基准1.0，并按新尺度重新计算`supportGrip`。34把正式贴图的有效枪身宽为114.188至115.664世界像素，AKM为115.172。
- `WeaponTransform.getTextureGrip()` 始终是武器唯一变换轴心；`getTextureSupportGrip()`只允许驱动托举臂和接触审计。`_gunGripWorld`必须在`aimSpriteOffset`与`spriteOffset`已经叠加后、贴图中心补偿前记录，使主握枪手追随玩家真正看到的握把，而不是偏移前的理论位置。

## 运行时截图复核

- 通过项目安全入口 `tools/cdp-run.ps1` 启动独立临时 Edge，真实按住右键并等待 `_aimEase=1` 后截图；逐枪覆盖11把自动步枪、12把散弹枪、11把机枪的朝右水平 ADS，另覆盖AKM右上/右下/左上/左平/左下与M416、Super90、PKM左平，共42张。
- 步枪/机枪截图显示独立 `player_gun_idle_aimsupport`，散弹枪显示独立`player_gun_idle_aimsupport_shotgun`（朝左均为 `_flip`）第13帧；记录的主握枪手与已渲染握把最大世界误差为`1.016845989170083e-12px`，托举掌心与武器护木目标最大世界误差为`9.094947017729282e-13px`，均属于浮点舍入量级，未发现缺层、空白镜像帧或再次异常放大的枪图。
- 全量联系图、角度抽样、四类近景图、8张4倍掌心接触近景和机器可读结果位于 `tools/verify-shots/gun-ads-runtime-20260901/`。原尺寸与4倍近景复看确认AKM、M416、Super90、QJB-201、PKM及AKM上下/左右抽样中，枪身不再悬在主手上方，闭合手指从护木/泵把下方包覆且腕部连续。补测中，枪械专项静态审计、动画状态断言、目标文件ESLint（0错误、8个既有警告）、Vite生产构建与42张安全CDP运行时截图均通过；项目级配置完整性测试仍被其他并行内容的57个既有错误阻断，未同步EXE。
- `audit-support-hand-delivery.mjs`汇总双份配置、三张14帧图集、分类图集选择、左右镜像与42张运行时元数据，结果写入`support-hand-delivery-audit.json`：配置一致、0空帧、13张散弹枪样本全部使用shotgun变体、6张左向样本全部使用逐帧镜像、失败项为空，最终`pass=true`。
