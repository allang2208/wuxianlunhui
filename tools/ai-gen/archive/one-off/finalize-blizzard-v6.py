#!/usr/bin/env python3
"""Cut out the v6 emblem icon, pick the best, save as blizzard_icon.png."""

import os
import shutil

import numpy as np
from PIL import Image
from scipy import ndimage

BASE = r"E:\无尽轮回\长期备份\2026-7-13-1"
SRC_DIR = os.path.join(BASE, "game-dev", "assets", "skills", "blizzard-icons-v6")
DST = os.path.join(BASE, "game-dev", "assets", "skills", "blizzard_icon.png")
TOL = 40
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
    src = os.path.join(SRC_DIR, name)
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
    decont = (rgb.astype(np.float32) - (1.0 - a_n) * bg.astype(np.float32)) / np.maximum(a_n, 1e-3)
    decont = np.clip(decont, 0, 255).astype(np.uint8)
    out = Image.fromarray(np.dstack([decont, alpha]).astype(np.uint8), "RGBA")
    out.save(os.path.join(SRC_DIR, f"cutout_{name}"))
    opaque = float((alpha > 200).sum()) / (n * m)
    return out, opaque


def checker_preview(rgba, path):
    cell = 32
    board = Image.new("RGB", (512, 512))
    for y in range(0, 512, 64):
        for x in range(0, 512, 64):
            light = (x // 64 + y // 64) % 2 == 0
            board.paste(Image.new("RGB", (64, 64), (255, 255, 255) if light else (190, 190, 190)), (x, y))
    sub = rgba.resize((512, 512), Image.LANCZOS)
    board.paste(sub, (0, 0), sub)
    board.save(path)


def edge_check(rgba):
    arr = np.asarray(rgba).astype(np.int16)
    a = arr[..., 3]
    edge = (a > 10) & (a < 245)
    if edge.sum() == 0:
        return "no edge px"
    er = arr[..., :3][edge]
    grayish = ((np.abs(er - er.mean(axis=0, keepdims=True)).sum(axis=1)) < 30).mean()
    return f"edge_px={edge.sum()} grayish={grayish*100:.1f}% meanRGB={tuple(er.mean(axis=0).round(0).astype(int))}"


def main():
    results = {}
    for name in ("blizzard_base_01.png", "blizzard_base_04.png"):
        try:
            rgba, opaque = cutout(name)
        except Exception as exc:
            print(f"{name}: ERROR {exc}")
            continue
        checker_preview(rgba, os.path.join(SRC_DIR, f"preview_{name.replace('.png', '.png')}"))
        print(f"{name}: opaque%={opaque*100:.1f} | {edge_check(rgba)}")
        results[name] = rgba

    pick = "blizzard_base_01.png" if "blizzard_base_01.png" in results else next(iter(results))
    results[pick].save(DST)
    print("saved:", DST)


if __name__ == "__main__":
    main()
