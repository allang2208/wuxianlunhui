# -*- coding: utf-8 -*-
"""Extract gun hip-fire -> aim arm frames from video into a sprite strip.

Replaces the old "median plate + template subtraction" pipeline (which eroded
late frames). This version:
  1. chroma-keys each video frame against its near-pure background (no plate
     subtraction anywhere),
  2. registers every frame onto the 512x516 canvas used by gun_idle_arm.png
     (template = gun_idle_torso + gun_idle_legs, correlation-based shift),
  3. separates arms as: (fg outside dilated core) UNION (pose-diff vs frame 0
     near those outside-arm regions), then keeps connected components anchored
     to the outside-torso arm parts,
  4. tracks the front (gun) hand as centroid of the rightmost pixels.

Run:  .venv-sprites/Scripts/python.exe tools/aim-frames-extract.py
Outputs: assets/player/gun_aim_frames.png / .json, tmp_af_recheck.png,
         tmp_af_mask_XXX.png debug overlays.
"""
import cv2
import numpy as np
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VIDEO = r"E:\无尽轮回\游戏\素材库\人物\主角动画\更换背景并去除阴影 (3).mp4"
CW, CH = 512, 516
SRC = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65]
PIVOT = {"pivotX": 227, "pivotY": 98}
K3 = np.ones((3, 3), np.uint8)

os.chdir(ROOT)

# ---------------------------------------------------------------- decode
cap = cv2.VideoCapture(VIDEO)
frames_bgr = []
while True:
    ok, f = cap.read()
    if not ok:
        break
    frames_bgr.append(f)
cap.release()
NF = len(frames_bgr)
print("decoded", NF, "frames")
assert NF >= SRC[-1] + 1


def fg_mask(bgr):
    """chroma-key vs near-pure background -> largest connected component"""
    bg = np.median(
        np.concatenate([bgr[0:8, 0:8].reshape(-1, 3), bgr[0:8, -8:].reshape(-1, 3),
                        bgr[-8:, 0:8].reshape(-1, 3), bgr[-8:, -8:].reshape(-1, 3)]),
        axis=0)
    d = np.abs(bgr.astype(np.int16) - bg.astype(np.int16)).max(axis=2)
    m = (d > 30).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(m, 8)
    if n <= 1:
        return m
    big = 1 + np.argmax(stats[1:, 4])
    return (lab == big).astype(np.uint8)


# ---------------------------------------------------------------- template
core = np.zeros((CH, CW), np.uint8)
for name in ["gun_idle_torso", "gun_idle_legs"]:
    im = cv2.imread(f"assets/player/{name}.png", cv2.IMREAD_UNCHANGED)
    core[im[:, :, 3] > 10] = 1
ref_arm_im = cv2.imread("assets/player/gun_idle_arm.png", cv2.IMREAD_UNCHANGED)
ref_arm = (ref_arm_im[:, :, 3] > 10).astype(np.uint8)

ys, xs = np.where(core)
CB = (xs.min(), xs.max(), ys.min(), ys.max())  # core bbox
print("core bbox", CB)

core_d = cv2.dilate(core, K3)  # +-1px tolerance for scoring


def best_shift(canvas_mask):
    """(dx,dy) maximizing overlap(roll(canvas_mask,(dy,dx)), core_d).

    filter2D computes correlation: result[p] = sum_k core_d[k]*img[p+k-anchor].
    With anchor at the kernel center c, substituting j = p+k-c gives
    result[p] = sum_j img[j] * core_d[j + (c-p)] = overlap(d = c - p).
    So argmax at (cy,cx) means shift (dx,dy) = (c - cx, c - cy).
    """
    corr = cv2.filter2D(canvas_mask.astype(np.float32), -1, core_d,
                        anchor=(CW // 2, CH // 2), borderType=cv2.BORDER_CONSTANT)
    cy, cx = np.unravel_index(np.argmax(corr), corr.shape)
    return CW // 2 - cx, CH // 2 - cy, float(corr[cy, cx])


def place(img, ox, oy):
    h, w = img.shape[:2]
    x0, y0 = max(0, ox), max(0, oy)
    x1, y1 = min(CW, ox + w), min(CH, oy + h)
    shape = (CH, CW) + (() if img.ndim == 2 else (img.shape[2],))
    canvas = np.zeros(shape, img.dtype)
    if x1 > x0 and y1 > y0:
        canvas[y0:y1, x0:x1] = img[y0 - oy:y1 - oy, x0 - ox:x1 - ox]
    return canvas


# ---------------------------------------------------------------- align
# initial placement guess (same anchors the old pipeline used):
#   legs centroid x -> 238, video top (~y=20) -> 15
m60 = fg_mask(frames_bgr[60])
lys, lxs = np.where(m60[400:, :] > 0)
leg_cx = float(lxs.mean())

best_s, best_total = 0.72, -1
for s in [0.715, 0.720, 0.725, 0.730, 0.735]:
    total = 0.0
    for i in range(0, NF, 15):
        m = fg_mask(frames_bgr[i])
        mr = (cv2.resize(m, None, fx=s, fy=s, interpolation=cv2.INTER_AREA) > 0.5).astype(np.uint8)
        ox, oy = int(round(238 - leg_cx * s)), int(round(15 - 20 * s))
        _, _, sc = best_shift(place(mr, ox, oy))
        total += sc
    print("scale", s, "score", total)
    if total > best_total:
        best_total, best_s = total, s
S = best_s
OX, OY = int(round(238 - leg_cx * S)), int(round(15 - 20 * S))
print("chosen scale", S, "offset", OX, OY)

aligned_rgb = np.zeros((NF, CH, CW, 3), np.uint8)
aligned_msk = np.zeros((NF, CH, CW), np.uint8)
shifts = []
for i in range(NF):
    m = fg_mask(frames_bgr[i])
    mr = (cv2.resize(m, None, fx=S, fy=S, interpolation=cv2.INTER_AREA) > 0.5).astype(np.uint8)
    dx, dy, sc = best_shift(place(mr, OX, OY))
    dx = int(np.clip(dx, -25, 25))
    dy = int(np.clip(dy, -25, 25))
    shifts.append((dx, dy))
    rgb = cv2.resize(frames_bgr[i], None, fx=S, fy=S, interpolation=cv2.INTER_AREA)
    canvas_rgb = place(rgb, OX + dx, OY + dy)
    canvas_rgb[place(mr, OX + dx, OY + dy) == 0] = (248, 248, 248)
    aligned_rgb[i] = canvas_rgb
    aligned_msk[i] = place(mr, OX + dx, OY + dy)
    if i % 20 == 0:
        print("align", i, "shift", dx, dy)

# frame-0 alignment check vs gun_idle_arm
ref_ys, ref_xs = np.where(ref_arm > 0)
ref_c = (ref_xs.mean(), ref_ys.mean())
m0a = aligned_msk[0] & cv2.dilate(ref_arm, np.ones((7, 7), np.uint8))
a0ys, a0xs = np.where(m0a > 0)
print("frame0 arm-region centroid", (a0xs.mean(), a0ys.mean()), "ref", ref_c)

# ---------------------------------------------------------------- arm masks
core_d5 = cv2.dilate(core, np.ones((11, 11), np.uint8))  # +-5px: "over torso" zone
core_d3 = cv2.dilate(core, np.ones((7, 7), np.uint8))    # +-3px: registered torso lines
PB = (165, 180, 280, 285)  # pelvis box: arm can't live here in mid/late frames

frame0 = aligned_rgb[0].astype(np.int16)
# "empty in frame 0": bright and >=2px away from any frame-0 line, so torso
# jitter (lines shifting +-1px) can never seed here -- only genuinely new
# lines (arms sweeping over previously-empty chest) can.
f0_gray = cv2.cvtColor(aligned_rgb[0], cv2.COLOR_BGR2GRAY)
f0_empty = cv2.erode((f0_gray > 170).astype(np.uint8), np.ones((5, 5), np.uint8))

# static structures: dark in >70% of all frames. The torso is registered, so
# ribs/lumbar/pelvis are static even where they deviate from the template;
# the moving arms never stay anywhere near that long (aim hold = ~46%).
freq = aligned_msk.mean(axis=0)
# static ink (dark in >70% of frames): torso structures even where they
# deviate from the template. Arms never stay put that long (aim hold ~46%).
# A mask component made almost entirely of static ink is junk; arm pixels
# overlapping static lines survive because their component also contains
# plenty of non-static arm pixels.
static_dark = cv2.dilate((freq > 0.7).astype(np.uint8), K3)

arm_masks = np.zeros((NF, CH, CW), np.uint8)
prev = np.zeros((CH, CW), np.uint8)
for i in range(NF):
    fg = aligned_msk[i]
    if i == 0:
        # pose matches the idle reference: arm = fg inside dilated ref mask
        out = fg & cv2.dilate(ref_arm, K3)
        arm_masks[i] = out
        prev = out
        continue
    base = fg & (1 - core_d5)               # arm parts outside torso silhouette
    base[0:75, :] = 0
    # mid: dark lines over the torso zone that are NOT registered torso lines
    # (torso is static after alignment, so >3px from a template line = arm)
    mid = fg & core_d5 & (1 - core_d3)
    mid[0:75, :] = 0
    # seed: new dark lines over frame-0-empty areas, near the arm's track;
    # recovers arm segments running within 3px of a rib (missed by mid)
    d = np.abs(aligned_rgb[i].astype(np.int16) - frame0).max(axis=2)
    seed = ((d > 45).astype(np.uint8)) & fg & f0_empty & core_d5
    seed[0:75, :] = 0
    near = cv2.dilate((base | mid | prev), np.ones((43, 43), np.uint8))
    seed = seed & near
    # grow seeds back to the full anti-aliased lines (+-2px), no line eating
    grown = fg & core_d5 & cv2.dilate(seed, np.ones((5, 5), np.uint8))
    m = (base | mid | grown).astype(np.uint8)
    n, lab, stats, cent = cv2.connectedComponentsWithStats(m, 8)
    out = np.zeros_like(m)
    kept = []
    for j in range(1, n):
        x, y, w, h, area = stats[j]
        if area < 60:
            continue
        comp = (lab == j)
        if float((comp & static_dark.astype(bool)).sum()) / area > 0.95:
            continue  # pure static structure (lumbar/pelvis redraw), not arm
        cx, cy = cent[j]
        if cy > 430:
            continue
        if i >= 25 and x >= PB[0] and y >= PB[1] and x + w <= PB[2] and y + h <= PB[3]:
            continue  # pelvis redraw noise
        out[comp] = 1
        kept.append(comp.astype(np.uint8))
    # bridge kept components whose neighbourhoods (+-15px) overlap: the arm
    # segment between them hugs a rib so tightly that no appearance test can
    # see it. Filling the lens with that frame's dark pixels adds the bone
    # (plus the rib pixels hidden underneath it -- visually identical).
    for a in range(len(kept)):
        for b in range(a + 1, len(kept)):
            lens = cv2.dilate(kept[a], np.ones((31, 31), np.uint8)) & \
                   cv2.dilate(kept[b], np.ones((31, 31), np.uint8)) & core_d5
            add = fg & lens
            if 0 < int(add.sum()) < 600:  # a bone segment is a few hundred px
                out |= add
    arm_masks[i] = out
    prev = out

for i in SRC:
    ys, xs = np.where(arm_masks[i] > 0)
    print("src", i, "arm px", int(arm_masks[i].sum()),
          "bbox", (int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())) if len(xs) else None)
    vis = aligned_rgb[i].copy()
    vis[arm_masks[i] > 0] = (0, 255, 0)
    cv2.imwrite(f"tmp_af_mask_{i:03d}.png", vis)

# ---------------------------------------------------------------- extract
def extract(i):
    m = arm_masks[i]
    # alpha from chroma distance to this frame's own background color
    bgr = aligned_rgb[i]
    bg = np.array([248, 248, 248], np.int16)
    d = np.abs(bgr.astype(np.int16) - bg).max(axis=2).astype(np.float32)
    a = np.clip((d - 10) / 30.0, 0, 1)
    interior = cv2.erode(m, K3)
    a = np.maximum(a, interior.astype(np.float32))
    a = a * cv2.dilate(m, K3).astype(np.float32)
    a8 = (a * 255).round().astype(np.uint8)
    # un-premultiply color against the pure background
    f = bgr.astype(np.float32)
    p = np.array([248, 248, 248], np.float32)
    aa = np.maximum(a, 0.05)[:, :, None]
    col = np.clip((f - (1 - aa) * p) / aa, 0, 255)
    solid = (a >= 0.95)[:, :, None]
    col = np.where(solid, f, col).astype(np.uint8)
    rgba = np.dstack([col, a8])
    # drop tiny specks
    na, laba, statsa, _ = cv2.connectedComponentsWithStats((a8 > 40).astype(np.uint8), 8)
    for j in range(1, na):
        if statsa[j, 4] < 45:
            rgba[laba == j] = 0
    return rgba


frames_rgba, hands = [], []
prev_h = None
for i in SRC:
    rgba = extract(i)
    frames_rgba.append(rgba)
    m = arm_masks[i]
    ys, xs = np.where(m > 0)
    # front hand: centroid of the rightmost 18% of arm pixels
    thr = xs.min() + 0.82 * (xs.max() - xs.min())
    sel = xs >= thr
    hx, hy = float(xs[sel].mean()), float(ys[sel].mean())
    if prev_h is not None and abs(hx - prev_h[0]) + abs(hy - prev_h[1]) > 30:
        print("WARN hand jump at src", i, (hx, hy), "prev", prev_h)
    prev_h = (hx, hy)
    hands.append({"x": round(hx, 1), "y": round(hy, 1)})
    print("src", i, "rgba px", int((rgba[:, :, 3] > 0).sum()), "hand", hands[-1])

strip = np.hstack(frames_rgba)

# -------------------------------------------------- 已知异物清理（重跑防回归）
# src55→帧11 提取时头部碎片泄漏（连通到手臂组件，无法按组件删）：
# 特征=帧11 独有（相邻帧无）且位于头肩区 (x195-236, y68-101) 的 ~446px 斑块。
# 若更换视频/参数后该区域不再是异物，删除本段。
_f11 = strip[:, 11 * CW:(11 + 1) * CW, 3] > 10
_f10 = strip[:, 10 * CW:(10 + 1) * CW, 3] > 10
_f12 = strip[:, 12 * CW:(12 + 1) * CW, 3] > 10
_only11 = _f11 & ~_f10 & ~_f12
_region11 = np.zeros_like(_only11)
_region11[68:101, 195:236] = True
_kill = _only11 & _region11
if _kill.sum() > 0:
    print("frame11 artifact cleanup:", int(_kill.sum()), "px")
    strip[:, 11 * CW:(11 + 1) * CW, :][_kill] = 0

cv2.imwrite("assets/player/gun_aim_frames.png", strip)
json.dump({"frames": list(range(len(SRC))), "srcFrames": SRC,
           "pivotX": PIVOT["pivotX"], "pivotY": PIVOT["pivotY"],
           "hands": hands},
          open("assets/player/gun_aim_frames.json", "w"), indent=2)
print("strip saved", strip.shape)

# ---------------------------------------------------------------- recheck
check_idx = [0, 3, 6, 9, 13]
black = np.zeros((CH, CW * len(check_idx), 3), np.uint8)
for k, fi in enumerate(check_idx):
    rgba = frames_rgba[fi]
    a = rgba[:, :, 3:4].astype(np.float32) / 255
    black[:, k * CW:(k + 1) * CW] = (rgba[:, :, :3].astype(np.float32) * a).astype(np.uint8)
    h = hands[fi]
    cv2.circle(black, (int(k * CW + h["x"]), int(h["y"])), 5, (0, 0, 255), -1)
    cv2.circle(black, (int(k * CW + PIVOT["pivotX"]), PIVOT["pivotY"]), 4, (0, 255, 255), -1)
# PIL save per task convention
from PIL import Image
Image.fromarray(cv2.cvtColor(black, cv2.COLOR_BGR2RGB)).save("tmp_af_recheck.png")
print("tmp_af_recheck.png saved")
