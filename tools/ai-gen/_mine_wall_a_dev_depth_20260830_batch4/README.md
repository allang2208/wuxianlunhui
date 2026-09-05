# 矿洞 A Dev 重抽：第4批（02号为精修候选，未入库）

本轮用户要求“不合格继续抽”，实际新增第2/3/4批，共9张Dev原图。沿用已授权的192.168.3.142:8188目的地，仅发送原模型Depth、材质提示词与参数，未上传beauty、blend或整个仓库。

## 本批结果

- flux2-dev-depth，1024²，12步，CFG3.5，Euler/simple，Depth0.78；seed 122083040～122083042。
- 原提示词的建筑构件和开凿划痕语义均移除，使用连续深灰玄武岩、柔和矿物斑驳与克制粗糙度，保留共享低饱和游戏PBR及柔和顶侧光方向。实际文本见wall_a_structure_prompt.txt。
- 01/03仍明显强化上下边条，淘汰。02岩面连续，没有砖底座、木框面板或刻字状网格；用户随后明确“同意入精修”，本批02号原始绿底图已作为48步输入，后续记录在../_mine_wall_a_dev_refine_20260830/。批准范围不包含正式入库。
- 02的raw背景包含阴影，正式处理图通过原Alpha排除；不把raw当透明正式素材。原Alpha、原轮廓边缘RGB、尺寸和锚点均沿用v2。
- 相比第2批只恢复低频亮度，本批逐RGB通道恢复原生低频色调和光照，减轻偏紫岩面与原生冷灰边缘的色带。几何、碰撞、墙脚、墙高与门帧没有修改。

## 预览与已知限制

- wall_a_dev_candidates.png：左为原生PBR，右为01/02/03号；上排放大，下排实际显示尺寸。
- wall_a_structure_v02_seams.png：推荐02号，固定步长、原锚点、禁止水平镜像的双轴连续墙离线预览。
- 三张raw、三张处理图、三张拼装图、实际提交提示词和逐张generation.json均保留。

单块矿物斑驳仍会周期重复；这是精修候选，不是最终无缝或实机门口验收。没有将A材质自动扩散到B/C或门，没有覆盖assets/terrain正式PNG。

对照原Depth与模型源后补充纠正：原模型本身有顶部转折与底部外扩（build-mine-wall-a-rockface.py的build_rock），Dev又强化了其视觉边界；不能把上下边条全部归为AI凭空新增。第1批的砖底座、木框，以及第3批的刻字状纹理则确实是多余内容。若后续要求彻底消除边条，需要针对模型表面和同源Depth处理，不能只无限换seed。

## 重建入口

使用项目ComfyUI的.venv/Scripts/python.exe运行tools/ai-gen/mine-wall-a-dev-reroll.py，stage为prepare、generate、compose，参数--batch 4。prepare在已有raw时拒绝覆盖；generate保留已有raw；compose只重建候选和离线图，不安装。重跑compose会重置manifest生成状态，人工结论以review.json为准。

未运行测试或运行时验证，按约定由用户测试。后续重点观察连续墙重复纹理、转角和门端拼接；当前离线预览不能替代这些实机行为。
