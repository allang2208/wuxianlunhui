"""Resume downloads by recorded job ID; GET only, never resubmit H3 work."""
import datetime
import importlib.util
import json
from pathlib import Path
import urllib.parse
import urllib.request
import argparse

parser = argparse.ArgumentParser()
parser.add_argument('--revision', choices=['v01','v02','v03','v04'], default='v01')
parser.add_argument('--action', choices=['attack','die'], default='attack')
options = parser.parse_args()
revision, target_action = options.revision, options.action

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('h3', ROOT.parent/'minimax-h3-gen.py')
h3 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h3)
index_path = ROOT/('task-index.json' if revision == 'v01' else f'{target_action}-{revision}-index.json')
index = json.loads(index_path.read_text(encoding='utf-8'))
ids_file = 'generation-job-ids.json' if revision == 'v01' else f'{target_action}-{revision}-job-ids.json'
ids = json.loads((ROOT/ids_file).read_text(encoding='utf-8'))
endpoint = index['generation']['endpoint']

def get_json(path):
    with urllib.request.urlopen(endpoint+path, timeout=30) as response:
        return json.load(response)

queue = get_json('/queue')
states = {item[1]: state for state in ('queue_running','queue_pending') for item in queue.get(state,[])}
for kind, action in index['actions'].items():
    pid = ids[kind]
    action['promptId'] = pid
    output = ROOT/f'videos/{kind}-{revision}.mp4'
    provenance_path = Path(str(output)+'.json')
    if output.is_file() and provenance_path.is_file():
        provenance = json.loads(provenance_path.read_text(encoding='utf-8'))
        if provenance['promptId'] != pid:
            raise RuntimeError(f'Refusing mismatched existing output: {kind}')
    else:
        entry = get_json('/history/'+pid).get(pid)
        if not entry or not entry.get('status',{}).get('completed'):
            action['status'] = states.get(pid,'awaiting_remote_result')
            if entry and entry.get('status',{}).get('status_str') == 'error':
                action['status'] = 'generation_failed'
                (ROOT/f'logs/{kind}-{revision}-remote-error.json').write_text(json.dumps(entry,ensure_ascii=False,indent=2),encoding='utf-8')
            print(f'{kind}: {action["status"]}',flush=True)
            continue
        workflow = entry['prompt'][2]
        if workflow['7']['inputs']['noise_seed'] != action['seed']:
            raise RuntimeError(f'Recorded job does not match {kind}')
        videos = entry['outputs'].get('14',{}).get('videos') or entry['outputs'].get('14',{}).get('images')
        if not videos:
            raise RuntimeError(f'Completed job has no video: {kind}')
        item = videos[0]
        query = urllib.parse.urlencode({key:item.get(key,default) for key,default in
                                      [('filename',''),('subfolder',''),('type','output')]})
        with urllib.request.urlopen(endpoint+'/view?'+query,timeout=60) as response:
            output.write_bytes(response.read())
        history_file = f'logs/{kind}-remote-history.json' if revision == 'v01' else f'logs/{kind}-{revision}-remote-history.json'
        (ROOT/history_file).write_text(json.dumps(entry,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        authored = (ROOT/action['prompt']).read_text(encoding='utf-8').strip()
        w = workflow['5']['inputs']
        provenance = {
            'provenanceVersion':1,'provider':'minimax-h3-local','promptId':pid,
            'createdAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'recoveredDownload':True,'recoveryReason':'Original local client interrupted; remote job continued without resubmission.',
            'output':h3.source_record(output),'candidate':1,'candidateCount':1,
            'seed':action['seed'],'actionMode':action['actionMode'],'mode':'i2v_firstframe',
            'audioMode':'visual-only','visualProfile':'character-asset','promptFormat':'h3',
            'authoredPrompt':authored,'effectivePrompt':authored,'finalPrompt':w['prompt'],
            'parameters':{'width':w['width'],'height':w['height'],'frames':w['length'],
                          'fps':workflow['13']['inputs']['fps'],'duration':index['generation'].get('duration',5.17),
                          'steps':workflow['9']['inputs']['steps'],
                          'sampler':workflow['8']['inputs']['sampler_name'],
                          'scheduler':workflow['9']['inputs']['scheduler'],'refImageSize':'max'},
            'models':{'unet':workflow['1']['inputs']['unet_name'],'clip':workflow['2']['inputs']['clip_name'],
                      'videoVae':workflow['3']['inputs']['vae_name'],'audioVae':workflow['4']['inputs']['vae_name']},
            'inputs':{'promptFile':h3.source_record(ROOT/action['prompt']),
                      'firstFrame':h3.source_record(ROOT/index['reference']['path']),
                      'lastFrame':h3.source_record(ROOT/index.get('lastFrameReference',index['reference']['path'])) if '16' in workflow else None,
                      'referenceImages':[],'referenceVideos':[]},
            'remoteHistory':history_file,
        }
        provenance_path.write_text(json.dumps(provenance,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    action.update(sourceVideo=output.relative_to(ROOT).as_posix(),provenance=provenance_path.relative_to(ROOT).as_posix())
    if action['status'] not in ('candidate_preview_ready','user_accepted_source_video','rejected_candidate_preview'):
        action['status'] = 'video_ready'
    print(f'{kind}: downloaded {output.name}',flush=True)
complete = all(a.get('sourceVideo') for a in index['actions'].values())
index['generation'].update(uploaded=True,submitted=True,generated=complete)
if index.get('productionReviewStatus') != 'rejected' and index['status'] not in ('candidate_previews_ready_awaiting_user_review','four_source_animations_user_accepted','source_animation_user_accepted'):
    index['status'] = 'videos_ready' if complete else 'generation_running_recovered'
index_path.write_text(json.dumps(index,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
