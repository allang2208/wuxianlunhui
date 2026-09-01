"""Package Hollow Ovum sheets and exact-clock previews without runtime writes."""

from __future__ import annotations

from pathlib import Path
import json
import math

import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
ROOT_POINT = (256, 270)
PREVIEW_SIZE = (512, 320)


def write(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def read(path: Path) -> dict:
    return json.loads(path.read_text(encoding='utf-8'))


def cells(path: Path, layout: dict, count: int | None = None, columns: int | None = None) -> list[Image.Image]:
    sheet = Image.open(path).convert('RGBA')
    width, height = layout['frameWidth'], layout['frameHeight']
    cols = columns or layout['columns']
    return [
        sheet.crop((index % cols * width, index // cols * height,
                    (index % cols + 1) * width, (index // cols + 1) * height))
        for index in range(count or layout['frameCount'])
    ]


def checker() -> Image.Image:
    yy, xx = np.indices((PREVIEW_SIZE[1], PREVIEW_SIZE[0]))
    rgb = np.where((((xx // 16 + yy // 16) % 2) == 0)[..., None],
                   np.array([40, 45, 52]), np.array([54, 59, 66]))
    return Image.fromarray(rgb.astype(np.uint8)).convert('RGBA')


def view(frame: Image.Image, layout: dict) -> Image.Image:
    output = checker()
    left = round(ROOT_POINT[0] - layout['footX'])
    top = round(ROOT_POINT[1] - layout['footY'])
    output.alpha_composite(frame, (left, top))
    draw = ImageDraw.Draw(output)
    draw.line((ROOT_POINT[0] - 5, ROOT_POINT[1] + 3,
               ROOT_POINT[0] + 5, ROOT_POINT[1] + 3), fill=(180, 170, 95))
    return output.convert('RGB')


def exact_gif(frames: list[Image.Image], durations: list[float], path: Path, loop: bool) -> dict:
    boundaries = [0]
    elapsed = 0.0
    for duration in durations:
        elapsed += duration
        boundaries.append(round(elapsed / 10) * 10)
    clock = [boundaries[index + 1] - boundaries[index] for index in range(len(durations))]
    if min(clock) <= 0:
        raise ValueError('GIF clock needs intervals of at least 10ms')
    options = dict(save_all=True, append_images=frames[1:], duration=clock, disposal=2, optimize=False)
    if loop:
        options['loop'] = 0
    frames[0].save(path, **options)
    with Image.open(path) as image:
        actual = 0
        for index in range(image.n_frames):
            image.seek(index)
            actual += image.info.get('duration', 0)
        return {
            'frameCount': image.n_frames, 'durationMs': actual,
            'intendedDurationMs': sum(durations),
            'quantization': 'cumulative timestamps rounded to 10ms', 'looping': loop,
        }


def contact(previews: list[Image.Image], durations: list[float], action: str) -> Path:
    indices = np.linspace(0, len(previews) - 1, min(24, len(previews)), dtype=int)
    output = Image.new('RGB', (6 * 384, math.ceil(len(indices) / 6) * 202), (27, 31, 37))
    draw = ImageDraw.Draw(output)
    starts = np.cumsum([0] + durations[:-1])
    for slot, index in enumerate(indices):
        x, y = slot % 6 * 384, slot // 6 * 202
        output.paste(previews[index].resize((384, 180), Image.Resampling.LANCZOS), (x, y))
        draw.text((x + 6, y + 184), f'{action} f{index:03d} / {starts[index] / 1000:.3f}s', fill=(225, 225, 225))
    path = ROOT / 'previews' / f'{action}-contact.png'
    output.save(path)
    return path


def main() -> None:
    composition = read(ROOT / 'composition.json')
    inventory = read(ROOT / 'source-inventory.json')
    records = []
    overview = Image.new('RGB', (512 * len(composition['jobs']), 350 * 2), (27, 31, 37))
    overview_draw = ImageDraw.Draw(overview)
    for column, job in enumerate(composition['jobs']):
        action, layout = job['action'], job['layout']
        frames = cells(ROOT / 'final' / f'{action}.png', layout)
        originals = cells(ROOT / 'keys' / f'{action}.png', layout,
                          len(job['sourceFrameIndices']), job['keyColumns'])
        previews = [view(frame, layout) for frame in frames]
        gif_path = ROOT / 'previews' / f'{action}.gif'
        gif_info = exact_gif(previews, layout['frameDurationsMs'], gif_path, job['mode'] == 'loop')
        contact_path = contact(previews, layout['frameDurationsMs'], action)
        representative = len(frames) - 1 if action == 'death' else len(frames) // 2
        for row, index in enumerate((0, representative)):
            x, y = column * 512, row * 350
            overview.paste(previews[index], (x, y))
            overview_draw.text((x + 10, y + 325), f'{action} frame {index}/{len(frames)-1}', fill=(230, 230, 230))

        arrays = [np.asarray(frame) for frame in frames]
        alpha_boxes = [frame.getchannel('A').getbbox() for frame in frames]
        margins = [min(box[0], box[1], layout['frameWidth'] - box[2], layout['frameHeight'] - box[3])
                   for box in alpha_boxes if box]
        key_preserved = all(np.array_equal(np.asarray(key), arrays[index * 2])
                            for index, key in enumerate(originals))
        transparent_rgb = sum(int(np.any(array[..., :3][array[..., 3] == 0], axis=1).sum()) for array in arrays)
        rife = read(ROOT / 'reports' / f'{action}-rife.json')
        loop_delta = None
        if job['mode'] == 'loop':
            rgb = [np.asarray(frame).astype(np.float32) for frame in previews]
            adjacent = [float(np.abs(rgb[index] - rgb[index - 1]).mean()) for index in range(1, len(rgb))]
            loop_delta = {
                'lastToFirst': float(np.abs(rgb[-1] - rgb[0]).mean()),
                'meanAdjacent': float(np.mean(adjacent)),
                'note': 'Pixel difference diagnostic only; not a visual seamlessness guarantee.',
            }
        record = {
            'action': action, 'sheet': f'final/{action}.png', 'sourceSheet': f'keys/{action}.png',
            'sourceVideo': job['video'], 'sourceRecord': inventory[action]['sourceRecord'],
            'sourceFrameIndices': job['sourceFrameIndices'],
            'sourceRange': [job['sourceStart'], job['sourceEndExclusive']], 'mode': job['mode'],
            'sourceScale': composition['sourceScale'], 'layout': layout,
            'decodedBytes': job['gpuBytes'], 'decodedMiB': job['gpuBytes'] / 1024 ** 2,
            'textureKeyProposal': f'enemy_hollow_ovum_{action}', 'registered': False,
            'gif': f'previews/{action}.gif', 'contact': contact_path.relative_to(ROOT).as_posix(),
            'gifClock': gif_info, 'sourceKeysPreservedAtEvenFrames': key_preserved,
            'emptyFrames': sum(box is None for box in alpha_boxes), 'minAlphaMargin': min(margins),
            'transparentPixelsWithNonzeroRGB': transparent_rgb,
            'interpolationReport': f'reports/{action}-rife.json',
            'interpolationStatistics': rife['validation'], 'loopDifference': loop_delta,
        }
        if action == 'pulse':
            source_frame = job['eventSourceFrame']
            output_frame = job['sourceFrameIndices'].index(source_frame) * 2
            record['pulsePeak'] = {
                'sourceFrame': source_frame, 'outputFrame': output_frame,
                'timeMs': sum(layout['frameDurationsMs'][:output_frame]),
                'status': 'Visual pulse peak; gameplay damage and range require explicit runtime design.',
            }
        if action == 'vacuum':
            source_frame = 60
            output_frame = job['sourceFrameIndices'].index(source_frame) * 2
            record['vacuumPeak'] = {
                'sourceFrame': source_frame, 'outputFrame': output_frame,
                'timeMs': sum(layout['frameDurationsMs'][:output_frame]),
                'status': 'Maximum stable cavity opening in the accepted source.',
            }
        records.append(record)
        print(json.dumps({key: record[key] for key in (
            'action', 'decodedMiB', 'emptyFrames', 'minAlphaMargin',
            'sourceKeysPreservedAtEvenFrames', 'gifClock')}, ensure_ascii=False), flush=True)

    overview_path = ROOT / 'previews/all-actions-fixed-root.png'
    overview.save(overview_path)
    reference_height = (composition['sourceBox'][3] - composition['sourceBox'][1]) * composition['sourceScale']
    manifest = {
        'unitKey': 'hollow_ovum', 'stage': 'transparent_sprite_candidates_ready',
        'userReply': '可用继续', 'approvedForRuntime': False, 'runtimeIntegrated': False,
        'sourceScale': composition['sourceScale'], 'sourceOrigin': composition['sourceOrigin'],
        'referenceCell': composition['referenceCell'], 'usageTier': 'boss',
        'targetMiB': 128, 'admissionMiB': 256, 'totalDecodedMiB': composition['gpuMiB'],
        'dependencies': [],
        'dependencyNote': 'Five unique body animation textures only; no dedicated projectile, summon, or VFX texture is included.',
        'worldScale': None, 'normalZoomBodyPixels': reference_height,
        'maximumZoomBodyPixels': reference_height * 1.03, 'collider': None,
        'timingPolicy': 'Approved source clocks retained. Pulse trims the redundant idle tail to source frames 0..60; one-shots keep the selected final source-frame dwell.',
        'motionPolicy': composition['motionPolicy'], 'actions': records,
        'sourceSelection': 'selection.json', 'producer': 'produce-sprites.py',
        'packager': 'finish-sprites.py', 'overview': 'previews/all-actions-fixed-root.png',
        'testsRun': False, 'runtimeValidationRun': False,
        'inspectionBoundary': 'Offline frame statistics and generated previews only; no tests, build, browser, or game runtime checks.',
    }
    proposals = {}
    for record in records:
        layout = record['layout']
        proposals[record['action']] = {
            'texture': record['sheet'], 'textureKey': record['textureKeyProposal'],
            'columns': layout['columns'], 'rows': layout['rows'],
            'frameWidth': layout['frameWidth'], 'frameHeight': layout['frameHeight'],
            'frameCount': layout['frameCount'], 'endFrame': layout['endFrame'],
            'footX': layout['footX'], 'footY': layout['footY'],
            'originX': layout['footX'] / layout['frameWidth'],
            'originY': layout['footY'] / layout['frameHeight'],
            'duration': layout['durationMs'], 'frameDurations': layout['frameDurationsMs'],
            'repeat': layout['repeat'],
        }
    parameters = {
        'status': 'proposal_not_registered', 'referenceCell': composition['referenceCell'],
        'actions': proposals, 'collision': None, 'displaySize': None,
        'skills': None,
        'warning': 'Requires explicit entity/loader/config integration; this file is not automatically consumed by the game.',
    }
    write(ROOT / 'sprite-manifest.json', manifest)
    write(ROOT / 'animation-parameters.json', parameters)


if __name__ == '__main__':
    main()
