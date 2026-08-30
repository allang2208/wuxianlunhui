"""Pack native Blender settlement renders and produce offline art previews.

This is the asset export step, not a game test or screenshot. --install promotes
only this new atlas/metadata, as requested; no other models/assets are replaced.
"""
from pathlib import Path
import argparse
import json
import math
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent
REPO = OUT.parents[2]
FRAME, COLS, ROWS = 256, 4, 3
# Follow the hex radius without a pixel minimum that would overflow zoomed-out cells.
DISPLAY = dict(town=dict(scale=1.1, min=0, max=92), outpost=dict(scale=1.1, min=0, max=80))


def font(size):
    return ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', size)


def stamp(image, art, position, size, anchor):
    small = art.resize((size, size), Image.Resampling.LANCZOS)
    image.alpha_composite(small, (round(position[0]-anchor[0]*size), round(position[1]-anchor[1]*size)))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--install', action='store_true')
    args = parser.parse_args()
    source = json.loads((OUT/'manifest.json').read_text(encoding='utf-8'))
    layout = json.loads((REPO/'data/world-map-layout.json').read_text(encoding='utf-8'))
    if source['camera']['elevationDegrees'] != layout['cameraElevationDegrees']:
        raise SystemExit('Re-render settlements with the current terrain camera before exporting.')
    atlas = Image.new('RGBA', (FRAME*COLS, FRAME*ROWS))
    frames, art = {}, {}
    for index, profile in enumerate(source['profiles']):
        key = profile['key']
        raw = Image.open(OUT/'renders'/f'{key}.png').convert('RGBA')
        bbox = raw.getchannel('A').point(lambda a: 255 if a > 8 else 0).getbbox()
        if not bbox or min(bbox[:2]) < 2 or bbox[2] > raw.width-2 or bbox[3] > raw.height-2:
            raise SystemExit(f'{key}: model is empty or touches its render frame; fix the Blender camera/geometry.')
        tile = raw.resize((FRAME, FRAME), Image.Resampling.LANCZOS)
        column, row = index % COLS, index // COLS
        atlas.alpha_composite(tile, (column*FRAME, row*FRAME))
        b = tile.getchannel('A').getbbox()
        frames[key] = dict(column=column, row=row, bounds=[round(v/FRAME, 6) for v in b], label=profile['label'])
        art[key] = raw
    meta = dict(version=1, path='assets/ui/world-map/settlements.png', frameSize=FRAME,
                columns=COLS, rows=ROWS, anchor=source['camera']['anchor'],
                cameraElevationDegrees=source['camera']['elevationDegrees'], camera=source['camera'],
                display=DISPLAY, frames=frames)
    # Overview includes the actual normal display size, not only enlarged renders.
    sheet = Image.new('RGBA', (1600, 1350), '#171d23')
    d = ImageDraw.Draw(sheet)
    d.text((30, 20), '大战略地图 · 城市与据点', font=font(30), fill='#f3f6f8')
    d.text((30, 66), '原生建模 / 同源哑光材质 / 55°正交渲染 · 下排小图按地图常用尺寸展示', font=font(17), fill='#a6b2bb')
    for index, profile in enumerate(source['profiles']):
        key = profile['key']
        x, y = 20+(index % COLS)*395, 108+(index//COLS)*408
        d.rounded_rectangle((x, y, x+378, y+393), 8, fill='#232b33', outline='#46545e')
        d.text((x+16, y+10), profile['label'], font=font(22), fill='#eef3f5')
        stamp(sheet, art[key], (x+189, y+197), 295, source['camera']['anchor'])
        d.line((x+14, y+287, x+364, y+287), fill='#46545e')
        size = round(min(DISPLAY[profile['kind']]['max'], 56*DISPLAY[profile['kind']]['scale']))
        stamp(sheet, art[key], (x+78, y+350), size, source['camera']['anchor'])
        d.text((x+145, y+320), f'{size}px 画幅', font=font(17), fill='#d9e0e5')
        d.text((x+145, y+353), '地图模型 / 非战场建筑', font=font(14), fill='#a6b2bb')
    sheet.convert('RGB').save(OUT/'settlements-preview.jpg', quality=94)
    # Compose actual terrain tiles with the same orthographic projection and anchor.
    terrain = Image.open(REPO/'assets/ui/world-map/terrain-atlas.png').convert('RGBA')
    sample = Image.new('RGBA', (1600, 830), '#171d23')
    d = ImageDraw.Draw(sample)
    d.text((30, 20), '城市 / 据点 × 五种地貌', font=font(30), fill='#eef3f5')
    d.text((30, 66), '离线素材组合，不是游戏截图；同格建筑仍由现有城镇与占领系统管理。', font=font(17), fill='#a6b2bb')
    a = layout['atlas']
    for index, biome in enumerate(['desert', 'snow', 'forest', 'ruins', 'mine']):
        cx = 160+index*320
        d.text((cx-48, 116), layout['biomes'][biome]['label'], font=font(20), fill='#d9e0e5')
        for kind, cy in [('town', 333), ('outpost', 644)]:
            scale = 58
            factor = scale/a['pixelsPerWorldUnit']
            cells = []
            for q, r in [(0,0), (1,0), (-1,0), (0,1), (0,-1), (1,-1), (-1,1)]:
                # Reuse the current authored terrain variants without editing them.
                tile = layout['tiles'][f'{biome}_{(index+q-r)%10:02d}']
                px = cx+math.sqrt(3)*(q+r/2)*scale
                py = cy-1.5*r*math.sin(math.radians(layout['cameraElevationDegrees']))*scale
                cells.append((py, px, tile))
            for py, px, tile in sorted(cells, key=lambda c: c[0]):
                raw = terrain.crop((tile['x'], tile['y'], tile['x']+a['frameSize'], tile['y']+a['frameSize']))
                size = round(a['frameSize']*factor)
                raw = raw.resize((size, size), Image.Resampling.LANCZOS)
                sample.alpha_composite(raw, (round(px-a['anchorPx'][0]*factor), round(py-a['anchorPx'][1]*factor)))
            size = round(min(DISPLAY[kind]['max'], scale*DISPLAY[kind]['scale']))
            stamp(sample, art[f'{biome}_{kind}'], (cx, cy), size, meta['anchor'])
            d.text((cx-22, cy+123), '城市' if kind=='town' else '据点', font=font(18), fill='#d9e0e5')
    sample.convert('RGB').save(OUT/'settlements-terrain-preview.jpg', quality=94)
    models = Image.new('RGBA', (1100, 480), '#171d23')
    d = ImageDraw.Draw(models)
    d.text((25, 16), '原生模型 → 材质渲染', font=font(27), fill='#eef3f5')
    for index, key in enumerate(['desert_town', 'forest_outpost']):
        x = 15+index*548
        for column, folder in enumerate(['whitebox', 'renders']):
            raw = Image.open(OUT/folder/f'{key}.png').convert('RGBA')
            stamp(models, raw, (x+134+column*260, 292), 270, meta['anchor'])
            d.text((x+80+column*260, 400), '结构白模' if column==0 else '材质成品', font=font(19), fill='#a6b2bb')
    models.convert('RGB').save(OUT/'settlements-model-preview.jpg', quality=94)
    # No duplicate candidate atlas is retained alongside the installed atlas.
    atlas_path = REPO/meta['path'] if args.install else OUT/'settlements.png'
    atlas_path.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(atlas_path, optimize=True)
    paths = [REPO/'data/world-map-settlements.json', REPO/'public/data/world-map-settlements.json'] if args.install else [OUT/'settlement-visuals.json']
    text = json.dumps(meta, ensure_ascii=False, indent=2)+'\n'
    for path in paths:
        path.write_text(text, encoding='utf-8')
    source.update(stage='integrated-awaiting-user-runtime-review' if args.install else 'exported-preview', runtimeInstalled=args.install)
    source['runtime'] = dict(atlas=meta['path'], metadata='data/world-map-settlements.json',
                             decodedBytes=FRAME*COLS*FRAME*ROWS*4, compressedBytes=atlas_path.stat().st_size,
                             display=DISPLAY, frames=frames)
    (OUT/'manifest.json').write_text(json.dumps(source, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(f'Exported 12 settlement frames, 1024x768 RGBA / 3 MiB decoded. Installed: {args.install}')


if __name__ == '__main__':
    main()
