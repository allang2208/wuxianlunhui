#!/usr/bin/env python3
"""荒漠植物点缀后处理（2026-08-16，世界-122 deco_grass 重出配套）

白底生图 → BiRefNet 进程内抠图（rmbg_cutout.predict_alpha，抠图铁律）
→ 可选降饱和（对齐低饱和画风）+ 可选降对比度 → 紧身裁剪 → 方形居中（deco）
或等比缩放（--no-square，障碍物用，geo.w/h 直接取成品尺寸）→ 缩放到目标尺寸。

⚠ 必须用 ComfyUI venv python 运行（torch + ComfyUI-RMBG）：
  E:\\无尽轮回\\长期备份\\2026-7-13-1\\ComfyUI\\.venv\\Scripts\\python.exe \
      tools/ai-gen/process-desert-plant.py --src raw.png --dst out.png [--desat 0.7] [--size 256]
      tools/ai-gen/process-desert-plant.py --src raw.png --dst out.png --desat 0.7 --contrast 0.85 --no-square
"""
import argparse
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from rmbg_cutout import get_model, predict_alpha  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--dst", required=True)
    ap.add_argument("--desat", type=float, default=1.0,
                    help="饱和度保留比例（1=不降；0.7 ≈ 降 30%）")
    ap.add_argument("--contrast", type=float, default=1.0,
                    help="对比度保留比例（1=不变；0.85 ≈ 降 15%，低对比度画风）")
    ap.add_argument("--no-square", action="store_true",
                    help="紧身裁剪后等比缩放（保持宽高比，长边=size），不做方形补边（障碍物用）")
    ap.add_argument("--size", type=int, default=256)
    args = ap.parse_args()

    img = Image.open(args.src).convert("RGB")
    model = get_model()
    alpha = predict_alpha(model, img)
    rgba = np.dstack([np.array(img), alpha]).astype(np.float32)

    if args.desat < 1.0:
        rgb = rgba[..., :3]
        lum = (0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2])[..., None]
        rgba[..., :3] = np.clip(lum + (rgb - lum) * args.desat, 0, 255)
    if args.contrast < 1.0:
        rgba[..., :3] = np.clip(127.5 + (rgba[..., :3] - 127.5) * args.contrast, 0, 255)

    out = Image.fromarray(rgba.astype(np.uint8), "RGBA")
    bbox = out.getchannel("A").getbbox()
    if not bbox:
        raise SystemExit("抠图结果为空，检查原图")
    out = out.crop(bbox)

    w, h = out.size
    if args.no_square:
        scale = args.size / max(w, h)
        canvas = out.resize((max(1, int(round(w * scale))), max(1, int(round(h * scale)))), Image.LANCZOS)
    else:
        side = int(max(w, h) * 1.04)
        canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        canvas.paste(out, ((side - w) // 2, (side - h) // 2), out)
        canvas = canvas.resize((args.size, args.size), Image.LANCZOS)
    canvas.save(args.dst)

    arr = np.array(canvas)
    vis = (arr[..., 3] > 20).mean()
    print(f"OK: {args.dst} visible={vis:.3f} size={canvas.size[0]}x{canvas.size[1]}")


main()
