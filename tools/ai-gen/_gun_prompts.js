// 枪械改造图标提示词生成器（一次性工具）
// 用法: node tools/ai-gen/_gun_prompts.js
// 输出: tools/ai-gen/_gun_prompts/<key>.txt（本地），再复制到 Y: 供 comfyui-gen.py 读取
const fs = require('fs');
const path = require('path');

const GUN_WEAPONS = ['weapon6','weapon7','weapon8','weapon9','weapon10','weapon11','weapon12','weapon13','weapon15','weapon18','weapon19'];

// key: 唯一组件标识（即图标文件名）；zh: 中文名；sub: 英文主体描述
const COMPONENTS = [
  { key:'suppressor', zh:'消音器', sub:'a single rifle suppressor, cylindrical matte black aluminum tube with a threaded mounting base at one end and a rounded end cap at the other, completely inside the frame with generous white margins' },
  { key:'flash_hider', zh:'鸟笼消焰器', sub:'a single A2 birdcage flash hider, short cylindrical steel tube with five long rectangular slots around the muzzle end and a closed bottom, threaded mounting base' },
  { key:'muzzle_brake', zh:'DTK制退器', sub:'a single ZenitCo DTK-1 style AK muzzle brake compensator, machined black steel cylinder with two rows of slanted cutout ports and angled front edges' },
  { key:'multi_chamber_brake', zh:'多室枪口制退器', sub:'a single multi-chamber pistol muzzle brake compensator, cylindrical steel compensator with several separate rows of small round vent ports divided by annular chamber walls, no long slots, threaded base' },
  { key:'large_caliber_suppressor', zh:'大口径消音器', sub:'a single large-caliber pistol suppressor, thick cylindrical matte black tube with a threaded mounting base and a rounded cap, noticeably thick diameter' },
  { key:'pistol_suppressor', zh:'手枪消音器', sub:'a single compact pistol suppressor, slim cylindrical matte black tube with a threaded mounting base and a rounded end cap' },
  { key:'elite_brake', zh:'精英制退器', sub:'a single elite pistol muzzle brake, compact ported steel compensator with side vent slots and a top port row' },
  { key:'choke', zh:'收束器', sub:'a single extended shotgun choke tube, mostly smooth steel cylinder with a knurled band near the threaded base and a few small round holes at the muzzle end, no long slots' },
  { key:'special_brake', zh:'特制制退器', sub:'a single futuristic energy weapon muzzle brake, vented dark metal cylinder with glowing cyan energy ports and fin slots' },
  { key:'border_radiator', zh:'边境散热器', sub:'a single sci-fi weapon heat radiator, cylindrical stack of thin dark cooling fins with a glowing blue energy core' },
  { key:'long_barrel', zh:'长枪管', sub:'a single long rifle barrel, blued steel cylinder with a front sight post and a threaded muzzle, completely inside the frame with generous white margins' },
  { key:'short_barrel', zh:'短枪管', sub:'a single very short stubby carbine barrel, noticeably compact length, blued steel with a front sight post and a threaded muzzle, much shorter than a full rifle barrel' },
  { key:'competition_barrel', zh:'加长竞赛枪管', sub:'a single long competition pistol barrel only, extended standalone steel barrel with a ported compensator tip, no receiver, no frame, no gun, completely inside the frame with generous white margins' },
  { key:'lightweight_barrel', zh:'轻量化短枪管', sub:'a single lightweight pistol barrel, short steel barrel with fluted sides and a round muzzle' },
  { key:'longshot_barrel', zh:'远射枪管', sub:'a single long precision pistol barrel, extended steel barrel with an integral compensator and vent slots, completely inside the frame with generous white margins' },
  { key:'cqb_barrel', zh:'近战短管', sub:'a single very short stubby CQB pistol barrel, compact steel barrel with a muzzle brake tip, standalone barrel only, no receiver, no gun' },
  { key:'light_mag', zh:'轻型弹夹', sub:'a single lightweight polymer AR-15 style box magazine, straight 30-round magazine with textured ridges and a small floor plate' },
  { key:'extended_mag', zh:'扩容弹夹/弹箱', sub:'a single extended box magazine, long curved black magazine with a textured body and a floor plate, completely inside the frame with generous white margins' },
  { key:'carbon_fiber_mag', zh:'碳纤维快速弹夹', sub:'a single carbon fiber pistol magazine, compact black magazine with visible woven carbon fiber texture' },
  { key:'drum_mag', zh:'大弹鼓', sub:'a single large shotgun drum magazine, round black drum with a central spring hub and a shell feed lip' },
  { key:'light_extended', zh:'轻型扩容弹夹', sub:'a single lightweight extended box magazine, longer black polymer magazine with a bright aluminum floor plate, completely inside the frame with generous white margins' },
  { key:'long_extended_mag', zh:'长扩容弹夹', sub:'a single long extended pistol magazine, very long black magazine with a finger-rest floor plate, completely inside the frame with generous white margins' },
  { key:'energy_extended', zh:'能量扩容弹箱', sub:'a single sci-fi energy cell magazine, rectangular dark battery pack with glowing cyan charge slots' },
  { key:'energy_fast', zh:'快速能量弹夹', sub:'a single compact sci-fi energy cell, sleek dark cell with glowing cyan power indicator lines' },
  { key:'fast_loader', zh:'快速装填器', sub:'a single shotgun speedloader, tubular plastic carrier with six round shell holes' },
  { key:'ap_ammo', zh:'钢芯穿甲弹', sub:'a single armor-piercing rifle cartridge, brass case with a black-tipped steel core bullet, standing upright' },
  { key:'sniper_ammo', zh:'高精度狙击弹', sub:'a single precision sniper cartridge, large brass case with a long boat-tail match bullet, standing upright' },
  { key:'fmj_ammo', zh:'FMJ钢芯弹', sub:'a single full metal jacket pistol round, brass case with a copper-jacketed round-nose bullet, standing upright' },
  { key:'hollow_point', zh:'空尖弹', sub:'a single hollow-point pistol round, brass case with a bullet featuring a visible hollow cavity at the tip, standing upright' },
  { key:'slug', zh:'独头弹', sub:'a single shotgun slug shell, red 12-gauge shell with a rifled lead slug visible at the crimped top, standing upright' },
  { key:'flechette', zh:'箭型弹', sub:'a single shotgun flechette shell, olive-green 12-gauge shell with three finned steel dart projectiles poking out of the top, standing upright' },
  { key:'hammer_point', zh:'锤击点弹药', sub:'a single pistol cartridge with a distinctly flat-topped bullet, wide squared-off flat meplat like a wadcutter target bullet, clearly flat and straight-sided at the tip, no round nose, standing upright' },
  { key:'border_light_ammo', zh:'边境轻型弹药', sub:'a single lightweight pistol round, silver aluminum case with a white-tipped polymer bullet, standing upright' },
  { key:'high_energy', zh:'高能量子弹', sub:'a single high-energy plasma cell round, translucent cyan energy capsule with a glowing core, standing upright' },
  { key:'piercing_ammo', zh:'强穿透子弹', sub:'a single sci-fi armor-piercing dart round, dark metallic case with a needle-like glowing core bullet, standing upright' },
  { key:'subsonic_hp', zh:'亚音速空尖弹', sub:'a single subsonic hollow-point pistol round, heavy brass case with a hollow-tip bullet, standing upright' },
  { key:'subsonic_fmj', zh:'亚音速全金属被甲弹', sub:'a single subsonic full metal jacket pistol round, brass case with a round-nose copper bullet, standing upright' },
  { key:'skeleton_stock', zh:'骨架枪托', sub:'a single skeletonized rifle stock, open-frame aluminum skeleton stock attached to a short buffer tube, black' },
  { key:'solid_core_stock', zh:'稳固核心枪托', sub:'a single solid rifle stock, full-bodied polymer collapsible AR-15 stock with a cheek riser and rubber buttpad' },
  { key:'ar_folding', zh:'AR式折叠套件', sub:'a single folding stock adapter kit, hinge mechanism with a buffer tube and folding stock joint, black' },
  { key:'tactical_stock', zh:'一体化战术枪托', sub:'a single tactical collapsible rifle buttstock only, skeletonized aluminum stock frame with a cheek riser and rubber buttpad on a bare buffer tube, absolutely no receiver, no rail, no barrel, no sight, no gun' },
  { key:'bullpup', zh:'无托改造', sub:'a single bullpup conversion stock kit, compact dark polymer rifle chassis shell with a forward trigger and pistol grip ahead of an empty magazine well, one standalone part' },
  { key:'light_grip', zh:'轻型后握', sub:'a single lightweight AR-15 style pistol grip, slim black polymer grip with fine texture and a storage cap' },
  { key:'heavy_grip', zh:'重型后握', sub:'a single heavy AR-15 style pistol grip, thick black rubber-overmolded grip with deep texture' },
  { key:'angled_grip', zh:'战术斜握把', sub:'a single short angled foregrip, small polymer grip angled backward with a top rail mount and a slender body, standalone foregrip only, not a vertical pistol grip' },
  { key:'pistol_grip', zh:'分离式手枪握把', sub:'a single detachable pistol grip, AR-15 style black polymer grip with a mounting tang' },
  { key:'red_dot', zh:'全景红点瞄具', sub:'a single red dot reflex sight, compact rectangular housing with a round lens window showing a red dot reticle, black, with side adjustment knobs' },
  { key:'russian_3x_scope', zh:'俄制三倍镜', sub:'a single Russian PSO-1 style 3x telescopic sight, cylindrical black scope tube with a large rubber eyepiece and a side-mounted battery compartment' },
  { key:'light_trigger', zh:'轻量化击发组件', sub:'a single lightweight flat trigger shoe, flat-faced anodized aluminum trigger blade' },
  { key:'curved_trigger', zh:'弧形竞技扳机片', sub:'a single small curved competition trigger shoe, short thin curved metal finger lever with a round screw hole at the top and a rounded tip, no sharp edge, no blade, no point, standalone small trigger part only' },
  { key:'auto_trigger', zh:'全自动板机', sub:'a single full-auto trigger assembly, one trigger blade with a three-position fire selector lever and a small housing, standalone trigger group only, no receiver, no grip, no gun' },
  { key:'lightweight_trigger', zh:'轻量化快速板机', sub:'a single small flat trigger blade, short rectangular aluminum trigger with a rounded finger groove and several circular cutout holes, no sharp edge, no blade, no point, no knife, standalone small trigger part only' },
  { key:'burst_trigger', zh:'爆发板机', sub:'a single small standalone trigger module, one trigger blade inside a small box-shaped housing with a rotary selector dial, no barrel, no receiver, no grip, no magazine, no stock, no gun' },
];

// 同名不同 id 的共享映射（其余默认 key 即 id）
const SHARED = {
  shotgun_suppressor: 'suppressor',      // 消音器
  light_extended_mag: 'light_extended',  // 轻型扩容弹夹
};

const TEMPLATE = [
  'game equipment icon, realistic dark fantasy RPG item icon, centered single item occupying most of frame, pure white background, no text, no watermark, no human, high detail, dramatic rim lighting,',
  '(exactly one {key}:1.5), {sub}, (isolated single object:1.3), centered with generous white margin,',
  'no blurry, no low quality, no watermark, no text, no signature, no frame, no border, no multiple subjects, no hands, no character, no circular halo, no glowing circle behind object, no magic circle, no base, no pedestal, no stand, no chain, no rope, no floating debris, no particles, no sparkles, no second object, no detached pieces,',
  'no multiple views, no duplicate items',
].join('\n');

const root = process.cwd();
const cfgPath = path.join(root, 'data', 'craft-config.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));

// 收集全部枪械选项 id
const optionIds = [];
for (const w of GUN_WEAPONS) {
  const wp = cfg[w];
  if (!wp || !wp.options) { console.error('missing weapon', w); process.exit(1); }
  for (const slot of Object.keys(wp.options)) {
    for (const opt of wp.options[slot]) optionIds.push(opt.id);
  }
}

const keyById = new Map();
for (const c of COMPONENTS) keyById.set(c.key, c.key);
for (const [id, key] of Object.entries(SHARED)) keyById.set(id, key);

const missing = [];
for (const id of optionIds) if (!keyById.has(id)) missing.push(id);
if (missing.length) {
  console.error('未覆盖的选项 id:', missing.join(', '));
  process.exit(1);
}

const usedKeys = new Set(optionIds.map((id) => keyById.get(id)));
const orphanKeys = COMPONENTS.filter((c) => !usedKeys.has(c.key)).map((c) => c.key);
if (orphanKeys.length) {
  console.error('未使用的组件（不会被任何选项引用）:', orphanKeys.join(', '));
  process.exit(1);
}

const outDir = path.join(root, 'tools', 'ai-gen', '_gun_prompts');
fs.mkdirSync(outDir, { recursive: true });
for (const c of COMPONENTS) {
  if (!usedKeys.has(c.key)) continue;
  const prompt = TEMPLATE.replace('{key}', c.key).replace('{sub}', c.sub);
  fs.writeFileSync(path.join(outDir, `${c.key}.txt`), prompt, 'utf8');
}

// 统计
const counts = new Map();
for (const id of optionIds) {
  const key = keyById.get(id);
  counts.set(key, (counts.get(key) || 0) + 1);
}
console.log(`选项总数: ${optionIds.length}, 唯一组件图: ${usedKeys.size}`);
console.log('共享映射:');
for (const [id, key] of Object.entries(SHARED)) console.log(`  ${id} -> ${key}`);
console.log('出现次数分布:');
for (const [key, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(2)}x  ${key}  (${COMPONENTS.find((c) => c.key === key).zh})`);
}
