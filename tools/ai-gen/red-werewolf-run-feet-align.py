#!/usr/bin/env python3
"""将用户微调后的红狼人12帧running脚底对齐到同一水平线。

只处理正式表前12个有效格，按 alpha>10 的内容底边整像素平移到 y=590；
不重采样、不改水平位置，并在首次运行时保留用户原图备份。
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
ASSET = ROOT / "assets" / "enemies" / "red_wolf_king" / "werewolf_running.png"
REPORT_DIR = ROOT / "tools" / "ai-gen" / "_scratch" / "red-werewolf-run-feet-align-20260823"
BACKUP = REPORT_DIR / "werewolf_running_user_12f_before_align.png"
REPORT = REPORT_DIR / "report.json"
CELL = 640
COLS = 8
ROWS = 6
FRAME_COUNT = 12
ALPHA_MIN = 10
TARGET_BOTTOM = 590


def bottom_of(cell: np.ndarray) -> int | None:
    ys = np.where(cell[..., 3] > ALPHA_MIN)[0]
    return int(ys.max()) if ys.size else None


def shift_cell(cell: np.ndarray, dy: int) -> np.ndarray:
    if dy == 0:
        return cell.copy()
    visible_y = np.where(cell[..., 3] > ALPHA_MIN)[0]
    if not visible_y.size:
        return cell.copy()
    dy = max(-int(visible_y.min()), min(CELL - 1 - int(visible_y.max()), dy))
    moved = np.zeros_like(cell)
    if dy > 0:
        moved[dy:] = cell[: CELL - dy]
    else:
        moved[: CELL + dy] = cell[-dy:]
    return moved


def main() -> None:
    image = Image.open(ASSET).convert("RGBA")
    if image.size != (COLS * CELL, ROWS * CELL):
        raise SystemExit(f"画布尺寸 {image.size}，预期 {(COLS * CELL, ROWS * CELL)}")
    rgba = np.asarray(image).copy()
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    if not BACKUP.exists():
        shutil.copy2(ASSET, BACKUP)

    before: list[int] = []
    shifts: list[int] = []
    for index in range(FRAME_COUNT):
        row, col = divmod(index, COLS)
        y0, y1 = row * CELL, (row + 1) * CELL
        x0, x1 = col * CELL, (col + 1) * CELL
        cell = rgba[y0:y1, x0:x1]
        bottom = bottom_of(cell)
        if bottom is None:
            raise SystemExit(f"有效帧 {index} 为空，停止脚线对齐")
        dy = TARGET_BOTTOM - bottom
        rgba[y0:y1, x0:x1] = shift_cell(cell, dy)
        before.append(bottom)
        shifts.append(dy)

    after = []
    for index in range(FRAME_COUNT):
        row, col = divmod(index, COLS)
        cell = rgba[row * CELL:(row + 1) * CELL, col * CELL:(col + 1) * CELL]
        after.append(bottom_of(cell))

    Image.fromarray(rgba, "RGBA").save(ASSET, compress_level=6)
    report = {
        "asset": str(ASSET.relative_to(ROOT)).replace("\\", "/"),
        "backup": str(BACKUP.relative_to(ROOT)).replace("\\", "/"),
        "frames": FRAME_COUNT,
        "targetBottom": TARGET_BOTTOM,
        "beforeBottoms": before,
        "pixelShifts": shifts,
        "afterBottoms": after,
    }
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
