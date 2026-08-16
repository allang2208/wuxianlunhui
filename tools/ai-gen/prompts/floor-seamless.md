# 无缝连续地面纹理提示词模板（2026-08-16，泥地/沙地）

> 目标：平材质地面（泥/沙）不再用"独立菱形石板"拼接（草苔盖缝失效后会露黑边/
> 硬接缝），改为**无缝可循环方形纹理 + 连续铺贴**：世界坐标对齐相位重复，
> 任意方向无接缝；沙地作为软边补丁混入泥地。
> 产出：1024² 无缝方形图 → 直接作 floor 连续纹理（不切菱形）。
> 视角：出图保持**正俯视**平铺纹理即可，游戏侧在连续铺贴时按 30° 等距
> 纵向压缩 0.5774（SKILL 地板标准），不要在提示词里要求画菱形/等距。

## 拼接规则（固定）

```text
seamless tileable ground texture, ... the texture wraps around perfectly with
no visible seams, left edge matches right edge, top edge matches bottom edge,
pattern repeats seamlessly when tiled in every direction, uniform even
lighting, no shadows, no vignette, no border, no frame, no dark edges,
no shading at the border, high detail, photorealistic, no text, no watermark
```

## 主体块（按材质替换）

- 泥地：`dry mud earth, muted desaturated gray-brown soil, low saturation,
  dull earthy tones, pale dry dirt, small dirt clods, tiny pebbles and cracks,
  sparse dry grass tufts`
- 沙地：`dry desert sand, muted desaturated pale beige sand, low saturation,
  dull earthy tones, fine sand grains with small ripples and wind streaks,
  a few tiny pebbles`
