# 跨位面中枢贴图减影

用户要求继续处理正式建筑贴图的阴影。内置imagegen先按`imagegen-edit-prompt.txt`生成照明减影参考；第一次输出把透明背景画成棋盘，第二次按`imagegen-green-background-prompt.txt`换为绿幕。该版本前部地台触底，第三次按`imagegen-safe-margin-prompt.txt`外扩构图。三张结果都改变了已确认的2:1地台投影，只用于判断亮度方向，没有进入正式源链；相关一次性生成稿和抠图中间层已经清理，保留三版提示词记录这次否决依据。

正式处理回到`interplane_research_hub_before_shadow.png`。`tone-shadow.py`冻结原Alpha与画布，只从18px低频照明估计抬升暗面，并对高饱和青色窗光减弱处理；脚本可重建轻度7%、中度10.5%和较强14%三档，归档只保留最终选择的14%版。最深门窗洞、檐底、石缝、设备脚座和楼层接触遮蔽保留，外部方向性太阳投影不烘入贴图。

正式文件为`interplane_research_hub_shadow_tone_strong.png`，已同步到`assets/terrain/interplane_research_hub.png`及`accepted/`。Alpha、888×914尺寸、4×4接地标定、517×510显示规格和主体太阳影根不变；同步重建128×64缩略图和本建筑四张光照派生图。未运行游戏、测试、构建或EXE验证。
