const fs = require('fs');
const text = fs.readFileSync('src/ui/craft-system.js', 'utf-8');
const start = text.indexOf('const CraftSystem = {');
const startObj = start + 'const CraftSystem = '.length;
let depth = 0, inString = false, stringChar = null, escape = false;
let lineNo = 1, col = 0;
const opens = [];
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
  if (ch === '{') { depth++; opens.push({line: lineNo, col: col, depth: depth}); }
  if (ch === '}') { 
    const open = opens.pop();
    depth--; 
    if (depth < 0) { console.log('Extra } at line', lineNo, 'col', col); depth = 0; }
    else if (depth === 0) { 
      console.log('Matching } at line', lineNo, 'col', col, 'opened at line', open.line, 'col', open.col, 'depth', open.depth); 
      console.log('Next:', JSON.stringify(text.slice(startObj + i + 1, startObj + i + 6))); 
      break; 
    }
  }
}
if (depth !== 0) {
  console.log('UNBALANCED: depth =', depth);
  console.log('Unmatched opens:');
  for (const o of opens) {
    console.log('  line', o.line, 'col', o.col, 'depth', o.depth);
  }
}
else console.log('BALANCED');
