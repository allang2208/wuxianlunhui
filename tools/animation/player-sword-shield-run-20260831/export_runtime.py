"""Import the approved slash/run pixels; never imports the unapproved thrust.

Trim and pack at original resolution. No resampling, combat config or tests.
"""
import base64
import io
import json
from pathlib import Path
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
OUT = ROOT / 'assets/player/sword-shield-motion'
DATA = ROOT / 'data/player-sword-shield-motion.json'


def main():
    payload = (HERE / 'transitions/transition-data.js').read_text(encoding='utf-8')
    source = json.loads(payload.split(' = ', 1)[1].strip().removesuffix(';'))
    sequences = [s for s in source['sequences'] if s['branch'] == 'slash']
    OUT.mkdir(parents=True, exist_ok=True)
    images, poses = {}, {}

    def pose(record, grip_mode='texture', entry_mix=0):
        ident = record['body']
        if ident not in images:
            images[ident] = Image.open(io.BytesIO(base64.b64decode(source['bodies'][ident].split(',')[1]))).convert('RGBA')
        palm = tuple(round(v, 3) for v in record['points']['mainPalm'])
        key = (ident, palm, grip_mode, entry_mix, json.dumps(record['sword']))
        if key not in poses:
            hand = Image.new('RGBA', (512, 512))
            mask = Image.new('L', (512, 512))
            ImageDraw.Draw(mask).ellipse((palm[0]-14,palm[1]-16,palm[0]+14,palm[1]+16), fill=255)
            hand.paste(images[ident], mask=mask)
            poses[key] = {'bodyId': ident, 'handImage': hand, 'sword': record['sword'],
                          'shield': record['shield'], 'gripMode': grip_mode, 'entryMix': entry_mix}
        return list(poses).index(key)

    sample = sequences[0]
    run = [None] * 8
    for record in sample['records']:
        if record['timeMs'] < sample['attackAtMs']:
            run[record['sourceFrame']] = pose(record)
    entries = []
    for seq in sequences:
        def entry_pose(r):
            u = (r['timeMs'] - seq['attackAtMs']) / 120
            return pose(r, 'bridge', u*u*(3-2*u))
        entries.append([[round(r['timeMs']-seq['attackAtMs'], 5), entry_pose(r)]
                        for r in seq['records'] if seq['attackAtMs'] <= r['timeMs'] < seq['attackAtMs'] + 120])
    recovery = [[round(r['timeMs']-sample['recoverAtMs'], 5), pose(r)] for r in sample['records']
                if sample['recoverAtMs'] <= r['timeMs'] < sample['returnAtMs']]
    recovery.append([500, run[sample['returnRunFrame']]])

    # Atlas trim retains the 512px source rectangle and its original origin.
    tiles = [(f'b{key}', image) for key, image in images.items()]
    tiles += [(f'h{i}', p.pop('handImage')) for i, p in enumerate(poses.values())]
    pages, locations = [], {}
    page = Image.new('RGBA', (2048, 2048))
    frames, x, y, row_h = {}, 1, 1, 0

    def flush():
        nonlocal page, frames, x, y, row_h
        index = len(pages)
        height = y + row_h + 1
        name = f'motion-{index}'
        page.crop((0, 0, 2048, height)).save(OUT / f'{name}.png')
        (OUT / f'{name}.json').write_text(json.dumps({'frames': frames, 'meta': {'image': f'{name}.png',
            'size': {'w': 2048, 'h': height}, 'scale': '1'}}, separators=(',', ':')) + '\n', encoding='utf-8')
        pages.append({'key': f'player_sword_shield_{index}', 'image': f'assets/player/sword-shield-motion/{name}.png',
                      'atlas': f'assets/player/sword-shield-motion/{name}.json', 'width': 2048, 'height': height})
        page, frames, x, y, row_h = Image.new('RGBA', (2048, 2048)), {}, 1, 1, 0

    for name, image in tiles:
        bbox = image.getbbox() or (0, 0, 1, 1)
        left, top, right, bottom = bbox
        w, h = right-left, bottom-top
        if x + w + 1 > 2048:
            x, y, row_h = 1, y + row_h + 2, 0
        if y + h + 1 > 2048:
            flush()
        page.paste(image.crop(bbox), (x, y))
        frames[name] = {'frame': {'x': x, 'y': y, 'w': w, 'h': h}, 'rotated': False, 'trimmed': True,
                        'spriteSourceSize': {'x': left, 'y': top, 'w': w, 'h': h}, 'sourceSize': {'w': 512, 'h': 512}}
        locations[name] = len(pages)
        x += w + 2
        row_h = max(row_h, h)
    flush()
    packed = []
    for index, value in enumerate(poses.values()):
        body = f'b{value.pop("bodyId")}'
        hand = f'h{index}'
        packed.append(dict(value, body=[locations[body], body], hand=[locations[hand], hand]))
    metadata = {'status': 'approved-slash-and-low-carry-run', 'sourceSize': 512, 'runFps': 10,
                'entryMs': 120, 'attackReferenceMs': sample['attackMs'], 'recoverMs': 500,
                'referenceGrip': source['weapons']['slash']['grip'],
                'returnRunFrame': sample['returnRunFrame'], 'pages': pages, 'poses': packed,
                'run': run, 'entries': entries, 'recovery': recovery,
                'rgbaBytes': sum(p['width']*p['height']*4 for p in pages),
                'source': 'tools/animation/player-sword-shield-run-20260831/transitions/transition-data.js'}
    DATA.write_text(json.dumps(metadata, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    print(f'Imported {len(images)} bodies, {len(packed)} grip poses, {len(pages)} atlases; RGBA {metadata["rgbaBytes"]/1048576:.2f} MiB. No thrust assets imported.')


if __name__ == '__main__':
    main()
