const fs = require('fs');
const text = fs.readFileSync('src/ui/craft-system.js', 'utf-8');
const lines = text.split('\n');

let braceDepth = 0;
let inString = false;
let stringChar = null;
let inLineComment = false;
let inBlockComment = false;

for (let i = 2; i <= 885; i++) {
    const line = lines[i];
    if (!line) continue;
    const prevDepth = braceDepth;
    const prevInString = inString;
    const prevInLineComment = inLineComment;
    const prevInBlockComment = inBlockComment;
    
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
    
    if (i >= 878) {
        console.log(`Line ${i+1}: prevDepth=${prevDepth}, newDepth=${braceDepth}, inString=${prevInString}, inLineComment=${prevInLineComment}, inBlockComment=${prevInBlockComment}`);
        console.log(`  Text: ${JSON.stringify(line)}`);
    }
}

console.log('Final braceDepth:', braceDepth);
