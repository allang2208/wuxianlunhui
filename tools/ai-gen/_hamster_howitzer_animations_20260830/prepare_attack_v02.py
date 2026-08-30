"""Record the requested firing/reloading revision without changing v01 candidates."""
import copy
import json
from pathlib import Path

root = Path(__file__).resolve().parent
target = root/'attack-v02-index.json'
if target.exists():
    raise SystemExit('Revision already prepared; preserve its state and sources.')
previous = json.loads((root/'task-index.json').read_text(encoding='utf-8'))
index = {key:copy.deepcopy(previous[key]) for key in
         ('unitKey','unitName','level','building','date','provider','mother','reference','budget')}
index.update(assetOnly=True,runtimeIntegrationActive=False,status='prepared',revision='v02',
             scope='Attack animation only. Preserve idle, run and die v01 and all runtime assets.',
             approvalScope='User explicitly requested further firing detail optimization: slightly raise barrel, fire, then loader inserts held cartridge and rear breech ejects a spent case. Continue the authorized H3 route.',
             visualAcceptance='pending_user_review',reviewNotes='REVIEW-NOTES.md',
             generation={'endpoint':'http://192.168.3.142:8188','duration':8.0,
                         'frames':192,'fps':24,'size':[1024,576],'steps':20,'candidatesPerAction':1,
                         'uploaded':False,'submitted':False,'generated':False},
             actions={'attack':{'prompt':'prompts/attack-v02.txt','seed':830313,
                                'status':'prepared','loop':False,'actionMode':'recover',
                                'sourceVideo':None,'sourceSheet':None,'finalSheet':None,'preview':None}},
             previousCandidate={'index':'task-index.json','video':'videos/attack-v01.mp4',
                                'promptId':previous['actions']['attack']['promptId']},
             intendedSequence=['slight elevation','one shot and recoil','rear case extraction/ejection',
                               'held cartridge enters rear breech','empty hands withdraw and breech closes'],
             continuityNote='Loaded cartridge is consumed; loader ends empty-handed. A later repeat-attack integration needs an explicit ammunition pickup transition, not a magically respawned cartridge.')
target.write_text(json.dumps(index,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(target)
