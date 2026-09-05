# 主神空间 R22 环境优化

已接入开发资源：同构昼暮夜远景、3 层缓慢云雾、间歇 3–5 只远景飞鸟、4 盏灯、祭坛/传送门微光、8 级台阶与主台嵌线夜间提示。

- 白昼原图保留；暮色与夜景是 image_gen.imagegen 各一次参考图编辑，源文件和约束见 asset-manifest.json。本轮没有调用 5080；沿用已认可 R21 的 5080 石纹与 Blender 分层主体。
- 昼夜直接读取已保存的世界时钟（默认 12 分钟一日）；不新增存档时钟。云雾和鸟的装饰动画随游戏暂停，离开主神空间或地图模式时隐藏，场景关闭销毁。
- 背景、云和鸟共用原世界基线裁切；灯光按灯具/建筑深度，地面光池与台阶嵌线在地台之上、建筑阴影和人物之下。
- R21 材质、R19 NPC 位置、R16 通行范围和碰撞没有修改。

## 文件

- 01-day-dusk-night-preview.jpg：三时段同镜头与局部预览。
- day-full.png / dusk-full.png / night-full.png：3072×1728 离线整场。
- asset-manifest.json：生成出处、光源锚点、模型投影线坐标与交付边界。
- ../package-atmosphere-r22.py、../compose-atmosphere-r22.py：打包与离线合成脚本。

运行代码：src/world/main-hub-atmosphere.js（环境效果）、src/world/main-hub-architecture.js（纹理入口）、src/world/world-render-layers.js（贴地光层）、src/phaser/scenes/GameScene.js（场景同步与清理）。双份配置：data/game-config.json、public/data/game-config.json。

## 交付边界

预览使用实际资源离线合成，环境色和光晕为近似；不包含实机太阳阴影、雾和动画采样，不是游戏截图。未运行测试或运行时验证，按约定由用户测试；未同步 EXE。

用户验收重点：昼暮夜过渡是否自然；移动/缩放后背景裁口和远鸟是否始终在建筑后；夜间台阶、灯具遮挡与亮度；离场/返回和暂停时效果状态。
