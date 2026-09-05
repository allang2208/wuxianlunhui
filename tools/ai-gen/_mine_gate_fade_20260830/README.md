# 矿洞门完整升降与淡化

本轮按用户要求修改实际运行时代码，正式门贴图保持不变。问题来自历史640²序列帧上缘裁断，以及关闭时直接显示残缺的最高帧。给旧帧加透明度不能恢复被截掉的门体，因此本次用原关闭帧0的完整刚性门叶沿原Blender关键位移移动。

- 关闭：上方完整门叶从透明淡入180ms，再沿原关键轨迹下落720ms。
- 开启：沿原关键轨迹上升720ms，再在顶部淡出180ms，alpha为0才隐藏。
- 总时长900ms，原16个高度关键点与最大升距417.3926源像素保留，移动阶段连续插值；与旧版相比将原900ms运动压缩到720ms，为淡化留出180ms。
- 运行时纹理帧始终为0，连续逻辑进度另存`_gateVisualFrame`。门体与高亮同步，源列裁片、六段depth、门底线、端片退层与碰撞时机不变；中途反向从当前进度续播。
- 仅矿洞配置启用。其它地牢仍使用旧纹理帧，宝箱门原向下取整、其它门原四舍五入规则不变。

## 相关文件

- `src/world/gate-visual-state.js`：`bindGateLeafMotion`与`updateGateSprites`。
- `src/world/wall-system.js`：矿洞`leafMotion`参数与原Blender位移表。
- `src/world/wall-gate.js`：全局出口与高亮，进度反向。
- `src/world/combat-room-system.js`：竞技场入口/通道门与进度反向。
- `src/world/chest-room-system.js`：独立宝箱门。
- `tools/ai-gen/compose-mine-dev-refinement-review.py`：本地素材呈现，不启动游戏。
- `skill/06-dungeon-scene.md`及`CHANGELOG.md`：管线约定与本轮记录。

`gate-full-leaf-fade.gif`是两方向完整过程；`gate-fade-stages.png`是关闭阶段图。预览读取当前矿洞配置和正式PNG，离线复现相同轨迹与裁片排序，不是Phaser截图，也不是运行时验证。历史套件内`wall-gate-animation.gif`保留的是旧裁断动画，当前效果以本目录为准。

## 同期Dev材质

已按用户新增上传授权生成木撑和门叶各两张Dev48候选，存于`../_mine_wall_dev_final_20260830/supports/`和`gate/`，各自含raw、生成参数、固定Alpha加工图和`material-review.png`。候选不随动画修复覆盖正式材质；建议01，变化主要是细微木纹，不是建模升级。

## 限制与用户测试

完整门叶会在墙顶上方短暂悬空显现，再落下或淡去。这是本次取消固定裁断边界后的视觉取舍，可以根据实机感受再调淡化时长，但不能恢复裁断帧掩盖问题。

未运行测试或运行时验证，按约定由用户测试。重新进入矿洞后重点看左上/右下门口、升降与透明度、快速反向开关、悬停轮廓、通行碰撞和离场是否残留。保留当前逻辑关门时立即阻挡、开门开始即允许通行的约定，不随淡化推迟碰撞。
