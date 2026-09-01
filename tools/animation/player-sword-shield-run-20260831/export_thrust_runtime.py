"""Pack the user-approved V3 pixels and their final palm coordinates.

Asset production only: no resampling, game execution or combat config writes.
The candidate payload remains the immutable visual source for this import.
"""
import base64
import io
import json
from pathlib import Path
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
SOURCE = HERE / 'transitions/power-v3/transition-data.js'
OUT = ROOT / 'assets/player/sword-shield-thrust-v3'
DATA = ROOT / 'data/player-sword-shield-thrust-v3.json'
SIZE = 512
PAGE = 2048


def main():
    source = json.loads(SOURCE.read_text(encoding='utf-8').split(' = ', 1)[1].strip().removesuffix(';'))
    sequences = [s for s in source['sequences'] if s['branch'] == 'thrust']
    cfg = source['config']
    images, poses, pose_ids = {}, [], {}

    def pose(record):
        ident = record['body']
        if ident not in images:
            images[ident] = Image.open(io.BytesIO(base64.b64decode(source['bodies'][ident].split(',')[1]))).convert('RGBA')
        key = json.dumps([ident, record['sword'], record['shield']], sort_keys=True)
        if key not in pose_ids:
            palm = record['points']['mainPalm']
            mask = Image.new('L', (SIZE, SIZE))
            ImageDraw.Draw(mask).ellipse((palm[0]-14, palm[1]-16, palm[0]+14, palm[1]+16), fill=255)
            hand = Image.new('RGBA', (SIZE, SIZE))
            hand.paste(images[ident], mask=mask)
            pose_ids[key] = len(poses)
            poses.append({'bodyId': ident, 'handImage': hand,
                          'sword': record['sword'], 'shield': record['shield']})
        return pose_ids[key]

    readiness = cfg['readinessBaseMs'] * (1 - (cfg['previewSkillLevel']-1)*cfg['readinessLevelReduction'])
    prepare_ms = cfg['thrustPrepareMs']
    preparation = [{} for _ in range(8)]
    attacks = [None] * 8
    recovery = {}
    for seq in sequences:
        origin = seq['entryRunFrame']
        if seq['exitState'] == 'idle':
            for r in seq['records']:
                t = r['timeMs']
                if readiness-prepare_ms <= t < seq['attackAtMs']:
                    # Preparation sourceFrame belongs to its attack donor, not
                    # the running legs. Recover the actual displayed run phase.
                    phase = (origin-7+int(t/100)) % 8
                    amount = round(min(1, (t-readiness+prepare_ms)/prepare_ms), 7)
                    preparation[phase].setdefault(amount, pose(r))
            attacks[origin] = [[round(r['timeMs']-seq['attackAtMs'], 5), pose(r)]
                               for r in seq['records'] if seq['attackAtMs'] <= r['timeMs'] < seq['recoverAtMs']]
        if origin == 0:
            recovery[seq['exitState']] = [[round(r['timeMs']-seq['recoverAtMs'], 5), pose(r)]
                                         for r in seq['records'] if seq['recoverAtMs'] <= r['timeMs'] <= seq['returnAtMs']]

    # Repeated poses share bodies. Packing only trims empty source margins;
    # sourceSize/origin remain the approved 512-square coordinate system.
    tiles = [(f'b{i}', im) for i, im in images.items()]
    tiles += [(f'h{i}', p.pop('handImage')) for i, p in enumerate(poses)]
    tiles = [(name, im, im.getbbox() or (0, 0, 1, 1)) for name, im in tiles]
    tiles.sort(key=lambda tile: -(tile[2][3]-tile[2][1]))
    OUT.mkdir(parents=True, exist_ok=True)
    pages, locations = [], {}
    page = Image.new('RGBA', (PAGE, PAGE))
    frames, x, y, row_h, used_w = {}, 1, 1, 0, 0

    def flush():
        nonlocal page, frames, x, y, row_h, used_w
        index = len(pages)
        width, height = used_w+1, y+row_h+1
        name = f'thrust-{index}'
        page.crop((0, 0, width, height)).save(OUT / f'{name}.png')
        (OUT / f'{name}.json').write_text(json.dumps({'frames': frames, 'meta': {
            'image': f'{name}.png', 'size': {'w': width, 'h': height}, 'scale': '1'}}, separators=(',', ':'))+'\n', encoding='utf-8')
        pages.append({'key': f'player_sword_shield_thrust_v3_{index}',
                      'image': f'assets/player/sword-shield-thrust-v3/{name}.png',
                      'atlas': f'assets/player/sword-shield-thrust-v3/{name}.json', 'width': width, 'height': height})
        page = Image.new('RGBA', (PAGE, PAGE))
        frames, x, y, row_h, used_w = {}, 1, 1, 0, 0

    for name, image, bbox in tiles:
        left, top, right, bottom = bbox
        w, h = right-left, bottom-top
        if x+w+1 > PAGE:
            x, y, row_h = 1, y+row_h+2, 0
        if y+h+1 > PAGE:
            flush()
        page.paste(image.crop(bbox), (x, y))
        frames[name] = {'frame': {'x': x, 'y': y, 'w': w, 'h': h}, 'rotated': False, 'trimmed': True,
                        'spriteSourceSize': {'x': left, 'y': top, 'w': w, 'h': h},
                        'sourceSize': {'w': SIZE, 'h': SIZE}}
        locations[name] = len(pages)
        used_w = max(used_w, x+w)
        x += w+2
        row_h = max(row_h, h)
    flush()
    for index, value in enumerate(poses):
        body, hand = f'b{value.pop("bodyId")}', f'h{index}'
        value.update(body=[locations[body], body], hand=[locations[hand], hand])
    sample = sequences[0]
    metadata = {'status': 'approved-v3-imported-2026-08-31', 'sourceSize': SIZE,
                'prepareMs': prepare_ms, 'attackReferenceMs': sample['attackMs'],
                'recoverMs': sample['recoverMs'], 'returnBlendMs': cfg['returnBlendMs'],
                'returnRunFrame': sample['returnRunFrame'], 'pages': pages, 'poses': poses,
                'preparation': [sorted(track.items()) for track in preparation],
                'attacks': attacks, 'recovery': recovery, 'bodyPolicy': source['bodyPolicy'],
                'rgbaBytes': sum(p['width']*p['height']*4 for p in pages),
                'source': SOURCE.relative_to(ROOT).as_posix()}
    DATA.write_text(json.dumps(metadata, ensure_ascii=False, separators=(',', ':'))+'\n', encoding='utf-8')
    print(f'Imported approved V3: {len(images)} bodies, {len(poses)} palm poses, {len(pages)} atlases; RGBA {metadata["rgbaBytes"]/1048576:.2f} MiB.')


if __name__ == '__main__':
    main()
