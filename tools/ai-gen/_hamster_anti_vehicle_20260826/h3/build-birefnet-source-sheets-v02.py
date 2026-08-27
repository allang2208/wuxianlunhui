from __future__ import annotations

import argparse
import json
from pathlib import Path

import av
import cv2
import numpy as np
from PIL import Image

import sys


TOOLS_DIR = Path(__file__).resolve().parents[2]
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from rmbg_cutout import get_model, predict_alpha  # noqa: E402


ROOT = Path(__file__).resolve().parent
VIDEO_DIR = ROOT / "videos"
OUT_DIR = ROOT / "birefnet" / "source-sheets-pre-interpolation-v02"
FRAME_DIR = ROOT / "birefnet" / "frames-v02"
PREVIEW_DIR = ROOT / "previews" / "birefnet-v02"
REPORT_DIR = ROOT / "birefnet" / "reports-v02"

CELL = 512
COLS = 8
TARGET_REFERENCE_HEIGHT = 410
TARGET_CENTER_X = 256
TARGET_FEET_Y = 458

ACTIONS = {
    "idle": {
        "video": "hamster_anti_vehicle_idle_h3.mp4",
        "frames": (0, 16, 33, 49, 66, 82, 98, 115),
    },
    "running": {
        "video": "hamster_anti_vehicle_running_h3.mp4",
        "frames": (20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64),
    },
    "attacking": {
        "video": "hamster_anti_vehicle_smg_attacking_h3.mp4",
        "frames": (25, 33, 41, 49, 57, 66, 74),
    },
    "rocket_attacking": {
        "video": "hamster_anti_vehicle_rocket_attacking_h3_v02.mp4",
        "frames": (
            0, 8, 16, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64,
            67, 69, 73, 77, 81, 85, 89, 93, 97, 101, 105, 109, 113,
            117, 121, 123,
        ),
        "appendIdleRegeneration": True,
        "edgeFade": {
            "sourceFrameMin": 89,
            "sourceFrameMax": 97,
            "leftPx": 56,
        },
    },
    "dying": {
        "video": "hamster_anti_vehicle_dying_h3.mp4",
        "frames": (25, 29, 33, 37, 41, 45, 49, 53, 57, 61, 65, 69, 73, 77, 81),
    },
}


def decode_video(path: Path) -> list[np.ndarray]:
    container = av.open(str(path))
    stream = container.streams.video[0]
    frames = [np.asarray(frame.to_image().convert("RGB")) for frame in container.decode(stream)]
    container.close()
    if not frames:
        raise RuntimeError(f"no video frames decoded: {path}")
    return frames


def clean_alpha(alpha: np.ndarray) -> np.ndarray:
    alpha = np.asarray(alpha).squeeze()
    if alpha.dtype != np.uint8:
        if float(alpha.max()) <= 1.0:
            alpha = alpha * 255.0
        alpha = np.clip(alpha, 0, 255).astype(np.uint8)
    alpha[alpha <= 3] = 0

    labels_input = (alpha > 12).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(labels_input, 8)
    keep = np.zeros_like(labels_input, dtype=bool)
    for component in range(1, count):
        if int(stats[component, cv2.CC_STAT_AREA]) >= 24:
            keep |= labels == component
    alpha[~keep] = 0
    return alpha


def decontaminate_white(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    output = rgb.astype(np.float32).copy()
    a = alpha.astype(np.float32) / 255.0
    semi = (a > 0.01) & (a < 0.995)
    if semi.any():
        inv = 1.0 - a[semi]
        foreground = (output[semi] - inv[:, None] * 255.0) / np.maximum(
            a[semi][:, None], 1e-3
        )
        output[semi] = np.clip(foreground, 0, 255)
    output[alpha == 0] = 0
    return np.clip(output, 0, 255).astype(np.uint8)


def restore_forward_warm_effect(
    rgb: np.ndarray,
    alpha: np.ndarray,
    actor: tuple[int, int, int, int, float],
) -> np.ndarray:
    """Recover muzzle/rocket flame that BiRefNet can mistake for white background."""
    x, y, w, h, _ = actor
    yy, xx = np.indices(alpha.shape)
    distance_from_white = np.linalg.norm(rgb.astype(np.float32) - 255.0, axis=2)
    roi = (
        (xx >= x + w - 14)
        & (yy >= y)
        & (yy <= y + round(h * 0.72))
    )
    warm_seed = (
        (rgb[..., 0].astype(np.int16) > 165)
        & (rgb[..., 1].astype(np.int16) > 65)
        & (rgb[..., 0].astype(np.int16) - rgb[..., 2].astype(np.int16) > 45)
        & (rgb[..., 1].astype(np.int16) - rgb[..., 2].astype(np.int16) > 12)
        & roi
    )
    if not warm_seed.any():
        return alpha

    candidate = ((distance_from_white > 15.0) & roi).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(candidate, 8)
    effect = np.zeros_like(candidate)
    for component in range(1, count):
        component_mask = labels == component
        if int(stats[component, cv2.CC_STAT_AREA]) >= 16 and (component_mask & warm_seed).any():
            effect[component_mask] = 1
    effect_alpha = effect.astype(np.float32) * np.clip(
        (distance_from_white - 10.0) * 12.0, 0, 255
    )
    return np.maximum(alpha, np.clip(effect_alpha, 0, 255).astype(np.uint8))


def main_component(alpha: np.ndarray) -> tuple[int, int, int, int, float]:
    count, labels, stats, centroids = cv2.connectedComponentsWithStats(
        (alpha > 24).astype(np.uint8), 8
    )
    if count <= 1:
        raise RuntimeError("BiRefNet produced no foreground component")
    component = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    x = int(stats[component, cv2.CC_STAT_LEFT])
    y = int(stats[component, cv2.CC_STAT_TOP])
    w = int(stats[component, cv2.CC_STAT_WIDTH])
    h = int(stats[component, cv2.CC_STAT_HEIGHT])
    center_x = float(centroids[component, 0])
    return x, y, w, h, center_x


def transform_cell(
    rgba: np.ndarray,
    scale: float,
    actor: tuple[int, int, int, int, float],
) -> np.ndarray:
    _, y, _, h, actor_center_x = actor
    actor_bottom = y + h - 1
    tx = TARGET_CENTER_X - actor_center_x * scale
    ty = TARGET_FEET_Y - actor_bottom * scale
    matrix = np.array([[scale, 0.0, tx], [0.0, scale, ty]], dtype=np.float32)
    cell = cv2.warpAffine(
        rgba,
        matrix,
        (CELL, CELL),
        flags=cv2.INTER_AREA,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(0, 0, 0, 0),
    )
    cell[cell[..., 3] == 0, :3] = 0
    return cell


def fade_cell_edges(
    cell: np.ndarray,
    *,
    left_px: int = 0,
) -> np.ndarray:
    """Smoothly fade an object already leaving the source video's frame."""
    if left_px <= 0:
        return cell
    output = cell.copy()
    x = np.arange(CELL, dtype=np.float32)
    t = np.clip(x / float(left_px), 0.0, 1.0)
    smooth = t * t * (3.0 - 2.0 * t)
    alpha = output[..., 3].astype(np.float32) * smooth[None, :]
    output[..., 3] = np.clip(np.rint(alpha), 0, 255).astype(np.uint8)
    output[output[..., 3] == 0, :3] = 0
    return output


def checker(cell: np.ndarray) -> Image.Image:
    yy, xx = np.indices(cell.shape[:2])
    shade = np.where(((xx // 24 + yy // 24) % 2)[..., None], 58, 82)
    background = np.repeat(shade, 3, axis=2).astype(np.float32)
    alpha = cell[..., 3:4].astype(np.float32) / 255.0
    composite = cell[..., :3].astype(np.float32) * alpha + background * (1.0 - alpha)
    return Image.fromarray(np.clip(composite, 0, 255).astype(np.uint8), "RGB")


def build_action(model, name: str, spec: dict[str, object]) -> None:
    video_path = VIDEO_DIR / str(spec["video"])
    indexes = tuple(int(value) for value in spec["frames"])
    video_frames = decode_video(video_path)

    selected_frames = [
        (f"source-{source_index:03d}", video_frames[source_index])
        for source_index in indexes
    ]
    if bool(spec.get("appendIdleRegeneration")):
        idle_frames = decode_video(VIDEO_DIR / "hamster_anti_vehicle_idle_h3.mp4")
        selected_frames.append(("regenerated-idle-000", idle_frames[0]))

    cutouts: list[np.ndarray] = []
    actors: list[tuple[int, int, int, int, float]] = []
    action_frame_dir = FRAME_DIR / name
    action_frame_dir.mkdir(parents=True, exist_ok=True)
    for source_label, rgb in selected_frames:
        alpha = clean_alpha(predict_alpha(model, Image.fromarray(rgb, "RGB")))
        actor = main_component(alpha)
        if name == "attacking":
            alpha = restore_forward_warm_effect(rgb, alpha, actor)
        rgb = decontaminate_white(rgb, alpha)
        rgba = np.dstack([rgb, alpha])
        cutouts.append(rgba)
        actors.append(actor)
        Image.fromarray(rgba, "RGBA").save(
            action_frame_dir / f"{source_label}-birefnet.png"
        )

    reference_height = actors[0][3]
    scale = TARGET_REFERENCE_HEIGHT / max(1, reference_height)
    cells = []
    edge_fade = spec.get("edgeFade")
    for (source_label, _), rgba, actor in zip(
        selected_frames, cutouts, actors, strict=True
    ):
        cell = transform_cell(rgba, scale, actor)
        if isinstance(edge_fade, dict) and source_label.startswith("source-"):
            source_index = int(source_label.removeprefix("source-"))
            if (
                int(edge_fade["sourceFrameMin"])
                <= source_index
                <= int(edge_fade["sourceFrameMax"])
            ):
                cell = fade_cell_edges(
                    cell,
                    left_px=int(edge_fade.get("leftPx", 0)),
                )
        cells.append(cell)

    rows = (len(cells) + COLS - 1) // COLS
    sheet = np.zeros((rows * CELL, COLS * CELL, 4), dtype=np.uint8)
    for index, cell in enumerate(cells):
        row, col = divmod(index, COLS)
        sheet[row * CELL:(row + 1) * CELL, col * CELL:(col + 1) * CELL] = cell

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    Image.fromarray(sheet, "RGBA").save(OUT_DIR / f"{name}.png")
    preview_frames = [
        checker(cell).resize((384, 384), Image.Resampling.LANCZOS) for cell in cells
    ]
    preview_frames[0].save(
        PREVIEW_DIR / f"{name}-birefnet-source.gif",
        save_all=True,
        append_images=preview_frames[1:],
        duration=125 if name == "idle" else 100,
        loop=0,
        disposal=2,
    )

    alpha_counts = [int((cell[..., 3] > 8).sum()) for cell in cells]
    touching = []
    bottoms = []
    for index, cell in enumerate(cells):
        ys, xs = np.where(cell[..., 3] > 8)
        if not xs.size:
            continue
        bottoms.append(int(ys.max()))
        if xs.min() <= 2 or ys.min() <= 2 or xs.max() >= CELL - 3 or ys.max() >= CELL - 3:
            touching.append(index)
    report = {
        "action": name,
        "video": str(video_path),
        "sourceFrames": list(indexes),
        "appendedIdleRegeneration": bool(spec.get("appendIdleRegeneration")),
        "edgeFade": edge_fade,
        "sourceFrameCount": len(selected_frames),
        "scale": scale,
        "alphaPixelsPerFrame": alpha_counts,
        "emptyFrames": [i for i, count in enumerate(alpha_counts) if count < 50],
        "touchingFrames": touching,
        "alphaBottomMin": min(bottoms),
        "alphaBottomMax": max(bottoms),
        "transparentRgbMax": max(
            int(np.count_nonzero(cell[..., :3][cell[..., 3] == 0])) for cell in cells
        ),
        "pipeline": "BiRefNet-general alpha plus white-background foreground decontamination",
    }
    (REPORT_DIR / f"{name}.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False), flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", choices=tuple(ACTIONS))
    args = parser.parse_args()
    selected = {args.only: ACTIONS[args.only]} if args.only else ACTIONS
    model = get_model()
    for name, spec in selected.items():
        build_action(model, name, spec)


if __name__ == "__main__":
    main()
