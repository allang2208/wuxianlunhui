"""Approved H3 clips -> BiRefNet -> fixed worker scale -> 2x RIFE candidates.

The selected source indices live in windows.json and are intentionally not
guessed here. Every action keeps one action-wide root, every worker keeps one
scale across all three states, and no frame receives its own fit or centering.
"""

from __future__ import annotations

import json
import math
import subprocess
import sys
from pathlib import Path

import av
import numpy as np
from PIL import Image
from scipy import ndimage


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
WINDOWS_PATH = ROOT / "windows.json"
OUT = ROOT / "runtime"
CELL = 240
FEET_Y = 221
TARGET_IDLE_HEIGHT = 204
MARGIN = 4
SOURCE_FPS = 24.0
RIFE_SCRIPT = REPO / "tools" / "ai-gen" / "rife-spritesheet-interpolate.py"
RIFE_BINARY = (
    REPO.parent / "_tmp" / "elise_audit" / "rife"
    / "rife-ncnn-vulkan-20221029-windows" / "rife-ncnn-vulkan.exe"
)

sys.path.insert(0, str(REPO / "tools" / "ai-gen"))
from rmbg_cutout import get_model, predict_alpha  # noqa: E402


EXPECTED_ACTIONS = {
    "oil-technician/idle": "loop",
    "oil-technician/walking": "loop",
    "oil-technician/maintaining": "loop",
    "cannery-worker/idle": "loop",
    "cannery-worker/walking": "loop",
    "cannery-worker/inspecting": "loop",
    "trade-clerk/idle": "loop",
    "trade-clerk/walking": "loop",
    "trade-clerk/negotiating": "one-shot",
}


def decode_video(path: Path) -> tuple[list[np.ndarray], float]:
    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        fps = float(stream.average_rate)
        frames = [frame.to_ndarray(format="rgb24") for frame in container.decode(stream)]
    if not frames:
        raise RuntimeError(f"No frames decoded: {path}")
    return frames, fps


def alpha_bbox(rgba: np.ndarray, threshold: int = 16) -> tuple[int, int, int, int]:
    ys, xs = np.where(rgba[..., 3] > threshold)
    if not xs.size:
        raise RuntimeError("BiRefNet produced an empty frame")
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def cutout_rgba(rgb: np.ndarray, model) -> np.ndarray:
    source = Image.fromarray(rgb, "RGB")
    alpha = np.asarray(predict_alpha(model, source))
    alpha = np.squeeze(alpha)
    if alpha.shape != rgb.shape[:2]:
        alpha = np.asarray(Image.fromarray(alpha).resize(
            (rgb.shape[1], rgb.shape[0]), Image.Resampling.BILINEAR
        ))
    if alpha.max(initial=0) <= 1.5:
        alpha = alpha * 255.0
    alpha = np.clip(alpha, 0, 255).astype(np.uint8)
    alpha[alpha < 8] = 0

    # Remove only white studio pixels connected to the exterior. White cheek
    # and belly fur enclosed by the subject remain intact.
    white = rgb.min(axis=2) > 242
    seeds = np.zeros(white.shape, dtype=bool)
    seeds[0, :] = white[0, :]
    seeds[-1, :] = white[-1, :]
    seeds[:, 0] = white[:, 0]
    seeds[:, -1] = white[:, -1]
    exterior = ndimage.binary_propagation(seeds, mask=white)
    alpha[exterior] = 0

    clean_rgb = rgb.astype(np.float32)
    opacity = alpha.astype(np.float32) / 255.0
    semi = (opacity > 0.02) & (opacity < 0.98)
    if semi.any():
        a = opacity[semi, None]
        clean_rgb[semi] = np.clip(
            (clean_rgb[semi] - (1.0 - a) * 255.0) / np.maximum(a, 0.02), 0, 255
        )
    clean_rgb[alpha == 0] = 0
    return np.dstack([clean_rgb.astype(np.uint8), alpha])


def action_root(frames: list[np.ndarray]) -> tuple[float, float]:
    roots: list[float] = []
    feet: list[float] = []
    for rgba in frames:
        x0, y0, x1, y1 = alpha_bbox(rgba)
        alpha = rgba[..., 3]
        lower_top = y0 + round((y1 - y0 + 1) * 0.80)
        ys, xs = np.where(alpha[lower_top:y1 + 1] > 32)
        roots.append(float(np.median(xs)) if xs.size else (x0 + x1) / 2.0)
        feet.append(float(y1))
    return float(np.median(roots)), float(np.median(feet))


def common_worker_scale(actions: dict[str, list[np.ndarray]]) -> tuple[float, dict[str, tuple[float, float]]]:
    idle = actions["idle"][0]
    _, idle_y0, _, idle_y1 = alpha_bbox(idle)
    scale = TARGET_IDLE_HEIGHT / max(1, idle_y1 - idle_y0 + 1)
    roots: dict[str, tuple[float, float]] = {}
    for state, frames in actions.items():
        root_x, foot_y = action_root(frames)
        roots[state] = (root_x, foot_y)
        for rgba in frames:
            x0, y0, x1, y1 = alpha_bbox(rgba)
            scale = min(
                scale,
                (CELL / 2 - MARGIN) / max(1.0, root_x - x0),
                (CELL / 2 - MARGIN) / max(1.0, x1 - root_x + 1),
                (FEET_Y - MARGIN) / max(1.0, foot_y - y0),
                (CELL - FEET_Y - MARGIN) / max(1.0, y1 - foot_y),
            )
    if scale <= 0:
        raise RuntimeError("Unable to fit worker into the fixed 240px cell")
    return scale, roots


def place_cell(rgba: np.ndarray, root_x: float, foot_y: float, scale: float) -> np.ndarray:
    height, width = rgba.shape[:2]
    resized = np.asarray(Image.fromarray(rgba, "RGBA").resize(
        (max(1, round(width * scale)), max(1, round(height * scale))),
        Image.Resampling.LANCZOS,
    ))
    offset_x = round(CELL / 2 - root_x * scale)
    offset_y = round(FEET_Y - foot_y * scale)
    cell = Image.new("RGBA", (CELL, CELL))
    cell.alpha_composite(Image.fromarray(resized, "RGBA"), (offset_x, offset_y))
    result = np.asarray(cell).copy()
    result[result[..., 3] == 0, :3] = 0
    x0, y0, x1, y1 = alpha_bbox(result)
    if x0 < MARGIN or y0 < MARGIN or x1 >= CELL - MARGIN or y1 >= CELL - MARGIN:
        raise RuntimeError(f"Fixed placement clips at {(x0, y0, x1, y1)}")
    return result


def compose(cells: list[np.ndarray], cols: int) -> np.ndarray:
    rows = math.ceil(len(cells) / cols)
    sheet = np.zeros((rows * CELL, cols * CELL, 4), np.uint8)
    for index, cell in enumerate(cells):
        row, col = divmod(index, cols)
        sheet[row * CELL:(row + 1) * CELL, col * CELL:(col + 1) * CELL] = cell
    return sheet


def output_columns(count: int) -> int:
    choices = [
        cols for cols in range(1, min(16, count) + 1)
        if max(cols, math.ceil(count / cols)) * CELL <= 4096
    ]
    return min(choices, key=lambda cols: (
        math.ceil(count / cols) * cols - count,
        abs(cols - math.sqrt(count)),
    ))


def load_windows() -> dict[str, dict[str, object]]:
    if not WINDOWS_PATH.exists():
        raise RuntimeError(
            f"Missing {WINDOWS_PATH.name}; create it only after reviewing the retained raw videos"
        )
    data = json.loads(WINDOWS_PATH.read_text(encoding="utf-8"))
    if set(data) != set(EXPECTED_ACTIONS):
        raise RuntimeError("windows.json must contain exactly the nine documented actions")
    for key, mode in EXPECTED_ACTIONS.items():
        entry = data[key]
        indices = entry.get("indices") or []
        if entry.get("mode") != mode:
            raise RuntimeError(f"{key}: expected mode {mode}")
        if entry.get("enabled", True) is False:
            continue
        if len(indices) < 2:
            raise RuntimeError(f"{key}: enabled action needs at least two reviewed source indices")
        if indices != sorted(set(indices)):
            raise RuntimeError(f"{key}: source indices must be sorted and unique")
    return data


def main() -> None:
    windows = load_windows()
    OUT.mkdir(parents=True, exist_ok=True)
    model = get_model()
    decoded: dict[Path, tuple[list[np.ndarray], float]] = {}
    cutouts: dict[str, list[np.ndarray]] = {}

    for key, entry in windows.items():
        if entry.get("enabled", True) is False:
            continue
        video = ROOT / str(entry["video"])
        if video not in decoded:
            decoded[video] = decode_video(video)
        frames, fps = decoded[video]
        if abs(fps - SOURCE_FPS) > 0.02:
            raise RuntimeError(f"{key}: expected 24fps, got {fps:.4f}")
        indices = [int(value) for value in entry["indices"]]
        if indices[-1] >= len(frames):
            raise RuntimeError(f"{key}: source index exceeds {len(frames)} decoded frames")
        action_dir = OUT / key
        action_dir.mkdir(parents=True, exist_ok=True)
        action_cutouts: list[np.ndarray] = []
        for index in indices:
            cache = action_dir / f"source-{index:03d}.png"
            if cache.exists():
                rgba = np.asarray(Image.open(cache).convert("RGBA")).copy()
            else:
                rgba = cutout_rgba(frames[index], model)
                Image.fromarray(rgba, "RGBA").save(cache)
            action_cutouts.append(rgba)
            print(f"[industrial-worker] {key} BiRefNet f{index}", flush=True)
        cutouts[key] = action_cutouts

    report: dict[str, object] = {
        "pipeline": "MiniMax H3 -> reviewed source indices -> BiRefNet -> fixed worker scale/action root -> RIFE 2x",
        "cell": CELL,
        "feetY": FEET_Y,
        "perFrameAlignment": False,
        "workers": {},
        "actions": {},
    }
    candidate_root = OUT / "formal-candidates"
    decoded_bytes = 0
    for worker in ("oil-technician", "cannery-worker", "trade-clerk"):
        worker_actions = {
            key.split("/", 1)[1]: frames
            for key, frames in cutouts.items() if key.startswith(f"{worker}/")
        }
        if not worker_actions:
            continue
        scale, roots = common_worker_scale(worker_actions)
        report["workers"][worker] = {"fixedScale": scale, "actionRoots": roots}
        worker_out = candidate_root / worker
        worker_out.mkdir(parents=True, exist_ok=True)
        for state, source_cells in worker_actions.items():
            key = f"{worker}/{state}"
            entry = windows[key]
            mode = str(entry["mode"])
            root_x, foot_y = roots[state]
            cells = [place_cell(frame, root_x, foot_y, scale) for frame in source_cells]
            base_cols = min(8, len(cells))
            action_dir = OUT / key
            base_sheet = action_dir / "source-keyframes.png"
            Image.fromarray(compose(cells, base_cols), "RGBA").save(base_sheet)
            final_count = len(cells) * 2 if mode == "loop" else len(cells) * 2 - 1
            final_cols = output_columns(final_count)
            final_sheet = worker_out / f"{state}.png"
            command = [
                sys.executable, "-B", str(RIFE_SCRIPT),
                "--sheet", str(base_sheet),
                "--out", str(final_sheet),
                "--name", f"{worker}-{state}",
                "--frame-width", str(CELL),
                "--frame-height", str(CELL),
                "--cols", str(base_cols),
                "--frame-count", str(len(cells)),
                "--frame-rate", str(entry.get("keyframeFps", 8)),
                "--mode", mode,
                "--out-cols", str(final_cols),
                "--preview-dir", str(action_dir / "previews"),
                "--report", str(action_dir / "rife-report.json"),
                "--rife", str(RIFE_BINARY),
                "--preserve-vertical-motion",
                "--repair-red-outliers",
            ]
            with (action_dir / "rife.log").open("w", encoding="utf-8") as log:
                subprocess.run(command, check=True, stdout=log, stderr=subprocess.STDOUT)
            frame_rate = float(entry.get("frameRate", 16))
            decoded_bytes += final_cols * math.ceil(final_count / final_cols) * CELL * CELL * 4
            report["actions"][key] = {
                "source": entry["video"],
                "sourceIndices": entry["indices"],
                "mode": mode,
                "frameWidth": CELL,
                "frameHeight": CELL,
                "frameCount": final_count,
                "frames": [0, final_count - 1],
                "frameRate": frame_rate,
                "repeat": -1 if mode == "loop" else 0,
                "cols": final_cols,
                "rows": math.ceil(final_count / final_cols),
                "footRatio": FEET_Y / CELL,
                "candidate": str(final_sheet.relative_to(ROOT)).replace("\\", "/"),
            }
    report["decodedBytes"] = decoded_bytes
    report["decodedMiB"] = decoded_bytes / 1024 / 1024
    if decoded_bytes > 64 * 1024 * 1024:
        raise RuntimeError(f"Civilian animation budget exceeds 64 MiB: {report['decodedMiB']:.2f} MiB")
    (OUT / "asset-manifest.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps({"decodedMiB": report["decodedMiB"]}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
