# 黑袍德鲁伊资产状态（2026-08-24）

## 身份与视角

- 正式身份母图：`mother/black-druid-imagegen-angle-v2-white.png`。
- 正式透明母图：`mother/black-druid-mother-angle-v2.png`。
- 通用视频参考：`video/black-druid-reference-angle-v2-white.png`。
- 正式视角为面向右侧的轻俯视三分之二侧视；身体向镜头打开约 25°~30°，双肩、双手、双腿与双脚均可读。
- V1 纯水平侧视母图与参考图已在正式视角验收后清理，不得回流运行时。

## 正式视频源

- idle：`video/black-druid-idle-v2.mp4`。
- walking：`video/black-druid-walking-v2.mp4`。
- attacking：`video/black-druid-attacking-v3.mp4`，使用左移安全参考 `video/black-druid-reference-angle-v2-attack-white.png`。
- ritual：`video/black-druid-ritual-v2.mp4`。
- dying：`video/black-druid-dying-v6.mp4`，使用缩镜头安全参考 `video/black-druid-reference-angle-v2-death-v6-white.png`。
- 每个正式视频旁均有同名 `.json` 生成元数据；提示词保存在 `prompts/`。

## 废弃版本

- attacking V2（攻击峰值右侧只剩16px）以及 dying V2~V5（安全边不足、触边或生成大块地面阴影）的旧视频、元数据、参考图和过程联系图均已清理，不得用于精灵表。

## 精灵表与质量结果

- 构建脚本：`build-sheets.py`；记录：`sheet-manifest.json`。
- 正式输出：`generated/final/{idle,walking,attacking,ritual,dying}.png`。
- 动态预览：`previews/final/{idle,walking,attacking,ritual,dying}.gif`。
- 帧数：idle 15、walking 19、attacking 25、ritual 25、dying 14。
- 每段首个中立姿势独立归一到430px素材身体高，段内比例固定；脚线y=489。攻击与死亡用768×512加宽格，其余为512×512。
- 五套输出均为空帧0、触边帧0、透明区RGB最大值0；死亡V6的安全缩镜头已在构建期恢复到与其余动作一致的身体尺寸。
- 运行时正式副本位于 `assets/enemies/black_druid/`；显示尺寸167.3，使430px德鲁伊内容与矿工僵尸276px内容@260.7的等效可视身高一致。

## 双向变身动画

- 使用 H3 `MiniMaxH3ImageToVideo` 双端锁定，而非豆包单首帧：熊端固定为现有黑熊正式母图，人端固定为三分之二侧视德鲁伊正式母图。两端共用1344×768画布、中心x=672、脚线y=700；熊高341px、德鲁伊高520px，对应现有游戏内两形态的实际可见高度比例。
- 正向视频：`transform/video/black-bear-to-druid-h3.mp4`（seed 824001）；反向视频：`transform/video/black-druid-to-bear-h3.mp4`（seed 824002）。均为124帧、5.17秒、20步、1344×768，首尾母图MAE分别为正向0.621/0.441、反向0.446/0.634。
- 正式精灵表：`generated/final/transform_to_{druid,bear}.png`，各20帧、5×4、768×512、2秒、脚线基准y=500；动态预览位于 `previews/final/`。采样只覆盖有效变形区间并强制最后一格使用真实尾帧，避免H3终态长保持挤占动作帧。
- 两套表均使用同一固定缩放0.768328，不做逐帧身高归一；正向有效终态起点frame72，反向frame103。质量统计：空帧0、触边帧0、透明区RGB最大值0，脚底范围正向499~507、反向495~507。
- 运行时正式副本为 `assets/enemies/black_druid/transform_to_druid.png` 与 `transform_to_bear.png`。黑熊半血阶段已实际接入正向动画；反向资源已预载并注册独立动画键，但当前玩法没有返祖触发条件，因此没有擅自新增反向阶段机制。
