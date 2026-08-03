import os
import numpy as np
from PIL import Image

DIR = r"E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\skills\blizzard-icons-v2"

for name in sorted(os.listdir(DIR)):
    if not name.lower().endswith(".png"):
        continue
    arr = np.asarray(Image.open(os.path.join(DIR, name)).convert("RGB")).astype(int)
    n = arr.shape[0] * arr.shape[1]
    near_white = (np.abs(arr - 250).sum(axis=2) < 45).sum() / n
    h, w = arr.shape[:2]
    corners = np.concatenate([
        arr[10:60, 10:60].reshape(-1, 3),
        arr[10:60, w-60:w-10].reshape(-1, 3),
        arr[h-60:h-10, 10:60].reshape(-1, 3),
        arr[h-60:h-10, w-60:w-10].reshape(-1, 3),
    ])
    corner_mean = corners.mean(axis=0).round(0).astype(int)
    # 彩色背景近似：非白且饱和度较高
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    mx = arr.max(axis=2)
    mn = arr.min(axis=2)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1), 0)
    colored = ((sat > 0.25) & (mx < 245)).sum() / n
    print(f"{name}: white%={near_white*100:.1f} colored%={colored*100:.1f} cornerRGB={tuple(corner_mean)}")
