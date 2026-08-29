# 小鼠铁匠站立待机母图候选 v01

## 生成方式

- 工具：Codex 内置 `imagegen` 图像编辑
- 用途：未来站立待机动画的透明母图；当前不接入运行时
- 主编辑参考：`assets/npc/mouse_blacksmith/portrait.png`
- 身份辅助参考：`assets/npc/mouse_blacksmith/idle.png`
- RGB 直接编辑源：`mouse-blacksmith-standing-master-v01-rgb.png`
- 透明候选：`mouse-blacksmith-standing-master-candidate-v01.png`
- 透明处理：内置编辑两次输出均为烘焙棋盘格 RGB；最终使用本目录隔离的 `strip-checkerboard-alpha-fill-holes.py --fill-subject-holes` 生成真 Alpha，避免银色护甲、白衬衫和高光产生内部孔洞；未修改或依赖工作区共享脚本。

## 最终提示词

```text
Use case: identity-preserve precise-object-edit
Asset type: transparent full-body master character image for a future 2D game NPC idle animation
Input images: Image 1 is the primary edit target and authoritative identity/outfit reference; Image 2 is a supporting reference for the existing in-world mouse blacksmith identity, armor, apron, hair, ears, and tail.
Primary request: isolate the existing female mouse blacksmith character and reconstruct a complete natural standing idle master image. Remove the raised hammer, anvil, glowing ingot, sparks, logs, stones, stump, platform, and every environmental object. Reconstruct all occluded anatomy, both empty hands, both legs, and both boots cleanly and naturally.
Subject invariants: preserve the same recognizable face, amber-orange eyes, short gray-brown hair, gray mouse ears, long mouse tail, silver-gray plate armor, white undershirt, brown leather blacksmith apron, red-brown leather accents, belt, and small blacksmith tools at the waist. Preserve her friendly confident personality and adult proportions. Do not redesign or simplify her outfit.
Pose: relaxed neutral standing idle pose, full body visible from ears to boot soles, arms naturally resting at the sides or one hand lightly near the belt, empty hands, balanced weight, suitable for subtle breathing/blinking/tail idle animation later.
Viewpoint: horizontal front-facing billboard character style consistent with existing NPCs and monsters; mostly frontal with only a mild natural three-quarter turn, never top-down and never isometric.
Composition: one character only, vertically centered, generous transparent safety margin around ears, tail, hands, and boots; feet aligned on one clean horizontal foot line.
Style: preserve the polished anime-inspired game illustration rendering, materials, line quality, facial identity, armor wear, and color palette of Image 1.
Background: genuinely transparent alpha background, no white backdrop, no checkerboard.
Constraints: change only the pose and removal/reconstruction described above; keep character identity and costume unchanged. No hammer in hands, no weapon, no anvil, no forge, no fire, no sparks, no floor, no pedestal, no scenery, no cast shadow, no text, no watermark, no extra limbs, no cropped tail or ears.
```

母图批准前保持 `futurePlanOnly=true`、`runtimeIntegrationActive=false`；不修改 NPC 配置、动画、音效、碰撞或交互。
