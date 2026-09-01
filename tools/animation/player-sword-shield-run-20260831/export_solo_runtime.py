"""Produce the requested empty-offhand variant of the approved low-carry run.

Existing body/arm cutouts with an optional solo hand edit. Preserve sword pose and main-hand atlas references;
write one additional body atlas plus offline four-sword/two-facing previews.
"""
import copy
import importlib.util
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
AUTHOR = HERE / 'solo-run'
OUT = ROOT / 'assets/player/sword-solo-run'
spec = importlib.util.spec_from_file_location('run_parts', HERE / 'build.py')
run = importlib.util.module_from_spec(spec)
spec.loader.exec_module(run)


def main():
    cfg = json.loads((AUTHOR / 'rig.json').read_text(encoding='utf-8'))
    rig = json.loads((HERE / 'rig-export.json').read_text(encoding='utf-8'))
    motion = json.loads((ROOT / 'data/player-sword-shield-motion.json').read_text(encoding='utf-8'))
    grip_cfg = json.loads((ROOT / 'data/weapon-anim-config.json').read_text(encoding='utf-8'))['sword']['textureGrips']
    parts = {name: Image.open(HERE / data['file']).convert('RGBA') for name, data in rig['parts'].items()}
    off_part = cfg.get('offForearmPart')
    if off_part:
        parts['offForearm'] = Image.open(AUTHOR / off_part['file']).convert('RGBA')
        # Same elbow pivot and wrist; only the empty hand's palm center changes.
        rig['parts']['offForearm']['end'] = off_part['palm']
    pictures, joints = [], []
    for index in range(cfg['frameCount']):
        pose = copy.deepcopy(rig['poses'][index])
        pose['offUpper'] = cfg['offUpperDegrees'][index]
        pose['offForearm'] = cfg['offForearmDegrees'][index]
        points = run.joint_points(rig, pose)
        canvas = Image.new('RGBA', run.CANVAS)
        for name in cfg['layerOrder']:
            if name == 'body':
                canvas.alpha_composite(Image.open(HERE / rig['bodyFiles'][index]).convert('RGBA'), run.OFFSET)
            elif name in ('offUpper', 'offForearm', 'mainUpper', 'mainForearm'):
                side = 'main' if name.startswith('main') else 'off'
                root = points[side]['shoulder' if name.endswith('Upper') else 'elbow']
                canvas.alpha_composite(run.place(parts[name], rig['parts'][name]['localPivot'], run.shifted(root), pose[name]))
        pictures.append(canvas.crop((128, 12, 640, 524)))
        joints.append(points)

    # Eight original-resolution frames, transparent margins trimmed. Main hand
    # overlays and sword poses are referenced from the existing approved bank.
    boxes = [im.getbbox() for im in pictures]
    cell_w = max(b[2]-b[0] for b in boxes)+2
    cell_h = max(b[3]-b[1] for b in boxes)+2
    atlas = Image.new('RGBA', (cell_w*4, cell_h*2))
    frames = {}
    for index, (picture, box) in enumerate(zip(pictures, boxes)):
        left, top, right, bottom = box
        x, y = index%4*cell_w+1, index//4*cell_h+1
        w, h = right-left, bottom-top
        atlas.paste(picture.crop(box), (x, y))
        frames[f'run-{index}'] = {'frame': {'x': x, 'y': y, 'w': w, 'h': h}, 'rotated': False, 'trimmed': True,
                                'spriteSourceSize': {'x': left, 'y': top, 'w': w, 'h': h},
                                'sourceSize': {'w': 512, 'h': 512}}
    OUT.mkdir(parents=True, exist_ok=True)
    atlas.save(OUT / 'run.png')
    (OUT / 'run.json').write_text(json.dumps({'frames': frames, 'meta': {'image': 'run.png',
        'size': {'w': atlas.width, 'h': atlas.height}, 'scale': '1'}}, separators=(',', ':'))+'\n', encoding='utf-8')
    metadata = {'variant': cfg['variant'], 'sourceSize': 512, 'fps': cfg['fps'],
                'pages': [{'key': 'player_sword_solo_run', 'image': 'assets/player/sword-solo-run/run.png',
                           'atlas': 'assets/player/sword-solo-run/run.json', 'width': atlas.width, 'height': atlas.height}],
                'frames': [[0, f'run-{i}'] for i in range(8)], 'jointFrames': joints,
                'swordAndHandSource': 'data/player-sword-shield-motion.json#run',
                'rigSource': 'tools/animation/player-sword-shield-run-20260831/solo-run/rig.json',
                'bodySources': ['tools/animation/player-sword-shield-run-20260831/'+p for p in rig['bodyFiles']],
                'rgbaBytes': atlas.width*atlas.height*4}
    if off_part:
        metadata['offhandPartSource'] = 'tools/animation/player-sword-shield-run-20260831/solo-run/'+off_part['file']
    (ROOT / 'data/player-sword-solo-run.json').write_text(json.dumps(metadata, ensure_ascii=False, separators=(',', ':'))+'\n', encoding='utf-8')

    # Offline presentation uses the same approved sword pose, actual texture grip
    # and existing main palm overlay. No browser/game is launched.
    hand_pages = {}
    hand_frames = []
    for index in range(8):
        page_index, name = motion['poses'][motion['run'][index]]['hand']
        if page_index not in hand_pages:
            page = motion['pages'][page_index]
            hand_pages[page_index] = (Image.open(ROOT / page['image']).convert('RGBA'),
                                      json.loads((ROOT / page['atlas']).read_text(encoding='utf-8'))['frames'])
        page, mapping = hand_pages[page_index]
        frame = mapping[name]
        rect, target = frame['frame'], frame['spriteSourceSize']
        hand = Image.new('RGBA', (512, 512))
        hand.paste(page.crop((rect['x'], rect['y'], rect['x']+rect['w'], rect['y']+rect['h'])), (target['x'], target['y']))
        hand_frames.append(hand)
    rendered = []
    font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 16)
    for weapon in rig['resolvedWeapons']:
        image = Image.open(ROOT / weapon['path']).convert('RGBA')
        origin = grip_cfg[weapon['key']]
        cycle = []
        for index, picture in enumerate(pictures):
            pose = motion['poses'][motion['run'][index]]['sword']
            sword = image.resize(tuple(round(v) for v in pose['size']), Image.Resampling.LANCZOS)
            canvas = Image.new('RGBA', run.CANVAS)
            canvas.alpha_composite(picture, run.OFFSET)
            canvas.alpha_composite(run.place(sword, [sword.width*origin['x'], sword.height*origin['y']],
                                               run.shifted(pose['point']), pose['angle']))
            canvas.alpha_composite(hand_frames[index], run.OFFSET)
            cycle.append(canvas)
        rendered.append(cycle)
    boards = []
    contact = Image.new('RGB', (1536, 612), '#1d2228')
    for index in range(8):
        board = Image.new('RGB', (1536, 612), '#1d2228')
        draw = ImageDraw.Draw(board)
        for column, weapon in enumerate(rig['resolvedWeapons']):
            for row in range(2):
                im = rendered[column][index]
                if row: im = im.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
                im = im.resize((384, 280), Image.Resampling.LANCZOS)
                board.paste(im, (column*384, row*306+26), im)
                draw.text((column*384+8, row*306+4), weapon['name']+' / 空手摆臂'+(' ←' if row else ' →'), font=font, fill='#d5bd86')
        boards.append(board)
        im = rendered[1][index].resize((384, 280), Image.Resampling.LANCZOS)
        x, y = index%4*384, index//4*306
        contact.paste(im, (x, y+26), im)
        ImageDraw.Draw(contact).text((x+8, y+4), f'源跑帧 {index} / 100ms', font=font, fill='#d5bd86')
    boards[0].save(AUTHOR / 'four-swords-both-directions.gif', save_all=True, append_images=boards[1:], duration=100, loop=0, disposal=2)
    contact.save(AUTHOR / 'cycle-contact.png')
    print(f'Produced 8 solo run body frames; atlas {atlas.width}x{atlas.height}, RGBA {metadata["rgbaBytes"]/1048576:.2f} MiB; approved sword/main-hand data reused.')


if __name__ == '__main__':
    main()
