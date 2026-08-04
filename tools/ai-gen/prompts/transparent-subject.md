# 透明主体（纯色底出图）提示词模板（2026-08-04 新增，方案一固化）

## 用途

需要透明 PNG 主体（图标 / 装备 / 怪物 / 道具 / 角色素材）时，默认走
**「AI 选纯色底 → 纯色底出图 → 阈值抠图 → BiRefNet 精修」**，不再用白底：
白色要素多的主体（白衣 / 白甲 / 银饰）在白底上会抠不净、需人工介入。

## 底色选择规则（AI 判断，脚本自动执行）

- `tools/pick_bg_color.py` 扫描提示词颜色词（中/英/hex）估算主体色板，
  选与主体色距离最远的候选纯色（品红/绿/蓝/青/黄/红/橙/紫/teal/lime）；
- 无颜色信息默认品红 `#FF00FF`；主体含绿 → 避开绿；含红/金 → 避开红/橙/黄……
- 生成入口：`python tools/comfyui-gen.py --transparent ...`（默认 `--bg-color auto`），
  底色自动写进提示词并替换 "white background" 类短语；可 `--bg-color #RRGGBB` 人工覆盖。

## 固定背景色块（脚本自动追加/替换；禁止手写"白底"）

```text
isolated on a perfectly uniform solid <color> background (#HEX), flat solid color backdrop,
no gradient, no texture, no shadow, no reflection, no other objects
```

## 负面词追加（--transparent 自动追加）

```text
gradient background, textured background, shadow on background, glow behind subject, frame, border
```

## 命令

```bash
python tools/comfyui-gen.py --host 192.168.3.142 --model flux2-dev-depth \
  --control-image depth.png --transparent \
  --prompt "a white knight armor with gold trim, game equipment icon" \
  --out final.png
# 产物：final.png（RGBA 透明）+ final_raw.png（原图，复查底色/构图用）
```

手动只抠图（不重新生成）：

```bash
python tools/transparent_cutout.py --input final_raw.png --out final.png \
  --bg-color #0000FF --refine auto
```

## 坑（防再犯）

- 主体本身含底色相近颜色 → 选色器已自动避开，但出图后仍抽查角点像素；
- 模型不按 hex 渲染（SDXL 常出浅灰/渐变底）→ 脚本自动检测背景均匀性，
  非均匀时自动切 BiRefNet 主导抠图（`tools/transparent_cutout.py`），无需人工介入；
- 半透明物体（玻璃/发光/雾气）阈值抠图天然做不了 → 这类走 LayerDiffuse（SDXL）方案；
- BiRefNet 精修依赖 `ComfyUI\.venv`（torch），找不到时自动回退纯阈值并打印提示。
