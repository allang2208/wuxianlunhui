from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sheet", required=True)
    parser.add_argument("--frame", type=int, default=8)
    parser.add_argument("--frame-width", type=int, default=1152)
    parser.add_argument("--frame-height", type=int, default=640)
    parser.add_argument("--cols", type=int, default=6)
    parser.add_argument("--debug-out", required=True)
    args = parser.parse_args()

    sheet = cv2.imread(args.sheet, cv2.IMREAD_UNCHANGED)
    if sheet is None or sheet.shape[2] != 4:
        raise SystemExit("sheet must be RGBA")
    col = args.frame % args.cols
    row = args.frame // args.cols
    cell = sheet[
        row * args.frame_height:(row + 1) * args.frame_height,
        col * args.frame_width:(col + 1) * args.frame_width,
    ].copy()

    hsv = cv2.cvtColor(cell[:, :, :3], cv2.COLOR_BGR2HSV)
    alpha = cell[:, :, 3]
    # 毒液为高饱和紫/洋红；棕褐色皮肤和衣物落在更低 hue 区间。
    purple = (
        (alpha > 30)
        & (hsv[:, :, 0] >= 125)
        & (hsv[:, :, 0] <= 175)
        & (hsv[:, :, 1] >= 80)
        & (hsv[:, :, 2] >= 25)
    ).astype(np.uint8)
    count, labels, stats, centroids = cv2.connectedComponentsWithStats(purple, 8)
    components: list[tuple[int, int, int, int, int, float, float]] = []
    for label in range(1, count):
        x = int(stats[label, cv2.CC_STAT_LEFT])
        y = int(stats[label, cv2.CC_STAT_TOP])
        w = int(stats[label, cv2.CC_STAT_WIDTH])
        h = int(stats[label, cv2.CC_STAT_HEIGHT])
        area = int(stats[label, cv2.CC_STAT_AREA])
        cx, cy = map(float, centroids[label])
        if area >= 3:
            components.append((x, y, w, h, area, cx, cy))
    components.sort(key=lambda item: item[4], reverse=True)
    if not components:
        raise SystemExit("no purple component found")

    x, y, w, h, area, cx, cy = components[0]
    main_label = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    ys, xs = np.where(labels == main_label)
    rear_limit = x + max(2, int(round(w * 0.2)))
    rear_ys, rear_xs = np.where((labels == main_label) & (np.indices(labels.shape)[1] <= rear_limit))
    origin_x = float(np.median(rear_xs)) if len(rear_xs) else float(xs.min())
    origin_y = float(np.median(rear_ys)) if len(rear_ys) else float(np.median(ys))

    debug = cell[:, :, :3].copy()
    cv2.rectangle(debug, (x, y), (x + w - 1, y + h - 1), (0, 255, 255), 2)
    cv2.circle(debug, (round(origin_x), round(origin_y)), 7, (0, 255, 0), 2)
    cv2.line(debug, (round(origin_x) - 12, round(origin_y)), (round(origin_x) + 12, round(origin_y)), (0, 255, 0), 1)
    cv2.line(debug, (round(origin_x), round(origin_y) - 12), (round(origin_x), round(origin_y) + 12), (0, 255, 0), 1)
    out = Path(args.debug_out)
    out.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out), debug)

    print(f"frame={args.frame} purple_components={components}")
    print(
        f"purple_bbox=({x},{y})-({x + w - 1},{y + h - 1}) area={area} "
        f"centroid=({cx:.2f},{cy:.2f}) rear_origin=({origin_x:.2f},{origin_y:.2f})"
    )
    print(f"debug={out}")


if __name__ == "__main__":
    main()
