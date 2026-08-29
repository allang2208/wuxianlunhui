# World-126·废弃矿洞位面

## 位面规格

- 场景：`scene12`，12288×8192，中心 `(6144,4096)`，标准大世界菱形边界，基础镜头缩放 0.7。
- 解锁：完成一次 `abandonedMineBeginner` 后可在主神空间首次免费构造该世界传送门；后续沿用世界传送门摧毁、重建、世代 seed、快照、资源、建筑、单位和入侵生命周期。
- 入口：主神空间传送网络、世界切换面板和建筑传送门均登记 `scene12`；场景回滚、观察模式、RTS、平面视图、效果层、战争迷雾与玩家坐标记忆均加入常驻世界集合。
- 音频/加载：复用 `幽洞回声.wav`；Loading 有独立标题并使用通用无图背景兜底。地下位面不加入室外雨天目标列表。

## 地面与18件小物复用

`_loadScene12()`直接读取 `data/abandoned-mine-terrain.json`：

- 基底继续使用 `floor_abandoned_mine_seamless`、`continuous:true`、`textureScaleY:0.5774` 与 `#0b0a09` 背景；按 2048 分块烘焙。
- `deco.assets` 的18件矿洞小物原样复用，继续按世界晶格确定性绘制，只进入地板画布，不创建实体、碰撞或寻路占格。
- 地面和障碍分别使用 `floor_deco` 与 `obstacles` 世界世代随机流；世界重建后随新 `worldEpoch` 生成新布局，同一世代保持稳定。

## 五款路径障碍

正式障碍为坍塌木支护、脱轨满载矿车、天然岩柱簇、手摇卷扬机和矿石分选料斗。获批 V01 经 BiRefNet 真透明、6px 紧裁与轮廓中性去绿边后入库；禁止随机旋转和翻转，保持30°正交相机、44.8°模型根和获批底边。

`world126-environment.js`默认散布50件，五款按耗尽后重洗的权重池循环抽取。落点必须同时满足：

1. 完整 footprint 位于菱形内缩区；
2. 避开玩家出生点与世界传送门；
3. 满足障碍中心最小距离与 footprint 矩形间距；
4. footprint 中心与四角通过 `WallSystem.canMoveTo`；
5. 显示缩放、碰撞 footprint 与遮挡深度同源，depth 固定取 footprint 前缘。

障碍标记 `_scatter:true`，建筑落位时沿用世界散布障碍的可清除合同。废弃矿洞地牢自身不生成这些障碍，`ObstacleSpawnSystem.spawnForRoom/spawnForPassages`仍固定返回0。

## 资产与验证边界

运行图位于 `assets/terrain/abandoned-mine-obstacles/`；模型、Body Depth、accepted V01、生成元数据与 `runtime-promotion.json` 位于 `tools/ai-gen/_world126_mine_obstacles_20260829/`。新增 `scripts/test-world126-mine.mjs` 并接入 `npm test`，但本次按仓库约定未运行测试、构建、lint、浏览器探针或游戏运行时验证。
