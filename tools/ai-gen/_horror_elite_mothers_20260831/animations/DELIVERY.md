# 当前状态：两款精英均已接入，待用户实机验收

按用户要求先复查并修正刽子手的动画标准流程，再制作、接入蜡面哀祷者。两款均完成四动作、统一身体比例/固定根点、RIFE、GIF、标准预算和离线全帧检查。

- [刽子手正式交付](stitchface-headsman/SPRITE_DELIVERY.md)与[标准复查](stitchface-headsman/WORKFLOW_REVIEW.md)：238帧、49.40MiB；1500ms动作，f40约833ms单体落刀。
- [蜡面哀祷者正式交付](waxface-mourner/SPRITE_DELIVERY.md)：254帧、44.23MiB；f34在725ms释放固定蜡印，900ms后一次魔攻×1.4爆发，减速20%持续2秒。

未运行测试或运行时验证，按约定由用户测试；未构建、未同步EXE。以下为历史来源记录，“尚未制作/未接入/待标定”不代表当前结果；最新配置和预览以上面两个正式交付入口为准。

## 源视频阶段历史记录

下文保留当时的来源、失败候选和阶段边界；其中“尚未制作/未接入/待标定”只描述源视频交付时的状态，当前刽子手结果以上方正式交付为准。

# 恐怖地牢精英：攻击设计与豆包视频

母图已按用户“可用”确认。当前交付的是角色动作源视频和攻击设计，未做透明精灵表、RIFE或游戏接入。

攻击方式见 [设计说明](ATTACK-DESIGN.md) 和 [机器可读设计](attack-design.json)。缝面刽子手使用锁向单体蓄力斩骨；蜡面哀祷者使用释放后固定落点的封蜡诅咒。暂定数值均未写入游戏，最终刀刃距离、接触/释放帧仍须按获准素材和显示比例标定。

## 源视频

完成 8/8 段。GIF完整保留原片时间轴，约12fps展示；攻击与死亡的GIF循环只方便查看，不表示游戏动作循环。

旧登录状态的额度拒绝保留为历史；当前制作使用豆包现有登录状态，没有购买额度或更换管线。

按最新要求先完成刽子手四动作源视频与总览，再提交哀祷者剩余动作；已生成的哀祷者攻击保留。当前刽子手 4/4，哀祷者 4/4。

- 刽子手四动作原片总览（已回收历史文件：`stitchface-headsman/previews/four-actions-overview.gif`；见根目录cleanup-manifest.json）
- 哀祷者四动作原片总览（已回收历史文件：`waxface-mourner/previews/four-actions-overview.gif`；见根目录cleanup-manifest.json）

| 怪物 | 动作 | 视频 | 动图 | 实际源规格 |
|---|---|---|---|---|
| 缝面刽子手 | 待机 | [MP4](stitchface-headsman/videos/idle-doubao-v01.mp4) | GIF（已回收历史文件：`stitchface-headsman/previews/idle-doubao-v01-source.gif`；见根目录cleanup-manifest.json） | 1280×720，24fps，5.042s |
| 缝面刽子手 | 行走 | [MP4](stitchface-headsman/videos/walking-doubao-v06.mp4) | GIF（已回收历史文件：`stitchface-headsman/previews/walking-doubao-v06-source.gif`；见根目录cleanup-manifest.json） | 1280×720，24fps，5.042s |
| 缝面刽子手 | 攻击 | [MP4](stitchface-headsman/videos/attacking-doubao-v01.mp4) | GIF（已回收历史文件：`stitchface-headsman/previews/attacking-doubao-v01-source.gif`；见根目录cleanup-manifest.json） | 1280×720，24fps，5.042s |
| 缝面刽子手 | 死亡 | [MP4](stitchface-headsman/videos/dying-doubao-v01.mp4) | GIF（已回收历史文件：`stitchface-headsman/previews/dying-doubao-v01-source.gif`；见根目录cleanup-manifest.json） | 1280×720，24fps，5.042s |
| 蜡面哀祷者 | 待机 | [MP4](waxface-mourner/videos/idle-doubao-v01.mp4) | GIF（已回收历史文件：`waxface-mourner/previews/idle-doubao-v01-source.gif`；见根目录cleanup-manifest.json） | 1280×720，24fps，5.042s |
| 蜡面哀祷者 | 行走 | [MP4](waxface-mourner/videos/walking-doubao-v01.mp4) | GIF（已回收历史文件：`waxface-mourner/previews/walking-doubao-v01-source.gif`；见根目录cleanup-manifest.json） | 1280×720，24fps，5.042s |
| 蜡面哀祷者 | 攻击 | [MP4](waxface-mourner/videos/attacking-doubao-v01.mp4) | GIF（已回收历史文件：`waxface-mourner/previews/attacking-doubao-v01-source.gif`；见根目录cleanup-manifest.json） | 1280×720，24fps，5.042s |
| 蜡面哀祷者 | 死亡 | [MP4](waxface-mourner/videos/dying-doubao-v01.mp4) | GIF（已回收历史文件：`waxface-mourner/previews/dying-doubao-v01-source.gif`；见根目录cleanup-manifest.json） | 1280×720，24fps，5.042s |

## 来源和制作

- 通过项目统一入口 ai-asset.py video generate --provider doubao 调用已登录豆包客户端，每次只提交一条候选。刽子手早期行走存在朝向漂移，旧版和修订版均保留来源；当前选用版本以表格为准。请求模型Seedance 2.0 Mini；界面后端托管的任务不声称核实具体实际模型，当前新提交则显示Mini。逐段mp4.json保留真实modelSelection、参数与提示词来源。
- 两张获准母图未覆盖。初始动作参考由video-safe-reference.py等比补白至1280×720，主体约432px；记录在references/preparation.json。本次仅刽子手行走使用imagegen制作的稍朝右派生参考，保留原镜头俯角、造型和装备，其他动作继续使用原参考。新版v05/v06直接编辑祖先和方向参考均见references下的同名reference.json；v06补白后主体432px、脚线598。生成服务是否保持输入比例仍以原片为准，不能宣称各源动作已经同尺度。
- 原片、逐动作不可变提示词、来源记录、GIF、24点联系图均保留。源视频仍含平台水印和可能的灰底/阴影，不是透明运行时素材。
- 完整攻击源片约5秒，最终精灵动作目标约1500ms；当前没有裁切、加速或伪造接触帧，GIF也不是游戏速度。
- 源片观察记录见[source-review.json](source-review.json)。母图接受不等于视频自动接受；后续须处理记录中的画面差异，核对刀/手/碗/三烛和镜头、循环、脚点后才制作正式精灵图。
- 刽子手攻击原片有小幅迈步及落刀后的停留；第56帧（约2.333秒）首次形成完整低位刀姿，只是素材观察锚点，不是已设置的伤害帧。后续保留原动作轨迹，不另叠代码冲刺。
- 刽子手本次行走修订要求固定原镜头、人物略朝右、左右脚沿同一前后轴迈步，禁止转向观众；最终仍须截取完整步态并处理首尾衔接，源视频不等于已通过的无缝精灵循环。
- 行走v03、v04、v05均因朝向问题未采用；v04在与正式人形怪物对照后确认转向近正面的幅度过大，不再称为少量肩胯随动。v06的新方向参考和提交状态见[续抽记录](stitchface-headsman/WALKING-REROLL-v05.md)。此次只处理行走，其他三段动作与哀祷者源视频没有改动。
- 哀祷者约第47—52帧掌前出现少量灰烟，未达到纯身体无特效的目标；需后续清理或重出。约第42—48帧为释放姿势候选，尚未绑定游戏释放时机。

## 重建与续作

generate-doubao.ps1 -Index N 从task-index.json选择单条prepared任务，原编号不变。先完成刽子手的2（待机）、3（行走）、4（死亡），导出该角色四动作总览并刷新交付记录后，才允许继续哀祷者5—7。已有视频或已提交状态会拒绝重投；下载/连接异常须先定位原任务，不生成另一条冒充原结果。旧额度拒绝保留在doubao-quota-blocker.json；当前登录状态已变化，按新提交的实际页面结果判断额度。没有自动预约、购买额度或更换管线。

build-video-previews.py --video <MP4> 可重建源GIF/联系图；--overview <asset-id> 仅在该角色四段均齐全后使用。当前已有总览只按上方实际文件列出。

本轮没有修改src、data/public、正式assets或EXE。未运行测试或运行时验证，按约定由用户测试；视频制作与离线预览不代表游戏内验收。
