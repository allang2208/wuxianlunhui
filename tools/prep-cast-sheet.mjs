// 空手施法 sheet 入库：源为 8 列×4 行（格 512×512，4096×2048），
// 12 帧 = 帧 0..11 连续（row0 0-7 + row1 8-11），无需重排，直接复制。
// player-anim-config：frameWidth/Height 512、cols 8、rows 4、frames [0,11]、frameRate 24（12帧/0.5s）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = 'E:/无尽轮回/游戏/素材库/人物/主角动画/空手施法/空手施法.png';
const TOOLS_DIR = path.dirname(fileURLToPath(import.meta.url));
const DST = path.join(TOOLS_DIR, '..', 'assets', 'player', 'cast.png');

fs.mkdirSync(path.dirname(DST), { recursive: true });
fs.copyFileSync(SRC, DST);
console.log('copied:', DST);
