# 2026-08-27 人工抠图交接

- `house_lv5_corrected_angle_raw_green.png`：房屋 LV5 重新生成的正确等距视角人工源。文件名沿用 `raw_green`，但实测为 1024×1024 32-bit RGBA，四角背景 Alpha=0；保留维多利亚蒸汽住宅身份、完整 2×2 地台和无遮挡轮廓，后续按透明源处理，禁止再次抠绿。
- `house_lv7_current_runtime_for_manual_cutout.png`：当前运行中的房屋 LV7 RGBA，按用户要求原样交出，不做自动修边。
- `wind_power_plant_2x2_body_raw_checker.png`：重新生成的风力电站 2×2 静态主体原图；只含固定轮毂，不含叶片。现有 `wind_power_plant_rotor.png` 不需要重做。

三张文件均为人工处理源，不是已批准运行资产。用户回传后再执行 Alpha 紧裁、透明 RGB 清零、显示尺寸/脚点标定、风力电站轮毂与既有叶轮 overlay 对轴，并更新正式运行贴图与缩略图。
