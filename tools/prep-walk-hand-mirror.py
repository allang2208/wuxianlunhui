# -*- coding: utf-8 -*-
"""
walk 手层镜像（2026-08-03）：法杖全程统一到「前伸手」一侧（施法/行走/idle 不换手）。

把 walk_hand/walk_body 从原来的左侧拳（staff 原持握侧）镜像到右侧拳：
- 逐帧取原手层内容 bbox，绕帧中心 x'=512-x 镜像成新窗口；
- 新 hand 层 = walk.png 在镜像窗口的内容；新 body 层 = walk.png 减去该内容；
- 逐像素合成验证无损（body+hand == walk.png）。

用法：python tools/prep-walk-hand-mirror.py
输出：覆盖 assets/player/walk_hand.png / walk_body.png
"""

import os

from PIL import Image

FRAME_W = 512
FRAME_H = 516
COLS = 8
FRAMES = 21
PAD = 10  # 窗口外扩像素（容差）


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.environ.get("STAFF_CAST_ROOT") or os.path.dirname(here)
    src = os.path.join(root, "assets", "character", "walk.png")
    old_hand_path = os.path.join(root, "assets", "player", "walk_hand.png")
    old_body_path = os.path.join(root, "assets", "player", "walk_body.png")

    walk = Image.open(src)
    old_hand = Image.open(old_hand_path)
    old_body = Image.open(old_body_path)
    if old_hand.size != walk.size or old_body.size != walk.size:
        raise SystemExit(f"尺寸不一致: walk={walk.size} hand={old_hand.size} body={old_body.size}")

    ha = old_hand.getchannel("A")
    wa = walk.getchannel("A")

    new_hand = Image.new("RGBA", walk.size, (0, 0, 0, 0))
    new_body = walk.copy()
    total_diff = 0

    for i in range(FRAMES):
        fx = (i % COLS) * FRAME_W
        fy = (i // COLS) * FRAME_H
        # 原手层内容 bbox（帧内坐标）
        xs = []
        ys = []
        for yy in range(FRAME_H):
            for xx in range(FRAME_W):
                if ha.getpixel((fx + xx, fy + yy)) > 60:
                    xs.append(xx)
                    ys.append(yy)
        if not xs:
            print(f"frame {i}: 原手层为空，跳过")
            continue
        x0, x1 = min(xs), max(xs)
        y0, y1 = min(ys), max(ys)
        # 镜像窗口（绕帧中心 x'=512-x）
        mx0 = max(0, FRAME_W - x1 - PAD)
        mx1 = min(FRAME_W, FRAME_W - x0 + PAD)
        my0 = max(0, y0 - PAD)
        my1 = min(FRAME_H, y1 + PAD)
        box = (fx + mx0, fy + my0, fx + mx1, fy + my1)
        patch = walk.crop(box)
        new_hand.paste(patch, box)
        # body 挖掉镜像窗口内容
        bp = new_body.crop(box)
        data = list(bp.getdata())
        cleared = [((0, 0, 0, 0) if px[3] > 0 else px) for px in data]
        bp2 = Image.new("RGBA", bp.size, (0, 0, 0, 0))
        bp2.putdata(cleared)
        new_body.paste(bp2, box)
        print(f"frame {i}: 原拳bbox=({x0},{y0})-({x1},{y1}) -> 镜像窗=({mx0},{my0})-({mx1},{my1})")

    # 无损验证
    comp = Image.alpha_composite(new_body, new_hand)
    da = list(comp.getdata())
    oa = list(walk.getdata())
    total_diff = sum(1 for c, o in zip(da, oa) if c != o)
    new_hand.save(old_hand_path)
    new_body.save(old_body_path)
    print(f"已覆盖 walk_hand.png / walk_body.png；全帧合成不匹配像素={total_diff}")


if __name__ == "__main__":
    main()
