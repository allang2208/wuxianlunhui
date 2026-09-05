# 矿洞 A 墙：Dev + Depth 三候选已出图，本批不入库

用户明确要求使用Dev模型，沿用项目当前`flux2-dev-depth`管线。上一批ImageGen试作不作为本批输入，也不接入游戏。

## 已完成

- 保留v2 Blender模型、相机、1024画布、墙脚和门口代码。
- 将原始16bit Body Depth按65535→255量化为供ControlNet读取的8bit灰度图，没有重投影或重估深度；直接转L会把大部分深度截成白色，本批没有这样处理。
- 保存原Alpha、共享v5材质提示词与墙体专用约束。墙没有地台，不套用建筑地基。
- 准备3个固定seed、12步、CFG3.5、Euler/simple、Depth0.78的生成入口；后处理保留原Alpha、原轮廓边缘RGB与原低频明暗，另输出实际尺寸和双轴连续墙预览。

## 生成状态

用户明确回复“同意”后，远程授权通过，三张Dev原图均已生成并下载；已执行`compose`，完成原Alpha、轮廓边缘RGB及低频明暗恢复，输出三张处理图、四列对照和三张双轴拼装图。本批三张均不满足正式入库要求，未选定合格款。

上传范围仅为`mine_wall_a_v2_depth_control.png`、`wall_a_structure_prompt.txt`内容及生成参数；不上传原始`.blend`、整个仓库或凭据。目的为在项目登记的远程5080 ComfyUI生成3张Dev候选，结果下载到本目录。

## 结果与边界

| 候选 | 观察结果 | 处理 |
| --- | --- | --- |
| 01 | 原Alpha内仍有新增顶沿、底边；左右面偏色明显；双轴拼装可见重复面边界和裂缝 | 淘汰，仅保留作岩石材质参考 |
| 02 | 生成砖砌底座及顶盖，恢复Alpha后仍存在 | 淘汰 |
| 03 | 生成木框/建筑面板、石基础及块状浮雕 | 淘汰 |

查看`wall_a_dev_candidates.png`和`wall_a_structure_v01_seams.png`；详细结论保存在独立`review.json`。原始图、实际提示词、seed和逐张调用记录均保留，不把失败试作改写成成功素材。

这次证明了Dev确实参与出图，但Depth只约束大轮廓，原Alpha和原低频明暗无法清除内部新增结构，也不保证RGB纹理无缝。完整建筑风格模板中的地基/建筑词汇可能诱导了建筑细节，这是待确认的原因，不是唯一原因定论。

后续应保留Dev与原Depth，将共用PBR材质/灯光条款和建筑身份/地基条款分开，建立矿壁专用提示词与接缝约束，再考虑重新生成。本批不晋级48步，不向B/C或门传播；本轮没有追加第四张请求，也没有上传原生beauty。当前正式素材仍为已安装PBR v2，门口裁片修复保持不变。

## 入口

仓库根目录使用项目ComfyUI的`.venv/Scripts/python.exe`（包含共同生成器导入所需的SciPy；仅有Pillow/numpy的Codex Python不足以运行generate）：

```text
tools/ai-gen/mine-wall-a-dev-candidates.py prepare
tools/ai-gen/mine-wall-a-dev-candidates.py generate
tools/ai-gen/mine-wall-a-dev-candidates.py compose
```

本批已依次执行`prepare`、`generate`、`compose`。脚本没有安装入口，不会覆盖`assets/terrain/`。现有raw会被generate保留；不要在本目录修改提示词后把旧raw标记成新结果。重新compose会重建manifest的生成状态，人工结论以独立`review.json`为准。

本批交付限于生成脚本、控制图、Alpha、提示词、三张原图/处理图、离线预览与参数/状态记录。未修改正式PNG或运行时代码；未运行测试或运行时验证，按约定由用户测试。
