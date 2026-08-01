import fs from 'node:fs';

const lib = JSON.parse(fs.readFileSync('data/wall-prefabs.json', 'utf8'));
const keys = Object.keys(lib);
console.log('total prefabs:', keys.length);
keys.forEach((k, i) => console.log(i, JSON.stringify(k)));

const torch = lib['火把墙'];
console.log('\n火把墙 exists:', !!torch);
if (torch) {
  console.log(JSON.stringify(torch, null, 2));
}
