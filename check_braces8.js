const fs = require('fs');
const text = fs.readFileSync('src/ui/craft-system.js', 'utf-8');
const start = text.indexOf('const CraftSystem = {');
const startObj = start + 'const CraftSystem = '.length;
let depth = 0, inString = false, stringChar = null, escape = false;
let lineNo = 1, col = 0;
const events = [];
for (let i = 0; i < text.length - startObj; i++) {
  const ch = text[startObj + i];
  if (ch === '\n') { lineNo++; col = 0; } else { col++; }
  if (inString) {
    if (escape) { escape = false; }
    else if (ch === '\\') { escape = true; }
    else if (ch === stringChar) { inString = false; }
    continue;
  }
  if (ch === '"' || ch === "'" || ch === '`') { inString = true; stringChar = ch; continue; }
  if (ch === '{') { depth++; events.push({type: 'open', line: lineNo, col: col, depth: depth}); }
  if (ch === '}') { depth--; events.push({type: 'close', line: lineNo, col: col, depth: depth}); if (depth < 0) depth = 0; }
}
console.log('Final depth:', depth);
console.log('First 20 events:');
for (const e of events.slice(0, 20)) {
  console.log(e.type, 'line', e.line, 'col', e.col, 'depth', e.depth);
}
console.log('Last 20 events:');
for (const e of events.slice(-20)) {
  console.log(e.type, 'line', e.line, 'col', e.col, 'depth', e.depth);
}
