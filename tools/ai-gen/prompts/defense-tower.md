# 防御塔提示词模板（世界-122 防守地图，2026-08-04 新增；2026-08-06 v2 重制）

> 目标：防御塔建筑贴图 v2——圆柱基座 + 顶部单独突出的机械臂（用于挂载武器贴图）；
> 视角对齐游戏地面/墙壁（30° 等距、可见圆柱椭圆顶面）；写实暗黑风格。

## 风格基准（固定，与 obstacle.md 同源）

```text
game asset building, photorealistic 3D render, dark realistic materials,
flat diffuse ambient lighting, no light source, no shadows, no drop shadow,
centered composition, isolated on plain pure white background, high detail,
no text, no watermark
```

## 视角块

```text
isometric view matching the game floor perspective, three-quarter view,
visible elliptical top surface of the cylinder, base sitting flat on the ground
```

> **2026-08-06 v2 定稿（覆盖 08-04 billboard 版本）**：用户指定"参考地面、墙壁的
> 视角/风格 + 下方基座做圆柱体 + 机械臂单独上方突出"，视角块改用 30° 等距
> （与墙壁一致、可见圆柱椭圆顶面）；08-04 的"正面平视、no visible top"版本
> 仅作历史参考。白模深度对视角是根治级锁定，必须走 Blender 白模。

## 主体块

```text
main subject: a compact defense tower, a sturdy dark stone and metal cylindrical
base at the bottom, weathered charcoal stone and riveted dark metal panels
matching the game wall texture style, and a heavy industrial robotic arm
protruding straight up from the top of the tower, built like a real robot arm:
a bulky shoulder joint housing, a thick upper arm segment with a hydraulic
piston cylinder alongside, a large elbow joint housing, a forearm segment, and
at the arm tip a wide empty circular mounting flange socket with visible bolts
and rivets, no gun, weathered dark metal with rust and scratches, worn paint,
a modular weapon socket ready to hold a gun
```

> 主体块明确"empty … no gun"；负面词再补枪械类，双保险。

## 负面词（固定共用）

```text
blurry, low quality, watermark, text, signature, gradient background, gray background,
dark background, vignette, frame, border, people, hands, gun, weapon mounted,
multiple towers, duplicate objects, top-down view, UI element,
gun barrel, cannon, rifle, machine gun, pistol, weapon attached, weapon on the arm
```

## 管线（2026-08-06 v2 实测）

1. 白模 spec：`_blockout_specs/defense_tower_v2.json`（底部圆环+圆柱基座+顶部安装盘+
   机械臂 shoulder/upper arm/elbow/forearm/末端法兰，elevation 30）。
2. 深度：`blender-depth-render.py` → `_depth_templates/blender_defense_tower_v2_h.png`。
3. 出图：`comfyui-gen.py --model flux2-klein-4b-depth --control-image <深度图> --strength 0.8`。
4. 抠图：`make-transparent-icon.py`（白底→透明）。
5. 拆臂：`cut-defense-tower-arm-v2.py`（机械臂=顶部 y78~388，基座=安装盘+圆柱，
   输出 obstacle_defense_tower_arm.png / obstacle_defense_tower.png，并打印几何）。
