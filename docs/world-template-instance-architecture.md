# 位面模板与动态实例架构

## 目标

固定`scene8~scene12`只负责提供可复用的地貌、资源、环境和场景加载器。正式剧情推进时创建带独立seed的持久位面实例；开发人员则从交互开发工具选择模板和seed，生成不污染存档的一次性测试地图。

## 两种身份

- 运行时场景ID：`scene8`沙漠、`scene9`雪原、`scene10`林地、`scene11`地牢遗迹、`scene12`矿洞。用于选择加载器、场景尺寸、贴图、BGM和模板效果。
- 逻辑世界ID：`world-instance:<template>:<sequence>`。用于传送门、世界世代、快照、迷雾、兵线、天气、入侵、建筑和玩家坐标。

调用方读取当前逻辑身份用`SceneManager.getCurrentWorldId()`；只有判断模板行为时才读取`SceneManager.currentScene`或`getCurrentRuntimeSceneId()`。

## 创建入口

正式剧情模块使用：

```js
const created = WorldProgressionSystem.createRandomStoryWorldInstance({
    strategicCellId: plotCell.id,
});
if (created.ok) {
    plotCell.worldId = created.worldId;
}
```

需要指定模板时改用`createStoryWorldInstance({ templateId, strategicCellId, seed })`。正式API会建立传送门生命周期、首世代生成上下文和基础快照，并随主存档恢复。

`strategicCellId`是剧情提交的幂等键：相同战略格重复调用会返回原实例并标记`reused:true`，不会重复抽取模板或重置已有快照。首城授予阶段由玩家点击的战略格确定`strategicCellId`与地貌模板，确认后才创建第一个正式实例；`world-system.json.storyGeneration.initialInstance`保持关闭，不再提前补建随机位面。

开发预览由开发工具调用`WorldInstanceSystem.createDevPreviewInstance({ templateId, seed })`后进入。预览实例不序列化，不进入世界面板、后台经济或入侵候选；离开后清理。测试位面中禁止保存，读档会先安全返回主神空间再恢复正式注册表，避免玩家落点、兵线或当前实例ID泄漏进存档。

主存档同时保存当前正式逻辑世界和各持久世界落点；恢复顺序固定为实例注册表、位面进度、天气/快照，最后再进入保存时所在的正式实例。后台结算需要模板差异时必须显式传入实例解析后的`runtimeSceneId`，不能直接拿`world-instance:*`查询`sceneN`配置表。

## 模板状态

| 模板 | 加载器 | 正式随机池 | 开发直达 |
|---|---|---:|---:|
| 沙漠 | `scene8` | 是 | 是 |
| 雪原 | `scene9` | 是 | 是 |
| 林地 | `scene10` | 是 | 是 |
| 地牢遗迹 | `scene11` | 是 | 是 |
| 矿洞 | `scene12` | 是 | 是 |

五种地貌都只把固定`scene8~scene12`作为加载器和模板预览；正式首城及后续剧情位面使用独立实例ID。

## 后续接线边界

战略剧情事件应在业务提交成功后创建正式实例并保存返回的`worldId`，UI只消费该ID，不能自行抽取模板。首城选址是同一协议的首个正式入口，唯一一次免费授予只旁路建造资格，不伪造地牢与科技进度。沙尘暴、干旱和死寂雾潮目前仍按模板共享时间线，后续应改为持久实例分槽。
