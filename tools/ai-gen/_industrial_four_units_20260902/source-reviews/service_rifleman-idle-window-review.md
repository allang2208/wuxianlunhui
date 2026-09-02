# 制式步枪兵待机窗口审查

- 活动源片：`tools/ai-gen/_industrial_shooting_mothers_20260831/animations/service_rifleman/videos/idle-h3-v01.mp4`。
- 全片方向、身份和相机稳定，但早段仍出现一次不应属于待机的举枪/枪焰，因此不采用f0—f95。
- 正式候选窗口：f96、99、102、105、108、111、114、117、120、123。该段保持三分之四右向、双脚着地、低位持枪、无枪焰/烟雾/尾巴/身份漂移；f123回到参考姿势，允许只在该窗口末尾到f96做一次循环补间。
- 审查图：`service_rifleman-idle-approved-window-f96-f123.png`。未选区间不得进入BiRefNet、RIFE或正式图集。
