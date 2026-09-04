"""Use existing building key, bounded shadow removal and RGB-spill tools only."""
from datetime import datetime
import json
from pathlib import Path
import shutil
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage


HERE = Path(__file__).resolve().parent
REPO = HERE.parents[5]
SOURCE = HERE.parent / 'recon_camp_industrial_s48_v01_compass_fix.png'
KEYED = HERE / 'recon_camp_industrial_keyed.png'
SPATIAL = HERE / 'recon_camp_industrial_spatial.png'
FULL = HERE / 'recon_camp_industrial_cutout_full.png'
FINAL = HERE / 'recon_camp_industrial_cutout.png'
INNER, OUTER = 60.0, 110.0
# This region is wholly outside the visible tower/base, following its lower-left
# boundary with a small exterior allowance. It does not come from the old Depth.
EXTERIOR_SHADOW = [
    (0,650), (235,650), (235,768), (229,777), (212,785), (185,799),
    (161,811), (140,821), (122,832), (110,839), (103,845), (96,850),
    (90,857), (86,865), (88,877), (94,886), (119,900), (152,916),
    (201,943), (252,969), (303,995), (357,1023), (407,1049),
    (463,1078), (507,1100), (546,1119), (558,1121), (590,1107),
    (1253,1253), (0,1253),
]


def run(tool, *args):
    subprocess.run([sys.executable, str(REPO/'tools/ai-gen'/tool), *map(str,args)],
                   cwd=REPO, check=True)
    return [tool, *map(str,args)]


def arr(path):
    with Image.open(path) as image:
        return np.asarray(image.convert('RGBA')).copy()


commands = [run('key-world122-building-body.py', SOURCE, KEYED,
                '--soft-key-inner', INNER, '--soft-key-outer', OUTER)]
commands.append(run('finalize-building-runtime.py', KEYED, SPATIAL,
                    '--display-width', 1254, '--padding', 1254,
                    '--clear-alpha-polygon', ';'.join(f'{x},{y}' for x,y in EXTERIOR_SHADOW),
                    '--clear-green-rect', '75,730,310,955',
                    '--clear-green-rect', '75,865,568,1125',
                    '--green-hue-min', 45, '--green-hue-max', 85,
                    '--green-saturation-min', 155, '--green-value-min', 20,
                    '--metadata', HERE/'spatial-metadata.json'))
EDGE = HERE / 'recon_camp_industrial_edge_rgb.png'
RAILING = HERE / 'recon_camp_industrial_railing_rgb.png'
commands.append(run('repair-local-green-spill.py', SPATIAL, EDGE,
                    '--rect', '0,0,1254,1254', '--min-green', 30, '--green-margin', 15,
                    '--min-alpha', 1, '--max-edge-distance', 3))
commands.append(run('repair-local-green-spill.py', EDGE, RAILING,
                    '--rect', '190,530,250,622', '--min-green', 0, '--green-margin', 1,
                    '--min-alpha', 1))
# Keep the tower braces' original shaded steel. A wider RGB-only repair there
# produced mottling; the accepted narrow railing pass is the final full canvas.
shutil.copyfile(RAILING, FULL)
full = arr(FULL)
alpha = full[...,3]
ys, xs = np.where(alpha > 0)
width = min(1254,int(xs.max())+5)-max(0,int(xs.min())-4)
commands.append(run('finalize-building-runtime.py', FULL, FINAL,
                    '--display-width', width, '--padding', 4, '--preserve-alpha-exact',
                    '--nearest-opaque-edge-rgb', '--metadata', HERE/'crop-metadata.json'))

profile = json.loads((HERE/'source-profile.json').read_text(encoding='utf-8'))
raw, keyed, spatial = arr(SOURCE), arr(KEYED), arr(SPATIAL)
material_results = {}
for name, region in profile['materialRegions'].items():
    mask_image = Image.new('L', (1254,1254))
    ImageDraw.Draw(mask_image).polygon(region['polygon'], fill=255)
    mask = np.asarray(mask_image) > 0
    material_results[name] = {
        'samplePixels': int(mask.sum()), 'alphaBelow255': int(np.count_nonzero(mask & (alpha<255))),
        'rgbChanged': int(np.count_nonzero(mask & np.any(raw[...,:3]!=full[...,:3],axis=2))),
        'minimumKeyDistance': region['keyDistancePercentiles'][0],
    }
empty_labels, _ = ndimage.label(alpha==0, structure=np.ones((3,3)))
border_labels = set(np.concatenate([empty_labels[0],empty_labels[-1],empty_labels[:,0],empty_labels[:,-1]]).tolist())
holes=[]
for index, box in enumerate(ndimage.find_objects(empty_labels),1):
    if index in border_labels or box is None:
        continue
    yy,xx=box
    holes.append({'area':int(np.count_nonzero(empty_labels[box]==index)),
                  'bbox':[xx.start,yy.start,xx.stop,yy.stop], 'action':'preserved'})
labels, count = ndimage.label(alpha>16, structure=np.ones((3,3)))
report={
    'recordedAt':datetime.now().astimezone().isoformat(),
    'source':str(SOURCE.relative_to(REPO)), 'sourceSize':[1254,1254],
    'runtimeIntegrationActive':False,
    'key':{'rgb':profile['measuredKeyRgb'],'inner':INNER,'outer':OUTER,
           'removeAllGreen':False,'depthUsedForAlpha':False,'depthRestore':False},
    'exteriorShadowPolygon':EXTERIOR_SHADOW,
    'boundedSaturatedGreenCleanup':{'rects':[[75,730,310,955],[75,865,568,1125]],
        'hueRange':[45,85],'minimumSaturation':155,'minimumValue':20,
        'scope':'Only saturated backdrop/shadow at the lower-left base and adjacent open tower gap; excludes roofs, flags, cabin windows and supplies. Uses the existing building finalizer, never full-canvas HSV.'},
    'shadowAndSubvisibleAlphaPixelsChanged':int(np.count_nonzero(keyed[...,3]!=spatial[...,3])),
    'rgbRepair':{'minGreen':30,'greenMargin':15,'maxEdgeDistance':3,
                 'localPasses':[{'rect':[190,530,250,622],'minGreen':0,'greenMargin':1,'maxEdgeDistance':None}],
                 'alphaChangedPixels':int(np.count_nonzero(spatial[...,3]!=alpha)),
                 'rgbChangedPixels':int(np.count_nonzero(np.any(spatial[...,:3]!=full[...,:3],axis=2)))},
    'alpha':{'opaqueComponentsAbove16':int(count),'componentAreasAbove16':sorted(map(int,np.bincount(labels.ravel())[1:]),reverse=True),
             'enclosedTransparentRegions':holes,'filledHoles':[],
             'transparentPixelsWithDirtyRgb':int(np.count_nonzero((alpha==0)&np.any(full[...,:3]!=0,axis=2)))},
    'protectedMaterialSamples':material_results,
    'outputs':{'fullCanvas':str(FULL.relative_to(REPO)),'tightCutout':str(FINAL.relative_to(REPO))},
    'cropNote':'Native edited pixels retained. Display dimensions in export metadata are not game placement calibration.',
    'commands':commands,
    'validationBoundary':'Offline asset production and preview only; no tests, build, runtime checks or installation.',
}
(HERE/'cutout-record.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'components':report['alpha']['componentAreasAbove16'],'holes':holes,
                  'materials':material_results,'rgbRepair':report['rgbRepair']},indent=2))
