const fs = require('fs');
const path = require('path');
const espree = require('espree');

function findJsFiles(dir, list = []) {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === 'legacy') continue;
      findJsFiles(full, list);
    } else if (entry.endsWith('.js')) {
      list.push(full);
    }
  }
  return list;
}

function collectConsoleLogRanges(node, ranges = []) {
  if (!node || typeof node !== 'object') return ranges;
  if (node.type === 'ExpressionStatement' && node.expression && node.expression.type === 'CallExpression') {
    const callee = node.expression.callee;
    if (callee && callee.type === 'MemberExpression' && callee.object && callee.object.name === 'console' &&
        callee.property && (callee.property.name === 'log' || callee.property.value === 'log')) {
      ranges.push(node.range);
    }
  }
  for (const key of Object.keys(node)) {
    if (key === 'parent' || key === 'tokens' || key === 'comments') continue;
    const val = node[key];
    if (Array.isArray(val)) {
      for (const child of val) collectConsoleLogRanges(child, ranges);
    } else if (val && typeof val === 'object' && val.type) {
      collectConsoleLogRanges(val, ranges);
    }
  }
  return ranges;
}

const files = findJsFiles('src');
let totalRemoved = 0;

for (const file of files) {
  const code = fs.readFileSync(file, 'utf8');
  let ast;
  try {
    ast = espree.parse(code, { ecmaVersion: 'latest', sourceType: 'module', range: true, tokens: true, comment: true });
  } catch (e) {
    console.warn(`[skip] ${file}: ${e.message}`);
    continue;
  }
  const ranges = collectConsoleLogRanges(ast).sort((a, b) => b[0] - a[0]); // reverse order
  if (ranges.length === 0) continue;
  let newCode = code;
  for (const [start, end] of ranges) {
    // Remove the statement; if it leaves an empty line, keep newline to preserve line numbers roughly
    newCode = newCode.slice(0, start) + newCode.slice(end);
    totalRemoved++;
  }
  fs.writeFileSync(file, newCode);
  console.log(`${file}: removed ${ranges.length} console.log`);
}

console.log(`Total removed: ${totalRemoved}`);
