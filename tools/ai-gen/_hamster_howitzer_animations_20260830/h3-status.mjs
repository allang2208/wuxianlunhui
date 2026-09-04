// Read only this task's queued H3 jobs; never submit, cancel or clear workflows.
import fs from 'node:fs';
const root = new URL('./', import.meta.url);
const revision = ['v04','v03','v02'].find(v=>process.argv.includes(`--revision=${v}`)) ?? 'v01';
const targetAction = process.argv.includes('--action=die') ? 'die' : 'attack';
const indexFile = revision === 'v01' ? 'task-index.json' : `${targetAction}-${revision}-index.json`;
const idsFile = revision === 'v01' ? 'generation-job-ids.json' : `${targetAction}-${revision}-job-ids.json`;
const index = JSON.parse(fs.readFileSync(new URL(indexFile,root),'utf8').replace(/^\uFEFF/,''));
const seeds = new Map(Object.entries(index.actions).map(([kind,a])=>[a.seed,kind]));
const jobs = new Map(Object.entries(index.actions).filter(([,a])=>a.promptId).map(([kind,a])=>[a.promptId,kind]));
const queue = await (await fetch('http://192.168.3.142:8188/queue')).json();
for (const state of ['queue_running','queue_pending']) {
  for (const item of queue[state] ?? []) {
    const workflow = item[2];
    const kind = seeds.get(workflow?.['7']?.inputs?.noise_seed);
    if (!kind || !String(workflow?.['15']?.inputs?.image).includes('howitzer-v06-padded')) continue;
    jobs.set(item[1],kind);
    console.log(JSON.stringify({action:kind,state,promptId:item[1]}));
  }
}
fs.writeFileSync(new URL(idsFile,root),JSON.stringify(Object.fromEntries([...jobs].map(([id,kind])=>[kind,id])),null,2)+'\n');
const ws = new WebSocket(`ws://192.168.3.142:8188/ws?clientId=howitzer-${targetAction}-${revision}-status-readonly`);
const timer = setTimeout(()=>ws.close(),process.argv.includes('--watch') ? 3600000 : 50000);
const completed = new Set();
ws.addEventListener('message',e=>{
  if (typeof e.data !== 'string') return;
  const message = JSON.parse(e.data); const d=message.data ?? {};
  if (jobs.has(d.prompt_id)) console.log(JSON.stringify({type:message.type,action:jobs.get(d.prompt_id),node:d.node,value:d.value,max:d.max}));
  if (jobs.has(d.prompt_id) && message.type === 'execution_success') {
    completed.add(d.prompt_id);
    if (completed.size === jobs.size) ws.close();
  }
});
ws.addEventListener('close',()=>clearTimeout(timer));
ws.addEventListener('error',()=>{clearTimeout(timer); ws.close();});
