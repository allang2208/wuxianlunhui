#!/usr/bin/env python3
"""Adaptive-background cutout for the v2 blizzard icons.

Measure the actual background color from image corners, flood-fill from the
borders with tolerance, decontaminate edges against that measured color.
"""

import os

import numpy as np
from PIL import Image
from scipy import ndimage

DIR = r"E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\skills\blizzard-icons-v2"
TOL = 38
FEATHER = 1.0


def corner_bg(arr):
    h, w = arr.shape[:2]
    corners = np.concatenate([
        arr[5:40, 5:40].reshape(-1, 3),
        arr[5:40, w-40:w-5].reshape(-1, 3),
        arr[h-40:h-5, 5:40].reshape(-1, 3),
        arr[h-40:h-5, w-40:w-5].reshape(-1, 3),
    ])
    return np.median(corners, axis=0).astype(np.int16)


def cutout(name):
    src = os.path.join(DIR, name)
    img = Image.open(src).convert("RGB")
    rgb = np.asarray(img).astype(np.int16)
    n, m, _ = rgb.shape
    bg = corner_bg(rgb)
    near_bg = np.abs(rgb - bg).sum(axis=2) <= TOL

    labels, nlabels = ndimage.label(near_bg)
    bg_labels = set()
    border_px = set(labels[0, :]) | set(labels[-1, :]) | set(labels[:, 0]) | set(labels[:, -1])
    for lab in border_px:
        if lab != 0:
            bg_labels.add(lab)
    background = np.zeros(near_bg.shape, dtype=bool)
    for lab in bg_labels:
        background |= labels == lab

    foreground = ~background
    flabels, nf = ndimage.label(foreground)
    if nf == 0:
        raise RuntimeError(f"{name}: no foreground")
    sizes = ndimage.sum(foreground, flabels, range(1, nf + 1))
    mask = flabels == (1 + int(np.argmax(sizes)))
    mask = ndimage.binary_erosion(mask, iterations=1)

    alpha_f = ndimage.gaussian_filter(mask.astype(np.float32), sigma=FEATHER)
    alpha = np.clip(alpha_f * 255, 0, 255).astype(np.uint8)
    a_n = alpha_f[..., None].astype(np.float32)
    bg_f = bg.astype(np.float32)
    decont = (rgb.astype(np.float32) - (1.0 - a_n) * bg_f) / np.maximum(a_n, 1e-3)
    decont = np.clip(decont, 0, 255).astype(np.uint8)
    Image.fromarray(np.dstack([decont, alpha]).astype(np.uint8), "RGBA").save(
        os.path.join(DIR, f"cutout_{name}"))

    opaque = float((alpha > 200).sum()) / (n * m)
    ys, xs = np.where(alpha > 8)
    if len(xs) == 0:
        return opaque, None
    w = xs.max() - xs.min()
    h = ys.max() - ys.min()
    cx = (xs.min() + xs.max()) / 2 - n / 2
    cy = (ys.min() + ys.max()) / 2 - m / 2
    return opaque, {"w": int(w), "h": int(h), "cx": round(cx), "cy": round(cy),
                    "aspect": round(w / max(1, h), 3)}


def main():
    results = {}
    for name in sorted(os.listdir(DIR)):
        if not name.lower().endswith(".png") or name.startswith("cutout_"):
            continue
        try:
            opaque, box = cutout(name)
        except Exception as exc:
            print(f"{name}: ERROR {exc}")
            continue
        results[name] = {"opaque": round(opaque * 100, 1), "bbox": box}
        print(f"{name}: opaque%={opaque*100:.1f} bbox={box}")
    import json
    with open(os.path.join(DIR, "cutout-manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(results, fh, ensure_ascii=False, indent=2)

    # 白底图标形态打分：主体占比 15~50%、居中、宽高比 0.4~1.5
    def score(name):
        s = results.get(name)
        if not s or s["bbox"] is None:
            return -1e9
        op = s["opaque"] / 100
        if op > 0.6 or op < 0.1:
            return -1e6
        b = s["bbox"]
        aspect_ok = 0.4 <= b["aspect"] <= 1.5
        return (50 - abs(op - 0.3) * 100) - (abs(b["cx"]) + abs(b["cy"])) * 0.1 + (60 if aspect_ok else 0)

    best = max(results, key=score) if results else None
    print("PICKED:", best)


if __name__ == "__main__":
    main()
