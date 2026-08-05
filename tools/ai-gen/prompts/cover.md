# 掩体提示词模板（世界-122 防守地图，2026-08-04 新增）

> 目标：F→A 六档可被攻击的掩体（低矮防御墙段），水平摆/垂直摆两组贴图。
> 视觉基准 = 游戏中墙体/地板的 30° 地板线：**底部边缘带 30° 斜角**（对齐
> `swamp_wall_straight` / `wall_straight` 的底边形态），与障碍物平底 billboard 区分。

## 风格基准（固定共用，与 obstacle.md 同源）

```text
game asset prop, photorealistic 3D render, dark realistic materials,
flat diffuse ambient lighting, no light source, no shadows, no drop shadow,
centered composition, isolated on plain pure white background, high detail,
no text, no watermark
```

## 视角块（两组方向，必选其一）

- 水平摆（"\" 向，贴图底边左上→右下 30°）：
  ```text
  low defensive cover wall, game isometric asset, the cover stands on a floor line
  tilted 30 degrees, long axis running from upper-left to lower-right,
  bottom edge aligned at exactly 30 degrees to the horizontal (slope down to the right),
  front face visible, top surface slightly visible and foreshortened
  ```
- 垂直摆（"/" 向，贴图底边右上→左下 30°）：
  ```text
  low defensive cover wall, game isometric asset, the cover stands on a floor line
  tilted 30 degrees, long axis running from upper-right to lower-left,
  bottom edge aligned at exactly 30 degrees to the horizontal (slope down to the left),
  front face visible, top surface slightly visible and foreshortened
  ```

## 负面词（固定共用）

```text
blurry, low quality, watermark, text, signature, gradient background, gray background,
dark background, vignette, frame, border, people, hands, grass, floor texture,
shadows on walls, multiple covers, lineup, duplicate objects, top-down view
```

## 主题词（按档位替换；材质逐档递进）

| 档位 | 主题块 |
|---|---|
| F | `simple wooden plank cover wall, reinforced timber planks with wooden braces, weathered pale wood` |
| E | `sandbag and timber cover wall, stacked sand-filled canvas sandbags with a wooden frame` |
| D | `stone rubble cover wall, stacked rough stones and boulders, mossy joints` |
| C | `masonry brick and concrete cover wall, reinforced fortification blocks with steel corner plates` |
| B | `steel armored cover wall, dark riveted metal armor plates with a horizontal firing slit` |
| A | `dark runed metal cover wall, black steel plates with faint glowing energy runes, advanced magical fortification` |

## 拼接（顺序固定）

```text
<主题块> + <视角块（水平/垂直）> + <风格基准>  →  ComfyUI --negative <负面词>
```

## 验收

1. GLM-4.6V：主体为"低矮掩体墙段"、底边 30° 斜角方向与要求一致（水平="\"、垂直="/"）、
   无文字水印、单件不重影。
2. 像素统计：`tools/ai-gen/prep-obstacle.py` 抠图后灰边残留 <5%、连通域=1。
3. 入库：`assets/terrain/obstacle_cover_<grade>_h.png` / `_v.png`（水平/垂直两组）
   + `ISO_WALL_GEO` 注册（foot/obstacleH）+ 生命值配置（无防御/魔防）。

## 生命值配置（def/mdef 均为 0，怪物可攻击）

```json
{ "F": 400, "E": 700, "D": 1100, "C": 1600, "B": 2200, "A": 3000 }
```

## 方向规则（2026-08-05 实测固化）

FLUX.2（dev/klein）**无法区分"水平摆/垂直摆"提示词**：无论怎么写方向，raw 一律产出
"/" 向（底边 slope down to the left）。独立生成 h/v 两张必撞方向（B/D 掩体即因此报废）。

**一图两向（唯一正确做法）**：

- 每个等级只生成一张 raw（"/" 向）；
- `_h` = raw 水平镜像（"\" 向，底边 slope down to the right，与 wall_straight 一致）；
- `_v` = raw 原样（"/" 向）；
- 禁止为 h/v 分别生成两张方向图；新纹理优先 img2img 锚点派生。
- 镜像/生成后必须跑 `audit-perspective.py`，确认 pair=MIRROR 才入库。
