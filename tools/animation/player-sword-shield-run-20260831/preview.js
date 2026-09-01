/* Offline candidate authoring only. No Phaser imports, server, game state or writes. */
'use strict';
(async () => {
    const data = window.RUN_CANDIDATE;
    const status = document.getElementById('status');
    if (!data) { status.textContent = '缺少preview-data.js，请先运行同目录build.py。'; return; }
    const copy = value => JSON.parse(JSON.stringify(value));
    const rig = data.rig;
    let poses = copy(rig.poses), index = 0, playing = true, lastTick = null, dirty = false;
    const canvas = document.getElementById('stage'), ctx = canvas.getContext('2d');
    const el = id => document.getElementById(id);
    const load = url => new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('候选图像加载失败'));
        image.src = url;
    });
    let parts, bodies, weapons, shield;
    try {
        const partNames = Object.keys(data.images);
        const images = await Promise.all(partNames.map(name => load(data.images[name])));
        parts = Object.fromEntries(partNames.map((name, i) => [name, images[i]]));
        bodies = await Promise.all(data.bodies.map(load));
        weapons = await Promise.all(data.weapons.map(item => load(item.image)));
        shield = await load(data.shield.image);
    } catch (error) { status.textContent = error.message; return; }
    data.weapons.forEach((weapon, i) => {
        const option = document.createElement('option');
        option.value = i; option.textContent = weapon.name;
        el('weapon').append(option);
    });
    el('weapon').value = '1';
    const fields = [
        ['mainUpper', '主手 · 上臂', -30, 55],
        ['mainForearm', '主手 · 前臂', -90, 45],
        ['offUpper', '副手 · 上臂', -45, 45],
        ['offForearm', '副手 · 前臂', -120, 15],
        ['swordAngle', '剑身倾角', 70, 170],
        ['shieldAngle', '盾面倾角', -40, 40],
    ];
    const controls = {};
    function pause() { playing = false; el('play').textContent = '播放'; lastTick = null; }
    function edit(field, next) {
        if (!Number.isFinite(next)) return;
        const def = fields.find(item => item[0] === field);
        next = Math.max(def[2], Math.min(def[3], next));
        pause();
        if (el('allFrames').checked) {
            const delta = next - poses[index][field];
            poses.forEach(pose => { pose[field] = Math.max(def[2], Math.min(def[3], pose[field] + delta)); });
        } else poses[index][field] = next;
        dirty = true; syncControls(); draw();
        status.textContent = `已修改源帧${index}${el('allFrames').checked ? '及整循环' : ''}，尚未导出。`;
    }
    for (const [field, label, min, max] of fields) {
        const wrapper = document.createElement('div'); wrapper.className = 'control';
        const title = document.createElement('label'); title.textContent = label; title.htmlFor = field;
        const number = document.createElement('input');
        number.type = 'number'; number.min = min; number.max = max; number.step = 1;
        number.setAttribute('aria-label', label + '角度');
        const slider = document.createElement('input');
        slider.type = 'range'; slider.id = field; slider.min = min; slider.max = max; slider.step = 1;
        slider.addEventListener('input', () => edit(field, Number(slider.value)));
        number.addEventListener('change', () => { if (number.value !== '') edit(field, Number(number.value)); });
        wrapper.append(title, number, slider); el('controls').append(wrapper);
        controls[field] = { slider, number };
    }
    function syncControls() {
        for (const [field] of fields) {
            controls[field].slider.value = poses[index][field];
            controls[field].number.value = poses[index][field];
        }
        el('frame').value = index; el('frameLabel').textContent = `${index} / 7`;
    }
    function turn(point, pivot, root, angle) {
        const rad = angle * Math.PI / 180, c = Math.cos(rad), s = Math.sin(rad);
        const x = point[0] - pivot[0], y = point[1] - pivot[1];
        return [root[0] + x * c - y * s, root[1] + x * s + y * c];
    }
    function joints(pose) {
        const result = {};
        for (const side of ['main', 'off']) {
            const upper = rig.parts[side + 'Upper'], fore = rig.parts[side + 'Forearm'];
            const shoulder = pose[side + 'Shoulder'];
            const elbow = turn(upper.end, upper.pivot, shoulder, pose[side + 'Upper']);
            const wrist = turn(fore.wrist, fore.pivot, elbow, pose[side + 'Forearm']);
            const palm = turn(fore.end, fore.pivot, elbow, pose[side + 'Forearm']);
            result[side] = { shoulder, elbow, wrist, palm };
        }
        return result;
    }
    function imageAt(image, pivot, root, angle, size = [image.width, image.height]) {
        ctx.save(); ctx.translate(...root); ctx.rotate(angle * Math.PI / 180);
        ctx.drawImage(image, -pivot[0], -pivot[1], size[0], size[1]); ctx.restore();
    }
    function draw() {
        const pose = poses[index], points = joints(pose);
        const weaponIndex = Number(el('weapon').value), weapon = data.weapons[weaponIndex];
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const scale = Number(el('scale').value);
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.scale(el('mirror').checked ? -scale : scale, scale);
        ctx.translate(-256, -256);
        ctx.strokeStyle = '#3d4851'; ctx.lineWidth = 1 / scale;
        ctx.beginPath(); ctx.moveTo(-130, 512); ctx.lineTo(650, 512); ctx.stroke();
        function arm(name) {
            if (!el('arms').checked) return;
            const side = name.startsWith('main') ? 'main' : 'off';
            const root = points[side][name.endsWith('Upper') ? 'shoulder' : 'elbow'];
            imageAt(parts[name], rig.parts[name].localPivot, root, pose[name]);
        }
        arm('offUpper'); ctx.drawImage(bodies[index], 0, 0);
        arm('mainUpper'); arm('mainForearm');
        if (el('equipment').checked && el('arms').checked) {
            const size = weapon.sourceSizeRounded;
            imageAt(weapons[weaponIndex], [size[0] * weapon.grip[0], size[1] * weapon.grip[1]],
                points.main.palm, pose.swordAngle, size);
            imageAt(parts.mainHand, rig.parts.mainHand.localPivot, points.main.elbow, pose.mainForearm);
        }
        arm('offForearm');
        if (el('equipment').checked && el('arms').checked) {
            const size = data.shield.sourceSizeRounded;
            imageAt(shield, [size[0] * data.shield.grip[0], size[1] * data.shield.grip[1]],
                points.off.palm, pose.shieldAngle, size);
        }
        if (el('bones').checked) {
            for (const side of ['main', 'off']) {
                const chain = ['shoulder', 'elbow', 'wrist', 'palm'].map(key => points[side][key]);
                ctx.strokeStyle = ctx.fillStyle = side === 'main' ? '#edb557' : '#65c9c4';
                ctx.lineWidth = 2 / scale; ctx.beginPath();
                chain.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke();
                for (const [x, y] of chain) { ctx.beginPath(); ctx.arc(x, y, 4 / scale, 0, 2 * Math.PI); ctx.fill(); }
            }
        }
        ctx.restore();
        ctx.font = '14px system-ui'; ctx.fillStyle = '#aeb9c3';
        ctx.fillText(`源帧 ${index} / ${el('mirror').checked ? '朝左' : '朝右'} / ${dirty ? '已编辑' : '初始候选'}`, 20, 28);
    }
    el('play').addEventListener('click', () => {
        playing = !playing; lastTick = null; el('play').textContent = playing ? '暂停' : '播放';
    });
    el('frame').addEventListener('input', () => { pause(); index = Number(el('frame').value); syncControls(); draw(); });
    for (const id of ['weapon', 'mirror', 'bones', 'equipment', 'arms', 'scale']) el(id).addEventListener('change', draw);
    el('speed').addEventListener('change', () => { lastTick = null; });
    el('reset').addEventListener('click', () => {
        poses = copy(rig.poses); dirty = false; syncControls(); draw(); status.textContent = '已恢复初始候选参数。';
    });
    el('export').addEventListener('click', () => {
        const output = copy(rig); output.poses = copy(poses); output.jointFrames = poses.map(joints);
        output.status = 'user-edited-candidate-not-in-runtime';
        const blob = new Blob([JSON.stringify(output, null, 2) + '\n'], { type: 'application/json' });
        const url = URL.createObjectURL(blob), link = document.createElement('a');
        link.href = url; link.download = 'sword-shield-run-edited.json'; document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        status.textContent = '已导出JSON；游戏配置未改变。';
    });
    function tick(time) {
        if (playing && !document.hidden) {
            const interval = 1000 / rig.fps / Number(el('speed').value);
            if (lastTick === null) lastTick = time;
            const steps = Math.floor((time - lastTick) / interval);
            if (steps > 0) { index = (index + steps) % poses.length; lastTick += steps * interval; syncControls(); draw(); }
        } else lastTick = null;
        requestAnimationFrame(tick);
    }
    syncControls(); draw(); requestAnimationFrame(tick);
})();
