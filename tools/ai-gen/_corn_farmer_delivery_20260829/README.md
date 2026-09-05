# 玉米农夫配送动画溯源

> 发布边界（2026-09-05）：本目录本次仅作为制作源归档发布。两张正式运行时表及其玉米农场任务状态消费者未包含在本归档批次中，后续应基于最新 `origin/main` 与玉米农场系统一起完整合入；下述运行时状态记录的是共享工作区制作完成时的目标状态。

## 目标与参考

- 身份母图：`references/farmer-master.png`，来自现有仓鼠农夫 `idle.png` 的首格。
- 工作状态：`references/farmer-working.png`，来自现有 `harvesting.png` 的代表帧，仅用于核对服装与职业特征。
- 动作参考：`references/farmer-running-motion.mp4`；小主体版本用于抱玉米二次生成，确保全身和双脚不被裁切。
- 生成服务：本地 RTX 5080 上的 MiniMax H3 Ref2VA；用户已同意把上述参考发送到该服务。

## 候选记录

- `videos/empty-running.mp4`：采用。空手、向右原地奔跑，取源帧 `[16, 46)`、步长 2。
- `videos/corn-loaded-running.mp4`：拒绝。第一版腿部被裁切，仅保留作失败记录，不进入运行时。
- `videos/corn-loaded-running-v02.mp4`：采用。全身抱四穗玉米向右原地奔跑，取源帧 `[32, 62)`、步长 2。

每个视频旁的 `.json` 保存 MiniMax 模型、seed、提示词、输入文件哈希和输出哈希。`cycle-windows.json` 保存正式循环窗口。

## 后处理与正式规格

1. BiRefNet-general 逐帧抠图并去除 H3 生成的背景。
2. 仅清理模型误生的细长鼠尾，保留仓鼠短尾和原始离散跑步轨迹。
3. 两个动作分别按循环窗口的可见主体中位高度定标到 `398px`，统一为 `512x512` 单格、脚线 `y=420`；携带的玉米不再导致空手动作被错误缩小。
4. 15 个 12fps 关键帧经 RIFE v4.6 循环补帧为 30 帧 24fps；偶数帧保留原关键帧像素。

| 状态 | 正式资源 | 规格 | SHA-256 |
| --- | --- | --- | --- |
| 抱玉米奔跑 | `assets/companions/hamster_farmer/corn_loaded_running.png` | 8列×4行，30帧，24fps | `F95EBE5D98539410017ED08F623E61E1FEF04C98002CA67F0C384B5F7EAFA68C` |
| 空手奔跑 | `assets/companions/hamster_farmer/empty_running.png` | 8列×4行，30帧，24fps | `AC8CD930E53F19FED0D51609CD071DF248302D1A994E02CFFA049A014945A9FE` |

正式 GIF 和接触表在 `previews/final/`；RIFE 参数与无空帧、无贴边帧、脚线范围等报告在 `video-sheets/final/*-report.json`。

## 运行时状态

- `processing`：不显示农夫。
- `to_deposit`：显示抱玉米奔跑。
- `waiting_deposit`：抱玉米停在仓库等待，冻结到配置帧。
- `to_farm`：切换为空手奔跑；回到农场进入下一轮 `processing` 时立即隐藏。

本任务只投影现有玉米农场任务状态，不修改结算、产量、仓库存入、寻路或存档逻辑。
