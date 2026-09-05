"""Offline six-action delivery GIFs. Reads runtime sheets; never modifies them."""
import json
from bisect import bisect_right
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
MANIFEST = json.loads((ROOT / 'runtime-layouts.json').read_text(encoding='utf-8'))
OUT = ROOT / 'previews' / 'runtime-20260830'


def durations(info, name):
    count = info['frameCount']
    total = info.get('duration', count * 1000 / info.get('frameRate', 12))
    values = [total / count] * count
    frame_durations = info.get('frameDurations', [])
    if len(frame_durations) == count:
        scale = total / sum(frame_durations)
        values = [value * scale for value in frame_durations]
    if name == 'drillRush':
        start, end = info['chargeStartFrame'], info['chargeEndFrame']
        recovery = total - info['prepareMs'] - info['chargeMs']
        values = ([info['prepareMs'] / start] * start
                  + [info['chargeMs'] / (end - start + 1)] * (end - start + 1)
                  + [recovery / (count - end - 1)] * (count - end - 1))
    # GIF stores centiseconds. Carry rounding so an action loses at most 5ms,
    # rather than rounding every frame and changing the whole action's speed.
    elapsed, previous = 0.0, 0
    result = []
    for value in values:
        elapsed += value
        current = round(elapsed / 10) * 10
        result.append(current - previous)
        previous = current
    return result


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    report = {'runtimeTested': False, 'runtimePngChanged': True,
              'note': 'Offline pose/timing previews of the repaired family. GIF replay is for inspection, not the in-game one-shot policy. Death hold/fade is not included.',
              'actions': {}}
    for name, info in MANIFEST['actions'].items():
        with Image.open(REPO / info['runtime']) as source:
            frames = []
            w, h, cols = info['frameWidth'], info['frameHeight'], info['columns']
            scale = info['runtimePixelScale']
            size = (round(w * scale), round(h * scale))
            for index in range(info['frameCount']):
                x, y = index % cols * w, index // cols * h
                cell = source.crop((x, y, x + w, y + h)).convert('RGBA')
                cell = cell.resize(size, Image.Resampling.LANCZOS)
                background = Image.new('RGB', size, (49, 51, 57))
                background.paste(cell, mask=cell.getchannel('A'))
                frames.append(background)
        times = durations(info, name)
        path = OUT / f'{name}.gif'
        frames[0].save(path, save_all=True, append_images=frames[1:],
                       duration=times, loop=0, disposal=2, optimize=False)
        report['actions'][name] = {
            'file': str(path.relative_to(ROOT)).replace('\\', '/'),
            'frameCount': len(frames), 'gifDurationMs': sum(times),
            'frameDurationsMs': times,
            'rgbaMiB': info['sheetWidth'] * info['sheetHeight'] * 4 / 1024 ** 2,
        }
        if name in ('walking', 'dying'):
            comparison(name, frames, times, info)
        print(f'{name}: {len(frames)} frames, {sum(times)}ms', flush=True)
    report['directRgbaMiB'] = sum(a['rgbaMiB'] for a in report['actions'].values())
    (OUT / 'preview-manifest.json').write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def comparison(name, after, times, info):
    old_info = json.loads((ROOT / 'review/runtime-layouts-before.json').read_text(encoding='utf-8'))['actions'][name]
    with Image.open(ROOT / 'review' / f'{name}-before.gif') as source:
        before = []
        before_ends = []
        before_elapsed = 0
        for index in range(source.n_frames):
            source.seek(index)
            before.append(source.convert('RGB').copy())
            before_elapsed += source.info.get('duration', 80)
            before_ends.append(before_elapsed)
    panel_width = max(before[0].width, after[0].width) + 60
    ground_y = 370
    height = 450
    old_foot = round(old_info['footY'] * old_info['runtimePixelScale'])
    new_foot = round(info['footY'] * info['runtimePixelScale'])
    combined = []
    elapsed = 0
    for index, current in enumerate(after):
        image = Image.new('RGB', (panel_width * 2, height), (49, 51, 57))
        old = before[min(bisect_right(before_ends, elapsed), len(before) - 1)]
        image.paste(old, (round(panel_width / 2 - old.width / 2), ground_y - old_foot))
        image.paste(current, (round(panel_width * 1.5 - current.width / 2), ground_y - new_foot))
        draw = ImageDraw.Draw(image)
        draw.line((0, ground_y + 1, panel_width * 2, ground_y + 1), fill=(100, 103, 110))
        draw.line((panel_width, 0, panel_width, height), fill=(100, 103, 110))
        draw.text((18, 18), 'BEFORE / v01 source', fill=(245, 180, 160))
        draw.text((panel_width + 18, 18), 'AFTER / v02 source / same world body height', fill=(170, 225, 190))
        combined.append(image)
        elapsed += times[index]
    path = OUT / f'{name}-before-after.gif'
    combined[0].save(path, save_all=True, append_images=combined[1:],
                     duration=times, loop=0, disposal=2, optimize=False)
    combined[0].save(OUT / f'{name}-before-after.png')


if __name__ == '__main__':
    main()
