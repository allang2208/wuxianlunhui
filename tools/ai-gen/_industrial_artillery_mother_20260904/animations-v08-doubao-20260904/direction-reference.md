# 仓鼠近代炮兵组 v08 豆包动画方向记录

## 身份与母图

- 身份源：`../mother/industrial-artillery-crew-mother-v08-engineering-camera.png`。
- 用户在查看v08后明确要求“豆包管线生成”，本批据此选择v08作为动画身份源；四段源片随后由用户以“可用，按照动画标准工作量继续”确认进入标准后处理，但这不等于正式图集获准入库。
- v08保持两名同等成年体型的苏式仓鼠、一门二战57毫米长管反坦克炮、两轮、双分列式驻锄和一枚手持备用弹。

## 相机与动作轴真源

- 野战炮实际移动动作：`../../_hamster_field_cannon_animations_20260830/source-sheets/run-keys.png`，配置`run-keys.json`，核对0-based源帧0、40、80。
- 榴弹炮实际移动动作：`../../_hamster_howitzer_animations_20260830/source-sheets/run-keys.png`，配置`run-keys.json`，核对0-based源帧0、40、80。
- 野战炮实际攻击动作：`../../_hamster_field_cannon_animations_20260830/source-sheets/attack-keys.png`，配置`attack-keys.json`，核对0-based源帧0、56、120。
- 榴弹炮实际攻击动作：`../../_hamster_howitzer_animations_20260830/source-sheets/attack-keys.png`，配置`attack-keys.json`，核对0-based源帧0、56、120。
- 野战炮实际死亡动作：`../../_hamster_field_cannon_animations_20260830/source-sheets/die-keys.png`，配置`die-keys.json`，核对0-based源帧0、40、80。
- 榴弹炮实际死亡动作：`../../_hamster_howitzer_animations_20260830/source-sheets/die-keys.png`，配置`die-keys.json`，核对0-based源帧0、40、80。
- 母图构图同时对照`../../_hamster_engineering_mothers_20260830/mother/`下获准的投石组v07、野战炮组v07和榴弹炮组v06。

共同基准是略俯视、近侧三分之四、整体向屏幕右侧的浅纵深工程器械镜头：近轮侧面占主导，远轮紧贴其后；两名炮手保持相近体量与脚线；鼻尖、胸腔、骨盆、膝盖和脚尖朝右。移动主轴为屏幕水平右向，但视频内根点固定，使用原地跑步机式推行；炮车不横向漂移，镜头不跟随。

## 本批门禁

- 参考图只做等比缩放和白底排版，不重画、不旋转、不拉伸。
- 待机/移动首尾要求自然同相；攻击为一次开火后恢复，死亡为单向倒地并停留。
- 每段先执行`--fill-only`并回读提示词；哈希/字符数不一致不提交。
- 源片必须先检查24点联系图和GIF。任何人物转正/转背、炮架透视漂移、双驻锄合并、轮数变化、炮管弯折或主体漂移均直接判退，不进入抠图和RIFE。

源片复核结论：待机v02、跑动v01、攻击v01和死亡v01均已生成并检查整段GIF与24点联系图。四段保持v08的右向浅纵深相机和工程器械拓扑；跑动保持右向固定根点推行，攻击仅单次开火并恢复，死亡两人分离倒地、炮弹脱手且炮车留存。用户已认可四段源片。

后处理方向记录：待机有效区间为源[19,119)，跑动为源[70,118)；循环首尾相位测量记录在`source-analysis.json`及`previews/*-loop-seam-review.png`。四动作使用同一0.26缩放和原画布(640,571)地面锚点，不对单帧重心、Alpha底边或人物位置做独立修正。透明关键帧与RIFE成品的头、胸、胯、膝、脚尖和器械轴仍朝右；攻击/死亡只保留源动作本身的后坐和倒伏位移。该结论是离线素材核对，不替代游戏运行时验收。
