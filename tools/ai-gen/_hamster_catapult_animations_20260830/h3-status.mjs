// Read-only status for this task's H3 jobs. Does not submit/cancel any workflow.
import fs from 'node:fs';
const index = JSON.parse(fs.readFileSync(new URL('./task-index.json',import.meta.url),'utf8').replace(/^\uFEFF/,''));
const jobs = new Map(Object.entries(index.actions).filter(([,a])=>a.promptId).map(([k,a])=>[a.promptId,k]));
const queue = await (await fetch('http://192.168.3.142:8188/queue')).json();
for(const state of ['queue_running','queue_pending']) {
  for(const item of queue[state] ?? []) {
    if(jobs.has(item[1])) console.log(JSON.stringify({action:jobs.get(item[1]),state,promptId:item[1]}));
  }
}
const ws = new WebSocket('ws://192.168.3.142:8188/ws?clientId=catapult-status-readonly');
const timer = setTimeout(()=>ws.close(),20000);
ws.addEventListener('message',e=>{
  if(typeof e.data!=='string') return;
  const message=JSON.parse(e.data); const d=message.data ?? {};
  if(jobs.has(d.prompt_id)) console.log(JSON.stringify({type:message.type,action:jobs.get(d.prompt_id),node:d.node,value:d.value,max:d.max}));
});
ws.addEventListener('close',()=>clearTimeout(timer));
ws.addEventListener('error',()=>{clearTimeout(timer); ws.close();});
