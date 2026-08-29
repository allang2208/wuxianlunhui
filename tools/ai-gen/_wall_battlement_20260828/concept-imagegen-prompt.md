# ImageGen 概念参考记录

- 模式：Codex 内置 `image_gen`。
- 用途：只验证高/低两段与现有砂岩墙材质的外观方向，不作为运行时贴图。
- 输入参考：`assets/terrain/obstacle_block_sand.png`。
- 生成结果：早期需求被错误理解为墙顶方形附件，因此该概念和对应 Prompt 已废弃；当前正式方向是 `64 × 64` 正方形、从地面完整立起并贴在主城墙外沿的高女墙单元，最终几何由 Blender 参数模型建立。

## Prompt

```text
Use case: stylized-concept
Asset type: structural reference sheet for a 2.5D isometric RTS wall battlement game asset
Primary request: derive two separate wall-top crenellation obstacle modules from the reference sandstone wall material: one high merlon and one low merlon. When placed immediately adjacent in alternating high-low order, the lower segment creates a clear firing notch between high segments.
Input images: Image 1 is the exact material, lighting, isometric camera, and masonry scale reference.
Scene/backdrop: genuinely transparent background, no ground plane, no scenery.
Subject: two isolated masonry battlement modules displayed side by side; each has a square footprint exactly half the width and half the depth of the referenced full wall block, so its footprint area is one quarter of a grid cell. Both are wall-top cap obstacles rather than full-height wall columns. The high module is visibly taller; the low module is roughly half the high module's added height and forms the shoot-over notch.
Style/medium: clean PBR Blender-style orthographic isometric render matching the reference.
Constraints: true transparent alpha; exact simple block geometry; solid non-walkable top surfaces; no stairs, doors, arches, soldiers, weapons, flags, terrain, bases, plinths, text, UI or watermark.
```
