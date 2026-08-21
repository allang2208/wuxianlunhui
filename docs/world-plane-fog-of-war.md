# 位面世界战争迷雾

## 目标与规则

位面世界（scene8～scene11）采用经典 RTS 的三态迷雾：

- `UNEXPLORED`：从未探索，主画面完全遮挡，小地图不可见。
- `EXPLORED`：曾经探索但当前无视野，保留地形记忆，敌人、战利品和实时特效隐藏。
- `VISIBLE`：当前视野源覆盖，显示实时单位、建筑和特效。

中立资源等静态对象在首次探索后保留显示；敌方实体、掉落物和标记了 `_fogRequiresVisibility` 的对象必须处于当前视野。只要求“探索后可见”的自定义对象使用 `_fogRequiresExploration`。

探索记录写入 World-122 快照；世界 epoch 改变时旧探索记录失效。主画面和小地图复用同一张低分辨率 CanvasTexture，避免两套状态产生偏差。

## 模块边界

- `src/world/fog-of-war-system.js`：三态网格、探索持久化、实体可见性查询。
- `src/world/vision-source-registry.js`：管理有效视野源，稳定期不在每次迷雾更新中扫描全部实体。
- `src/world/fog-occlusion-grid.js`：复用墙/门碰撞线与建筑 footprint，生成 LOS 阻挡网格。
- `src/phaser/fog/fog-mask-renderer.js`：主画面遮罩、软边和显隐过渡。
- `src/phaser/fog/fog-minimap-layer.js`：小地图复用遮罩纹理。
- `src/phaser/fog/fog-visibility-controller.js`：10Hz 计算受控实体可见性，每帧只重压隐藏集合，避免全实体扫描和间隔帧闪现。
- `src/effects/fog-visual-adapter.js`：特效与迷雾之间的显式契约。
- `src/phaser/fog/fog-debug-overlay.js`：开发期三态网格、视野半径和性能数据。

## 视野源契约

新单位或建筑应显式声明：

```js
entity.fogVisionProfile = 'military';
entity.fogSightRadius = 800; // 可选；未设置时读取配置
```

可用 profile：`player`、`companion`、`military`、`scout`、`cavalry`、`portal`、`troopProducer`、`defenseTower`。明确不提供视野时使用 `fogVisionProfile = 'none'`。

临时、非实体视野源通过 `VisionSourceRegistry.register(entity, options)` 注册，并保存返回的 handle，在生命周期结束时调用 `handle.dispose()`。

## 特效契约

由 `EffectManager` 管理的特效会自动注册，但新特效应至少提供可视对象：

```js
getFogPosition() {
    return { x: this.x, y: this.y };
}

getFogVisuals() {
    return [this._graphics, this._emitter];
}
```

连接两个实体的光束、闪电等使用 `getFogEndpoints()`；任一端不可见时整体隐藏。自行管理生命周期的一次性 Graphics、Sprite 或 Emitter，使用 `scene.syncFogVisualEffect(owner, descriptor)` 注册，并在销毁前调用 `FogVisualAdapter.unregister(owner)`。

## 配置与调试

配置位于 `data/fog-of-war.json`，发布副本位于 `public/data/fog-of-war.json`，两份必须保持一致。主要参数包括网格尺寸、更新间隔、探索/未探索透明度、软边、过渡时间和各 profile 的基础视野半径。

`occlusion.enabled` 控制墙体/建筑 LOS；`rebuildIntervalMs` 是结构状态变化的兜底校准周期；墙线数量、引用、端点、厚度、墙高或所属实体状态变化会立即重建。`cellPaddingRatio` 用于保证细墙能落入 128px 逻辑格。`gateDoorsBlockVision` 固定为 `false` 时，带 `_gateHole` 标记的门扇无论开启还是关闭都不参与 LOS；门柱、门洞两侧墙体及相邻城墙仍正常遮挡。遮挡只改变可见格，不改变敌方实体的 AI、移动、物理、攻击和寻路。

每个阻挡格同时保存阻挡来源与顶高。观察者眼高由承载面高度、单位体高和 `observerEyeHeightRatio` 计算；`defaultWallHeight`、`defaultStructureHeight` 与 `heightClearance` 提供缺省和容差。墙顶单位仅忽略 `_surfaceWall` 指向的实际承载墙，不再把整组连通墙包围框当作透明区域。同格墙段会额外执行局部精确射线检查，防止 128px 粗网格造成贴墙透视。

特殊对象可以用 `fogVisionBlockerHeight` 显式声明阻挡顶高；特殊视野源可以用 `fogVisionEyeHeight` 声明相对脚底的眼高，或用 `fogVisionEyeZ` 直接声明绝对观察高度。

开发工具的“迷雾”页可切换主遮罩、三态色块、网格线和视野源圆圈，并显示逻辑更新时间、遮罩更新时间、变化格数及显式/兼容特效数量。

静态配置检查：

```powershell
node scripts/check-fog-of-war-contracts.mjs
```

## 后续优化方向

1. 将地形高度图接入当前高度感知 LOS；当前版本已经覆盖墙体、动态门和建筑高度。
2. 大地图改为脏矩形纹理更新或 GPU RenderTexture，避免每次重绘全部网格。
3. 联机模式将探索状态按玩家/队伍分片，由权威端同步压缩后的增量。
4. 敌方建筑增加“最后已知状态”快照，而不是在探索区显示实时状态。
