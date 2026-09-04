"""Stage only the three approved models through the existing 12/48 generator."""
import argparse
from datetime import datetime
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('asset', choices=['cavalry_academy_industrial', 'artillery_workshop_industrial', 'steam_arsenal_industrial'])
parser.add_argument('--stage', choices=['structure', 'refine'], default='structure')
parser.add_argument('--select', type=int, choices=[1, 2, 3])
parser.add_argument('--reason')
parser.add_argument('--run', action='store_true')
args = parser.parse_args()
relative = lambda p: p.relative_to(REPO).as_posix()
def save(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')

authorization = json.loads((ROOT/'external-payload-authorization.json').read_text(encoding='utf-8'))
if authorization['status'] != 'explicitly_authorized' or args.asset not in authorization['assets']:
    raise SystemExit('This building has no explicit external-payload authorization.')
stage_dir = ROOT/args.asset/('structure_s12_b01' if args.stage == 'structure' else 'refine_s48_b01')
path = stage_dir/'manifest.json'
if path.exists():
    manifest = json.loads(path.read_text(encoding='utf-8'))
else:
    if args.stage != 'refine' or args.select is None or not args.reason:
        raise SystemExit('A new refinement requires a viewed full-raw selection and reason.')
    manifest = json.loads((ROOT/args.asset/'structure_s12_b01/manifest.json').read_text(encoding='utf-8'))
    source = REPO/manifest['outputRoot']/args.asset/f'{args.asset}_structure_v{args.select:02d}_raw.png'
    if not source.is_file():
        raise FileNotFoundError(source)
    stage_dir.mkdir(parents=True, exist_ok=True)
    manifest.update(stage='refine', steps=48, batchId=f'{args.asset}-refine-b01', outputRoot=relative(stage_dir/'candidates'), initImage=relative(source), status='authorized_ready_to_submit')
    manifest.pop('networkBlock', None)
    manifest['submission'] = {'destination': authorization['destination'], 'payload': 'This building original Depth, selected full 12-step raw, prompt and standard parameters.', 'submitted': False, 'generatedCandidates': 0}
    manifest['selection'] = {'selectedCandidate': args.select, 'source': relative(source), 'selectedBy': 'assistant', 'userExplicitlySelectedThisImage': False, 'reason': args.reason}
    manifest['assets'][0]['detailRequest'] = 'Refine only material surfaces and fine finish. Keep the selected composition, all modeled openings and component layout unchanged.'
    spec = importlib.util.spec_from_file_location('building_candidates', REPO/'tools/ai-gen/generate-world122-building-candidates.py')
    generator = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(generator)
    (stage_dir/'prepared-prompt.txt').write_text(generator.prompt_for(manifest['assets'][0], manifest, 'refine'), encoding='utf-8')
manifest['externalPayloadAuthorization'] = authorization
save(path, manifest)
if not args.run:
    print(f'Prepared {args.asset} {args.stage}; no submission.')
    raise SystemExit(0)
manifest['status'] = args.stage+'_generation_in_progress'
manifest['submission']['startedAt'] = datetime.now().astimezone().isoformat()
save(path, manifest)
command = [sys.executable, '-u', str(REPO/'tools/ai-gen/generate-world122-building-candidates.py'), '--manifest', str(path), '--stage', args.stage, '--raw-only', '--only', args.asset]
if args.stage == 'refine':
    command += ['--init-image', str(REPO/manifest['initImage'])]
print(f'Starting {args.asset} {args.stage}; candidate output only.', flush=True)
with (stage_dir/'generation.log').open('ab') as log:
    result = subprocess.run(command, cwd=REPO, stdout=log, stderr=subprocess.STDOUT)
expected = 3 if args.stage == 'structure' else 2
folder = REPO/manifest['outputRoot']/args.asset
count = sum((folder/f'{args.asset}_{args.stage}_v{i:02d}_raw.png').is_file() for i in range(1, expected+1))
manifest['submission'].update(submitted=count > 0, generatedCandidates=count, exitCode=result.returncode, completedAt=datetime.now().astimezone().isoformat())
manifest['status'] = 'raw_candidates_ready_for_image_review' if count == expected and result.returncode == 0 else 'generation_incomplete'
save(path, manifest)
print(f'{count}/{expected} raws; exit={result.returncode}', flush=True)
raise SystemExit(result.returncode)
