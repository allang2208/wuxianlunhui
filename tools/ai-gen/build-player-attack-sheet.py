#!/usr/bin/env python3
"""玩家攻击 H3 视频 → 512×512 精灵图（两种模式）。

模式 A（两段拼接，关键帧管线）：
  AB 段(A起手→B命中) + BC 段(B命中→C收势) 两个视频按视觉均匀重采样拼接；
  BC 首帧与 AB 末帧同为 B 姿势，去重防接缝定格。
模式 B（单段直剪，绿幕管线，2026-08-15 v4 挥砍启用）：
  --video 单个绿幕视频直接剪 N 帧（同 thrust_v2 配方：56 帧快动作 → 12 帧 sheet）。

公共处理（对齐 SKILL.md §552 管线 + prep-melee3 v2 入库惯例）：
  1. 抠底：纯色底 max 通道距 > --bg-thr → 3×3 闭运算填孔 → 高斯羽化软边；
  2. 去底色溢色：alpha>0 且背景色度超标（黄底 min(R,G)-B>24 / 绿底 G-max(R,B)>24）
     → RGB 替换为亮度均值；随后**全部不透明像素强制亮度化**——主体是纯灰度骨骼，
     任何色度都是视频色偏伪影（v4 s02 挥砍帧骨骼泛品红实测）；
  3. 活动窗口：相邻帧视觉差（fg 并集上 mean|ΔRGB|）5 帧滑动平均，阈值=峰值×--win-ratio；
     可用 --ab-end/--bc-end/--end 手动截断（切收尾静止段防稀释采样；两段模式
     AB 末帧必须已是 B 姿势才能接 BC）；
  4. 选帧：窗口内按累计视觉差等距取帧（视觉均匀重采样，挥砍段自动加密）；
  5. 对齐三铁律 + keep-dx：固定缩放（首段帧0 身高 → --target-h，全部帧同一比例，
     防蹲姿放大——黑狼教训）、脚底基线 --feet-y、水平保留相对帧0 的格内位移（前移）；
  6. 零裁切 clamp + 空帧检查 + 逐帧统计输出。

用法（ComfyUI venv python，中文路径经 %TEMP% 中转）：
  rem 两段（关键帧黄底）：build-player-attack-sheet.py --ab-end 44 --bc-end 50
  rem 单段（绿幕）：build-player-attack-sheet.py --video ../player_melee3/slash1_v4_s01.mp4 ^
        --bg-hex 00FF00 --n 12 --end 50
"""

import argparse
import shutil
import tempfile
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

DEF_ROOT = Path(r"Y:\工作\无尽轮回\scratch\player_attack_sword")


def load_frames_rgb(video: Path):
    cap = cv2.VideoCapture(str(video))
    frames = []
    while True:
        ok, f = cap.read()
        if not ok:
            break
        frames.append(cv2.cvtColor(f, cv2.COLOR_BGR2RGB))
    cap.release()
    if not frames:
        raise RuntimeError(f"no frames decoded: {video}")
    return frames


def key_alpha(frame_rgb, bg, thr=45, feather=0.8):
    """纯色底抠图：max 通道距阈值 → 闭运算填孔 → 羽化；返回 uint8 alpha。"""
    dist = np.max(np.abs(frame_rgb.astype(np.int16) - bg.astype(np.int16)), axis=2)
    bgmask = (dist <= thr).astype(np.uint8)
    bgmask = cv2.morphologyEx(bgmask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    alpha = (1 - bgmask) * 255
    if feather > 0:
        alpha = cv2.GaussianBlur(alpha.astype(np.float32), (3, 3), feather)
    return np.clip(alpha, 0, 255).astype(np.uint8)


def despill_bg(frame_rgb, alpha, bg):
    """去底色溢色：alpha>0 且背景色度超 24 → RGB 替换为亮度均值。"""
    rgb = frame_rgb.astype(np.int32)
    r, g, b = rgb[:, :, 0], rgb[:, :, 1], rgb[:, :, 2]
    if int(bg[0]) > 200 and int(bg[1]) > 200 and int(bg[2]) < 60:    # 黄底
        spill = np.minimum(r, g) - b
    elif int(bg[1]) > 200 and int(bg[0]) < 60 and int(bg[2]) < 60:   # 绿底
        spill = g - np.maximum(r, b)
    else:
        raise ValueError(f"未支持的底色 #{bg[0]:02X}{bg[1]:02X}{bg[2]:02X}，请扩展 despill 规则")
    mask = (alpha > 0) & (spill > 24)
    lum = np.round(rgb.mean(axis=2)).astype(np.int32)
    out = frame_rgb.copy()
    for c in range(3):
        ch = out[:, :, c]
        ch[mask] = lum[mask]
    return out, int(mask.sum())


def bbox_of(mask):
    ys, xs = np.nonzero(mask)
    if len(ys) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def motion_window(frames, alphas, smooth=5, ratio=0.05):
    """返回 [0, last_motion]；last_motion = 滑动平均帧差最后显著 (>峰值 ratio) 的帧号。"""
    diffs = np.zeros(len(frames))
    for i in range(1, len(frames)):
        union = (alphas[i - 1] > 10) | (alphas[i] > 10)
        if union.sum() == 0:
            continue
        d = np.abs(frames[i].astype(np.int16) - frames[i - 1].astype(np.int16)).mean(axis=2)
        diffs[i] = float(d[union].mean())
    kernel = np.ones(smooth) / smooth
    sm = np.convolve(diffs, kernel, mode="same")
    peak = sm.max()
    thr = peak * ratio
    act = np.nonzero(sm > thr)[0]
    last = int(act.max()) if len(act) else len(frames) - 1
    return 0, last, peak, thr


def visual_uniform_sample(frames, alphas, lo, hi, k):
    """[lo,hi] 内按累计视觉差等距取 k 帧（含两端点）。"""
    idx = np.arange(lo, hi + 1)
    cum = np.zeros(len(idx))
    for j in range(1, len(idx)):
        i = idx[j]
        union = (alphas[i - 1] > 10) | (alphas[i] > 10)
        d = np.abs(frames[i].astype(np.int16) - frames[i - 1].astype(np.int16)).mean(axis=2)
        cum[j] = cum[j - 1] + (float(d[union].mean()) if union.sum() else 0.0)
    total = cum[-1]
    if total <= 0:
        return [int(lo + round(t * (hi - lo) / max(1, k - 1))) for t in range(k)]
    targets = np.linspace(0, total, k)
    picked = []
    for t in targets:
        j = int(np.searchsorted(cum, t))
        j = min(max(j, 0), len(idx) - 1)
        # 取累计差更接近 t 的相邻帧
        if j > 0 and abs(cum[j] - t) > abs(cum[j - 1] - t):
            j -= 1
        picked.append(int(idx[j]))
    # 去重保序（极端平坦段可能撞帧）
    out = []
    for p in picked:
        if not out or p > out[-1]:
            out.append(p)
    return out


def resolve_video(root, name_or_path):
    p = Path(name_or_path)
    if p.is_absolute() and p.exists():
        return p
    for cand in (root / "h3" / name_or_path, root / name_or_path, Path(name_or_path)):
        if cand.exists():
            return cand
    raise FileNotFoundError(f"找不到视频: {name_or_path}")


def build(seq, bg, out_sheet, out_gif, out_contact,
          cols, cell, target_h, feet_y, anchor_cx, scale_override=None,
          anchor_end_cx=None):
    """seq = [(frame_rgb, alpha, tag), ...]；首项必须是站立参考帧（帧0）。
    scale_override：连段第二段起复用前一段的缩放（角色/相机同族视频，高度基准帧不是站姿，
    不能用 ref 帧反推）。
    anchor_end_cx：末帧格内中心目标（连段收势回中/落脚点对齐用）；基底从 anchor_cx
    线性滑到 (anchor_end_cx - 末帧自然dx)，再叠加各帧自然 dx——f0 精确落在 anchor_cx、
    末帧精确落在 anchor_end_cx，中间帧平滑过渡且不丢段内位移。"""
    # 固定缩放：帧0 身高 → target_h（黑狼教训：逐帧缩放会放大蹲姿/裁切宽帧）
    b0 = bbox_of(seq[0][1] > 30)
    ref_h = b0[3] - b0[1] + 1
    ref_cx = (b0[0] + b0[2]) / 2
    scale = scale_override if scale_override else target_h / ref_h
    print(f"[build] ref_h {ref_h} → scale {scale:.4f}（{'外部指定' if scale_override else '全部帧同比例'}）")

    cells = []
    stats = []
    spill_total = 0
    nseq = len(seq)
    # 末帧自然 dx（keep-dx 口径）预先算出，供 anchor_end_cx 基底反推
    dx_last = 0
    if anchor_end_cx is not None and nseq > 1:
        bx = bbox_of(seq[-1][1] > 30)
        dx_last = round((((bx[0] + bx[2]) / 2) - ref_cx) * scale)
    for k, (frame, alpha, tag) in enumerate(seq):
        desp, n_spill = despill_bg(frame, alpha, bg)
        # 主体=纯灰度骨骼：所有不透明像素强制亮度化，消除视频逐帧色偏
        # （v4 s02 实测挥砍帧骨骼泛品红；同 prep-melee3 中性化思路，但更彻底）
        g = np.round(desp.astype(np.int32).mean(axis=2)).astype(np.uint8)
        desp = np.where((alpha > 0)[:, :, None], np.dstack([g, g, g]), desp)
        spill_total += n_spill
        box = bbox_of(alpha > 30)
        x0, y0, x1, y1 = box
        crop = desp[y0:y1 + 1, x0:x1 + 1]
        a = alpha[y0:y1 + 1, x0:x1 + 1]
        nw = max(1, round((x1 - x0 + 1) * scale))
        nh = max(1, round((y1 - y0 + 1) * scale))
        crop = cv2.resize(crop, (nw, nh), interpolation=cv2.INTER_AREA)
        a = cv2.resize(a, (nw, nh), interpolation=cv2.INTER_AREA)
        cx = (x0 + x1) / 2
        dx = round((cx - ref_cx) * scale)  # keep-dx：保留前移
        if anchor_end_cx is not None and nseq > 1:
            t = k / (nseq - 1)
            base_cx = anchor_cx + (anchor_end_cx - dx_last - anchor_cx) * t
        else:
            base_cx = anchor_cx
        canvas = np.zeros((cell, cell, 4), np.uint8)
        ox = int(round(base_cx - nw / 2 + dx))
        oy = int(feet_y - nh + 1)
        ox_c = max(0, min(ox, cell - nw))
        oy_c = max(0, min(oy, cell - nh))
        if ox_c != ox or oy_c != oy:
            print(f"[build] WARN {tag} clamped ({ox},{oy})→({ox_c},{oy_c}) {nw}x{nh}")
        canvas[oy_c:oy_c + nh, ox_c:ox_c + nw] = np.dstack([crop, a])
        cells.append(canvas)
        stats.append((tag, oy_c, oy_c + nh - 1, nh, ox_c + nw / 2, nw, dx))

    while len(cells) % cols != 0:
        cells.append(np.zeros((cell, cell, 4), np.uint8))
    rows = [np.hstack(cells[r * cols:(r + 1) * cols]) for r in range(len(cells) // cols)]
    sheet = np.vstack(rows)

    # 空帧检查（alpha>10 像素 <50 = 空）
    for i, c in enumerate(cells[:len(seq)]):
        n = int((c[:, :, 3] > 10).sum())
        if n < 50:
            print(f"[build] ERROR 空帧 cell {i}（{n}px）")
        stats[i] = stats[i] + (n,)

    print(f"[build] 溢色处理 px 合计 {spill_total}")
    print("[build] 逐帧: tag top feet h cx w dx opaque_px")
    for s in stats:
        print(f"  {s[0]:>6} top={s[1]:3d} feet={s[2]:3d} h={s[3]:3d} "
              f"cx={s[4]:6.1f} w={s[5]:3d} dx={s[6]:+4d} px={s[7]}")

    tmp = Path(tempfile.gettempdir()) / "player_attack_sheet_build"
    tmp.mkdir(parents=True, exist_ok=True)
    tmp_sheet = tmp / Path(out_sheet).name
    Image.fromarray(sheet).save(str(tmp_sheet))
    out_sheet = Path(out_sheet)
    out_sheet.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(str(tmp_sheet), str(out_sheet))
    print(f"[build] sheet → {out_sheet} {sheet.shape[1]}x{sheet.shape[0]}")

    # GIF 预览（品红底）+ 深灰底 contact 检查图
    mag = np.array([255, 0, 255], np.uint8)
    dark = np.array([40, 40, 48], np.uint8)
    pv, contact_cells = [], []
    for c in cells[:len(seq)]:
        rgb = c[:, :, :3].astype(np.float32)
        al = (c[:, :, 3:4].astype(np.float32) / 255)
        pv.append(Image.fromarray(np.clip(rgb * al + mag * (1 - al), 0, 255).astype(np.uint8)))
        contact_cells.append(np.clip(rgb * al + dark * (1 - al), 0, 255).astype(np.uint8))
    if out_gif:
        tmp_gif = tmp / Path(out_gif).name
        small = [p.resize((256, 256), Image.LANCZOS) for p in pv]
        small[0].save(str(tmp_gif), save_all=True, append_images=small[1:], duration=50, loop=0)
        out_gif = Path(out_gif)
        shutil.copyfile(str(tmp_gif), str(out_gif))
        print(f"[build] gif → {out_gif}")
    if out_contact:
        half = [cv2.resize(c, (256, 256), interpolation=cv2.INTER_AREA) for c in contact_cells]
        crows = [np.hstack(half[r * cols:(r + 1) * cols]) for r in range(len(half) // cols)]
        contact = np.vstack(crows)
        tmp_c = tmp / Path(out_contact).name
        Image.fromarray(contact).save(str(tmp_c))
        out_contact = Path(out_contact)
        shutil.copyfile(str(tmp_c), str(out_contact))
        print(f"[build] contact → {out_contact}")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--video", default=None,
                    help="单段模式：绿幕视频（h3/ 下文件名或绝对路径），与 --ab/--bc 互斥")
    ap.add_argument("--ab", default="attack_sword_ab_s01.mp4", help="两段模式：h3/ 下的 AB 段视频")
    ap.add_argument("--bc", default="attack_sword_bc_s01.mp4", help="两段模式：h3/ 下的 BC 段视频")
    ap.add_argument("--root", default=str(DEF_ROOT))
    ap.add_argument("--out", default=None, help="输出 sheet PNG（默认 root/sheet/attack_sword_sheet.png）")
    ap.add_argument("--n", type=int, default=12, help="单段模式取帧数")
    ap.add_argument("--n-ab", type=int, default=5, help="两段模式 AB 段取帧数")
    ap.add_argument("--n-bc", type=int, default=8, help="两段模式 BC 段取帧数（首帧去重后 n-1 入图）")
    ap.add_argument("--cols", type=int, default=4)
    ap.add_argument("--cell", type=int, default=512)
    ap.add_argument("--target-h", type=int, default=432, help="站立身高（现 attack_sword.png 实测）")
    ap.add_argument("--feet-y", type=int, default=492, help="脚底基线（现 attack_sword.png 实测）")
    ap.add_argument("--anchor-cx", type=float, default=209.5, help="帧0 格内中心（现 attack_sword.png 实测）")
    ap.add_argument("--scale", type=float, default=None,
                    help="外部指定缩放（连段第二段起复用前段 scale，如一段的 0.7742）；"
                         "缺省=帧0 身高反推 target_h")
    ap.add_argument("--anchor-end-cx", type=float, default=None,
                    help="末帧格内中心目标（缺省=同 anchor-cx 不滑移）；连段回中/落脚点统一用")
    ap.add_argument("--bg-hex", default=None,
                    help="底色 #RRGGBB（缺省读 keyframes/bg.txt；绿幕视频传 00FF00）")
    ap.add_argument("--bg-thr", type=float, default=45)
    ap.add_argument("--win-ratio", type=float, default=0.05,
                    help="活动窗口检测阈值=峰值帧差×此值；调大可切掉收尾静止段")
    ap.add_argument("--end", type=int, default=-1, help="单段模式窗口终点（-1=自动）")
    ap.add_argument("--picks", default=None,
                    help="单段模式手动指定取帧列表（逗号分隔），跳过自动采样——"
                         "用于战略性跳过剑影帧（挥砍瞬间的月牙伪影帧直接不取，闪切增冲击）")
    ap.add_argument("--erase", default=None,
                    help="单段模式剑影/残迹抹除：帧号:x0:y0:x1:y1（视频像素坐标），多个逗号分隔；"
                         "用该帧边框中位底色填充矩形（绿幕均匀底专用）")
    ap.add_argument("--ab-end", type=int, default=-1,
                    help="AB 段窗口终点手指定（-1=自动）；末帧必须已是 B 姿势才能接 BC")
    ap.add_argument("--bc-end", type=int, default=-1,
                    help="BC 段窗口终点手指定（-1=自动）；切掉 C 姿势后的静止尾巴")
    args = ap.parse_args()

    root = Path(args.root)
    if args.bg_hex:
        bg_hex = args.bg_hex.lstrip("#")
    else:
        bg_hex = (root / "keyframes" / "bg.txt").read_text(encoding="ascii").strip()
    bg = np.array([int(bg_hex[i:i + 2], 16) for i in (0, 2, 4)], dtype=np.int16)
    print(f"[build] bg=#{bg_hex.upper()}")

    seq = []
    if args.video:
        vp = resolve_video(root, args.video)
        frames = load_frames_rgb(vp)
        if args.erase:
            for item in args.erase.split(","):
                fi, ex0, ey0, ex1, ey1 = (int(v) for v in item.split(":"))
                fr = frames[fi]
                border = np.concatenate([fr[0:8].reshape(-1, 3), fr[-8:].reshape(-1, 3),
                                         fr[:, 0:8].reshape(-1, 3), fr[:, -8:].reshape(-1, 3)], axis=0)
                fill = np.median(border, axis=0).astype(np.uint8)
                fr[ey0:ey1, ex0:ex1] = fill
                print(f"[build] erase f{fi} [{ex0},{ey0},{ex1},{ey1}] fill={fill.tolist()}")
        alphas = [key_alpha(f, bg, thr=args.bg_thr) for f in frames]
        if args.picks:
            picks = [int(x) for x in args.picks.split(",") if x.strip()]
            assert len(picks) == args.n, f"--picks {len(picks)} 帧 ≠ --n {args.n}"
            print(f"[build] manual picks {picks}")
        else:
            lo, hi, peak, thr = motion_window(frames, alphas, ratio=args.win_ratio)
            if args.end >= 0:
                hi = min(args.end, len(frames) - 1)
            print(f"[build] window [{lo},{hi}] peak {peak:.2f} thr {thr:.2f} / {len(frames)}f")
            picks = visual_uniform_sample(frames, alphas, lo, hi, args.n)
            print(f"[build] picks {picks}")
        seq = [(frames[i], alphas[i], f"f{i}") for i in picks]
    else:
        ab_frames = load_frames_rgb(resolve_video(root, args.ab))
        bc_frames = load_frames_rgb(resolve_video(root, args.bc))
        ab_alpha = [key_alpha(f, bg, thr=args.bg_thr) for f in ab_frames]
        bc_alpha = [key_alpha(f, bg, thr=args.bg_thr) for f in bc_frames]
        ab_lo, ab_hi, ab_peak, ab_thr = motion_window(ab_frames, ab_alpha, ratio=args.win_ratio)
        bc_lo, bc_hi, bc_peak, bc_thr = motion_window(bc_frames, bc_alpha, ratio=args.win_ratio)
        if args.ab_end >= 0:
            ab_hi = min(args.ab_end, len(ab_frames) - 1)
        if args.bc_end >= 0:
            bc_hi = min(args.bc_end, len(bc_frames) - 1)
        print(f"[build] AB window [{ab_lo},{ab_hi}] peak {ab_peak:.2f} thr {ab_thr:.2f} / {len(ab_frames)}f")
        print(f"[build] BC window [{bc_lo},{bc_hi}] peak {bc_peak:.2f} thr {bc_thr:.2f} / {len(bc_frames)}f")
        ab_idx = visual_uniform_sample(ab_frames, ab_alpha, ab_lo, ab_hi, args.n_ab)
        bc_idx = visual_uniform_sample(bc_frames, bc_alpha, bc_lo, bc_hi, args.n_bc)
        if len(bc_idx) > 1:
            bc_idx = bc_idx[1:]  # 去 BC 首帧（=B 姿势，与 AB 末帧重复）
        print(f"[build] AB picks {ab_idx}")
        print(f"[build] BC picks {bc_idx} (首帧已去重)")
        seq = [(ab_frames[i], ab_alpha[i], f"ab{i}") for i in ab_idx]
        seq += [(bc_frames[i], bc_alpha[i], f"bc{i}") for i in bc_idx]

    out = args.out or str(root / "sheet" / "attack_sword_sheet.png")
    out_p = Path(out)
    build(seq, bg, out,
          str(out_p.with_suffix(".gif")),
          str(out_p.with_name(out_p.stem + "_contact.png")),
          args.cols, args.cell, args.target_h, args.feet_y, args.anchor_cx,
          scale_override=args.scale, anchor_end_cx=args.anchor_end_cx)


if __name__ == "__main__":
    main()
