# 指挥建筑定稿来源

用户最终选择：指挥所A、司令部B、国防部A。`final-selection.json`记录选择，`accepted/runtime-assets.json`指向三份精修raw、body、正式PNG、标定参数与最终Alpha预览。直接12步输入由`refinement-manifest.json`的`selectedSource`指定，均保留，不能当未选废案删除。

正式文件位于`assets/terrain/`、`assets/ui/building-thumbnails/`及`assets/terrain/lighting/`。三阶逻辑占地均4×4，各自显示标定到512×256；选中图与旧模型Depth存在偏差，Depth仅用于生成控制，不参与定稿Alpha裁切。

## 当前重建入口

1. `render-models.ps1`调用`../command-building-branch-blender.py`，从`manifest.json`重建三档Blender模型、材质预览和Depth。当前可编辑`.blend`也已保留。
2. 已选raw无需重新生成。需要重做透明主体时，运行`finalize-selected.py`，使用保留的48步raw与选择参数，重建body、正式PNG、缩略图及最终预览；这会写正式素材，需按当前任务授权使用。
3. 光照派生采用公共`../build-lighting-maps.py`的对应三项。重建素材不等于重新启用科技或更新运行时注册表。

若明确要求重新生成候选，先读项目建筑管线与当前服务授权；`generate-refinement.py`仍使用保留的三份12步输入和Depth。历史执行日志、未选raw及比较图已清理，逐张generation JSON、提示词、审阅意见与清理清单保留追溯，历史输出路径不再作为默认输入。

一次性v52→v53安装器、旧派发器与设计预算生成脚本已移除，防止误覆盖共享注册表。科研预算仅保留历史快照；真实科技以当前游戏配置为准。

本地玩法与科技已接入，但完整运行时代码的Git发布受未合入公共建筑等级合同阻断，详见`../../../docs/world-strategy-publication.md`。所有离线预览均不是游戏截图；未运行测试或运行时验证，按约定由用户测试。
