"""Approved zombie-dog videos -> shared-scale cutouts -> authored keys -> RIFE 2x.

Asset production only. Runtime timing lives in the generated layouts, including
the adaptive bite keys. Source videos and previous runtime assets stay intact.
"""
from pathlib import Path
import argparse
import json
import math
import subprocess
import sys

import av
import cv2
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import distance_transform_edt

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[4]
TOOLS = REPO / "tools/ai-gen"
VIDEOS = ROOT.parent / "videos"


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def selections():
    # Loop windows exclude stationary startup/end poses. Every authored stride
    # frame is retained. The attack's true mouth closure starts at source f61.
    definitions = [
        ("idle", list(range(24, 108, 4)), 108, "loop", 3500),
        ("running", list(range(39, 53)), 53, "loop", 14000 / 24),
        ("attack", sorted(set(range(12, 109, 4)) | set(range(48, 65))), 109, "one-shot", 1000),
        ("dying", list(range(0, 65, 2)), 65, "one-shot", 65000 / 24),
    ]
    jobs = []
    for action, keys, end, mode, duration in definitions:
        # Death's settled final pose is sampled from the actual video endpoint.
        # It replaces the already still f64, without retaining another 2.3s hold.
        source_keys = keys[:-1] + [120] if action == "dying" else keys
        weights = []
        for i, key in enumerate(keys):
            delta = (keys[i + 1] if i + 1 < len(keys) else end) - key
            if i + 1 < len(keys) or mode == "loop":
                weights.extend([delta / 2, delta / 2])
            else:
                weights.append(delta)
        durations = [round(w / sum(weights) * duration, 6) for w in weights]
        durations[-1] = round(duration - sum(durations[:-1]), 6)
        job = dict(action=action, video=f"videos/zombie-dog-{action}-doubao-v01.mp4",
            mode=mode, sourceFps=24, sourceFrameCount=121, sourceFrameIndices=source_keys,
            clockFrameIndices=keys, sourceStart=keys[0], sourceEndExclusive=end,
            keyFps=6 if action == "idle" else (24 if action == "running" else 12),
            frameCount=len(durations), frameDurations=durations, duration=duration)
        if action == "attack":
            contact = keys.index(61) * 2
            job.update(contactSourceFrame=61, contactFrame=contact,
                activeFrames=[contact, keys.index(63) * 2],
                contactMs=round(sum(durations[:contact]), 3))
        jobs.append(job)
    write(ROOT / "selection.json", dict(approvedMother="zombie-dog-mother-v04-wolf-camera-white.png",
        approval="User approved the four Doubao videos and requested sprites/game integration and ordinary-attack cadence/reach alignment.",
        profile="crowd", targetMiB=32, admissionMiB=64, jobs=jobs))
    return jobs


def clean(rgb, alpha):
    alpha = np.asarray(alpha, dtype=np.uint8).squeeze().copy()
    _, labels, stats, _ = cv2.connectedComponentsWithStats((alpha > 12).astype(np.uint8), 8)
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    keep = cv2.dilate((labels == largest).astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    alpha[(~keep) | (alpha <= 12)] = 0
    reliable = alpha >= 224
    _, near = distance_transform_edt(~reliable, return_indices=True)
    rgb = rgb.copy()
    edge = (alpha > 0) & ~reliable
    rgb[edge] = rgb[near[0][edge], near[1][edge]]
    rgb[alpha == 0] = 0
    return Image.fromarray(np.dstack((rgb, alpha)))


def cutouts():
    sys.path.insert(0, str(TOOLS))
    from rmbg_cutout import get_model, predict_alpha
    jobs = selections()
    model = get_model()
    for job in jobs:
        action = job["action"]
        with av.open(str(ROOT.parent / job["video"])) as container:
            frames = [f.to_image().convert("RGB") for f in container.decode(video=0)]
        keys = sorted({0} | set(job["sourceFrameIndices"]))
        dest = ROOT / "cutouts" / action
        dest.mkdir(parents=True, exist_ok=True)
        for i, key in enumerate(keys):
            path = dest / f"f{key:03d}.png"
            if path.exists():
                continue
            im = frames[key]
            cached = ROOT / "references/idle-source-f000-alpha.png"
            alpha = np.asarray(Image.open(cached)) if action == "idle" and key == 0 else predict_alpha(model, im)
            clean(np.asarray(im), alpha).save(path)
            if i % 8 == 0 or i + 1 == len(keys):
                print(f"[cutout] {action} {i + 1}/{len(keys)}", flush=True)


def grid(count, width, height):
    candidates = []
    for cols in range(1, count + 1):
        rows = math.ceil(count / cols)
        if max(cols * width, rows * height) > 4096:
            continue
        waste = (cols * rows - count) / (cols * rows)
        if waste > .125:
            continue
        candidates.append((cols * rows, abs(math.log(cols * width / (rows * height))), cols, rows))
    return min(candidates)[2:]


def compose():
    jobs = selections()
    reference = Image.open(ROOT / "cutouts/idle/f000.png").convert("RGBA")
    box = reference.getchannel("A").getbbox()
    alpha = np.asarray(reference)[..., 3]
    ys, xs = np.nonzero(alpha[box[3] - 24:box[3]] > 24)
    origin = [(float(xs.min()) + float(xs.max())) / 2, box[3] - 1]
    body_height = load(ROOT / "calibration.json")["preparedBodyHeight"]
    scale = body_height / (box[3] - box[1])
    scaled_size = [round(reference.width * scale), round(reference.height * scale)]
    sx, sy = scaled_size[0] / reference.width, scaled_size[1] / reference.height
    cal = dict(sourceBox=list(box), sourceOrigin=origin, sourceScale=scale,
        scaledSourceSize=scaled_size, effectiveScale=[sx, sy], bodyHeight=body_height,
        referenceCell=256, worldPixelsPerAssetPixel=151 / 256,
        motionPolicy="Fixed source origin and pixel scale; no per-frame recentering, resizing or foot locking.")
    records = []
    for job in jobs:
        cells = []
        for key in job["sourceFrameIndices"]:
            im = Image.open(ROOT / "cutouts" / job["action"] / f"f{key:03d}.png").convert("RGBA")
            cells.append(im.convert("RGBa").resize(scaled_size, Image.Resampling.LANCZOS).convert("RGBA"))
        boxes = [im.getchannel("A").getbbox() for im in cells]
        x = origin[0] * sx
        # GameScene supports frameAnchorX, so an asymmetric action-wide crop
        # can remove empty columns while retaining the exact fixed foot origin.
        left = min(b[0] for b in boxes) - 4
        right = max(b[2] for b in boxes) + 4
        top = min(b[1] for b in boxes) - 4
        bottom = max(b[3] for b in boxes) + 4
        width, height = right - left, bottom - top
        cols, rows = grid(len(cells), width, height)
        sheet = Image.new("RGBA", (cols * width, rows * height))
        for i, im in enumerate(cells):
            cell = im.crop((left, top, left + width, bottom))
            sheet.paste(cell, (i % cols * width, i // cols * height))
        sheet.save(ROOT / "keys" / f"{job['action']}.png", optimize=True)
        out_cols, out_rows = grid(job["frameCount"], width, height)
        layout = dict(columns=out_cols, rows=out_rows, frameWidth=width, frameHeight=height,
            frameCount=job["frameCount"], footY=round(origin[1] * sy - top, 4),
            anchorX=round(x - left, 4), repeat=-1 if job["mode"] == "loop" else 0)
        if job["mode"] == "loop":
            layout["frameRate"] = job["frameCount"] * 1000 / job["duration"]
        else:
            layout.update(duration=job["duration"], frameDurations=job["frameDurations"])
        records.append(dict(**job, layout=layout, keyColumns=cols, keyRows=rows,
            crop=[left, top, left + width, bottom], gpuBytes=out_cols * out_rows * width * height * 4))
        print(f"[keys] {job['action']} {len(cells)} -> {job['frameCount']} frames, {width}x{height}, grid {out_cols}x{out_rows}", flush=True)
    write(ROOT / "composition.json", dict(calibration=cal, jobs=records,
        gpuBytes=sum(job["gpuBytes"] for job in records),
        gpuMiB=sum(job["gpuBytes"] for job in records) / 1024 ** 2))


def rife():
    for job in load(ROOT / "composition.json")["jobs"]:
        action, layout = job["action"], job["layout"]
        dest = ROOT / "final-crowd" / f"{action}.png"
        report = ROOT / "reports" / f"{action}-crowd-rife.json"
        if dest.exists() and report.exists():
            print(f"[rife] retained completed {action}", flush=True)
            continue
        command = [sys.executable, str(TOOLS / "rife-spritesheet-interpolate.py"),
            "--sheet", str(ROOT / "keys" / f"{action}.png"), "--out", str(dest),
            "--name", f"zombie-dog-{action}-v3", "--frame-width", str(layout["frameWidth"]),
            "--frame-height", str(layout["frameHeight"]), "--cols", str(job["keyColumns"]),
            "--frame-count", str(len(job["sourceFrameIndices"])), "--frame-rate", str(job["keyFps"]),
            "--mode", job["mode"], "--out-cols", str(layout["columns"]),
            "--preview-dir", str(ROOT / "previews/rife-source-speed-crowd"), "--report", str(report),
            "--preserve-vertical-motion", "--repair-red-outliers"]
        log_path = ROOT / "reports" / f"{action}-crowd-rife.log"
        print(f"[rife] {action} started", flush=True)
        with log_path.open("w", encoding="utf-8") as output:
            subprocess.run(command, stdout=output, stderr=subprocess.STDOUT, check=True)
        print(f"[rife] {action} ready", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("stage", choices=("cutouts", "compose", "rife"))
    args = parser.parse_args()
    {"cutouts": cutouts, "compose": compose, "rife": rife}[args.stage]()
