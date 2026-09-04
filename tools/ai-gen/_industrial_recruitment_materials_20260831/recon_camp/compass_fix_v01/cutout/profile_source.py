"""Measure the edited source before choosing this building's key parameters."""
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


HERE = Path(__file__).resolve().parent
SOURCE = HERE.parent / 'recon_camp_industrial_s48_v01_compass_fix.png'
with Image.open(SOURCE) as source:
    mode, size = source.mode, source.size
    rgba = np.asarray(source.convert('RGBA'))
rgb = rgba[..., :3].astype(np.float32)
corners = np.vstack([rgb[:12, :12].reshape(-1, 3), rgb[:12, -12:].reshape(-1, 3),
                     rgb[-12:, :12].reshape(-1, 3), rgb[-12:, -12:].reshape(-1, 3)])
key = np.median(corners, axis=0)
distance = np.linalg.norm(rgb - key, axis=2)
regions = {
    'main_roof': [(580, 485), (752, 358), (871, 488), (749, 590)],
    'lookout_roof': [(245, 469), (350, 434), (393, 489), (292, 500)],
    'supply_awning': [(847, 580), (938, 538), (1045, 599), (958, 635)],
    'flag_upper': [(376, 235), (389, 235), (389, 240), (376, 240)],
    'flag_lower': [(376, 309), (389, 309), (389, 314), (376, 314)],
    'tower_front_post': [(344, 646), (354, 649), (354, 856), (344, 852)],
    'tower_left_post': [(248, 681), (256, 684), (256, 790), (248, 787)],
    'ladder_side': [(389, 777), (393, 775), (393, 874), (389, 876)],
    'stone_foundation': [(650, 969), (735, 933), (772, 953), (690, 990)],
}
report = {
    'source': str(SOURCE), 'sourceMode': mode, 'size': size,
    'alphaMin': int(rgba[..., 3].min()), 'alphaMax': int(rgba[..., 3].max()),
    'measuredKeyRgb': key.tolist(), 'cornerDistanceMax': float(np.linalg.norm(corners - key, axis=1).max()),
    'materialRegions': {}, 'samples': [],
}
for name, points in regions.items():
    mask_image = Image.new('L', size)
    ImageDraw.Draw(mask_image).polygon(points, fill=255)
    mask = np.asarray(mask_image) > 0
    report['materialRegions'][name] = {'polygon': points, 'pixels': int(mask.sum()),
        'keyDistancePercentiles': np.percentile(distance[mask], [0, 1, 5, 50, 95, 100]).round(2).tolist()}
for x, y in [(10, 700), (60, 800), (80, 855), (80, 910), (150, 780), (188, 743),
             (244, 687), (251, 721), (301, 695), (296, 756), (213, 582), (465, 563),
             (269, 555), (280, 562), (625, 1150)]:
    report['samples'].append({'xy': [x, y], 'rgb': rgb[y, x].astype(int).tolist(),
                              'keyDistance': round(float(distance[y, x]), 2)})
(HERE / 'source-profile.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print(json.dumps(report, ensure_ascii=False, indent=2))
