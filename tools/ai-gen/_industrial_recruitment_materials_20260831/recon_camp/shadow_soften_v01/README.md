# 侦察营地：减影版美术定稿

**已确认：** 用户回复“可以用”，本目录透明PNG设为当前近代侦察营地美术定稿。只更新选稿与来源记录，不再次生图、改色或抠图；尚未接入游戏。

用户反馈“阴影是否需要处理，比较明显”。以已交付的48步01罗盘修正版透明图为直接来源，使用内置imagegen减弱左侧石地台上的大块方向性暗影，以及塔下、补给棚下过黑的墙面和地面。保留石缝、柱脚、檐口的轻微接触阴影，以及门窗内部的合理暗部。

## 交付

- [透明PNG，1349×1118](recon_camp_industrial_shadow_softened_transparent.png)
- [前后完整对照](shadow_before_after.png) / [左地台与塔下局部对照](shadow_detail.png)
- [棋盘预览](transparent_preview.png) / [黑灰白底及Alpha预览](background_alpha_preview.png)
- [编辑来源记录](edit-record.json) / [抠图生产记录](production-record.json)
- [减影提示词](edit-prompt.txt) / [背景准备提示词](background-prompt.txt)

## 来源与处理

直接编辑源为 `../compass_fix_v01/cutout/recon_camp_industrial_cutout.png`，原始48步01、罗盘编辑原图及透明源均保留，不覆盖。

第一张减影结果 `recon_camp_industrial_shadow_softened.png` 虽请求真透明，实际为RGB并带有画入图像的棋盘。它只能作为编辑中间源，不能当作透明素材使用。第二次imagegen仅请求把棋盘背景换为绿幕，得到 `recon_camp_industrial_shadow_softened_raw_green.png`。两个原始生成文件、提示词和直接父级关系均记录在 `edit-record.json`。

从第二张1377×1142绿底图用现有建筑专用key工具重新抠图：四角12×12中位键色为RGB(7,233,13)，软距离50/140；随后仅清理Alpha边缘3像素范围的绿溢，并冻结Alpha紧裁。没有使用旧Depth或旧Alpha硬切新图，没有全画布HSV去绿，没有填平栏杆、塔架开口。最终RGBA Alpha范围0～255，全透明像素RGB为零；四处屋面、前部石材、暗窗、塔柱采样均未削减Alpha。

新图经生成式局部编辑，细部纹理与原版有差异，不宣称逐像素保持。透明成品保留第二张生成图的原生像素，仅紧裁；前后对照另做等比例展示归一。用户已确认此版可用，当前美术定稿路径由 `../selection.json` 的 `acceptedTransparent` 指向；游戏内尺寸、落点和占格尚未标定，美术确认不等于已接入运行时。

`produce.py` 只编排项目既有建筑抠图工具、输出记录与离线预览。未更改模型、科技、兵种、运行时贴图、阴影系统、碰撞、寻路或存档。未运行测试或运行时验证，按约定由用户测试；未构建或同步EXE。
