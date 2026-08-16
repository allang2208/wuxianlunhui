# 障碍物提示词模板（2026-08-03 固化，统一于 obstacle-prompt-strategy.md）

> 目标：新障碍物（沙袋掩体、木制拒马等）与项目现有障碍物（木桶/陶罐/骨头/铁链/火把/
> 木材堆/石柱）风格统一、彼此统一。依据：GLM-4.6V 对现有道具的风格审计。

## 风格基准（所有障碍物提示词固定共用；固化不可随意改动）

```text
game asset prop, photorealistic 3D render, dark realistic materials,
flat diffuse ambient lighting, no light source, no shadows, no drop shadow,
centered composition, isolated on plain pure white background, high detail,
no text, no watermark
```

要点：写实 3D 渲染（非卡通/像素风）；材质"暗色真实质感"（木/石/帆布/金属）；
无光源、无阴影（flat diffuse ambient lighting；禁止 studio/directional/rim light、drop/cast shadow）；主体居中、占画面 60~75%、四周留白；背景纯白
（角点像素均值判定，浅灰渐变也算不合格）。

## 视角块（单独一行，按用户要求替换；新道具之间必须同一视角）

- 默认正面：`frontal view, straight-on, slight three-quarter perspective, facing the camera`
- 若需等距：`2:1 diamond isometric view, elevated camera, top surfaces visible and foreshortened`

> **2026-08-04 增强**：视角块之外，推荐用 FLUX.2 dev Depth ControlNet
> （`--model flux2-dev-depth --control-image <深度图>`）把视角/构图物理锁死——
> 同视角的已定稿道具深度图或手绘剪影深度即可；文字视角块保留作第二道保险。

## 负面词（固定共用）

```text
blurry, low quality, watermark, text, signature, gradient background, gray background,
dark background, vignette, frame, border, people, hands, grass, floor, shadows on walls,
drop shadow, cast shadow, hard lighting, directional light, rim light, studio lighting
```

（等距时追加 `front view, straight-on view`；正面时追加 `isometric view, top-down view`）

## 主题词模板

结构：`主题 + 材质细节 + 视角块 + 风格基准 + 负面词`。

### 军用沙袋掩体（正面）

```text
military sandbag fortification, a low defensive wall built from several layers of
stacked sand-filled canvas sandbags, bulging bags with visible stitching and tied tops,
khaki and olive sand colors, <视角块>, <风格基准>
```

### 木制拒马（正面）

```text
wooden barricade made of crossed logs with sharpened pointed tips, medieval defense barrier,
weathered dark brown wood with bark and grain, <视角块>, <风格基准>
```

### 树木（2026-08-05 白模深度固化，推荐流程）

树木是有机形态，提示词锁不住结构，**必须从 Blender 白模深度起步**
（`tools/ai-gen/blender-depth-render.py` + `_blockout_specs/tree_{round,pine,dead}.json`）：

- 白模配方：阔叶树 = 1 树干圆柱 + 4~5 球树冠团；松树 = 1 树干 + 3 叠锥；
  枯树 = 主干 + 3~4 倾斜圆柱枝（非对称朝向可被真实 3D 深度锁定，见 SKILL 朝向节）。
- **树枝定位必须按 rot 方向向量反算中心点**（枝下端要伸进主干内 ≥0.3 单位），
  凭感觉摆必悬空（首版三枝全浮空教训）。
- 模型会按球团自己补枝叶细节，白模只管大形/朝向/比例，不用堆图元。

阔叶树（正面，实测入库级）：

```text
a mature broadleaf tree, one dense rounded lush green canopy made of clustered foliage
masses, thick sturdy trunk with rough dark brown bark, <视角块>, <风格基准>
```

枯树（正面，朝向锁定实测通过）：

```text
a leafless dead tree, gnarled twisted bare branches reaching upward, weathered dark
gray-brown wood, cracked rough bark, broken branch stumps, the main branch leans to the
upper right, <视角块>, <风格基准>
```

> 产物：`scratch\test_tree_round_01.png` / `test_tree_dead_01.png`；strength 0.75。
> （2026-08-16：世界-122 树木已全部移除，阔叶树五变体条目删除；沙漠障碍物改走
> 仙人掌管线——process-desert-plant.py 直出 + 实测 footprint，见 SKILL.md 世界-122 章节）

## 验收标准

1. GLM-4.6V 定性：主体正确 / 视角符合指定 / 无文字水印 / 无断裂残影 / 背景纯净。
2. 像素统计定量：角点背景均值接近纯白；半透明边缘灰调残留 <5%。
3. 两张新道具互相并排验收时**分开单张提问**（GLM 多图会串扰）。

## 产出管线

智谱 API（免费额度优先）→ `tools/ai-gen/zhipu-gen.py` → 抠图 `tools/ai-gen/prep-obstacle.py`
→ `assets/terrain/obstacle_*.png` + `ISO_WALL_GEO` 注册。
