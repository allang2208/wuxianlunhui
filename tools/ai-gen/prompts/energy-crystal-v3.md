# 能源水晶簇 v3 提示词模板（世界-122，2026-08-16）

> 目标：替换 v1/v2「统一簇形、平底 billboard」的粗糙水晶。要求**12 种可辨识形态**，
> 不再统一格式；每颗节点的底座必须带 30° 接地线，与掩体/墙地板衔接同一套视觉规则。
> 生成入口：`tools/ai-gen/gen-energy-node-v3.py`（自动画 12 张深度控制图 →
> `flux2-klein-4b-depth --transparent` 出图 → 抠图 → 可选安装到 `assets/terrain/`）。

## 0. 参考图搜索约定

联网搜索优先用 `crystal cluster / raw azure crystal formation / blue crystal shards game asset`，
筛选条件：单簇、多棱面、蓝青色调、底部有土石接触、无角色/场景背景。无法联网时使用以下本地
已定稿参照（必须与这些保持一致的是**材质与棱面语言**，不是复制其轮廓）：

- `assets/icons/craft/frozen_crystal.png` — 蓝晶棱面/高光基准；
- `assets/icons/craft/jade_spirit_crystal.png` — 晶体透光与内部裂线基准；
- `Y:\工作\无尽轮回\scratch\energy-node-v2\tex_crystal_c1.png` / `c2` / `c3` — 上一版 AI 晶体材质；
- `assets/terrain/obstacle_cover_*_h.png` / `_v.png` — **接地线参考**：底边与地板夹角 30°、
  底部有少量土石过渡，不允许平底直切。

## 1. 风格基准（固定共用，与 obstacle.md / cover.md 同源）

```text
game asset prop, photorealistic 3D render, dark realistic materials,
flat diffuse ambient lighting, no light source, no cast shadow on background,
isolated on plain pure solid color background, high detail, no text, no watermark
```

## 2. 视角与接地（v3 唯一强制视角）

```text
front-facing game sprite, low camera angle around 8 to 15 degrees, the crystal cluster
grows from a low dark soil mound, the mound base contacts the ground with a shallow
isometric diamond footprint, the left and right bottom edges of the mound are straight
lines tilted exactly 30 degrees to the horizontal and meet at the front center point,
contact shadow baked only into the mound base, transparent background outside the sprite
```

## 3. 主题词库（每张只用一个形态，禁止统一格式）

| # | 形态 key | 主题块 |
|---|---|---|
| 1 | single_spire | `one single tall blue crystal spire with two tiny shards at its base` |
| 2 | twin_spires | `two tall blue crystal spires crossing each other, one leans left and one leans right` |
| 3 | triple_crown | `three large blue crystals in a crown arrangement, center taller than both sides` |
| 4 | dense_cluster | `a dense cluster of nine blue crystal shards packed tightly together with varied heights` |
| 5 | fan_cluster | `seven thin blue crystal blades fanning out from one base, center blade tallest` |
| 6 | needle_spire | `one extremely tall narrow needle-like blue crystal with four tiny base shards` |
| 7 | broken_shard | `one large broken blue crystal with a snapped top and scattered small shards around its base` |
| 8 | ring_cluster | `a ring of nine small blue crystals around a dark hollow center` |
| 9 | crystal_crest | `a long low crest of blue crystals like a crystal spine, six main shards with center highest` |
| 10 | leaning_spire | `one tall blue crystal leaning strongly to the right with short supporting shards on the left` |
| 11 | split_geode | `two half-geode blue crystal bodies split apart with inner facets facing each other` |
| 12 | wild_growth | `a wild growth of thirteen irregular blue crystals pointing in many directions with no symmetry` |

## 4. 材质细节块（形态词之后固定追加）

```text
faceted azure and cyan crystal planes, sharp facet edges, bright specular highlights
on facet ridges, inner light refraction and translucency, glowing deep blue core,
fine crystalline fracture lines, tiny blue crystal chips embedded in the soil mound
```

## 5. 枯竭态

同形态复用同一张深度控制图；只把主题前缀替换为：

```text
depleted gray crystal cluster, drained of energy, dark matte gray-blue facets,
cracked dull surfaces, no glow, no inner light, dead soil mound
```

## 6. 拼接（顺序固定）

```text
<主题块> + <材质细节块> + <视角与接地> + <风格基准>
```

FLUX.2 不支持负面词，避项全部写进正向末尾：

```text
no flat cut bottom, no horizontal bottom edge, no floating crystals, no background props,
no multiple separate clusters, no symmetric copy-paste layout, no cartoon style, no cell shading
```

## 7. 验收

1. GLM-4.6V 单张提问：形态是否符合指定 key；底部是否为 30° 菱形土堆接地而非平底直切。
2. 像素统计：`tools/ai-gen/check-components.py` alpha>60 连通域 == 1；透明角无灰底。
3. 底边几何：`python tools/ai-gen/audit-perspective.py assets/terrain/energy_node_v3_*.png --ref-angle 30`
   （或人工取底边两端斜率），|斜率| ≈ 0.577。
4. 12 张并排肉眼检查，不允许任何两张是“同一簇的平移/缩放/换色”。
5. 入库：`assets/terrain/energy_node_v3_<n>.png` + `energy_node_depleted_v3_<n>.png`
   （n=1..12）；BootScene 已按此命名加载。调度器会在 `--transparent` 抠图后按 alpha
   紧身裁切（与 v2 入库口径一致），因此最终文件宽高比随形态变化，属正常。
