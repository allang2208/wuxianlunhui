const fs = require('fs');
const text = fs.readFileSync('src/ui/craft-system.js', 'utf-8');
const lines = text.split('\n');

let braceDepth = 0;
let inString = false;
let stringChar = null;
let inLineComment = false;
let inBlockComment = false;

const trackChanges = [];

for (let i = 2; i < 882; i++) {
    const line = lines[i];
    if (!line) continue;
    const prevDepth = braceDepth;
    
    for (let j = 0; j < line.length; j++) {
        const char = line[j];
        const nextChar = line[j + 1];
        
        if (inLineComment) {
            if (char === '\n') inLineComment = false;
            continue;
        }
        
        if (inBlockComment) {
            if (char === '*' && nextChar === '/') {
                inBlockComment = false;
                j++;
            }
            continue;
        }
        
        if (inString) {
            if (char === '\\') {
                j++;
                continue;
            }
            if (char === stringChar) {
                inString = false;
                stringChar = null;
            }
            continue;
        }
        
        if (char === '/' && nextChar === '/') {
            inLineComment = true;
            j++;
            continue;
        }
        
        if (char === '/' && nextChar === '*') {
            inBlockComment = true;
            j++;
            continue;
        }
        
        if (char === '"' || char === "'" || char === '`') {
            inString = true;
            stringChar = char;
            continue;
        }
        
        if (char === '{') braceDepth++;
        if (char === '}') braceDepth--;
    }
    
    if (braceDepth !== prevDepth) {
        trackChanges.push({line: i + 1, prevDepth, newDepth: braceDepth, text: line.trim().substring(0, 60)});
    }
}

console.log(trackChanges.slice(-20));
console.log('Final braceDepth:', braceDepth);
