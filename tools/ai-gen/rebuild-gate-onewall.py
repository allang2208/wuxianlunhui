#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""铁栅栏门「一格 = 一堵墙」重建（2026-08-16）。

把六档 cover_gate_<g>.png（16 帧 4×4）整体缩放到门 face 水平跨度 = 墙 face
（COVER_FACE：A(-88,-21)/B(88,-108)，水平 176，斜长 196.33）——
缩放基准 = 重渲后实测 face 中点 (320,477.6)，比例 s = 214.63/268 ≈ 0.80086。
缩放后：
  - face A(105.4,584.2) B(534.6,370.9)：水平 429.3 tex = 176 display，斜长 479 tex ≈ 196.5 display
  - 石柱外缘 ≈ ±105 display（原 ±131 × s），栅栏叶随帧等比缩放、仍贴柱（rail 探入柱内被 split 裁成插入效果）
然后调 split-cover-gate-layers.py 重拆 pillarL/R + bars 并清理柱区残留。

用法：python tools/ai-gen/rebuild-gate-onewall.py [--grades FEDCBA]
依赖：ComfyUI venv python（PIL/numpy）。
"""
from __future__ import annotations

import argparse
import math
import os
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "assets" / "terrain"
CELL_W, CELL_H = 640, 634
FRAMES = 16
# 重渲后实测 face（bars 中段拟合斜率 -0.4967）：内容边缘 x 52/588 → face 端点
FACE_MID = (320.0, 477.6)
FACE_HALF_TEX = 268.0          # face 水平半跨（tex）：588-320 = 320-52
TARGET_HALF_DISPLAY = 88.0     # 墙 face 水平半跨（display px，COVER_FACE ±88）
SCALE = (TARGET_HALF_DISPLAY / 0.410) / FACE_HALF_TEX   # 214.63/268


def scale_frame(img: Image.Image) -> Image.Image:
    """以 face 中点 (320,477.6) 为基准整体缩放，输出同尺寸 cell。"""
    s = SCALE
    mx, my = FACE_MID
    out = Image.new("RGBA", (CELL_W, CELL_H), (0, 0, 0, 0))
    w = max(1, round(CELL_W * s))
    h = max(1, round(CELL_H * s))
    resized = img.resize((w, h), Image.LANCZOS)
    ox = round(mx - mx * s)
    oy = round(my - my * s)
    out.paste(resized, (ox, oy))
    return out


def cell(sheet: np.ndarray, n: int):
    r, c = n // 4, n % 4
    return sheet[r * CELL_H:(r + 1) * CELL_H, c * CELL_W:(c + 1) * CELL_W]


def measure(path: Path):
    sheet = np.array(Image.open(path).convert("RGBA"))
    f0 = cell(sheet, 0)
    bot = {}
    for x in range(CELL_W):
        col = np.nonzero(f0[:, x, 3] > 20)[0]
        if len(col):
            bot[x] = int(col.max())
    sel = [x for x in sorted(bot) if 140 <= x <= 502]
    s, b = np.polyfit(sel, [bot[x] for x in sel], 1)
    A = (float(sel[0]), float(b + s * sel[0]))
    B = (float(sel[-1]), float(b + s * sel[-1]))
    ln = math.hypot(B[0] - A[0], B[1] - A[1])
    return {"slope": round(s, 4), "len": round(ln, 1), "lenDisplay": round(ln * 0.410, 1),
            "mid": (round((A[0] + B[0]) / 2, 1), round((A[1] + B[1]) / 2, 1))}


def close_frame0_gaps(path: Path):
    """关门帧（frame 0）栅栏叶拉伸到贴柱：左叶 [179,320)→[174,320)，右叶 [320,460)→[320,466)。
    动画帧 1..15 不动（开门滑动天然覆盖）；柱内缘 174/466，拉伸后最外竖杆/横杆贴柱，
    消除「动画妥协」留的 2~5px 柱-栅栏缝。"""
    sheet = Image.open(path).convert("RGBA")
    arr = np.array(sheet)
    f0 = arr[0:CELL_H, 0:CELL_W].copy()
    for y in range(CELL_H):
        row = f0[y]
        left = Image.fromarray(np.ascontiguousarray(row[179:320][np.newaxis]), "RGBA").resize((146, 1), Image.LANCZOS)
        right = Image.fromarray(np.ascontiguousarray(row[320:460][np.newaxis]), "RGBA").resize((146, 1), Image.LANCZOS)
        newrow = np.concatenate([
            row[0:174],
            np.array(left)[0],
            np.array(right)[0],
            row[466:640],
        ])
        f0[y] = newrow
    arr[0:CELL_H, 0:CELL_W] = f0
    Image.fromarray(arr).save(path)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--grades", default="FEDCBA")
    ap.add_argument("--backup", default=str(ROOT / "_tmp_gate_inspect" / "backup"))
    args = ap.parse_args()
    backup = Path(args.backup)
    backup.mkdir(parents=True, exist_ok=True)
    print(f"scale = {SCALE:.5f}")
    for g in args.grades.upper():
        if g not in "FEDCBA":
            continue
        src = ASSETS / f"cover_gate_{g}.png"
        if not src.exists():
            print(f"[skip] {src.name} 不存在")
            continue
        # 备份原图
        (backup / src.name).write_bytes(src.read_bytes())
        sheet = Image.open(src).convert("RGBA")
        cells = [sheet.crop(((n % 4) * CELL_W, (n // 4) * CELL_H,
                             (n % 4) * CELL_W + CELL_W, (n // 4) * CELL_H + CELL_H))
                 for n in range(FRAMES)]
        scaled = [scale_frame(c) for c in cells]
        out = Image.new("RGBA", (CELL_W * 4, CELL_H * 4), (0, 0, 0, 0))
        for n, im in enumerate(scaled):
            out.paste(im, ((n % 4) * CELL_W, (n // 4) * CELL_H))
        out.save(src)
        print(f"{g}: scaled -> {src.name} ({out.size})")
    # 重拆柱/栅栏层（split 内置柱区/柱外残留清理）
    split_script = ROOT / "tools" / "ai-gen" / "split-cover-gate-layers.py"
    grades = [c for c in args.grades.upper() if c in "FEDCBA"]
    subprocess.run([sys.executable, str(split_script), *grades], check=True)
    # 关门帧栅栏叶贴柱（split 之后，避免柱区清理误删拉伸像素）
    for g in grades:
        close_frame0_gaps(ASSETS / f"cover_gate_{g}_bars.png")
        # 图标同步用新 frame 0
        sheet = Image.open(ASSETS / f"cover_gate_{g}.png")
        sheet.crop((0, 0, CELL_W, CELL_H)).save(ASSETS / f"cover_gate_{g}_icon.png")
    print("frame0 leaves stretched to pillars; icons regenerated")
    print("\n重标定（bars 中段 face 拟合）:")
    for g in args.grades.upper():
        if g not in "FEDCBA":
            continue
        m = measure(ASSETS / f"cover_gate_{g}.png")
        print(f"  {g}: {m}")
    print("\n下一步：按上面 face 中点更新 GATE_GEOM（worldFaceLen=176，displayScale=0.410）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
