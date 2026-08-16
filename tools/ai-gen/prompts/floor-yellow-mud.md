# 黄色稀疏草地泥地砖提示词模板（2026-08-16，世界-122 地块贴图）

> 目标：与世界-122 当前 `swampbrick-new1` 同规格的地砖变体（黄色泥地 + 稀疏草）。
> 规格：白底 45° 菱形单砖 → 泛洪抠图 → 腐蚀 2px → 纵向压扁 0.571 → 30° 等距
> 菱形（510×294，与 swampbrick-new1 同宽可同池混铺）。

## 风格基准（固定共用，与 demon-floor.md 同源）

```text
game asset prop, photorealistic 3D render, dark realistic materials,
flat diffuse ambient lighting, no light source, no shadows, no drop shadow,
centered composition, isolated on plain pure white background, high detail,
no text, no watermark
```

## 主体块（黄色泥地单砖）

```text
(exactly one diamond-shaped ground tile:1.5), single large 45-degree diamond
rhombus slab in the center of the canvas, dry yellow mud ground slab, packed
ochre and tan earth texture, sparse grass viewed directly from above, top-down
radial grass clumps and small moss patches lying flat on the mud, grass has no
up direction, mirror-invariant symmetric pattern, every grass clump is
symmetric and radially arranged, grass covers about one tenth of the surface,
sparse grass, a few tiny dirt clods and small pebbles, flat pure texture, no
bevel, no raised slab, no edge thickness, no rim, no border ring, texture
continues evenly to the diamond edge
```

## 负面词（ComfyUI --negative）

```text
blurry, low quality, watermark, text, signature, gradient background, dark
background, vignette, frame, border, people, hands, multiple tiles, dense
grass, green grass lawn, top-down view, floor texture pattern, shadows
```
