# 废弃矿洞视觉定稿与发布边界

本次交付包括冷灰岩床地板、12件同源PBR贴地小物、Dev v3三款岩墙与木铁门、镜像裁片/完整门叶淡化，以及复用火把和三类双向墙面挂饰。正式路径保持不变，挂饰为新增独立配置；`data/`与`public/data/`同步。

从当前远端主线隔离提取本任务代码块，不提交共享工作区其它改动。已存在的world-126位面独立分支，以及另一任务的随机场地生成器、房图、战斗模板、怪物与波次配置不属于本提交；现有布局继续消费同一墙门键。挂饰只读实际墙段和房间/通道轮廓，包含判断在视觉模块内完成，不依赖尚未合入的主题布局模块。

## 正式来源

- 地板：`tools/ai-gen/_abandoned_mine_bedrock_20260830/manifest.json`，保留生成原图、提示词和处理参数；后续小物尺寸以正式配置为准，旧manifest中的18件记录为历史。
- 贴地小物：`tools/ai-gen/_mine_props_material_review_20260830/`保留12件Blender模型、原生渲染、Depth和256px成品。当前尺寸及安装记录在`_mine_visual_finish_v3_20260830/manifest.json`，六件旧散布物退出配置但保留历史资源，不删除可能用于其它用途的资产。
- 墙门：`tools/ai-gen/_mine_visual_finish_v3_20260830/dev-candidate/installation.json`为上次安装真源；`material-source.json`选定石材原图，`component-materials.json`选定木铁原图。保留岩石12步祖先及其48步精修、门/木撑48步原图、Depth/组件mask、模型和几何参数。
- 挂饰：`tools/ai-gen/_mine_wall_decor_20260830/`包含挂绳、矿镐、木牌两墙向模型渲染、安装记录和实际尺寸挂墙样张；默认Blender直渲，无额外AI生图。火把复用已有`obstacle_torch`，详见`docs/abandoned-mine-wall-torches.md`。

## 重建顺序（本轮未运行）

1. 墙门：`finish-mine-v3-dev-candidate.py materials`读取当前选定raw → Blender执行`render-mine-v3-dev-candidate.py` → `finish-mine-v3-dev-candidate.py components` → `present-mine-v3-dev-candidate.py`。原生v3输入与几何保留，当前纹理打包在Dev目录的blend中。
2. 贴地小物：Blender执行`build-mine-props-material-review.py` → `compose-mine-material-review.py`导出 → `finish-mine-v3-presentation.py prepare`。最后的`install-props`是显式安装，制作/预览命令不安装。
3. 挂饰：Blender执行`build-mine-wall-decor.py`，`present-mine-wall-decor.py`呈现当前正式资源；模型输出不自动覆盖`assets/`。相机/灯组/Depth仅提取已采用的两个函数为`mine-prop-render-contract.py`，参数不变，不打包未发布的雪原模型制作模块。模型源、正式尺寸配置和安装记录须一起管理。

旧v1/v2脚本中仍被导入的几何/拼装函数保留为制作依赖；当前墙门入口以上述v3链为准。前代获准岩面、周期数据、几何记录保留，用于解释并重建首次v3原生输入；历史记录不能被误当成当前安装状态。

## 清理与维护

逐文件清单见`docs/abandoned-mine-visual-cleanup-20260830.json`。清理仅限本任务明确废案、旧预览、逐帧导出、抠色中间图、替换前副本和blend1；保留当前可编辑来源与正式图。生成器保留上次安装字段，重建只标记工作输出变化；旧Dev v2安装入口检测继任版本后拒绝覆盖。

地牢/位面/道路小物统一制作规则归入`skill/02-ai-asset-pipeline.md`；墙段挂载、净空、源列裁片和门叶显隐归入`skill/06-dungeon-scene.md`。根`SKILL.md`仅维护索引。

## 交付限制

未运行测试、构建、lint或运行时验证，按约定由用户测试；未发布或同步固定EXE。离线组合图不是游戏截图，不能证明随机布局、动态遮挡或灯光表现已验收。

重点观察左上/右下门端拼接、开合淡化与中途反向、角色穿门遮挡、两轴挂饰贴墙、短墙净空、暖光亮度和离场清理。暖光为现有ADD柔光，不是物理点光源或墙体遮光求解；有限A/B/C墙纹理仍可能看出重复。
