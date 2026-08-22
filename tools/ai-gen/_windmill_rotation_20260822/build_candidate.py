"""Build a transparent, seamlessly looping windmill sprite-sheet candidate."""

from pathlib import Path
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from rmbg_cutout import get_model, predict_alpha


ROOT = Path(__file__).resolve().parent
VIDEO = ROOT / "source.mp4"
SHEET = ROOT / "wheat_windmill_rotation_candidate.png"
PREVIEW = ROOT / "wheat_windmill_rotation_preview.gif"
CONTACT = ROOT / "wheat_windmill_rotation_contact.png"

START_FRAME = 37
END_FRAME = 81  # Same rotation phase as START_FRAME; excluded from the loop.
FRAME_COUNT = 16
CELL_W = 512
CELL_H = 640
COLS = 4


def load_frames(path: Path) -> tuple[list[np.ndarray], float]:
    capture = cv2.VideoCapture(str(path))
    fps = float(capture.get(cv2.CAP_PROP_FPS))
    frames: list[np.ndarray] = []
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        frames.append(frame)
    capture.release()
    if not frames or fps <= 0:
        raise RuntimeError(f"Unable to read video: {path}")
    return frames, fps


def foreground_alpha(frame: np.ndarray, model) -> np.ndarray:
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    alpha = np.asarray(predict_alpha(model, Image.fromarray(rgb, "RGB")))
    alpha = np.squeeze(alpha)
    if alpha.shape != frame.shape[:2]:
        alpha = cv2.resize(alpha, (frame.shape[1], frame.shape[0]), interpolation=cv2.INTER_LINEAR)
    alpha = np.clip(alpha, 0, 255).astype(np.uint8)

    # Keep the main windmill component and discard isolated compression marks or
    # generator watermarks without filling the intentional sail-lattice holes.
    foreground = (alpha > 12).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(foreground, 8)
    if count <= 1:
        raise RuntimeError("No foreground component found")
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    component = (labels == largest).astype(np.uint8)
    component = cv2.dilate(component, np.ones((3, 3), np.uint8))
    return alpha * component


def checkerboard(width: int, height: int, block: int = 24) -> np.ndarray:
    yy, xx = np.indices((height, width))
    light = ((xx // block + yy // block) % 2) == 0
    out = np.empty((height, width, 3), np.uint8)
    out[light] = (58, 62, 68)
    out[~light] = (38, 42, 47)
    return out


def composite_checker(rgba: np.ndarray) -> np.ndarray:
    bg = checkerboard(rgba.shape[1], rgba.shape[0]).astype(np.float32)
    rgb = rgba[..., :3].astype(np.float32)
    alpha = rgba[..., 3:4].astype(np.float32) / 255.0
    return np.clip(rgb * alpha + bg * (1.0 - alpha), 0, 255).astype(np.uint8)


def main() -> None:
    frames, fps = load_frames(VIDEO)
    if END_FRAME >= len(frames):
        raise RuntimeError(f"Video has only {len(frames)} frames")

    source_indices = np.floor(
        np.linspace(START_FRAME, END_FRAME, FRAME_COUNT, endpoint=False)
    ).astype(int)
    selected = [frames[int(i)] for i in source_indices]
    model = get_model()
    alphas = [foreground_alpha(frame, model) for frame in selected]

    # Use one shared transform for every frame. This keeps the static building
    # completely stationary while the sails rotate.
    union = np.maximum.reduce([(alpha > 20).astype(np.uint8) for alpha in alphas])
    ys, xs = np.where(union > 0)
    x0, x1 = int(xs.min()), int(xs.max())
    y0, y1 = int(ys.min()), int(ys.max())
    source_w = x1 - x0 + 1
    source_h = y1 - y0 + 1
    scale = min((CELL_W - 28) / source_w, (CELL_H - 28) / source_h)
    output_w = max(1, round(source_w * scale))
    output_h = max(1, round(source_h * scale))
    offset_x = (CELL_W - output_w) // 2
    offset_y = CELL_H - 14 - output_h

    cells: list[np.ndarray] = []
    for frame, alpha in zip(selected, alphas):
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)[y0 : y1 + 1, x0 : x1 + 1]
        crop_alpha = alpha[y0 : y1 + 1, x0 : x1 + 1]
        rgb = cv2.resize(rgb, (output_w, output_h), interpolation=cv2.INTER_AREA)
        crop_alpha = cv2.resize(
            crop_alpha, (output_w, output_h), interpolation=cv2.INTER_AREA
        )

        cell = np.zeros((CELL_H, CELL_W, 4), np.uint8)
        cell[offset_y : offset_y + output_h, offset_x : offset_x + output_w, :3] = rgb
        cell[offset_y : offset_y + output_h, offset_x : offset_x + output_w, 3] = crop_alpha
        cells.append(cell)

    rows = []
    for row_index in range((FRAME_COUNT + COLS - 1) // COLS):
        row = cells[row_index * COLS : (row_index + 1) * COLS]
        while len(row) < COLS:
            row.append(np.zeros_like(cells[0]))
        rows.append(np.hstack(row))
    sheet = np.vstack(rows)
    Image.fromarray(sheet, "RGBA").save(SHEET)

    preview_frames = [Image.fromarray(composite_checker(cell), "RGB") for cell in cells]
    frame_ms = round((END_FRAME - START_FRAME) / fps / FRAME_COUNT * 1000)
    preview_frames[0].save(
        PREVIEW,
        save_all=True,
        append_images=preview_frames[1:],
        duration=frame_ms,
        loop=0,
        optimize=False,
    )

    contact = Image.new("RGB", (CELL_W * COLS, CELL_H * 4), (30, 30, 30))
    for index, (source_index, preview) in enumerate(zip(source_indices, preview_frames)):
        draw = ImageDraw.Draw(preview)
        draw.rectangle((0, 0, 120, 25), fill=(0, 0, 0))
        draw.text((6, 5), f"f{int(source_index)}", fill=(255, 255, 255))
        contact.paste(preview, ((index % COLS) * CELL_W, (index // COLS) * CELL_H))
    contact.save(CONTACT)

    first_gray = cv2.cvtColor(selected[0], cv2.COLOR_BGR2GRAY).astype(np.float32)
    end_gray = cv2.cvtColor(frames[END_FRAME], cv2.COLOR_BGR2GRAY).astype(np.float32)
    motion_roi = np.maximum.reduce([(alpha > 20).astype(np.uint8) for alpha in alphas]) > 0
    phase_diff = float(np.abs(first_gray - end_gray)[motion_roi].mean())

    print(f"video_frames={len(frames)} fps={fps:.3f}")
    print(f"loop={START_FRAME}:{END_FRAME} source_period={(END_FRAME - START_FRAME) / fps:.3f}s")
    print(f"indices={source_indices.tolist()}")
    print(f"frame_duration_ms={frame_ms} playback_fps={1000 / frame_ms:.3f}")
    print(f"source_union_bbox=({x0},{y0})-({x1},{y1}) scale={scale:.5f}")
    print(f"sheet={sheet.shape[1]}x{sheet.shape[0]} cell={CELL_W}x{CELL_H} frames={FRAME_COUNT}")
    print(f"start_end_phase_mae={phase_diff:.3f}")


if __name__ == "__main__":
    main()
