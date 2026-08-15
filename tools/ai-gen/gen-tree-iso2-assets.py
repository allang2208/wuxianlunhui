#!/usr/bin/env python3
"""写实高瘦树五变体批量生图（2026-08-15 v2）：替换第一版卡通风等距树。
全部高瘦形态（trunk 细高 + 树冠在上），树种区分差异：白杨/橡树/白桦/枯树/松树。
风格铁律：写实（photograph 级），上一版卡通风被用户退回（画风不匹配）。

用法：python tools/ai-gen/gen-tree-iso2-assets.py [--keys poplar oak] [--steps 24]
产出：Y:\\工作\\无尽轮回\\scratch\\world122\\tree-iso2\\raw\\tree_<species>.png
深度图：blender-depth-render.py + _blockout_specs/tree_iso2_<species>.json → %TEMP%/w122-trees2/
"""
import argparse
import os
import subprocess
import sys
import time

DIR = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.join(DIR, "comfyui-gen.py")
DEPTHS = os.path.join(os.environ.get("TEMP", "/tmp"), "w122-trees2")
OUT_DIR = r"Y:\工作\无尽轮回\scratch\world122\tree-iso2\raw"
HOST = "192.168.3.142"

STYLE = (
    "photograph of a real tree, photorealistic, natural muted colors, "
    "highly detailed rough bark texture, realistic foliage with fine leaf detail, "
    "game asset sprite, clean crisp silhouette edges, isolated on plain white background, "
    "flat even soft lighting, absolutely no shadows, no drop shadow, no ambient occlusion, "
    "no text, no watermark"
)
NEG = (
    "cartoon, anime, illustration, painting, drawing, vector, flat shading, cel shading, "
    "stylized, lowpoly, 3d render, plastic, toy, clipart, icon, emoji, "
    "blurry, low quality, watermark, text, signature, frame, border, people, "
    "grass, ground, sky, perspective background, cast shadow, drop shadow"
)
PROMPTS = {
    "poplar": "a tall slender poplar tree, narrow columnar upright canopy, tall straight thin trunk, " + STYLE,
    "oak": "a tall oak tree, sturdy upright trunk with rough ridged bark, broad upright oval canopy of dense oak leaves, " + STYLE,
    "birch": "a tall white birch tree, slender white bark trunk with black horizontal marks, light airy canopy of small green leaves, " + STYLE,
    "dead": "a tall leafless dead tree, bare twisted gnarled branches, dry weathered gray-brown trunk, no leaves at all, " + STYLE,
    "pine": "a tall pine tree, conical evergreen conifer, layered needle branches stacked in tiers, straight trunk, " + STYLE,
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--keys", nargs="*", default=None)
    ap.add_argument("--steps", type=int, default=24)
    args = ap.parse_args()
    keys = args.keys or list(PROMPTS.keys())
    os.makedirs(OUT_DIR, exist_ok=True)

    for k in keys:
        depth = os.path.join(DEPTHS, f"depth_{k}.png")
        if not os.path.exists(depth):
            print(f"[skip] {k}: 深度图不存在 {depth}")
            continue
        out = os.path.join(OUT_DIR, f"tree_{k}.png")
        cmd = [
            sys.executable, GEN,
            "--host", HOST, "--model", "flux2-dev-depth",
            "--control-image", depth,
            "--prompt", PROMPTS[k],
            "--negative", NEG,
            "--steps", str(args.steps),
            "--size", "1024x1024",
            "--out", out,
        ]
        print(f"[gen] {k} ...")
        t0 = time.time()
        r = subprocess.run(cmd, cwd=DIR)
        dt = time.time() - t0
        if r.returncode != 0 or not os.path.exists(out):
            print(f"[fail] {k} ({dt:.0f}s)")
        else:
            print(f"[ok] {k} -> {out} ({dt:.0f}s)")


if __name__ == "__main__":
    main()
