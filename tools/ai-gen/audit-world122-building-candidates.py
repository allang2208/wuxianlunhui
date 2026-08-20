#!/usr/bin/env python3
"""Audit scratch building candidates for footprint alignment and pseudo-plinths.

This is a review helper only. It never mutates source images or game assets.
"""
from __future__ import annotations

import argparse
import csv
from pathlib import Path

import numpy as np
from PIL import Image


def audit(path: Path, depth_path: Path) -> dict:
    rgba = np.asarray(Image.open(path).convert("RGBA"))
    rgb = rgba[..., :3].astype(np.int16)
    alpha = rgba[..., 3] > 32
    yy = np.indices(alpha.shape)[0]
    ys, xs = np.where(alpha)
    dys, dxs = np.where(np.asarray(Image.open(depth_path).convert("RGBA"))[..., :3].max(axis=2) > 4)
    bottom = int(ys.max()) if len(ys) else -1
    depth_bottom = int(dys.max()) if len(dys) else -1
    center = float((xs.min() + xs.max()) * 0.5) if len(xs) else 512.0
    depth_center = float((dxs.min() + dxs.max()) * 0.5) if len(dxs) else 512.0
    lower = alpha & (yy >= max(0, bottom - 120))
    bright = (rgb[..., 0] + rgb[..., 1] + rgb[..., 2] >= 420) & ((rgb.max(2) - rgb.min(2)) <= 100)
    alpha_rows = lower.sum(axis=1)
    bright_rows = (lower & bright).sum(axis=1)
    bright_ratio = bright_rows / np.maximum(alpha_rows, 1)
    # A broad, pale, low-saturation band at the opaque bottom is the common
    # AI-invented marble/plinth failure. Keep this conservative: one bright
    # pixel or a pale limestone wall does not trigger it.
    plinth = bool(np.count_nonzero(bright_ratio[max(0, bottom - 72):bottom + 1] >= 0.55) >= 8)
    return {
        "file": str(path),
        "bbox_center": round(center, 1),
        "depth_center": round(depth_center, 1),
        "center_delta": round(center - depth_center, 1),
        "bottom": bottom,
        "depth_bottom": depth_bottom,
        "bottom_delta": bottom - depth_bottom,
        "bright_lower_band": plinth,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("root", type=Path)
    ap.add_argument("--out", type=Path, default=None)
    args = ap.parse_args()
    rows = []
    for body in sorted(args.root.glob("*/**/*_body.png")):
        depth = body.parent / f"{body.parent.name}_depth.png"
        if depth.exists():
            rows.append(audit(body, depth))
    out = args.out or args.root / "candidate_audit.csv"
    with out.open("w", newline="", encoding="utf-8-sig") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(rows[0]) if rows else ["file"])
        writer.writeheader()
        writer.writerows(rows)
    print(out)
    for row in rows:
        flag = "REJECT_PSEUDO_PLINTH" if row["bright_lower_band"] else "ok"
        print(f"{flag}: {Path(row['file']).name} centerΔ={row['center_delta']} bottomΔ={row['bottom_delta']}")


if __name__ == "__main__":
    main()
