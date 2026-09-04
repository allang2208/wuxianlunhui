/* Offline candidate viewer only; no game imports or file writes. */
'use strict';
(async () => {
    const el = id => document.getElementById(id), data = window.DASH_TRANSITIONS;
    if (!data) { el('status').textContent = '缺少transition-data.js，请运行本目录素材合成脚本。'; return; }
    const canvas = el('stage'), ctx = canvas.getContext('2d');
    let sequence, elapsed = 0, playing = true, previous = null, drawToken = 0;
    const cache = new Map();
    const load = url => new Promise((resolve, reject) => {
        const img = new Image(); img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('候选图像加载失败')); img.src = url;
    });
    // Decode only a short working set, not all exported authoring frames at once.
    function bodyImage(id) {
        let promise = cache.get(id);
        if (promise) cache.delete(id);
        else promise = load(data.bodies[id]);
        cache.set(id, promise);
        while (cache.size > 32) cache.delete(cache.keys().next().value);
        return promise;
    }
    let weapons, shield;
    try {
        const [slash, thrust, shieldImage] = await Promise.all([
            load(data.weaponImages.slash), load(data.weaponImages.thrust), load(data.shieldImage),
        ]);
        weapons = { slash, thrust }; shield = shieldImage;
    } catch (error) { el('status').textContent = error.message; return; }
    function recordAt(time) {
        const frames = sequence.records;
        let lo = 0, hi = frames.length - 1;
        while (lo < hi) {
            const mid = Math.ceil((lo + hi) / 2);
            if (frames[mid].timeMs <= time) lo = mid; else hi = mid - 1;
        }
        return frames[lo];
    }
    function equip(image, pose, size, origin) {
        const w = Math.round(size[0]), h = Math.round(size[1]);
        ctx.save(); ctx.translate(pose.point[0] + data.offset[0], pose.point[1] + data.offset[1]);
        ctx.rotate(pose.angle * Math.PI / 180); ctx.drawImage(image, -origin[0]*w, -origin[1]*h, w, h); ctx.restore();
    }
    function character(record, body) {
        if (record.shield.behind) equip(shield, record.shield, data.shieldSize, data.shieldOrigin);
        ctx.drawImage(body, ...data.offset);
        equip(weapons[sequence.branch], record.sword, record.sword.size, record.sword.origin);
        const palm = record.points.mainPalm;
        ctx.save(); ctx.beginPath(); ctx.ellipse(palm[0]+data.offset[0],palm[1]+data.offset[1],14,16,0,0,Math.PI*2); ctx.clip();
        ctx.drawImage(body, ...data.offset); ctx.restore();
        if (!record.shield.behind) equip(shield, record.shield, data.shieldSize, data.shieldOrigin);
        if (el('bones').checked) {
            for (const [side,color] of [['main','#e5b15b'],['off','#65c9c4']]) {
                ctx.strokeStyle=ctx.fillStyle=color;ctx.lineWidth=3;ctx.beginPath();
                const points=['Shoulder','Elbow','Palm'].map(key=>record.points[side+key]);
                points.forEach((p,i)=>i?ctx.lineTo(p[0]+data.offset[0],p[1]+data.offset[1]):ctx.moveTo(p[0]+data.offset[0],p[1]+data.offset[1]));ctx.stroke();
                for(const p of points){ctx.beginPath();ctx.arc(p[0]+data.offset[0],p[1]+data.offset[1],4,0,Math.PI*2);ctx.fill();}
            }
        }
    }
    async function draw() {
        const token = ++drawToken, record = recordAt(elapsed);
        let body;
        try { body = await bodyImage(record.body); }
        catch (error) { if(token===drawToken) el('status').textContent=error.message; return; }
        if (token !== drawToken) return;
        ctx.clearRect(0,0,canvas.width,canvas.height);
        if (el('both').checked) {
            ctx.save();ctx.translate(0,42);ctx.scale(.5,.5);character(record,body);ctx.restore();
            ctx.save();ctx.translate(1152,42);ctx.scale(-.5,.5);character(record,body);ctx.restore();
        } else {
            ctx.save();ctx.translate(el('mirror').checked?950:200,10);ctx.scale(el('mirror').checked?-.65:.65,.65);character(record,body);ctx.restore();
        }
        ctx.fillStyle='#e5b15b';ctx.font='18px system-ui';ctx.fillText(record.phase,18,28);
        ctx.fillStyle='#65c9c4';ctx.fillRect(18,407,1116*elapsed/sequence.durationMs,3);
        el('seek').value=Math.round(elapsed);
        el('clock').textContent=`${Math.round(elapsed)} / ${sequence.durationMs} ms`;
        el('status').textContent=`${record.source} ｜点击时跑帧 ${sequence.entryRunFrame} ｜回跑帧 ${sequence.returnRunFrame} ｜额外攻击等待 0ms ｜离线候选`;
    }
    function select() {
        sequence=data.sequences.find(s=>s.exitState===el('exit').value&&s.branch===el('branch').value&&s.entryRunFrame===Number(el('origin').value));
        elapsed=0;previous=null;el('seek').max=sequence.durationMs;draw();
    }
    function pause(){playing=false;previous=null;el('play').textContent='播放';}
    for(const id of ['branch','origin','exit'])el(id).addEventListener('change',select);
    for(const id of ['bones','both','mirror'])el(id).addEventListener('change',draw);
    el('play').addEventListener('click',()=>{playing=!playing;previous=null;el('play').textContent=playing?'暂停':'播放';});
    el('seek').addEventListener('input',()=>{pause();elapsed=Number(el('seek').value);draw();});
    document.querySelectorAll('[data-jump]').forEach(button=>button.addEventListener('click',()=>{pause();elapsed=sequence[button.dataset.jump];draw();}));
    el('export').addEventListener('click',()=>{
        const blob=new Blob([JSON.stringify({status:data.status,config:data.config,sequence},null,2)+'\n'],{type:'application/json'});
        const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`${sequence.branch}-from-run-${sequence.entryRunFrame}.json`;
        document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    });
    function tick(now){
        if(playing&&!document.hidden){
            if(previous!==null)elapsed=(elapsed+Math.min(100,now-previous)*Number(el('speed').value))%sequence.durationMs;
            previous=now;draw();
        }else previous=null;
        requestAnimationFrame(tick);
    }
    select();requestAnimationFrame(tick);
})();
