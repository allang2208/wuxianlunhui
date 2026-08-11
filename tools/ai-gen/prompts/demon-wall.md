# 恶魔洞窟岩壁提示词模板（2026-08-11，矿洞主题）

> 目标：C 级地牢「恶魔洞窟」直墙贴图（demon_wall_straight）——不规则岩石峭壁。
> 视觉基准 = 游戏中墙体/地板的 30° 地板线：底部边缘带 30° 斜角（对齐
> `wall_straight` / `swamp_wall_straight` 底边形态）。深度图锁大形（白模墙段 +
> 不规则顶部），材质/风格由提示词驱动。

## 风格基准（固定共用，与 cover.md / obstacle.md 同源）

```text
game asset prop, photorealistic 3D render, dark realistic materials,
flat diffuse ambient lighting, no light source, no shadows, no drop shadow,
centered composition, isolated on plain pure white background, high detail,
no text, no watermark
```

## 主体块（恶魔洞窟·不规则岩壁）

```text
dungeon mine cavern wall segment, game isometric asset, irregular rugged
rock cliff wall face, jagged stone outcrops and natural rock strata at the
top, embedded glowing ore veins and rough crystals, weathered cracked dark
stone surface, the wall stands on a floor line tilted 30 degrees, long axis
running from upper-left to lower-right, bottom edge aligned at exactly
30 degrees to the horizontal (slope down to the right), front face visible,
top surface slightly visible and foreshortened, dark mine atmosphere
```

## 负面词（固定共用）

```text
blurry, low quality, watermark, text, signature, gradient background, gray
background, dark background, vignette, frame, border, people, hands, grass,
floor texture, shadows on walls, multiple walls, duplicate objects,
top-down view, bricks, masonry
```
