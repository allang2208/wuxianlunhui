from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np


def body_anchor(alpha: np.ndarray) -> tuple[float, tuple[int, int, int, int]]:
    mask = (alpha > 30).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    if count <= 1:
        raise ValueError("frame has no alpha-bearing component")
    component = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    x = int(stats[component, cv2.CC_STAT_LEFT])
    y = int(stats[component, cv2.CC_STAT_TOP])
    w = int(stats[component, cv2.CC_STAT_WIDTH])
    h = int(stats[component, cv2.CC_STAT_HEIGHT])
    body = labels == component
    lower = body[y + int(h * 0.65):y + h, :]
    columns = np.where(lower.any(axis=0))[0]
    anchor = (float(columns.min() + columns.max()) / 2.0) if len(columns) else x + w / 2.0
    return anchor, (x, y, w, h)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--out")
    parser.add_argument("--source-cell", type=int, default=640)
    parser.add_argument("--target-width", type=int, default=960)
    parser.add_argument("--target-x", type=float)
    parser.add_argument("--frames", type=int, default=24)
    parser.add_argument("--cols", type=int, default=6)
    parser.add_argument("--analyze-only", action="store_true")
    args = parser.parse_args()

    source = cv2.imread(args.input, cv2.IMREAD_UNCHANGED)
    if source is None or source.shape[2] != 4:
        raise SystemExit("input must be an RGBA sheet")
    rows = int(np.ceil(args.frames / args.cols))
    expected = (rows * args.source_cell, args.cols * args.source_cell)
    if source.shape[:2] != expected:
        raise SystemExit(f"input size {source.shape[1]}x{source.shape[0]} != {expected[1]}x{expected[0]}")

    cells: list[np.ndarray] = []
    anchors: list[float] = []
    bboxes: list[tuple[int, int, int, int]] = []
    for index in range(args.frames):
        col = index % args.cols
        row = index // args.cols
        cell = source[
            row * args.source_cell:(row + 1) * args.source_cell,
            col * args.source_cell:(col + 1) * args.source_cell,
        ].copy()
        anchor, bbox = body_anchor(cell[:, :, 3])
        cells.append(cell)
        anchors.append(anchor)
        bboxes.append(bbox)

    print(
        f"source_body_anchor_range={min(anchors):.1f}..{max(anchors):.1f} "
        f"first={anchors[0]:.1f}"
    )
    if args.analyze_only:
        return
    if not args.out:
        raise SystemExit("--out is required unless --analyze-only is used")

    target_x = args.target_x if args.target_x is not None else args.target_width / 2.0
    shift = int(round(target_x - anchors[0]))
    if shift < 0 or shift + args.source_cell > args.target_width:
        raise SystemExit(
            f"target width {args.target_width} cannot contain source cell at shift {shift}"
        )

    sheet = np.zeros((rows * args.source_cell, args.cols * args.target_width, 4), np.uint8)
    edge_hits: list[int] = []
    for index, cell in enumerate(cells):
        col = index % args.cols
        row = index // args.cols
        x0 = col * args.target_width + shift
        y0 = row * args.source_cell
        sheet[y0:y0 + args.source_cell, x0:x0 + args.source_cell] = cell
        placed = sheet[
            y0:y0 + args.source_cell,
            col * args.target_width:(col + 1) * args.target_width,
            3,
        ]
        if placed[:, 0].any() or placed[:, -1].any() or placed[0].any() or placed[-1].any():
            edge_hits.append(index)

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    if not cv2.imwrite(str(out), sheet):
        raise SystemExit(f"failed to write {out}")

    placed_anchors = [value + shift for value in anchors]
    print(f"source_anchor={anchors[0]:.1f} target_x={target_x:.1f} shift={shift}")
    print(
        f"body_anchor_range={min(placed_anchors):.1f}..{max(placed_anchors):.1f} "
        f"first={placed_anchors[0]:.1f} edge_hits={edge_hits}"
    )
    print(f"body_bboxes={bboxes}")
    print(f"sheet={sheet.shape[1]}x{sheet.shape[0]} -> {out}")


if __name__ == "__main__":
    main()
