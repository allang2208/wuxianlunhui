# 贸易公司：02异形招牌版的48步精修

2026-09-01，用户“同意，继续”确认上一轮02异形招牌版后，沿原建筑布局生成两张标准48步候选。用户随后接受推荐的**精修01**并完成透明定稿与游戏接入；精修02及批次比较页已按归档规则清理，生成元数据和判退理由保留。

- [精修01（保留已确认字形）](trading_company/trading_company_refine_v01_sign_preserved.png)
- [未经修改的精修01 raw](trading_company/trading_company_refine_v01_raw.png) / [逐张观察](review.json)

## 字形保留与真实来源

两张48步raw都重画了招牌笔画，02甚至出现汉字式字形。因此使用上一轮的同一牌面蒙版，把用户确认的四组虚构异形字恢复到两张精修图，其他部分保留各自48步结果。交付文件名为 `*_sign_preserved.png`，明确是合成衍生图，不冒充未经修改的AI原图。

`preserve-sign.py` 与 [sign-preservation-provenance.json](sign-preservation-provenance.json) 记录此步骤：相对各自raw仅牌面范围改变2397/2436像素；蒙版外改变均为0，蒙版不透明区域与已确认源图的差异均为0。蒙版边缘使用原有抗锯齿权重，未整图复制源图、改色或重新生图。

完整来源链保留：

1. 首版可编辑模型 [trading_company_model.blend](../trading_company/trading_company_model.blend)、[装配脚本](../build-models.py)、[原始完整Depth](../trading_company/trading_company_body_depth.png)。原模型包含双坡屋顶和四柱门廊。
2. 用户选择的 [12步02 raw](../trading_candidates_dev_s12_20260901/trading_company/trading_company_structure_v02_raw.png)，包含用户认可的宽面货仓入口、弧形雨棚与两只货箱。
3. [已确认异形招牌源图](../trading_sign_alien_20260901/trading_company_alien_sign_raw.png) 与该次 [牌面修改来源](../trading_sign_alien_20260901/provenance.json)。本轮init实际使用这张合成图，不使用换招牌前的02，也不使用上一轮未经限域的AI返回图。
4. 本批获选的 `*_refine_v01_raw.png`、两次生成各自的 `*_generation.json`、实际提交的 `trading_company_refine_prompt.txt`及完整Depth副本；未选v02 raw和日志已清理。
5. 获选的 `*_refine_v01_sign_preserved.png`、牌面恢复脚本与来源记录。`present.py` 只负责可重建的比较排版。

## 实际参数与复现

两张均为 `flux2-dev-depth`、`world122-building-v5`、1024×1024、48步、Depth0.75、denoise0.30、CFG3.5、Euler/simple；seed分别为133251、133252。未启用Edge、局部生成蒙版或非标准参数；没有追加重抽。生成过程附带的edge图仅是入口脚本派生产物，未上传为控制输入。

```powershell
$env:PYTHONIOENCODING = 'utf-8'
& 'E:/无尽轮回/长期备份/2026-7-13-1/ComfyUI/.venv/Scripts/python.exe' -u -B tools/ai-gen/generate-world122-building-candidates.py --manifest tools/ai-gen/_industrial_economy_buildings_20260831/trading_refinement_dev_s48_20260901/manifest.json --stage refine --only trading_company --init-image tools/ai-gen/_industrial_economy_buildings_20260831/trading_sign_alien_20260901/trading_company_alien_sign_raw.png --raw-only
& 'E:/无尽轮回/长期备份/2026-7-13-1/ComfyUI/.venv/Scripts/python.exe' -B tools/ai-gen/_industrial_economy_buildings_20260831/trading_refinement_dev_s48_20260901/preserve-sign.py
& 'E:/无尽轮回/长期备份/2026-7-13-1/ComfyUI/.venv/Scripts/python.exe' -B tools/ai-gen/_industrial_economy_buildings_20260831/trading_refinement_dev_s48_20260901/present.py
```

已有raw时入口会跳过生图；需要重新生成须另建批次，不能覆盖本次来源。局域网传输沿用AGENTS中的同一目的地授权，未清空、抢占共享队列。

## 保留边界

旧完整Depth保留模型的窄端货仓门和旧徽记，与用户接受的02存在差别。本轮保留用户选定图中的实际布局，不恢复侧窗、旧门位或平雨棚；后续抠图必须以所选图实际轮廓为准，不能利用旧Depth裁掉差异来伪装模型一致。

两张都保留屋面细纹和较密石缝，不宣称已完全达到无细噪声表面。台阶与门廊位于实体地台内，没有新增悬空梯级。全图保持RGB绿底，没有裁切、透明定稿、碰撞/逻辑占格校准或实机效果结论。

燃油与罐头已确认素材不变；未改正式assets、科技、经济、存档、EXE或公共生成脚本。未运行测试或运行时验证，按约定由用户测试。
