from __future__ import annotations

from pathlib import Path

import av
import cv2
import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
VIDEO = ROOT / "videos" / "hamster_anti_vehicle_rocket_attacking_h3.mp4"
OUTPUT = ROOT / "source-sheets-pre-interpolation" / "rocket_attacking.png"
PREVIEW = ROOT / "previews" / "source" / "rocket_attacking-source.gif"

FRAME_INDEXES = (0, 12, 20, 29, 41, 49, 53, 57, 66, 70, 74, 78, 82)
CELL_SIZE = 512
COLS = 8
TARGET_REFERENCE_HEIGHT = 410
TARGET_CENTER_X = 256
TARGET_FEET_Y = 458
WHITE_THRESHOLD = 235


def decode_video() -> list[np.ndarray]:
    container = av.open(str(VIDEO))
    stream = container.streams.video[0]
    frames = [
        cv2.cvtColor(np.asarray(frame.to_image().convert("RGB")), cv2.COLOR_RGB2BGR)
        for frame in container.decode(stream)
    ]
    container.close()
    return frames


def alpha_for(frame: np.ndarray) -> np.ndarray:
    white = (
        (frame[..., 0] > WHITE_THRESHOLD)
        & (frame[..., 1] > WHITE_THRESHOLD)
        & (frame[..., 2] > WHITE_THRESHOLD)
    ).astype(np.uint8)
    white = cv2.morphologyEx(white, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    return (1 - white) * 255


def reference_transform(frame: np.ndarray) -> tuple[float, float, float]:
    alpha = alpha_for(frame)
    ys, xs = np.where(alpha > 30)
    reference_height = int(ys.max() - ys.min() + 1)
    reference_center_x = (float(xs.min()) + float(xs.max())) / 2.0
    reference_feet_y = float(ys.max())
    scale = TARGET_REFERENCE_HEIGHT / reference_height
    tx = TARGET_CENTER_X - reference_center_x * scale
    ty = TARGET_FEET_Y - reference_feet_y * scale
    return scale, tx, ty


def render_cell(frame: np.ndarray, matrix: np.ndarray) -> np.ndarray:
    alpha = alpha_for(frame)
    rgb = cv2.warpAffine(
        frame,
        matrix,
        (CELL_SIZE, CELL_SIZE),
        flags=cv2.INTER_AREA,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(0, 0, 0),
    )
    out_alpha = cv2.warpAffine(
        alpha,
        matrix,
        (CELL_SIZE, CELL_SIZE),
        flags=cv2.INTER_AREA,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=0,
    )
    rgb[out_alpha == 0] = 0
    return np.dstack([rgb, out_alpha])


def checker(cell: np.ndarray) -> Image.Image:
    yy, xx = np.indices(cell.shape[:2])
    shade = np.where(((xx // 24 + yy // 24) % 2)[..., None], 58, 82)
    background = np.repeat(shade, 3, axis=2).astype(np.float32)
    alpha = cell[..., 3:4].astype(np.float32) / 255.0
    bgr = cell[..., :3].astype(np.float32)
    rgb = bgr[..., ::-1]
    composited = rgb * alpha + background * (1.0 - alpha)
    return Image.fromarray(np.clip(composited, 0, 255).astype(np.uint8), "RGB")


def main() -> None:
    frames = decode_video()
    scale, tx, ty = reference_transform(frames[0])
    matrix = np.array([[scale, 0.0, tx], [0.0, scale, ty]], dtype=np.float32)
    cells = [render_cell(frames[index], matrix) for index in FRAME_INDEXES]

    rows = (len(cells) + COLS - 1) // COLS
    sheet = np.zeros((rows * CELL_SIZE, COLS * CELL_SIZE, 4), dtype=np.uint8)
    for index, cell in enumerate(cells):
        row, col = divmod(index, COLS)
        sheet[
            row * CELL_SIZE:(row + 1) * CELL_SIZE,
            col * CELL_SIZE:(col + 1) * CELL_SIZE,
        ] = cell

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    PREVIEW.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(cv2.cvtColor(sheet, cv2.COLOR_BGRA2RGBA), "RGBA").save(OUTPUT)
    previews = [checker(cell).resize((384, 384), Image.Resampling.LANCZOS) for cell in cells]
    previews[0].save(
        PREVIEW,
        save_all=True,
        append_images=previews[1:],
        duration=167,
        loop=0,
        disposal=2,
    )

    nonempty = []
    bottoms = []
    for cell in cells:
        ys, xs = np.where(cell[..., 3] > 30)
        nonempty.append(bool(xs.size))
        bottoms.append(int(ys.max()) if xs.size else -1)
    print(
        f"rocket: frames={FRAME_INDEXES} scale={scale:.4f} "
        f"nonempty={all(nonempty)} alpha_bottom=[{min(bottoms)},{max(bottoms)}] -> {OUTPUT}"
    )


if __name__ == "__main__":
    main()
