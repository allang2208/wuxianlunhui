# World-126·废弃矿洞位面模板

## 模板规格

- 运行时加载器：`scene12`，12288×8192，中心 `(6144,4096)`，标准大世界菱形边界，基础镜头缩放 0.7。
- 身份：固定 `scene12` 仅用于开发预览；正式剧情由 `WorldInstanceSystem` 创建独立 `instanceId`，每个实例分别保存 seed、世代、传送门、快照、建筑、单位、迷雾与玩家位置。
- 生成：矿洞模板 `storyEnabled:true`，可被后续剧情/战略入口显式选取；新局初始模板池仍只含沙漠、雪原、林地与遗迹，不会提前抽到矿洞。
- 音频/加载：复用 `幽洞回声.wav`；Loading 使用 World-126 专属矿洞图池。地下模板不加入室外天气目标列表。

## 地面与视觉小物复用

`_loadScene12()` 通过 `getAbandonedMineFloorProfile('plane')` 读取现行 `data/abandoned-mine-terrain.json`：

- 基底继续使用 `floor_abandoned_mine_seamless`、`continuous:true`、`textureScaleY:0.5774` 与 `#0b0a09` 背景，并按 2048 分块烘焙。
- `deco.assets` 的现行小物继续按世界晶格确定性绘制，只进入地板画布，不创建实体、碰撞、寻路占格或快照记录。
- 地面和障碍分别使用 `floor_deco` 与 `obstacles` 随机流；正式实例首世代以实例 seed 为根，同一世代稳定，重建后切换到新布局。

## 五款路径障碍

正式障碍为坍塌木支护、脱轨满载矿车、天然岩柱簇、手摇卷扬机和矿石分选料斗。获批 V01 经 BiRefNet 真透明、6px 紧裁与轮廓中性去绿后入库；不随机旋转或翻转，保持 30° 正交相机、44.8° 模型根和获批底边。

`world126-environment.js` 默认散布 50 件，五款按耗尽后重洗的权重池循环抽取。落点必须同时满足：

1. 完整 footprint 位于菱形内缩区；
2. 避开玩家出生点与世界传送门；
3. 满足障碍中心最小距离与 footprint 矩形间距；
4. footprint 中心与四角通过 `WallSystem.canMoveTo`；
5. 显示缩放、碰撞 footprint 与遮挡深度同源，depth 固定取 footprint 前缘。

障碍标记 `_scatter:true`，建筑落位时沿用世界散布障碍的可清除合同。废弃矿洞地牢自身不生成这些障碍，`ObstacleSpawnSystem.spawnForRoom/spawnForPassages` 仍固定返回 0。

## 资产与验证边界

运行图位于 `assets/terrain/abandoned-mine-obstacles/`；模型、Body Depth、accepted V01、生成元数据与 `runtime-promotion.json` 位于 `tools/ai-gen/_world126_mine_obstacles_20260829/`。提供独立静态合同脚本 `npm run test:world126`，但迁移整理时未运行测试、构建、lint、浏览器探针或游戏运行时验证。
