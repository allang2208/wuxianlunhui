"""Submit the accepted recon-camp V03 through the standard refinement generator."""
from datetime import datetime
import json
from pathlib import Path
import subprocess
import sys


HERE = Path(__file__).resolve().parent
REPO = HERE.parents[4]
path = HERE / 'manifest.json'
manifest = json.loads(path.read_text(encoding='utf-8'))
key = manifest['assets'][0]['id']


def save():
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


manifest['status'] = 'refinement_generation_in_progress'
manifest['submission']['startedAt'] = datetime.now().astimezone().isoformat()
save()
command = [sys.executable, '-u', str(REPO / 'tools/ai-gen/generate-world122-building-candidates.py'),
           '--manifest', str(path), '--stage', 'refine', '--init-image', str(REPO / manifest['initImage']),
           '--raw-only', '--only', key]
print('Starting two standard 48-step candidates from recon-camp V03. No runtime changes.', flush=True)
with (HERE / 'generation.log').open('ab') as log:
    result = subprocess.run(command, cwd=REPO, stdout=log, stderr=subprocess.STDOUT)
folder = REPO / manifest['outputRoot'] / key
count = sum((folder / f'{key}_refine_v{i:02d}_raw.png').is_file() for i in range(1, 3))
manifest['submission'].update(generatedCandidates=count, exitCode=result.returncode,
                              completedAt=datetime.now().astimezone().isoformat(), submitted=count > 0)
manifest['status'] = 'candidates_ready_for_image_review' if count == 2 and result.returncode == 0 else 'generation_incomplete'
save()
print(f'Recon-camp 48-step raw candidates: {count}/2; exit={result.returncode}.', flush=True)
raise SystemExit(result.returncode)
