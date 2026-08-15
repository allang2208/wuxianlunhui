#!/usr/bin/env python3
"""伊莉丝六动作精灵图统一尺度重建（v2，2026-08-17）。

v1（512 格一刀切）的问题：attacking/windmill 因剑弧过宽被迫用更小缩放（1.75/1.52），
游戏内角色在挥剑/风车时缩到走路体型的 65%/53%；attack f5 剑举过头帧单独缩放（身体 245）；
512 格下宽帧质心对齐被 clamp（run 循环帧水平跳 18.8px、defend 持盾帧右偏 13px）。

v2 口径（对齐三铁律 + 跨动作统一尺度）：
- 全局统一缩放 S = 461/171 ≈ 2.696：六动作同一尺度，站立身体内容高 461（与露娜一致）；
  步幅/下蹲/挥剑帧因姿态自然更高/更宽，按 SKILL 铁律「统一缩放不逐帧拉高」保留真实姿态；
- 脚底固定：每 sheet FEET_Y = 0.9375 × 格高（512→480 / 640→600 / 1024→960），
  各动作脚底偏移量只与格高相关，渲染侧可按同一公式归一化；
- 水平质心对齐：每帧内容质心（alpha>16 口径）对齐到格心，clamp 到 [2, 格宽-2] 不裁剪；
  格宽按「最大内容宽 + 质心对齐余量」选型，保证任何帧零 clamp（质心跨度 = 0）；
- 格规格（按最大内容选型）：idle 512²（299×461）、walk/run/defend 640²、
  attacking 960×1024（f11 挥剑宽 706 / f5 举剑高 898）、windmill 896×640（剑弧宽 860）；
  帧格可非正方形，Phaser frameWidth/frameHeight 独立配置；游戏显示尺寸由渲染归一化控制，
  与格分辨率无关（露娜跳跃用 640 格的同款先例）。

用法：
  set ELISE_SRC=<源图目录>  （8×4 512 格的素材库原件）
  set ELISE_DST=<输出目录>  （assets/companions/elise/）
  python tools/ai-gen/elise-sprite-align.py
"""
import os

import numpy as np
from PIL import Image
from scipy import ndimage

SRC = os.environ.get("ELISE_SRC")
DST = os.environ.get("ELISE_DST")

S = 461.0 / 171.0  # 统一尺度：站立身体内容高 461（源 idle f0 高 171）
ALPHA_MIN = 16      # 度量口径 alpha>16（attacking f5 剑尖仅 16~40，40 会断剑）
NEAR_GAP = 24

# name -> (cellW, cellH, feetY, cols, rows, expected_frames)
SHEETS = {
    "idle.png":      (512, 512, 480, 1, 1, 1),
    "walking.png":   (640, 640, 600, 4, 4, 14),
    "running.png":   (640, 640, 600, 5, 5, 23),
    "defending.png": (640, 640, 600, 4, 5, 19),
    "attacking.png": (960, 1024, 960, 5, 6, 28),
    "windmill.png":  (896, 640, 600, 5, 5, 23),
}
# 连通域去噪仅用于确实有散布噪点的 sheet（defend f12/f13 右下角脏点）；其余用完整 alpha
# 掩码，避免把 attacking f5 剑尖 / windmill 剑弧等细长部件当噪点剔除
NOISE_CLEAN = {"defending.png"}


def clean_mask(cell):
    """主连通域 + 24px 内邻近部件；剔除源图散布噪点。"""
    alpha = cell[..., 3] > ALPHA_MIN
    if alpha.sum() <= 300:
        return None
    labels, n = ndimage.label(alpha)
    sizes = ndimage.sum(alpha, labels, range(1, n + 1))
    main = int(np.argmax(sizes)) + 1
    keep = labels == main
    ys, xs = np.where(keep)
    main_box = (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()))
    for k in range(1, n + 1):
        if k == main or int(sizes[k - 1]) < 8:
            continue
        ys2, xs2 = np.where(labels == k)
        ex = (int(xs2.min()), int(ys2.min()), int(xs2.max()), int(ys2.max()))
        dx = max(0, max(ex[0] - main_box[2], main_box[0] - ex[2]))
        dy = max(0, max(ex[1] - main_box[3], main_box[1] - ex[3]))
        if dx <= NEAR_GAP and dy <= NEAR_GAP:
            keep |= labels == k
    return keep


def raw_mask(cell):
    m = cell[..., 3] > ALPHA_MIN
    if m.sum() <= 300:
        return None
    return m


def mass_x(rgba):
    a = rgba[..., 3] > 16
    if a.sum() == 0:
        return None
    return float((a.sum(axis=0) * np.arange(a.shape[1])).sum() / a.sum())


def rebuild(fname, spec):
    cell_w, cell_h, feet_y, cols, rows, expect = spec
    img = Image.open(os.path.join(SRC, fname)).convert("RGBA")
    arr = np.asarray(img)
    src_cols = img.width // 512
    src_rows = img.height // 512
    out = Image.new("RGBA", (cols * cell_w, rows * cell_h), (0, 0, 0, 0))
    placed = []
    warnings = []
    for r in range(src_rows):
        for c in range(src_cols):
            cell = arr[r * 512:(r + 1) * 512, c * 512:(c + 1) * 512]
            keep = clean_mask(cell) if fname in NOISE_CLEAN else raw_mask(cell)
            if keep is None:
                continue
            idx = r * src_cols + c
            if idx >= cols * rows:
                warnings.append(f"{fname} f{idx}: 超出输出网格容量")
                continue
            ys, xs = np.where(keep)
            top, bottom = int(ys.min()), int(ys.max())
            left, right = int(xs.min()), int(xs.max())
            w = right - left + 1
            h = bottom - top + 1
            nw = max(1, int(round(w * S)))
            nh = max(1, int(round(h * S)))
            keep_region = keep[top:bottom + 1, left:right + 1]
            clean = Image.new("RGBA", (w, h), (0, 0, 0, 0))
            region = img.crop((c * 512 + left, r * 512 + top,
                               c * 512 + right + 1, r * 512 + bottom + 1))
            clean.paste(region, (0, 0), Image.fromarray((keep_region * 255).astype(np.uint8)))
            clean = clean.resize((nw, nh), Image.LANCZOS)
            rgba = np.asarray(clean)
            cx = mass_x(rgba)
            if cx is None:
                warnings.append(f"{fname} f{idx}: 缩放后内容为空")
                continue
            # 水平：内容质心对齐格心 cell_w/2，clamp 到不越界区间（不裁剪）
            center_x = cell_w / 2.0
            dx_ideal = center_x - cx
            dx_min = 2
            dx_max = cell_w - 2 - (nw - 1)
            clamped = dx_ideal < dx_min or dx_ideal > dx_max
            dx = int(round(max(dx_min, min(dx_max, dx_ideal))))
            # 垂直：内容底边（脚底）固定 FEET_Y
            dy = feet_y - nh
            if dy < 2:
                warnings.append(f"{fname} f{idx}: 内容高 {nh} 超出格高 {cell_h}（feet {feet_y}）")
                continue
            x0, y0 = max(0, dx), max(0, dy)
            x1, y1 = min(cell_w, dx + nw), min(cell_h, dy + nh)
            crop = clean.crop((x0 - dx, y0 - dy, x1 - dx, y1 - dy))
            oc, orow = idx % cols, idx // cols
            out.paste(crop, (oc * cell_w + x0, orow * cell_h + y0), crop)
            if clamped:
                warnings.append(f"{fname} f{idx}: 质心对齐 clamp（dx={dx}）")
            placed.append((idx, cx + dx))
    if not placed:
        raise SystemExit(f"FAIL {fname}: 无任何帧放置成功")
    mxs = [p[1] for p in placed]
    # 输出后验：逐帧重扫输出格
    out_arr = np.asarray(out)
    edge_frames = []
    heights = []
    for (idx, _) in placed:
        oc, orow = idx % cols, idx // cols
        cell = out_arr[orow * cell_h:(orow + 1) * cell_h, oc * cell_w:(oc + 1) * cell_w]
        a = cell[..., 3] > 16
        n = int(a.sum())
        if n == 0:
            warnings.append(f"{fname} f{idx}: 输出后验为空")
            continue
        ys, xs = np.where(a)
        heights.append(int(ys.max() - ys.min() + 1))
        if ys.min() <= 0 or ys.max() >= cell_h - 1 or xs.min() <= 0 or xs.max() >= cell_w - 1:
            edge_frames.append(idx)
    out.save(os.path.join(DST, fname), format="PNG")
    ok = len(placed) == expect and not edge_frames
    print(f"{'OK ' if ok else 'FAIL'} {fname}: frames={len(placed)}/{expect} "
          f"cell={cell_w}x{cell_h} feet={feet_y} grid={cols}x{rows} "
          f"massX span={max(mxs) - min(mxs):.1f}px ({min(mxs):.1f}~{max(mxs):.1f}) "
          f"h={min(heights)}~{max(heights)} edge_frames={edge_frames or '无'}")
    for wmsg in warnings:
        print("  WARN", wmsg)
    return ok


if __name__ == "__main__":
    if not SRC or not DST:
        raise SystemExit("请设置 ELISE_SRC / ELISE_DST 环境变量")
    os.makedirs(DST, exist_ok=True)
    all_ok = True
    for f, spec in SHEETS.items():
        all_ok &= rebuild(f, spec)
    raise SystemExit(0 if all_ok else 1)
