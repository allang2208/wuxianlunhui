# 装备/首饰图标提示词模板（2026-08-04 固化）

## 入库规格（先读，生图就按此构图）

- 入库 1536×1536 透明底；**最长边占画布 0.90、纵横比 ∈[0.72,1.4]、包围盒居中**
- 提示词必须写"主体完全在画面内、四周留白"，否则细长物品（腰带等）出界被裁（不息腰带两连坑）
- 抠图：BiRefNet 优先（`tools/ai-gen/birefnet-cutout.py` / `tools/ai-gen/birefnet-icon-pipeline.py`），
  不用颜色阈值（浅灰渐变底 + 贴边主体会抠残）
- 复核：`tools/ai-gen/verify-eclipse-icons.py`（1536²/0.90/[0.72,1.4]/居中）+ `tools/ai-gen/edge-check-eclipse.py`
  （边缘白色占比 0%，>0.5% 重抠）

## 风格基准（style_prefix，所有装备固定共用；固化不可随意改动）

```text
game equipment icon, realistic dark fantasy RPG item icon, centered single item occupying
most of frame, pure white background, no text, no watermark, no human, high detail,
dramatic rim lighting
```

细长件（腰带/项链）追加：`centered single item with generous white margin around it,
no hands`。

## 负面词（固定共用；注意不要用裸词 ring，会误伤戒指类）

```text
blurry, low quality, watermark, text, signature, frame, border, UI element,
multiple subjects, human, character, hands, cluttered background,
circular halo, circular frame, circular emblem, circular ornament, floating circle,
glowing circle behind object, ring-shaped decoration around the object,
ornamental circle, magic circle, multiple views, turnaround, design sheet,
blueprint, multiple hats, multiple boots, duplicate items, clothing rack, mannequin
```

## 构图硬性规则（2026-08-03 定稿，提示词必须遵守）

1. **靴子/鞋类只生成一只、朝右**：
   `a single right-facing <材质> boot, one boot only facing right, no pair, no second boot`；
   SDXL 常无视朝右 → 出图后 GLM-4.6V 问"鞋头指向左还是右"，朝左用 `tools/ai-gen/flip-boots-right.py` 镜像。
2. **盔甲类写全下半身**：只写 "chest piece" 会出残件，必须写
   `full torso armor from shoulders down to hips, breastplate with abdominal plates,
   waist belt and faulds (segmented skirt armor), tassets over the hips, layered pauldrons`，
   验收时让 GLM 确认"是否有下半身/裙甲"。
3. **禁止多余圆形装饰**：negative 固定带圆形光环/徽章/漂浮圆环组（见上），蚀月套曾反复出现。
4. **单件强制语法**（易出多视图的类目，权重必带）：
   `(exactly one hat:1.5), (one hat only:1.5), (single straight front view:1.4),
   (isolated single object:1.3)`；法袍加 `(exactly one robe:1.5), (a single mage robe
   only:1.5), flat frontal view, symmetric layout, (one garment only, no lineup, no
   multiple outfits:1.5)`。

## 部位专项范例

| 部位 | 主题块要点 |
|---|---|
| 头盔 | 材质 + 主题装饰（如云纹/月相刺绣/山脊刻纹）+ 羽饰/尖顶按设定 |
| 胸甲/法袍 | 见规则 2/4；法袍直正面对称、高领、下摆与袖口装饰 |
| 靴子 | 见规则 1；单只朝右 + 材质 + 装饰（月相扣/山脊刻纹） |
| 项链 | `a complete ornate amulet necklace, fine silver chain with both sides visible curving up from the pendant, <坠子设定>, (not heart shaped:1.4), (no circular frame around the pendant:1.5), sturdy noble fantasy necklace, full necklace shape, completely inside the frame with generous margins` |
| 戒指 | `dark silver ring, blackened band with a small glowing <宝石色> star gem, <主题> motif, ornate fantasy ring, macro jewelry shot` |
| 腰带 | `a dark leather belt coiled into a neat circle, the long strap clearly visible with punched holes, <扣子设定> at the front center, coiled belt shape fully inside the frame with generous white margins on all sides` |

## 实战范例（蚀月法帽，二版定稿）

```text
(exactly one hat:1.5), (a single European pointed wizard hat icon:1.5),
dark midnight blue velvet with rich realistic fabric texture and folds,
tall conical pointed tip with a slight bend, wide brim,
(small silver moon-phase embroidery and tiny star runes near the brim only:1.2),
(no large emblem, no diamond, no triangle, no crest on the hat body:1.5),
(single straight front view:1.4), (one hat only:1.5), (isolated single object:1.3),
realistic detailed painting, rich shading, centered on pure white background,
game equipment icon
```

## 深度图锁视角/方向（2026-08-04 新增，推荐）

- 装备件（盔甲/法袍/靴子）易出"正侧视角漂移、多视图"；用 `--model flux2-dev-depth` +
  `--control-image` 传**同系列已定稿件的深度图**（或手绘摆好的剪影深度），
  把正面/朝右/构图锁死，主题材质照常换。
- 靴子仍保留文字 `a single right-facing boot, one boot only` 作第二道保险 +
  出图后 `tools/ai-gen/flip-boots-right.py` 兜底镜像。
- 强度 0.6~0.8；装饰细节（刺绣/刻纹）靠主题块给足材质词，防深度控制下变简笔画。

## 坑（防再犯）

- 去徽章写 `no large emblem, no diamond, no triangle, no crest` 并保留写实质感词，
  写 `plain blank surface` 会得到简笔画帽子（蚀月法帽两连坑）。
- 全右下象限 bbox 找水印会把戒指底部误当水印覆盖出缺口 → 按连通域+面积过滤（智谱水印）。
- 细长件横穿出界被裁 → 提示"盘绕成圈/完整居中/四周留白"（不息腰带）。
