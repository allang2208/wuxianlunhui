"""Submit the prepared recon-camp batch using the project standard generator."""
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


manifest['status'] = 'structure_generation_in_progress'
manifest['submission']['startedAt'] = datetime.now().astimezone().isoformat()
save()
command = [sys.executable, '-u', str(REPO / 'tools/ai-gen/generate-world122-building-candidates.py'),
           '--manifest', str(path), '--stage', 'structure', '--raw-only', '--only', key]
print('Starting 3 standard 12-step recon-camp candidates; Depth and prompt only.', flush=True)
with (HERE / 'generation.log').open('ab') as log:
    result = subprocess.run(command, cwd=REPO, stdout=log, stderr=subprocess.STDOUT)
folder = REPO / manifest['outputRoot'] / key
count = sum((folder / f'{key}_structure_v{i:02d}_raw.png').is_file() for i in range(1, 4))
manifest['submission'].update(generatedCandidates=count, exitCode=result.returncode,
                              completedAt=datetime.now().astimezone().isoformat(), submitted=count > 0)
manifest['status'] = 'candidates_ready_for_image_review' if count == 3 and result.returncode == 0 else 'generation_incomplete'
save()
print(f'Recon-camp candidates: {count}/3; exit={result.returncode}.', flush=True)
raise SystemExit(result.returncode)
