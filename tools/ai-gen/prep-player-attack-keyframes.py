#!/usr/bin/env python3
"""attack_sword 单手反手回击：三张关键帧预处理。

用途：
  把 E:\\无尽轮回\\游戏\\素材库\\人物\\主角动画\\1 下的 1.png/2.png/3.png
  （1=起手 A，2=命中 B，3=收势 C，可按 --order 调整）预处理为 H3 可用的关键帧：

  1. 自动复制到 %TEMP%（ASCII 路径，规避中文路径 cv2/PIL 的坑）；
  2. ComfyUI-RMBG BiRefNet 抠图（统一入口 rmbg_cutout.py）；
  3. alpha 去污染（unpremultiply），避免边缘白边/灰边；
  4. 按“对齐三铁律”把角色统一到同一画布：目标高度 / 脚底基线 / 水平中心；
  5. 自动选主体没有的纯色背景，把透明角色合成到 1024x576 关键帧。

为什么必须“先抠图再合成”：
  H3 I2V 的 first/last frame 只读 RGB，不读 alpha。透明 PNG 直接传会把透明区当
  黑/原色参与条件，背景脏且角色边缘被污染。正确顺序是 BiRefNet -> 纯色底合成。

用法（必须用 ComfyUI venv python，工作目录 tools/ai-gen）：
  E:\\无尽轮回\\长期备份\\2026-7-13-1\\ComfyUI\\.venv\\Scripts\\python.exe ^
      prep-player-attack-keyframes.py ^
      --src-dir "E:\\无尽轮回\\游戏\\素材库\\人物\\主角动画\\1" ^
      --out-dir "C:\\tmp\\player_attack_sword_keyframes"
"""

import argparse
import os
import shutil
import sys
import tempfile

import numpy as np
from PIL import Image

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
if TOOLS_DIR not in sys.path:
    sys.path.insert(0, TOOLS_DIR)

import rmbg_cutout  # noqa: E402
from rmbg_cutout import get_model, predict_alpha  # noqa: E402
from pick_bg_color import CANDIDATES, _pick_from_palette  # noqa: E402


def ascii_workdir(src_dir):
    work = os.path.join(tempfile.gettempdir(), "player_attack_sword_keyframes", "src")
    os.makedirs(work, exist_ok=True)
    copied = []
    names = sorted(n for n in os.listdir(src_dir) if n.lower().endswith(".png"))
    for i, name in enumerate(names, 1):
        dst = os.path.join(work, f"key_{i:02d}.png")
        shutil.copyfile(os.path.join(src_dir, name), dst)
        copied.append((dst, name))
    return copied


def load_rgb(path):
    return Image.open(path).convert("RGB")


def make_rgba(rgb, alpha):
    """alpha 反推前景色，去污染。"""
    a = alpha.astype(np.float32) / 255.0
    a3 = np.clip(a, 1e-4, 1.0)[..., None]
    rgb_f = np.array(rgb, dtype=np.float32)
    out_rgb = np.clip(rgb_f / a3, 0, 255).astype(np.uint8)
    return np.dstack([out_rgb, alpha.astype(np.uint8)])


def clean_alpha(alpha, keep_min=8):
    """把 BiRefNet 低置信边缘压掉，保留主体。"""
    out = alpha.copy()
    out[out < keep_min] = 0
    return out


def subject_palette(rgbas, n_samples=30000):
    samples = []
    for rgba in rgbas:
        alpha = rgba[:, :, 3]
        ys, xs = np.where(alpha > 240)
        if len(ys):
            px = rgba[ys, xs, :3]
            if len(px) > n_samples // max(1, len(rgbas)):
                rng = np.random.default_rng(0)
                px = px[rng.choice(len(px), n_samples // max(1, len(rgbas)), replace=False)]
            samples.append(px)
    if not samples:
        return [(255, 255, 255), (20, 20, 20)]
    allpx = np.concatenate(samples, axis=0).astype(np.float64)
    q = (allpx // 32 * 32)
    keys, counts = np.unique(q, axis=0, return_counts=True)
    top = np.argsort(-counts)[:3]
    return [tuple(int(x) for x in keys[k] + 16) for k in top]


def pick_bg(rgbas):
    palette = [(c, 2.0) for c in subject_palette(rgbas)]
    return _pick_from_palette(palette, fallback_reason="未检出主体，默认品红")


def align_subject(rgba, canvas_w, canvas_h, content_h, feet_y, center_x, margin=48):
    """对齐三铁律：统一内容高度、脚底基线、水平中心；超宽时整体缩到安全边距内。"""
    alpha = rgba[:, :, 3]
    ys, xs = np.where(alpha > 16)
    if len(ys) == 0:
        return None, None
    x0, y0, x1, y1 = int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())
    src_h = y1 - y0 + 1
    src_w = x1 - x0 + 1
    if src_h <= 0:
        return None, None

    scale = content_h / src_h
    nw = max(1, int(round(src_w * scale)))
    nh = max(1, int(round(src_h * scale)))

    # 反手/前倾命中帧可能更宽：保证左右至少 margin px，必要时整体缩小。
    max_w = canvas_w - 2 * margin
    if nw > max_w:
        scale = max_w / src_w
        nw = max_w
        nh = max(1, int(round(src_h * scale)))
    if nh > canvas_h - 2 * margin:
        scale = (canvas_h - 2 * margin) / src_h
        nw = max(1, int(round(src_w * scale)))
        nh = canvas_h - 2 * margin

    crop = rgba[y0:y1 + 1, x0:x1 + 1]
    resized = np.array(Image.fromarray(crop).resize((nw, nh), Image.LANCZOS))
    ox = int(round(center_x - nw / 2.0))
    oy = int(round(feet_y - nh))

    out = np.zeros((canvas_h, canvas_w, 4), np.uint8)
    sx0, sy0 = max(0, -ox), max(0, -oy)
    dx0, dy0 = max(0, ox), max(0, oy)
    w = min(nw - sx0, canvas_w - dx0)
    h = min(nh - sy0, canvas_h - dy0)
    if w > 0 and h > 0:
        out[dy0:dy0 + h, dx0:dx0 + w] = resized[sy0:sy0 + h, sx0:sx0 + w]

    stats = {
        "bbox": [int(x) for x in (x0, y0, x1, y1)],
        "scaled_size": (nw, nh),
        "placed_at": (dx0, dy0),
        "feet_y": oy + nh,
        "center_x": ox + nw / 2.0,
        "touch_edge": bool(dx0 <= 0 or dy0 <= 0 or dx0 + w >= canvas_w or dy0 + h >= canvas_h),
        "alpha_px": int((alpha > 16).sum()),
    }
    return out, stats


def flatten(rgba, bg_rgb, width, height):
    bg = Image.new("RGB", (width, height), tuple(int(x) for x in bg_rgb))
    fg = Image.fromarray(rgba, "RGBA")
    bg.paste(fg, (0, 0), fg)
    return bg


def build_preview(flats, bg_rgb, out_path, gap=8):
    n = len(flats)
    w, h = flats[0].size if flats else (1024, 576)
    canvas = Image.new("RGB", ((w + gap) * n - gap, h), tuple(int(x) for x in bg_rgb))
    for i, im in enumerate(flats):
        canvas.paste(im, (i * (w + gap), 0))
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    canvas.save(out_path)
    return out_path


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--src-dir", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--width", type=int, default=1024)
    ap.add_argument("--height", type=int, default=576)
    ap.add_argument("--target-h", type=int, default=414,
                    help="角色内容高度，默认 414=画布高 72%%，四边留 10%%+")
    ap.add_argument("--feet-y", type=int, default=507,
                    help="脚底基线 y，默认 507=画布高 88%%")
    ap.add_argument("--center-x", type=int, default=512)
    ap.add_argument("--margin", type=int, default=48)
    ap.add_argument("--bg-color", default="auto",
                    help="auto 或 #RRGGBB")
    ap.add_argument("--order", default="1,2,3",
                    help="关键帧顺序对应的文件名序号，逗号分隔")
    args = ap.parse_args()

    src_dir = args.src_dir.rstrip("\\/")
    if not os.path.isdir(src_dir):
        ap.error(f"src dir not found: {src_dir}")

    copied = ascii_workdir(src_dir)
    print(f"[prep-key] copied {len(copied)} images to ASCII workdir", flush=True)
    model = get_model()

    rgba_by_index = {}
    for dst, orig in copied:
        rgb = load_rgb(dst)
        alpha = predict_alpha(model, rgb)
        alpha = clean_alpha(alpha)
        rgba = make_rgba(rgb, alpha)
        idx = int(os.path.basename(dst).split("_")[1].split(".")[0])
        rgba_by_index[idx] = rgba
        print(f"[prep-key] {orig} ({dst}) cutout ok "
              f"alpha_px={(alpha > 16).sum()}", flush=True)

    order = [int(x) for x in args.order.split(",") if str(x).strip()]
    rgbs_order = [rgba_by_index[i] for i in order if i in rgba_by_index]
    if len(rgbs_order) != 3:
        ap.error(f"expected 3 keyframes, got {len(rgbs_order)}: order={order}, indexes={list(rgba_by_index)}")

    if args.bg_color.lower() == "auto":
        pick = pick_bg(rgbs_order)
        print(f"[prep-key] auto bg: {pick['name']} #{pick['hex']} ({pick['reason']})", flush=True)
        bg_rgb = pick["rgb"]
    else:
        h = args.bg_color.lstrip("#")
        bg_rgb = tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
        print(f"[prep-key] explicit bg: #{h}", flush=True)

    out_dir = args.out_dir
    os.makedirs(out_dir, exist_ok=True)
    bg_hex = "".join(f"{int(c):02X}" for c in bg_rgb)
    with open(os.path.join(out_dir, "bg.txt"), "w", encoding="ascii") as fh:
        fh.write(bg_hex + "\n")
    print(f"[prep-key] bg saved {out_dir}/bg.txt = #{bg_hex}", flush=True)

    labels = ["A_start", "B_hit", "C_recover"]
    flats = []
    for k, rgba in enumerate(rgbs_order):
        aligned, st = align_subject(
            rgba, args.width, args.height, args.target_h,
            args.feet_y, args.center_x, args.margin)
        if aligned is None or not st:
            ap.error(f"keyframe {k + 1} empty after cutout, stop")
        label = labels[k]
        rgba_out = os.path.join(out_dir, f"{label}_rgba.png")
        flat_out = os.path.join(out_dir, f"{label}_flat.png")
        Image.fromarray(rgba, "RGBA").save(rgba_out)
        flat = flatten(aligned, bg_rgb, args.width, args.height)
        flat.save(flat_out)
        flats.append(flat)
        print(f"[prep-key] {label} -> {flat_out} {st}", flush=True)

    preview = build_preview(flats, bg_rgb, os.path.join(out_dir, "keyframes_preview.png"))
    print(f"[prep-key] DONE. preview={preview}", flush=True)
    print("[prep-key] next: use *_flat.png as H3 --first-frame / --last-frame, "
          f"and pass --bg-color #{''.join(f'{int(c):02X}' for c in bg_rgb)}", flush=True)


if __name__ == "__main__":
    main()
