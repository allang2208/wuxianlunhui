# 冰封世界初级地牢冰墙材质提示词（2026-08-22）

用途：只生成可平铺的冰块砌体材质；墙体轮廓、30° 视角、底边和拼接几何继续由
`_blockout_specs/demon_wall_b.json` 与 `render-cover-real.py` 控制。

```text
Create a production-ready seamless square material texture for a dark fantasy
isometric game wall. This is MATERIAL ONLY, not a wall object and not a scene.
Orthographic flat frontal texture swatch of large rectangular blocks made from
ancient translucent glacial ice, arranged in clean staggered masonry courses.
Pale cyan, blue-white, and slightly deeper steel-blue ice; visible trapped
bubbles, frosted edges, internal cracks, subtle cloudy depth, chipped weathered
block faces. Strong enough color and value separation between individual ice
blocks to remain readable over a white snow floor. Photorealistic PBR-quality
surface detail, evenly distributed, tileable on all four edges. Flat diffuse
neutral illumination baked as little as possible. No cast shadows, no
directional highlights, no perspective, no top face, no floor, no background,
no frame, no object silhouette, no snow piles, no icicles protruding outside
the texture, no text, no watermark.
```

生成材质保存为：
`tools/ai-gen/_frozen_dungeon_20260822/ice_block_material.png`。

Blender 渲染：

```powershell
& 'E:\Program Files\Blender Foundation\Blender 5.1\blender.exe' `
  --background --factory-startup `
  --python 'tools/ai-gen/render-cover-real.py' -- `
  'tools/ai-gen/_blockout_specs/demon_wall_b.json' `
  'tools/ai-gen/_frozen_dungeon_20260822/ice_block_material.png' `
  'tools/ai-gen/_frozen_dungeon_20260822/ice_wall_raw.png'

python tools/prep-frozen-wall.py
```
