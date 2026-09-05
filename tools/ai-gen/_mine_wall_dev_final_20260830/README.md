# 矿洞 Dev 岩面统一：A/B/C已接入，木铁精修候选已生成

**当前状态（本轮“同意。同时……”后）**：新增C墙木撑/门叶传输已明确授权，四张Dev48候选已生成并完成固定Alpha与材质处理，分别见`supports/material-review.png`和`gate/material-review.png`；建议01，尚未选定安装。原木铁PNG保持不变。门动画已独立改成完整帧0升降加淡入淡出，最新GIF和代码记录在`../_mine_gate_fade_20260830/`；本目录旧`wall-gate-animation.gif`仅保留历史效果。

用户以“同意，然后继续”选定48步精修01号。本次将其矿物材质处理为固定步长的周期变化，共用到A/B/C岩面；保留B的原矿脉、C的原木撑和原木铁门。正式A/B/C PNG已更新，门PNG与此前v2逐字节相同，没有把未生成的门说成Dev成品。

## 已执行内容

- `render-mine-dev-component-masks.py`从现有v2 `.blend`导出矿脉/木撑/铁件分区：石体黑、木撑红、金属/矿脉绿。没有保存覆盖模型，也没有重新搭建几何。Blender使用`--background --factory-startup`；遍历对象时先取列表，避免修改可见性使活动迭代器失效。
- 岩面来源为`../_mine_wall_a_dev_refine_20260830/wall_a_refine_v01_candidate.png`。先分离原图低频色调/光照，再在固定`±64,+32`显示步长对应的纹理坐标中处理首尾过渡；不搬运原模型阴影的反相差值，避免出现假亮裂缝。
- 边缘保留共同材质，B/C只在内部混入25%的柔和材质变化。原矿脉/木铁构件由模型遮罩保护，原生遮挡与明暗关系随原图保留。这里是二维材质加工与原结构复用，不是新建3D模型，也不是B/C各自独立生图。
- A/B/C仍为1024²、原Alpha、原groundCenter、display260×259、wallH132；没有随机位移、缩放、旋转或水平翻转。
- 输出三款对照、双轴混排、共享转角、闭合房间、墙—原门—墙及900ms开合GIF。门仍为原640²×16帧、2560²精灵表、九根木条、六层裁片、端片退层与完全开启隐藏。
- 正式文件为`assets/terrain/abandoned_mine_wall_block_a.png`、`abandoned_mine_wall_block_b.png`、`abandoned_mine_wall_block_c.png`；门随套件登记但像素不变。安装前文件保存在`before_install/`，正式来源和SHA256记入manifest；v2旧安装入口已加继任保护。

## 新增远程授权记录（已解除）

上一轮准备C木撑和原门各两张Dev48低重绘请求时，`auto-review`在进程启动前拒绝：之前明确授权的素材传输范围是A墙，不包括这两组新增图片。当时没有上传或绕过拒绝。本轮用户对具体载荷明确回复“同意”，随后四张请求正常完成。

已获授权并实际使用的目标为`192.168.3.142:8188`。具体载荷只有：

- `supports/init_green.png`、`supports/depth_control.png`、`supports/prompt.txt`和对应生成参数；木撑在新岩面上的模型输入图与原C Depth。
- `gate/init_green.png`、`gate/depth_control.png`、`gate/prompt.txt`和对应生成参数；原九木条门的模型输入图与原门Depth。

上述图片已发送到该远程ComfyUI主机；不发送`.blend`、整个仓库、凭据或无关文件。每组48配置步、denoise0.30、Depth0.75、两张候选。详见`remote-refinement-status.json`；两个子目录保留request.json、提示词、绿底输入、raw、逐张生成记录与候选对照。木撑仅提取原模型木铁遮罩内材质；所有候选保留原Alpha和低频RGB，未改变已接入岩面。

## 文件与重建

- `stone-source.json`和`accepted-rock-periodic-ratios.npz`记录已选材质、显示周期与二维贴图加工。
- `component-mask-source.json`记录原模型、相机和附属对象。
- `geometry.json`保留原墙门参数；`gate_frames/`、`abandoned_mine_gate.png`沿用原门。
- `wall-gate-contact.png`、`wall-gate-seams.png`、`wall-gate-animation.gif`均为离线资产呈现，不是游戏截图。
- `material-summary.json`是生产材质统计：本次三款主体亮度中位数差约0.00337、均值差约0.00524，未改变运行时灯光。
- 使用项目ComfyUI Python运行`mine-dev-finish-kit.py stone/prepare/preview`生成本地资料，`install`才安装；`generate`需要新增载荷的明确远程传输授权。重建预览不等于重新安装，manifest保留lastInstallation。

## 限制

有限三款矿物纹样和模型岩层仍会重复，本次降低材质接缝与混排色差，不承诺彻底消除重复。历史门序列高帧仍受原640画布裁剪，但当前运行时已不再播放这些裁断帧，而是移动完整帧0并在顶部淡化；左上/右下门口的bindGateSourceCrop和tuckEndSlices修复没有改动。

未运行测试或运行时验证，按约定由用户测试。重点观察长墙、四角、左上/右下门口、开合与遮挡；离线预览不能当成这些实机行为已通过验收。
