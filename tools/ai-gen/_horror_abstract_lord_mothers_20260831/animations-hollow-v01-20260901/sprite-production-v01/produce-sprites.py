"""Hollow Ovum videos -> fixed-scale RGBA keys -> RIFE 2x sheets.

Offline asset production only.  All actions share one source-canvas hover root
and one uniform scale.  No per-frame centering, scaling, foot locking, or
geometry correction is performed.
"""

from __future__ import annotations

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
ANIM = ROOT.parent
REPO = ROOT.parents[4]
RIFE = REPO.parent / '_tmp/elise_audit/rife/rife-ncnn-vulkan-20221029-windows/rife-ncnn-vulkan.exe'
SCALE = 0.5
SOURCE_CANVAS = (1024, 576)
SCALED_CANVAS = (512, 288)


def write(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding='utf-8'))


def jobs() -> list[dict]:
    result = []
    for raw in load(ROOT / 'selection.json')['jobs']:
        job = dict(raw)
        indices = list(range(job['sourceStart'], job['sourceEndExclusive'], job['stride']))
        if job.get('includeLastFrame') and indices[-1] != job['sourceEndExclusive'] - 1:
            indices.append(job['sourceEndExclusive'] - 1)
        job['sourceFrameIndices'] = indices
        result.append(job)
    return result


def video_path(job: dict) -> Path:
    return (ROOT / job['video']).resolve()


def decode(job: dict) -> tuple[list[Image.Image], float, float]:
    path = video_path(job)
    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        frames = [frame.to_image().convert('RGB') for frame in container.decode(stream)]
        duration = float(stream.duration * stream.time_base)
        fps = float(stream.average_rate)
    if len(frames) != 124 or frames[0].size != SOURCE_CANVAS:
        raise RuntimeError(f'{path}: expected 124 frames at {SOURCE_CANVAS}, got {len(frames)} at {frames[0].size}')
    return frames, fps, duration


def contact(images: list[Image.Image], indices: list[int], path: Path) -> None:
    thumb = (320, 180)
    cols = 6
    rows = math.ceil(len(indices) / cols)
    out = Image.new('RGB', (cols * thumb[0], rows * (thumb[1] + 22)), (235, 235, 235))
    draw = ImageDraw.Draw(out)
    for slot, index in enumerate(indices):
        x = slot % cols * thumb[0]
        y = slot // cols * (thumb[1] + 22)
        out.paste(images[index].resize(thumb, Image.Resampling.LANCZOS), (x, y))
        draw.text((x + 5, y + thumb[1] + 3), f'f{index:03d} / {index / 24:.3f}s', fill=(15, 15, 15))
    path.parent.mkdir(parents=True, exist_ok=True)
    out.save(path)


def prepare() -> None:
    for name in ('references', 'contacts', 'cutouts', 'keys', 'final', 'previews', 'reports'):
        (ROOT / name).mkdir(parents=True, exist_ok=True)
    inventory = {}
    for job in jobs():
        frames, fps, duration = decode(job)
        source = video_path(job)
        provenance = source.with_suffix(source.suffix + '.json')
        derived = ANIM / 'videos/structure-safe-derived-videos.json'
        source_record = provenance if provenance.exists() else derived
        if not source_record.exists():
            raise FileNotFoundError(f'No source provenance for {source}')
        frames[0].save(ROOT / 'references' / f"{job['action']}-f000.png")
        contact(frames, job['sourceFrameIndices'], ROOT / 'contacts' / f"{job['action']}-selected-source.png")
        inventory[job['action']] = {
            'video': job['video'],
            'sourceRecord': source_record.relative_to(ANIM).as_posix(),
            'frameCount': len(frames),
            'fps': fps,
            'durationMs': duration * 1000,
            'selectedFrames': job['sourceFrameIndices'],
            'selectedRange': [job['sourceStart'], job['sourceEndExclusive']],
            'mode': job['mode'],
            'size': list(frames[0].size),
        }
    write(ROOT / 'source-inventory.json', inventory)
    print(json.dumps(inventory, ensure_ascii=False), flush=True)


def clean(rgb: np.ndarray, alpha: np.ndarray) -> Image.Image:
    alpha = np.asarray(alpha, dtype=np.uint8).squeeze().copy()
    count, labels, stats, _ = cv2.connectedComponentsWithStats((alpha > 12).astype(np.uint8), 8)
    if count < 2:
        raise RuntimeError('No foreground returned by BiRefNet')
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    keep = cv2.dilate((labels == largest).astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    alpha[(~keep) | (alpha <= 12)] = 0
    reliable = alpha >= 224
    if not reliable.any():
        raise RuntimeError('No reliable opaque foreground')
    _, nearest = distance_transform_edt(~reliable, return_indices=True)
    fixed = rgb.copy()
    edge = (alpha > 0) & ~reliable
    fixed[edge] = fixed[nearest[0][edge], nearest[1][edge]]
    fixed[alpha == 0] = 0
    return Image.fromarray(np.dstack((fixed, alpha)))


def cutouts() -> None:
    sys.path.insert(0, str(ROOT / 'producer'))
    from rmbg_cutout import get_model, predict_alpha

    model = get_model()
    for job in jobs():
        frames, _, _ = decode(job)
        destination = ROOT / 'cutouts' / job['action']
        destination.mkdir(parents=True, exist_ok=True)
        for number, key in enumerate(job['sourceFrameIndices']):
            path = destination / f'f{key:03d}.png'
            if path.exists():
                continue
            image = frames[key]
            alpha = predict_alpha(model, image)
            clean(np.asarray(image), alpha).save(path)
            if number % 8 == 0 or number + 1 == len(job['sourceFrameIndices']):
                print(f"[cutout] {job['action']} {number + 1}/{len(job['sourceFrameIndices'])}", flush=True)


def choose_grid(count: int, width: int, height: int) -> tuple[int, int]:
    options = []
    for columns in range(1, count + 1):
        rows = math.ceil(count / columns)
        waste = (rows * columns - count) / (rows * columns)
        if max(columns * width, rows * height) <= 4096 and waste <= 0.125:
            options.append((rows * columns, abs(math.log(columns * width / (rows * height))), columns, rows))
    if not options:
        raise RuntimeError(f'No <=4096 layout for {count} frames of {width}x{height}')
    return min(options)[2:]


def frame_clock(job: dict) -> list[float]:
    keys = job['sourceFrameIndices']
    times = []
    for index, key in enumerate(keys):
        end = keys[index + 1] if index + 1 < len(keys) else job['sourceEndExclusive']
        duration = (end - key) * 1000 / 24
        if index + 1 < len(keys) or job['mode'] == 'loop':
            times.extend((duration / 2, duration / 2))
        else:
            times.append(duration)
    return times


def compose() -> None:
    reference = Image.open(ROOT / 'cutouts/idle/f000.png').convert('RGBA')
    box = reference.getchannel('A').getbbox()
    if not box:
        raise RuntimeError('Idle reference has no alpha')
    alpha = np.asarray(reference)[..., 3]
    band_top = max(box[1], box[3] - 20)
    ys, xs = np.where(alpha[band_top:box[3]] > 24)
    source_origin = [(float(xs.min()) + float(xs.max())) / 2, float(box[3] - 1)]
    scaled_origin = [value * SCALE for value in source_origin]
    records = []
    for job in jobs():
        cells = []
        for key in job['sourceFrameIndices']:
            image = Image.open(ROOT / 'cutouts' / job['action'] / f'f{key:03d}.png').convert('RGBA')
            resized = np.asarray(image.convert('RGBa').resize(SCALED_CANVAS, Image.Resampling.LANCZOS).convert('RGBA')).copy()
            resized[resized[..., 3] == 0, :3] = 0
            cells.append(Image.fromarray(resized))
        boxes = [cell.getchannel('A').getbbox() for cell in cells]
        radius = math.ceil(max(scaled_origin[0] - min(b[0] for b in boxes), max(b[2] for b in boxes) - scaled_origin[0])) + 4
        left = math.floor(scaled_origin[0] - radius)
        right = math.ceil(scaled_origin[0] + radius)
        top = min(b[1] for b in boxes) - 4
        bottom = max(b[3] for b in boxes) + 4
        width, height = right - left, bottom - top
        key_columns, key_rows = choose_grid(len(cells), width, height)
        sheet = Image.new('RGBA', (key_columns * width, key_rows * height))
        for index, image in enumerate(cells):
            sheet.paste(image.crop((left, top, right, bottom)), (index % key_columns * width, index // key_columns * height))
        sheet.save(ROOT / 'keys' / f"{job['action']}.png", optimize=True)
        clock = frame_clock(job)
        columns, rows = choose_grid(len(clock), width, height)
        layout = {
            'columns': columns, 'rows': rows, 'frameWidth': width, 'frameHeight': height,
            'frameCount': len(clock), 'endFrame': len(clock) - 1,
            'footX': round(scaled_origin[0] - left, 4), 'footY': round(scaled_origin[1] - top, 4),
            'repeat': -1 if job['mode'] == 'loop' else 0,
            'durationMs': round(sum(clock), 6), 'frameDurationsMs': clock,
        }
        record = dict(job)
        record.update({'layout': layout, 'keyColumns': key_columns, 'keyRows': key_rows,
                       'crop': [left, top, right, bottom], 'sourceScale': SCALE,
                       'gpuBytes': columns * rows * width * height * 4})
        records.append(record)
        print(f"[keys] {job['action']} {len(cells)} -> {len(clock)} frames, {width}x{height}, {columns}x{rows}", flush=True)
    total = sum(record['gpuBytes'] for record in records)
    result = {
        'unitKey': 'hollow_ovum', 'profile': 'boss', 'targetMiB': 128, 'admissionMiB': 256,
        'sourceOrigin': source_origin, 'sourceBox': list(box), 'sourceScale': SCALE,
        'scaledSourceSize': list(SCALED_CANVAS), 'referenceCell': SCALED_CANVAS[0],
        'motionPolicy': 'One fixed source-canvas hover root and uniform scale; preserve authored vertical motion; gameplay moves the Collider.',
        'jobs': records, 'gpuBytes': total, 'gpuMiB': total / 1024 ** 2,
        'runtimeIntegrated': False,
    }
    write(ROOT / 'composition.json', result)
    print(json.dumps({'gpuMiB': result['gpuMiB'], 'sourceOrigin': source_origin}), flush=True)
    if total > 256 * 1024 ** 2:
        raise RuntimeError('Boss admission budget exceeded')


def interpolate() -> None:
    composition = load(ROOT / 'composition.json')
    for job in composition['jobs']:
        action, layout = job['action'], job['layout']
        destination = ROOT / 'final' / f'{action}.png'
        report = ROOT / 'reports' / f'{action}-rife.json'
        if destination.exists() and report.exists():
            print(f'[rife] retaining completed {action}', flush=True)
            continue
        command = [
            sys.executable, str(ROOT / 'producer/rife-spritesheet-interpolate.py'),
            '--sheet', str(ROOT / 'keys' / f'{action}.png'), '--out', str(destination),
            '--name', f'hollow-ovum-{action}', '--frame-width', str(layout['frameWidth']),
            '--frame-height', str(layout['frameHeight']), '--cols', str(job['keyColumns']),
            '--frame-count', str(len(job['sourceFrameIndices'])), '--frame-rate', str(job['keyFps']),
            '--mode', job['mode'], '--out-cols', str(layout['columns']), '--rife', str(RIFE),
            '--preview-dir', str(ROOT / 'previews/rife-default-clock'), '--report', str(report),
            '--preserve-vertical-motion',
        ]
        print(f'[rife] {action} started', flush=True)
        with (ROOT / 'reports' / f'{action}-rife.log').open('w', encoding='utf-8') as output:
            subprocess.run(command, stdout=output, stderr=subprocess.STDOUT, check=True)
        print(f'[rife] {action} complete', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('stage', choices=('prepare', 'cutouts', 'compose', 'interpolate'))
    args = parser.parse_args()
    globals()[args.stage]()
