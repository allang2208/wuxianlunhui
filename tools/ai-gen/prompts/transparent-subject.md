# 透明主体（纯色底出图）提示词模板（2026-08-04 新增，方案一固化）

## 用途

需要透明 PNG 主体（图标 / 装备 / 怪物 / 道具 / 角色素材）时，默认走
**「AI 选纯色底 → 纯色底出图 → 阈值抠图 → GrabCut/BiRefNet 兜底」**，不再用白底：
白色要素多的主体（白衣 / 白甲 / 银饰）在白底上会抠不净、需人工介入。

## 底色选择规则（AI 判断，脚本自动执行）

- `tools/ai-gen/pick_bg_color.py` 扫描提示词颜色词（中/英/hex）估算主体色板，
  选与主体色距离最远的候选纯色（品红/绿/蓝/青/黄/红/橙/紫/teal/lime）；
- 无颜色信息默认品红 `#FF00FF`；主体含绿 → 避开绿；含红/金 → 避开红/橙/黄……
- 生成入口：`python tools/ai-gen/comfyui-gen.py --transparent ...`（默认 `--bg-color auto`），
  底色自动写进提示词并替换 "white background" 类短语；可 `--bg-color #RRGGBB` 人工覆盖。

## 固定背景色块（脚本自动追加/替换；禁止手写"白底"）

```text
isolated on a perfectly uniform solid <color> background (#HEX), flat solid color backdrop,
no gradient, no texture, no light source, no directional lighting, no shadows, no drop shadow,
no reflection, no other objects
```

## 负面词追加（--transparent 自动追加）

```text
gradient background, textured background, shadow on background, drop shadow, cast shadow,
hard lighting, directional light, rim light, glow behind subject, frame, border
```

## 命令

```bash
python tools/ai-gen/comfyui-gen.py --host 192.168.3.142 --model flux2-dev-depth \
  --control-image depth.png --transparent \
  --prompt "a white knight armor with gold trim, game equipment icon" \
  --out final.png
# 产物：final.png（RGBA 透明）+ final_raw.png（原图，复查底色/构图用）
```

手动只抠图（不重新生成）：

```bash
python tools/ai-gen/transparent_cutout.py --input final_raw.png --out final.png \
  --bg-color #0000FF --refine auto
```

## 坑（防再犯）

- 主体本身含底色相近颜色 → 选色器已自动避开，但出图后仍抽查角点像素；
- 模型不按 hex 渲染（SDXL 常出浅灰/渐变底）→ 脚本自动检测背景均匀性，
  非均匀时自动切 **GrabCut 主导**（`tools/ai-gen/grabcut-alpha.py`：边框必为背景 + 中心必为
  主体，GMM 颜色建模，实测残留清零）；GrabCut 失败再回退 BiRefNet，无需人工介入；
- 实际渲染色可能偏离指定hex（不同FLUX.2模型均可能发生）→ 抠图以
  **检测到的实际背景色**为阈值基准，偏差只打印提示不阻断；
- 透明主体提示词**不要写 rim lighting / studio lighting / dramatic lighting**（会诱导
  背景打光渐变，进一步放大抠图难度）；背景一律 "flat, evenly lit, uniform"；
- 半透明物体（玻璃/发光/雾气）阈值抠图天然做不了 → 这类走 LayerDiffuse（SDXL）方案；
- GrabCut/BiRefNet 依赖 `ComfyUI\.venv`（cv2/torch），找不到时自动回退纯阈值并打印提示。
