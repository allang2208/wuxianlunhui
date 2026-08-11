# -*- coding: utf-8 -*-
"""恶魔洞窟铁闸门切帧管线（门闸标准工作流参数化版）：白底视频 0~4.05s 均匀 16 帧
→ 白底洪泛抠图（+ 门洞封闭区二次抠图）→ 16 帧并集包围盒对齐 → 4×4 打包 demon_gate.png
→ 打印 ISO_WALL_GEO.demon_gate 注册值（base/face/gateX/wallH/slope）。
"""
import cv2
import numpy as np
from PIL import Image
import json
import os

VIDEO = r'Y:\工作\无尽轮回\scratch\demon_gate_flat.mp4'
DST = r'E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\terrain\demon_gate.png'
CHECK = r'E:\无尽轮回\长期备份\2026-7-13-1\game-dev\tools\verify-shots\demon_gate_frames'
T_END = 4.05
N_FRAMES = 16
FRAME_W = 640
SHEAR_K = 0.5  # 垂直剪切系数：平底边 → 0.5 原生斜率（26.6°，slopeFix 校正到 30°）

os.makedirs(CHECK, exist_ok=True)
cap = cv2.VideoCapture(VIDEO)
fps = cap.get(cv2.CAP_PROP_FPS)
frames = []
for i in range(N_FRAMES):
    t = T_END * i / (N_FRAMES - 1)
    cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
    ok, frame = cap.read()
    if not ok:
        raise RuntimeError(f'read frame fail t={t:.2f}')
    frames.append(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
cap.release()
print(f'frames {len(frames)} {frames[0].shape}')

def keyout(rgb):
    """白底洪泛抠图：边界相连的亮像素去底 + 封闭亮区二次抠（亮度阈值）。"""
    h, w, _ = rgb.shape
    bright = rgb.mean(axis=2)
    cand = (bright > 200).astype(np.uint8)
    ff = cand.copy()
    mask = np.zeros((h + 2, w + 2), np.uint8)
    for seed in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1), (w // 2, 0), (0, h // 2), (w // 2, h - 1), (w - 1, h // 2)]:
        if ff[seed[1], seed[0]] == 1:
            cv2.floodFill(ff, mask, seed, 2)
    bg = ff == 2
    bg_d = cv2.dilate(bg.astype(np.uint8), np.ones((3, 3), np.uint8), iterations=1).astype(bool)
    bg |= bg_d & (bright > 215)
    # 门洞封闭区：白底洪泛进不去的亮区（铁栏杆间隙/开门后的洞口）→ 纯白阈值整体去底
    # （岩石框为深色/浅灰，>225 才清，避免啃掉浅色岩框）
    bg |= (bright > 225)
    out = np.dstack([rgb, np.full((h, w), 255, np.uint8)])
    out[:, :, 3][bg] = 0
    return out

rgba = [keyout(f) for f in frames]

# 垂直剪切（iso 视角）：y' = y + x*SHEAR_K，使平底边变为向下右斜的墙基线
if SHEAR_K:
    rgba2 = []
    for f in rgba:
        im = Image.fromarray(f)
        # 底部加透明填充（剪切后右侧下移会超出原帧，先留出空间避免裁掉门底）
        pad = np.zeros((int(im.height * 0.8), im.width, 4), dtype=np.uint8)
        im = Image.fromarray(np.vstack([np.array(im), pad]))
        # PIL AFFINE 是输出→输入逆映射；以水平中心为轴剪切（门体留在画面内）：
        # y_out = y_in + k*(x_in - cx) → y_in = y_out - k*x_out + k*cx
        cx = im.width / 2
        im = im.transform(im.size, Image.AFFINE, (1, 0, 0, -SHEAR_K, 1, SHEAR_K * cx), resample=Image.BICUBIC)
        rgba2.append(np.array(im))
    rgba = rgba2

# 并集包围盒对齐 + 等比缩放
x0, y0, x1, y1 = 720, 720, 0, 0
for f in rgba:
    ys, xs = np.nonzero(f[:, :, 3] > 8)
    x0, y0 = min(x0, xs.min()), min(y0, ys.min())
    x1, y1 = max(x1, xs.max()), max(y1, ys.max())
print(f'union bbox x[{x0},{x1}] y[{y0},{y1}]')

cell_w = FRAME_W
cell_h = int((y1 - y0 + 1) * (cell_w / (x1 - x0 + 1)))
sheet = Image.new('RGBA', (cell_w * 4, cell_h * 4), (0, 0, 0, 0))
aligned = []
for i, f in enumerate(rgba):
    im = Image.fromarray(f).crop((x0, y0, x1 + 1, y1 + 1))
    im = im.resize((cell_w, cell_h), Image.LANCZOS)
    aligned.append(im)
    sheet.paste(im, ((i % 4) * cell_w, (i // 4) * cell_h))
    im.save(os.path.join(CHECK, f'frame{i:02d}.png'))
sheet.save(DST)
print(f'saved {DST} {sheet.width}x{sheet.height} cell {cell_w}x{cell_h}')

# 几何标定：首帧（关闭）底边
a0 = np.array(aligned[0])[:, :, 3]
bot = np.full(cell_w, -1.0)
for x in range(cell_w):
    col = np.nonzero(a0[:, x] > 20)[0]
    if len(col):
        bot[x] = col.max()
valid = np.nonzero(bot >= 0)[0]
if len(valid) > 20:
    m = (valid >= cell_w * 0.15) & (valid <= cell_w * 0.85)
    s, i = np.polyfit(valid[m], bot[valid[m]], 1)
    print(f'base slope={s:.4f} angle={np.degrees(np.arctan(s)):.2f}°')
    print(f'face = [[{valid[m].min()}, {bot[valid[m].min()]:.0f}], [{valid[m].max()}, {bot[valid[m].max()]:.0f}]]')
    # 门洞（gateX）：关闭帧有铁栅、打开帧无栅的 x 区间（岩石框两帧都在 → 排除）
    a15 = np.array(aligned[-1])[:, :, 3]
    bars = (a0 > 40) & (a15 <= 40)
    cols = bars.any(axis=0).nonzero()[0]
    if len(cols):
        print(f'gateX ≈ [{cols.min()}, {cols.max()}]')
else:
    print('no base detected (check video/background)')
