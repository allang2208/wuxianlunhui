# 贸易公司02：异形文字招牌

用户：“102 更好。把门口上的招牌换成异形文字。”本轮已说明按02号理解；以02完整原图为唯一编辑源，只替换入口牌面的货箱与箭头，不再按此前01推荐改变货仓入口、补侧窗或调整门廊。

- [交付原图](trading_company_alien_sign_raw.png)：1024² RGB绿底，黑底铜框保留，牌面改为四组虚构异形字形，浅金/象牙色笔画，无发光光晕。
- [原02](../trading_candidates_dev_s12_20260901/trading_company/trading_company_structure_v02_raw.png)、[牌面蒙版](sign-mask.png)、[合成来源](provenance.json)。交付只合入蒙版内的AI结果，牌面外变化为0；修改2423像素，边界`[720,591,789,657]`。没有裁图、抠透明或拉伸建筑；对照与细节预览已在最终归档时清理。
- 单张有界局部实验：项目标准生成入口的`refine`模式，Dev+Depth、建筑v5、12步、denoise0.90、Depth0.75、CFG3.5、Euler/simple，seed133241，显式`--allow-nonstandard`。这不是标准48步精修，`refine`仅为脚本的img2img模式名称。只向既有授权ComfyUI发送本任务原图、Depth、牌面蒙版和提示参数；未清空或抢占队列。
- 完整AI返回图保存在`trading_company/trading_company_refine_v01_raw.png`，实际提示、生成参数与Depth副本同目录；日志已清理。不要把未合成的AI返回图替代交付真源；后续以`trading_company_alien_sign_raw.png`继续。
- `prepare.py`建立牌面蒙版及本地生成清单；`finish.py`将生成牌面合回不可变原02并输出完整对照。准备脚本会重置本批完成状态，仅重建输入时才运行；排版/交付重新派生只需运行`finish.py`。
- 用户明确要求异形文字，覆盖此前无文字标识偏好，仅限这块招牌。原白模和完整Depth只用于锁定局部整体，未重建模型；原02与编辑祖先保留。已查看原图、牌面蒙版、完整生成图及交付细节。

复现生成（已存在的raw会被复用，不盲目重复提交）：

```powershell
& 'E:/无尽轮回/长期备份/2026-7-13-1/ComfyUI/.venv/Scripts/python.exe' -u -B tools/ai-gen/generate-world122-building-candidates.py --manifest tools/ai-gen/_industrial_economy_buildings_20260831/trading_sign_alien_20260901/manifest.json --stage refine --only trading_company --init-image tools/ai-gen/_industrial_economy_buildings_20260831/trading_candidates_dev_s12_20260901/trading_company/trading_company_structure_v02_raw.png --mask-image tools/ai-gen/_industrial_economy_buildings_20260831/trading_sign_alien_20260901/sign-mask.png --mask-channel red --variants 1 --steps 12 --denoise 0.90 --allow-nonstandard --raw-only
& 'E:/无尽轮回/长期备份/2026-7-13-1/ComfyUI/.venv/Scripts/python.exe' -B tools/ai-gen/_industrial_economy_buildings_20260831/trading_sign_alien_20260901/finish.py
```

未修改燃油/罐头定稿、正式assets、科技、经济、占格、碰撞或存档；未进入标准48步、透明收口或游戏接入。未运行测试或运行时验证，按约定由用户测试；未构建、同步EXE、提交或推送。
