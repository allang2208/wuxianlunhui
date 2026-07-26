# -*- coding: utf-8 -*-
"""门闸视频切帧管线：0~4.05s 均匀 16 帧 → 抠图(白底/水印) → 统一对齐 → 4x4 精灵图表
输出: assets/terrain/wall_gate.png + tools/wall-gate-geo.json + 对照图
"""
import cv2
import numpy as np
from PIL import Image
import json
import os

VIDEO = r'C:/Users/allan/Downloads/更换背景并去除阴影 (3).mp4'
T_END = 4.05
N_FRAMES = 16
OUT_SHEET = r'E:/无尽轮回/长期备份/2026-7-13-1/game-dev/assets/terrain/wall_gate.png'
OUT_GEO = r'E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/wall-gate-geo.json'
CHECK = r'E:/无尽轮回/长期备份/2026-7-13-1/tmp_wall_view/gate_check'
FRAME_W = 640  # 帧宽（等比缩放）

os.makedirs(CHECK, exist_ok=True)

cap = cv2.VideoCapture(VIDEO)
fps = cap.get(cv2.CAP_PROP_FPS)

frames = []
for i in range(N_FRAMES):
    t = T_END * i / (N_FRAMES - 1)
    cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
    ok, frame = cap.read()
    if not ok:
        raise RuntimeError(f'读帧失败 t={t:.2f}s')
    frames.append(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
cap.release()
print(f'取帧 {len(frames)} 张 {frames[0].shape}')

def keyout(rgb):
    """白底/棋盘底：边界洪水填充去亮背景（亮度>200 且与边界相连）"""
    h, w, _ = rgb.shape
    bright = rgb.mean(axis=2)
    cand = (bright > 200).astype(np.uint8)
    ff = cand.copy()
    mask = np.zeros((h + 2, w + 2), np.uint8)
    for seed in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1), (w // 2, 0), (0, h // 2), (w // 2, h - 1), (w - 1, h // 2)]:
        if ff[seed[1], seed[0]] == 1:
            cv2.floodFill(ff, mask, seed, 2)
    bg = ff == 2
    # 边缘光晕：与背景相邻且很亮的像素
    bg_d = cv2.dilate(bg.astype(np.uint8), np.ones((3, 3), np.uint8), iterations=1).astype(bool)
    bg |= bg_d & (bright > 215)
    # 门洞封闭区二次抠图：栏杆包围的亮白背景（洪水填充进不去），
    # 门洞矩形内（原图坐标 x[295,405] y[200,510]）亮度>180 全部去底（栏杆/门柱均为深色，安全）
    bg[200:510, 295:405] |= bright[200:510, 295:405] > 180
    # 门洞地面楔形区（透过拱门可见的浅灰地面 ~120-185 亮度）：更低阈值去底，让游戏地板透出
    bg[240:510, 295:405] |= bright[240:510, 295:405] > 120
    # 豆包水印区（原图右下角，墙体不进入该区域，直接抹除）
    bg[675:720, 600:720] = True
    out = np.dstack([rgb, np.full((h, w), 255, np.uint8)])
    out[:, :, 3][bg] = 0
    return out

rgba_frames = [keyout(f) for f in frames]

# 高度归一化：初版取消后，拼接处墙顶落差 17~26px（下夹角"错位"根因）——
# 现由 tools/gate-top-warp.py 承担（k≥1 只拉不压、拱门区不压缩、先扩帧再 warp），
# 重跑本脚本切帧后必须再跑一次 gate-top-warp.py 并同步 ISO_WALL_GEO.gate / BootScene 帧高

# 统一内容包围盒（16 帧并集）
x0, y0, x1, y1 = 720, 720, 0, 0
for f in rgba_frames:
    ys, xs = np.nonzero(f[:, :, 3] > 8)
    x0, y0 = min(x0, xs.min()), min(y0, ys.min())
    x1, y1 = max(x1, xs.max()), max(y1, ys.max())
print(f'统一包围盒: x[{x0},{x1}] y[{y0},{y1}] = {x1-x0+1}x{y1-y0+1}')

MARGIN = 4
x0 = max(0, x0 - MARGIN)
y0 = max(0, y0 - MARGIN)
x1 = min(720, x1 + 1 + MARGIN)
y1 = min(720, y1 + 1 + MARGIN)

scale = FRAME_W / (x1 - x0)
fh = round((y1 - y0) * scale)

crops = []
for f in rgba_frames:
    c = Image.fromarray(f).crop((x0, y0, x1, y1)).resize((FRAME_W, fh), Image.LANCZOS)
    crops.append(c)

# 4x4 打包
sheet = Image.new('RGBA', (FRAME_W * 4, fh * 4), (0, 0, 0, 0))
for i, c in enumerate(crops):
    sheet.paste(c, ((i % 4) * FRAME_W, (i // 4) * fh), c)
sheet.save(OUT_SHEET, optimize=True)
print(f'精灵图表: {sheet.size} -> {OUT_SHEET}')

# 对照图：第0帧与 wall_straight 并排 + 网格
ref = Image.open(r'E:/无尽轮回/长期备份/2026-7-13-1/game-dev/assets/terrain/wall_straight.png').convert('RGBA')
ref.thumbnail((FRAME_W, 1000))
bg = Image.new('RGBA', (FRAME_W * 2 + 30, max(fh, ref.height) + 40), (40, 40, 60, 255))
bg.alpha_composite(crops[0], (0, 20))
bg.alpha_composite(ref, (FRAME_W + 30, 20))
bg.convert('RGB').save(f'{CHECK}/compare.jpg', quality=90)

# 帧序列检查图
seq = Image.new('RGBA', (FRAME_W * 4, fh * 4), (40, 40, 60, 255))
for i, c in enumerate(crops):
    seq.alpha_composite(c, ((i % 4) * FRAME_W, (i // 4) * fh))
seq.convert('RGB').save(f'{CHECK}/sequence.jpg', quality=85)

# 几何实测：底边线（第 0 帧内容底部拟合，帧坐标系）
# 只拟合两侧墙身（5~30% 与 70~95% 列），避开门洞区——
# 门框架底部会拉偏拟合线，导致与直墙拼接时底边错位
a0 = np.array(crops[0])[:, :, 3]
h0, w0 = a0.shape
bot = np.full(w0, -1.0)
for x in range(w0):
    col = np.nonzero(a0[:, x] > 64)[0]
    if len(col):
        bot[x] = col.max()
ys, xs = np.nonzero(a0 > 64)
bx0, bx1 = xs.min(), xs.max()
idx = np.arange(w0)
span = bx1 - bx0
m = (bot >= 0) & (((idx >= bx0 + span * 0.05) & (idx <= bx0 + span * 0.30)) | ((idx >= bx0 + span * 0.70) & (idx <= bx0 + span * 0.95)))
cb = np.polyfit(idx[m], bot[m], 1)
geo = {
    'frameW': FRAME_W, 'frameH': fh, 'frames': N_FRAMES,
    'slope': round(float(cb[0]), 4),
    'base': [[round(float(bx0), 1), round(float(cb[0] * bx0 + cb[1]), 1)], [round(float(bx1), 1), round(float(cb[0] * bx1 + cb[1]), 1)]],
    'contentBBox': [int(bx0), int(ys.min()), int(bx1), int(ys.max())],
}
with open(OUT_GEO, 'w', encoding='utf-8') as fp:
    json.dump(geo, fp, ensure_ascii=False, indent=1)
print('geo:', json.dumps(geo, ensure_ascii=False))
