"""Install the two authored sky variants and only the hub atmosphere config."""
import json
import math
import shutil
from pathlib import Path

BASE = Path(__file__).resolve().parent
REPO = BASE.parents[3]
OUT = BASE / 'delivery_r22'
DEST = REPO / 'assets/scenes/main_hub_atmosphere_r22'
OUT.mkdir(exist_ok=True)
DEST.mkdir(parents=True, exist_ok=True)
GENERATED = Path('C:/Users/allan/.codex/generated_images/01a06f8d-d686-78a2-9c87-094009912c97')
sources = {'dusk': 'exec-877e6678-7c3f-420b-b8bc-963e2e20af32.png',
           'night': 'exec-514c1575-e217-4fb8-a0bd-4167862360eb.png'}
variants = {}
for name, filename in sources.items():
    target = DEST / (name + '.png')
    if not target.exists():
        shutil.copy2(GENERATED / filename, target)
    variants[name] = dict(textureKey='main_hub_r22_' + name,
                         assetPath='assets/scenes/main_hub_atmosphere_r22/' + name + '.png')

lights = []
for i, (x, y) in enumerate([(5764, 4416), (6524, 4416), (4674, 4156), (7614, 4156)], 1):
    lights.append(dict(id='lamp_' + str(i).zfill(2), x=x, y=y-165, groundY=y,
                       depth=y+18.01, radius=43, emitterRadius=18, alpha=.72, color=0xffd59a,
                       poolRadius=135, poolAlpha=.19, pulseMs=1700+i*130))
lights.extend([
    dict(id='altar', x=6144, y=3563, groundY=3650, depth=3650.01, radius=63,
         alpha=.20, color=0xe0d1a7, poolRadius=110, poolAlpha=.09, pulseMs=2400),
    dict(id='portal', x=5208, y=3915, groundY=4085, depth=4095.01, radius=87,
         alpha=.29, color=0x78cfdf, poolRadius=145, poolAlpha=.13, pulseMs=2100)])

# Exact R12 nosing/inlay mesh coordinates, projected by the locked model camera.
project = lambda x, y, z: [6144+x, round(4096-.5*y-math.sqrt(3)/2*z, 4)]
edges = []
for i in range(8):
    y, z = 362+i*30, (i+1)*13-.8
    edges.append(dict(from_=project(-277,y,z), to=project(277,y,z),
                      width=1.5, alpha=.25, color=0xd6e4f6))
for a,b in [((-374,609),(-374,1048)),((374,609),(374,1048)),((-374,1048),(374,1048))]:
    edges.append(dict(from_=project(*a,105.76),to=project(*b,105.76),
                      width=1.4,alpha=.19,color=0xf1d7a1))
for edge in edges: edge['from'] = edge.pop('from_')
atmosphere = dict(enabled=True, version=22,
    comment='R22：共用世界昼夜时钟；云雾/远鸟仅在背景裁切内，灯具/台阶微光独立排序，不改变占格和通行。',
    clouds=dict(enabled=True,alpha=.26),
    birds=dict(enabled=True,intervalMs=64000,flightMs=18000),
    lights=lights, edgeHighlights=edges)

decoder = json.JSONDecoder()
def span(text, path, start=0):
    while text[start].isspace(): start += 1
    pos = start+1
    while True:
        while text[pos].isspace() or text[pos]==',': pos += 1
        if text[pos]=='}': raise KeyError(path)
        key,pos = decoder.raw_decode(text,pos)
        while text[pos].isspace(): pos += 1
        pos += 1
        while text[pos].isspace(): pos += 1
        _,end = decoder.raw_decode(text,pos)
        if key == path[0]: return (pos,end) if len(path)==1 else span(text,path[1:],pos)
        pos = end

for relative in ('data/game-config.json', 'public/data/game-config.json'):
    path = REPO/relative
    with path.open(encoding='utf-8-sig',newline='') as f: text=f.read()
    hub = json.loads(text)['scenes']['mainHub']
    backdrop = {**hub['backdrop'], 'version':22, 'variants':variants,
        'comment':'R22 同构昼暮夜远景；世界基线裁切与 R21 主体位置保持一致。'}
    nl = '\r\n' if '\r\n' in text else '\n'
    render = lambda value: json.dumps(value,ensure_ascii=False,indent=2).replace('\n',nl+'      ')
    a,b = span(text,['scenes','mainHub','backdrop'])
    text = text[:a]+render(backdrop)+text[b:]
    if 'atmosphere' in hub:
        a,b = span(text,['scenes','mainHub','atmosphere'])
        text = text[:a]+render(atmosphere)+text[b:]
    else:
        _,b = span(text,['scenes','mainHub','backdrop'])
        text = text[:b]+','+nl+'      "atmosphere": '+render(atmosphere)+text[b:]
    with path.open('w',encoding='utf-8',newline='') as f: f.write(text)

(OUT/'asset-manifest.json').write_text(json.dumps(dict(
    stage='development-integrated', version=22, generationTool='image_gen.imagegen',
    reference='assets/scenes/main_hub_summit_backdrop_v01.png',
    assets=[dict(variant=k,source=str(GENERATED/v),**variants[k]) for k,v in sources.items()],
    generation='Two sequential edits, one dusk and one night, no retries. Local 5080 not used this round.',
    constraints='Preserve mountain silhouettes, ridges, camera, crop and painted style; no objects, moon or sun discs. Dusk peach/lavender; night silver-blue snow and sparse stars.',
    proceduralEffects='Native Canvas wisps, Graphics bird silhouettes, shared radial glow texture; no video/unit sheets.',
    retained=['R21 stone assets and projection','R19 NPC positions','R16 movement and collision','existing world clock and shadow system'],
    lights=lights, edgeHighlights=edges,
    preview='Offline composition of delivery assets; ambient tint and native effects approximated, not a runtime capture.',
    runtimeValidation='not-run', exePublished=False),ensure_ascii=False,indent=2),encoding='utf-8')
