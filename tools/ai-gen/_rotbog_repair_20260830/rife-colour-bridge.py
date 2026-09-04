"""Keep RIFE colour and visible silhouette coherent on thin moving beetle legs.

The shared runner remains unchanged. Unbounded colour bleed introduced stripes;
bounded bleed still left flat patches when the independent colour and alpha
flows disagreed. RGB now interpolates the real silhouette on a saturated plate.
The independently interpolated alpha acts as a soft support domain, while
inverse chroma recovery keeps visible colour and silhouette in the same motion.
Source RGBA keys, the t=0.5 schedule and authored Y movement are untouched.
"""
import importlib.util
from pathlib import Path
import numpy as np
from scipy import ndimage
from PIL import Image

path = Path(__file__).resolve().parent.parent / "rife-spritesheet-interpolate.py"
spec = importlib.util.spec_from_file_location("beetle_rife_runner", path)
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


def bounded_bleed(frame):
    visible = frame[..., 3] > 8
    if not visible.any():
        return np.zeros(frame.shape[:2] + (3,), dtype=np.uint8)
    distance, nearest = ndimage.distance_transform_edt(~visible, return_indices=True)
    rgb = frame[..., :3][nearest[0], nearest[1]].copy()
    rgb[distance > 3] = [83, 75, 65]
    return rgb


runner.bleed_rgb = bounded_bleed


def interpolate(originals, mode, work_dir, rife, loop_start_index=0,
                repair_red_outliers=False, hold_large_repair=False, align_alpha_bottom=True):
    rgb_in, alpha_in = work_dir / "rgb-in", work_dir / "alpha-in"
    rgb_out, alpha_out = work_dir / "rgb-out", work_dir / "alpha-out"
    rgb_in.mkdir(parents=True)
    alpha_in.mkdir(parents=True)
    for i, frame in enumerate(originals):
        a = frame[..., 3:4].astype(np.float32) / 255
        composite = np.rint(frame[..., :3] * a + np.array([0, 0, 255]) * (1 - a)).astype(np.uint8)
        Image.fromarray(composite).save(rgb_in / f"{i:08d}.png")
        Image.fromarray(frame[..., 3]).save(alpha_in / f"{i:08d}.png")
    runner.run_rife_sequence(rife, rgb_in, rgb_out, len(originals) * 2)
    runner.run_rife_sequence(rife, alpha_in, alpha_out, len(originals) * 2)
    frames, shifts, dark_repairs, red_repairs, held = [], [], [], [], []
    pairs = len(originals) if mode == "loop" else len(originals) - 1
    for i in range(pairs):
        nxt = i + 1 if i + 1 < len(originals) else loop_start_index
        if i + 1 < len(originals):
            number = i * 2 + 2
            rgb_path, alpha_path = rgb_out / f"{number:08d}.png", alpha_out / f"{number:08d}.png"
        else:
            rgb_path, alpha_path = work_dir / "wrap-rgb.png", work_dir / "wrap-alpha.png"
            runner.run_rife(rife, rgb_in / f"{i:08d}.png", rgb_in / f"{nxt:08d}.png", rgb_path)
            runner.run_rife(rife, alpha_in / f"{i:08d}.png", alpha_in / f"{nxt:08d}.png", alpha_path)
        rgb = np.asarray(Image.open(rgb_path).convert("RGB")).astype(np.float32)
        semantic = np.asarray(Image.open(alpha_path).convert("L"))
        # Eight source pixels accommodate slight matte-flow differences without
        # permitting disconnected colour islands or replacing the soft alpha.
        support = ndimage.binary_dilation(semantic > 4, iterations=8)
        alpha = np.clip(255 - np.maximum(0, rgb[..., 2] - rgb[..., :2].max(axis=2)), 0, 255)
        alpha[~support | (alpha < 5)] = 0
        a = alpha[..., None] / 255
        colour = np.clip((rgb - np.array([0, 0, 255]) * (1 - a)) / np.maximum(a, 1e-5), 0, 255)
        middle = np.dstack((np.rint(colour).astype(np.uint8), np.rint(alpha).astype(np.uint8)))
        middle[middle[..., 3] == 0] = 0
        # Keep real RIFE middle poses; never replace inserted frames with holds.
        middle, dark, would_hold = runner.repair_temporal_dark_outliers(middle, originals[i], originals[nxt])
        if would_hold:
            raise ValueError(f"Pair {i}: colour repair would replace motion with a held key; inspect the candidate")
        red = 0
        if repair_red_outliers:
            middle, red = runner.repair_temporal_red_outliers(middle, originals[i], originals[nxt])
        frames.extend((originals[i], middle))
        shifts.append(0)
        dark_repairs.append(dark)
        red_repairs.append(red)
        held.append(False)
        print(f"[beetle-rife] pair {i + 1}/{pairs}: coherent colour/alpha, dark={dark}, chroma={red}", flush=True)
    if mode == "one-shot":
        frames.append(originals[-1])
    return frames, shifts, dark_repairs, red_repairs, held


runner.interpolate = interpolate
runner.PIPELINE_VERSION += "+beetle-chroma-supported-alpha-v1"
if __name__ == "__main__":
    runner.main()
