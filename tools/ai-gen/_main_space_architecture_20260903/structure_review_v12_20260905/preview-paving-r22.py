"""Current projected paving and layer placement for the R22 offline preview."""
import json
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

BASE = Path(__file__).resolve().parent
REPO = BASE.parents[3]
OUT = BASE / 'delivery_r22'
scope = {'__file__': str(BASE / 'preview-context-r22.py')}
exec(compile((BASE / 'preview-context-r22.py').read_text(encoding='utf-8').split('geometry=Image.open')[0],
    str(BASE / 'preview-context-r22.py'), 'exec'), scope)
W, H = scope['W'], scope['H']
pp, ox, oy = scope['PP'], scope['OX'], scope['OY']
world = scope['world']
hub = scope['config']['scenes']['mainHub']
architecture = hub['architecture']
font = lambda size: ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', size)

# Build a world-space periodic raster, then project it once at the locked camera.
tile = Image.open(REPO / hub['floor']['textureSources'][0]['path']).convert('RGB')
world_left, world_top = 6144 - ox * pp, 4096 - oy * pp
x0 = math.floor(world_left / tile.width) * tile.width
y0 = math.floor(world_top / tile.height) * tile.height
nw = math.ceil((world_left + W * pp - x0) / tile.width)
nh = math.ceil((world_top + H * pp - y0) / tile.height)
pattern = Image.new('RGB', (nw * tile.width, nh * tile.height))
for i in range(nw):
    for j in range(nh): pattern.paste(tile, (i * tile.width, j * tile.height))
floor = pattern.transform((W, H), Image.Transform.AFFINE,
    (pp, 0, world_left - x0, 0, pp, world_top - y0), Image.Resampling.BICUBIC)
context = scope['cover'](Image.open(REPO / hub['backdrop']['assetPath']).convert('RGB'), (W, H)).convert('RGBA')
baseline = round(world(6144, hub['backdrop']['baselineWorldY'])[1])
context.paste(floor.crop((0, baseline, W, H)), (0, baseline))

def layer(entry, underlay=False):
    sprite = Image.open(REPO / entry['assetPath']).convert('RGBA')
    center = world(entry['x'] if underlay else entry['screenCenterX'],
        entry['y'] if underlay else entry['screenCenterY'])
    size = (round(entry['displayW'] / pp), round(entry['displayH'] / pp))
    if sprite.size != size: sprite = sprite.resize(size, Image.Resampling.LANCZOS)
    return sprite, (round(center[0] - size[0] / 2), round(center[1] - size[1] / 2))
