# -*- coding: utf-8 -*-
"""宝箱开启动画切帧管线：0~4.9s 均匀 16 帧 → 抠图(白底/水印) → 统一包围盒 → 4x4 精灵图表
输出: assets/terrain/chest_open.png + tools/chest-open-geo.json + 帧序列检查图

素材分析（宝箱打开-1.mp4, 720x720, 24fps, 121帧）:
- 背景为纯白(~242)，宝箱本体棕/金色，亮度洪水填充(>200)安全
- 水印"豆包AI生成"为浅灰字(亮度208~225)：0.3~3.8s 在右下角(x601-696,y676-697)，
  4.2s 后移到左上角(x32-126,y24-43)；因水印像素本身>200 且被白底包围，
  边界洪水填充会自动覆盖，另加水印区条件抹除(只抹亮像素，防误伤内容)兜底
- 运动贯穿全片，约 4.8s 后静止 → 裁掉尾部静止段，取 0~4.9s
- 左下角掉落的挂锁是动画内容，必须保留（勿当水印抹掉）
"""
import cv2
import numpy as np
from PIL import Image
import json
import os

VIDEO = r'E:/无尽轮回/游戏/素材库/场景/宝箱/宝箱打开-1.mp4'
T_START = 0.0
T_END = 4.9  # 4.9~5.04s 为静止尾段，裁掉
N_FRAMES = 16
OUT_SHEET = r'E:/无尽轮回/长期备份/2026-7-13-1/game-dev/assets/terrain/chest_open.png'
OUT_GEO = r'E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/chest-open-geo.json'
CHECK = r'E:/无尽轮回/长期备份/2026-7-13-1/tmp_wall_view/chest_open_check.jpg'
MAX_SIDE = 640  # 单帧最长边上限，超过才等比缩小

cap = cv2.VideoCapture(VIDEO)
fps = cap.get(cv2.CAP_PROP_FPS)
print(f'视频 {fps}fps {int(cap.get(cv2.CAP_PROP_FRAME_COUNT))}帧')

frames = []
for i in range(N_FRAMES):
    t = T_START + (T_END - T_START) * i / (N_FRAMES - 1)
    cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
    ok, frame = cap.read()
    if not ok:
        raise RuntimeError(f'读帧失败 t={t:.2f}s')
    frames.append(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
cap.release()
print(f'取帧 {len(frames)} 张 {frames[0].shape}')

def keyout(rgb):
    """白底：边界洪水填充去亮背景（亮度>200 且与边界相连）+ 水印区条件抹除"""
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
    # 水印区定点抹除（只抹亮像素，宝箱/挂锁等深色内容进入该区也不受影响）
    # 右下角水印区（0.3~3.8s 出现，x590-710 y665-710，外扩余量）
    bg[660:715, 585:715] |= bright[660:715, 585:715] > 190
    # 左上角水印区（4.2s 后出现，x20-140 y15-55，外扩余量）
    bg[10:60, 15:150] |= bright[10:60, 15:150] > 190
    out = np.dstack([rgb, np.full((h, w), 255, np.uint8)])
    out[:, :, 3][bg] = 0
    return out

rgba_frames = [keyout(f) for f in frames]

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

fw, fh = x1 - x0, y1 - y0
scale = min(1.0, MAX_SIDE / max(fw, fh))  # 只在超过上限时缩小
fw, fh = round(fw * scale), round(fh * scale)
print(f'帧尺寸: {fw}x{fh} (scale={scale:.3f})')

crops = []
for f in rgba_frames:
    c = Image.fromarray(f).crop((x0, y0, x1, y1))
    if scale < 1.0:
        c = c.resize((fw, fh), Image.LANCZOS)
    crops.append(c)

# 4x4 打包
sheet = Image.new('RGBA', (fw * 4, fh * 4), (0, 0, 0, 0))
for i, c in enumerate(crops):
    sheet.paste(c, ((i % 4) * fw, (i // 4) * fh), c)
sheet.save(OUT_SHEET, optimize=True)
print(f'精灵图表: {sheet.size} -> {OUT_SHEET}')

# 帧序列检查图（深色底便于看抠图边缘）
seq = Image.new('RGBA', (fw * 4, fh * 4), (40, 40, 60, 255))
for i, c in enumerate(crops):
    seq.alpha_composite(c, ((i % 4) * fw, (i // 4) * fh))
seq.convert('RGB').save(CHECK, quality=88)
print(f'检查图 -> {CHECK}')

# 几何：第 0 帧（关闭态）内容包围盒，帧坐标系
a0 = np.array(crops[0])[:, :, 3]
ys, xs = np.nonzero(a0 > 8)
geo = {
    'frameW': fw, 'frameH': fh, 'frames': N_FRAMES,
    'contentBBox': [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())],
}
with open(OUT_GEO, 'w', encoding='utf-8') as fp:
    json.dump(geo, fp, ensure_ascii=False, indent=1)
print('geo:', json.dumps(geo, ensure_ascii=False))
