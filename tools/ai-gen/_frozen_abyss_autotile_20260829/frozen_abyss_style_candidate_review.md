# 冰原深渊材质方向候选记录

## 当前正式生成合同

- 模型：`flux2-dev-depth`
- 公共风格：`world122-building-v5`
- 结构阶段：1024×1024、12步、CFG 3.5、Euler / Simple、Depth强度0.78
- 正式Dev种子：122201、122202、122203
- 正式图集结构：一张共用深渊底层 + `+u / +v / -u / -v`四个固定光向边段母件，再确定性组合16个邻接掩码

## 旧Klein探索：不参与晋级

目录：`candidates_klein_s12/frozen_abyss_style/`、`candidates_klein_s12_floor/frozen_abyss_style/`

孤立Depth三张均把完整外轮廓解释为抬高冰块、井台或平台；连续地面Depth虽得到偏写实雪洞，但使用的是已退出默认路由的Klein参数。两批只保留作结构诊断和模型对照，不进入正式候选池。

## 正式Dev批次：连续地面Depth

目录：`candidates_dev_s12_floor/frozen_abyss_style/`

| 候选 | 种子 | 状态 | 结论 |
|---|---:|---|---|
| `frozen_abyss_style_structure_v01_raw.png` | 122201 | 建议晋级 | 自然下陷成立；蓝灰冰层层理、断崖深度和近黑深渊分组最清楚。 |
| `frozen_abyss_style_structure_v02_raw.png` | 122202 | 不建议 | 结构合格，但断面信息偏弱，外缘白色碎块略显游离。 |
| `frozen_abyss_style_structure_v03_raw.png` | 122203 | 淘汰 | 结构成立但断面过暗、材质被压平，128×64尺度下容易退化为黑洞。 |

## Dev 48步精修

共同参数：`flux2-dev-depth`、48步、CFG 3.5、Euler / Simple、Depth 0.75、denoise 0.30；init为12步结构v01，同一连续地面Depth继续锁结构。

| 候选 | 种子 | 状态 | 结论 |
|---|---:|---|---|
| `frozen_abyss_style_refine_v01_raw.png` | 122201 | 不建议 | 洞口保持，但新增较规则块状裂面和孤立白片，目标尺度下可能读成砌块或贴片。 |
| `frozen_abyss_style_refine_v02_raw.png` | 122202 | 用户已确认 | 保持连续低饱和蓝灰冰断面与近黑深渊；高频信息更克制，更符合大块连续PBR材质面标准。 |

## 确定性母件与16帧暂存

目录：`staged_dev_refine_v02/`

- `frozen_abyss_material_canonical_128x64.png`：从获批源图中央连通暗区自动定位并按2:1裁切，只承担材质取样。
- `masters/`：一张共享深渊底层与四张固定方向边段；方向顺序与运行时严格一致，不使用旋转或镜像。
- `frames/`、`frozen_abyss_autotile_4x4.png`：按bit 0～3=`+u/+v/-u/-v`组合的16张真Alpha帧与4×4图集。
- `frozen_abyss_autotile_seam_proof.jpg`：使用程序白模同一组8格不规则连通单元和真实邻接掩码组装；静态查看未见内部白缝、双封边或错误方向冰壁。
- `frozen_abyss_autotile_staged_manifest.json`：记录源图SHA-256、Dev生成参数、自动裁切框、方向映射、拼接证明用格与全部输出。

## 当前边界

Dev refine v02只作为雪、冰断面和深渊的材质源；最终30度等距轮廓、格边端面、拼接关系与四方向固定光照由项目几何合同和确定性遮罩控制。用户确认后，暂存图集已同内容安装为`assets/terrain/frozen_abyss_autotile.png`并仅接入冰原竞技场地板烘焙；其它地牢及深渊逻辑合同不变。
