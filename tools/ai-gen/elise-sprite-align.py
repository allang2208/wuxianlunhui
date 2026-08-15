#!/usr/bin/env python3
"""伊莉丝全套精灵图重建（SKILL 对齐三铁律：高度固定 + 脚底固定 + 水平质心固定）。

按 game-dev/SKILL.md「人形角色视频→精灵图全流程」与 luna-run-align/hamster-walk-align
沉淀口径：每帧按内容质心 X 对齐到可行参考（clamp 到 [2,510] 不裁剪，尽量接近 256），
脚底固定到 FEET_Y；统一缩放不逐帧拉高（pose 高度变化读作真实姿态），单元格裁剪仅作
防串帧兜底（正常情况下内容已 clamp 在格内）。

各 sheet 缩放口径：
- idle/walking/running/defending：站姿内容高约 460-461（与露娜一致），脚底 480；
- attacking：源图挥剑帧宽达 262，512 格内取统一缩放 1.75（站姿≈300 高），
  保证宽帧完整不贴边；剑举过头帧 f5 顶部剑尖在 512 格内优先保剑完整；
- windmill：旋转剑弧宽达 319，统一缩放 1.52（身≈230 高），保证剑弧完整。

用法：
  python tools/ai-gen/elise-sprite-align.py
  （输出到 assets/companions/elise/，源图来自 素材库/人物/Elise，需先复制到 src 目录）
"""
import os

import numpy as np
from PIL import Image
from scipy import ndimage

SRC = os.environ.get("ELISE_SRC")
DST = os.environ.get("ELISE_DST")
CELL = 512
ALPHA_MIN = 16  # 与 SKILL 度量口径一致：alpha>16 算内容（attacking f5 剑尖仅 alpha 16~40，40 会断剑）
NEAR_GAP = 24
FEET_Y = 480
TARGET_X = 256.0
LO, HI = 2, 510
SCALES = {
    "idle.png": 461.0 / 171.0,   # ≈2.696，站姿 461 高（露娜同款）
    "walking.png": 461.0 / 179.0,  # ≈2.575，站姿 461 高
    "running.png": 461.0 / 182.0,  # ≈2.533，站姿 461 高（源图最高 182）
    "defending.png": 461.0 / 177.0,  # ≈2.605，站姿 461 高（f12/f13 噪声由 clean_mask 剔除）
    "attacking.png": 1.75,        # 262 宽挥剑帧完整入格（1.80 时最宽帧会溢出右缘 511）
    "windmill.png": 1.52,         # 319 宽旋转剑弧完整入格
}
# 需要连通域去噪的 sheet（defend f12/f13 右下角有独立噪点）；其余用完整 alpha 掩码，
# 避免把 attacking f5 剑尖 / windmill 剑弧等细长部件当噪点剔除
NOISE_CLEAN = {"defending.png"}
# attacking f5（剑举过头）单独缩放：512 格内保整把剑完整
SPECIAL_SCALE = {( "attacking.png", 5): 480.0 / 333.0}  # ≈1.441：脚底 480 内整把剑（含剑尖）完整入格


def clean_mask(cell):
    """主连通域 + 24px 内邻近部件；剔除源图散布噪点（defend f12/f13 右下角 9px 脏点）。"""
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
    """完整 alpha 掩码：attacking/windmill 用，保留剑尖/剑弧等细长部件。"""
    m = cell[..., 3] > ALPHA_MIN
    if m.sum() <= 300:
        return None
    return m


def mass_x(rgba):
    a = rgba[..., 3] > 16
    if a.sum() == 0:
        return None
    return float((a.sum(axis=0) * np.arange(a.shape[1])).sum() / a.sum())


def rebuild(fname, dry=False):
    base_scale = SCALES[fname]
    img = Image.open(os.path.join(SRC, fname)).convert("RGBA")
    arr = np.asarray(img)
    cols = img.width // CELL
    rows = img.height // CELL
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    frames = 0
    placed = []
    warnings = []
    for r in range(rows):
        for c in range(cols):
            cell = arr[r * CELL:(r + 1) * CELL, c * CELL:(c + 1) * CELL]
            keep = clean_mask(cell) if fname in NOISE_CLEAN else raw_mask(cell)
            if keep is None:
                continue
            idx = r * cols + c
            scale = SPECIAL_SCALE.get((fname, idx), base_scale)
            ys, xs = np.where(keep)
            top, bottom = int(ys.min()), int(ys.max())
            left, right = int(xs.min()), int(xs.max())
            w = right - left + 1
            h = bottom - top + 1
            nw = max(1, int(round(w * scale)))
            nh = max(1, int(round(h * scale)))
            keep_region = keep[top:bottom + 1, left:right + 1]
            clean = Image.new("RGBA", (w, h), (0, 0, 0, 0))
            region = img.crop((c * CELL + left, r * CELL + top,
                               c * CELL + right + 1, r * CELL + bottom + 1))
            clean.paste(region, (0, 0), Image.fromarray((keep_region * 255).astype(np.uint8)))
            clean = clean.resize((nw, nh), Image.LANCZOS)
            rgba = np.asarray(clean)
            # 水平参考 = 帧内容质心（露娜 luna-run-align 同款：内容质心对齐，不裁剪）
            cx = mass_x(rgba)
            if cx is None:
                continue
            # 水平：帧内容质心尽量对齐到 256；平移量 clamp 到内容不越界区间（不裁剪）
            dx_ideal = TARGET_X - cx
            dx_min = LO  # 内容左缘 ≥ 2
            dx_max = HI - (nw - 1)  # 内容右缘 ≤ 510
            dx = int(round(max(dx_min, min(dx_max, dx_ideal))))
            # 垂直：内容底边（脚底）固定到 FEET_Y
            dy = FEET_Y - nh
            # 单元格内裁剪兜底（正常 clamp 后不触发；防串帧）
            x0 = max(0, dx)
            y0 = max(0, dy)
            x1 = min(CELL, dx + nw)
            y1 = min(CELL, dy + nh)
            if x1 <= x0 or y1 <= y0:
                warnings.append(f"{fname} f{idx}: 完全出格 ({dx},{dy},{nw}x{nh})")
                continue
            crop = clean.crop((x0 - dx, y0 - dy, x1 - dx, y1 - dy))
            if dry:
                out.paste(crop, (c * CELL + x0, r * CELL + y0), crop)
            else:
                out.paste(crop, (c * CELL + x0, r * CELL + y0), crop)
            placed.append((idx, dx, nw, nh, cx + dx))
            frames += 1
    if not dry:
        check = np.asarray(out)
        n_alpha = int((check[..., 3] > 16).sum())
        if n_alpha == 0:
            print(f"  WARN {fname}: 输出 alpha 全空，跳过保存")
            return placed
        out.save(os.path.join(DST, fname), format="PNG")
    mxs = [p[4] for p in placed]
    widths = [p[2] for p in placed]
    heights = [p[3] for p in placed]
    xs0 = [p[1] for p in placed]
    print(f"{fname}: frames={frames} scale={scale:.3f} "
          f"massX span={min(mxs):.1f}~{max(mxs):.1f} ({max(mxs)-min(mxs):.1f}px) "
          f"w={min(widths)}~{max(widths)} h={min(heights)}~{max(heights)} "
          f"shift={min(xs0)}~{max(xs0)}")
    for wmsg in warnings:
        print("  WARN", wmsg)
    return placed


if __name__ == "__main__":
    if not SRC or not DST:
        raise SystemExit("请设置 ELISE_SRC / ELISE_DST 环境变量")
    os.makedirs(DST, exist_ok=True)
    for f in SCALES:
        rebuild(f)
