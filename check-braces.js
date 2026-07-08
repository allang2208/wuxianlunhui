const fs = require('fs');
const content = fs.readFileSync(process.argv[2] || 'src/entities/player.js', 'utf8');
let depth = 0;
let inString = false;
let stringChar = '';
let inLineComment = false;
let inBlockComment = false;
let prev = '';

for (let i = 0; i < content.length; i++) {
  const ch = content[i];
  const next = content[i+1] || '';
  
  if (inLineComment) {
    if (ch === '\n') inLineComment = false;
    prev = ch;
    continue;
  }
  if (inBlockComment) {
    if (ch === '/' && prev === '*') inBlockComment = false;
    prev = ch;
    continue;
  }
  
  if (inString) {
    if (ch === stringChar && prev !== '\\') inString = false;
    prev = ch;
    continue;
  }
  
  if (ch === '/' && next === '/') { inLineComment = true; prev = ch; continue; }
  if (ch === '/' && next === '*') { inBlockComment = true; prev = ch; continue; }
  if (ch === '"' || ch === "'" || ch === '`') { inString = true; stringChar = ch; prev = ch; continue; }
  
  if (ch === '{') depth++;
  if (ch === '}') {
    depth--;
    if (depth < 0) {
      let line = 1;
      for (let j = 0; j <= i; j++) if (content[j] === '\n') line++;
      console.log('UNBALANCED at line ' + line);
      process.exit(1);
    }
  }
  prev = ch;
}
console.log('Final depth: ' + depth);
if (depth === 0) console.log('Braces balanced!');
else console.log('Braces NOT balanced, depth=' + depth);
