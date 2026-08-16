#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""程序化茅草屋顶贴图（世界-122 茅草屋 v1）。

横向分层茅草：每层一条波形草束带 + 下缘草尖流苏，行间深色阴影缝，
叠加细噪点做旧。尺寸按坡面长宽比生成（约 2:1，棱柱 UV u 沿屋长、v 沿坡度）。
正式贴图后续可走 comfyui-gen --model flux2-klein-4b-walltex 重出，
本脚本只作为无远程 AI 时的本地兜底。
"""

import math
import os
import random

from PIL import Image, ImageDraw, ImageFilter


def gen_thatch(w=1024, h=510, seed=12202, courses=None):
    rng = random.Random(seed)
    img = Image.new("RGB", (w, h), (0, 0, 0))
    draw = ImageDraw.Draw(img, "RGBA")

    # 基础底色：暖稻草金 -> 深棕，带纵向明暗渐变（模拟光照）
    base_top = (214, 175, 102)
    base_mid = (198, 152, 86)
    base_bot = (156, 110, 62)
    for y in range(h):
        t = y / max(h - 1, 1)
        if t < 0.45:
            k = t / 0.45
            c = tuple(int(base_top[i] + (base_mid[i] - base_top[i]) * k) for i in range(3))
        else:
            k = (t - 0.45) / 0.55
            c = tuple(int(base_mid[i] + (base_bot[i] - base_mid[i]) * k) for i in range(3))
        draw.line([(0, y), (w, y)], fill=c)

    # 草束调色板：亮草 / 中草 / 深草 / 枯棕
    palette = [
        (232, 198, 122),
        (214, 174, 104),
        (188, 143, 82),
        (160, 112, 62),
        (176, 132, 72),
        (205, 166, 96),
    ]
    course_h = max(8, h // max(courses or 0, 8))
    courses = courses or int(h / course_h)

    for ci in range(courses):
        y0 = ci * course_h
        y1 = min(h, y0 + course_h)
        # 行间阴影缝（下一层草束会盖住大部分）
        draw.rectangle([0, y0, w, min(h, y0 + 2)], fill=(92, 62, 38, 255))
        # 本层草束：一组波形横向长条，叠加错位短草束
        for pass_i in range(3):
            amp = rng.uniform(1.2, 3.0)
            freq = rng.uniform(0.008, 0.016)
            base_y = y0 + 3 + pass_i * 3
            col = rng.choice(palette)
            alpha = rng.randint(70, 110)
            thickness = rng.choice([1, 1, 2])
            x = 0
            while x < w:
                seg = rng.randint(24, 90)
                off = rng.uniform(-2.5, 2.5)
                pts = []
                for sx in range(x, min(w, x + seg), 2):
                    yy = base_y + math.sin(sx * freq + ci * 1.7) * amp + off
                    pts.append((sx, yy))
                if len(pts) >= 2:
                    draw.line(pts, fill=col + (alpha,), width=thickness, joint="curve")
                x += seg + rng.randint(4, 18)
        # 下缘草尖流苏：短斜笔触向下（稻草梢）
        x = rng.randint(0, 8)
        while x < w:
            tip = rng.randint(5, 16)
            col = rng.choice(palette[1:])
            yy = y1 - rng.randint(0, 2)
            draw.line([(x, yy), (x + tip, yy + rng.randint(4, 10))],
                      fill=col + (rng.randint(120, 190),), width=1)
            x += rng.randint(6, 26)

    # 细噪点做旧
    for _ in range(w * h // 90):
        x = rng.randint(0, w - 1)
        y = rng.randint(0, h - 1)
        v = rng.randint(-16, 16)
        p = img.getpixel((x, y))
        img.putpixel((x, y), tuple(max(0, min(255, p[i] + v)) for i in range(3)))

    # 轻微柔化 + 锐化保留细节
    img = img.filter(ImageFilter.GaussianBlur(0.7))
    img = img.filter(ImageFilter.UnsharpMask(radius=1.2, percent=45, threshold=2))
    return img


def main():
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                       "_thatch_scratch", "thatch_roof_tex.png")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    img = gen_thatch(w=1024, h=510, seed=12202)
    img.save(out)
    print("saved ->", out, img.size)


if __name__ == "__main__":
    main()
