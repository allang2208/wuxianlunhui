#!/usr/bin/env python3
"""黑狼精灵图从原视频完整重建（2026-08-07，套红狼王 BiRefNet 管线 + 黑狼 CLEAN 惯例）。

输入：Y:\\工作\\无尽轮回\\scratch\\black_wolf\\videos\\ 下的原视频
  walk_loop.mp4            -> black_wolf_walk.png   4x4  (16 帧)
  run_loop.mp4             -> black_wolf_run.png    4x7  (28 帧)
  attack_pounce_v4.mp4     -> black_wolf_pounce.png 4x5  (20 帧)
  attack_bite_regular_v5.mp4 -> black_wolf_bite_regular.png 3x2 (6 帧)
idle 无视频（静态图），保持现状；updown 无视频源，跳过。

管线参数（黑狼惯例，SKILL 十五~十七版）：
  uniform-h 高度统一 262、512 格、feet-y 410、center-x 256
  lum-clear 200（只清近白边，保浅色毛）；hard-edge 245（semi 清零）；
  edge-dark 18（边缘亮像素压暗）；zero-transparent-rgb（trans_nonblack=0）
输出：tools/ai-gen/blackwolf-rebuild-out/（同名，可直接替换）
用法（ComfyUI venv python）：
  python blackwolf-rebuild-from-video.py [--only walk,run]
"""

import argparse
import os
import subprocess
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

REBUILD = r"E:\无尽轮回\长期备份\2026-7-13-1\game-dev\tools\ai-gen\rebuild-h3-birefnet.py"
VIDEO_DIR = r"Y:\工作\无尽轮回\scratch\black_wolf\videos"
OUT_DIR = r"E:\无尽轮回\长期备份\2026-7-13-1\game-dev\tools\ai-gen\blackwolf-rebuild-out"
ASSETS_DIR = r"E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\enemies"

COMMON = [
    "--cell", "512", "--center-x", "256", "--feet-y", "410",
    "--target-h", "262", "--uniform-h", "--lum-clear", "200",
    "--hard-edge", "245", "--edge-dark", "18", "--zero-transparent-rgb",
]

JOBS = [
    # walk：步态周期 P=48（s=40..88，leg_iou 0.80），step 3 抽 16 帧覆盖完整周期
    dict(video="walk_loop.mp4", out="black_wolf_walk.png", cols=4,
         frames=",".join(str(40 + 3 * k) for k in range(16))),
    # run：步态周期 P=28（s=40..68），step 1 连续 28 帧 = 视频原帧（SKILL：run 必须 step 1）
    dict(video="run_loop.mp4", out="black_wolf_run.png", cols=4,
         frames=",".join(str(40 + k) for k in range(28))),
    dict(video="attack_pounce_v4.mp4", out="black_wolf_pounce.png", frames_count=20, cols=4,
         cell=640, center_x=320, feet_y=513),
    dict(video="attack_bite_regular_v5.mp4", out="black_wolf_bite_regular.png", frames_count=6, cols=3),
]


def bbox(im):
    a = np.array(Image.open(im).convert("RGBA"))[..., 3]
    ys, xs = np.where(a > 127)
    if not len(xs):
        return None
    return xs.min(), xs.max(), ys.min(), ys.max()


def com_off(im):
    """主体质量中心相对 bbox 中心的横向偏移（头重侧为负/正，用于朝向判定）。"""
    a = np.array(Image.open(im).convert("RGBA"))[..., 3].astype(np.float64)
    x0, x1, y0, y1 = bbox(im)
    sub = a[y0:y1 + 1, x0:x1 + 1]
    ys, xs = np.mgrid[0:sub.shape[0], 0:sub.shape[1]]
    total = sub.sum()
    if total <= 0:
        return 0.0
    cx = (sub * xs).sum() / total
    return (cx - (sub.shape[1] - 1) / 2.0) / sub.shape[1]


def post_clean_sheet(path, cell=512, hard=245, edge_dark=18):
    """逐格后处理（黑狼 CLEAN 铁律）：
    1) alpha 硬二值化（>=245 -> 255，其余 0，清掉 resize 插值半透带）；
    2) 每格只保留最大连通域（清孤立噪点色块）；
    3) 不透明亮像素邻接透明区（2px 膨胀）压暗到 edge_dark（清 resize 白圈）；
    4) 透明区 RGB 归零；
    5) 腿部区域（bbox 底部 35%，脚底+小腿）内不透明亮像素 -> 5x5 邻域毛色均值
       （清贴地残留/腿部运动模糊灰白，躯干白毛保留）。
    """
    im = np.array(Image.open(path).convert("RGBA"))
    rgb = im[..., :3]
    alpha = im[..., 3]
    h, w = alpha.shape
    rows, cols = h // cell, w // cell
    for r in range(rows):
        for c in range(cols):
            y0, x0 = r * cell, c * cell
            ac = alpha[y0:y0 + cell, x0:x0 + cell]
            rc = rgb[y0:y0 + cell, x0:x0 + cell]
            a_bin = np.where(ac >= hard, 255, 0).astype(np.uint8)
            lab, n = ndimage.label(a_bin > 30)
            if n > 1:
                areas = [(int((lab == i).sum()), i) for i in range(1, n + 1)]
                areas.sort(reverse=True)
                keep = areas[0][1]
                drop = (lab > 0) & (lab != keep)
                a_bin[drop] = 0
                rc[drop] = 0
            opaque = a_bin >= 250
            bright = opaque & (rc.mean(axis=2) > 150)
            trans = a_bin < 200
            near = ndimage.binary_dilation(trans, iterations=2)
            rc[near & bright] = edge_dark
            rc[a_bin < 8] = 0
            # 腿部区域去残留：bbox 底部 35% 内的不透明亮像素 -> 5x5 邻域毛色均值
            body = a_bin >= 200
            ys, xs = np.where(body)
            if len(ys):
                y0, y1 = ys.min(), ys.max()
                cut = max(0, y0 + int((y1 - y0) * 0.65))
                band = np.zeros_like(body)
                band[cut:y1 + 1, :] = True
                bright_leg = band & body & (rc.mean(axis=2) > 160)
                if bright_leg.any():
                    dark = body & (~bright_leg)
                    cnt = ndimage.uniform_filter(dark.astype(np.float32), size=5) * 25.0
                    mean = np.stack([
                        ndimage.uniform_filter((rc[..., i] * dark).astype(np.float32), size=5) * 25.0
                        for i in range(3)
                    ], axis=-1) / np.maximum(cnt[..., None], 1e-6)
                    mean = np.clip(mean, 0, 255).astype(np.uint8)
                    mean[cnt < 1] = edge_dark
                    rc[bright_leg] = mean[bright_leg]
            ac[...] = a_bin
    Image.fromarray(np.dstack([rgb, alpha]).astype(np.uint8), "RGBA").save(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default=None, help="逗号分隔只跑部分（walk,run,pounce,bite）")
    args = ap.parse_args()

    only = set(x.strip() for x in (args.only or "").split(",") if x.strip())
    os.makedirs(OUT_DIR, exist_ok=True)

    for job in JOBS:
        key = job["out"].replace("black_wolf_", "").replace(".png", "")
        if only and key not in only:
            continue
        video = os.path.join(VIDEO_DIR, job["video"])
        out = os.path.join(OUT_DIR, job["out"])
        cmd = [sys.executable, REBUILD, "--video", video, "--out", out,
               "--cols", str(job["cols"])] + COMMON
        if job.get("frames"):
            cmd += ["--frames", job["frames"]]
        else:
            cmd += ["--frames-count", str(job["frames_count"])]
        for flag, key in (("--cell", "cell"), ("--center-x", "center_x"), ("--feet-y", "feet_y")):
            if job.get(key):
                cmd[cmd.index(flag) + 1] = str(job[key])
        print(f"[blackwolf] {job['video']} -> {out}", flush=True)
        subprocess.run(cmd, check=True, stderr=subprocess.STDOUT)
        post_clean_sheet(out, cell=job.get("cell", 512))
        print(f"[blackwolf] post-cleaned {job['out']}", flush=True)

        # 朝向检查：与当前资产第一帧对比（质量中心偏移方向）
        cur = os.path.join(ASSETS_DIR, job["out"])
        if os.path.exists(cur):
            o_new = com_off(out)
            o_old = com_off(cur)
            print(f"[blackwolf] facing offset new={o_new:+.3f} old={o_old:+.3f} "
                  f"({'SAME' if np.sign(o_new) == np.sign(o_old) or abs(o_new) < 0.01 else 'FLIPPED!'})",
                  flush=True)

    print(f"[blackwolf] done -> {OUT_DIR}", flush=True)


if __name__ == "__main__":
    main()
