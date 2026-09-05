# 矿洞 A 墙：Dev 48步精修，两张候选已完成

后续状态：用户已用“同意，然后继续”选定01号；其材质经周期衔接后扩展并安装为A/B/C岩面，当前记录见`../_mine_wall_dev_final_20260830/manifest.json`。本目录保留原始48步候选，不把派生安装误记为逐字节安装本目录PNG。

用户明确“同意入精修”后，以第4批02号的**原始绿底raw**作为init-image，继续使用其同源Blender Depth。没有使用透明处理图作为精修输入，也没有回到无参考的自由重抽。

## 实际生成

- 模型：flux2-dev-depth；1024×1024；配置48步；denoise 0.30；Depth强度0.75；CFG3.5；Euler/simple。
- 两个seed：122083050、122083051。原12步选图seed为122083041。
- 48是调度器配置步数；img2img按0.30截取低重绘噪声区间，不表示48次完全重绘。
- 保留已选mine-wall-pbr-v3提示词，只补充已有矿物过渡的克制细化，未重新加入建筑模板或开凿刻纹语义。
- 发送到已授权的192.168.3.142:8188：选中的Dev绿底raw、同一Depth和材质提示词/参数。没有发送Blender原生beauty、blend或整个仓库。

## 后处理与观察

两张均完成原Alpha、原轮廓边缘RGB和原生低频RGB色调/光照恢复；使用原1024画布、groundCenter、display和双轴步长，不改变视角、墙高、碰撞或门口裁片代码。原raw背景阴影仅在处理图中按原Alpha排除，raw不能作为透明正式素材直接安装。

- **推荐01号**：斑驳边缘过渡较柔和，连续墙中较克制。
- **02号备选**：局部亮斑更醒目，纹理对比略强。
- 两张没有再出现砖底座、木框或刻字状网格；低重绘保留已有大形和材质布局，因此不会表现为全新的墙体设计。
- 单款纹理在长墙中仍会周期重复。本批没有宣称最终无缝验收，不自动解决门端、转角或A/B/C混排的实机表现。

## 文件

- wall_a_refine_v01_raw.png / wall_a_refine_v02_raw.png：两张实际Dev输出。
- wall_a_refine_v01_candidate.png / wall_a_refine_v02_candidate.png：恢复同源Alpha和色调后的候选。
- wall_a_dev_candidates.png：左为已选12步图，中为48步01，右为48步02；上排放大，下排实际显示尺寸。
- wall_a_refine_v01_seams.png / wall_a_refine_v02_seams.png：原锚点与步长的双方向连续墙离线图。
- request.json、逐张generation.json、wall_a_refine_prompt.txt：输入、参数、调用与提示词真源。
- review.json：人工观察、推荐及限制；重跑compose后仍以它为准。

重建入口为tools/ai-gen/mine-wall-a-dev-refine.py，使用项目ComfyUI .venv/Scripts/python.exe，依次prepare/generate/compose。prepare在已有raw时拒绝覆盖记录，generate保留现有raw，compose仅重建本目录候选。没有安装入口。

批准范围是本批A墙精修，不包含正式入库；B/C与门未扩展，assets/terrain和运行时代码均未修改。未运行测试或运行时验证，按约定由用户测试；后续需重点观察长墙重复、四角和门端衔接。
