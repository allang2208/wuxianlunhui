#!/usr/bin/env python3
"""Pixel-level perspective audit for generated game sprites.

The vision model (GLM 4.6v) is only reliable for QUALITATIVE verdicts
(iso-2.5D vs top-down, single object, centered). For QUANTITATIVE geometry
(bottom-edge angle, which end is lower, h/v mirror relationship) use this
script: it measures the alpha silhouette directly.

Usage:
  python audit-perspective.py [files-or-globs...] [--ref-angle 27] [--json]

Defaults (no args): audits the world-122 covers, defense tower and the
in-game wall references under game-dev/assets/terrain, and auto-detects
h/v cover pairs.

Outputs per image:
  bbox, centerDX (0=centered), bottomTipFrac (bottom row width / bbox width,
  0 = pointed iso V), left/right bottom-edge angles (deg, bottom 25% band).
  An edge near +/-27deg (iso 26.565) is the wall signature.

Pair verdict (h vs v), via alpha-mask IoU after aspect-normalization:
  MIRROR          v overlaps the horizontal flip of h  -> correct two-orientation pair
  SAME_ORIENT     v overlaps h itself                   -> broken pair, regenerate
  UNCLEAR         neither (different object or too distorted)
"""

import argparse
import glob
import json
import math
import os
import sys

import numpy as np
from PIL import Image

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.normpath(os.path.join(SCRIPT_DIR, "..", "..", "assets", "terrain"))
SHADOW_WARN = 0.20

DEFAULT_FILES = [
    "obstacle_cover_A_h.png", "obstacle_cover_A_v.png",
    "obstacle_cover_B_h.png", "obstacle_cover_B_v.png",
    "obstacle_cover_C_h.png", "obstacle_cover_C_v.png",
    "obstacle_cover_D_h.png", "obstacle_cover_D_v.png",
    "obstacle_cover_E_h.png", "obstacle_cover_E_v.png",
    "obstacle_cover_F_h.png", "obstacle_cover_F_v.png",
    "obstacle_defense_tower.png",
    "obstacle_defense_tower_arm.png",
    "wall_straight.png", "wall_diag.png",
    "hub_wall_straight.png", "swamp_wall_straight.png",
]


def load_mask(path, thresh=64):
    a = np.asarray(Image.open(path).convert("RGBA"))
    return a[..., 3] > thresh


def image_metrics(path, ref_angle):
    mask = load_mask(path)
    if not mask.any():
        return {"file": path, "error": "EMPTY"}
    h, w = mask.shape
    ys, xs = np.where(mask)
    x0, x1, y0, y1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
    bw, bh = x1 - x0 + 1, y1 - y0 + 1
    center_dx = abs((x0 + x1) / 2 - (w - 1) / 2) / max(1, w)

    rows = {}
    for r in range(y1 - max(2, (y1 - y0) // 4), y1 + 1):
        rowx = xs[ys == r]
        if len(rowx):
            rows[r] = (int(rowx.min()), int(rowx.max()))

    def fit_angle(col):
        pts = np.array([(x, r) for r, (l, rx) in rows.items() for x in (col(r, l, rx),)])
        if len(pts) < 2:
            return None
        x = pts[:, 0]
        if float(x.max()) - float(x.min()) < 1e-6:
            return None  # vertical edge; not a usable bottom-edge fit
        k = np.polyfit(x, pts[:, 1], 1)[0]
        return round(math.degrees(math.atan(k)), 1)

    left_ang = fit_angle(lambda r, l, rx: l)
    right_ang = fit_angle(lambda r, l, rx: rx)
    bottom_row = max(rows)
    tip_frac = (rows[bottom_row][1] - rows[bottom_row][0]) / max(1, bw)
    bbox_area_frac = (bw * bh) / max(1, w * h)

    edge_ok = any(
        a is not None and abs(a) >= 12 and abs(a) <= 48
        for a in (left_ang, right_ang)
    )
    return {
        "file": os.path.basename(path),
        "size": f"{w}x{h}",
        "bbox": f"({x0},{y0})-({x1},{y1})",
        "centerDX": round(center_dx, 3),
        "bottomTipFrac": round(tip_frac, 3),
        "bboxAreaFrac": round(bbox_area_frac, 3),
        "leftEdge": left_ang,
        "rightEdge": right_ang,
        "isoEdgeOK": edge_ok,
        "refAngle": ref_angle,
    }


def _norm_mask(mask, target_h=220):
    ys, xs = np.where(mask)
    x0, x1, y0, y1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
    crop = mask[y0:y1 + 1, x0:x1 + 1]
    ch, cw = crop.shape
    nw = max(1, int(round(cw * target_h / ch)))
    im = Image.fromarray((crop * 255).astype(np.uint8)).resize((nw, target_h), Image.LANCZOS)
    return np.asarray(im) > 127


def _pad_center(mask, width):
    h = mask.shape[0]
    canvas = np.zeros((h, width), bool)
    x0 = (width - mask.shape[1]) // 2
    canvas[:, x0:x0 + mask.shape[1]] = mask
    return canvas


def _iou(a, b):
    inter = int((a & b).sum())
    union = int((a | b).sum())
    return inter / union if union else 0.0


def pair_verdict(h_path, v_path):
    mh, mv = _norm_mask(load_mask(h_path)), _norm_mask(load_mask(v_path))
    width = max(mh.shape[1], mv.shape[1])
    h1, v1 = _pad_center(mh, width), _pad_center(mv, width)
    same = _iou(h1, v1)
    flip = _iou(h1, v1[:, ::-1])
    if flip >= 0.65 and flip > same:
        verdict = "MIRROR"
    elif same >= 0.65 and same > flip:
        verdict = "SAME_ORIENT"
    else:
        verdict = "UNCLEAR"
    return {"h": os.path.basename(h_path), "v": os.path.basename(v_path),
            "v_vs_h": round(same, 3), "v_vs_flip_h": round(flip, 3), "verdict": verdict}


def shadow_hint(path, tol=55, band=0.15):
    """Heuristic contact-shadow residue on a RAW solid-color-bg image.

    Returns (fraction, note). fraction = share of low-saturation, dark pixels
    inside the bottom band of the subject silhouette; a soft drop shadow that
    survived generation shows up there. Gray subjects can trigger this too, so
    the result is informational only (never a hard gate).
    """
    im = Image.open(path)
    if im.mode == "RGBA":
        a = np.asarray(im)
        h, w = a.shape[:2]
        corners = np.concatenate([
            a[0:12, 0:12, 3].reshape(-1), a[0:12, -12:, 3].reshape(-1),
            a[-12:, 0:12, 3].reshape(-1), a[-12:, -12:, 3].reshape(-1),
        ])
        if (corners < 200).any():
            return None, "transparent corners (run on raw solid-bg image)"
    rgb = np.asarray(im.convert("RGB")).astype(int)
    m = 12
    ring = np.concatenate([rgb[:m].reshape(-1, 3), rgb[-m:].reshape(-1, 3),
                           rgb[:, :m].reshape(-1, 3), rgb[:, -m:].reshape(-1, 3)])
    bg = np.median(ring, axis=0)
    dist = np.sqrt(((rgb - bg) ** 2).sum(axis=2))
    mask = dist > tol
    if not mask.any():
        return 0.0, "empty subject"
    ys, xs = np.where(mask)
    y1, y0 = int(ys.max()), int(ys.min())
    y0b = y1 - max(1, int((y1 - y0) * band))
    sub = mask[y0b:y1 + 1]
    rgb_sub = rgb[y0b:y1 + 1]
    mx = rgb_sub.max(axis=2)
    mn = rgb_sub.min(axis=2)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1), 0)
    lum = 0.299 * rgb_sub[..., 0] + 0.587 * rgb_sub[..., 1] + 0.114 * rgb_sub[..., 2]
    bg_lum = 0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2]
    shadow = sub & (sat < 0.12) & (lum < bg_lum - 30)
    frac = float(shadow.sum()) / max(1, int(sub.sum()))
    bg_hex = "#%02X%02X%02X" % tuple(int(c) for c in bg)
    return round(frac, 3), f"bg={bg_hex}"


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="*", help="image paths or globs (default: world-122 assets)")
    ap.add_argument("--ref-angle", type=float, default=27.0,
                    help="iso wall bottom-edge reference angle (default 27)")
    ap.add_argument("--json", action="store_true", help="emit JSON")
    ap.add_argument("--shadow-check", action="store_true",
                    help="heuristic shadow-residue hint (raw solid-bg images)")
    args = ap.parse_args()

    files = []
    for f in args.files or DEFAULT_FILES:
        if not os.path.isabs(f):
            f = os.path.join(ASSETS, f)
        files.extend(sorted(glob.glob(f)) if glob.has_magic(f) else [f])

    missing = [f for f in files if not os.path.exists(f)]
    if missing:
        print("MISSING:", *missing, sep="\n  ", file=sys.stderr)
    files = [f for f in files if os.path.exists(f)]
    if not files:
        print("no files to audit", file=sys.stderr)
        sys.exit(1)

    rows = [image_metrics(f, args.ref_angle) for f in files]
    shadow = {}
    if args.shadow_check:
        for f in files:
            v, _ = shadow_hint(f)
            shadow[os.path.basename(f)] = v

    pairs = []
    by_base = {}
    for f in files:
        b = os.path.basename(f)
        for kind in ("_h.png", "_v.png"):
            if b.endswith(kind):
                by_base.setdefault(b[: -len(kind)], {})[kind[1]] = f
    for key in sorted(by_base):
        pair = by_base[key]
        if "h" in pair and "v" in pair:
            pairs.append(pair_verdict(pair["h"], pair["v"]))

    if args.json:
        for r in rows:
            r["shadowHint"] = shadow.get(r["file"])
        print(json.dumps({"images": rows, "pairs": pairs}, ensure_ascii=False, indent=2))
        return

    print(f"{'file':32s} {'size':10s} {'centerDX':>8s} {'tip':>5s} {'Ledge':>7s} {'Redge':>7s}  isoOK")
    for r in rows:
        if "error" in r:
            print(f"{r['file']:32s} {r['error']}")
            continue
        le = "-" if r["leftEdge"] is None else f"{r['leftEdge']:+.1f}"
        re = "-" if r["rightEdge"] is None else f"{r['rightEdge']:+.1f}"
        print(f"{r['file']:32s} {r['size']:10s} {r['centerDX']:8.3f} {r['bottomTipFrac']:5.3f} "
              f"{le:>7s} {re:>7s}  {'Y' if r['isoEdgeOK'] else 'n'}")

    if pairs:
        print("\npair verdicts (h/v two-orientation check):")
        for p in pairs:
            print(f"  {p['h']} / {p['v']}: v_vs_h={p['v_vs_h']:.3f} "
                  f"v_vs_flip(h)={p['v_vs_flip_h']:.3f} -> {p['verdict']}")

    if args.shadow_check:
        print("\nshadow hints (raw solid-bg only; heuristic, not a gate):")
        for f in files:
            v, note = shadow_hint(f)
            tag = "WARN" if v is not None and v > SHADOW_WARN else "ok"
            print(f"  {os.path.basename(f)}: {v} ({note}) [{tag}]")


if __name__ == "__main__":
    main()
