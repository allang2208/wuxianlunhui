# 近代骑兵学院 · 48步透明候选

已完成：选48步01，透明PNG为 `cutout/transparent.png`（887×590 RGBA）。仅为候选，未替换游戏资源。

来源链：原模型/Depth → 12步B01-01 → `../structure_local_correction_b01/` 内4次局部修正 → 974×974等比缩小并平移至1024画布 → 同一Depth、48步、denoise0.30 → 48步01 → 透明处理。模型和Depth没有修改。全部直接编辑祖先、实际提示词和画幅参数均保留。

首批3张关闭院门；第二批3张改变猫窝或器材。两批未直接晋级。局部修正恢复三座开放猫窝、三组障碍、两架共六支骑枪、五袋饲料、两箱物料、两组马具架和两处护理水槽。48步02的猫爪徽记变形，故选01。选稿由助手按连续制作委托进行，不伪记用户逐图认可。

抠图：本图key=(63,189,47)，soft45/75；旧Depth不参与Alpha；距边缘5px内去绿，并对后栏杆下方五处小范围石边残绿做RGB修复，Alpha不变。7处材质采样均保持不透明。不填闭合孔洞，不改碰撞或逻辑占格；原像素紧裁，仅留4px透明边。

预览：`cutout/preview.png`、`cutout/background_alpha_preview.png`、`cutout/open_structure_detail.png`。完整参数见`cutout/config.json`和`cutout/production-record.json`。

模型小道具的具体间距和石材表现与原模型存在绘制差异；此处保留功能组件和整体布局，尚未进行游戏内尺度标定。未运行测试或运行时验证，按约定由用户测试。
