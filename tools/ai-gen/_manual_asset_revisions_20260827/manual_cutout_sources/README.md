# 2026-08-27 人工抠图交接

- `house_lv5_corrected_angle_raw_green.png`：房屋 LV5 重新生成的正确等距视角人工源。文件名沿用 `raw_green`，但实测为 1024×1024 32-bit RGBA，四角背景 Alpha=0；保留维多利亚蒸汽住宅身份、完整 2×2 地台和无遮挡轮廓，后续按透明源处理，禁止再次抠绿。
- `house_lv7_regenerated_v2_raw_green.png`：房屋 LV7 重新生成的第二版人工源，用户已在原文件中完成人工透明处理；该 RGBA 是本版主体唯一真源。正式入库只保持 Alpha、修复边缘 RGB、清零透明 RGB 并紧裁，不再抠绿或生成式修改。对应正式派生为 `house_lv7_runtime.png`、`house_lv7_runtime.json` 与四色底边缘检查图 `house_lv7_runtime_edge_preview.png`，并已覆盖 `assets/terrain/house_lv7.png`。
- `wind_power_plant_2x2_body_regenerated_v2_raw_green.png`：风力电站主体重新生成的第二版人工源；使用标准 2×2 等距地台、较短机架和纯绿背景，只含固定轮毂，不含任何叶片。旧 `wind_power_plant_2x2_body_raw_checker.png` 已被用户判定原图有问题，仅保留追溯。现有 `wind_power_plant_rotor.png` 不需要重做。

房屋 LV5 与 LV7 已由用户完成人工处理；LV7 已按新 2×2 地基完成正式贴图、显示尺寸、脚点、visualFootprint、浏览器资源版本和照明派生资产接入。风力电站第二版仍等待用户回传透明 PNG，之后再执行紧裁、显示标定及既有叶轮 overlay 对轴。
