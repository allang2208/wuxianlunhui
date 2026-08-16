# -*- coding: utf-8 -*-
"""剔除铁栅栏门 bars 贴图里"贴在墙上、开关门不动的细钢柱"（2026-08-16 用户需求）：
帧 3/8 在右石柱区域（x502-524 × y78-375）有一条孤立细钢柱（薄竖线 + 菱形底座，
1255/970px），开关门动画时固定出现在右石柱/墙位置，看起来像贴墙的静态钢柱。
策略：清除该区域内不与栅栏叶连通（连通域 <2000px）的孤立小块；栅栏叶主体是超大
连通域，不受影响。
用法：python tools/remove-gate-wall-steel-column.py
"""
from PIL import Image

ROOT = r"E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\terrain"
GRADES = ["F", "E", "D", "C", "B", "A"]
W, H = 640, 634
X0, X1, Y0, Y1 = 495, 535, 70, 390
MAX_SIZE = 2000


def remove_strays(img):
    px = img.load()
    a = img.split()[3]
    mask = [[a.getpixel((x, y)) > 16 for x in range(W)] for y in range(H)]
    visited = [[False] * W for _ in range(H)]
    removed = 0
    for y in range(H):
        for x in range(W):
            if not mask[y][x] or visited[y][x]:
                continue
            stack = [(x, y)]
            visited[y][x] = True
            pts = []
            while stack:
                cx, cy = stack.pop()
                pts.append((cx, cy))
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        nx, ny = cx + dx, cy + dy
                        if 0 <= nx < W and 0 <= ny < H and mask[ny][nx] and not visited[ny][nx]:
                            visited[ny][nx] = True
                            stack.append((nx, ny))
            if len(pts) < 4 or len(pts) > MAX_SIZE:
                continue
            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            if X0 <= min(xs) and max(xs) <= X1 and Y0 <= min(ys) and max(ys) <= Y1:
                for qx, qy in pts:
                    r, g, b, _ = px[qx, qy]
                    px[qx, qy] = (r, g, b, 0)
                removed += 1
    return removed


for grade in GRADES:
    path = f"{ROOT}\\cover_gate_{grade}_bars.png"
    img = Image.open(path).convert("RGBA")
    COLS = img.width // W
    total = 0
    for f in range(16):
        fx = (f % COLS) * W
        fy = (f // COLS) * H
        frame = img.crop((fx, fy, fx + W, fy + H))
        n = remove_strays(frame)
        if n:
            print(f"{grade} frame {f}: removed {n}")
        img.paste(frame, (fx, fy))
        total += n
    img.save(path)
    print(f"{grade}: total removed {total}")
