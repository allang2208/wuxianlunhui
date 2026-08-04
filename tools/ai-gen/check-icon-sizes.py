#!/usr/bin/env python3
"""Measure visible-content stats for every skill icon referenced by skills.json.

For each icon: frame size, alpha bbox (visible box), aspect, frame fill %,
opaque % and center offset. This exposes why icons look different in-game
(they are all rendered 48x48 contain, so content ratio drives apparent size).
"""

import json
import os
import sys

import numpy as np
from PIL import Image

BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SKILLS = os.path.join(BASE, "data", "skills.json")
ASSETS = BASE


def measure(path):
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    a = np.asarray(im)[:, :, 3].astype(np.uint8)
    n = w * h
    opaque = float((a > 200).sum()) / n
    ys, xs = np.where(a > 8)
    if len(xs) == 0:
        return w, h, None
    bw, bh = xs.max() - xs.min() + 1, ys.max() - ys.min() + 1
    fill = bw * bh / n
    return {
        "w": w, "h": h,
        "bbox_w": bw, "bbox_h": bh,
        "aspect": round(bw / bh, 2),
        "fill%": round(fill * 100, 1),
        "opaque%": round(opaque * 100, 1),
        "cx": int(round((xs.min() + xs.max()) / 2 - w / 2)),
        "cy": int(round((ys.min() + ys.max()) / 2 - h / 2)),
    }


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    with open(SKILLS, "r", encoding="utf-8") as fh:
        data = json.load(fh)

    rows = []
    seen = set()
    skills = data.get("skills", [])
    if isinstance(skills, dict):
        skills = list(skills.values())
    for skill in skills:
        icon = skill.get("iconImage")
        if not icon or icon in seen:
            continue
        seen.add(icon)
        path = os.path.join(ASSETS, icon.replace("/", os.sep))
        if not os.path.exists(path):
            rows.append({"icon": icon, "missing": True})
            continue
        try:
            stats = measure(path)
            rows.append({"icon": icon, **stats})
        except Exception as exc:
            rows.append({"icon": icon, "error": str(exc)})

    rows.sort(key=lambda r: r.get("fill%", -1))
    print(f"{'icon':<45}{'frame':>11}{'bbox':>10}{'aspect':>8}{'fill%':>7}{'opaque%':>8}{'offset':>9}")
    for r in rows:
        if r.get("missing"):
            print(f"{r['icon']:<45}  MISSING")
            continue
        if r.get("error"):
            print(f"{r['icon']:<45}  ERROR {r['error']}")
            continue
        b = r
        print(f"{b['icon']:<45}{b['w']:>5}x{b['h']:<5}{b['bbox_w']:>4}x{b['bbox_h']:<5}"
              f"{b['aspect']:>8}{b['fill%']:>7}{b['opaque%']:>8}({b['cx']},{b['cy']})")


if __name__ == "__main__":
    main()
