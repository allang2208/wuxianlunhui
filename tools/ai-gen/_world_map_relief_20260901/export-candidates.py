"""Package native renders and compose offline candidate previews; never install.

All geometric art comes from Blender. Pillow only resizes, trims, packs, labels
and places the authored sprites. No rotation, mirror or painted terrain substitute.
"""
from pathlib import Path
import json
import math
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent
REPO = OUT.parents[2]
FRAME = 320
GUTTER = 4
MANIFEST = json.loads((OUT / 'manifest.json').read_text(encoding='utf-8'))
LAYOUT = json.loads((REPO / 'data/world-map-layout.json').read_text(encoding='utf-8'))
SIN = math.sin(math.radians(MANIFEST['camera']['elevationDegrees']))
PPU = FRAME / MANIFEST['camera']['orthoScale']
ANCHOR = [v * FRAME / MANIFEST['camera']['resolution'][0] for v in MANIFEST['camera']['anchorPx']]
FONT = 'C:/Windows/Fonts/msyh.ttc'
BACKGROUND = '#101419'
PREVIEWS = OUT / 'previews'
SPRITES = OUT / 'sprites'
IMAGES = {}
TERRAIN = Image.open(REPO / LAYOUT['atlas']['path']).convert('RGBA')


def text(draw, xy, value, size=20, fill='#c4d3da'):
    draw.text(xy, value, font=ImageFont.truetype(FONT, size), fill=fill)


def draw_sprite(canvas, key, xy, scale):
    factor = scale / PPU
    image = IMAGES[key].resize((round(FRAME * factor), round(FRAME * factor)), Image.Resampling.LANCZOS)
    canvas.alpha_composite(image, (round(xy[0] - ANCHOR[0] * factor), round(xy[1] - ANCHOR[1] * factor)))


def terrain(canvas, biome, variant, xy, scale):
    atlas = LAYOUT['atlas']
    tile = LAYOUT['tiles'][f'{biome}_{variant:02d}']
    source = TERRAIN.crop((tile['x'], tile['y'], tile['x'] + atlas['frameSize'], tile['y'] + atlas['frameSize']))
    factor = scale / atlas['pixelsPerWorldUnit']
    size = round(atlas['frameSize'] * factor)
    source = source.resize((size, size), Image.Resampling.LANCZOS)
    canvas.alpha_composite(source, (round(xy[0] - atlas['anchorPx'][0] * factor), round(xy[1] - atlas['anchorPx'][1] * factor)))


def package():
    PREVIEWS.mkdir(exist_ok=True)
    SPRITES.mkdir(exist_ok=True)
    frames, packed = {}, []
    for asset in MANIFEST['assets']:
        key = asset['key']
        source = Image.open(OUT / asset['render']).convert('RGBA')
        image = source.resize((FRAME, FRAME), Image.Resampling.LANCZOS)
        IMAGES[key] = image
        box = image.getchannel('A').getbbox()
        if box is None:
            raise ValueError(f'Empty authoring output: {key}')
        box = (max(0, box[0] - GUTTER), max(0, box[1] - GUTTER), min(FRAME, box[2] + GUTTER), min(FRAME, box[3] + GUTTER))
        trimmed = image.crop(box)
        trimmed.save(SPRITES / f'{key}.png', optimize=True)
        frames[key] = dict(sourceSize=[FRAME, FRAME], trim=list(box), anchorPx=[ANCHOR[0] - box[0], ANCHOR[1] - box[1]],
                           category=asset['category'], ports=asset.get('ports', []), sprite=f'sprites/{key}.png')
        packed.append((key, trimmed))
    # Shelf-pack trimmed frames instead of allocating mostly empty 320px cells.
    width, x, y, row_height = 1024, 0, 0, 0
    placements = []
    for key, image in sorted(packed, key=lambda item: (-item[1].height, item[0])):
        if x + image.width > width:
            x, y, row_height = 0, y + row_height + 2, 0
        frames[key]['rect'] = dict(x=x, y=y, width=image.width, height=image.height)
        placements.append((image, x, y))
        x += image.width + 2
        row_height = max(row_height, image.height)
    height = math.ceil((y + row_height) / 4) * 4
    atlas = Image.new('RGBA', (width, height))
    for image, x, y in placements:
        atlas.alpha_composite(image, (x, y))
    atlas.save(OUT / 'terrain-features-candidate.png', optimize=True)
    metadata = dict(version=1, runtimeInstalled=False, path='terrain-features-candidate.png', width=width, height=height,
                    pixelsPerWorldUnit=PPU, camera=MANIFEST['camera'], frames=frames,
                    rgbaBaseMiB=width * height * 4 / 1024 ** 2, frameCount=len(frames))
    (OUT / 'terrain-features-candidate.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    MANIFEST['candidateAtlas'] = {key: metadata[key] for key in ['path', 'width', 'height', 'pixelsPerWorldUnit', 'rgbaBaseMiB', 'frameCount']}
    MANIFEST['previewNote'] = 'Offline authored sprite compositions, not game screenshots or runtime acceptance.'
    (OUT / 'manifest.json').write_text(json.dumps(MANIFEST, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return metadata


def runtime_mountains(candidate):
    """Build the selected runtime atlas from the 15 authored mountain frames only."""
    selected = [(key, frame) for key, frame in candidate['frames'].items() if frame['category'] == 'mountain']
    width, x, y, row_height = 1024, 0, 0, 0
    placements, frames = [], {}
    for key, frame in sorted(selected, key=lambda item: (-Image.open(OUT / item[1]['sprite']).height, item[0])):
        image = Image.open(OUT / frame['sprite']).convert('RGBA')
        if x + image.width > width:
            x, y, row_height = 0, y + row_height + 2, 0
        frames[key] = dict(rect=dict(x=x, y=y, width=image.width, height=image.height),
                           anchorPx=frame['anchorPx'], sourceSize=frame['sourceSize'])
        placements.append((image, x, y))
        x += image.width + 2
        row_height = max(row_height, image.height)
    height = math.ceil((y + row_height) / 4) * 4
    atlas = Image.new('RGBA', (width, height))
    for image, x, y in placements:
        atlas.alpha_composite(image, (x, y))
    atlas.save(OUT / 'mountain-relief.png', optimize=True)
    metadata = dict(version=1, runtimeInstalled=True, path='assets/ui/world-map/mountain-relief.png',
                    width=width, height=height, pixelsPerWorldUnit=PPU, camera=MANIFEST['camera'],
                    source='tools/ai-gen/_world_map_relief_20260901/world-map-relief.blend',
                    mountainProfile=MANIFEST.get('mountainProfile'),
                    selection=dict(mountain='stable ridge/massif by cell coordinate', mountainPass='pass'),
                    frames=frames, rgbaBaseMiB=width * height * 4 / 1024 ** 2, frameCount=len(frames))
    (OUT / 'mountain-relief.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    MANIFEST['runtimeMountainAtlas'] = {key: metadata[key] for key in
                                        ['path', 'width', 'height', 'pixelsPerWorldUnit', 'rgbaBaseMiB', 'frameCount']}
    (OUT / 'manifest.json').write_text(json.dumps(MANIFEST, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return metadata


def mountains_preview():
    canvas = Image.new('RGBA', (1640, 1630), BACKGROUND)
    draw = ImageDraw.Draw(canvas)
    text(draw, (36, 26), '世界地图 · 山脉与山口候选', 34, '#f3f6f8')
    text(draw, (38, 78), '共享现有地貌材质 / 55°正交 / 原生模型 / 山脉已进入正式图集', 21)
    columns = [('reference', '现有地貌参照'), ('ridge', '连峰山脊'), ('massif', '雄峰山体'), ('pass', '开阔山口')]
    for col, (_, label) in enumerate(columns):
        text(draw, (col * 395 + 120, 124), label, 24)
    for row, biome in enumerate(LAYOUT['biomes']):
        y = 208 + row * 276
        text(draw, (35, y - 25), LAYOUT['biomes'][biome]['label'], 21, '#f3f6f8')
        for col, (kind, _) in enumerate(columns):
            point = (col * 395 + 225, y + 137)
            terrain(canvas, biome, 4 if kind == 'reference' else 0, point, 126)
            if kind != 'reference':
                draw_sprite(canvas, f'{biome}_{kind}', point, 126)
    text(ImageDraw.Draw(canvas), (38, 1576), '离线素材组合，非游戏截图。山口留出真实地面通道；不修改通行规则、地图种子或已有地格。', 19)
    canvas.convert('RGB').save(PREVIEWS / 'mountains-biome-preview.jpg', quality=94)


def river_assembly():
    canvas = Image.new('RGBA', (1920, 1410), BACKGROUND)
    draw = ImageDraw.Draw(canvas)
    text(draw, (40, 28), '世界地图 · 河流拼接与山地组合候选', 35, '#f3f6f8')
    text(draw, (42, 84), '河流沿六边格共有边连接；转弯、汇流与端头均为固定光向的独立模型，无需桥梁', 22)
    scale, origin = 84, (850, 735)
    point = lambda x, y: (origin[0] + x * scale, origin[1] - y * SIN * scale)
    cells = {}
    for q in range(-3, 4):
        for r in range(max(-3, -q - 3), min(3, -q + 3) + 1):
            x, y = math.sqrt(3) * (q + r / 2), 1.5 * r
            biome = 'snow' if r >= 2 else 'forest' if q <= 0 else 'desert' if r <= 0 else 'mine'
            cells[q, r] = dict(x=x, y=y, q=q, r=r, biome=biome)
    for cell in sorted(cells.values(), key=lambda cell: (-cell['y'], cell['x'])):
        terrain(canvas, cell['biome'], 0, point(cell['x'], cell['y']), scale)
    directions = [(1, 0), (1, -1), (0, -1), (-1, 0), (-1, 1), (0, 1)]
    side = lambda cell: cell['y'] - .2 * cell['x'] + .6 > 0
    edges, vertices = [], {}
    for (q, r), cell in cells.items():
        for dq, dr in directions:
            other = cells.get((q + dq, r + dr))
            if not other or (q, r) >= (q + dq, r + dr) or side(cell) == side(other):
                continue
            mx, my = (cell['x'] + other['x']) / 2, (cell['y'] + other['y']) / 2
            dx, dy = other['x'] - cell['x'], other['y'] - cell['y']
            angle = min([30, 90, 150], key=lambda angle: abs((math.degrees(math.atan2(dx, -dy)) % 180) - angle))
            edges.append((mx, my, angle))
            ax, ay = math.cos(math.radians(angle)) * .5, math.sin(math.radians(angle)) * .5
            for sign in [-1, 1]:
                vx, vy = mx + ax * sign, my + ay * sign
                key = (round(vx, 5), round(vy, 5))
                vertex = vertices.setdefault(key, dict(x=vx, y=vy, angles=[]))
                outgoing = round(math.degrees(math.atan2(my - vy, mx - vx))) % 360
                vertex['angles'].append(outgoing)
    for x, y, angle in edges:
        draw_sprite(canvas, f'river_edge_{angle:03d}', point(x, y), scale)
    for vertex in vertices.values():
        angles = vertex['angles']
        if len(angles) == 1:
            key = f'river_end_{angles[0]:03d}'
        else:
            parity, possible = ('a', [30, 150, 270]) if angles[0] in [30, 150, 270] else ('b', [90, 210, 330])
            mask = sum(1 << possible.index(angle) for angle in angles)
            key = f'river_joint_{parity}_{mask:02d}'
        draw_sprite(canvas, key, point(vertex['x'], vertex['y']), scale)
    for q, r, kind in [(-2, 2, 'ridge'), (-1, 2, 'massif'), (0, 2, 'ridge'), (1, 2, 'pass'),
                        (-2, 0, 'ridge'), (-2, -1, 'pass'), (2, -2, 'ridge'), (3, -2, 'massif')]:
        cell = cells[q, r]
        draw_sprite(canvas, f"{cell['biome']}_{kind}", point(cell['x'], cell['y']), scale)
    draw = ImageDraw.Draw(canvas)
    text(draw, (64, 1120), '拼接示意：端头 → 边段 → 转弯 / 汇流；单位直接渡河，跨河路段增加耗时', 24, '#f3f6f8')
    for i, (key, label) in enumerate([('river_end_030', '封口端头'), ('river_edge_090', '共有边河段'),
                                    ('river_joint_a_03', '120°双臂转接'), ('river_joint_a_07', '三向汇流')]):
        center = (200 + i * 370, 1250)
        draw_sprite(canvas, key, center, 186)
        text(ImageDraw.Draw(canvas), (center[0] - 76, 1333), label, 20)
    text(ImageDraw.Draw(canvas), (1300, 164), '方向与接口', 25, '#f3f6f8')
    notes = ['河段：30° / 90° / 150°', '节点：A、B两类格点', '水宽：0.132 世界单位', '岸宽：0.280 世界单位', '单边长：1.000 世界单位', '几何拼接，不旋转成品图', '现有地图贴图作地面参照', '河流连接件仍为候选']
    for i, note in enumerate(notes):
        text(ImageDraw.Draw(canvas), (1300, 213 + i * 38), note, 20)
    text(ImageDraw.Draw(canvas), (44, 1371), '离线美术组合（非游戏截图） · 原生建模 → 同源相机/材质 → 透明渲染 → 紧裁图集', 19)
    canvas.convert('RGB').save(PREVIEWS / 'river-assembly-preview.jpg', quality=95)


def contact_sheet():
    items = [asset for asset in MANIFEST['assets'] if asset['category'] != 'mountain']
    canvas = Image.new('RGBA', (1600, 1260), BACKGROUND)
    draw = ImageDraw.Draw(canvas)
    text(draw, (32, 24), '河流连接件 · 全方向目录', 33, '#f3f6f8')
    text(draw, (34, 76), '17个河道连接件 / 不设桥梁 / 各方向独立建模渲染 / 公共截面与锚点', 21)
    for i, asset in enumerate(items):
        col, row = i % 5, i // 5
        xy = (col * 320 + 160, row * 270 + 270)
        draw_sprite(canvas, asset['key'], xy, 236)
        text(ImageDraw.Draw(canvas), (col * 320 + 27, row * 270 + 360), asset['key'], 18)
    canvas.convert('RGB').save(PREVIEWS / 'river-parts-preview.jpg', quality=94)


if __name__ == '__main__':
    metadata = package()
    runtime = runtime_mountains(metadata)
    mountains_preview()
    river_assembly()
    contact_sheet()
    print(json.dumps({'candidate': MANIFEST['candidateAtlas'], 'runtimeMountains': {
        key: runtime[key] for key in ['path', 'width', 'height', 'rgbaBaseMiB', 'frameCount']}}, ensure_ascii=False))
