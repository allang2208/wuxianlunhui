# 毒蛆四动作定稿（2026-08-28）

## 定稿范围

- 模型：Doubao Seedance 2.0 Mini。
- 动作：待机、移动、喷毒、死亡。
- 抠图：BiRefNet-general 蓝底流程。
- 插帧：RIFE v4.6 RGBA 2x；循环动作回绕，一次性动作不回绕。
- 运行时：`assets/enemies/poison_maggot/`，配置见两份 `enemy-config.json`。

## 归档内容

- `poison-maggot-mother-v01.png` 与 `poison-maggot-video-ref-blue.png`：定稿母图和安全视频参考。
- `prompts/`、`videos/*_doubao_bg.txt`：需求提示与实际提交提示快照。
- `videos/*.mp4`、`videos/*.mp4.json`：四个唯一入选视频及 provenance。
- `generated/raw/`：插帧前透明源表；`generated/final/`：RIFE 正式表。
- `reports/rife/`：插帧与关键帧保真报告。
- `previews/final/*.gif`：最终目标帧率验收预览。
- `previews/final/poison-maggot-muzzle-static-audit.png`：喷毒释放窗口的左右镜像口器锚点审查。
- 根目录脚本和 manifest：母图准备、精灵表重建、插帧和锚点审查的可复现链。

## 已清理内容

失败棋盘格母图、BiRefNet 临时蒙版、母图中间预览、原视频接触表/预览 GIF、插帧前预览 GIF、最终联系图和口部局部截图均为废案或可重建派生物，不进入 Git。
