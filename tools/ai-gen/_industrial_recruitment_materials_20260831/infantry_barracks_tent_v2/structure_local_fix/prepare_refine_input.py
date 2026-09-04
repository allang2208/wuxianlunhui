"""Fit the native local edit back into the original 1024-square Depth frame.

Uniform scale + translation only; original generated pixels remain in the parent
raw. Uses the visible full foundation width and bottom tip, never an Alpha mask.
"""
import json
from pathlib import Path
import numpy as np
from PIL import Image

HERE=Path(__file__).resolve().parent
source=HERE/'barracks_structure_corrected_raw.png'
im=Image.open(source).convert('RGB')
scale=(953-65)/(1198-51)
offset_x=65-51*scale
offset_y=921-1129*scale
rgb=np.asarray(im)
key=tuple(int(x) for x in np.median(rgb[:12,:12].reshape(-1,3),axis=0))
out=im.transform((1024,1024),Image.Transform.AFFINE,
                 (1/scale,0,-offset_x/scale,0,1/scale,-offset_y/scale),
                 resample=Image.Resampling.BICUBIC,fillcolor=key)
dest=HERE/'barracks_structure_corrected_init_1024.png'
out.save(dest)
(HERE/'input-preparation.json').write_text(json.dumps({
    'source':source.name,'sourceSize':list(im.size),'output':dest.name,'outputSize':[1024,1024],
    'operation':'Uniform framing fit to original Depth canvas; no local warp, crop of the building, Alpha masking or color correction.',
    'reference12Step':'../structure_s12_b02/candidates/industrial_barracks_tent_v2/industrial_barracks_tent_v2_structure_v03_raw.png',
    'sourceFoundation':{'leftX':51,'rightX':1198,'bottomY':1129},
    'targetFoundation':{'leftX':65,'rightX':953,'bottomY':921},
    'scale':scale,'translation':[offset_x,offset_y],'backgroundFillRgb':key,
    'reason':'The existing Comfy VAEEncode uses native init dimensions; a prepared 1024-square source is required for the standard 1024-square batch.'
},indent=2)+'\n',encoding='utf-8')
print(dest)
