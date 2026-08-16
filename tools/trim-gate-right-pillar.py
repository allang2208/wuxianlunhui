# -*- coding: utf-8 -*-
"""裁掉右叶最右栅栏柱凸出的底部（2026-08-16 用户需求）：
帧 0 右叶最后一根柱（x≈470-492）底边 391，比右石柱底 383 凸出 8px，
紧挨此前剔除的错位钢柱。把该柱 y>383 的部分裁掉，底边与石柱对齐。
用法：python tools/trim-gate-right-pillar.py
"""
from PIL import Image

ROOT = r"E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\terrain"
GRADES = ["F", "E", "D", "C", "B", "A"]
W, H = 640, 634
BASE_Y = 383  # 右石柱（pillarR）底边


def rightmost_pillar_range(frame):
    """右叶最右柱的列范围（run>=200 的最右列簇）"""
    a = frame.split()[3]
    cols = []
    for x in range(300, W):
        run = 0
        maxrun = 0
        for y in range(H):
            if a.getpixel((x, y)) > 16:
                run += 1
                if run > maxrun:
                    maxrun = run
            else:
                run = 0
        if maxrun >= 200:
            cols.append(x)
    if not cols:
        return None
    # 取最右列簇
    last = [cols[-1]]
    for x in reversed(cols[:-1]):
        if last[0] - x <= 6:
            last.insert(0, x)
        else:
            break
    return last[0], last[-1]


for grade in GRADES:
    path = f"{ROOT}\\cover_gate_{grade}_bars.png"
    img = Image.open(path).convert("RGBA")
    px = img.load()
    frame0 = img.crop((0, 0, W, H))
    rng = rightmost_pillar_range(frame0)
    if not rng:
        print(f"{grade}: no rightmost pillar")
        continue
    x0, x1 = rng
    removed = 0
    for y in range(BASE_Y + 1, H):
        for x in range(x0, x1 + 1):
            r, g, b, al = px[x, y]
            if al > 16:
                px[x, y] = (r, g, b, 0)
                removed += 1
    img.save(path)
    print(f"{grade}: trimmed x{x0}-{x1}, y>{BASE_Y}, removed {removed}px")
