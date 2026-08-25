# 黑熊资产状态（2026-08-24）

- 身份母图：`mother/black-bear-mother-512.png`，右向侧视普通美洲黑熊。
- 接受视频：`black-bear-idle-v2.mp4`、`black-bear-walking.mp4`、`black-bear-attacking-v2.mp4`、`black-bear-dying.mp4`。
- 已清理废弃视频及过程截图：idle V1（转头与漂移）、attacking V1（鼻口/前掌源视频右侧裁切）；不得用于重建。
- 最终精灵表：`generated/final/{idle,walking,attacking,dying}.png`。
- 动态预览：`previews/final/{idle,walking,attacking,dying}.gif`。
- 质量清单：`sheet-manifest.json`；四套均无空帧、越格、半透明脏边或透明区 RGB 残留。
- 运行时副本：`assets/enemies/black_bear/`。
- 构建入口：`build-sheets.py`；攻击参考主体宽35%、中心约28%，逐动作首帧归一到262px有效身高。
