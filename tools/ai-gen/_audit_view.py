# 游戏视角合成 v2：每栋建筑 × 每个时刻一张图——
# 显示像素画布 = 半透明黑最终阴影多边形垫底 + 建筑贴图按锚点盖上。
import json
from PIL import Image, ImageDraw

data = json.load(open('tools/verify-shots/_realpoly.json', encoding='utf-8'))
FOOT = {
    'thatch_hut': 113, 'blacksmith': 98, 'church': 150, 'research_institute': 136,
    'warehouse': 145, 'shooting_range': 109, 'cavalry_school': 101,
    'barracks': 116, 'mine': 109, 'defense_base': 184,
}
LABELS = {'0.125': '0900', '0.25': '1200', '0.354': '1430', '0.438': '1630', '0.479': '1730'}

meta = data['meta']
sprites = {}
for key in meta:
    texW, texH = meta[key]['texW'], meta[key]['texH']
    dw, dh = texW * meta[key]['scaleX'], texH * meta[key]['scaleY']
    sprites[key] = (Image.open(f'assets/terrain/{key}.png').convert('RGBA')
                    .resize((round(dw), round(dh)), Image.LANCZOS), dw, dh)

for phase, pv in data['phases'].items():
    label = LABELS.get(phase, phase.replace('.', '_'))
    for key, it in pv['items'].items():
        sprite, dw, dh = sprites[key]
        footY = FOOT[key]
        W, H = int(dw * 2.6), int(dh * 2.4)
        cx, cy = W / 2, H / 2
        canvas = Image.new('RGBA', (W, H), (40, 36, 32, 255))
        d = ImageDraw.Draw(canvas)
        m = lambda pts: [(cx + p['x'], cy + p['y']) for p in pts]
        uni = m(it['union'])
        if uni:
            d.polygon(uni, fill=(0, 0, 0, 140), outline=(255, 60, 60, 255))
        canvas.alpha_composite(sprite, (round(cx - dw / 2), round(cy - footY - dh / 2)))
        d = ImageDraw.Draw(canvas)
        d.ellipse([cx - 3, cy - 3, cx + 3, cy + 3], outline=(0, 255, 0, 255), width=2)
        canvas.convert('RGB').save(f'tools/verify-shots/_rv_{key}_{label}.png')
print('done')
