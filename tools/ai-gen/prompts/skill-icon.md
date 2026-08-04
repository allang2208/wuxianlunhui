# 技能图标提示词模板（六边形徽章系列，2026-08-04 固化）

## 系列基准（新图标必须对齐，偏差 >5% 重抽或归一）

- 内容框基准（fireball 实测）：**bbox 788×939 / 宽高比 0.84 / 占比 ~70% / 偏下构图 cy≈+29**
- 校验：`python tools/check-icon-sizes.py`（跑 skills.json 全量）；入库 1024×1024 透明底
- 同系列范例：fireball_icon（火球）、blizzard_icon（暴风雪）、陨星坠落.png（陨星）

## 风格基准（img2img 模板锁定用；固化不可随意改动）

```text
game skill icon emblem, keep the exact same hexagonal badge template, size, position
and layout as the reference image: a single clean purple hexagonal badge with embossed
purple surface and uniform gold trim (no crystal base, no protrusions below the hexagon),
the center shows <主题>, centered, game asset art, high detail, crisp,
isolated on a plain pure white background
```

> 2026-08-04 v2 固化：系列形态统一为**火球式干净六边形徽章 + 紫色浮雕 + 均匀金边**，
> 明确移除 "embossed translucent crystal block base"（旧模板导致 LoRA 输出底座时有时无）。
> LoRA 触发词：`wuxianlunhui magic skill icon`（klein-skillicon-v2）。

## 负面词（ComfyUI 用 --negative；智谱并入正向）

```text
<同类旧主体>, text, watermark, signature, blurry, low quality, deformed,
extra frame, dark background, gradient background, gray background, vignette
```

示例（陨星）：`fireball, floating fire orb, ice, snow, blizzard, frost, blue crystal,
gemstone, text, watermark, signature, blurry, low quality, deformed, extra frame, dark background`

## 主题块范例（填空位：`<主题>`）

陨星坠落（二版定稿，正面示例）：

```text
the center shows a massive dark volcanic meteor rock falling diagonally, charred black
stone with glowing orange lava cracks, long fiery tail and ember sparks trailing behind,
clearly a falling meteorite not a fireball
```

暴风雪（中心替代示例）：`swirling blizzard snowstorm in the center of the hexagonal emblem,
spiral vortex of white snowflakes and icy blue wind, frost mist and small ice shards,
glowing icy blue highlights`

## 参数与流程

- 参考图：用**同色系**现有图标（火球做火系参考；换色系参考会回染，如暴风雪蓝→冰锥必蓝）。
- 参考图处理：先压白底再上传；候选批量：4 档 denoise × 多 seed。
- 出主体 → 若底座/边框丢失，对中央区域 inpaint 补回（mask 存 RGBA，alpha=255 为重绘区）。
- 抠图：`tools/make-transparent-icon.py`；入库后跑 check-icon-sizes 复核。

## 深度图锁徽章视角（2026-08-04 新增，推荐）

- 六边形徽章系列最容易"每次视角/大小漂移"；用 `--model flux2-dev-depth` +
  `--control-image` 传**已定稿同系列图标（fireball）的深度图**，主题块照常换，
  徽章模板/视角/底座位置由深度图锁死，内容框偏差显著减小。
- 强度 0.6~0.8（默认 0.75）；锁太死主体换不动就降到 0.6。
- 辅助：提示词 camera 块（BFL JSON）写 `"angle": "straight-on front", "distance": "medium shot"`。

## 坑（防再犯）

- FLUX.2 直出窄徽章（750×951）观感偏小 → 必须模板锁定 img2img + 内容框校验（陨星教训）。
- 换系列主体时用异系参考会被色相回染（冰蓝参考→永远蓝晶体）；用同色系参考。
- 低 denoise 保框架不换主体、高 denoise 换主体丢底座 → 两段式（先主体后 inpaint 底座）。
- 白底遵循不稳：背景色以角点像素均值判定，不要信 GLM 描述。
