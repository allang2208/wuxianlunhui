"""Package timed howitzer sprites and derive the complete runtime asset family."""
import json
import shutil
from pathlib import Path
import numpy as np
from PIL import Image
from make_sprites import ROOT, TOOLS, KINDS, PLAN, SCALE, ANCHOR, checker, contact, gif_durations, write_json

REPO = TOOLS.parents[1]
UNIT = 'hamster_howitzer_crew'
FILES = {'idle':('idle','idle.png'),'run':('walk','running.png'),
         'attack':('attack','attacking.png'),'die':('dying','dying.png')}

def package():
    selection = json.loads((ROOT/'runtime-source-selection.json').read_text(encoding='utf-8'))
    manifest = {'unitKey':UNIT,'status':'sprites_ready_for_import','profile':'crowd',
        'sourceSelection':'runtime-source-selection.json','sourceScale':SCALE,'anchorInVideo':ANCHOR,
        'referenceCell':512,'runtimeIntegrationActive':False,'testsRun':False,
        'formalBudgetCheckRun':False,'actions':{},'targetMiB':32,'admissionLimitMiB':64}
    for kind in KINDS:
        meta = json.loads((ROOT/f'source-sheets/{kind}-keys.json').read_text(encoding='utf-8'))
        report = json.loads((ROOT/f'final/{kind}-rife.json').read_text(encoding='utf-8'))
        sheet = Image.open(ROOT/f'final/{kind}.png').convert('RGBA')
        count,cols = report['outputFrameCount'],report['cols']
        width,height = meta['frameWidth'],meta['frameHeight']
        cells = [sheet.crop((i%cols*width,i//cols*height,i%cols*width+width,i//cols*height+height)) for i in range(count)]
        durations = []
        for i,d in enumerate(meta['sourceDurationsMs']):
            durations += [d/2,d/2] if meta['loop'] or i<len(meta['sourceDurationsMs'])-1 else [d]
        previews = [checker(c).resize((width*2,height*2),Image.Resampling.NEAREST) for c in cells]
        colors = Image.new('RGB',(128,72*len(previews)))
        for i,frame in enumerate(previews): colors.paste(frame.resize((128,72)),(0,72*i))
        palette = colors.quantize(colors=255)
        frames = [p.quantize(palette=palette) for p in previews]
        revision = selection['actions'][kind]['revision']
        preview = f'previews/{kind}-transparent-loop-{revision}.gif'
        frames[0].save(ROOT/preview,save_all=True,append_images=frames[1:],
            duration=gif_durations(durations),loop=0,disposal=2,optimize=False)
        contact(cells,kind,ROOT/f'previews/{kind}-transparent-contact.png')
        manifest['actions'][kind] = {**meta,'sheet':f'final/{kind}.png','frameCount':count,
            'endFrame':count-1,'cols':cols,'rows':report['rows'],'sheetSize':list(sheet.size),
            'decodedMiB':sheet.width*sheet.height*4/1024**2,'frameDurationsMs':durations,
            'preview':preview,'rifeReport':f'final/{kind}-rife.json',
            'runtimeKey':FILES[kind][0],'runtimePath':f'assets/companions/{UNIT}/{FILES[kind][1]}',
            'sourceKeyMapping':'outputIndex=sourceKeyIndex*2'}
    # The airborne shell is cropped from the accepted source's inert dropped cartridge.
    # Its source crop is recorded by prepare_projectile.py; no new generated artwork.
    projectile = json.loads((ROOT/'projectile-source.json').read_text(encoding='utf-8'))
    image = Image.open(ROOT/projectile['sheet'])
    projectile.update(runtimeKey='projectile',runtimePath=f'assets/companions/{UNIT}/shell.png',
        decodedMiB=image.width*image.height*4/1024**2,frameWidth=image.width,frameHeight=image.height,
        cols=1,rows=1,frameCount=1,endFrame=0)
    manifest['projectile'] = projectile
    manifest['decodedMiB'] = sum(a['decodedMiB'] for a in manifest['actions'].values())+projectile['decodedMiB']
    manifest['budgetScope'] = 'All four action textures and one dedicated shell; no summoned/dependent runtime textures.'
    manifest['resupplyCompleted'] = bool(manifest['actions']['attack'].get('sourceSegments'))
    manifest['knownSourceLimits'] = ([] if manifest['resupplyCompleted'] else
        ['Empty-handed reload ending cuts back to shell-holding idle; resupply composite has not been rebuilt.'])
    manifest['muzzleEdgeRefinement'] = manifest['actions']['attack'].get('muzzleEdgeRefinement')
    if manifest['decodedMiB']>64: raise RuntimeError(f'Family exceeds admission limit: {manifest["decodedMiB"]}')
    write_json(ROOT/'spritesheet-manifest.json',manifest)
    budget = {'version':1,'id':UNIT,'profile':'crowd','runtimeIntegrationActive':False,
        'dependencies':[],'sheets':[]}
    for a in [*manifest['actions'].values(),projectile]:
        budget['sheets'].append({'textureKey':f'companion_{UNIT}_{a["runtimeKey"]}','path':a['runtimePath'],
            **{k:a[k] for k in ('frameWidth','frameHeight','frameCount','endFrame')}})
    write_json(ROOT/'sprite-budget-manifest.json',budget)
    PLAN.update(productionStatus='sprites_ready_for_import',actualDecodedMiB=manifest['decodedMiB'])
    write_json(ROOT/'sprite-production-plan.json',PLAN)
    print(f'Full howitzer family: {manifest["decodedMiB"]:.3f} MiB',flush=True)

if __name__ == '__main__': package()
