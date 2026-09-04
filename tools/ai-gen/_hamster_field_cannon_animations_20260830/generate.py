"""Submit only this task's four approved H3 candidates through ai-asset.py."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parent
index_path = ROOT / 'task-index.json'
index = json.loads(index_path.read_text(encoding='utf-8'))
environment = dict(os.environ, PYTHONIOENCODING='utf-8', PYTHONUNBUFFERED='1')
jobs = {}

def save_index():
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')

for kind, action in index['actions'].items():
    output = ROOT / f'videos/{kind}-v01.mp4'
    log = ROOT / f'logs/{kind}-v01.log'
    if output.exists() or log.exists():
        raise SystemExit(f'Refusing duplicate submission: {kind}; inspect the existing job first.')

for kind, action in index['actions'].items():
    output = ROOT / f'videos/{kind}-v01.mp4'
    command = [sys.executable, '-u', str(ROOT.parent/'ai-asset.py'), 'humanoid', 'video',
               '--name', 'hamster_field_cannon_crew', '--kind', kind,
               '--ref', str(ROOT/index['reference']['path']),
               '--prompt', str(ROOT/action['prompt']), '--out', str(output),
               '--provider', 'h3', '--duration', '5.17', '--size', '1024x576',
               '--steps', '20', '--seed', str(action['seed']), '--candidates', '1',
               '--timeout', '7200', '--h3-audio-mode', 'visual-only',
               '--h3-visual-profile', 'character-asset', '--ref-size', 'max']
    log = open(ROOT/f'logs/{kind}-v01.log', 'w', encoding='utf-8')
    process = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT, env=environment)
    action['status'] = 'generation_running'
    action['log'] = f'logs/{kind}-v01.log'
    action['command'] = command
    jobs[kind] = (process, log, output)
    print(f'{kind}: H3 client started, PID {process.pid}', flush=True)
index['status'] = 'generation_running'
save_index()

while jobs:
    for kind, (process, log, output) in list(jobs.items()):
        code = process.poll()
        if code is None:
            continue
        log.close()
        action = index['actions'][kind]
        action['exitCode'] = code
        action['status'] = 'video_ready' if code == 0 and output.exists() else 'generation_failed'
        if action['status'] == 'video_ready':
            provenance = json.loads(Path(str(output)+'.json').read_text(encoding='utf-8'))
            action['sourceVideo'] = output.relative_to(ROOT).as_posix()
            action['provenance'] = action['sourceVideo']+'.json'
            action['promptId'] = provenance['promptId']
        print(f'{kind}: {action["status"]} (exit {code})', flush=True)
        if code:
            print((ROOT/action['log']).read_text(encoding='utf-8')[-3000:], flush=True)
        del jobs[kind]
        save_index()
    if jobs:
        time.sleep(3)
index['status'] = 'videos_ready' if all(a['status']=='video_ready' for a in index['actions'].values()) else 'generation_incomplete'
save_index()
raise SystemExit(0 if index['status']=='videos_ready' else 1)
