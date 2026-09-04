"""Continue this authored academy through the existing standard 12/48 generator."""
import argparse
from datetime import datetime
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

HERE=Path(__file__).resolve().parent
REPO=HERE.parents[3]
ASSET_ID='cavalry_academy_industrial'
parser=argparse.ArgumentParser()
parser.add_argument('--stage',choices=['structure','refine'],default='structure')
parser.add_argument('--batch',type=int,default=1)
parser.add_argument('--select',type=int,choices=[1,2,3])
parser.add_argument('--selection-reason')
parser.add_argument('--run',action='store_true')
args=parser.parse_args()
if args.batch<1:
    raise SystemExit('Batch must be positive.')
stage_dir=HERE/f'{"structure_s12" if args.stage=="structure" else "refine_s48"}_b{args.batch:02d}'
stage_dir.mkdir(parents=True,exist_ok=True)
manifest_path=stage_dir/'manifest.json'
relative=lambda p:p.relative_to(REPO).as_posix()
def save(p,value):
    p.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

if manifest_path.exists():
    m=json.loads(manifest_path.read_text(encoding='utf-8'))
else:
    a={
        'id':ASSET_ID,'label':'近代骑兵学院','assetClass':'industrial_open_military_training_compound',
        'model':relative(HERE/f'{ASSET_ID}_model.blend'),
        'modelPreview':relative(HERE/f'{ASSET_ID}_model_approval_preview.png'),
        'controlImage':relative(HERE/f'{ASSET_ID}_depth.png'),
        'foundationStyle':'rubble_stone','footprintCells':4,'footprintMode':'authored',
        'assetType':'industrial-era cat-mount cavalry academy with one low hall and a broad fenced training court',
        'primaryRequest':'Preserve this exact industrial-era cat-rider training compound. One low gray-beige brick hall on the rear-left and exactly three attached open-front rectangular resting bays share ONE uninterrupted SINGLE-SLOPE gray-green metal roof plane. Each bay has one khaki pad; do not turn the bays into closed rooms. Keep the small raised paw emblem on the roof, the modeled broad side window, the thin dark timber fence with matte steel joints, and the centered open two-leaf gate on the near-right edge. Keep exactly three simple timber agility jumps in the open court. Along the near-left service edge retain two wooden weapon racks holding a total of six short industrial-era cavalry carbines, two harness racks, two low fixed care stations, the five tied feed sacks and two crates. Preserve all supplied positions and the complete shallow rectangular fieldstone footing with four visible corners. The open court remains the dominant empty area. Use broad calm low-saturation brick, painted roof metal, timber and cloth with sparse seams and restrained wear, and gentle diffuse fill beneath the roof.',
        'negativeRequest':'No gable ridge, opposite roof slope, second roof, tower, upper floor, detached hut, extra bay, fourth obstacle, additional weapon, horse stable, horse, cat, rider, people, vehicle, cannon, flag, sign text or loose scenery. No dense corrugations, roof micro-panels, ornate gold fittings or excessive grime. Absolutely no cast shadow of any kind, ground shadow, backdrop shadow, green-screen shadow gradient or detached ambient shadow. Keep the gate open.',
        'removeAllGreen':False,
    }
    for field in ['model','modelPreview','controlImage']:
        if not (REPO/a[field]).is_file():
            raise FileNotFoundError(a[field])
    a['postprocessDepthImage']=a['controlImage']
    m={
        'host':'192.168.3.142','port':8188,'model':'flux2-dev-depth',
        'styleVersion':'world122-building-v5','styleTemplate':'tools/ai-gen/prompts/world122-building-style.md',
        'size':'1024x1024','cfg':3.5,'sampler':'euler','scheduler':'simple','generationTimeout':1800,
        'useEdgeControl':False,'maskEdgePad':16,'stage':args.stage,'steps':12 if args.stage=='structure' else 48,
        'structureSteps':12,'structureVariants':3,'structureDepthStrength':0.78,
        'refineSteps':48,'refineVariants':2,'refineDepthStrength':0.75,'refineDenoise':0.30,
        'structureSeedBase':831960+(args.batch-1)*20,'refineSeedBase':831970+(args.batch-1)*20,
        'batchId':f'{ASSET_ID}-{args.stage}-b{args.batch:02d}',
        'outputRoot':relative(stage_dir/'candidates'),'status':'prepared_not_submitted',
        'runtimeIntegrationActive':False,'assets':[a],
        'continuation':{'userStatement':'继续','priorInstruction':'继续，做完以后下一个','selectedNext':'近代骑兵学院','selectionAuthority':'Assistant selects candidates while continuing the established series; no invented per-image user acceptance.','scope':'This authored academy only. Preserve models, finished barracks/range and all runtime resources.'},
        'submission':{'destination':'http://192.168.3.142:8188','payload':'This academy original Depth PNG, prepared prompt and standard parameters; at refinement also its selected original 12-step raw.','submitted':False,'generatedCandidates':0,'excluded':'Blender files, project source, saves, unrelated images, other endpoints and runtime installation.'},
    }
    if args.stage=='refine':
        if args.select is None or not args.selection_reason:
            raise SystemExit('Refinement needs a viewed full raw selection and reason.')
        source=HERE/f'structure_s12_b{args.batch:02d}'/'candidates'/ASSET_ID/f'{ASSET_ID}_structure_v{args.select:02d}_raw.png'
        if not source.is_file():
            raise FileNotFoundError(source)
        m['initImage']=relative(source)
        m['selection']={'selectedCandidate':args.select,'source':relative(source),'selectedBy':'assistant','userExplicitlySelectedThisImage':False,'reason':args.selection_reason}
        a['detailRequest']='Refine only the existing material surfaces. Preserve the selected image exact structure, opening, camera, single-slope roof, three bays, paw emblem, all object counts, layout and shallow footing. '+a['primaryRequest']
    spec=importlib.util.spec_from_file_location('building_candidates',REPO/'tools/ai-gen/generate-world122-building-candidates.py')
    generator=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(generator)
    (stage_dir/'prepared-prompt.txt').write_text(generator.prompt_for(a,m,args.stage),encoding='utf-8')
    save(manifest_path,m)
    print(f'Prepared {args.stage}; no network submission yet.',flush=True)

if args.run:
    m['status']=args.stage+'_generation_in_progress'
    m['submission']['startedAt']=datetime.now().astimezone().isoformat()
    save(manifest_path,m)
    command=[sys.executable,'-u',str(REPO/'tools/ai-gen/generate-world122-building-candidates.py'),'--manifest',str(manifest_path),'--stage',args.stage,'--raw-only','--only',ASSET_ID]
    if args.stage=='refine':
        command+=['--init-image',str(REPO/m['initImage'])]
    print(f'Starting academy {args.stage}; no runtime changes.',flush=True)
    with (stage_dir/'generation.log').open('ab') as log:
        result=subprocess.run(command,cwd=REPO,stdout=log,stderr=subprocess.STDOUT)
    expected=3 if args.stage=='structure' else 2
    output=REPO/m['outputRoot']/ASSET_ID
    count=sum((output/f'{ASSET_ID}_{args.stage}_v{i:02d}_raw.png').is_file() for i in range(1,expected+1))
    m['submission'].update(submitted=count>0,generatedCandidates=count,exitCode=result.returncode,completedAt=datetime.now().astimezone().isoformat())
    m['status']='raw_candidates_ready_for_image_review' if count==expected and result.returncode==0 else 'generation_incomplete'
    save(manifest_path,m)
    print(f'{count}/{expected} raws; exit={result.returncode}',flush=True)
    raise SystemExit(result.returncode)
