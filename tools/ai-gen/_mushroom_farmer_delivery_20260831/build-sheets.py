#!/usr/bin/env python3
"""Produce mushroom-farmer keyframes with BiRefNet and one fixed transform.

Run with the project's ComfyUI Python after generating the MP4 via ai-asset.py.
No runtime files are overwritten here. The selected source window is half-open.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import av
import cv2
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
sys.path.insert(0, str(ROOT.parent))


def decode(path):
    with av.open(str(path)) as container:
        fps = float(container.streams.video[0].average_rate)
        return [f.to_ndarray(format="rgb24") for f in container.decode(video=0)], fps


def bbox(mask):
    ys, xs = np.where(mask)
    if not len(xs):
        raise ValueError("No subject in source frame")
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def proxy_mask(rgb):
    # Only used to inspect the source cycle; final alpha comes from BiRefNet.
    colors = rgb.astype(np.int16)
    blue = (colors[..., 2] - np.maximum(colors[..., 0], colors[..., 1])) > 22
    mask = (~blue).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    return labels == largest


def source_preview(frames, fps):
    selected = np.rint(np.linspace(0, len(frames) - 1, 24)).astype(int)
    contact = Image.new("RGB", (4 * 384, 6 * 238), "#1f242b")
    draw = ImageDraw.Draw(contact)
    for i, frame_index in enumerate(selected):
        x, y = i % 4 * 384, i // 4 * 238
        contact.paste(Image.fromarray(frames[frame_index]).resize((384, 216)), (x, y))
        draw.text((x + 5, y + 218), f"f{frame_index} / {frame_index / fps:.3f}s", fill="white")
    contact.save(ROOT / "previews" / "source-contact.png")
    images = [Image.fromarray(f).resize((512, 288)) for f in frames]
    save_gif(images, ROOT / "previews" / "source-video.gif", fps)


def save_gif(images, path, fps):
    # GIF ticks are 10ms; alternating durations preserve the playback clock.
    durations = [10 * (round((i + 1) * 100 / fps) - round(i * 100 / fps))
                 for i in range(len(images))]
    images[0].save(path, save_all=True, append_images=images[1:],
                   duration=durations, disposal=2, loop=0, optimize=False)


def rank_cycles(frames):
    # Preserve source scale and position while comparing leg-phase endpoints.
    masks = [proxy_mask(rgb) for rgb in frames]
    boxes = [bbox(mask) for mask in masks]
    top = round(np.median([y0 + (y1 - y0) * 0.65 for _, y0, _, y1 in boxes]))
    gray = [cv2.cvtColor(f, cv2.COLOR_RGB2GRAY).astype(np.float32) for f in frames]
    candidates = []
    for start in range(12, min(85, len(frames) - 20)):
        for period in range(16, 43, 2):
            end = start + period
            if end >= min(112, len(frames)):
                continue
            union = masks[start][top:] | masks[end][top:]
            overlap = masks[start][top:] & masks[end][top:]
            leg_iou = float(overlap.sum() / max(1, union.sum()))
            def delta(a, b):
                region = masks[a] | masks[b]
                return float(np.abs(gray[a] - gray[b])[region].mean())
            steps = [delta(i, i + 2) for i in range(start, end - 2, 2)]
            median = float(np.median(steps))
            seam = delta(end - 2, start)
            ratio = seam / max(0.001, median)
            endpoint_delta = delta(start, end)
            score = leg_iou - 0.015 * endpoint_delta - 0.1 * abs(ratio - 1)
            candidates.append(dict(start=start, endpoint=end, period=period,
                                   legIoU=leg_iou, endpointDelta=endpoint_delta,
                                   seamRatio=ratio, score=score))
    candidates.sort(key=lambda v: v["score"], reverse=True)
    (ROOT / "cycle-candidates.json").write_text(
        json.dumps(candidates[:30], indent=2) + "\n", encoding="utf-8")
    print(json.dumps(candidates[:8], indent=2), flush=True)


def cutout(rgb, model):
    from rmbg_cutout import predict_alpha
    from scipy.ndimage import distance_transform_edt
    alpha = np.squeeze(predict_alpha(model, Image.fromarray(rgb))).astype(np.float32)
    if alpha.max() <= 1.5:
        alpha *= 255
    if alpha.shape != rgb.shape[:2]:
        alpha = cv2.resize(alpha, (rgb.shape[1], rgb.shape[0]))
    alpha = np.clip(alpha, 0, 255).astype(np.uint8)
    alpha[alpha < 4] = 0
    # Fill soft matte-contaminated edges from the nearest solid subject color.
    # Inverse unmatting is unstable when H3 changes the requested background hue.
    color = rgb.astype(np.float32)
    a = alpha.astype(np.float32) / 255
    blue_excess = color[..., 2] - np.maximum(color[..., 0], color[..., 1])
    solid = (a >= .98) & (blue_excess < 10)
    _, nearest = distance_transform_edt(~solid, return_indices=True)
    edge = (a > 0) & ((a < .98) | (blue_excess >= 10))
    color[edge] = color[nearest[0][edge], nearest[1][edge]]
    # The farmer and mushrooms contain no blue: neutralize residual chroma bleed.
    color[..., 2] = np.minimum(color[..., 2], np.maximum(color[..., 0], color[..., 1]))
    color[alpha == 0] = 0
    return np.dstack([color.astype(np.uint8), alpha])


def remove_invented_tail(rgba):
    """Remove the isolated far-rear tail strip, clear of the pouch and both feet."""
    x0, y0, x1, y1 = bbox(rgba[..., 3] > 16)
    height = y1 - y0
    waist = rgba[round(y0 + height * .59):round(y0 + height * .75), :, 3]
    _, waist_x = np.where(waist > 16)
    anchor = float(np.median(waist_x))
    yy, xx = np.indices(rgba.shape[:2])
    mask = (xx < anchor - height * .28) & (yy > y0 + height * .48) & (yy < y0 + height * .88)
    clean = rgba.copy()
    clean[mask] = 0
    return clean


def checker(rgba):
    yy, xx = np.indices(rgba.shape[:2])
    bg = np.where(((xx // 16 + yy // 16) % 2)[..., None], 63, 85)
    a = rgba[..., 3:4].astype(np.float32) / 255
    return Image.fromarray(np.clip(rgba[..., :3] * a + bg * (1 - a), 0, 255).astype(np.uint8))


def prepare_return():
    """Reuse the accepted corn return's original (even-indexed) H3 keyframes."""
    farmer = REPO / "assets/companions/hamster_farmer"
    source = Image.open(farmer / "empty_running.png").convert("RGBA")
    sheet = Image.new("RGBA", (5 * 256, 3 * 256))
    for index in range(15):
        frame_index = index * 2
        x, y = frame_index % 8 * 512, frame_index // 8 * 512
        cell = source.crop((x, y, x + 512, y + 512))
        # Pillow RGBa performs premultiplied-alpha resizing.
        cell = cell.convert("RGBa").resize((256, 256), Image.Resampling.LANCZOS).convert("RGBA")
        sheet.paste(cell, (index % 5 * 256, index // 5 * 256))
    sheet.save(ROOT / "video-sheets/empty_running-base.png")
    idle = Image.open(farmer / "idle.png").convert("RGBA").crop((0, 0, 512, 512))
    idle = idle.convert("RGBa").resize((256, 256), Image.Resampling.LANCZOS).convert("RGBA")
    idle.save(ROOT / "video-sheets/idle.png")
    print("Prepared 15 original empty-return keyframes and a single idle frame; corn sources unchanged.", flush=True)


def finalize_previews():
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    output = REPO / "assets/companions/hamster_mushroom_farmer"
    loaded_count = manifest["frameCount"]
    loaded_cols = manifest["finalCols"]
    states = [("mushroom_loaded_running", loaded_count, loaded_cols), ("empty_running", 30, 6)]
    actions = []
    manifest["finalLoopSeamRatios"] = {}
    for name, count, cols in states:
        sheet = Image.open(output / f"{name}.png").convert("RGBA")
        cells = [np.asarray(sheet.crop((i % cols * 256, i // cols * 256,
                                        i % cols * 256 + 256, i // cols * 256 + 256)))
                 for i in range(count)]
        actions.append(cells)
        def delta(a, b):
            union = (a[..., 3] > 12) | (b[..., 3] > 12)
            gray_a = cv2.cvtColor(np.asarray(checker(a)), cv2.COLOR_RGB2GRAY).astype(np.float32)
            gray_b = cv2.cvtColor(np.asarray(checker(b)), cv2.COLOR_RGB2GRAY).astype(np.float32)
            return float(np.abs(gray_a - gray_b)[union].mean())
        normal = float(np.median([delta(a, b) for a, b in zip(cells, cells[1:])]))
        manifest["finalLoopSeamRatios"][name] = delta(cells[-1], cells[0]) / max(.001, normal)
        save_gif([checker(cell) for cell in cells], ROOT / "previews" / f"{name}.gif", 24)
    frames = []
    for index in range(120):
        frame = Image.new("RGB", (640, 334), "#20262d")
        draw = ImageDraw.Draw(frame)
        draw.text((50, 12), "TO WAREHOUSE: MUSHROOMS", fill="#f1d897")
        draw.text((352, 12), "RETURN TO FARM: EMPTY", fill="#d4e7d2")
        # Align the same world ground anchor despite the two different frame origins.
        frame.paste(checker(actions[0][index % loaded_count]), (30, 42 + 210 - manifest["footY"]))
        empty = np.ascontiguousarray(actions[1][index % 30][:, ::-1])
        frame.paste(checker(empty), (350, 42))
        draw.text((32, 312), "24 fps / 2x display preview / game movement handled by existing job", fill="#cad0d6")
        frames.append(frame)
    save_gif(frames, ROOT / "previews/delivery-preview.gif", 24)
    manifest["assets"] = []
    total = 0
    for name in ("idle", "mushroom_loaded_running", "empty_running"):
        path = output / f"{name}.png"
        with Image.open(path) as image:
            pixels = image.width * image.height
            total += pixels * 4
            manifest["assets"].append(dict(name=name, width=image.width, height=image.height,
                                           bytes=path.stat().st_size, rgbaMiB=pixels * 4 / 1048576))
    manifest["totalRgbaMiB"] = total / 1048576
    manifest["runtimeFamily"] = "hamster_mushroom_farmer"
    manifest["targetMiB"] = 32
    manifest["runtimeValidated"] = False
    manifest["runtimeAnimations"] = {
        "idle": dict(frameCount=1, frameRate=1, repeat=-1, footRatio=.7988),
        "mushroom_loaded_running": dict(frameCount=30, frameRate=24, repeat=-1,
                                         holdFrame=12, footRatio=.875, cycleMs=1250),
        "empty_running": dict(frameCount=30, frameRate=24, repeat=-1,
                              holdFrame=0, footRatio=.8203125, cycleMs=1250),
    }
    (ROOT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest["assets"], indent=2), flush=True)


def build(frames, fps, args):
    from rmbg_cutout import get_model
    model = None
    indices = list(range(args.start, args.endpoint, args.step))
    output = ROOT / "video-sheets"
    rgba_frames = []
    for index in indices:
        cache = output / f"source-f{index:03d}.png"
        if cache.exists() and not args.refresh_cutouts:
            rgba = np.asarray(Image.open(cache).convert("RGBA"))
        else:
            if model is None:
                model = get_model()
            rgba = remove_invented_tail(cutout(frames[index], model))
            Image.fromarray(rgba).save(cache)
        rgba_frames.append(rgba)
        print(f"[mushroom-farmer] prepared keyframe {index}", flush=True)
    boxes = [bbox(rgba[..., 3] > 16) for rgba in rgba_frames]
    median_height = float(np.median([y1 - y0 for _, y0, _, y1 in boxes]))
    scale = 199.0 / median_height  # half-resolution of the existing 398/512 farmer.
    anchors = []
    for rgba, (x0, y0, x1, y1) in zip(rgba_frames, boxes):
        waist = rgba[round(y0 + (y1 - y0) * .61):round(y0 + (y1 - y0) * .77), :, 3]
        ys, xs = np.where(waist > 16)
        anchors.append(float(np.median(xs)))
    anchor_x = float(np.median(anchors))
    ground_y = max(box[3] for box in boxes) - 1
    matrix = np.array([[scale, 0, 128 - anchor_x * scale],
                       [0, scale, 224 - ground_y * scale]], np.float32)
    cells = []
    for rgba in rgba_frames:
        premult = rgba.astype(np.float32)
        premult[..., :3] *= premult[..., 3:4] / 255
        resized = cv2.warpAffine(premult, matrix, (256, 256), flags=cv2.INTER_LANCZOS4)
        resized = np.clip(resized, 0, 255)
        a = resized[..., 3:4] / 255
        resized[..., :3] = np.divide(resized[..., :3], a, out=np.zeros_like(resized[..., :3]), where=a > .005)
        resized = np.clip(resized, 0, 255).astype(np.uint8)
        # Preserve the olive vest's green channel while removing blue/cyan matte remnants.
        resized[..., 2] = np.minimum(resized[..., 2], resized[..., 0])
        resized[resized[..., 3] < 2] = 0
        x0, y0, x1, y1 = bbox(resized[..., 3] > 8)
        if min(x0, y0) < 3 or max(x1, y1) > 253:
            raise ValueError("Source motion exceeds the 256px canvas; choose a wider fixed canvas")
        cells.append(resized)
    cols = min(8, len(cells))
    sheet = Image.new("RGBA", (cols * 256, math.ceil(len(cells) / cols) * 256))
    for i, rgba in enumerate(cells):
        sheet.paste(Image.fromarray(rgba), (i % cols * 256, i // cols * 256))
    sheet.save(output / "mushroom_loaded_running-base.png")
    save_gif([checker(cell) for cell in cells], ROOT / "previews" / "keyframes.gif", fps / args.step)
    manifest = dict(profile="crowd", sourceVideo=str(args.video.relative_to(ROOT)),
                    start=args.start, endpoint=args.endpoint, sourceStep=args.step,
                    sourceIndices=indices, sourceFrameRate=fps, baseFrameRate=fps / args.step,
                    baseFrameCount=len(cells), frameCount=len(cells) * 2,
                    frameRate=fps / args.step * 2, durationMs=len(cells) / (fps / args.step) * 1000,
                    frameWidth=256, frameHeight=256, baseCols=cols, footX=128, footY=224,
                    footRatio=224 / 256, displaySize=128, scale=1,
                    fixedSourceScale=scale, sourceHeightMedian=median_height,
                    fixedAffine=matrix.tolist(), verticalMotionPreserved=True,
                    alphaBottoms=[bbox(cell[..., 3] > 16)[3] - 1 for cell in cells],
                    emptyReturn="assets/companions/hamster_farmer/empty_running.png")
    # Prefer exact rows within a compact texture; no fixed power-of-two padding.
    count = manifest["frameCount"]
    manifest["finalCols"] = min((c for c in range(1, 17) if math.ceil(count / c) <= 16),
                                key=lambda c: (math.ceil(count / c) * c,
                                               abs(c - math.ceil(count / c))))
    (ROOT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, indent=2), flush=True)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--video", type=Path, default=ROOT / "videos/mushroom-loaded-running-v01.mp4")
    p.add_argument("--preview", action="store_true")
    p.add_argument("--prepare-return", action="store_true")
    p.add_argument("--finalize-previews", action="store_true")
    p.add_argument("--start", type=int)
    p.add_argument("--endpoint", type=int)
    p.add_argument("--step", type=int, default=2)
    p.add_argument("--refresh-cutouts", action="store_true")
    args = p.parse_args()
    if args.prepare_return:
        prepare_return()
        return
    if args.finalize_previews:
        finalize_previews()
        return
    args.video = args.video.resolve()
    frames, fps = decode(args.video)
    if args.preview:
        source_preview(frames, fps)
        rank_cycles(frames)
    else:
        if args.start is None or args.endpoint is None:
            p.error("Select a source cycle using --start and --endpoint")
        build(frames, fps, args)


if __name__ == "__main__":
    main()
