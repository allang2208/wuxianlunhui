"""Prepare/run one stage of the accepted industrial recruitment model sequence.

Uses the existing standard 12/48-step generator. No runtime integration.
Selection is explicit and supplied only after viewing the prior raw candidates.
"""
import argparse
from datetime import datetime
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
USER_REQUEST = '继续，做完以后下一个'
ASSETS = {
    'barracks': {
        'folder':'infantry_barracks_tent_v2', 'id':'industrial_barracks_tent_v2',
        'label':'近代帐篷军营', 'assetClass':'modern_field_barracks',
        'model':'industrial_barracks_model.blend',
        'modelPreview':'industrial_barracks_model_approval_preview.png',
        'controlImage':'industrial_barracks_depth.png',
        'foundationStyle':'worn_concrete', 'seed':831800,
        'assetType':'industrial-era field barracks using the accepted tent and timber lookout design',
        'primaryRequest': 'industrial-era field barracks matching the approved compact tent-and-lookout model. Use plain muted khaki canvas on the gently sagging tent roof and small tower canopy, three broad webbing seams, tied-back entrance flaps and rolled window covers. The lower wide lookout has weathered timber posts and deck, dark steel shoes and X-braces, and the authored ladder opening and extended handrails. Keep its grounded wooden walkway, two low sandbag stacks and exactly the modeled equipment groups. Crates are subdued wood with matte fasteners; the field radio has simple mechanical knobs. Preserve the four modeled guy ropes within the footing. Keep exposed footing and equipment readable under gentle diffuse fill; narrow contact occlusion only.',
        'negativeRequest':'No camouflage pattern, metal wall replacing canvas, bright orange timber, extra supplies, sealed railings, blocked ladder, or blocked doorway. Absolutely no cast shadow of any kind, ground shadow, backdrop shadow, green-screen shadow gradient, detached ambient shadow or broad black shadow patch on the footing.',
    },
    'range': {
        'folder':'rifle_range', 'id':'rifle_range_industrial',
        'label':'近代靶场', 'assetClass':'industrial_training_range',
        'model':'rifle_range_material_model.blend',
        'modelPreview':'rifle_range_material_approval_preview.png',
        'controlImage':'rifle_range_depth.png',
        'foundationStyle':'rubble_stone', 'seed':831900,
        'assetType':'industrial-era material evolution of the supplied compact three-target range',
        'primaryRequest':'industrial-era shooting range with the exact authored single attached storehouse and covered shooting bay, one continuous pitched canopy roof, low gray-brick perimeter with the existing square cap blocks, and exactly three separate round cream target faces with dark concentric rings in their modeled positions. Use calm gray-blue painted sheet metal with sparse seams on the roof, dark steel canopy posts, gray-beige brick walls and weathered wood benches, weapon rack and crates. Preserve the existing bow and musket props without adding weapons. Keep the original open court and complete fieldstone footing. Soft diffuse fill keeps the space under the canopy and courtyard readable; narrow contact occlusion only.',
        'negativeRequest':'No tower, extra roof, additional target, silhouette target, divided concrete shooting lanes, modern control-room block, new machinery, extra weapon, extra crate, people or flag. Absolutely no cast shadow of any kind, ground shadow, backdrop shadow, green-screen shadow gradient, detached ambient shadow or broad black shadow patch on the footing.',
    },
}


def relative(path):
    return path.relative_to(REPO).as_posix()


def save(path, value):
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')


parser=argparse.ArgumentParser()
parser.add_argument('asset',choices=ASSETS)
parser.add_argument('--stage',choices=['structure','refine'],default='structure')
parser.add_argument('--select',type=int,choices=[1,2,3])
parser.add_argument('--selection-reason')
parser.add_argument('--run',action='store_true')
parser.add_argument('--batch',type=int,default=1)
parser.add_argument('--corrected-init',type=Path)
args=parser.parse_args()
config=ASSETS[args.asset]
model_dir=HERE/config['folder']
if args.batch < 1:
    raise SystemExit('Batch must be positive.')
stage_dir=model_dir/(f'structure_s12_b{args.batch:02d}' if args.stage=='structure' else f'refine_s48_b{args.batch:02d}')
stage_dir.mkdir(parents=True,exist_ok=True)
manifest_path=stage_dir/'manifest.json'

if manifest_path.exists():
    manifest=json.loads(manifest_path.read_text(encoding='utf-8'))
else:
    asset={k:v for k,v in config.items() if k not in ['folder','seed']}
    if args.asset=='range' and args.batch>=3:
        asset['primaryRequest']='Preserve the exact approved low shooting-range geometry and open entrance. The near-right courtyard wall is TWO SEPARATE wall sections: leave the modeled wide WALK-THROUGH GAP between the second and third round targets, with the courtyard paving visibly continuing through it at ground level. This is an open-ended wall gap, not a door, not an arch and not a low wall. The entire left side of the footing beside the storehouse remains OPEN with no enclosing wall. Keep one low attached storehouse, one continuous two-slope pitched metal canopy and exactly three separate cream round targets with black concentric rings in the existing diagonal arrangement. Preserve only the original gray-brick walls with square caps, dark steel canopy posts, wood benches, weapon rack and crates. Muted gray-blue sheet-metal roof with sparse seams, restrained gray-beige brick, quiet weathered wood, complete shallow fieldstone footing with all four corners. Soft diffuse fill, readable courtyard, narrow contact occlusion only.'
        asset['negativeRequest']='No wall across the courtyard entrance, uninterrupted front wall, sealed court, closed gate, left perimeter wall, tower, extra roof, extra target, silhouette target, divided firing lanes, new machinery, added weapons, added supplies, flags or people. No tall retaining foundation, rubble pile outside the rectangular footing, strong cast shadow, backdrop shadow or broad black courtyard shadow.'
    if args.asset=='barracks' and args.batch==2:
        asset['primaryRequest']='industrial-era tent barracks with strict source-model topology. The rectangular tent has exactly ONE entrance centered on its LONG near-facing side between two rolled-cover windows; the SHORT left gable end is closed unbroken canvas with no door or window. Retain the three broad webbing seams, tied-back center doorway and four guy ropes. The lookout has ONE open observation deck with perimeter rails; there is NO cabin, central cube, inner cage, secondary raised deck or room on it. Its small canopy is a TWO-SLOPE GABLE roof with one long ridge parallel to the tent ridge, never a four-sided pyramidal roof. Keep the authored timber columns, steel X-braces and fixed ladder. The radio is ONE small low rectangular knob-front box at the tower foot beside a cable spool, with no stacked machinery. Preserve only the two existing crate groups, two cans and two low sandbag groups. Plain subdued khaki canvas, dark matte timber-steel framing, worn wood boxes and the original concrete footing; evenly readable surfaces with gentle contact occlusion.'
        asset['negativeRequest']='No door on the short left tent end, second entrance, extra window, hip roof, pyramid roof, enclosed watchtower cabin, central tower cage, extra elevated platform, tall radio stack, oversized radio, extra cans, extra crate groups, ornate gadgets or bright gold fittings. Absolutely no cast shadow of any kind, ground shadow, backdrop shadow, green-screen shadow gradient, detached ambient shadow or broad black shadow patch on the footing.'
    for field in ['model','modelPreview','controlImage']:
        path=model_dir/asset[field]
        if not path.is_file():
            raise FileNotFoundError(path)
        asset[field]=relative(path)
    asset.update(footprintCells=2,footprintMode='authored',removeAllGreen=False,
                 postprocessDepthImage=asset['controlImage'])
    manifest={
        'host':'192.168.3.142','port':8188,'model':'flux2-dev-depth',
        'styleVersion':'world122-building-v5',
        'styleTemplate':'tools/ai-gen/prompts/world122-building-style.md',
        'size':'1024x1024','cfg':3.5,'sampler':'euler','scheduler':'simple',
        'generationTimeout':1800,'useEdgeControl':False,'maskEdgePad':16,
        'stage':args.stage,'steps':12 if args.stage=='structure' else 48,
        'structureSteps':12,'structureVariants':3,'structureDepthStrength':0.78,
        'refineSteps':48,'refineVariants':2,'refineDepthStrength':0.75,'refineDenoise':0.30,
        'structureSeedBase':config['seed']+(args.batch-1)*20,'refineSeedBase':config['seed']+(args.batch-1)*20+10,
        'batchId':f"{config['id']}-{args.stage}-b{args.batch:02d}",
        'outputRoot':relative(stage_dir/'candidates'),
        'status':'prepared_not_submitted','runtimeIntegrationActive':False,
        'continuation':{'recordedAt':datetime.now().astimezone().isoformat(),
            'userStatement':USER_REQUEST,
            'scope':'Proceed building by building through standard 12-step drafts, assistant selection, 48-step refinement and transparent delivery. Preserve models and runtime assets.',
            'selectionAuthority':'Assistant selection under the latest continuation instruction; not fabricated per-image user acceptance.',
            'modelRouting':'Continue the established 12/48 Dev Depth workflow of this specific series.'},
        'submission':{'destination':'http://192.168.3.142:8188',
            'payload':'Only this building Depth PNG, prepared prompt and generation parameters; at refinement, also the selected 12-step raw generated at the same endpoint.',
            'excluded':'Blender files, source code, saves, unrelated images, other destinations and runtime installation.',
            'submitted':False,'generatedCandidates':0},
        'assets':[asset],
    }
    if args.stage=='refine':
        if args.select is None or not args.selection_reason:
            raise SystemExit('Refinement requires a viewed raw selection and its reason.')
        source=model_dir/f'structure_s12_b{args.batch:02d}/candidates'/config['id']/f"{config['id']}_structure_v{args.select:02d}_raw.png"
        original_source=source
        if args.corrected_init:
            source=args.corrected_init if args.corrected_init.is_absolute() else REPO/args.corrected_init
        if not source.is_file():
            raise FileNotFoundError(source)
        manifest['initImage']=relative(source)
        manifest['selection']={'selectedCandidate':args.select,'source':relative(source),
            'selectedBy':'assistant','authority':USER_REQUEST,'reason':args.selection_reason,
            'userExplicitlySelectedThisImage':False}
        if args.corrected_init:
            manifest['selection']['original12StepSource']=relative(original_source)
            manifest['selection']['usesDocumentedLocalCorrection']=True
        asset['detailRequest']='Refine the supplied selected raw image without changing its composition, component positions, object count or full footing. Improve only the specified quiet material clarity and preserve all open spaces. '+asset['primaryRequest']
    spec=importlib.util.spec_from_file_location('building_candidates',REPO/'tools/ai-gen/generate-world122-building-candidates.py')
    generator=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(generator)
    prompt=generator.prompt_for(asset,manifest,args.stage)
    (stage_dir/'prepared-prompt.txt').write_text(prompt,encoding='utf-8')
    save(manifest_path,manifest)
    print(f'Prepared {config["id"]} {args.stage}: {len(prompt.split())} prompt words. No network submission yet.',flush=True)

if args.run:
    authorization_path=HERE/'continuation-network-authorization.json'
    if authorization_path.is_file():
        manifest['networkAuthorization']=json.loads(authorization_path.read_text(encoding='utf-8'))
        if manifest.get('networkBlock') and args.stage=='structure':
            manifest['networkBlock']['resolvedBy']='User explicitly approved both named buildings and the 12/48-step payloads: 同意'
    manifest['status']=args.stage+'_generation_in_progress'
    manifest['submission']['startedAt']=datetime.now().astimezone().isoformat()
    save(manifest_path,manifest)
    command=[sys.executable,'-u',str(REPO/'tools/ai-gen/generate-world122-building-candidates.py'),
             '--manifest',str(manifest_path),'--stage',args.stage,'--raw-only','--only',config['id']]
    if args.stage=='refine':
        command+=['--init-image',str(REPO/manifest['initImage'])]
    print(f'Starting {config["id"]} {args.stage}; no runtime changes.',flush=True)
    with (stage_dir/'generation.log').open('ab') as log:
        result=subprocess.run(command,cwd=REPO,stdout=log,stderr=subprocess.STDOUT)
    expected=3 if args.stage=='structure' else 2
    output=REPO/manifest['outputRoot']/config['id']
    count=sum((output/f"{config['id']}_{args.stage}_v{i:02d}_raw.png").is_file() for i in range(1,expected+1))
    manifest['submission'].update(generatedCandidates=count,exitCode=result.returncode,
        submitted=count>0,completedAt=datetime.now().astimezone().isoformat())
    manifest['status']='raw_candidates_ready_for_image_review' if count==expected and result.returncode==0 else 'generation_incomplete'
    save(manifest_path,manifest)
    print(f'{config["id"]}: {count}/{expected} raw candidates, exit={result.returncode}.',flush=True)
    raise SystemExit(result.returncode)
