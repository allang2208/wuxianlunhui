# 矿业工会 · 已确认素材入库

用户“可用，继续”确认 `../cart_purple_crystal_v01/mining_guild.png`。本目录登记正式资源及待接线的视觉参数；完整来源见 `asset-registration.json`，不是已完成玩法的声明。

- 正式主体：`assets/terrain/mining_guild.png`，RGBA 877×691。
- 建造缩略图：`assets/ui/building-thumbnails/mining_guild.png`，透明128×64，等比完整容纳主体。
- 四张光照图：`assets/terrain/lighting/mining_guild_{silhouette,projection,height,normal}.png`，通过标准生成器单目标派生；登记于 `data/environment-lighting-assets.json#assets.mining_guild`。
- 导出记录：`mining_guild_runtime_metadata.json`。冻结已确认Alpha，不再去绿、补色、平滑或改变轮廓；裁切框仍为完整877×691。
- 视觉配置：`mining_guild_visual_config.json`，名义显示512×403、脚底偏移199，4×4对应512×256标准地面。`visualFootprint`按共享公式派生strict映射，尚未作为运行时配置注册或进行游戏内标定。

当前项目没有矿业工会的功能定义，故不擅自增加空建筑、招募单位、采矿增益或科技。待用途确定后，使用现有 `producer-buildings.json` 配置入口及自动资源驻留，补齐已确定的玩法字段，再运行 `node tools/generate-building-preview-assets.mjs --only mining_guild` 派生本建筑ground-fit记录；不得绕过配置新增Boot常驻贴图。

本轮只完成资源生产与来源登记。未运行测试或运行时验证，按约定由用户测试；未启动游戏、构建、同步EXE、提交或推送。后续重点确认4×4贴地、前后遮挡、缩小后的晶石辨识度及最终功能。
