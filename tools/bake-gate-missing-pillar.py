# -*- coding: utf-8 -*-
"""铁栅栏门补柱（2026-08-16 用户需求）：
六档 cover_gate_*_bars.png 的左叶首柱向左 38px 处缺一根同款栅栏柱（贴左墙柱），
把该帧自己的首柱复制一份、左移一个柱距粘贴到 16 帧动画里——补柱随开关门同步滑动。
用法：python tools/bake-gate-missing-pillar.py
"""
from PIL import Image

ROOT = r"E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\terrain"
GRADES = ["F", "E", "D", "C", "B", "A"]
W, H = 640, 634
SPACING = 38  # 柱距
BAR_W = 24    # 复制宽度（略大于柱宽，含柱侧斜撑局部）
SLOPE_DY = 19  # 栅栏柱沿墙坡线每 38px 左移下移 19px（斜率 -0.5，实测帧 0/1 恒定）：
# 补柱必须同步下移，否则底部不落在同一坡线上（用户反馈"底部没形成水平线"，2026-08-16 二修）


def left_first_bar(frame_img, run_min=200):
    """左叶（x<320）最左柱的起始列（连续不透明 run >= run_min 的最小 x）"""
    a = frame_img.split()[3]
    best = None
    for x in range(0, 320, 1):
        run = 0
        maxrun = 0
        for y in range(H):
            if a.getpixel((x, y)) > 16:
                run += 1
                if run > maxrun:
                    maxrun = run
            else:
                run = 0
        if maxrun >= run_min:
            best = x
            break
    return best


for grade in GRADES:
    path = f"{ROOT}\\cover_gate_{grade}_bars.png"
    img = Image.open(path).convert("RGBA")
    px = img.load()
    COLS = img.width // W
    pasted = 0
    for f in range(16):
        fx = (f % COLS) * W
        fy = (f // COLS) * H
        frame = img.crop((fx, fy, fx + W, fy + H))
        p1 = left_first_bar(frame)
        if p1 is None:
            continue
        dst = p1 - SPACING
        if dst + BAR_W > W:
            continue
        # 复制 [p1, p1+BAR_W) 到 [dst, dst+BAR_W)
        for y in range(H - SLOPE_DY):
            for i in range(BAR_W):
                s = frame.getpixel((p1 + i, y))
                if s[3] > 16:
                    px[fx + dst + i, fy + y + SLOPE_DY] = s
        pasted += 1
    img.save(path)
    print(f"{grade}: pasted {pasted} frames")
