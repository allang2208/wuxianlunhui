# -*- coding: utf-8 -*-
"""剔除铁栅栏门 bars 贴图里的错位钢铁圆柱残块（2026-08-16 用户需求）：
六档 cover_gate_*_bars.png 在右石柱区域（x495-545 × y330-380）带一个孤立的小钢柱
（帧 0/2/6/7 出现，603/390/43/366px），开关门/视角下看起来像"右石柱上的错位钢柱"。
策略：清除该区域内与栅栏叶不连通（连通域 <1200px）的孤立残块；栅栏叶主体是超大
连通域，不受影响；左叶补柱（x120）不在区域内。
用法：python tools/remove-gate-stray-cylinder.py
"""
from PIL import Image

ROOT = r"E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\terrain"
GRADES = ["F", "E", "D", "C", "B", "A"]
W, H = 640, 634
X0, X1, Y0, Y1 = 495, 560, 330, 400
MAX_SIZE = 1200


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
        # 写回
        img.paste(frame, (fx, fy))
        total += n
    img.save(path)
    print(f"{grade}: total removed {total}")
