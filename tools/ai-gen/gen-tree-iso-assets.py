#!/usr/bin/env python3
"""等距（30°）树五变体批量生图（2026-08-15）：Blender 白模深度 + flux2-dev-depth 锁视角。

替换旧五棵正面平视阔叶树（obstacle_tree_{tall,bushy,twin,wind,tiered}），
视角与防御塔/掩体统一（30° 俯视等距，树冠顶面可见）。

用法：
    python tools/ai-gen/gen-tree-iso-assets.py                 # 全量 5 棵
    python tools/ai-gen/gen-tree-iso-assets.py --keys tall wind  # 指定

产出：Y:\\工作\\无尽轮回\\scratch\\world122\\tree-iso\\raw\\tree_<name>.png
深度图：先跑 blender-depth-render.py 生成到 %TEMP%/w122-trees/depth_<name>.png
"""
import argparse
import os
import subprocess
import sys
import time

DIR = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.join(DIR, "comfyui-gen.py")
DEPTHS = os.path.join(os.environ.get("TEMP", "/tmp"), "w122-trees")
OUT_DIR = r"Y:\工作\无尽轮回\scratch\world122\tree-iso\raw"
HOST = "192.168.3.142"

STYLE = (
    "lush green broadleaf tree, dense layered leaf canopy with detailed leaf clusters, "
    "detailed bark texture on the trunk, game asset sprite, clean crisp silhouette edges, "
    "isolated on plain white background, flat even lighting, absolutely no shadows, "
    "no drop shadow, no ambient occlusion, no text, no watermark, photorealistic detail"
)
PROMPTS = {
    "tall": "tall slender broadleaf tree, high round lush canopy on top of a long straight trunk, " + STYLE,
    "bushy": "short stout bushy broadleaf tree, wide round low canopy close to the ground, very short trunk, " + STYLE,
    "twin": "twin-trunk broadleaf tree, two parallel trunks rising side by side, two adjacent round canopies merging at the top, " + STYLE,
    "wind": "windswept broadleaf tree, trunk leaning to the right, canopy swept to the right side by strong wind, asymmetric windswept crown, " + STYLE,
    "tiered": "two-tiered broadleaf tree, distinct double-layer canopy, wide flat lower leaf layer and smaller upper leaf layer stacked like layered discs, small top crown, " + STYLE,
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
            print(f"[skip] {k}: 深度图不存在 {depth}（先跑 blender-depth-render.py）")
            continue
        out = os.path.join(OUT_DIR, f"tree_{k}.png")
        cmd = [
            sys.executable, GEN,
            "--host", HOST, "--model", "flux2-dev-depth",
            "--control-image", depth,
            "--prompt", PROMPTS[k],
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
