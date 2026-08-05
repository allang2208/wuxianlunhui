# -*- coding: utf-8 -*-
"""迭代 box 旋转角，使深度图底边屏幕斜率 ≈ 0.4976（与 COVER_FACE 世界斜率一致）。"""
import json
import os
import subprocess
import sys

from PIL import Image
import numpy as np

BLENDER = r"E:/Program Files/Blender Foundation/Blender 5.1/blender.exe"
DIR = os.path.dirname(os.path.abspath(__file__))
TPL = os.path.join(DIR, "_depth_templates")
SPEC = os.path.join(TPL, "cover_wall_spec.json")
OUT = os.path.join(TPL, "_probe.png")
BLENDER_PY = os.path.join(DIR, "blender-depth-render.py")

TARGET = 0.4976


def slope_at(rot):
    with open(SPEC, "r", encoding="utf-8-sig") as f:
        spec = json.load(f)
    spec["primitives"][0]["rot"] = [0, 0, rot]
    with open(SPEC, "w", encoding="utf-8") as f:
        json.dump(spec, f, ensure_ascii=False)
    r = subprocess.run(
        [BLENDER, "--background", "--factory-startup", "--python", BLENDER_PY, "--", SPEC, OUT],
        capture_output=True, text=True)
    if r.returncode not in (0, 1):
        print("blender fail", r.stderr[-300:])
        return None
    a = np.array(Image.open(OUT).convert("L"))
    content = a > 40
    cols = np.where(content.max(axis=0))[0]
    low = {c: np.where(content[:, c])[0].max() for c in cols}
    lc = sorted(low.items())
    # 中段底边（排除端面凸起 20%）：端面会让轮廓弯曲，拼接底边以中段为准
    n = len(lc)
    seg = lc[n // 5: 4 * n // 5]
    if len(seg) < 20:
        return None
    xs = np.array([p[0] for p in seg])
    ys = np.array([p[1] for p in seg])
    k, _ = np.polyfit(xs, ys, 1)
    return k


def main():
    # 初始粗扫
    best = None
    for rot in range(40, 52, 2):
        s = slope_at(rot)
        print(f"rot {rot} slope {s and round(s, 4)}")
        if s is not None and (best is None or abs(s - TARGET) < abs(best[1] - TARGET)):
            best = (rot, s)
    # 线性插值 + 验证
    if best:
        r0, s0 = best
        # 找相邻两点插值
        pts = []
        for rot in range(38, 54, 2):
            s = slope_at(rot)
            pts.append((rot, s))
            print(f"  rot {rot} -> {round(s, 4)}" if s is not None else f"  rot {rot} -> None")
        good = [(r, s) for r, s in pts if s is not None]
        for i in range(len(good) - 1):
            (r1, s1), (r2, s2) = good[i], good[i + 1]
            if (s1 - TARGET) * (s2 - TARGET) <= 0:
                r = r1 + (TARGET - s1) * (r2 - r1) / (s2 - s1)
                print(f"INTERP rot≈{r:.2f}（斜率 {s1:.4f}->{s2:.4f}）")
                break


if __name__ == "__main__":
    main()
