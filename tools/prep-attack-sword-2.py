#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
二段挥砍（attack_sword_2）素材处理管线 —— 可重复运行
源：素材库 攻击/2.mp4（720x720，121帧，24fps，白底线稿骷髅双手挥砍）
处理：解码抽帧 → 角角落水印检测遮罩（白色描边小字，BR 为主）→ 邻域泛洪抠底
      （源视频背景是烟雾渐变，固定阈值会把烟雾残影留在图里；从边界按局部色差
      生长可沿烟雾渐变吃进背景、被本体深色描边挡住，骨骼填充因描边闭合而不漏）
      → alpha 腐蚀 1px 去白边 → 统一缩放（首帧内容高 477）→ 脚底基线 y=492、
      髋部 X≈217 逐帧配准 → 8帧 x 512x516 横排 → assets/player/attack_sword_2.png
验证：输出 tmp_atk2_sheet_preview.png（黑底长图）+ 每帧统计
"""
import os
from collections import deque
import cv2
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

SRC = r'E:\无尽轮回\游戏\素材库\人物\主角动画\攻击\2.mp4'
DST = 'assets/player/attack_sword_2.png'
PREVIEW = 'tmp_atk2_sheet_preview.png'
FRAMES_DIR = 'tmp_atk2_frames'

CANVAS_W, CANVAS_H = 512, 516
TARGET_CONTENT_H = 477      # 直立身高基准（与 attack_sword_frame0 一致）
CALIB_FRAME = 95            # 比例校准帧：回位后的直立帧（蹲姿帧直接顶 477 会把人放大）
BOTTOM_Y = 492              # 脚底基线（同 frame0 bbox 底）
HIP_X = 217                 # 髋部基准 X（同 frame0 规格）

SEG_START, SEG_END = 34, 86  # 完整挥砍段：戒备起手 → 挥出 → 收势 → 回位（f087+ 身体重新立直会超高，破坏 477 基准）
N_FRAMES = 8

BG_MIN = 226                # 背景判定：min 通道 >= 此值视为近白底（实测底 ~235-239，斩击残影 ~221-229）
FLOOD_TOL = 9               # 邻域泛洪局部色差容差（烟雾渐变逐步吃进，深色描边挡住）
FLOOD_FLOOR = 170           # 泛洪下限：低于此值一律视为本体，不越过（防描边弱点渗漏）
WM_DARK = 140               # 水印灰影下限（更暗的是本体线条，不碰）
WM_BRIGHT = 246             # 水印白色字芯下限（白字比底亮）
DARK_CORE = 100             # 含此值以下暗核的连通域视为本体，保护不遮罩
ALPHA_THRESHOLD = 10

# 角落水印搜索区 (y0, y1, x0, x1)，720x720 源坐标
CORNERS = [
    (0, 130, 0, 280),      # TL（f099+ 出现）
    (0, 130, 440, 720),    # TR（f089 附近出现）
    (590, 720, 0, 280),    # BL
    (590, 720, 440, 720),  # BR（f000-f098 出现，贴近右脚）
]
# BR 文字条带（"豆包AI生成"实际位置，与右脚尖相贴）：条带内候选像素无条件抹除，
# 不做暗核保护（水印无 < WM_DARK 的像素，脚趾线条 < WM_DARK 不受影响，
# 仅损失脚尖 1-2px 软边，与 alpha 腐蚀同级）
BR_STRIP = (655, 710, 565, 720)  # (y0, y1, x0, x1)


def decode_frames():
    """解码 mp4 到 tmp_atk2_frames/fNNN.png（已存在则跳过）"""
    if os.path.isdir(FRAMES_DIR) and len(os.listdir(FRAMES_DIR)) >= 121:
        return
    os.makedirs(FRAMES_DIR, exist_ok=True)
    cap = cv2.VideoCapture(SRC)
    i = 0
    while True:
        ok, fr = cap.read()
        if not ok:
            break
        cv2.imwrite(f'{FRAMES_DIR}/f{i:03d}.png', fr)
        i += 1
    cap.release()
    print(f'decoded {i} frames -> {FRAMES_DIR}/')


def mask_watermark(rgb):
    """检测角落低对比水印（白字芯 + 灰影），涂成背景色；返回涂色后的图和遮罩像素数。
    注意必须涂成背景灰（~237）而非纯白：涂 255 会与 237 的底形成 18 级硬边，
    邻域泛洪（容差 9）翻不过去，水印反而被留成不透明孤岛。"""
    work = rgb.copy()
    bg = int(np.median(np.concatenate([rgb[0].reshape(-1, 3), rgb[-1].reshape(-1, 3),
                                       rgb[:, 0].reshape(-1, 3), rgb[:, -1].reshape(-1, 3)])))
    mn = work.min(axis=2)
    mx = work.max(axis=2)
    sat = mx - mn
    total = 0
    # BR 文字条带：与脚尖相贴的水印无条件抹除；距暗线 <=4px 的像素保留
    # （脚趾皮薄、填充紧贴描边，水印文字块大多离描边 >4px）
    sy0, sy1, sx0, sx1 = BR_STRIP
    strip = work[sy0:sy1, sx0:sx1]
    smn = strip.min(axis=2)
    scand = smn >= WM_DARK
    near_dark = ndimage.binary_dilation(smn < 110, iterations=4)
    scand &= ~near_dark
    scand = ndimage.binary_dilation(scand, iterations=2) & ~near_dark
    if scand.any():
        strip[scand] = bg
        total += int(scand.sum())
    for (y0, y1, x0, x1) in CORNERS:
        zmn = mn[y0:y1, x0:x1]
        zsat = sat[y0:y1, x0:x1]
        # 候选：白色字芯（比底更亮）或浅灰影（低饱和、不太暗）
        cand = (zmn >= WM_BRIGHT) | ((zmn >= WM_DARK) & (zmn < BG_MIN) & (zsat <= 45))
        lab, n = ndimage.label(cand, structure=np.ones((3, 3)))
        if n == 0:
            continue
        keep = np.zeros_like(cand)
        dark = zmn < DARK_CORE
        dark_d = ndimage.binary_dilation(dark, iterations=3)
        for c in range(1, n + 1):
            comp = lab == c
            if comp.sum() < 8:
                continue
            # 含暗核（或紧贴暗核）的连通域是本体（如脚部线条），保护
            if (comp & dark_d).any():
                continue
            keep |= comp
        keep = ndimage.binary_dilation(keep, iterations=2)
        if keep.any():
            work[y0:y1, x0:x1][keep] = bg
            total += int(keep.sum())
    return work, total


def cutout(rgb):
    """邻域泛洪抠底：从边界播种，仅当邻像素局部色差 <= FLOOD_TOL 且不低于
    FLOOD_FLOOR 时生长 —— 烟雾残影（渐变、无底色的灰雾）被吃成背景，
    本体被深色描边挡住；随后 alpha 腐蚀 1px 去白边"""
    v = rgb.min(axis=2).astype(np.int16)
    h, w = v.shape
    visited = np.zeros((h, w), bool)
    dq = deque()
    for x in range(0, w, 2):
        dq.append((0, x)); dq.append((h - 1, x))
    for y in range(0, h, 2):
        dq.append((y, 0)); dq.append((y, w - 1))
    while dq:
        y, x = dq.popleft()
        if visited[y, x] or v[y, x] < FLOOD_FLOOR:
            continue
        visited[y, x] = True
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not visited[ny, nx]:
                if v[ny, nx] >= FLOOD_FLOOR and abs(int(v[ny, nx]) - int(v[y, x])) <= FLOOD_TOL:
                    dq.append((ny, nx))
    alpha = np.where(visited, 0, 255).astype(np.uint8)
    # 清除碎斑：与本体不相连的微小连通域（水印碎渣/压缩噪点，< 60px）；
    # 斩击拖尾等大连通域保留
    lab, n = ndimage.label(alpha > 0, structure=np.ones((3, 3)))
    for c in range(1, n + 1):
        comp = lab == c
        if comp.sum() < 60:
            alpha[comp] = 0
    out = np.dstack([rgb, alpha])
    img = Image.fromarray(out, 'RGBA')
    r, g, b, a = img.split()
    a = a.filter(ImageFilter.MinFilter(3))  # 腐蚀 1px 去白边
    return Image.merge('RGBA', (r, g, b, a))


def content_stats(img):
    a = np.asarray(img)[..., 3]
    ys, xs = np.nonzero(a > ALPHA_THRESHOLD)
    if len(ys) == 0:
        return None
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1, a  # bbox + alpha


def main():
    decode_frames()
    picks = [int(round(v)) for v in np.linspace(SEG_START, SEG_END, N_FRAMES)]
    print(f'segment f{SEG_START:03d}-f{SEG_END:03d}, picks: {picks}')

    # 1) 逐帧：水印遮罩 → 抠底 → 腐蚀 → bbox
    frames = []
    for i in picks:
        rgb = np.asarray(Image.open(f'{FRAMES_DIR}/f{i:03d}.png').convert('RGB')).astype(np.uint8)
        rgb, wm_px = mask_watermark(rgb)
        img = cutout(rgb)
        st = content_stats(img)
        if st is None:
            raise SystemExit(f'ERROR: f{i:03d} 抠底后无内容')
        x0, y0, x1, y1, _ = st
        frames.append({'idx': i, 'img': img, 'bbox': (x0, y0, x1, y1), 'wm': wm_px})
        print(f'f{i:03d}: wm_masked={wm_px}px  src_bbox=({x0},{y0},{x1},{y1}) '
              f'{x1 - x0}x{y1 - y0}')

    # 2) 统一缩放：477 基准指"直立身高"（attack_sword_frame0 直立=477，
    #    其 sheet 内收势帧仅 423）—— 故用回位后的直立帧 f095 定比例，
    #    各帧内容高随姿态自然变化（本段戒备帧 ~428，与一段收势 423 同级）
    rgb = np.asarray(Image.open(f'{FRAMES_DIR}/f{CALIB_FRAME:03d}.png').convert('RGB')).astype(np.uint8)
    calib = cutout(mask_watermark(rgb)[0])
    st = content_stats(calib)
    h_calib = st[3] - st[1]
    scale = TARGET_CONTENT_H / h_calib
    print(f'scale = {scale:.4f} (calib f{CALIB_FRAME:03d} upright h {h_calib} -> {TARGET_CONTENT_H})')

    # 3) 首帧：缩后髋部（内容高 45%-58% 带的 x 重心）对齐 HIP_X，
    #    记录首帧脚底带（底 12%）x 重心作为全序列脚底锚点
    def band_xcenter(alpha, y_lo, y_hi):
        band = alpha[y_lo:y_hi]
        ys, xs = np.nonzero(band > ALPHA_THRESHOLD)
        return xs.mean() if len(xs) else None

    prepared = []
    for fr in frames:
        x0, y0, x1, y1 = fr['bbox']
        content = fr['img'].crop((x0, y0, x1, y1))
        nw, nh = round((x1 - x0) * scale), round((y1 - y0) * scale)
        content = content.resize((nw, nh), Image.LANCZOS)
        a = np.asarray(content)[..., 3]
        hip_x = band_xcenter(a, int(nh * 0.45), int(nh * 0.58))
        feet_x = band_xcenter(a, int(nh * 0.88), nh)
        prepared.append({'idx': fr['idx'], 'content': content, 'nw': nw, 'nh': nh,
                         'hip_x': hip_x, 'feet_x': feet_x, 'wm': fr['wm']})

    shift0 = HIP_X - prepared[0]['hip_x']       # 首帧髋部对齐 217
    feet_anchor = prepared[0]['feet_x'] + shift0
    print(f'guard: hip_x={prepared[0]["hip_x"]:.1f} shift={shift0:.1f} '
          f'feet_anchor={feet_anchor:.1f}')

    # 4) 逐帧贴画布：脚底基线 BOTTOM_Y，脚底带重心对齐 feet_anchor（配准微小位移）
    sheet = Image.new('RGBA', (CANVAS_W * N_FRAMES, CANVAS_H), (0, 0, 0, 0))
    report = []
    for k, p in enumerate(prepared):
        ox = int(round(feet_anchor - p['feet_x']))
        oy = BOTTOM_Y - p['nh']
        over = ''
        if ox < 0 or ox + p['nw'] > CANVAS_W:
            over = f'  [overflow x: {ox}..{ox + p["nw"]}]'
        canvas = Image.new('RGBA', (CANVAS_W, CANVAS_H), (0, 0, 0, 0))
        canvas.paste(p['content'], (ox, oy), p['content'])
        sheet.paste(canvas, (k * CANVAS_W, 0))
        a = np.asarray(canvas)[..., 3]
        ys, xs = np.nonzero(a > ALPHA_THRESHOLD)
        report.append({
            'idx': p['idx'], 'opaque': int((a > ALPHA_THRESHOLD).sum()),
            'bbox': (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1),
            'wm': p['wm'], 'over': over,
        })

    os.makedirs(os.path.dirname(DST), exist_ok=True)
    sheet.save(DST)
    print(f'saved: {DST}  ({sheet.size[0]}x{sheet.size[1]})')

    # 5) 黑底预览长图（帧间留缝 + 帧号标记线）
    pv = Image.new('RGB', (CANVAS_W * N_FRAMES, CANVAS_H), (0, 0, 0))
    for k in range(N_FRAMES):
        fr = sheet.crop((k * CANVAS_W, 0, (k + 1) * CANVAS_W, CANVAS_H))
        pv.paste(fr, (k * CANVAS_W, 0), fr)
    pv.save(PREVIEW)
    print(f'saved: {PREVIEW}')

    # 6) 报告（与一段参考帧对比：frame0 直立 477 / frame7 收势 423）
    def ref_h(png):
        ra = np.asarray(Image.open(png))[..., 3]
        rys, _ = np.nonzero(ra > ALPHA_THRESHOLD)
        return int(rys.max() - rys.min() + 1)
    print('\n=== report ===')
    print(f'ref frame0 (upright) h={ref_h("assets/player/attack_sword_frame0.png")}  '
          f'ref frame7 (recover) h={ref_h("assets/player/attack_sword_frame7.png")}')
    for k, r in enumerate(report):
        b = r['bbox']
        print(f'frame{k} (src f{r["idx"]:03d}): opaque={r["opaque"]}  '
              f'bbox=({b[0]},{b[1]},{b[2]},{b[3]}) {b[2]-b[0]}x{b[3]-b[1]}  '
              f'foot_y={b[3]-1}  wm_masked={r["wm"]}{r["over"]}')


if __name__ == '__main__':
    main()
