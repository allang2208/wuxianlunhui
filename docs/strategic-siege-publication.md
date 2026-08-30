# 战略出征与攻城布局：本地实现、素材归档及发布边界

2026-08-31。用户要求清理本任务废案、沉淀SKILL并授权推送到`allang2208/wuxianlunhui`。不包含测试或固定EXE发布。

## 本次可独立发布的内容

- 城市/据点正式`assets/ui/world-map/settlements.png`及`data/`、`public/data/`两份帧元数据：五种地貌各一城一据点，加两款废墟，12帧256px、1024×768图集。
- `tools/ai-gen/_world_settlements_v1_20260830/`的原生模型、建模/导出脚本、manifest与一张结构/材质对照图。共用相机、材质库及地貌图集已在主线；不提交可再生渲染和旧比例预览。
- 出征准备、时间行军/菱形遭遇战和攻城预设说明；SKILL第02/06/07/08/10卷的对应实现合同与索引；精确清理清单。

素材与文档可独立回滚；它们不启用远端游戏中的战略入口。文档出现的`src/world/strategic-*`等路径描述本地源码，不表示这些文件已经发布。

## 运行时代码尚不能推送的原因

核对最新远端基线`5165e911`时，战略基础`world-strategy-system.js`、`world-strategy-campaign.js`及`world-strategy.json`尚未入库。公共`building-tier.js`也不存在；远端`ProducerBuilding`虽有部分塔顶节点支持，仍没有本地攻城塔调用的`_applyBuildingTierVisual`和`_removeWallTowerSupport`。

这些调用依赖其他任务尚未合入的建筑等级与城防清理协议。共享`producer-building-system.js`、`defense-system.js`、`GameScene.js`等文件混有其他任务改动。依据`skill/15-git-workflow.md`第15.3、15.7节，不整文件打包、不猜测混合片段归属、不提交依赖缺失的玩法，也不回退本地已接入效果。

因此本次不发布出征UI/名册、大地图移动与输入、遭遇战/占领/返回、守军AI、楼梯塔楼生成及共享接线。公共合同由所属任务先合入后，再从最新主线隔离移植这些片段。既有战略发布记录见`world-strategy-publication.md`。

## 布局认可与清理

- 用户认可的是城市四角塔楼、三组城内楼梯（含下方楼梯）；据点保留一组楼梯、不加角塔。本地正式攻城入口已读取双份预设，详细坐标、耐久继承和清理见`strategic-siege-presets.md`。
- 删除23个本任务文件，共8,368,440字节：旧出征样例5个、可再生PNG14个、生产日志2个、缩小前比例预览2个。清单见`strategic-siege-cleanup-20260831.json`；未清理其他会话或已发布EXE。
- 已认可的攻城构造截图和生成页保留在本地忽略目录`tools/verify-shots/strategic-siege-layout-20260830/`，不强制提交临时预览。图中半透明墙只用于剖示，游戏城墙不透明。实施前临时备份暂保留供未发布代码回退，不能整文件恢复覆盖并行改动。

未运行测试或运行时验证，按约定由用户测试。需重点确认名册完整性、半天/格与地形修正、楼梯/塔墙通行、远程守墙、近战调防和战损重入；布局认可与静态合同不代替这些验收。固定EXE未更新。
