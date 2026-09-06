# 家园双叶移民旗

2026-08-31，按用户“用旗子棋子、不要篷车”的反馈替换。青灰布面配象牙色房屋与双叶纹章；沿用当前已选V2军旗的旗杆、底座、布面姿态、材质和55°正交相机，不改原军旗图集，也不采用未选的V3姿态。

## 来源与制作

- 原生基础：../_world_army_flags_v2_20260830/world-army-flags-v2.blend 的 player 旗帜；相机与姿态取同目录 manifest.json。原工程未修改。
- 新纹章：内置 imagegen，以原 player 纹章为风格参考生成“房屋＋双叶”。emblem-source.png 是原始输出的直接副本，prompt.txt 保留实际提示词。
- 原始纹章PNG自带不透明中性棋盘底，并非真实透明。保留原文件不重画；在原生布面材质中，用暖色差 R-B 的 MapRange（0.008—0.06）作为印花混合遮罩，底色透出布料。最终透明背景来自Blender原生渲染，不宣称原始纹章已抠图。
- build-settler-flag.py 在内存中派生独立移民旗工程，沿用原UV、织纹、墨色与灯光，换布底色和纹章；其他旗帜仅从派生工程移除，不改源模型。纹章已打包到 settler-flag.blend。
- settler-flag.png 为256×256透明原生渲染，55°指相对于水平面；布面前倾约16.7°，正交尺度2.1。settler-flag.json 保存实际相机、底座接地点投影和透明边界。

在仓库根目录可用 Blender 后台执行本目录 build-settler-flag.py 重新制作；依赖的V2工程与纹章原图应一并保留。此脚本是离线素材生产，不是游戏验证入口。

## 接入范围

PNG复制至 assets/ui/world-map/settler-flag.png，元数据复制至 data/world-map-settler-visuals.json 及 public/data 同名镜像。src/ui/world-map-army-visuals.js 供地图和列表共用；src/ui/world-map-view.js 统一兵旗轻摇和旗帜加载回退；src/ui/world-map-settlers.js 同步画像与名称。远景仍显示“移”，停驻静止、抵达脉冲及减少动态效果沿已有逻辑。

旧篷车已移出资产目录，仅发布提示词和来源元数据，废案PNG留在本地忽略的恢复目录；不属于本旗的重建依赖。本次不修改移民人口、粮能成本、寻路、建城距离或存档结构。新旗已完成离线素材预览并接入本地开发源码；尚未取得用户游戏内美术验收，功能及素材待战略框架合入后发布。本旗的原生模型、纹章与制作脚本继续保留。未运行测试或运行时验证，按约定由用户测试；未构建或同步EXE。
