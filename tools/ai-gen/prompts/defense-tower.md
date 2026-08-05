# 防御塔提示词模板（世界-122 防守地图，2026-08-04 新增）

> 目标：防御塔建筑贴图——下方基座 + 上方探出的机械臂（用于挂载武器贴图），
> 写实风格、六档共用同一套视觉语言。

## 风格基准（固定，与 obstacle.md 同源）

```text
game asset building, photorealistic 3D render, dark realistic materials,
flat diffuse ambient lighting, no light source, no shadows, no drop shadow,
centered composition, isolated on plain pure white background, high detail,
no text, no watermark
```

## 视角块

```text
frontal view, straight-on, slight three-quarter perspective, facing the camera,
base sitting flat on the ground, flat bottom edge, no visible top surface,
the whole tower fully visible with generous margin
```

> **2026-08-04 二轮修正**：首版 A 图出现 45° 等距俯视（可见顶面），与游戏内建筑/道具
> （祭坛/仓库/沙袋=正面平视 billboard、平底）不匹配；B 图视角正确但臂尖带枪管。
> 视角块改为与 obstacle.md 同源的"正面平视"措辞，禁止"elevated/isometric/top"词。

## 主体块

```text
a compact defense tower: sturdy dark stone and metal base at the bottom,
and a mechanical robotic arm hanging from the top front, with an empty weapon
mounting rail at the arm tip, a clean empty circular flange socket with no gun,
riveted metal joints, worn paint, modular weapon socket ready to hold a gun
```

> 主体块明确"empty … no gun"；负面词再补枪械类，双保险。

## 负面词（固定共用）

```text
blurry, low quality, watermark, text, signature, gradient background, gray background,
dark background, vignette, frame, border, people, hands, gun, weapon mounted,
multiple towers, duplicate objects, top-down view, UI element,
gun barrel, cannon, rifle, machine gun, pistol, weapon attached, weapon on the arm
```

## 验收

1. GLM-4.6V：塔身 = 基座 + 上方机械臂、臂尖为空置武器挂载点、无枪械本体、无文字水印。
2. 入库：`assets/terrain/obstacle_defense_tower.png`（或 `assets/npc/`），
   DefenseTower.spriteCfg 指向；footOffsetY 按内容底边校准。

## 白模深度迭代记录（2026-08-04 三轮实测）

- 白模几何暗示会被 ControlNet 忠实放大：**裸斜圆柱 = 枪管邀请**（R1 臂上长出步枪管）；
  机械臂必须用"关节球 + 短粗段"表达（R2 起枪械绝迹）。
- 臂尖挂载件：小法兰 + 细段会被读成机械爪（R2）；放大浅环后被读成吊环（R3）——
  空环可接受，要更像法兰需继续调 spec/种子。
- strength 0.7 外轮廓会漂移（R2 塔身梯形化、顶部机房丢失）；**锁外轮廓用 0.8**。
- 三轮均未复发 45° 等距/顶面可见——白模深度对视角是根治级锁定。
- 产物：`scratch\test_tower_depth_01~03.png`；spec：`_blockout_specs/defense_tower.json`。
