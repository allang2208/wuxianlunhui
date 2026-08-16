#!/usr/bin/env python3
"""attack_sword H3 产物定量分析。

不依赖 GPU/BiRefNet，只用 PyAV + PIL + numpy：
1. 验证关键帧 A/B/C 对齐与纯色底；
2. 抽帧分析 AB/BC 视频：漂移、贴边、背景残差、上半身左右运动密度；
3. 输出 contact sheet 和 JSON 报告，便于选 seed。

用法（ComfyUI venv python 或任意带 av/PIL/numpy 的 python）：
  python analyze-player-attack-sword.py --out-root <player_attack_sword 根目录>
"""

import argparse
import json
import os
import shutil
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

try:
    import av
except Exception as exc:  # pragma: no cover
    raise SystemExit(f"PyAV not available: {exc}")


def ascii_copy(src: Path, work: Path):
    dst = work / src.name
    shutil.copyfile(str(src), str(dst))
    return dst


def load_rgb(path):
    with Image.open(str(path)) as im:
        return np.array(im.convert("RGB")).astype(np.int16)


def load_rgba(path):
    with Image.open(str(path)) as im:
        return np.array(im.convert("RGBA")).astype(np.int16)


def bg_distance(frame, bg):
    # 兼容 (H,W,3) 帧与 (N,3) 边界样本两种形状
    return np.max(np.abs(frame - bg), axis=-1)


def fg_mask(frame, bg, thr=45):
    return bg_distance(frame, bg) > thr


def bbox_of(mask):
    ys, xs = np.where(mask)
    if len(ys) == 0:
        return None
    return [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]


def analyze_keyframes(key_dir: Path, work: Path, bg):
    report = []
    labels = ["A_start", "B_hit", "C_recover"]
    for label in labels:
        flat_src = key_dir / f"{label}_flat.png"
        rgba_src = key_dir / f"{label}_rgba.png"
        flat = load_rgb(ascii_copy(flat_src, work))
        rgba = load_rgba(ascii_copy(rgba_src, work))
        alpha = rgba[:, :, 3]
        mask = alpha > 16
        box = bbox_of(mask)
        h, w = flat.shape[:2]
        border = np.concatenate([
            flat[0:8, :, :].reshape(-1, 3),
            flat[-8:, :, :].reshape(-1, 3),
            flat[:, 0:8, :].reshape(-1, 3),
            flat[:, -8:, :].reshape(-1, 3),
        ], axis=0)
        bg_dev = float(np.mean(bg_distance(border, bg)))
        report.append({
            "label": label,
            "canvas": [w, h],
            "bbox": box,
            "alpha_px": int((alpha > 16).sum()),
            "bg_border_dev": round(bg_dev, 2),
            "content_w": None if not box else box[2] - box[0] + 1,
            "content_h": None if not box else box[3] - box[1] + 1,
            "center_x": None if not box else round((box[0] + box[2]) / 2, 1),
            "feet_y": None if not box else box[3] + 1,
        })
    return report


def analyze_video(mp4: Path, work: Path, bg, step=4):
    src = ascii_copy(mp4, work)
    container = av.open(str(src))
    stream = container.streams.video[0]
    stream.thread_type = "AUTO"
    prev = None
    prev_mask = None
    frames = []
    raw_rows = []
    bg_rgb = np.array(bg, dtype=np.int16)

    for idx, frame in enumerate(container.decode(stream)):
        arr = frame.to_ndarray(format="rgb24").astype(np.int16)
        h, w = arr.shape[:2]
        mask = fg_mask(arr, bg_rgb)
        box = bbox_of(mask)
        border = np.concatenate([
            arr[0:8, :, :].reshape(-1, 3),
            arr[-8:, :, :].reshape(-1, 3),
            arr[:, 0:8, :].reshape(-1, 3),
            arr[:, -8:, :].reshape(-1, 3),
        ], axis=0)
        row = {
            "frame": idx,
            "bbox": box,
            "fg_px": int(mask.sum()),
            "bg_border_dev": float(np.mean(bg_distance(border, bg_rgb))),
            "touch_edge": False,
        }
        if box is not None:
            x0, y0, x1, y1 = box
            row.update({
                "center_x": round((x0 + x1) / 2, 1),
                "bottom_y": y1,
                "content_w": x1 - x0 + 1,
                "content_h": y1 - y0 + 1,
                "touch_edge": bool(x0 <= 0 or y0 <= 0 or x1 >= w - 1 or y1 >= h - 1),
            })
            if prev is not None and prev_mask is not None:
                diff = np.max(np.abs(arr - prev), axis=2)
                mov = (diff > 30) & (mask | prev_mask)
                # 上半身 62%%，左右按身体中线分；下半身 25%% 看迈步。
                body_h = max(1, y1 - y0 + 1)
                mid_x = (x0 + x1) / 2.0
                top_y0 = y0
                top_y1 = y0 + int(round(body_h * 0.62))
                leg_y0 = y0 + int(round(body_h * 0.70))
                top_zone = mov[top_y0:top_y1 + 1, x0:x1 + 1]
                leg_zone = mov[leg_y0:y1 + 1, x0:x1 + 1]
                top_h, top_w = top_zone.shape
                split = int(round(mid_x - x0))
                left_zone = top_zone[:, :max(0, split)]
                right_zone = top_zone[:, min(top_w, split):]
                left_fg = int(((mask | prev_mask)[top_y0:top_y1 + 1, x0:x1 + 1])[:, :max(0, split)].sum())
                right_fg = int(((mask | prev_mask)[top_y0:top_y1 + 1, x0:x1 + 1])[:, min(top_w, split):].sum())
                row.update({
                    "left_upper_motion": int(left_zone.sum()),
                    "right_upper_motion": int(right_zone.sum()),
                    "left_upper_fg": max(1, left_fg),
                    "right_upper_fg": max(1, right_fg),
                    "leg_motion": int(leg_zone.sum()),
                })
        raw_rows.append(row)
        prev = arr
        prev_mask = mask
        if idx % step == 0:
            frames.append(arr)

    contact = None
    if frames:
        cell = 256
        cols = 4
        rows = int(np.ceil(len(frames) / cols))
        canvas = np.zeros((rows * cell, cols * cell, 3), np.uint8)
        for k, arr in enumerate(frames):
            r, c = divmod(k, cols)
            img = Image.fromarray(arr.astype(np.uint8)).resize((cell, cell), Image.LANCZOS)
            canvas[r * cell:(r + 1) * cell, c * cell:(c + 1) * cell] = np.array(img)
        contact = Image.fromarray(canvas)

    # 汇总
    def mean(key):
        vals = [r[key] for r in raw_rows if key in r]
        return float(np.mean(vals)) if vals else 0.0

    left_density = [r.get("left_upper_motion", 0) / r.get("left_upper_fg", 1) for r in raw_rows if "left_upper_motion" in r]
    right_density = [r.get("right_upper_motion", 0) / r.get("right_upper_fg", 1) for r in raw_rows if "right_upper_motion" in r]
    centers = [r["center_x"] for r in raw_rows if "center_x" in r]
    touch = sum(1 for r in raw_rows if r.get("touch_edge"))
    summary = {
        "file": mp4.name,
        "frames": len(raw_rows),
        "touch_edge_frames": touch,
        "center_x_mean": float(np.mean(centers)) if centers else None,
        "center_x_std": float(np.std(centers)) if centers else None,
        "fg_px_mean": mean("fg_px"),
        "bg_border_dev_mean": mean("bg_border_dev"),
        "left_upper_motion_density_mean": float(np.mean(left_density)) if left_density else None,
        "right_upper_motion_density_mean": float(np.mean(right_density)) if right_density else None,
        "left_right_density_ratio": float(np.mean(left_density) / max(1e-6, np.mean(right_density))) if left_density and right_density else None,
        "leg_motion_mean": mean("leg_motion"),
    }
    return summary, raw_rows, contact


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out-root",
                    default=r"Y:\工作\无尽轮回\scratch\player_attack_sword")
    ap.add_argument("--step", type=int, default=4, help="contact sheet 抽帧步长")
    args = ap.parse_args()

    root = Path(args.out_root)
    key_dir = root / "keyframes"
    h3_dir = root / "h3"
    report_dir = root / "analysis"
    report_dir.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.gettempdir()) / "player_attack_sword_analysis"
    work.mkdir(parents=True, exist_ok=True)

    bg_file = key_dir / "bg.txt"
    if not bg_file.exists():
        ap.error(f"missing {bg_file}")
    bg_hex = bg_file.read_text(encoding="ascii").strip()
    bg = [int(bg_hex[i:i + 2], 16) for i in (0, 2, 4)]
    print(f"[analyze] bg=#{bg_hex}")

    kf = analyze_keyframes(key_dir, work, bg)
    print("[analyze] keyframes:", json.dumps(kf, ensure_ascii=False, indent=2))

    vids = sorted(h3_dir.glob("attack_sword_*.mp4"))
    video_reports = []
    for mp4 in vids:
        summary, rows, contact = analyze_video(mp4, work, bg, step=args.step)
        video_reports.append(summary)
        print("[analyze] video:", json.dumps(summary, ensure_ascii=False))
        if contact is not None:
            contact_path = report_dir / (mp4.stem + "_contact.png")
            contact.save(str(contact_path))
            print(f"[analyze] contact -> {contact_path}")

        rows_path = report_dir / (mp4.stem + "_frames.json")
        with open(str(rows_path), "w", encoding="utf-8") as fh:
            json.dump(rows, fh, ensure_ascii=False, indent=2)

    report = {
        "bg_hex": bg_hex,
        "keyframes": kf,
        "videos": video_reports,
    }
    report_path = report_dir / "analysis_report.json"
    with open(str(report_path), "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=2)

    print("[analyze] DONE:", report_path)
    # 简单排序建议
    if video_reports:
        ranked = sorted(video_reports, key=lambda r: (
            (r.get("left_right_density_ratio") or 0) < 0.65,
            r.get("left_upper_motion_density_mean") or 9,
            r.get("center_x_std") or 999,
            r.get("touch_edge_frames") or 999,
        ))
        print("[analyze] rough rank:", [r["file"] for r in ranked])


if __name__ == "__main__":
    main()
