# 仓库等级扩建图标

- 生成方式：Codex 内置 `image_gen`
- 用途：仓库详细面板“仓库等级扩建”卡片
- 正式文件：`assets/ui/building-upgrades/warehouse-level-expansion.png`

## 最终生成提示词

Use case: stylized-concept
Asset type: game UI upgrade icon for the World-122 warehouse detail panel
Primary request: create a new icon representing WAREHOUSE LEVEL EXPANSION, not storage compression and not a generic cargo crate.
Input images: Image 1 is the exact cold-steel four-rivet square frame and rendering-style reference; Image 2 is the warehouse building identity reference; Image 3 is the visual-language reference for showing a building being expanded/upgraded.
Subject: a compact medieval half-timber warehouse with gray stone ground floor, warm worn wood beams, pale plaster walls, slate roof, loading arch and a few restrained stacked cargo crates; show the upper structure growing upward with a subtle cyan architectural blueprint outline and one upward upgrade arrow integrated behind the roof.
Style/medium: polished painted game UI icon, realistic game-optimized PBR materials, crisp cold-steel archive style, matching the existing World-122 building-upgrade icon family.
Composition/framing: square 1:1; exact four-rivet dark steel frame; centered warehouse fills the circular inset with generous edge safety; strong readable silhouette at 64px.
Lighting/mood: soft upper-left light, cool steel frame, warm amber warehouse windows, restrained cyan upgrade glow.
Color palette: desaturated blue-gray steel, weathered gray stone, worn brown wood, slate gray roof, small oxidized brass accents.
Constraints: genuinely transparent outside the outer steel frame; no text, no numbers, no letters, no watermark, no logo; one building only; preserve a complete uncut frame; do not copy the crate-only subject from Image 1; do not depict a house/residence; do not add characters; avoid excessive magical effects, neon saturation, black square background, or objects protruding outside the frame.

## 后处理说明

内置生成结果的框外区域为实黑 RGB，因此正式入库时复用项目既有医院图标的“仅删除边界连通黑色画布”算法生成真实 Alpha；框内深色凹槽保持不透明。最终图标归一化到 256×256，外框可见范围 244px。
