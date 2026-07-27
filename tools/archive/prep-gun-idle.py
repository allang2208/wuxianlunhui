#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
一次性脚本：持枪待机姿态（gun_idle）素材处理
源：素材库 shooting/2.png（1024x1024，白底，骷髅低持姿态）
处理：泛洪抠白底（容差）→ alpha 腐蚀 1px 去白边 → 内容包围盒 → 标准化到 512x516
      （内容高 440px 对齐 walk 帧规格、底部贴 y=500、水平居中）→ assets/player/gun_idle.png
"""
from PIL import Image, ImageDraw, ImageFilter
import os

SRC = r'E:\无尽轮回\游戏\素材库\人物\主角动画\奔跑\shooting\2.png'
DST = r'E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\player\gun_idle.png'

CANVAS_W, CANVAS_H = 512, 516
TARGET_CONTENT_H = 440      # 与 walk 帧内容高度一致（~85% 画面高）
BOTTOM_Y = 500              # 内容底边位置（对齐 idle.png 脚底）
FLOOD_THRESH = 40           # 泛洪容差（白底允许色差）
ALPHA_THRESHOLD = 10        # 内容包围盒 alpha 阈值

def main():
    img = Image.open(SRC).convert('RGBA')
    w, h = img.size

    # 1) 泛洪抠底：从四边每隔 16px 播种，标记为品红，再将标记像素置透明
    work = img.copy()
    marker = (255, 0, 255, 255)
    seeds = []
    for x in range(0, w, 16):
        seeds.append((x, 0)); seeds.append((x, h - 1))
    for y in range(0, h, 16):
        seeds.append((0, y)); seeds.append((w - 1, y))
    for s in seeds:
        px = work.getpixel(s)
        # 已是轮廓线（暗色）的种子点跳过，避免侵入本体
        if px[0] < 200 or px[1] < 200 or px[2] < 200:
            continue
        ImageDraw.floodfill(work, s, marker, thresh=FLOOD_THRESH)
    px_work = work.load()
    px_out = img.load()
    removed = 0
    for y in range(h):
        for x in range(w):
            if px_work[x, y] == marker:
                px_out[x, y] = (0, 0, 0, 0)
                removed += 1
    print(f'flood removed: {removed}px ({removed * 100.0 / (w * h):.1f}%)')

    # 2) alpha 腐蚀 1px 去白边（MinFilter 取邻域最小 alpha）
    r, g, b, a = img.split()
    a = a.filter(ImageFilter.MinFilter(3))
    img = Image.merge('RGBA', (r, g, b, a))

    # 3) 内容包围盒
    bbox = a.point(lambda v: 255 if v > ALPHA_THRESHOLD else 0).getbbox()
    if not bbox:
        raise SystemExit('ERROR: 抠底后无内容')
    print(f'content bbox: {bbox}  size: {bbox[2]-bbox[0]}x{bbox[3]-bbox[1]}')
    content = img.crop(bbox)
    cw, ch = content.size

    # 4) 标准化：内容高度缩放到 440，底部贴 y=500，水平居中
    scale = TARGET_CONTENT_H / ch
    nw, nh = round(cw * scale), round(ch * scale)
    content = content.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new('RGBA', (CANVAS_W, CANVAS_H), (0, 0, 0, 0))
    ox = (CANVAS_W - nw) // 2
    oy = BOTTOM_Y - nh
    canvas.paste(content, (ox, oy), content)

    os.makedirs(os.path.dirname(DST), exist_ok=True)
    canvas.save(DST)
    print(f'saved: {DST}  ({CANVAS_W}x{CANVAS_H}, content {nw}x{nh} @ {ox},{oy})')

if __name__ == '__main__':
    main()
